import { createHash } from "node:crypto";

import {
  compileNodeGraph,
  type CompiledNodeGraph,
  type NodeGraphDiagnostic,
  type NodeGraphDocument,
  type NodeGraphEdge,
  type NodeGraphFailurePolicy,
  type NodeGraphNode,
  type NodeGraphNodeRunStatus,
  type NodeGraphNodeRunOutput,
  type NodeGraphRunIntent,
} from "@tavern/core";

import type { AgentOutputDispatchRequest } from "../agent-runtime/agent-output-dispatcher.js";
import type { NodeGraphRunRecord } from "../node-graph-run-service.js";
import {
  NodeGraphNodeHandlerRegistry,
  type NodeGraphNodeInputs,
  type NodeGraphRuntimeContext,
} from "./node-handler-registry.js";
import {
  DEFAULT_NODE_GRAPH_RUNTIME_BUDGET,
  checkNodeGraphStaticBudget,
  exceedsNodeGraphDurationBudget,
  nodeGraphDurationViolation,
  type NodeGraphBudgetViolation,
} from "./budget.js";

export class NodeGraphNodeExecutionError extends Error {
  constructor(
    message: string,
    public readonly diagnostics: NodeGraphDiagnostic[] = [],
    public readonly code = "node_graph_node_execution_failed",
  ) {
    super(message);
    this.name = "NodeGraphNodeExecutionError";
  }
}

export type NodeGraphExecutedNodeRun = {
  nodeId: string;
  phase: string;
  status: NodeGraphNodeRunStatus;
  inputHash?: string | null;
  outputHash?: string | null;
  output: NodeGraphNodeRunOutput;
  diagnostics?: NodeGraphDiagnostic[] | null;
  startedAt?: number | null;
  finishedAt?: number | null;
};

export type NodeGraphPendingOutputDispatchRequest = {
  nodeId: string;
  request: AgentOutputDispatchRequest;
};

export type NodeGraphOutputDispatchTraceRef = {
  nodeId: string;
  target: AgentOutputDispatchRequest["target"];
  /** R6-3（缺口 6）：`rejected` 表示该输出目标被图 manifest 运行时收窄拒绝，未派发。 */
  status: "planned" | "pending" | "dispatched" | "rejected";
  result?: unknown;
  /** 拒绝原因 reason code（仅 status = rejected 时有意义）。 */
  reason?: string;
};

export type NodeGraphNestedJobTraceRef = {
  nodeId: string;
  jobId: string;
  medium: "background_job";
  created?: boolean;
  dryRun?: boolean;
};

export type NodeGraphExecutionResult = {
  graphRun: NodeGraphRunRecord | null;
  status: "succeeded" | "failed";
  nodeOutputs: Record<string, NodeGraphNodeRunOutput>;
  nodeRuns: NodeGraphExecutedNodeRun[];
  pendingOutputDispatchRequests: NodeGraphPendingOutputDispatchRequest[];
  diagnostics: CompiledNodeGraph["diagnostics"];
  trace: {
    graphId: string;
    intent: NodeGraphRunIntent;
    topologicalLevels: string[][];
    compileDiagnostics: NodeGraphDiagnostic[];
    statusCounts: Record<NodeGraphNodeRunStatus, number>;
    failedNodes: Array<{ nodeId: string; diagnostics: NodeGraphDiagnostic[] }>;
    outputDispatchRefs: NodeGraphOutputDispatchTraceRef[];
    nestedJobRefs: NodeGraphNestedJobTraceRef[];
    failedNodeId?: string;
    error?: string;
  };
};

export class NodeGraphExecutor {
  constructor(private readonly handlers: NodeGraphNodeHandlerRegistry) {}

