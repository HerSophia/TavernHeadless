import { SessionStateServiceError, type SessionStateService } from "../../session-state/session-state-service.js";
import type { SessionStateOperationLogContext } from "../../session-state/session-state-operation-log.js";

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
    operationLog?: SessionStateOperationLogContext;
  }): void {
    if (!input.writes || input.writes.length === 0) {
      return;
    }

    const sessionStateService = this.sessionStateService;
    if (!sessionStateService) {
      throw this.createError(
        "feature_unavailable",
        "Session state is unavailable because client-data is disabled",
      );
    }

    input.writes.forEach((write, index) => {
      try {
        sessionStateService.stageClientCommitBoundValue({
          accountId: input.accountId,
          sessionId: input.sessionId,
          branchId: input.branchId,
          sourceFloorId: input.floorId,
          namespace: write.namespace,
          slot: write.slot,
          value: write.delete === true ? null : write.value,
          present: write.delete === true ? false : true,
          operationLog: input.operationLog,
          operationIndex: index + 1,
          operationCount: input.writes?.length ?? 0,
        });
      } catch (error) {
        if (error instanceof SessionStateServiceError) {
          throw this.createError(error.code, error.message, error);
        }
        throw error;
      }
    });
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
