/**
 * Agent Runtime R1（单回合 MVP）的核心语义类型。
 *
 * 这里定义的内容只服务于当前回合内的 inline Agent 执行：
 *  - 只覆盖 `scope_kind = floor` 的当前回合执行。
 *  - 只允许两类主回合调用来源（pre_response / post_response）。
 *  - 不涉及后台 Agent、临时对话执行介质、NodeGraph、checkpoint / resume。
 *
 * 命名约束（见 docs/contributing.md 第 8 节）：
 *  - 本命名空间 `AgentRuntime` 属于平台层 inline 执行能力。
 *  - `AgentRunContext` / `AgentRunResult` 表示一次楼层内 Agent 执行，
 *    不与聊天主链 turn run 快照混用，也不写成 Execution。
 */
import type{ PromptRuntimeTrace }from "../prompt-assembler.js";
import type {
  FirstPartyStateContext,
  PreparedTurnContext,
  PromptRuntimeContributorOutput,
} from "../chat/types.js";

/**
 * inline Agent 的执行相位。R1 只有响应前与响应后两段。
 */
export type InlineAgentPhase = "pre_response" | "post_response";

/**
 * R1 内建 inline Agent 的角色类型。
 */
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

/**
 * inline Agent 失败策略。
 *
 * R1 中除 Narrator 外的内建 Agent 默认 fail_open：失败只进 trace，不阻断主链。
 */
export type InlineAgentFailurePolicy = "fail_open" | "fail_closed";

/**
 * 调用来源。R1 只允许主回合的两类来源，不向后台事件、手动 API、Agent 委派打开。
 */
export type AgentInvocationSource =
  | { kind: "respond_pre_response"; sessionId: string; floorId: string; pageId?: string }
  | { kind: "respond_post_response"; sessionId: string; floorId: string; pageId: string };

/**
 * 单个 inlineAgent 的声明。
 */
export interface InlineAgentSpec{
  id: string;
  roleKind: InlineAgentRoleKind;
  phase: InlineAgentPhase;
  /** R1 仅作为 trace提示，不代表 R2 级别的 checkpoint 复用承诺。 */
  stabilityHint: "floor" | "page";
  failurePolicy: InlineAgentFailurePolicy;
}

/**
 * 单次 Agent 执行上下文。
 *
 * R1 把当前回合可用的输入收口到这里，便于内建 Agent 读取并独立测试。
 */
export interface AgentRunContext {
  sessionId: string;
  branchId?: string;
  floorId: string;
  pageId?: string;
  accountId: string;
  source:AgentInvocationSource;
  /** 当前正在执行的 Agent 声明，由 executor 注入。 */
  spec: InlineAgentSpec;
  /** 已准备好的回合上下文（如果可用）。 */
  preparedTurn?: PreparedTurnContext;
  /** 受治理的场景 / 世界状态投影上下文。 */
  firstPartyStateContext?: FirstPartyStateContext;
  /** 当前回合可用的记忆摘要。 */
  memorySummary?: string;
  /** 当前回合的记忆 trace。 */
  memoryTrace?: PromptRuntimeTrace["memory"];
  /** 当前回合的世界书命中（hint-only 阶段使用）。 */
  worldbookHits?: AgentWorldbookHit[];
  /** Narrator 生成的正文，仅 post_response 阶段可用。 */
  narratorText?: string;
  /** 当前 prompt mode，决定 contributor 是否进入装配。 */
  promptMode?: "compat_strict" | "compat_plus" | "native";
  abortSignal?: AbortSignal;
}

export interface AgentWorldbookHit {
  id: string;
 name?: string;
}

/**
 * Agent finding：post_response verifier 产出的观察项。
 */
export interface AgentFinding {
  code: string;
  severity: "info" | "warn" | "error";
  summary: string;
}

/**
 * 世界书聚焦结果。R1 为 hint-only。
 */