  async execute(input: {
    document: NodeGraphDocument;
    graphVersionId?: string;
    context: NodeGraphRuntimeContext;
  }): Promise<NodeGraphExecutionResult> {
    const compiled = compileNodeGraph(input.document);
    const baseTrace = {
      graphId: input.document.graphId,
      intent: input.context.intent,
      topologicalLevels: compiled.topologicalLevels.map((level) => level.map((node) => node.id)),
      compileDiagnostics: compiled.diagnostics,
    };
    if (!compiled.isExecutable) {
      return {
        graphRun: null,
        status: "failed",
        nodeOutputs: {},
        nodeRuns: [],
        pendingOutputDispatchRequests: [],
        diagnostics: compiled.diagnostics,
        trace: {
          ...baseTrace,
          statusCounts: emptyStatusCounts(),
          failedNodes: [],
          outputDispatchRefs: [],
          nestedJobRefs: [],
          error: "node_graph_not_executable",
        },
      };
    }

    // R6-2（缺口 4）：执行前的静态预算检查（节点数 / 深度 / fan-out / 嵌套作业 / 临时对话）。
    const budget = input.context.budget ?? DEFAULT_NODE_GRAPH_RUNTIME_BUDGET;
    const staticViolation = checkNodeGraphStaticBudget({
      document: input.document,
      topologicalLevels: compiled.topologicalLevels,
      dryRun: input.context.dryRun,
      budget,
    });
    if (staticViolation) {
      return this.budgetFailureResult(baseTrace, compiled.diagnostics, staticViolation);
    }

    const nodeOutputs = new Map<string, NodeGraphNodeRunOutput>();
    const nodeRuns: NodeGraphExecutedNodeRun[] = [];
    let failedNodeId: string | undefined;
    let fatalError: string | undefined;
    const startedAtMs = Date.now();

    for (const level of compiled.topologicalLevels) {
      for (const node of level) {
        const run = await this.executeNode({
          node,
          compiled,
          context: input.context,
          document: input.document,
          nodeOutputs,
        });
        nodeRuns.push(run);
        nodeOutputs.set(node.id, run.output);

        if (run.status === "failed" && this.failurePolicyFor(input.document, node) === "fail_closed") {
          failedNodeId = node.id;
          fatalError = run.diagnostics?.[0]?.message ?? `Node '${node.id}' failed.`;
          break;
        }

        // R6-2（缺口 4）：运行时长软上限，超过后在节点之间中止。
        const elapsedMs = Date.now() - startedAtMs;
        if (exceedsNodeGraphDurationBudget(elapsedMs, budget)) {
          fatalError = nodeGraphDurationViolation(elapsedMs, budget).reasonCode;
          break;
        }
      }
      if (fatalError) {
        break;
      }
    }

    const pendingOutputDispatchRequests = collectPendingOutputDispatchRequests(nodeRuns);
    const nestedJobRefs = collectNestedJobRefs(nodeRuns);
    const failedNodes = nodeRuns
      .filter((run) => run.status === "failed")
      .map((run) => ({
        nodeId: run.nodeId,
        diagnostics: run.diagnostics ?? [],
      }));
    const trace = {
      ...baseTrace,
      statusCounts: countStatuses(nodeRuns),
      failedNodes,
      outputDispatchRefs: pendingOutputDispatchRequests.map(({ nodeId, request }) => ({
        nodeId,
        target: request.target,
        status: input.context.dryRun ? "planned" as const : "pending" as const,
      })),
      nestedJobRefs,
      ...(failedNodeId ? { failedNodeId } : {}),
      ...(fatalError ? { error: fatalError } : {}),
    };

    return {
      graphRun: null,
      status: fatalError ? "failed" : "succeeded",
      nodeOutputs: Object.fromEntries(nodeOutputs),
      nodeRuns,
      pendingOutputDispatchRequests,
      diagnostics: compiled.diagnostics,
      trace,
    };
  }

  /** R6-2（缺口 4）：静态预算违例时返回一个失败结果，不执行任何节点、不派发任何输出。 */
  private budgetFailureResult(
    baseTrace: {
      graphId: string;
      intent: NodeGraphRunIntent;
      topologicalLevels: string[][];
      compileDiagnostics: NodeGraphDiagnostic[];
    },
    compileDiagnostics: CompiledNodeGraph["diagnostics"],
    violation: NodeGraphBudgetViolation,
  ): NodeGraphExecutionResult {
    const diagnostic: NodeGraphDiagnostic = {
      severity: "error",
      code: violation.reasonCode,
      message: violation.message,
    };
    return {
      graphRun: null,
      status: "failed",
      nodeOutputs: {},
      nodeRuns: [],
      pendingOutputDispatchRequests: [],
      diagnostics: [...compileDiagnostics, diagnostic],
      trace: {
        ...baseTrace,
        compileDiagnostics: [...baseTrace.compileDiagnostics, diagnostic],
        statusCounts: emptyStatusCounts(),
        failedNodes: [],
        outputDispatchRefs: [],
        nestedJobRefs: [],
        error: violation.reasonCode,
      },
    };
  }

