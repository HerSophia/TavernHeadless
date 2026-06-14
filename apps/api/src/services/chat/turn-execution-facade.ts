import type { TurnExecutionResult, TurnInput, FloorRunType } from "@tavern/core";

import type { PromptRuntimeInspectionResult } from "../prompt-runtime-control-service.js";
import type { PromptRuntimeExecutionResult } from "../prompt-runtime-execution.js";
import type { StMacroStagedMutation } from "../st-macros/index.js";
import type { TurnCommitOperationLogContext, TurnCommitService } from "../turn-commit-service.js";
import type { CommitGateDecision } from "./turn-commit-gate.js";
import type { TurnProposalEnvelope } from "./turn-proposal-envelope.js";
import type {
  AggregatedPreResponseContext,
  AgentRunRecord,
  AgentRuntimeTrace,
} from "../agent-runtime/inline-agent-types.js";
import type { PersistedMessageRef } from "../chat-message-persistence.js";
import type { FloorConversationInputSnapshot } from "./shared/metadata.js";
import type { ResolvedTurnModels, TurnSessionStateWriteRequest } from "./contracts.js";
import type { SessionStateOperationLogContext } from "../../session-state/session-state-operation-log.js";
import type { TurnAttemptIdentity } from "./turn-attempt-types.js";
import type { FirstPartyStateContext } from "./types.js";

export type ChatTurnStrategyKind = "naive" | "inline_mvp";

export interface InlineMvpExecutionContext {
  preResponse?: {
    aggregated: AggregatedPreResponseContext;
    records: AgentRunRecord[];
  };
  firstPartyStateContext?: FirstPartyStateContext;
  abortSignal?: AbortSignal;
  attempt?: TurnAttemptIdentity;
  attachTrace?: (trace: AgentRuntimeTrace) => void;
  notifyTrace?: (trace: AgentRuntimeTrace) => void;
}

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
  attempt?: TurnAttemptIdentity;
  turnStrategy?: ChatTurnStrategyKind;
  inlineMvp?: InlineMvpExecutionContext;
}

export interface ExecuteNarratorTurnResult {
  execution: TurnExecutionResult;
  turnInput: TurnInput;
  toolExecutionRunId: string;
}

export interface CommitNarratorTurnArgs {
  floorId: string;
  sessionId: string;
  branchId?: string;
  accountId: string;
  turnInput: TurnInput;
  execution: TurnExecutionResult;
  toolExecutionRunId: string;
  promptSnapshot?: NonNullable<PromptRuntimeExecutionResult["promptSnapshotRecord"]>;
  promptRuntimeInspection?: PromptRuntimeInspectionResult;
  macroStagedMutations?: StMacroStagedMutation[];
  sessionStateWrites?: TurnSessionStateWriteRequest[];
  sessionStateOperationLog?: SessionStateOperationLogContext;
  turnOperationLog?: TurnCommitOperationLogContext;
  resolvedTurnModels: ResolvedTurnModels;
  persistMemory: boolean;
  runType: FloorRunType;
  memoryConsolidationRequested: boolean;
  commitFailureMessage: string;
  conversationInputSnapshot?: FloorConversationInputSnapshot;
  supersedeSourceFloor?: { floorId: string };
  assistantMessageRef?: PersistedMessageRef;
  attempt?: TurnAttemptIdentity;
  proposalEnvelope?: TurnProposalEnvelope;
  commitGateDecision?: CommitGateDecision;
}

export type CommitNarratorTurnResult = Awaited<ReturnType<TurnCommitService["commit"]>>;

export type ExecuteTurnAndCommitResult = {
  execution: TurnExecutionResult;
  commit: CommitNarratorTurnResult;
  agentRuntimeTrace?: AgentRuntimeTrace;
};

export class TurnExecutionFacade {
  constructor(
    private readonly executeTurnAndCommitImpl: (args: ExecuteTurnAndCommitArgs) => Promise<ExecuteTurnAndCommitResult>,
  ) {}

  async executeTurnAndCommit(args: ExecuteTurnAndCommitArgs): Promise<ExecuteTurnAndCommitResult> {
    return this.executeTurnAndCommitImpl(args);
  }
}
