/**
 * Agent Runtime inline 主回合的核心语义类型。
 *
 * R2 在 R1 的基础上，把调用来源从 respond 专用语义泛化为 turn 语义。
 * 这里仍只覆盖当前主回合内的 inline Agent，不覆盖后台 Agent、临时对话执行介质或 NodeGraph。
 */
import type { PromptRuntimeTrace } from "../prompt-assembler.js";
import type {
  FirstPartyStateContext,
  PreparedTurnContext,
  PromptRuntimeContributorOutput,
} from "../chat/types.js";
import type {
  AgentDeliveryTarget,
  AgentMediumKind,
  AgentMediumSelection,
} from "./agent-medium-types.js";
import type { AgentLineageRef } from "./agent-lineage-types.js";

export type InlineAgentPhase = "pre_response" | "post_response";

export type InlineAgentRoleKind =
  | "scene_state"
  | "memory_selection"
  | "worldbook_focus"
  | "director"
  | "agency_guard"
  | "continuity_verifier"
  | "style_verifier"
  | "state_proposal"
  | "memory_proposal";

export type InlineAgentFailurePolicy = "fail_open" | "fail_closed";

export type AgentInvocationTurnMode = "respond" | "regenerate" | "retry_floor" | "edit_and_regenerate";

export type AgentInvocationRunType =
  | "respond"
  | "regenerate_page"
  | "retry_turn"
  | "retry_step"
  | "edit_and_regenerate";

export type TurnAgentInvocationSource =
  | {
      kind: "turn_pre_response";
      mode: AgentInvocationTurnMode;
      runType: AgentInvocationRunType;
      sessionId: string;
      floorId: string;
      attemptNo: number;
      pageId?: string;
    }
  | {
      kind: "turn_post_response";
      mode: AgentInvocationTurnMode;
      runType: AgentInvocationRunType;
      sessionId: string;
      floorId: string;
      attemptNo: number;
      pageId: string;
    };

/**
 * R1 兼容来源。R2 实现路径不应继续在 trace 中使用这些名称。
 */
export type LegacyAgentInvocationSource =
  | { kind: "respond_pre_response"; sessionId: string; floorId: string; pageId?: string }
  | { kind: "respond_post_response"; sessionId: string; floorId: string; pageId: string };

export type AgentInvocationSource = TurnAgentInvocationSource | LegacyAgentInvocationSource;

export interface InlineAgentSpec {
  id: string;
  roleKind: InlineAgentRoleKind;
  phase: InlineAgentPhase;
  /** R2 中该字段会与 checkpoint manifest 一起使用，单独不代表可复用承诺。 */
  stabilityHint: "floor" | "page";
  failurePolicy: InlineAgentFailurePolicy;
  /** R3 执行介质选择。现有 inline 主链默认使用 single_call。 */
  medium?: AgentMediumSelection;
}

export interface AgentRunContext {
  sessionId: string;
  branchId?: string;
  floorId: string;
  pageId?: string;
  accountId: string;
  source: AgentInvocationSource;
  spec: InlineAgentSpec;
  preparedTurn?: PreparedTurnContext;
  firstPartyStateContext?: FirstPartyStateContext;
  memorySummary?: string;
  memoryTrace?: PromptRuntimeTrace["memory"];
  worldbookHits?: AgentWorldbookHit[];
  narratorText?: string;
  promptMode?: "compat_strict" | "compat_plus" | "native";
  abortSignal?: AbortSignal;
}

export interface AgentWorldbookHit {
  id: string;
  name?: string;
}

export interface AgentFinding {
  code: string;
  severity: "info" | "warn" | "error";
  summary: string;
}

export interface WorldbookFocusSelection {
  required: string[];
  optional: string[];
  suppressed: Array<{ id: string; reason: string }>;
}

export interface MemorySelectionOverride {
  required: string[];
  optional: string[];
}

export interface AgentStateProposal {
  namespace?: string;
  slot?: string;
  summary: string;
  payload?: unknown;
}

export interface AgentMemoryProposal {
  kind: string;
  summary: string;
  payload?: unknown;
}

export interface AgentRunOutput {
  contributor?: PromptRuntimeContributorOutput;
  narratorConstraints?: string[];
  worldbookSelectionOverride?: WorldbookFocusSelection;
  memorySelectionOverride?: MemorySelectionOverride;
  findings?: AgentFinding[];
  stateProposals?: AgentStateProposal[];
  memoryProposals?: AgentMemoryProposal[];
  summary?: string;
}

export interface AgentProcessor {
  readonly spec: InlineAgentSpec;
  prepare(context: AgentRunContext): Promise<unknown> | unknown;
  execute(prepared: unknown, context: AgentRunContext): Promise<AgentRunOutput> | AgentRunOutput;
}