  private async executeNode(input: {
    document: NodeGraphDocument;
    compiled: CompiledNodeGraph;
    context: NodeGraphRuntimeContext;
    node: NodeGraphNode;
    nodeOutputs: Map<string, NodeGraphNodeRunOutput>;
  }): Promise<NodeGraphExecutedNodeRun> {
    const { document, compiled, context, node, nodeOutputs } = input;
    const startedAt = Date.now();
    const incomingEdges = compiled.incomingEdgesByNodeId.get(node.id) ?? [];
    const inputs = this.resolveInputs(node, incomingEdges, nodeOutputs);
    const inputHash = hashUnknown(inputs);

    if (node.enabled === false) {
      const output: NodeGraphNodeRunOutput = {
        diagnostics: [{
          severity: "info",
          code: "node_graph_node_skipped_disabled",
          message: `Node '${node.id}' is disabled.`,
          nodeId: node.id,
        }],
      };
      return this.nodeRun(node, "skipped", output, inputHash, startedAt);
    }

    const cached = context.cachedNodeOutputs?.[node.id];
    if (cached && this.shouldReuseCachedOutput(node, context)) {
      const output = {
        ...cached,
        preview: cached.preview ? { ...cached.preview, stale: true, source: "cached" as const } : undefined,
      };
      return this.nodeRun(node, "reused", output, inputHash, startedAt);
    }

    try {
      const handler = this.handlers.get(node.type);
      const output = await handler.execute({
        node,
        inputs,
        context,
      });
      return this.nodeRun(node, "succeeded", output, inputHash, startedAt);
    } catch (error) {
      return this.handleNodeFailure(document, node, error, inputHash, startedAt);
    }
  }

  private handleNodeFailure(
    document: NodeGraphDocument,
    node: NodeGraphNode,
    error: unknown,
    inputHash: string,
    startedAt: number,
  ): NodeGraphExecutedNodeRun {
    const policy = this.failurePolicyFor(document, node);
    const diagnostics = diagnosticsFromError(error, node);
    switch (policy) {
      case "fail_open": {
        return this.nodeRun(node, "failed", {
          diagnostics,
          outputs: { diagnostics },
          preview: {
            kind: "diagnostics",
            title: "Node failed open",
            value: diagnostics,
            source: "synthetic",
          },
        }, inputHash, startedAt);
      }
      case "skip": {
        return this.nodeRun(node, "skipped", {
          diagnostics,
          outputs: { diagnostics },
          preview: {
            kind: "diagnostics",
            title: "Node skipped after failure",
            value: diagnostics,
            source: "synthetic",
          },
        }, inputHash, startedAt);
      }
      case "use_default": {
        return this.nodeRun(node, "succeeded", defaultOutputFor(node, diagnostics), inputHash, startedAt);
      }
      case "fail_closed":
      default: {
        return this.nodeRun(node, "failed", {
          diagnostics,
          outputs: { diagnostics },
          preview: {
            kind: "diagnostics",
            title: "Node failed",
            value: diagnostics,
            source: "synthetic",
          },
        }, inputHash, startedAt);
      }
    }
  }

  private failurePolicyFor(document: NodeGraphDocument, node: NodeGraphNode): NodeGraphFailurePolicy {
    return node.failurePolicy ?? document.policies.defaultFailurePolicy ?? "fail_closed";
  }

  private shouldReuseCachedOutput(node: NodeGraphNode, context: NodeGraphRuntimeContext): boolean {
    if (node.retryPolicy === "never_reuse" || node.retryPolicy === "always_rerun_per_page") {
      return false;
    }
    return node.retryPolicy === "reuse_if_inputs_same"
      || (context.dryRun && node.previewPolicy === "cached_only");
  }

  private nodeRun(
    node: NodeGraphNode,
    status: NodeGraphNodeRunStatus,
    output: NodeGraphNodeRunOutput,
    inputHash: string | null,
    startedAt: number,
  ): NodeGraphExecutedNodeRun {
    return {
      nodeId: node.id,
      phase: node.phase,
      status,
      inputHash,
      outputHash: hashUnknown(output.value ?? output.outputs ?? output.preview ?? output.diagnostics ?? null),
      output,
      diagnostics: output.diagnostics ?? null,
      startedAt,
      finishedAt: Date.now(),
    };
  }

