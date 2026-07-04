import { isNodeGraphAnnotationNodeType } from './annotation.js';
import type { NodeGraphBudgetOverrides, NodeGraphDocument, NodeGraphNode, NodeGraphRuntimeBudget } from './types.js';

/** 后台真实运行的默认预算。 */
export const DEFAULT_NODE_GRAPH_RUNTIME_BUDGET: NodeGraphRuntimeBudget = {
  maxNodesExecuted: 200,
  maxDepth: 64,
  maxFanOut: 64,
  maxNestedAgentJobs: 16,
  maxTemporaryConversations: 16,
  maxRuntimeDurationMs: 30_000,
};

/** 同步 preview / validate 的更严格预算。 */
export const DEFAULT_NODE_GRAPH_SYNC_PREVIEW_BUDGET: NodeGraphRuntimeBudget = {
  maxNodesExecuted: 100,
  maxDepth: 32,
  maxFanOut: 48,
  maxNestedAgentJobs: 16,
  maxTemporaryConversations: 16,
  maxRuntimeDurationMs: 5_000,
};

export interface NodeGraphBudgetUsageSummary {
  runtimeNodeCount: number;
  depth: number;
  maxFanOut: number;
  nestedAgentJobs: number;
  temporaryConversations: number;
}

/**
 * 解析图的有效预算。
 *
 * 图级覆盖只能收紧平台预算。大于平台默认值的覆盖不会提高有效上限。
 */
export function resolveNodeGraphBudget(
  platformBudget: NodeGraphRuntimeBudget,
  graphBudget?: NodeGraphBudgetOverrides,
): NodeGraphRuntimeBudget {
  return {
    maxNodesExecuted: minPositive(platformBudget.maxNodesExecuted, graphBudget?.maxNodesExecuted),
    maxDepth: minPositive(platformBudget.maxDepth, graphBudget?.maxDepth),
    maxFanOut: minPositive(platformBudget.maxFanOut, graphBudget?.maxFanOut),
    maxNestedAgentJobs: minNonNegative(platformBudget.maxNestedAgentJobs, graphBudget?.maxNestedAgentJobs),
    maxTemporaryConversations: minNonNegative(
      platformBudget.maxTemporaryConversations,
      graphBudget?.maxTemporaryConversations,
    ),
    maxRuntimeDurationMs: minPositive(platformBudget.maxRuntimeDurationMs, graphBudget?.maxRuntimeDurationMs),
  };
}

/** 统计当前图对预算的静态使用量。 */
export function summarizeNodeGraphBudgetUsage(
  document: NodeGraphDocument,
  topologicalLevels: readonly (readonly NodeGraphNode[] | readonly string[])[],
): NodeGraphBudgetUsageSummary {
  return {
    runtimeNodeCount: countRuntimeNodes(document),
    depth: topologicalLevels.length,
    maxFanOut: topologicalLevels.reduce((max, level) => Math.max(max, level.length), 0),
    nestedAgentJobs: countNodeGraphNestedAgentJobs(document),
    temporaryConversations: countNodeGraphTemporaryConversations(document),
  };
}

export function countRuntimeNodes(document: NodeGraphDocument): number {
  return document.nodes.filter((node) => !isNodeGraphAnnotationNodeType(node.type)).length;
}

export function countNodeGraphNestedAgentJobs(document: NodeGraphDocument): number {
  return document.nodes.filter((node) => isEnabled(node) && readAgentCallMediumKind(node) === 'background_job').length;
}

export function countNodeGraphTemporaryConversations(document: NodeGraphDocument): number {
  return document.nodes.filter((node) => isEnabled(node) && readAgentCallMediumKind(node) === 'temporary_conversation').length;
}

function minPositive(platformValue: number, graphValue: number | undefined): number {
  if (typeof graphValue !== 'number' || !Number.isFinite(graphValue) || graphValue <= 0) {
    return platformValue;
  }
  return Math.min(platformValue, Math.trunc(graphValue));
}

function minNonNegative(platformValue: number, graphValue: number | undefined): number {
  if (typeof graphValue !== 'number' || !Number.isFinite(graphValue) || graphValue < 0) {
    return platformValue;
  }
  return Math.min(platformValue, Math.trunc(graphValue));
}

function readAgentCallMediumKind(node: NodeGraphNode): string | null {
  if (node.type !== 'agent.call' || !isRecord(node.config) || !isRecord(node.config.medium)) {
    return null;
  }
  return typeof node.config.medium.kind === 'string' ? node.config.medium.kind : null;
}

function isEnabled(node: NodeGraphNode): boolean {
  return node.enabled !== false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
