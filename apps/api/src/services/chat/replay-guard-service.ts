import type { ExecutedToolCallRecord, ToolReplaySafety } from "@tavern/core";
import { evaluateExecutedToolCallReplaySafety, isAutoReplaySafe } from "@tavern/core";

import type { FirstPartyReplayBlocker } from "../../session-state/session-state-types.js";
import { DrizzleToolExecutionRepository } from "../../adapters/drizzle-tool-execution-repository.js";

import type { ChatServiceErrorFactory } from "./types.js";

export interface ReplayBlockingExecutionDetail {
  execution_id: string;
  tool_name: string;
  provider_id: string;
  provider_type: string | null;
  side_effect_level: string | null;
  status: string;
  lifecycle_state: string | null;
  replay_safety: ToolReplaySafety;
  reason: string;
  error_message?: string;
}

export interface ReplayBlockingSessionStateMutationDetail {
  mutation_id: string;
  state_namespace: string;
  target_slot: string;
  replay_safety: string;
  status: string;
  reason: string;
}

export class ReplayGuardService {
  constructor(
    private readonly toolExecutionRepository: DrizzleToolExecutionRepository,
    private readonly createError: ChatServiceErrorFactory,
    private readonly firstPartyGameStateService?: { evaluateReplayBlockersForFloor(input: { accountId: string; sessionId: string; floorId: string; confirmedMutationIds?: string[] }): { allowed: boolean; blockers: FirstPartyReplayBlocker[] } } | null,
  ) {}

  async assertRetryReplayConfirmed(input: {
    floorId: string;
    sessionId: string;
    accountId: string;
    request: { confirmedSessionStateMutationIds?: string[]; confirmedExecutionIds?: string[] };
  }): Promise<void> {
    await this.assertReplayConfirmedForFloor({
      floorId: input.floorId,
      sessionId: input.sessionId,
      accountId: input.accountId,
      confirmedExecutionIds: input.request.confirmedExecutionIds,
      confirmedSessionStateMutationIds: input.request.confirmedSessionStateMutationIds,
      actionLabel: "Retry",
    });
  }

  async assertReplayConfirmedForFloor(input: {
    floorId: string;
    sessionId: string;
    accountId: string;
    confirmedExecutionIds?: string[];
    confirmedSessionStateMutationIds?: string[];
    actionLabel: string;
  }): Promise<void> {
    const blockingExecutions = await this.listReplayBlockingExecutionsForFloor(input.floorId);
    const confirmedExecutionIds = new Set(input.confirmedExecutionIds ?? []);
    const missingExecutionConfirmations = blockingExecutions.filter(
      (execution) => !confirmedExecutionIds.has(execution.execution_id),
    );

    const sessionStateEvaluation = this.firstPartyGameStateService?.evaluateReplayBlockersForFloor({
      accountId: input.accountId,
      sessionId: input.sessionId,
      floorId: input.floorId,
      confirmedMutationIds: input.confirmedSessionStateMutationIds,
    }) ?? { allowed: true, blockers: [] };
    const blockingSessionStateMutations = sessionStateEvaluation.blockers.map((blocker) =>
      this.toReplayBlockingSessionStateMutationDetail(blocker),
    );
    const hardSessionStateBlockers = blockingSessionStateMutations.filter(
      (blocker) => blocker.reason !== "confirmation_required",
    );
    const missingSessionStateConfirmations = blockingSessionStateMutations.filter(
      (blocker) => blocker.reason === "confirmation_required",
    );

    if (hardSessionStateBlockers.length > 0) {
      throw this.createError(
        "session_state_replay_blocked",
        `${input.actionLabel} is blocked by ${hardSessionStateBlockers.length} prior session-state mutation(s).`,
        undefined,
        {
          ...(blockingExecutions.length > 0 ? { blocking_executions: blockingExecutions } : {}),
          blocking_session_state_mutations: blockingSessionStateMutations,
        },
      );
    }

    if (missingExecutionConfirmations.length === 0 && missingSessionStateConfirmations.length === 0) {
      return;
    }

    if (missingExecutionConfirmations.length > 0 && missingSessionStateConfirmations.length === 0) {
      throw this.createError(
        "tool_replay_confirmation_required",
        `${input.actionLabel} requires explicit confirmation for ${missingExecutionConfirmations.length} prior tool execution(s).`,
        undefined,
        { blocking_executions: blockingExecutions },
      );
    }

    if (missingExecutionConfirmations.length === 0) {
      throw this.createError(
        "session_state_replay_confirmation_required",
        `${input.actionLabel} requires explicit confirmation for ${missingSessionStateConfirmations.length} prior session-state mutation(s).`,
        undefined,
        { blocking_session_state_mutations: blockingSessionStateMutations },
      );
    }

    throw this.createError(
      "replay_confirmation_required",
      `${input.actionLabel} requires explicit confirmation for ${missingExecutionConfirmations.length} prior tool execution(s) and ${missingSessionStateConfirmations.length} session-state mutation(s).`,
      undefined,
      {
        blocking_executions: blockingExecutions,
        blocking_session_state_mutations: blockingSessionStateMutations,
      },
    );
  }

  async listReplayBlockingExecutionsForFloor(
    floorId: string,
  ): Promise<ReplayBlockingExecutionDetail[]> {
    const executionRecords = await this.toolExecutionRepository.findByFloorId(floorId);
    return executionRecords
      .map((record) => this.toReplayBlockingExecutionDetail(record))
      .filter((record): record is ReplayBlockingExecutionDetail => record !== null);
  }

  private toReplayBlockingExecutionDetail(
    record: ExecutedToolCallRecord,
  ): ReplayBlockingExecutionDetail | null {
    const evaluation = evaluateExecutedToolCallReplaySafety(record);
    if (isAutoReplaySafe(evaluation.replaySafety)) {
      return null;
    }

    return {
      execution_id: record.id,
      tool_name: record.toolName,
      provider_id: record.providerId,
      provider_type: record.providerType ?? null,
      side_effect_level: record.sideEffectLevel ?? null,
      status: record.status,
      lifecycle_state: record.lifecycleState ?? null,
      replay_safety: evaluation.replaySafety,
      reason: evaluation.reason,
      ...(record.errorMessage ? { error_message: record.errorMessage } : {}),
    };
  }

  private toReplayBlockingSessionStateMutationDetail(
    blocker: FirstPartyReplayBlocker,
  ): ReplayBlockingSessionStateMutationDetail {
    return {
      mutation_id: blocker.mutationId,
      state_namespace: blocker.stateNamespace,
      target_slot: blocker.targetSlot,
      replay_safety: blocker.replaySafety,
      status: blocker.status,
      reason: blocker.reason,
    };
  }
}
