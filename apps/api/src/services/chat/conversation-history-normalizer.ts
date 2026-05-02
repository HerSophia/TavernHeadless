import type { ChatMessage } from "@tavern/core";

import type { PromptHistoryMessageEntry } from "../chat-history-loader.js";

export interface EffectiveConversationTurn {
  role: ChatMessage["role"];
  content: string;
  sourceFloorIds: string[];
  sourcePageIds: string[];
  sourceMessageIds: string[];
  floorRange: { start: number; end: number } | null;
  includesCurrentInput: boolean;
  foldKind: "none" | "adjacent_user" | "same_floor_assistant";
  entryCount: number;
}

export interface PromptRuntimeHistoryNormalizationViolation {
  code: "adjacent_assistant_floors";
  message: string;
  sourceFloorIds: string[];
  sourceMessageIds: string[];
}

export interface PromptRuntimeMergedUserGroupSummary {
  effectiveRole: "user";
  sourceFloorIds: string[];
  sourceMessageIds: string[];
  includesCurrentInput: boolean;
}

export interface PromptRuntimeHistoryNormalizationSummary {
  rawEntryCount: number;
  effectiveTurnCount: number;
  selectedTurnCount: number;
  trailingUserSourceFloorIds: string[];
  mergedUserGroups: PromptRuntimeMergedUserGroupSummary[];
  violations: PromptRuntimeHistoryNormalizationViolation[];
}

export interface ConversationHistoryWindow {
  history: ChatMessage[];
  effectiveUserMessage?: string;
  effectiveTurns: EffectiveConversationTurn[];
  selectedTurns: EffectiveConversationTurn[];
  historyNormalization: PromptRuntimeHistoryNormalizationSummary;
}

export interface NormalizedConversationHistory {
  effectiveTurns: EffectiveConversationTurn[];
  violations: PromptRuntimeHistoryNormalizationViolation[];
}

export function normalizeConversationHistory(
  entries: PromptHistoryMessageEntry[],
): NormalizedConversationHistory {
  const effectiveTurns: EffectiveConversationTurn[] = [];
  const violations: PromptRuntimeHistoryNormalizationViolation[] = [];

  for (const entry of entries) {
    const previousTurn = effectiveTurns[effectiveTurns.length - 1];
    if (!previousTurn) {
      effectiveTurns.push(createTurnFromEntry(entry));
      continue;
    }

    if (entry.role === "user" && previousTurn.role === "user") {
      effectiveTurns[effectiveTurns.length - 1] = mergeTurn(previousTurn, entry, "adjacent_user");
      continue;
    }

    if (entry.role === "assistant" && previousTurn.role === "assistant") {
      if (canMergeAssistantEntry(previousTurn, entry)) {
        effectiveTurns[effectiveTurns.length - 1] = mergeTurn(previousTurn, entry, "same_floor_assistant");
        continue;
      }

      violations.push({
        code: "adjacent_assistant_floors",
        message: "Consecutive assistant entries spanned multiple floors.",
        sourceFloorIds: uniqueOrderedValues([...previousTurn.sourceFloorIds, entry.floorId]),
        sourceMessageIds: uniqueOrderedValues([...previousTurn.sourceMessageIds, entry.messageId]),
      });
    }

    effectiveTurns.push(createTurnFromEntry(entry));
  }

  return {
    effectiveTurns,
    violations,
  };
}

