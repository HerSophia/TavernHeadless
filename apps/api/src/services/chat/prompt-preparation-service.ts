import type { ChatMessage, TokenCounter } from "@tavern/core";
import { resolvePromptRuntimeBudgetGroupExclusionSource, resolvePromptRuntimeBudgetGroupTraceLabel } from "@tavern/core";
import {
  materializePromptRuntimeMessages,
  type AssistantPrefillExecutionStrategy,
  type PromptTrimReason,
  type PromptSourceExclusionReason,
  type PromptSendDirectives,
  type MaterializePromptRuntimeMessagesResult,
  type AssembleResult,
  type PromptDeliveryPolicy,
  type PromptRuntimeTrace,
  type PromptSnapshotPreview,
  type PromptSourceSelectionPolicy,
  type PromptStructurePolicy,
} from "../prompt-assembler.js";
import type { PromptHistoryMessageEntry, PromptVisibilityPolicy, PromptVisibilityTrace } from "../chat-history-loader.js";
import { ChatHistoryLoader } from "../chat-history-loader.js";
import { buildPromptRuntimeExecutionResult, type PromptRuntimeExecutionResult, type PromptRuntimeResolvedContext } from "../prompt-runtime-execution.js";
import {
  PromptRuntimeControlService,
  buildPromptRuntimeDiagnostics,
  buildPromptRuntimeSourceMap,
  buildPromptRuntimeWarnings,
  buildResolvedPromptRuntimePolicy,
  mergePromptRuntimePersistentPolicies,
  PROMPT_RUNTIME_LIMITATIONS,
  type PromptRuntimeDiagnostic,
  type PromptRuntimeDiagnosticPhase,
  type PromptRuntimeHistorySourceMode,
  type PromptRuntimeInspectionResult,
  type PromptRuntimePersistentPolicy,
  type PromptRuntimeSectionStat,
  type ResolvedPromptRuntimePolicy,
} from "../prompt-runtime-control-service.js";
import type { AppDb } from "../../db/client.js";

import {
  buildConversationHistoryWindow,
  type EffectiveConversationTurn,
  type PromptRuntimeHistoryNormalizationSummary,
} from "./conversation-history-normalizer.js";

export interface PromptLiveDebugArtifacts {
  availableForReply: number;
  inspection: PromptRuntimeInspectionResult;
  promptSnapshotRecord: NonNullable<PromptRuntimeExecutionResult["promptSnapshotRecord"]>;
  promptSnapshot?: PromptSnapshotPreview;
  runtimeTrace?: PromptRuntimeTrace;
}

export interface PromptRuntimeConversationInput {
  content: string;
  floorId?: string | null;
  floorNo?: number | null;
  pageId?: string | null;
  pageNo?: number | null;
  messageId?: string | null;
  seq?: number;
}

export interface PromptRuntimeConversationWindow {
  history: ChatMessage[];
  effectiveUserMessage?: string;
  effectiveTurns: EffectiveConversationTurn[];
  selectedTurns: EffectiveConversationTurn[];
  visibilityTrace: PromptVisibilityTrace;
  historyNormalization: PromptRuntimeHistoryNormalizationSummary;
}

export class PromptPreparationService {
  constructor(
    private readonly db: AppDb,
    private readonly tokenCounter: TokenCounter,
    private readonly historyLoader: ChatHistoryLoader,
  ) {}

  async loadPromptRuntimeHistoryWindow(args: {
    sessionId: string;
    branchId: string;
    beforeFloorNo?: number;
    visibility: PromptVisibilityPolicy;
    sourceSelection?: PromptSourceSelectionPolicy;
  }): Promise<{ history: ChatMessage[]; visibilityTrace: PromptVisibilityTrace }> {
    const [history, visibilityTrace] = await Promise.all([
      this.historyLoader.loadHistory(args.sessionId, args.branchId, args.beforeFloorNo, args.visibility),
      this.historyLoader.previewVisibility(args.sessionId, args.branchId, args.beforeFloorNo, args.visibility),
    ]);

    return {
      history: this.applyPromptRuntimeHistorySourceSelection(history, args.sourceSelection),
      visibilityTrace,
    };
  }

