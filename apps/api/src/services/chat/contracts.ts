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

import type {
  PromptRuntimeClientInjectionInput,
} from "../prompt-runtime-injection-types.js";
import type { LlmInstanceCapabilities } from "../../lib/llm-capabilities.js";
import type { EffectiveToolPolicyResolution } from "../tooling/shared/tool-policy-resolution.js";
import type { GenerationParamKey, GenerationParamsInput } from "../../lib/llm-params.js";
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
import type { CommitGatePolicy } from "./turn-commit-gate.js";

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
  actorClientId?: string | null;
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
  generationParams?: GenerationParamsInput;
  branchId?: string;
  sourceFloorId?: string;
  promptIntent?: PromptRunIntent;
  structure?: PromptStructurePolicy;
  delivery?: PromptDeliveryPolicy;
  debugOptions?: PromptLiveDebugOptions;
  promptRuntimeInjections?: PromptRuntimeClientInjectionInput[];
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
  promptRuntimeInjections?: PromptRuntimeClientInjectionInput[];
}

export interface DryRunResult {
  messages: ChatMessage[];
  tokenEstimate: number;
  availableForReply: number;
  memory?: PromptRuntimeTrace["memory"];
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
  promptRuntimeInjections?: PromptRuntimeClientInjectionInput[];
}

export interface PromptRuntimePreviewResult {
  scope: PromptRuntimeScopeRef;
  policy: ResolvedPromptRuntimePolicy;
  sourceMap?: PromptRuntimeSourceMap;
  diagnostics: PromptRuntimeDiagnostic[];
  limitations: string[];
  text: string;
  memoryInjection?: import("@tavern/core").MemoryInjectionResult;
  memory?: PromptRuntimeTrace["memory"];
  runtimeTrace: PromptRuntimePreviewTrace;
}

interface ReplayConfirmationRequest {
  confirmedExecutionIds?: string[];
  confirmedSessionStateMutationIds?: string[];
}

export interface RegenerateRequest extends ReplayConfirmationRequest, TurnSessionStateWritesRequest {
  config?: TurnConfig;
  generationParams?: GenerationParamsInput;
  structure?: PromptStructurePolicy;
  delivery?: PromptDeliveryPolicy;
  debugOptions?: PromptLiveDebugOptions;
  promptRuntimeInjections?: PromptRuntimeClientInjectionInput[];
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

/**
 * step 级重试起点之前、已产生且不会回滚的写类副作用条目。
 *
 * 仅用于提示用户，脱敏边界与 transcript / inspect 一致（只暴露摘要字段）。
 */
export interface RetryStepIrreversibleSideEffect {
  executionId: string;
  toolName: string;
  sideEffectLevel: string;
  startedAt: number;
  generationStepNo: number | null;
}

/**
 * step 级重试请求。
 *
 * 继承 RetryFloorRequest 的 replay / 确认字段，额外指定从哪一步重生成（fromStepIndex，1-based）。
 */
export interface RetryStepRequest extends RetryFloorRequest {
  fromStepIndex: number;
}

/** step 级重试结果：在 RetryFloorResult 基础上追加被丢弃起点与不可回滚副作用清单。 */
export interface RetryStepResult extends RetryFloorResult {
 discardedFromStepIndex: number;
  irreversibleSideEffects: RetryStepIrreversibleSideEffect[];
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
  phase: "start" | "success" | "error" | "denied" | "timeout" | "uncertain" | "blocked" | "awaiting_confirmation";
  /** 仅 phase=awaiting_confirmation 时存在：待确认调用的参数快照。 */
  args?: Record<string, unknown>;
  /** 仅 phase=awaiting_confirmation 时存在：模型生成的调用 id。 */
  callId?: string;
  message?: string;
  durationMs?: number;
  replaySafety: ToolReplaySafety;
}

export interface RespondRuntimeOptions {
  onStart?: (context: { floorId: string; floorNo: number; branchId: string }) => void;
  onChunk?: (chunk: string) => void;
  /**
   * 推理（思维链）流式增量回调。
   *
   * 仅当模型在生成过程中产出 reasoning delta 时触发，供上层实时下发。
   */
  onReasoning?: (delta: string) => void;
  /**
   * 中间叙述流式增量回调。
   *
   * native 多步循环中，仅当某步触发工具调用且产出可见文本时触发，
   * 供上层实时下发该步中间叙述。末步纯结论步不触发。
   */
  onStepNarration?: (narration: { stepIndex: number;text: string; createdAt: number }) => void;
  onTool?: (event: RespondRuntimeToolEvent) => void;
  onRun?: (event: FloorRunSnapshot) => void;
  abortSignal?: AbortSignal;
}

export interface ResolvedTurnModel {
  model?: ModelConfig;
  source: "env" | "global_profile" | "session_profile";
  profileId?: string;
  providerType?: ProviderType;
  generationParams?: GenerationParamsInput;
  generationParamOrigins?: Partial<Record<GenerationParamKey, "profile" | "instance">>;
  capabilities?: LlmInstanceCapabilities;
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
  /**
   * 是否启用 R1 Agent Runtime单回合 inline MVP（inline_mvp）。
   * 默认关闭。关闭时主链走 NaiveTurnStrategy，行为与现状一致；
   * 打开时在 respond 单回合生成路径前后串联 inline Agent。
   */
  enableAgenticInlineMvp?: boolean;
  /**
   * R2 commit gate 内部策略。
   *
   * 默认仍为 warn_only。只有显式传入严格策略时，post_response 的 error finding 才会阻断提交。
   */
  commitGatePolicy?: CommitGatePolicy;
  /**
   * R1 Agent Runtime trace 观察回调。仅在 inline_mvp 打开且提供本回调时触发。
   * R1 仅用于观察，不参与 commit 决策；Phase 6 再接入 debug / runtime trace。
   */
  onAgentRuntimeTrace?: (
    trace: import("../agent-runtime/inline-agent-types.js").AgentRuntimeTrace,
    context: { sessionId: string; floorId: string; branchId?:string },
  ) => void;
}

