import type { FloorRunType } from "@tavern/core";

import type { StageFirstPartySceneStateInput } from "./session-state-types.js";
import { SESSION_STATE_NAMESPACE_GAME_STATE } from "./session-state-types.js";
import { SessionStateService } from "./session-state-service.js";
import { FIRST_PARTY_SCENE_STATE_WRITER_SCHEMA_VERSION } from "./first-party-game-state-service.js";

export class FirstPartyGameStateConsumer {
  constructor(private readonly sessionStateService: SessionStateService) {}

  stageSceneState(input: StageFirstPartySceneStateInput) {
    return this.sessionStateService.stageCommitBoundValue({
      accountId: input.accountId,
      sessionId: input.sessionId,
      branchId: input.branchId,
      sourceFloorId: input.floorId,
      namespace: SESSION_STATE_NAMESPACE_GAME_STATE,
      slot: "scene",
      value: this.buildSceneStateValue(input),
      replaySafety: "safe",
      requestId: input.requestId ?? null,
      runId: buildFirstPartySceneRunId(input.floorId, input.runType),
    });
  }

  private buildSceneStateValue(input: StageFirstPartySceneStateInput) {
    return {
      kind: "first_party_scene_state",
      schemaVersion: FIRST_PARTY_SCENE_STATE_WRITER_SCHEMA_VERSION,
      sessionId: input.sessionId,
      branchId: input.branchId,
      floorId: input.floorId,
      runType: input.runType,
      generatedText: input.execution.generatedText,
      summaries: [...input.execution.summaries],
      usage: input.execution.totalUsage,
      toolExecutionIds: (input.execution.toolExecutionRecords ?? []).map((record) => record.id),
      updatedAt: input.stagedAt ?? Date.now(),
    };
  }
}

function buildFirstPartySceneRunId(floorId: string, runType: FloorRunType): string {
  return `first-party-scene:${runType}:${floorId}`;
}
