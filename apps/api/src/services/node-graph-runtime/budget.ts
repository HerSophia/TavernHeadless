/**
 * NodeGraph runtime budget（R6-2，缺口 4）。
 *
 * 给 NodeGraph 运行加上一层预算 / fan-out 上限，阻止明显失控的运行与同步 preview/validate
 * 拖垮 API 进程。第一版用全局默认上限，不做完整计费系统。
 *
 * 关于 `NodeGraphPolicies.maxParallelNodes`：executor 当前**顺序执行**，不消费该字段，
 * 因此把它标注为**保留字段**（reserved，不承诺并发语义），而是用本模块的 `maxFanOut`
 * 单独治理“单层最大节点数”。这样避免“声明却不生效”的歧义。
 */
import type { NodeGraphDocument, NodeGraphNode } from "@tavern/core";

import { RUNTIME_GOVERNANCE_BUDGET_REASON_CODES } from "../governance/runtime-governance-types.js";

export interface NodeGraphRuntimeBudget {
  /** 单次运行允许执行的最大节点数。 */
  maxNodesExecuted: number;
  /** 最大拓扑深度（拓扑层数）。 */
  maxDepth: number;
  /** 单个拓扑层允许的最大节点数（fan-out 宽度）。 */
  maxFanOut: number;
  /** 整图允许入队的最大后台 agent job 数（仅真实运行计入）。 */
  maxNestedAgentJobs: number;
  /** 整图允许开启的最大临时对话数（仅真实运行计入）。 */
  maxTemporaryConversations: number;
  /** 软运行时长上限（毫秒），超过后在节点之间中止。 */
  maxRuntimeDurationMs: number;
}

/** 后台真实运行的默认预算。 */
export const DEFAULT_NODE_GRAPH_RUNTIME_BUDGET: NodeGraphRuntimeBudget = {
  maxNodesExecuted: 200,
  maxDepth: 64,
  maxFanOut: 64,
  maxNestedAgentJobs: 16,
  maxTemporaryConversations: 16,
  maxRuntimeDurationMs: 30_000,
};

/** 同步 preview / validate 的更严格预算（在 API 进程内同步执行，必须更克制）。 */
export const DEFAULT_NODE_GRAPH_SYNC_PREVIEW_BUDGET: NodeGraphRuntimeBudget = {
  maxNodesExecuted: 100,
  maxDepth: 32,
  maxFanOut: 48,
  maxNestedAgentJobs: 16,
  maxTemporaryConversations: 16,
  maxRuntimeDurationMs: 5_000,
};

/** 同一 project 同时活跃的 graph.run 作业上限（跨图并发桶）。 */
export const DEFAULT_NODE_GRAPH_PROJECT_RUN_CONCURRENCY = 8;

export interface NodeGraphBudgetViolation {
  reasonCode: string;
  dimension: "nodes" | "depth" | "fan_out" | "nested_agent_jobs" | "temporary_conversations" | "duration";
  limit: number;
  actual: number;
  message: string;
}

export function resolveNodeGraphRuntimeBudget(
  override?: Partial<NodeGraphRuntimeBudget>,
  base: NodeGraphRuntimeBudget = DEFAULT_NODE_GRAPH_RUNTIME_BUDGET,
): NodeGraphRuntimeBudget {
  if (!override) {
    return base;
  }
  return {
    maxNodesExecuted: positiveOr(override.maxNodesExecuted, base.maxNodesExecuted),
    maxDepth: positiveOr(override.maxDepth, base.maxDepth),
    maxFanOut: positiveOr(override.maxFanOut, base.maxFanOut),
    maxNestedAgentJobs: nonNegativeOr(override.maxNestedAgentJobs, base.maxNestedAgentJobs),
    maxTemporaryConversations: nonNegativeOr(override.maxTemporaryConversations, base.maxTemporaryConversations),
    maxRuntimeDurationMs: positiveOr(override.maxRuntimeDurationMs, base.maxRuntimeDurationMs),
  };
}

