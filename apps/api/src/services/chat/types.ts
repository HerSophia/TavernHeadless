import type {
  ChatMessage,
  FloorRunType,
  GenerationParams,
  TurnConfig,
  TurnInput,
} from "@tavern/core";
import type {
  AssembleResult,
  MaterializePromptRuntimeMessagesResult,
  PromptRuntimeTrace,
  PromptSnapshotPreview,
} from "../prompt-assembler.js";
import type { PromptVisibilityTrace } from "../chat-history-loader.js";
import type { PromptRuntimeExecutionResult, PromptRuntimeResolvedContext } from "../prompt-runtime-execution.js";
import type { PromptRuntimeInspectionResult } from "../prompt-runtime-control-service.js";
import type { FirstPartySceneContext, FirstPartyWorldContext } from "../../session-state/session-state-types.js";
import type { ResolvedTurnModels } from "./contracts.js";

export type ChatWorkflowMode =
  | "respond"
  | "regenerate"
  | "retry_floor"
  | "edit_and_regenerate"
  | "generate_for_floor";

export type PreparedPromptArtifactsMode =
  | ChatWorkflowMode
  | "inspect";

export type ChatServiceErrorFactory = (
  code: string,
  message: string,
  cause?: unknown,
  details?: unknown,
) => Error;

export interface ResolvedRespondBranchContext {
  branchExists: boolean;
  historySourceBranchId: string;
  historySourceMode: "existing_branch" | "source_floor_branch" | "main_fallback";
  nextFloorNo: number;
  parentFloorId: string | null;
  inheritanceSource?: { floorId: string; branchId: string };
}

export interface RegenerationTargetFloor {
  id: string;
  sessionId: string;
  floorNo: number;
  branchId: string;
  parentFloorId: string | null;
  state: "draft" | "generating" | "committed" | "failed";
}

export interface RetryTargetFloor {
  id: string;
  sessionId: string;
  floorNo: number;
  branchId: string;
  parentFloorId: string | null;
  state: "draft" | "generating" | "committed" | "failed";
}

export interface EditableMessageTarget {
  messageId: string;
  floorId: string;
  floorNo: number;
  branchId: string;
  sessionId: string;
}

export interface FirstPartyStateContext {
  scene: FirstPartySceneContext | null;
  world: FirstPartyWorldContext | null;
}

export interface PreparedTurnPromptDebugArtifacts {
  availableForReply: number;
  inspection: PromptRuntimeInspectionResult;
  promptSnapshotRecord: NonNullable<PromptRuntimeExecutionResult["promptSnapshotRecord"]>;
  promptSnapshot?: PromptSnapshotPreview;
  runtimeTrace?: PromptRuntimeTrace;
}

export interface PreparedPromptArtifacts {
  mode: PreparedPromptArtifactsMode;
  runType: FloorRunType | "inspect";
  sessionId: string;
  branchId?: string;
  accountId: string;
  userMessage: string;
  rawUserMessage: string;
  executionContext: PromptRuntimeResolvedContext;
  history: ChatMessage[];
  visibilityTrace?: PromptVisibilityTrace;
  memorySummary?: string;
  resolvedTurnModels: ResolvedTurnModels;
  assembled: AssembleResult;
  materialized: MaterializePromptRuntimeMessagesResult;
  inspection: PromptRuntimeInspectionResult;
  tokenEstimate: number;
  availableForReply: number;
  preprocessedUserMessage?: string;
  promptSnapshot?: PromptSnapshotPreview;
  promptSnapshotRecord?: NonNullable<PromptRuntimeExecutionResult["promptSnapshotRecord"]>;
  runtimeTrace?: PromptRuntimeTrace;
  generationParams: GenerationParams;
  requestedTurnConfig?: TurnConfig;
  turnConfig?: TurnConfig;
}

export interface PreparedTurnContext {
  mode: ChatWorkflowMode;
  runType: FloorRunType;
  sessionId: string;
  branchId?: string;
  floorId: string;
  pageId: string;
  accountId: string;
  userMessage: string;
  executionContext: PromptRuntimeResolvedContext;
  history: ChatMessage[];
  visibilityTrace?: PromptVisibilityTrace;
  memorySummary?: string;
  resolvedTurnModels: ResolvedTurnModels;
  assembled: AssembleResult;
  materialized: MaterializePromptRuntimeMessagesResult;
  inspection: PromptRuntimeInspectionResult;
  promptDebug: PreparedTurnPromptDebugArtifacts;
  generationParams: GenerationParams;
  requestedTurnConfig?: TurnConfig;
  turnConfig?: TurnConfig;
  memoryConsolidationRequested: boolean;
  turnInput: TurnInput;
}
