import type { PromptRuntimeTrace, PromptSnapshotPreview } from "../prompt-runtime.js";
import type { RespondFinalState, RespondMemoryReceipt } from "../resources/sessions.js";
import type { ApiUsage } from "../types/usage.js";

export type TavernRespondStartPayload = {
  branchId?: string;
  floorId?: string;
  floorNo?: number;
};

export type TavernRespondChunkPayload = {
  chunk: string;
};

export type TavernRespondReasoningPayload = {
  delta: string;
};

/**
 * 中间叙述流式事件载荷。
 *
 * native 多步循环中，某步触发工具调用且产出可见文本时下发（目前仅图助手临时对话）。
 * `stepIndex` 为本步在循环中的步号，`createdAt` 为该步生成完成时刻。
 */
export type TavernRespondStepNarrationPayload = {
  stepIndex: number;
   text: string;
  createdAt: number;
};

export type TavernRespondSummaryPayload = {
  summaries: string[];
};

export type TavernRespondRunPendingOutputPayload = {
  attemptNo: number;
  error?: string | null;
  startedAt: number;
  state: "draft" | "streaming" | "generated" | "failed";
  tempId: string;
  text: string;
  updatedAt: number;
};

export type TavernRespondRunVerifierIssuePayload = {
  description: string;
  severity: "warning" | "error";
};

export type TavernRespondRunVerifierPayload = {
  issues?: TavernRespondRunVerifierIssuePayload[] | null;
  status: "pending" | "passed" | "warned" | "blocked" | "skipped";
  suggestion?: string | null;
};

export type TavernRespondRunErrorPayload = {
  code: string;
  message: string;
};

export type TavernRespondRunPayload = {
  attemptNo: number;
  completedAt?: number | null;
  error?: TavernRespondRunErrorPayload | null;
  floorId: string;
  pendingOutput?: TavernRespondRunPendingOutputPayload | null;
  phase: "input_recorded" | "semantic_resolved" | "prechecked" | "prompt_assembled" | "page_generating" | "candidate_generated" | "verifier_checked" | "transaction_prepared" | "transaction_committed" | "post_commit_scheduled";
  phaseSeq: number;
  publicPhase: "preparing" | "generating" | "verifying" | "committing" | "post_processing";
  runId: string; runType: "respond" | "regenerate_page" | "retry_turn" | "edit_and_regenerate"; startedAt: number; status: "running" | "completed" | "failed" | "cancelled"; updatedAt: number; verifier?: TavernRespondRunVerifierPayload | null;
};

export type TavernRespondToolPhase =
  | "start"
  | "success"
  | "error"
  | "denied"
  | "timeout"
  | "uncertain"
  | "blocked"
  // 图助手「执行前确认闸」：工具在执行前暂停，等待用户批准 / 拒绝。
  | "awaiting_confirmation";
export type TavernRespondToolReplaySafety = "safe" | "confirm_on_replay" | "never_auto_replay" | "uncertain";
export type TavernRespondToolProviderType = "builtin" | "preset" | "mcp" | "unknown";
export type TavernRespondToolSideEffectLevel = "none" | "sandbox" | "irreversible";

export type TavernRespondToolPayload = {
  durationMs?: number;
  executionId: string;
  message?: string;
  phase: TavernRespondToolPhase;
  providerId: string;
  providerType?: TavernRespondToolProviderType;
  replaySafety: TavernRespondToolReplaySafety;
  sideEffectLevel?: TavernRespondToolSideEffectLevel;
  toolName: string;
  /** 仅 phase=awaiting_confirmation 时存在：模型生成的工具调用 id。 */
  callId?: string;
  /** 仅 phase=awaiting_confirmation 时存在：待确认调用的参数快照。 */
  args?: Record<string, unknown>;
};

export type TavernRespondErrorPayload = {
  code?: string;
  message?: string;
};

/**
 * 起点之前已产生、不会回滚的写类副作用条目（脱敏后只暴露摘要字段）。
 *
 * 仅在 step 级重试（retry-step）的 done 事件中出现；普通 respond / retry 不携带。
 */
export type TavernRespondIrreversibleSideEffect = {
  executionId: string;
  generationStepNo?: number | null;
  sideEffectLevel: string;
  startedAt: number;
  toolName: string;
};

export type TavernRespondDonePayload = {
  branchId?: string;
  conversationId?: string;
  finalState?: RespondFinalState;
  floorId: string;
  floorNo: number;
  generatedText?: string;
  memory?: RespondMemoryReceipt;
  pageId?: string;
  promptSnapshot?: PromptSnapshotPreview;
  runtimeTrace?: PromptRuntimeTrace;
  summaries: string[];
  totalUsage: ApiUsage;
  /**
   * 实际被丢弃的起始步号（1-based）。仅 step 级重试的 done 事件携带。
   */
  discardedFromStepIndex?:number;
  /**
   * 起点之前已产生、不会回滚的写类副作用清单（脱敏摘要）。仅 step 级重试的 done 事件携带。
   */
  irreversibleSideEffects?: TavernRespondIrreversibleSideEffect[];
};

export type TavernRespondStreamEvent =
  | { payload: TavernRespondStartPayload; type: "start" }
  | { payload: TavernRespondChunkPayload; type: "chunk" }
  | { payload: TavernRespondReasoningPayload; type: "reasoning" }
  | { payload: TavernRespondStepNarrationPayload; type: "step_narration" }
  | { payload: TavernRespondRunPayload; type: "run" }
  | { payload: TavernRespondSummaryPayload; type: "summary" }
  | { payload: TavernRespondToolPayload; type: "tool" }
  | { payload: TavernRespondErrorPayload; type: "error"}
  | { payload: TavernRespondDonePayload; type: "done" };

export type TavernStreamEvent = TavernRespondStreamEvent;

export type RespondStreamCallbacks = {
  onChunk?: (payload: TavernRespondChunkPayload) => void;
  onError?: (payload: TavernRespondErrorPayload) => void;
  onEvent?: (event: TavernRespondStreamEvent) => void;
  /**
   * 推理（思维链）增量回调。
   *
   * 仅当服务端在生成过程中下发 reasoning 事件时触发（目前仅图助手临时对话）。
   * 模型未返回 reasoning 时不会触发。
   */
  onReasoning?: (payload: TavernRespondReasoningPayload) => void;
  /**
   * 中间叙述增量回调。
   *
   * 仅当服务端在生成过程中下发 step_narration 事件时触发（目前仅图助手临时对话的 native 多步循环）。
   */
  onStepNarration?: (payload: TavernRespondStepNarrationPayload) => void;
  onRun?: (payload: TavernRespondRunPayload) => void;
  onStart?: (payload: TavernRespondStartPayload) => void;
  onSummary?: (payload: TavernRespondSummaryPayload) => void;
  onTool?: (payload: TavernRespondToolPayload) => void;
};
