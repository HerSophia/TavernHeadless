import type {
  ChatMessage,
  CoreEventBus,
  FloorRunSnapshot,
  GenerationParams,
  InstanceSlot,
  MemoryInjectionOptions,
  MemoryStore,
  ModelConfig,
  ProviderType,
  ToolPermissions,
  ToolReplaySafety,
  TurnConfig,
  TurnExecutionResult,
  PromptRunIntent,
  ToolRegistry,
} from "@tavern/core";

import type { EffectiveToolPolicyResolution } from "../tooling/shared/tool-policy-resolution.js";
import type { PromptVisibilityPolicy } from "../chat-history-loader.js";
import type {
  PromptAssemblyCompat,
  PromptBudgetPolicy,
  PromptDeliveryPolicy,
  PromptRuntimeTrace,
  PromptSourceSelectionPolicy,
  PromptStructurePolicy,
  PromptSnapshotPreview,
} from "../prompt-assembler.js";
import type {
  PromptRuntimeDiagnostic,
  PromptRuntimeScopeRef,
  PromptRuntimeSourceMap,
  ResolvedPromptRuntimePolicy,
} from "../prompt-runtime-control-service.js";
import type { PromptRuntimePreviewTrace } from "../prompt-runtime-execution.js";
import type {
  TurnCommitMemoryReceipt,
  TurnCommitOperationLogContext,
  TurnCommitService,
} from "../turn-commit-service.js";
import type { FloorRunService } from "../floor-run-service.js";
import type { ProjectEventLiveHub } from "../project-event-live-hub.js";
import type {
  CoordinatorRuntime,
  GenerationCoordinator,
  GenerationExecutionMode,
  GenerationGuardService,
} from "../generation-guard-service.js";
import type { SessionToolRegistryService } from "../session-tool-registry-service.js";
import type { ToolRuntimeJobBridge } from "../tool-runtime-job-bridge.js";
import type { AccountContextOptions } from "../../accounts/account-context.js";
import type { FirstPartyGameStateService } from "../../session-state/first-party-game-state-service.js";
import type { SessionStateNamespace } from "../../session-state/session-state-types.js";
import type { SessionStateService } from "../../session-state/session-state-service.js";
import type { SessionStateOperationLogContext } from "../../session-state/session-state-operation-log.js";

export interface PromptLiveDebugOptions {
  includePromptSnapshot?: boolean;
  includeRuntimeTrace?: boolean;
  includeWorldbookMatches?: boolean;
}

export interface TurnSessionStateWriteRequest {
  namespace: SessionStateNamespace;
  slot: string;
  value?: unknown;
  delete?: boolean;
}

interface TurnOperationLogRequest {
  turnOperationLog?: TurnCommitOperationLogContext;
}

interface TurnSessionStateWritesRequest extends TurnOperationLogRequest {
  sessionStateWrites?: TurnSessionStateWriteRequest[];
  sessionStateOperationLog?: SessionStateOperationLogContext;
}

export interface RespondRequest extends TurnSessionStateWritesRequest {
  message: string;
  config?: TurnConfig;
  generationParams?: Partial<GenerationParams>;
  branchId?: string;
  sourceFloorId?: string;
  promptIntent?: PromptRunIntent;
  structure?: PromptStructurePolicy;
  delivery?: PromptDeliveryPolicy;
  debugOptions?: PromptLiveDebugOptions;
}

export interface RespondResult {
  floorId: string;
  floorNo: number;
  generatedText: string;
  summaries: string[];
  totalUsage: TurnExecutionResult["totalUsage"];
  finalState: "committed";
  branchId: string;
  memory?: TurnCommitMemoryReceipt;
  promptSnapshot?: PromptSnapshotPreview;
  runtimeTrace?: PromptRuntimeTrace;
}

export interface DryRunDebugOptions {
  includeWorldbookMatches?: boolean;
}

export interface DryRunRequest {
  message: string;
  promptIntent?: PromptRunIntent;
  debugOptions?: DryRunDebugOptions;
  visibility?: PromptVisibilityPolicy;
  structure?: PromptStructurePolicy;
  delivery?: PromptDeliveryPolicy;
  budget?: PromptBudgetPolicy;
  sourceSelection?: PromptSourceSelectionPolicy;
}

export interface DryRunResult {
  messages: ChatMessage[];
  tokenEstimate: number;
  availableForReply: number;
  memorySummary?: string;
  promptSnapshot: PromptSnapshotPreview;
  assembly: PromptAssemblyCompat;
  runtimeTrace?: PromptRuntimeTrace;
}

export interface PromptRuntimePreviewRequest {
  text: string;
  branchId?: string;
  sourceFloorId?: string;
  visibility?: PromptVisibilityPolicy;
  structure?: PromptStructurePolicy;
  delivery?: PromptDeliveryPolicy;
  budget?: PromptBudgetPolicy;
  sourceSelection?: PromptSourceSelectionPolicy;
}

export interface PromptRuntimePreviewResult {
  scope: PromptRuntimeScopeRef;
  policy: ResolvedPromptRuntimePolicy;
  sourceMap?: PromptRuntimeSourceMap;
  diagnostics: PromptRuntimeDiagnostic[];
  limitations: string[];
  text: string;
  memory?: PromptRuntimeTrace["memory"];
  runtimeTrace: PromptRuntimePreviewTrace;
}