export interface AgentRunRecord {
  agentId: string;
  roleKind: InlineAgentRoleKind;
  phase: InlineAgentPhase;
  status: "ok" | "skipped" | "failed";
  durationMs: number;
  stabilityHint: "floor" | "page";
  output?: AgentRunOutput;
  outputSummary?: string;
  errorCode?: string;
}

export interface InlineAgentExecutionResult {
  phase: InlineAgentPhase;
  records: AgentRunRecord[];
  aborted: boolean;
}

export interface AgentInvocationGroup {
  groupId: string;
  parallel: boolean;
  agents: InlineAgentSpec[];
}

export interface AgentInvocationPlan {
  source: AgentInvocationSource;
  phase: InlineAgentPhase;
  groups: AgentInvocationGroup[];
}

export interface AggregatedPreResponseContext {
  contributors: PromptRuntimeContributorOutput[];
  narratorConstraints: string[];
  worldbookSelectionOverride?: WorldbookFocusSelection;
  memorySelectionOverride?: MemorySelectionOverride;
  conflicts: Array<{
    code: string;
    summary: string;
    resolvedBy: string;
  }>;
}

export interface PostResponseEnvelope {
  findings: {
    continuity: AgentFinding[];
    agency: AgentFinding[];
    style: AgentFinding[];
  };
  stateProposals: AgentStateProposal[];
  memoryProposals: AgentMemoryProposal[];
  commitAdvice: "allow" | "warn";
}

export interface AgentRunTraceItem {
  agentId: string;
  roleKind: InlineAgentRoleKind;
  phase: InlineAgentPhase;
  status: "ok" | "skipped" | "failed";
  durationMs: number;
  stabilityHint: "floor" | "page";
  medium?: AgentMediumSelection;
  outputSummary?: string;
  errorCode?: string;
}

export interface AgentRuntimeTraceInvocation {
  kind: "turn_pre_response" | "turn_post_response" | "respond_pre_response" | "respond_post_response";
  mode?: AgentInvocationTurnMode;
  runType?: AgentInvocationRunType;
  attemptNo?: number;
  pageId?: string;
}

export interface AgentRuntimeTrace {
  strategy: "inline_mvp" | "inline_retry_commit";
  scopeKind: "floor";
  invocation?: AgentRuntimeTraceInvocation;
  preResponse: {
    runs: AgentRunTraceItem[];
    aggregator?: {
      contributorIds: string[];
      conflictCount: number;
      conflicts: Array<{ code: string; summary: string }>;
    };
  };
  response: {
    narratorCallerSlot: "narrator";
    outputPageId?: string;
  };
  postResponse: {
    runs: AgentRunTraceItem[];
    findingCounts: {
      continuity: number;
      agency: number;
      style: number;
    };
    proposalCounts: {
      state: number;
      memory: number;
    };
    commitAdvice: "allow" | "warn";
    gate?: {
      status: "allow" | "warn" | "block";
      policy: "warn_only" | "block_on_error";
      reasonCount: number;
    };
    promotion?: {
      status: "staged" | "blocked" | "stale";
      reason?: string;
      decisionCode?: string;
      pageWriteAcceptedCount: number;
      pageWriteDiscardedCount: number;
      stateObservedCount: number;
      stateDiscardedCount: number;
      sessionStateStagedCount: number;
      memoryBatchCount: number;
      memoryProposedCount: number;
      memoryRejectedCount: number;
      memorySupersededCount: number;
    };
  };
}

/**
 * R3 介质段 trace。
 *
 * 描述一次 Agent 运行所使用的执行介质、投递目标、来源血缘与终态。
 * single_call 沿用现有 run trace，并可补 medium 字段；
 * temporary_conversation 记录 conversation id、purpose、投递目标、finalize 结果；
 * background_job 在 R3 只记录 planned medium 与拒绝原因，不记录真实 runtime job。
 */
export interface AgentRuntimeMediumTrace {
  kind: AgentMediumKind;
  deliveryTarget: AgentDeliveryTarget;
  status: "planned" | "running" | "completed" | "failed" | "cancelled" | "rejected";
  conversationId?: string;
  runtimeJobId?: string;
  purpose?: string;
  rejectionCode?: string;
  /**
   * 后台 Agent 介质标注本次运行是否为 dry_run 演练。
   *
   * dry_run = true 表示只做计划解析与校验，未真正写持久输出，
   * 避免演练结果被误认为真实产出。
   */
  dryRun?: boolean;
  lineage?: AgentLineageRef;
}

