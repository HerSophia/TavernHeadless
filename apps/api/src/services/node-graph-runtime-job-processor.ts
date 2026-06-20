import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { NodeGraphDocument } from "@tavern/core";

import { nodeGraphDefinitions, nodeGraphVersions } from "../db/schema.js";
import { NodeGraphCheckpointService } from "./node-graph-checkpoint-service.js";
import {
  NodeGraphRunService,
  type NodeGraphRunRecord,
} from "./node-graph-run-service.js";
import { AgentOutputDispatcher } from "./agent-runtime/agent-output-dispatcher.js";
import { DerivedOutputService } from "./derived-output-service.js";
import { ProjectInboxService } from "./project-inbox-service.js";
import {
  NODE_GRAPH_RUN_JOB_TYPE,
  type NodeGraphRunJobPayload,
} from "./node-graph-runtime-job-definitions.js";
import { RuntimeJobFatalError } from "./runtime-job-errors.js";
import { RuntimeJobProcessorRegistry } from "./runtime-job-processor-registry.js";
import type {
  RuntimeJobCommitContext,
  RuntimeJobCommitResult,
  RuntimeJobPrepareContext,
  RuntimeJobProcessor,
} from "./runtime-job-types.js";
import {
  createDefaultNodeGraphExecutor,
  isNodeGraphOutputTargetAllowedByManifest,
  resolveNodeGraphManifestOutputTargets,
  NODE_GRAPH_OUTPUT_TARGET_NOT_IN_MANIFEST_REASON,
  type NodeGraphOutputDispatchTraceRef,
  type NodeGraphExecutionResult,
} from "./node-graph-runtime/index.js";
import type { AgentExecutorRouter } from "./agent-runtime/agent-executor-router.js";
import { OperationLogService } from "./operation-log-service.js";
import { GOVERNANCE_OPERATION_ACTIONS } from "./governance/operation-log-names.js";
import {
  attachNodeGraphRunGovernanceTraceSummary,
  normalizeReasonCode,
} from "./governance/trace-summary.js";

export type NodeGraphRunJobPrepared = {
  execution: NodeGraphExecutionResult;
  nodePhases: Record<string, string>;
  /** R6-1 nested lineage（缺口 3）：prepare 阶段预生成的 graph run id，供 commit 与子 job 双向引用。 */
  graphRunId: string;
  /**
   * R6-3 manifest 运行时强制（缺口 6）：图自身声明的输出目标允许列表。
   * null 表示未声明 manifest 级收窄，commit 退化为仅依赖全局输出策略。
   */
  manifestOutputTargets: string[] | null;
};

export type NodeGraphRunJobResult = {
  graphRunId: string | null;
  status: NodeGraphExecutionResult["status"];
  nodeCount: number;
  outputCount: number;
};

export type NodeGraphRuntimeJobProcessorDeps = {
  agentRouter?: AgentExecutorRouter;
};

function parseDocument(json: string): NodeGraphDocument {
  return JSON.parse(json) as NodeGraphDocument;
}

function createCommitDispatcher(tx: RuntimeJobCommitContext<NodeGraphRunJobPayload, NodeGraphRunJobPrepared>["tx"]): AgentOutputDispatcher {
  return new AgentOutputDispatcher({
    derivedOutput: new DerivedOutputService(tx as never),
    projectInbox: new ProjectInboxService(tx as never),
  });
}