interface ReplayConfirmationRequest {
  confirmedExecutionIds?: string[];
  confirmedSessionStateMutationIds?: string[];
}

export interface RegenerateRequest extends ReplayConfirmationRequest, TurnSessionStateWritesRequest {
  config?: TurnConfig;
  generationParams?: Partial<GenerationParams>;
  structure?: PromptStructurePolicy;
  delivery?: PromptDeliveryPolicy;
  debugOptions?: PromptLiveDebugOptions;
}

export interface RegenerateResult {
  floorId: string;
  floorNo: number;
  previousFloorId: string;
  generatedText: string;
  summaries: string[];
  totalUsage: TurnExecutionResult["totalUsage"];
  finalState: "committed";
  memory?: TurnCommitMemoryReceipt;
  promptSnapshot?: PromptSnapshotPreview;
  runtimeTrace?: PromptRuntimeTrace;
}

export type RetryFloorRequest = RegenerateRequest;

export interface RetryFloorResult {
  floorId: string;
  floorNo: number;
  branchId: string;
  generatedText: string;
  summaries: string[];
  totalUsage: TurnExecutionResult["totalUsage"];
  finalState: "committed";
  memory?: TurnCommitMemoryReceipt;
  promptSnapshot?: PromptSnapshotPreview;
  runtimeTrace?: PromptRuntimeTrace;
}

export interface EditAndRegenerateRequest extends RetryFloorRequest {
  content: string;
  branchId?: string;
}

export interface EditAndRegenerateResult extends RetryFloorResult {
  sourceFloorId: string;
  sourceMessageId: string;
  memory?: TurnCommitMemoryReceipt;
}

export interface RespondRuntimeToolEvent {
  executionId: string;
  toolName: string;
  providerId: string;
  providerType?: string;
  sideEffectLevel?: string;
  phase: "start" | "success" | "error" | "denied" | "timeout" | "uncertain" | "blocked";
  message?: string;
  durationMs?: number;
  replaySafety: ToolReplaySafety;
}

export interface RespondRuntimeOptions {
  onStart?: (context: { floorId: string; floorNo: number; branchId: string }) => void;
  onChunk?: (chunk: string) => void;
  onTool?: (event: RespondRuntimeToolEvent) => void;
  onRun?: (event: FloorRunSnapshot) => void;
  abortSignal?: AbortSignal;
}

export interface ResolvedTurnModel {
  model?: ModelConfig;
  source: "env" | "global_profile" | "session_profile";
  profileId?: string;
  providerType?: ProviderType;
  generationParams?: Partial<GenerationParams>;
  enabled?: boolean;
  presetId?: string;
}

export type ResolvedTurnModels = Partial<Record<InstanceSlot, ResolvedTurnModel>>;

export type ResolveTurnModelFn = (sessionId: string, accountId: string) => Promise<ResolvedTurnModel | null>;
export type ResolveTurnModelsFn = (sessionId: string, accountId: string) => Promise<ResolvedTurnModels>;
export type OnTurnModelUsedFn = (model: ResolvedTurnModel, accountId: string) => Promise<void> | void;

export interface TurnExecutionPolicy {
  queueMode: GenerationExecutionMode;
  queueTimeoutMs?: number;
  executionTimeoutMs: number;
  commitRetry: {
    maxRetries: number;
    baseDelayMs: number;
  };
}

export interface TurnExecutionPolicyOverrides {
  queueMode?: GenerationExecutionMode;
  queueTimeoutMs?: number;
  executionTimeoutMs?: number;
  commitRetry?: Partial<TurnExecutionPolicy["commitRetry"]>;
}

export interface ChatServiceOptions {
  historyMaxFloors?: number;
  memoryStore?: MemoryStore;
  memoryInjectionDecay?: MemoryInjectionOptions["decay"];
  enableMemoryConsolidationByDefault?: boolean;
  enableAsyncMemoryIngest?: boolean;
  enableDualSummaryInjection?: boolean;
  resolveTurnModel?: ResolveTurnModelFn;
  turnCommitService?: TurnCommitService;
  sessionStateService?: SessionStateService;
  firstPartyGameStateService?: FirstPartyGameStateService;
  resolveTurnModels?: ResolveTurnModelsFn;
  onTurnModelUsed?: OnTurnModelUsedFn;
  floorRunService?: FloorRunService;
  toolRegistry?: ToolRegistry;
  sessionToolRegistryService?: SessionToolRegistryService;
  toolRuntimeJobBridge?: ToolRuntimeJobBridge;
  resolveToolPermissions?: (sessionId: string, accountId: string) => Promise<ToolPermissions | null>;
  resolveEffectiveToolPolicy?: (
    sessionId: string,
    accountId: string,
  ) => Promise<EffectiveToolPolicyResolution | null>;
  generationGuard?: GenerationGuardService;
  generationCoordinator?: GenerationCoordinator;
  eventBus?: CoreEventBus;
  executionPolicy?: TurnExecutionPolicyOverrides;
  defaultNarratorProviderType?: ProviderType;
  accountMode?: AccountContextOptions["accountMode"];
  defaultAccountId?: string;
  projectEventLiveHub?: ProjectEventLiveHub;
}