/** 静态预算检查：执行前用文档与拓扑层判定，返回首个违例或 null。 */
export function checkNodeGraphStaticBudget(input: {
  document: NodeGraphDocument;
  topologicalLevels: ReadonlyArray<ReadonlyArray<unknown>>;
  dryRun: boolean;
  budget: NodeGraphRuntimeBudget;
}): NodeGraphBudgetViolation | null {
  const { document, topologicalLevels, dryRun, budget } = input;

  const nodeCount = document.nodes.length;
  if (nodeCount > budget.maxNodesExecuted) {
    return violation("nodes", RUNTIME_GOVERNANCE_BUDGET_REASON_CODES.nodeGraphMaxNodes, budget.maxNodesExecuted, nodeCount);
  }

  const depth = topologicalLevels.length;
  if (depth > budget.maxDepth) {
    return violation("depth", RUNTIME_GOVERNANCE_BUDGET_REASON_CODES.nodeGraphMaxDepth, budget.maxDepth, depth);
  }

  const fanOut = topologicalLevels.reduce((max, level) => Math.max(max, level.length), 0);
  if (fanOut > budget.maxFanOut) {
    return violation("fan_out", RUNTIME_GOVERNANCE_BUDGET_REASON_CODES.nodeGraphMaxFanOut, budget.maxFanOut, fanOut);
  }

  // 嵌套 job / 临时对话只在真实运行计入；dry-run / preview 不入队，不受这两项约束。
  if (!dryRun) {
    const nestedAgentJobs = countNodeGraphNestedAgentJobs(document);
    if (nestedAgentJobs > budget.maxNestedAgentJobs) {
      return violation(
        "nested_agent_jobs",
        RUNTIME_GOVERNANCE_BUDGET_REASON_CODES.nodeGraphMaxNestedAgentJobs,
        budget.maxNestedAgentJobs,
        nestedAgentJobs,
      );
    }
    const temporaryConversations = countNodeGraphTemporaryConversations(document);
    if (temporaryConversations > budget.maxTemporaryConversations) {
      return violation(
        "temporary_conversations",
        RUNTIME_GOVERNANCE_BUDGET_REASON_CODES.nodeGraphMaxTemporaryConversations,
        budget.maxTemporaryConversations,
        temporaryConversations,
      );
    }
  }

  return null;
}

/** 同步 size 预算：preview / validate 在编译前用节点数判定，避免单请求拖垮 API 进程。 */
export function checkNodeGraphSyncSizeBudget(
  document: NodeGraphDocument,
  budget: NodeGraphRuntimeBudget,
): NodeGraphBudgetViolation | null {
  const nodeCount = document.nodes.length;
  if (nodeCount > budget.maxNodesExecuted) {
    return violation("nodes", RUNTIME_GOVERNANCE_BUDGET_REASON_CODES.nodeGraphMaxNodes, budget.maxNodesExecuted, nodeCount);
  }
  return null;
}

/** 运行时长软上限判定。 */
export function exceedsNodeGraphDurationBudget(elapsedMs: number, budget: NodeGraphRuntimeBudget): boolean {
  return elapsedMs > budget.maxRuntimeDurationMs;
}

export function nodeGraphDurationViolation(elapsedMs: number, budget: NodeGraphRuntimeBudget): NodeGraphBudgetViolation {
  return violation(
    "duration",
    RUNTIME_GOVERNANCE_BUDGET_REASON_CODES.nodeGraphMaxDuration,
    budget.maxRuntimeDurationMs,
    Math.round(elapsedMs),
  );
}

export function countNodeGraphNestedAgentJobs(document: NodeGraphDocument): number {
  return document.nodes.filter((node) => isEnabled(node) && readAgentCallMediumKind(node) === "background_job").length;
}

export function countNodeGraphTemporaryConversations(document: NodeGraphDocument): number {
  return document.nodes.filter((node) => isEnabled(node) && readAgentCallMediumKind(node) === "temporary_conversation").length;
}

function readAgentCallMediumKind(node: NodeGraphNode): string | null {
  if (node.type !== "agent.call" || !isRecord(node.config) || !isRecord(node.config.medium)) {
    return null;
  }
  return typeof node.config.medium.kind === "string" ? node.config.medium.kind : null;
}

function isEnabled(node: NodeGraphNode): boolean {
  return node.enabled !== false;
}

function violation(
  dimension: NodeGraphBudgetViolation["dimension"],
  reasonCode: string,
  limit: number,
  actual: number,
): NodeGraphBudgetViolation {
  return {
    reasonCode,
    dimension,
    limit,
    actual,
    message: `NodeGraph runtime budget exceeded: ${dimension} ${actual} > limit ${limit}.`,
  };
}

function positiveOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}

function nonNegativeOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