export interface WorldbookFocusSelection {
  required: string[];
  optional: string[];
  suppressed: Array<{ id: string; reason: string }>;
}

/**
 * 记忆选择结果。
 */
export interface MemorySelectionOverride {
  required: string[];
  optional: string[];
}

/**
 * session state proposal（仅进 buffer，不写 live truth）。
 */
export interface AgentStateProposal {
  namespace?: string;
  slot?: string;
  summary: string;
  payload?: unknown;
}

/**
 * memory proposal（仅进 buffer，不写 memory truth）。
 */
export interface AgentMemoryProposal {
  kind: string;
  summary: string;
  payload?: unknown;
}

/**
 * Agent 业务输出。由 processor 的 execute 返回，executor 再包装为执行记录。
 */
export interface AgentRunOutput {
  /** 可渲染的 prompt contributor（pre_response 阶段）。 */
  contributor?: PromptRuntimeContributorOutput;
  /** 给 Narrator 的硬约束（pre_response 阶段）。 */
  narratorConstraints?: string[];
  /** 世界书聚焦覆盖（pre_response 阶段）。 */
  worldbookSelectionOverride?: WorldbookFocusSelection;
  /** 记忆选择覆盖（pre_response 阶段）。 */
  memorySelectionOverride?: MemorySelectionOverride;
  /**验证发现（post_response 阶段）。 */
  findings?: AgentFinding[];
  /**session state proposal（post_response 阶段）。 */
  stateProposals?: AgentStateProposal[];
  /** memory proposal（post_response 阶段）。 */
  memoryProposals?: AgentMemoryProposal[];
  /** 输出摘要，用于 trace。 */
  summary?: string;
}

/**
 * Agent处理器最小合同。R1 只保留 prepare 与 execute，不引入 checkpoint / resume。
 */
export interface AgentProcessor {
  readonly spec: InlineAgentSpec;
  prepare(context: AgentRunContext): Promise<unknown> | unknown;
  execute(prepared: unknown, context: AgentRunContext): Promise<AgentRunOutput> | AgentRunOutput;
}

/**
 * 单次 Agent 执行记录。由 executor 在 processor输出之上补充运行态信息。
 */
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

/**
 * executor 的执行结果。
 */
export interface InlineAgentExecutionResult {
  phase: InlineAgentPhase;
  records: AgentRunRecord[];
  /** 是否因 fail_closed Agent 失败而中止。 */
  aborted: boolean;
}

/**
 * 调用计划的一个执行组。
 */
export interface AgentInvocationGroup {
  groupId: string;
  parallel: boolean;
  agents: InlineAgentSpec[];
}

/**
 * 调用计划。aggregator 不在此计划内，由上层在 pre_response executor 之后单独调用。
 */
export interface AgentInvocationPlan {
  source: AgentInvocationSource;
  phase: InlineAgentPhase;
  groups: AgentInvocationGroup[];
}

/**
 * pre_response 聚合结果，供 Narrator 消费。
 */
export interface AggregatedPreResponseContext {
  contributors: PromptRuntimeContributorOutput[];
  narratorConstraints: string[];
  worldbookSelectionOverride?: WorldbookFocusSelection;
  memorySelectionOverride?:MemorySelectionOverride;
  conflicts: Array<{
    code: string;
    summary: string;
    resolvedBy: string;
  }>;
}

/**
 * post_response 输出信封。R1 只允许 allow / warn，不引入 reject。
 */
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

/**
 * trace 中的单个 Agent 执行条目。
 */
export interface AgentRunTraceItem {
  agentId: string;
  roleKind: InlineAgentRoleKind;
  phase: InlineAgentPhase;
  status: "ok" | "skipped" | "failed";
  durationMs: number;
  stabilityHint: "floor" | "page";
  outputSummary?: string;
  errorCode?: string;
}

/**
 * R1 的最小 Agent Runtime trace。
 */
export interface AgentRuntimeTrace {
  strategy: "inline_mvp";
 scopeKind: "floor";
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
  };
}