  async loadPromptRuntimeConversationWindow(args: {
    sessionId: string;
    branchId: string;
    beforeFloorNo?: number;
    visibility: PromptVisibilityPolicy;
    sourceSelection?: PromptSourceSelectionPolicy;
    currentInput?: PromptRuntimeConversationInput;
  }): Promise<PromptRuntimeConversationWindow> {
    const [historyEntries, visibilityTrace] = await Promise.all([
      this.historyLoader.loadHistoryEntries(args.sessionId, args.branchId, args.beforeFloorNo, args.visibility),
      this.historyLoader.previewVisibility(args.sessionId, args.branchId, args.beforeFloorNo, args.visibility),
    ]);
    const entries = args.currentInput
      ? [...historyEntries, this.buildCurrentInputEntry(args.currentInput)]
      : historyEntries;
    const historyMaxTurns = resolvePromptRuntimeHistoryMaxTurns(args.sourceSelection);
    const window = buildConversationHistoryWindow({
      entries,
      ...(historyMaxTurns !== undefined ? { maxSelectedTurns: historyMaxTurns } : {}),
    });

    return {
      history: window.history,
      effectiveTurns: window.effectiveTurns,
      selectedTurns: window.selectedTurns,
      visibilityTrace,
      historyNormalization: window.historyNormalization,
      ...(window.effectiveUserMessage !== undefined ? { effectiveUserMessage: window.effectiveUserMessage } : {}),
    };
  }

  applyPromptRuntimeHistorySourceSelection(
    history: ChatMessage[],
    sourceSelection?: PromptSourceSelectionPolicy,
  ): ChatMessage[] {
    const mode = sourceSelection?.history?.mode;
    if (mode === "full") {
      return history;
    }

    const maxMessages = normalizePositiveInt(sourceSelection?.history?.maxMessages);
    if (!maxMessages || history.length <= maxMessages) {
      return history;
    }

    return history.slice(-maxMessages);
  }

  async buildPromptRuntimeInspection(args: ({
    accountId: string;
    context: PromptRuntimeResolvedContext;
    phase: PromptRuntimeDiagnosticPhase;
    history: ChatMessage[];
    visibilityTrace?: PromptVisibilityTrace;
    memorySummary?: string;
    assembled?: AssembleResult;
    memoryTrace?: PromptRuntimeTrace["memory"];
    worldbookHitCount?: number;
    extraDiagnostics?: PromptRuntimeDiagnostic[];
    historyNormalization?: PromptRuntimeHistoryNormalizationSummary;
  } | {
    accountId: string;
    sessionId: string;
    branchId: string;
    branchExists: boolean;
    sourceFloorId?: string | null;
    historySourceBranchId: string;
    historySourceMode: PromptRuntimeHistorySourceMode;
    sessionPersistentPolicy?: PromptRuntimePersistentPolicy;
    sessionPolicyWarnings?: string[];
    branchPersistentPolicy?: PromptRuntimePersistentPolicy;
    branchPolicyWarnings?: string[];
    requestPolicy?: PromptRuntimePersistentPolicy;
    resolvedPolicy?: ResolvedPromptRuntimePolicy;
    phase: PromptRuntimeDiagnosticPhase;
    history: ChatMessage[];
    visibilityTrace?: PromptVisibilityTrace;
    memorySummary?: string;
    assembled?: AssembleResult;
    memoryTrace?: PromptRuntimeTrace["memory"];
    worldbookHitCount?: number;
    extraDiagnostics?: PromptRuntimeDiagnostic[];
    historyNormalization?: PromptRuntimeHistoryNormalizationSummary;
  })): Promise<PromptRuntimeInspectionResult> {
    const context: PromptRuntimeResolvedContext = "context" in args
      ? args.context
      : {
          scope: {
            sessionId: args.sessionId,
            targetBranchId: args.branchId,
            branchExists: args.branchExists,
            sourceFloorId: args.sourceFloorId ?? null,
            historySourceBranchId: args.historySourceBranchId,
            historySourceMode: args.historySourceMode,
          },
          sessionPersistentPolicy: args.sessionPersistentPolicy,
          sessionPolicyWarnings: args.sessionPolicyWarnings ?? [],
          branchPersistentPolicy: args.branchPersistentPolicy,
          branchPolicyWarnings: args.branchPolicyWarnings ?? [],
          requestPolicy: args.requestPolicy,
          effectivePolicy: mergePromptRuntimePersistentPolicies(
            args.sessionPersistentPolicy,
            args.branchPersistentPolicy,
            args.requestPolicy,
          ),
          resolvedPolicy: args.resolvedPolicy
            ?? buildResolvedPromptRuntimePolicy(
              args.sessionPersistentPolicy,
              args.branchPersistentPolicy,
              args.requestPolicy,
            ),
        };
    const warnings = buildPromptRuntimeWarnings(context.effectivePolicy, [
      ...context.sessionPolicyWarnings,
      ...context.branchPolicyWarnings,
    ]);
    const diagnostics = [
      ...buildPromptRuntimeDiagnostics(warnings, {
        branchId: context.scope.targetBranchId,
        phase: args.phase,
      }),
      ...(args.extraDiagnostics ?? []),
    ];
    const trimReasons = this.buildPromptRuntimeTrimReasons({
      prunedByGroup: args.assembled?.tokenUsage.prunedByGroup,
      allocatorTrimReasons: args.assembled?.tokenUsage.allocator?.trimReasons,
    }) ?? [];
    const sourceSelectionTrace = this.buildPromptRuntimeSourceSelectionTrace({
      sourceSelection: context.resolvedPolicy.sourceSelection,
      history: args.history,
      visibilityTrace: args.visibilityTrace,
      memorySummary: args.memorySummary,
      promptSnapshot: args.assembled?.promptSnapshot,
      worldbookHitCount: args.worldbookHitCount,
      budgetByGroup: args.assembled?.tokenUsage.byGroup,
      prunedByGroup: args.assembled?.tokenUsage.prunedByGroup,
    });
    const assets = await new PromptRuntimeControlService(this.db).getAssets(context.scope.sessionId, args.accountId);

    return {
      scope: context.scope,
      assets,
      resolvedPolicy: context.resolvedPolicy,
      sourceMap: buildPromptRuntimeSourceMap({
        sessionPolicy: context.sessionPersistentPolicy,
        branchPolicy: context.branchPersistentPolicy,
        requestPolicy: context.requestPolicy,
        resolvedPolicy: context.resolvedPolicy,
        history: {
          sourceBranchId: context.scope.historySourceBranchId,
          sourceMode: context.scope.historySourceMode,
        },
      }) ?? {},
      diagnostics,
      trimReasons,
      ...(args.historyNormalization ? { historyNormalization: args.historyNormalization } : {}),
      excludedSources: sourceSelectionTrace?.excludedSources ?? [],
      sectionStats: this.buildPromptRuntimeSectionStats(args.assembled?.tokenUsage.bySection),
      limitations: [...PROMPT_RUNTIME_LIMITATIONS],
      ...(args.memoryTrace ? { memory: args.memoryTrace } : {}),
    };
  }

