import type { TurnExecutionResult, TurnInput, FloorRunType } from "@tavern/core";

import type { PromptRuntimeInspectionResult } from "../prompt-runtime-control-service.js";
import type { PromptRuntimeExecutionResult } from "../prompt-runtime-execution.js";
import type { StMacroStagedMutation } from "../st-macros/index.js";
import type { TurnCommitOperationLogContext, TurnCommitService } from "../turn-commit-service.js";
import type { FloorConversationInputSnapshot } from "./shared/metadata.js";
import type { ResolvedTurnModels, TurnSessionStateWriteRequest } from "./contracts.js";
import type { SessionStateOperationLogContext } from "../../session-state/session-state-operation-log.js";

export interface ExecuteTurnAndCommitArgs {
  floorId: string;
  sessionId: string;
  branchId?: string;
  accountId: string;
  turnInput: TurnInput;
  promptSnapshot?: NonNullable<PromptRuntimeExecutionResult["promptSnapshotRecord"]>;
  promptRuntimeInspection?: PromptRuntimeInspectionResult;
  macroStagedMutations?: StMacroStagedMutation[];
  sessionStateWrites?: TurnSessionStateWriteRequest[];
  sessionStateOperationLog?: SessionStateOperationLogContext;
  resolvedTurnModels: ResolvedTurnModels;
  turnOperationLog?: TurnCommitOperationLogContext;
  orchestrationFailureCode: string;
  orchestrationFailureMessage: string;
  persistMemory: boolean;
  runType: FloorRunType;
  memoryConsolidationRequested: boolean;
  commitFailureMessage: string;
  conversationInputSnapshot?: FloorConversationInputSnapshot;
  supersedeSourceFloor?: { floorId: string };
}

export type ExecuteTurnAndCommitResult = {
  execution: TurnExecutionResult;
  commit: Awaited<ReturnType<TurnCommitService["commit"]>>;
};

export class TurnExecutionFacade {
  constructor(
    private readonly executeTurnAndCommitImpl: (args: ExecuteTurnAndCommitArgs) => Promise<ExecuteTurnAndCommitResult>,
  ) {}

  async executeTurnAndCommit(args: ExecuteTurnAndCommitArgs): Promise<ExecuteTurnAndCommitResult> {
    return this.executeTurnAndCommitImpl(args);
  }
}