  private resolveInputs(
    node: NodeGraphNode,
    incomingEdges: readonly NodeGraphEdge[],
    nodeOutputs: Map<string, NodeGraphNodeRunOutput>,
  ): NodeGraphNodeInputs {
    const inputs: NodeGraphNodeInputs = {};
    for (const edge of incomingEdges) {
      const sourceOutput = nodeOutputs.get(edge.from.nodeId);
      const value = sourceOutput?.outputs && Object.prototype.hasOwnProperty.call(sourceOutput.outputs, edge.from.port)
        ? sourceOutput.outputs[edge.from.port]
        : sourceOutput?.value ?? sourceOutput?.preview?.value;
      const current = inputs[edge.to.port];
      if (current === undefined) {
        inputs[edge.to.port] = value;
      } else if (Array.isArray(current)) {
        current.push(value);
      } else {
        inputs[edge.to.port] = [current, value];
      }
    }
    if (incomingEdges.length === 0) {
      inputs.__node_id = node.id;
    }
    return inputs;
  }
}

function emptyStatusCounts(): Record<NodeGraphNodeRunStatus, number> {
  return {
    skipped: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    reused: 0,
  };
}

function countStatuses(nodeRuns: readonly NodeGraphExecutedNodeRun[]): Record<NodeGraphNodeRunStatus, number> {
  const counts = emptyStatusCounts();
  for (const run of nodeRuns) {
    counts[run.status] += 1;
  }
  return counts;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function diagnosticsFromError(error: unknown, node: NodeGraphNode): NodeGraphDiagnostic[] {
  if (error instanceof NodeGraphNodeExecutionError && error.diagnostics.length > 0) {
    return error.diagnostics;
  }
  if (isRecord(error) && Array.isArray(error.diagnostics)) {
    return error.diagnostics as NodeGraphDiagnostic[];
  }
  const code = error instanceof NodeGraphNodeExecutionError
    ? error.code
    : isRecord(error) && typeof error.code === "string"
      ? error.code
      : "node_graph_node_execution_failed";
  const message = error instanceof Error ? error.message : String(error);
  return [{
    severity: "error",
    code,
    message,
    nodeId: node.id,
  }];
}

function defaultOutputFor(node: NodeGraphNode, diagnostics: NodeGraphDiagnostic[]): NodeGraphNodeRunOutput {
  const config = isRecord(node.config) ? node.config : {};
  const value = config.defaultOutput ?? config.defaultValue ?? config.fallbackValue ?? null;
  return {
    value,
    outputs: {
      value,
      diagnostics,
    },
    diagnostics,
    preview: {
      kind: typeof value === "string" ? "text" : "json",
      title: "Default output",
      value,
      source: "synthetic",
    },
  };
}

function collectPendingOutputDispatchRequests(
  nodeRuns: readonly NodeGraphExecutedNodeRun[],
): NodeGraphPendingOutputDispatchRequest[] {
  const requests: NodeGraphPendingOutputDispatchRequest[] = [];
  for (const run of nodeRuns) {
    const request = readPendingDispatchRequest(run.output);
    if (request) {
      requests.push({ nodeId: run.nodeId, request });
    }
  }
  return requests;
}

function readPendingDispatchRequest(output: NodeGraphNodeRunOutput): AgentOutputDispatchRequest | null {
  const candidates = [
    output.value,
    output.outputs?.record,
    output.outputs?.proposal,
  ];
  for (const candidate of candidates) {
    if (isRecord(candidate) && isRecord(candidate.pendingDispatchRequest)) {
      return candidate.pendingDispatchRequest as unknown as AgentOutputDispatchRequest;
    }
  }
  return null;
}

function collectNestedJobRefs(nodeRuns: readonly NodeGraphExecutedNodeRun[]): NodeGraphNestedJobTraceRef[] {
  const refs: NodeGraphNestedJobTraceRef[] = [];
  for (const run of nodeRuns) {
    const route = isRecord(run.output.outputs?.result) ? run.output.outputs.result : run.output.value;
    if (!isRecord(route) || route.kind !== "background_job" || !isRecord(route.result)) {
      continue;
    }
    if (route.result.status === "enqueued" && typeof route.result.jobId === "string") {
      refs.push({
        nodeId: run.nodeId,
        jobId: route.result.jobId,
        medium: "background_job",
        created: route.result.created === true,
        dryRun: route.result.dryRun === true,
      });
    }
  }
  return refs;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function hashUnknown(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableStringify(value)).digest("hex")}`;
}
