import { SessionStateServiceError, type SessionStateService } from "../../session-state/session-state-service.js";

import type { TurnSessionStateWriteRequest } from "./contracts.js";
import type { ChatServiceErrorFactory } from "./types.js";

export class TurnSessionStateService {
  constructor(
    private readonly sessionStateService: SessionStateService | undefined,
    private readonly createError: ChatServiceErrorFactory,
  ) {}

  assertTurnSessionStateWritesAvailable(writes?: TurnSessionStateWriteRequest[]): void {
    if (!writes || writes.length === 0) {
      return;
    }

    if (!this.sessionStateService) {
      throw this.createError(
        "feature_unavailable",
        "Session state is unavailable because client-data is disabled",
      );
    }
  }

  stageTurnBoundSessionStateWrites(input: {
    accountId: string;
    sessionId: string;
    branchId: string;
    floorId: string;
    writes?: TurnSessionStateWriteRequest[];
  }): void {
    if (!input.writes || input.writes.length === 0) {
      return;
    }

    if (!this.sessionStateService) {
      throw this.createError(
        "feature_unavailable",
        "Session state is unavailable because client-data is disabled",
      );
    }

    for (const write of input.writes) {
      try {
        this.sessionStateService.stageClientCommitBoundValue({
          accountId: input.accountId,
          sessionId: input.sessionId,
          branchId: input.branchId,
          sourceFloorId: input.floorId,
          namespace: write.namespace,
          slot: write.slot,
          value: write.delete === true ? null : write.value,
          present: write.delete === true ? false : true,
        });
      } catch (error) {
        if (error instanceof SessionStateServiceError) {
          throw this.createError(error.code, error.message, error);
        }
        throw error;
      }
    }
  }

  discardStagedSessionStateBestEffort(
    accountId: string,
    sessionId: string,
    floorId: string,
    reason: string,
  ): void {
    if (!this.sessionStateService) {
      return;
    }

    try {
      this.sessionStateService.discardStagedMutationsForFloor({
        accountId,
        sessionId,
        floorId,
        reason,
      });
    } catch {
      // best-effort discard on failed commit paths
    }
  }
}