  buildLivePromptDebugArtifacts(args: {
    floorId: string;
    sessionId: string;
    userMessage: string;
    assembled: AssembleResult;
    materialized: MaterializePromptRuntimeMessagesResult;
    inspection: PromptRuntimeInspectionResult;
    visibilityTrace?: PromptVisibilityTrace;
    debugOptions?: { includePromptSnapshot?: boolean; includeRuntimeTrace?: boolean };
  }): PromptLiveDebugArtifacts {
    const execution = buildPromptRuntimeExecutionResult({
      tokenCounter: this.tokenCounter,
      userMessage: args.userMessage,
      floorId: args.floorId,
      sessionId: args.sessionId,
      includeRuntimeTrace: args.debugOptions?.includeRuntimeTrace,
      artifacts: {
        inspection: args.inspection,
        assembled: args.assembled,
        materialized: args.materialized,
        visibilityTrace: args.visibilityTrace,
      },
    });

    return {
      availableForReply: execution.availableForReply ?? 0,
      inspection: args.inspection,
      promptSnapshotRecord: execution.promptSnapshotRecord!,
      ...(args.debugOptions?.includePromptSnapshot && execution.promptSnapshotPreview
        ? { promptSnapshot: execution.promptSnapshotPreview }
        : {}),
      ...(execution.runtimeTrace ? { runtimeTrace: execution.runtimeTrace } : {}),
    };
  }

  materializeTurnPromptMessages(
    messages: ChatMessage[],
    sendDirectives: PromptSendDirectives,
    assistantPrefillStrategy: AssistantPrefillExecutionStrategy,
    structurePolicy?: PromptStructurePolicy,
    deliveryPolicy?: PromptDeliveryPolicy,
  ): MaterializePromptRuntimeMessagesResult {
    return materializePromptRuntimeMessages({
      messages,
      sendDirectives,
      assistantPrefillStrategy,
      structurePolicy,
      deliveryPolicy,
      materializeAssistantPrefillFallback: true,
    });
  }

  private buildCurrentInputEntry(input: PromptRuntimeConversationInput): PromptHistoryMessageEntry {
    return {
      floorId: input.floorId ?? null,
      floorNo: input.floorNo ?? null,
      pageId: input.pageId ?? null,
      pageNo: input.pageNo ?? null,
      messageId: input.messageId ?? null,
      seq: input.seq ?? 1,
      role: "user",
      content: input.content,
      fromCurrentInput: true,
    };
  }

  private buildPromptRuntimeTrimReasons(args: {
    prunedByGroup?: Record<string, number>;
    allocatorTrimReasons?: PromptTrimReason[];
  }): PromptTrimReason[] | undefined {
    if (args.allocatorTrimReasons && args.allocatorTrimReasons.length > 0) {
      return args.allocatorTrimReasons;
    }

    const trimReasons = Object.entries(args.prunedByGroup ?? {})
      .filter(([, prunedTokenCount]) => prunedTokenCount > 0)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([group, prunedTokenCount]) => ({
        group,
        reason: "budget_exceeded" as const,
        prunedTokenCount,
        detail: `Prompt runtime pruned ${prunedTokenCount} tokens from budget group '${resolvePromptRuntimeBudgetGroupTraceLabel(group)}'.`,
      }));

