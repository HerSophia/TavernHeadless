import type { FirstPartySceneContext, FirstPartyWorldContext } from "../../../session-state/session-state-types.js";

import type { FirstPartyStateContext } from "../types.js";
import { asJsonRecord, parseJsonRecord } from "./json.js";

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
