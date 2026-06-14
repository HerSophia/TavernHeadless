import { nanoid } from "nanoid";
import type { FloorRunType } from "@tavern/core";

import type { TurnAttemptIdentity, TurnAttemptMode, TurnReplayMode } from "./turn-attempt-types.js";

export interface CreateTurnAttemptIdentityInput {
  sessionId: string;
  branchId?: string;
  floorId: string;
  runId: string;
  runType: FloorRunType;
  attemptNo?: number;
  replayMode?: TurnReplayMode;
  inputPageId?: string;
  sourceFloorId?: string;
  sourceOutputPageId?: string;
  candidateOutputPageId?: string;
  candidateAssistantMessageId?: string;
}

/**
 * R2 的 attempt 协调器。
 *
 * 当前阶段只负责生成内部 identity 与默认 replay mode，不写数据库。
 */
export class TurnAttemptCoordinator {
  createIdentity(input: CreateTurnAttemptIdentityInput): TurnAttemptIdentity {
    const candidate = createCandidateRefs(input);
    return {
      sessionId: input.sessionId,
      branchId: input.branchId ?? "main",
      floorId: input.floorId,
      runId: input.runId,
      runType: input.runType,
      attemptNo: input.attemptNo ?? 1,
      replayMode: input.replayMode ?? resolveReplayModeForRunType(input.runType),
      ...(input.inputPageId ? { inputPageId: input.inputPageId } : {}),
      ...(input.sourceFloorId ? { sourceFloorId: input.sourceFloorId } : {}),
      ...(input.sourceOutputPageId ? { sourceOutputPageId: input.sourceOutputPageId } : {}),
      candidateOutputPageId: candidate.pageId,
      candidateAssistantMessageId: candidate.messageId,
    };
  }
}

export function resolveReplayModeForMode(mode: TurnAttemptMode): TurnReplayMode {
  switch (mode) {
    case "retry_floor":
      return "with_context_refresh";
    case "respond":
    case "regenerate":
    case "edit_and_regenerate":
      return "full_floor_context";
  }
}

export function resolveReplayModeForRunType(runType: FloorRunType): TurnReplayMode {
  switch (runType) {
    case "retry_turn":
      return "with_context_refresh";
    case "respond":
    case "regenerate_page":
    case "edit_and_regenerate":
      return "full_floor_context";
  }
}

export function modeFromRunType(runType: FloorRunType): TurnAttemptMode {
  switch (runType) {
    case "respond":
      return "respond";
    case "regenerate_page":
      return "regenerate";
    case "retry_turn":
      return "retry_floor";
    case "edit_and_regenerate":
      return "edit_and_regenerate";
  }
}

function createCandidateRefs(input: Pick<CreateTurnAttemptIdentityInput, "candidateOutputPageId" | "candidateAssistantMessageId">): {
  pageId: string;
  messageId: string;
} {
  return {
    pageId: input.candidateOutputPageId ?? nanoid(),
    messageId: input.candidateAssistantMessageId ?? nanoid(),
  };
}