    return trimReasons.length > 0 ? trimReasons : undefined;
  }

  private buildPromptRuntimeSourceSelectionTrace(args: {
    sourceSelection?: PromptSourceSelectionPolicy;
    history: ChatMessage[];
    visibilityTrace?: PromptRuntimeTrace["visibility"];
    memorySummary?: string;
    promptSnapshot?: AssembleResult["promptSnapshot"];
    worldbookHitCount?: number;
    budgetByGroup?: Record<string, number>;
    prunedByGroup?: Record<string, number>;
  }): PromptRuntimeTrace["sourceSelection"] | undefined {
    const excludedSources: PromptSourceExclusionReason[] = [];
    const seen = new Set<string>();
    const pushExcludedSource = (
      source: PromptSourceExclusionReason["source"],
      reason: PromptSourceExclusionReason["reason"],
      detail?: string,
    ) => {
      const key = `${source}:${reason}`;
      if (seen.has(key)) {
        return;
      }

      seen.add(key);
      excludedSources.push({
        source,
        reason,
        ...(detail ? { detail } : {}),
      });
    };

    if (args.sourceSelection?.memory?.enabled === false) {
      pushExcludedSource("memory", "disabled_by_policy", "sourceSelection.memory.enabled=false disables memory summary injection.");
    }

    if (
      args.sourceSelection?.worldbook?.enabled === false
      && args.promptSnapshot
      && hasPromptRuntimeWorldbookSource(args.promptSnapshot)
    ) {
      pushExcludedSource("worldbook", "disabled_by_policy", "sourceSelection.worldbook.enabled=false disabled worldbook injection.");
    } else if (
      args.promptSnapshot
      && hasPromptRuntimeWorldbookSource(args.promptSnapshot)
      && (args.worldbookHitCount ?? 0) === 0
    ) {
      pushExcludedSource("worldbook", "not_triggered", "No worldbook entry matched the current visible prompt context.");
    }

    if (
      args.sourceSelection?.examples?.enabled === false
      && args.promptSnapshot
      && hasPromptRuntimeExamplesSource(args.promptSnapshot)
    ) {
      pushExcludedSource("examples", "disabled_by_policy", "sourceSelection.examples.enabled=false removed example dialogue from prompt assembly.");
    }

    if (args.history.length === 0 && (args.visibilityTrace?.filteredFloorNos?.length ?? 0) > 0) {
      pushExcludedSource(
        "history",
        "visibility_filtered",
        `Visibility filtered ${args.visibilityTrace!.filteredFloorNos!.length} floor(s) from the available history window.`,
      );
    }

    for (const [group, prunedTokenCount] of Object.entries(args.prunedByGroup ?? {})) {
      if (prunedTokenCount <= 0) {
        continue;
      }

      const source = resolvePromptRuntimeBudgetGroupExclusionSource(group);
      if (!source) {
        continue;
      }

      const remainingTokenCount = args.budgetByGroup?.[group] ?? 0;
      if (remainingTokenCount === 0) {
        const groupLabel = resolvePromptRuntimeBudgetGroupTraceLabel(group);
        pushExcludedSource(source, "budget_trimmed", `Budget trimming removed all remaining '${groupLabel}' content from the prompt.`);
      }
    }

    return excludedSources.length > 0 ? { excludedSources } : undefined;
  }

  private buildPromptRuntimeSectionStats(bySection?: Record<string, number>): PromptRuntimeSectionStat[] {
    return Object.entries(bySection ?? {})
      .filter(([, tokenCount]) => Number.isFinite(tokenCount) && tokenCount > 0)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([sectionName, tokenCount]) => ({
        sectionName,
        tokenCount,
      }));
  }
}

function hasPromptRuntimeWorldbookSource(promptSnapshot: AssembleResult["promptSnapshot"]): boolean {
  return promptSnapshot.worldbook !== null || promptSnapshot.character?.characterBook !== undefined;
}

function hasPromptRuntimeExamplesSource(promptSnapshot: AssembleResult["promptSnapshot"]): boolean {
  return typeof promptSnapshot.character?.exampleDialogue === "string"
    && promptSnapshot.character.exampleDialogue.trim().length > 0;
}

function normalizePositiveInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return undefined;
  }
  return value;
}

function resolvePromptRuntimeHistoryMaxTurns(
  sourceSelection?: PromptSourceSelectionPolicy,
): number | undefined {
  const mode = sourceSelection?.history?.mode;
  if (mode === "full") {
    return undefined;
  }

  return normalizePositiveInt(sourceSelection?.history?.maxMessages);
}
