import type { FirstPartySceneContext, FirstPartyWorldContext } from "../../../session-state/session-state-types.js";

import type { EffectiveConversationTurn } from "../conversation-history-normalizer.js";
import type { FirstPartyStateContext } from "../types.js";
import { asJsonRecord, parseJsonRecord } from "./json.js";

export interface FloorConversationInputSnapshot {
  mode: "single_input_page" | "merged_user_tail";
  effectiveText: string;
  sourceFloorIds: string[];
  sourcePageIds: string[];
  sourceMessageIds: string[];
  floorRange: { start: number; end: number } | null;
  includesCurrentInput: boolean;
  currentInputPageId: string | null;
  currentInputMessageId: string | null;
}

export function buildFloorMetadataJson(
  userId: string | null,
  userSnapshotJson: string | null,
  replacedAt: number,
  userInputRaw?: string,
): string | null {
  const snapshotSummary = parseUserSnapshotSummary(userSnapshotJson);
  if (!userId && !snapshotSummary && typeof userInputRaw !== "string") {
    return null;
  }

  return JSON.stringify({
    ...(typeof userInputRaw === "string" ? { user_input_raw: userInputRaw } : {}),
    user_binding: {
      user_id: userId,
      snapshot_summary: snapshotSummary,
      replaced_at: replacedAt,
    },
  });
}

export function buildConversationInputSnapshot(args: {
  effectiveText: string;
  sourceTurn: Pick<EffectiveConversationTurn, "sourceFloorIds" | "sourcePageIds" | "sourceMessageIds" | "floorRange" | "includesCurrentInput" | "entryCount">;
  currentInputPageId?: string | null;
  currentInputMessageId?: string | null;
}): FloorConversationInputSnapshot {
  const isSingleInputPage = args.sourceTurn.includesCurrentInput
    && args.sourceTurn.entryCount === 1
    && args.sourceTurn.sourceFloorIds.length <= 1
    && args.sourceTurn.sourcePageIds.length <= 1
    && args.sourceTurn.sourceMessageIds.length <= 1;

  return {
    mode: isSingleInputPage ? "single_input_page" : "merged_user_tail",
    effectiveText: args.effectiveText,
    sourceFloorIds: [...args.sourceTurn.sourceFloorIds],
    sourcePageIds: [...args.sourceTurn.sourcePageIds],
    sourceMessageIds: [...args.sourceTurn.sourceMessageIds],
    floorRange: args.sourceTurn.floorRange
      ? {
          start: args.sourceTurn.floorRange.start,
          end: args.sourceTurn.floorRange.end,
        }
      : null,
    includesCurrentInput: args.sourceTurn.includesCurrentInput,
    currentInputPageId: args.currentInputPageId ?? null,
    currentInputMessageId: args.currentInputMessageId ?? null,
  };
}

export function mergeFloorMetadataConversationInput(
  metadataJson: string | null,
  snapshot?: FloorConversationInputSnapshot,
): string | null {
  if (!snapshot) {
    return metadataJson;
  }

  const parsed = parseJsonRecord(metadataJson);
  const baseRecord = parsed ?? {};

  return JSON.stringify({
    ...baseRecord,
    conversation_input: toConversationInputJson(snapshot),
  });
}

export function readFloorConversationInputSnapshot(
  metadataJson: string | null,
): FloorConversationInputSnapshot | null {
  const parsed = parseJsonRecord(metadataJson);
  if (metadataJson !== null && parsed === null) {
    return null;
  }

  const conversationInput = asJsonRecord((parsed ?? {}).conversation_input);
  if (!conversationInput) {
    return null;
  }

  return fromConversationInputJson(conversationInput);
}

export function parseUserSnapshotSummary(userSnapshotJson: string | null): { name: string } | null {
  if (!userSnapshotJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(userSnapshotJson) as Record<string, unknown>;
    const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
    return name ? { name } : null;
  } catch {
    return null;
  }
}

