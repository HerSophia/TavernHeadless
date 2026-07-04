import type { NodeGraphDocument, NodeGraphRunIntent } from "@tavern/core";

import { NodeGraphExecutor, type NodeGraphExecutionResult } from "./executor.js";
import type { NodeGraphRuntimeContext } from "./node-handler-registry.js";
import { DEFAULT_NODE_GRAPH_SYNC_PREVIEW_BUDGET, resolveNodeGraphRuntimeBudget } from "./budget.js";

export type NodeGraphPreviewInput = {
  document: NodeGraphDocument;
  graphVersionId?: string;
  nodeId?: string | null;
  context: Omit<NodeGraphRuntimeContext, "intent" | "dryRun"> & {
    intent?: NodeGraphRunIntent;
    dryRun?: boolean;
  };
};

export async function previewNodeGraph(
  executor: NodeGraphExecutor,
  input: NodeGraphPreviewInput,
): Promise<NodeGraphExecutionResult> {
  const result = await executor.execute({
    document: input.document,
    graphVersionId: input.graphVersionId,
    context: {
      ...input.context,
      intent: input.context.intent ?? "preview",
      dryRun: input.context.dryRun ?? true,
      // R6-2（缺口 4）：同步 preview 套用更严格的预算，避免单请求拖垮 API 进程。
      budget: input.context.budget
        ?? resolveNodeGraphRuntimeBudget(DEFAULT_NODE_GRAPH_SYNC_PREVIEW_BUDGET, input.document.budgets),
    },
  });

  if (!input.nodeId) {
    return result;
  }

  return {
    ...result,
    nodeOutputs: Object.fromEntries(
      Object.entries(result.nodeOutputs).filter(([nodeId]) => nodeId === input.nodeId),
    ),
  };
}
