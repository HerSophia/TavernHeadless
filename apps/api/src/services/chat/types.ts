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
import type { SessionBranchAssetBindingState } from "../variables/host/session-branch-registry-service.js";
import type { PromptRuntimeHistoryNormalizationSummary } from "./conversation-history-normalizer.js";
import type { FloorConversationInputSnapshot } from "./shared/metadata.js";
import type { PromptMode } from "../prompt-assembler.js";

export type ChatWorkflowMode =
  | "respond"
  | "regenerate"
  | "retry_floor"
  | "edit_and_regenerate"
  | "generate_for_floor";

export type PreparedPromptArtifactsMode =
  | ChatWorkflowMode
  | "dry_run"
  | "inspect";

export type TurnRuntimePhase =
  | "floor_prepare"
  | "pre_response"
  | "response"
  | "post_response"
  | "commit";

export type PromptRuntimePreparePhase =
  | "conversation_resolve"
  | "source_resolve"
  | "pre_response"
  | "assemble"
  | "materialize"
  | "inspect";

export type PromptRuntimeContributorKind =
  | "memory_projection"
  | "state_projection"
  | "director_hint"
  | "agency_guard"
  | "scene_state"
  | "worldbook_focus"
  | "memory_selection"
  | "verifier_hint";

export interface PromptRuntimeContributorRenderable {
  title: string;
  content: string;
}

export interface PromptRuntimeContributorOutput {
  id: string;
  kind: PromptRuntimeContributorKind;
  sourceKind: string;
  modeScope: "compat_plus" | "native";
  payload: unknown;
  promptRenderable?: PromptRuntimeContributorRenderable;
  trace: {
    deterministic: boolean;
    cacheScope: "floor" | "page" | "none";
  };
}

export interface PromptRuntimeContributorView {
  id: string;
  kind: PromptRuntimeContributorKind;
  sourceKind: string;
  modeScope: "compat_plus" | "native";
  promptRenderable?: PromptRuntimeContributorRenderable;
  deterministic: boolean;
  cacheScope: "floor" | "page" | "none";
}

export interface PreparedPromptArtifactsPhaseTraceEntry {
  phase: PromptRuntimePreparePhase;
  detail?: Record<string, unknown>;
}

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
  assetBinding?: SessionBranchAssetBindingState | null;
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
  runType: FloorRunType | "inspect" | "dry_run";
  sessionId: string;
  branchId?: string;
  accountId: string;
  promptMode: PromptMode;
  userMessage: string;
  rawUserMessage: string;
  executionContext: PromptRuntimeResolvedContext;
  conversation: import("./prompt-preparation-service.js").PromptRuntimeConversationWindow;
  history: ChatMessage[];
  visibilityTrace?: PromptVisibilityTrace;
  memorySummary?: string;
  memoryTrace?: PromptRuntimeTrace["memory"];
  contributors: PromptRuntimeContributorOutput[];
  resolvedTurnModels: ResolvedTurnModels;
  assembled: AssembleResult;
  materialized: MaterializePromptRuntimeMessagesResult;
  conversationInputSnapshot?: FloorConversationInputSnapshot;
  historyNormalization?: PromptRuntimeHistoryNormalizationSummary;
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
  preparePhaseTrace: PreparedPromptArtifactsPhaseTraceEntry[];
}

export interface PreparedTurnContext {
  mode: ChatWorkflowMode;
  runType: FloorRunType;
  sessionId: string;
  branchId?: string;
  floorId: string;
  pageId?: string;
  accountId: string;
  userMessage: string;
  executionContext: PromptRuntimeResolvedContext;
  history: ChatMessage[];
  visibilityTrace?: PromptVisibilityTrace;
  memorySummary?: string;
  resolvedTurnModels: ResolvedTurnModels;
  assembled: AssembleResult;
  materialized: MaterializePromptRuntimeMessagesResult;
  conversationInputSnapshot?: FloorConversationInputSnapshot;
  historyNormalization?: PromptRuntimeHistoryNormalizationSummary;
  inspection: PromptRuntimeInspectionResult;
  promptDebug: PreparedTurnPromptDebugArtifacts;
  generationParams: GenerationParams;
  requestedTurnConfig?: TurnConfig;
  turnConfig?: TurnConfig;
  memoryConsolidationRequested: boolean;
  turnInput: TurnInput;
}
