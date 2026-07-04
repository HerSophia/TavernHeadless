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
import {
  DEFAULT_NODE_GRAPH_RUNTIME_BUDGET,
  DEFAULT_NODE_GRAPH_SYNC_PREVIEW_BUDGET,
  countNodeGraphNestedAgentJobs,
  countNodeGraphTemporaryConversations,
  countRuntimeNodes,
  resolveNodeGraphBudget,
  type NodeGraphDocument,
  type NodeGraphRuntimeBudget,
} from "@tavern/core";

import { RUNTIME_GOVERNANCE_BUDGET_REASON_CODES } from "../governance/runtime-governance-types.js";

/** 同一 project 同时活跃的 graph.run 作业上限（跨图并发桶）。 */
export const DEFAULT_NODE_GRAPH_PROJECT_RUN_CONCURRENCY = 8;

export interface NodeGraphBudgetViolation {
  reasonCode: string;
  dimension: "nodes" | "depth" | "fan_out" | "nested_agent_jobs" | "temporary_conversations" | "duration";
  limit: number;
  actual: number;
  message: string;
}

export {
  DEFAULT_NODE_GRAPH_RUNTIME_BUDGET,
  DEFAULT_NODE_GRAPH_SYNC_PREVIEW_BUDGET,
  resolveNodeGraphBudget as resolveNodeGraphRuntimeBudget,
  type NodeGraphRuntimeBudget,
};

/** 静态预算检查：执行前用文档与拓扑层判定，返回首个违例或 null。 */
export function checkNodeGraphStaticBudget(input: {
  document: NodeGraphDocument;
  topologicalLevels: ReadonlyArray<ReadonlyArray<unknown>>;
  dryRun: boolean;
  budget: NodeGraphRuntimeBudget;
}): NodeGraphBudgetViolation | null {
  const { document, topologicalLevels, dryRun, budget } = input;

  const nodeCount = countRuntimeNodes(document);
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
  const nodeCount = countRuntimeNodes(document);
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

export {
  countRuntimeNodes,
  countNodeGraphNestedAgentJobs,
  countNodeGraphTemporaryConversations,
};

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