export class NodeGraphRuntimeJobProcessor
  implements RuntimeJobProcessor<NodeGraphRunJobPayload, NodeGraphRunJobPrepared, NodeGraphRunJobResult>
{
  constructor(private readonly deps: NodeGraphRuntimeJobProcessorDeps = {}) {}

  async prepare(
    context: RuntimeJobPrepareContext<NodeGraphRunJobPayload>,
  ): Promise<NodeGraphRunJobPrepared> {
    const { payload, db } = context;
    const version = db
      .select({
        id: nodeGraphVersions.id,
        graphId: nodeGraphVersions.graphId,
        documentJson: nodeGraphVersions.documentJson,
        accountId: nodeGraphDefinitions.accountId,
        workspaceId: nodeGraphDefinitions.workspaceId,
        projectId: nodeGraphDefinitions.projectId,
      })
      .from(nodeGraphVersions)
      .innerJoin(nodeGraphDefinitions, eq(nodeGraphVersions.graphId, nodeGraphDefinitions.id))
      .where(and(
        eq(nodeGraphVersions.id, payload.graphVersionId),
        eq(nodeGraphDefinitions.id, payload.graphId),
        eq(nodeGraphDefinitions.accountId, payload.accountId),
        eq(nodeGraphDefinitions.workspaceId, payload.workspaceId),
        eq(nodeGraphDefinitions.projectId, payload.projectId),
      ))
      .limit(1)
      .get();

    if (!version) {
      throw new RuntimeJobFatalError("node_graph_version_not_found");
    }

    const document = parseDocument(version.documentJson);
    const nodePhases = Object.fromEntries(document.nodes.map((node) => [node.id, node.phase]));
    // R6-1（缺口 3）：run id 在 prepare 阶段预生成，让 `agent.call` 入队的后台 job
    // 能携带 parent_run_id / root_run_id，与 commit 写入的 graph run 行保持同一 id。
    const graphRunId = `ngrun_${nanoid(12)}`;
    const dryRun = payload.dryRun || payload.intent === "dry_run" || payload.intent === "preview";
    // NG2-CORE：真实 PageRun 才复用 floor checkpoint；dry-run / preview 不复用持久 checkpoint。
    const floorCheckpoints = !dryRun && payload.floorId
      ? new NodeGraphCheckpointService(db).loadFloorCheckpoints({
          accountId: payload.accountId,
          floorId: payload.floorId,
          graphVersionId: version.id,
        })
      : undefined;
    const executor = createDefaultNodeGraphExecutor();
    const execution = await executor.execute({
      document,
      graphVersionId: version.id,
      ...(floorCheckpoints ? { floorCheckpoints } : {}),
      context: {
        accountId: payload.accountId,
        workspaceId: payload.workspaceId,
        projectId: payload.projectId,
        sessionId: payload.sessionId ?? null,
        floorId: payload.floorId ?? null,
        pageId: payload.pageId ?? null,
        actorClientId: payload.actorClientId ?? null,
        intent: payload.intent,
        dryRun,
        input: payload.inputJson,
        userInput: typeof payload.inputJson.user_input === "string" ? payload.inputJson.user_input : undefined,
        chatHistory: Array.isArray(payload.inputJson.chat_history)
          ? payload.inputJson.chat_history as Array<{ role: string; content: string }>
          : undefined,
        graphRunId,
        graphVersionId: version.id,
        rootRunId: graphRunId,
        ...(this.deps.agentRouter ? { agentRouter: this.deps.agentRouter } : {}),
      },
    });

    return {
      execution,
      nodePhases,
      graphRunId,
      manifestOutputTargets: resolveNodeGraphManifestOutputTargets(document),
    };
  }

  commit(
    context: RuntimeJobCommitContext<NodeGraphRunJobPayload, NodeGraphRunJobPrepared>,
  ): RuntimeJobCommitResult<NodeGraphRunJobResult> {
    const { tx, payload, prepared, completedAt } = context;
    const runService = new NodeGraphRunService(tx);
    const execution = prepared.execution;
    const dispatcher = createCommitDispatcher(tx);
    const shouldDispatch = !payload.dryRun && execution.status === "succeeded";
    // R6-3（缺口 6）：manifest 运行时强制。图自身声明了 outputTargets 时，
    // 不在白名单内的持久输出目标被拒绝（不派发、写 output_rejected），
    // 不再只依赖全局 assertAllowedOutputTargets 兜底。
    const rejectedNodeIds = new Set<string>();
    const outputDispatchResults = !shouldDispatch
      ? []
      : execution.pendingOutputDispatchRequests.flatMap(({ nodeId, request }) => {
          if (!isNodeGraphOutputTargetAllowedByManifest(prepared.manifestOutputTargets, request.target)) {
            rejectedNodeIds.add(nodeId);
            return [];
          }
          return [{ nodeId, result: dispatcher.dispatchSync(request) }];
        });
    const outputDispatchRefs: NodeGraphOutputDispatchTraceRef[] = [
      ...execution.trace.outputDispatchRefs.filter((ref) => ref.status !== "pending"),
      ...execution.pendingOutputDispatchRequests.map(({ nodeId, request }): NodeGraphOutputDispatchTraceRef => {
        const dispatched = outputDispatchResults.find((result) => result.nodeId === nodeId);
        if (dispatched) {
          return { nodeId, target: request.target, status: "dispatched", result: dispatched.result };
        }
        if (rejectedNodeIds.has(nodeId)) {
          return {
            nodeId,
            target: request.target,
            status: "rejected",
            reason: NODE_GRAPH_OUTPUT_TARGET_NOT_IN_MANIFEST_REASON,
          };
        }
        return {
          nodeId,
          target: request.target,
          status: payload.dryRun ? "planned" : "pending",
        };
      }),
    ];
    let graphRun: NodeGraphRunRecord | null = null;
    // R6-1（缺口 3）：复用 prepare 阶段预生成的 run id，保证与已入队子 job 的 parent_run_id 一致。
    const graphRunId = prepared.graphRunId;
    const trace = attachNodeGraphRunGovernanceTraceSummary({
      trace: {
        ...execution.trace,
        outputDispatchRefs,
        outputDispatchResults,
      },
      graphRunId,
      graphId: payload.graphId,
      graphVersionId: payload.graphVersionId,
      accountId: payload.accountId,
      workspaceId: payload.workspaceId,
      projectId: payload.projectId,
      sessionId: payload.sessionId ?? null,
      floorId: payload.floorId ?? null,
      pageId: payload.pageId ?? null,
      jobId: context.job.id,
      jobType: context.job.jobType,
      status: execution.status,
      intent: payload.intent,
      dryRun: payload.dryRun,
      preview: payload.intent === "preview",
      finishedAt: completedAt,
    });

    graphRun = runService.createRun({
      id: graphRunId,
      accountId: payload.accountId,
      workspaceId: payload.workspaceId,
      projectId: payload.projectId,
      sessionId: payload.sessionId ?? null,
      floorId: payload.floorId ?? null,
      pageId: payload.pageId ?? null,
      graphId: payload.graphId,
      graphVersionId: payload.graphVersionId,
      intent: payload.intent,
      status: execution.status,
      trace,
      now: completedAt,
    });

    for (const nodeRun of execution.nodeRuns) {
      runService.appendNodeRun({
        graphRunId: graphRun.id,
        nodeId: nodeRun.nodeId,
        phase: prepared.nodePhases[nodeRun.nodeId] ?? nodeRun.phase,
        status: nodeRun.status,
        inputHash: nodeRun.inputHash ?? null,
        outputHash: nodeRun.outputHash ?? null,
        output: nodeRun.output,
        diagnostics: nodeRun.diagnostics ?? null,
        startedAt: nodeRun.startedAt ?? completedAt,
        finishedAt: nodeRun.finishedAt ?? completedAt,
      });
    }

    // NG2-CORE：持久化 floor checkpoint（仅真实运行 + 有 floorId）。对 floor-eligible 且本次
    // succeeded / reused 的节点 upsert，即使整体 run 失败，也保留 pre-response 已算节点供下次重试复用。
    const isDryRun = payload.dryRun || payload.intent === "dry_run" || payload.intent === "preview";
    if (!isDryRun && payload.floorId) {
      const checkpointService = new NodeGraphCheckpointService(tx);
      for (const nodeRun of execution.nodeRuns) {
        if (!nodeRun.checkpointEligible) {
          continue;
        }
        if (nodeRun.status !== "succeeded" && nodeRun.status !== "reused") {
          continue;
        }
        if (!nodeRun.inputHash || !nodeRun.configHash) {
          continue;
        }
        checkpointService.saveCheckpoint({
          accountId: payload.accountId,
          workspaceId: payload.workspaceId,
          projectId: payload.projectId,
          sessionId: payload.sessionId ?? null,
          floorId: payload.floorId,
          graphId: payload.graphId,
          graphVersionId: payload.graphVersionId,
          nodeId: nodeRun.nodeId,
          phase: prepared.nodePhases[nodeRun.nodeId] ?? nodeRun.phase,
          scope: nodeRun.scope ?? null,
          inputHash: nodeRun.inputHash,
          configHash: nodeRun.configHash,
          output: nodeRun.output,
          now: completedAt,
        });
      }
    }

    // R6-1（缺口 1）：graph run 运行级 operation log。只记录摘要 / reason code / 副作用计数，
    // 不写入完整 prompt、node output 或工具结果。
    this.appendRunOperationLogs({
      tx,
      payload,
      job: context.job,
      graphRunId: graphRun.id,
      status: execution.status,
      trace,
      outputDispatchRefs,
      now: completedAt,
    });

    return {
      phase: "completed",
      result: {
        graphRunId: graphRun.id,
        status: execution.status,
        nodeCount: Object.keys(execution.nodeOutputs).length,
        outputCount: outputDispatchResults.length,
      },
      progressCurrent: 1,
      progressTotal: 1,
      progressMessage: "NodeGraph run completed",
      scopeMutation: "changed",
      scopeMetadata: {
        lastGraphRunId: graphRun.id,
        status: execution.status,
      },
      lastProcessedAt: completedAt,
    };
  }

  /**
   * R6-1（缺口 1）：写 graph run 运行级 operation log。
   *
   * - 成功写 `node_graph_run.run`，失败写 `node_graph_run.failed`（带 failedNodeId 与 reason code）；
   * - commit 真实派发的持久输出写 `node_graph_run.output_dispatched`；
   * - 被拒输出写 `node_graph_run.output_rejected`（manifest 运行时强制由 R6-3 收口，这里预接线）。
   *
   * operation log 只保存摘要、reason code 与副作用计数，不写入 node output / prompt / 工具结果正文。
   */
  private appendRunOperationLogs(input: {
    tx: RuntimeJobCommitContext<NodeGraphRunJobPayload, NodeGraphRunJobPrepared>["tx"];
    payload: NodeGraphRunJobPayload;
    job: { id: string };
    graphRunId: string;
    status: NodeGraphExecutionResult["status"];
    trace: Record<string, unknown>;
    outputDispatchRefs: NodeGraphOutputDispatchTraceRef[];
    now: number;
  }): void {
    const operationLog = new OperationLogService(input.tx);
    const reasonCode = readTraceString(input.trace.reason_code)
      ?? normalizeReasonCode(input.status === "succeeded" ? "succeeded" : "failed");
    const diagnostics = isRecord(input.trace.diagnostics) ? input.trace.diagnostics : {};
    const failedNodeId = readTraceString(diagnostics.failed_node_id);
    const actorType = input.payload.actorClientId ? "client" : "system";
    const actorId = input.payload.actorClientId ?? "node_graph_runtime";

    operationLog.append({
      accountId: input.payload.accountId,
      actorType,
      actorId,
      sourceType: "node_graph_runtime",
      action: input.status === "succeeded"
        ? GOVERNANCE_OPERATION_ACTIONS.nodeGraphRun.run
        : GOVERNANCE_OPERATION_ACTIONS.nodeGraphRun.failed,
      status: input.status === "succeeded" ? "succeeded" : "failed",
      workspaceId: input.payload.workspaceId,
      projectId: input.payload.projectId,
      sessionId: input.payload.sessionId ?? null,
      floorId: input.payload.floorId ?? null,
      actorClientId: input.payload.actorClientId ?? null,
      runId: input.graphRunId,
      targetType: "node_graph_run",
      targetId: input.graphRunId,
      reason: reasonCode,
      metadata: {
        graph_id: input.payload.graphId,
        graph_version_id: input.payload.graphVersionId,
        job_id: input.job.id,
        intent: input.payload.intent,
        dry_run: input.payload.dryRun,
        reason_code: reasonCode,
        ...(failedNodeId ? { failed_node_id: failedNodeId } : {}),
        status_counts: isRecord(input.trace.statusCounts) ? input.trace.statusCounts : null,
        side_effects: isRecord(input.trace.side_effects) ? input.trace.side_effects : null,
      },
      createdAt: input.now,
    });

    for (const ref of input.outputDispatchRefs) {
      if (ref.status === "dispatched") {
        operationLog.append({
          accountId: input.payload.accountId,
          actorType,
          actorId,
          sourceType: "node_graph_runtime",
          action: GOVERNANCE_OPERATION_ACTIONS.nodeGraphRun.outputDispatched,
          status: "succeeded",
          workspaceId: input.payload.workspaceId,
          projectId: input.payload.projectId,
          sessionId: input.payload.sessionId ?? null,
          floorId: input.payload.floorId ?? null,
          actorClientId: input.payload.actorClientId ?? null,
          runId: input.graphRunId,
          targetType: "node_graph_run_output",
          targetId: input.graphRunId,
          reason: ref.target,
          metadata: {
            graph_run_id: input.graphRunId,
            node_id: ref.nodeId,
            target: ref.target,
            output_ref: extractOutputRefId(ref.result),
          },
          createdAt: input.now,
        });
      } else if (ref.status === "rejected") {
        operationLog.append({
          accountId: input.payload.accountId,
          actorType,
          actorId,
          sourceType: "node_graph_runtime",
          action: GOVERNANCE_OPERATION_ACTIONS.nodeGraphRun.outputRejected,
          status: "denied",
          workspaceId: input.payload.workspaceId,
          projectId: input.payload.projectId,
          sessionId: input.payload.sessionId ?? null,
          floorId: input.payload.floorId ?? null,
          actorClientId: input.payload.actorClientId ?? null,
          runId: input.graphRunId,
          targetType: "node_graph_run_output",
          targetId: input.graphRunId,
          reason: ref.reason ?? ref.target,
          metadata: {
            graph_run_id: input.graphRunId,
            node_id: ref.nodeId,
            target: ref.target,
            reason_code: ref.reason ?? NODE_GRAPH_OUTPUT_TARGET_NOT_IN_MANIFEST_REASON,
          },
          createdAt: input.now,
        });
      }
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readTraceString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function extractOutputRefId(result: unknown): string | null {
  if (!isRecord(result)) {
    return null;
  }
  if (isRecord(result.record) && typeof result.record.id === "string") {
    return result.record.id;
  }
  if (typeof result.proposalId === "string") {
    return result.proposalId;
  }
  if (typeof result.injectionId === "string") {
    return result.injectionId;
  }
  return null;
}

export function createNodeGraphRuntimeJobProcessorRegistry(
  deps: NodeGraphRuntimeJobProcessorDeps = {},
): RuntimeJobProcessorRegistry {
  const registry = new RuntimeJobProcessorRegistry();
  registry.register(NODE_GRAPH_RUN_JOB_TYPE, new NodeGraphRuntimeJobProcessor(deps));
  return registry;
}