export function mergeSessionMetadataWithFirstPartyState(
  metadataJson: string | null,
  firstPartyStateContext?: FirstPartyStateContext,
): string | null {
  const scene = firstPartyStateContext?.scene;
  const world = firstPartyStateContext?.world;
  if (!scene && !world) {
    return metadataJson;
  }

  const parsed = parseJsonRecord(metadataJson);
  if (metadataJson !== null && parsed === null) {
    return metadataJson;
  }

  const nextMetadata = parsed ?? {};
  const currentFirstPartyState = asJsonRecord(nextMetadata.first_party_state) ?? {};
  return JSON.stringify({
    ...nextMetadata,
    first_party_state: {
      ...currentFirstPartyState,
      ...(scene ? { scene: buildManagedSceneMetadata(scene) } : {}),
      ...(world ? { world: buildManagedWorldMetadata(world) } : {}),
    },
  });
}

export function buildManagedSceneMetadata(scene: FirstPartySceneContext): Record<string, unknown> {
  return {
    namespace: scene.namespace,
    slot: scene.slot,
    resolution_mode: scene.resolutionMode,
    source: scene.source,
    present: scene.present,
    schema_version: scene.schemaVersion,
    floor_id: scene.floorId,
    updated_at: scene.updatedAt,
    source_mutation_ids: [...scene.sourceMutationIds],
  };
}

export function buildManagedWorldMetadata(world: FirstPartyWorldContext): Record<string, unknown> {
  return {
    namespace: world.namespace,
    slot: world.slot,
    resolution_mode: world.resolutionMode,
    source: world.source,
    present: world.present,
    schema_version: world.schemaVersion,
    floor_id: world.floorId,
    updated_at: world.updatedAt,
    source_mutation_ids: [...world.sourceMutationIds],
    worldbook_id: world.world?.worldbookId ?? null,
    worldbook_version: world.world?.worldbookVersion ?? null,
    activated_worldbook_entry_uids: [...(world.world?.activatedWorldbookEntryUids ?? [])],
    summary_line_count: world.world?.summaryLines.length ?? 0,
    tool_execution_count: world.world?.toolExecutionIds.length ?? 0,
  };
}

function toConversationInputJson(snapshot: FloorConversationInputSnapshot): Record<string, unknown> {
  return {
    mode: snapshot.mode,
    effective_text: snapshot.effectiveText,
    source_floor_ids: [...snapshot.sourceFloorIds],
    source_page_ids: [...snapshot.sourcePageIds],
    source_message_ids: [...snapshot.sourceMessageIds],
    floor_range: snapshot.floorRange
      ? {
          start: snapshot.floorRange.start,
          end: snapshot.floorRange.end,
        }
      : null,
    includes_current_input: snapshot.includesCurrentInput,
    current_input_page_id: snapshot.currentInputPageId,
    current_input_message_id: snapshot.currentInputMessageId,
  };
}

function fromConversationInputJson(
  value: Record<string, unknown>,
): FloorConversationInputSnapshot | null {
  const mode = value.mode;
  if (mode !== "single_input_page" && mode !== "merged_user_tail") {
    return null;
  }

  const effectiveText = typeof value.effective_text === "string"
    ? value.effective_text
    : null;
  if (effectiveText === null) {
    return null;
  }

  return {
    mode,
    effectiveText,
    sourceFloorIds: readStringArray(value.source_floor_ids),
    sourcePageIds: readStringArray(value.source_page_ids),
    sourceMessageIds: readStringArray(value.source_message_ids),
    floorRange: readFloorRange(value.floor_range),
    includesCurrentInput: value.includes_current_input === true,
    currentInputPageId: typeof value.current_input_page_id === "string" ? value.current_input_page_id : null,
    currentInputMessageId: typeof value.current_input_message_id === "string" ? value.current_input_message_id : null,
  };
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function readFloorRange(value: unknown): { start: number; end: number } | null {
  const record = asJsonRecord(value);
  if (!record) {
    return null;
  }

  const start = record.start;
  const end = record.end;
  if (typeof start !== "number" || !Number.isInteger(start) || typeof end !== "number" || !Number.isInteger(end)) {
    return null;
  }

  return { start, end };
}