export function buildConversationHistoryWindow(args: {
  entries: PromptHistoryMessageEntry[];
  maxSelectedTurns?: number;
}): ConversationHistoryWindow {
  const normalized = normalizeConversationHistory(args.entries);
  const selectedTurns = args.maxSelectedTurns === undefined
    ? normalized.effectiveTurns
    : normalized.effectiveTurns.slice(-args.maxSelectedTurns);
  const trailingTurn = selectedTurns[selectedTurns.length - 1];
  const historyTurns = trailingTurn?.role === "user"
    ? selectedTurns.slice(0, -1)
    : selectedTurns;

  return {
    history: historyTurns.map((turn) => ({ role: turn.role, content: turn.content })),
    ...(trailingTurn?.role === "user" ? { effectiveUserMessage: trailingTurn.content } : {}),
    effectiveTurns: normalized.effectiveTurns,
    selectedTurns,
    historyNormalization: {
      rawEntryCount: args.entries.length,
      effectiveTurnCount: normalized.effectiveTurns.length,
      selectedTurnCount: selectedTurns.length,
      trailingUserSourceFloorIds: trailingTurn?.role === "user" ? [...trailingTurn.sourceFloorIds] : [],
      mergedUserGroups: selectedTurns
        .filter((turn): turn is EffectiveConversationTurn & { role: "user" } => turn.role === "user" && turn.entryCount > 1)
        .map((turn) => ({
          effectiveRole: "user" as const,
          sourceFloorIds: [...turn.sourceFloorIds],
          sourceMessageIds: [...turn.sourceMessageIds],
          includesCurrentInput: turn.includesCurrentInput,
        })),
      violations: normalized.violations,
    },
  };
}

function createTurnFromEntry(entry: PromptHistoryMessageEntry): EffectiveConversationTurn {
  return {
    role: entry.role,
    content: entry.content,
    sourceFloorIds: uniqueOrderedValues([entry.floorId]),
    sourcePageIds: uniqueOrderedValues([entry.pageId]),
    sourceMessageIds: uniqueOrderedValues([entry.messageId]),
    floorRange: entry.floorNo === null ? null : { start: entry.floorNo, end: entry.floorNo },
    includesCurrentInput: entry.fromCurrentInput === true,
    foldKind: "none",
    entryCount: 1,
  };
}

function canMergeAssistantEntry(
  previousTurn: EffectiveConversationTurn,
  entry: PromptHistoryMessageEntry,
): boolean {
  if (entry.floorId === null) {
    return previousTurn.sourceFloorIds.length === 0;
  }

  return previousTurn.sourceFloorIds.length === 1
    && previousTurn.sourceFloorIds[0] === entry.floorId;
}

function mergeTurn(
  previousTurn: EffectiveConversationTurn,
  entry: PromptHistoryMessageEntry,
  foldKind: EffectiveConversationTurn["foldKind"],
): EffectiveConversationTurn {
  return {
    ...previousTurn,
    content: joinTurnContent(previousTurn.content, entry.content),
    sourceFloorIds: uniqueOrderedValues([...previousTurn.sourceFloorIds, entry.floorId]),
    sourcePageIds: uniqueOrderedValues([...previousTurn.sourcePageIds, entry.pageId]),
    sourceMessageIds: uniqueOrderedValues([...previousTurn.sourceMessageIds, entry.messageId]),
    floorRange: mergeFloorRange(previousTurn.floorRange, entry.floorNo),
    includesCurrentInput: previousTurn.includesCurrentInput || entry.fromCurrentInput === true,
    foldKind: previousTurn.foldKind === "none" ? foldKind : previousTurn.foldKind,
    entryCount: previousTurn.entryCount + 1,
  };
}

function joinTurnContent(left: string, right: string): string {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return `${left}\n\n${right}`;
}

function mergeFloorRange(
  currentRange: EffectiveConversationTurn["floorRange"],
  floorNo: number | null,
): EffectiveConversationTurn["floorRange"] {
  if (floorNo === null) {
    return currentRange;
  }
  if (!currentRange) {
    return { start: floorNo, end: floorNo };
  }
  return {
    start: Math.min(currentRange.start, floorNo),
    end: Math.max(currentRange.end, floorNo),
  };
}

function uniqueOrderedValues(values: Array<string | null>): string[] {
  const uniqueValues: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    uniqueValues.push(value);
  }

  return uniqueValues;
}
