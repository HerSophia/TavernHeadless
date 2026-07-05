import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { NodeGraphDiagnostic, NodeGraphDocument } from "@tavern/core";
import {
  BUILTIN_ADVISOR_SUBGRAPH_VERSION,
  DEFAULT_NODE_GRAPH_RUNTIME_BUDGET,
  findNodeGraphPersistentOutputNodeIds,
  getBuiltinAdvisorSubgraphById,
  isBuiltinAdvisorSubgraphId,
  NODE_GRAPH_SUBGRAPH_PERSISTENT_OUTPUT_FORBIDDEN_CODE,
  resolveNodeGraphBudget,
} from "@tavern/core";

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
  type NodeGraphExecutedNodeRun,
  type NodeGraphSubgraphRunner,
  type NodeGraphSubgraphRunResult,
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
  /**
   * NG2-13：prepare 阶段收集的 `group.node` 子图持久 child run 记录，
   * 由 commit 与主 run 同一 tx 原子落库（守住 prepare 纯计算 / commit 落库边界）。
   */
  childRunRecords: ChildGraphRunRecord[];
};

/**
 * NG2-13：`group.node` 子图持久 child run 记录（prepare 收集 → commit 落库）。
 *
 * 方案 A 已禁止子图持久 `output.*` 写节点，故 child run 恒零派发。血缘沿用 trace_json：
 * `parent_run_id` = 直接父图 run id、`root_run_id` = 顶层主 run、`run_role="subgraph"`、
 * `parent_node_id` = 触发子图的 `group.node`、`subgraph_ref` = 权威子图身份。
 */
export type ChildGraphRunRecord = {
  /** 生成的 child graph run id（`ngrun_...`，与主链 run id 生成一致）。 */
  childGraphRunId: string;
  /**
   * `node_graph_run.graphId` 列值（FK-safe）：用户子图 = 子图定义 id；
   * 内置顾问子图在 DB 无定义行，回退父图 id 避免外键违例（真实身份见 `subgraphRef`）。
   */
  graphId: string;
  /** `node_graph_run.graphVersionId` 列值（FK-safe）：用户子图 = 子图版本 id；内置顾问子图 = 父图版本 id。 */
  graphVersionId: string;
  /** 权威子图身份，写入 trace.subgraph_ref（内置顾问子图 = 内置 id / `builtin:...`）。 */
  subgraphRef: { graphId: string; graphVersionId: string | null };
  /** 直接父图的 graphRunId（多层子图逐层指向直接父，形成链）。 */
  parentRunId: string;
  /** 顶层主 run 的 graphRunId。 */
  rootRunId: string;
  /** 父图中触发该子图的 `group.node` 节点 id。 */
  parentNodeId: string | null;
  status: "succeeded" | "failed";
  nodeRuns: NodeGraphExecutedNodeRun[];
  /** child 执行 trace（供 attachNodeGraphRunGovernanceTraceSummary 提炼摘要）。 */
  trace: NodeGraphExecutionResult["trace"];
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
    // SG11-3：父图 manifest 声明的可用权限集合，供内置顾问子图引用解析做权限上卷校验。
    const availablePermissions = new Set<string>(document.permissions?.required ?? []);
    // NG2-β：注入子图递归运行器（加载子图版本 + 嵌套 executor + 边界 I/O 映射 + 环检测）。
    // SG11-3：`ref.graphId` 命中内置 id（`system.subgraph.*`）时从内置注册表加载，否则查 DB。
    const { runner: subgraphRunner, childRunRecords } = buildSubgraphRunner({ db, payload, executor, availablePermissions });
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
        budget: resolveNodeGraphBudget(DEFAULT_NODE_GRAPH_RUNTIME_BUDGET, document.budgets),
        subgraphRunner,
        subgraphStack: [payload.graphId],
        ...(this.deps.agentRouter ? { agentRouter: this.deps.agentRouter } : {}),
      },
    });

    return {
      execution,
      nodePhases,
      graphRunId,
      manifestOutputTargets: resolveNodeGraphManifestOutputTargets(document),
      childRunRecords,
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

    // NG2-13：子图持久血缘落库。遍历 prepare 收集的 child run 记录，与主 run 同一 tx 原子落库：
    // 每条 createRun（trace 带 run_role="subgraph"、parent_run_id、root_run_id、parent_node_id、subgraph_ref）
    // + 逐 child node run appendNodeRun。方案 A 已禁止子图持久 output.*，故 child run 恒零派发。
    // 内置顾问子图的 FK 列已在 prepare 回退到父图（graphId/graphVersionId），避免外键违例。
    for (const child of prepared.childRunRecords) {
      const childTrace = attachNodeGraphRunGovernanceTraceSummary({
        trace: child.trace,
        graphRunId: child.childGraphRunId,
        graphId: child.graphId,
        graphVersionId: child.graphVersionId,
        accountId: payload.accountId,
        workspaceId: payload.workspaceId,
        projectId: payload.projectId,
        sessionId: payload.sessionId ?? null,
        floorId: payload.floorId ?? null,
        pageId: payload.pageId ?? null,
        jobId: context.job.id,
        jobType: context.job.jobType,
        rootRunId: child.rootRunId,
        parentRunId: child.parentRunId,
        runRole: "subgraph",
        parentNodeId: child.parentNodeId,
        subgraphRef: { graphId: child.subgraphRef.graphId, graphVersionId: child.subgraphRef.graphVersionId },
        status: child.status,
        intent: payload.intent,
        dryRun: payload.dryRun,
        preview: payload.intent === "preview",
        finishedAt: completedAt,
      });
      const childRun = runService.createRun({
        id: child.childGraphRunId,
        accountId: payload.accountId,
        workspaceId: payload.workspaceId,
        projectId: payload.projectId,
        sessionId: payload.sessionId ?? null,
        floorId: payload.floorId ?? null,
        pageId: payload.pageId ?? null,
        graphId: child.graphId,
        graphVersionId: child.graphVersionId,
        intent: payload.intent,
        status: child.status,
        trace: childTrace,
        now: completedAt,
      });
      for (const nodeRun of child.nodeRuns) {
        runService.appendNodeRun({
          graphRunId: childRun.id,
          nodeId: nodeRun.nodeId,
          phase: nodeRun.phase,
          status: nodeRun.status,
          inputHash: nodeRun.inputHash ?? null,
          outputHash: nodeRun.outputHash ?? null,
          output: nodeRun.output,
          diagnostics: nodeRun.diagnostics ?? null,
          startedAt: nodeRun.startedAt ?? completedAt,
          finishedAt: nodeRun.finishedAt ?? completedAt,
        });
      }
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

/** NG2-β：子图引用最大嵌套深度（防止过深 / 间接环引发的栈/预算放大）。 */
const MAX_SUBGRAPH_DEPTH = 8;

function subgraphFailure(code: string, message: string): NodeGraphSubgraphRunResult {
  return { status: "failed", outputsByPort: {}, diagnostics: [{ severity: "error", code, message }] };
}

/** 在同租户范围内加载子图版本文档（指定 versionId 则锁定，否则取当前版本）。 */
function loadSubgraphVersion(
  db: RuntimeJobPrepareContext<NodeGraphRunJobPayload>["db"],
  payload: NodeGraphRunJobPayload,
  ref: { graphId: string; versionId?: string },
): { document: NodeGraphDocument; versionId: string } | null {
  const tenant = and(
    eq(nodeGraphDefinitions.id, ref.graphId),
    eq(nodeGraphDefinitions.accountId, payload.accountId),
    eq(nodeGraphDefinitions.workspaceId, payload.workspaceId),
    eq(nodeGraphDefinitions.projectId, payload.projectId),
  );
  if (ref.versionId) {
    const row = db
      .select({ id: nodeGraphVersions.id, documentJson: nodeGraphVersions.documentJson })
      .from(nodeGraphVersions)
      .innerJoin(nodeGraphDefinitions, eq(nodeGraphVersions.graphId, nodeGraphDefinitions.id))
      .where(and(eq(nodeGraphVersions.id, ref.versionId), eq(nodeGraphVersions.graphId, ref.graphId), tenant))
      .limit(1)
      .get();
    return row ? { document: parseDocument(row.documentJson), versionId: row.id } : null;
  }
  const definition = db
    .select({ currentVersionId: nodeGraphDefinitions.currentVersionId })
    .from(nodeGraphDefinitions)
    .where(tenant)
    .limit(1)
    .get();
  if (!definition?.currentVersionId) {
    return null;
  }
  const row = db
    .select({ id: nodeGraphVersions.id, documentJson: nodeGraphVersions.documentJson })
    .from(nodeGraphVersions)
    .where(eq(nodeGraphVersions.id, definition.currentVersionId))
    .limit(1)
    .get();
  return row ? { document: parseDocument(row.documentJson), versionId: row.id } : null;
}

/**
 * 构造生产级 `subgraphRunner`：被 `group.node` handler 调用，加载被引用子图并以**嵌套执行（nested execution）**
 * 复用同一 executor 递归执行；当前不创建持久 child `node_graph_run` / 血缘（持久血缘属 NG2-13）。把实例输入端口值（按 portName）经 `context.input` 喂给子图 `group.input`，
 * 再把子图 `group.output` 的值按 portName 映射回实例输出端口。含引用环检测与深度上限。
 */
function buildSubgraphRunner(input: {
    db: RuntimeJobPrepareContext<NodeGraphRunJobPayload>["db"];
  payload: NodeGraphRunJobPayload;
  executor: ReturnType<typeof createDefaultNodeGraphExecutor>;
  /** SG11-3：父图 manifest 声明的可用权限，用于内置顾问子图引用的权限上卷校验。 */
  availablePermissions: Set<string>;
}): { runner: NodeGraphSubgraphRunner; childRunRecords: ChildGraphRunRecord[] } {
  const { db, payload, executor, availablePermissions } = input;
  // NG2-13：prepare 阶段累加子图 child run 记录（不写库）；由 prepare 上抛、commit 落库。
  const childRunRecords: ChildGraphRunRecord[] = [];
  const runner: NodeGraphSubgraphRunner = async (subInput, parentContext) => {
    const stack = parentContext.subgraphStack ?? [];
    if (stack.includes(subInput.ref.graphId)) {
      return subgraphFailure(
        "node_graph_subgraph_cycle",
        `Subgraph reference cycle: ${[...stack, subInput.ref.graphId].join(" -> ")}`,
      );
    }
    if (stack.length >= MAX_SUBGRAPH_DEPTH) {
      return subgraphFailure(
        "node_graph_subgraph_depth_exceeded",
        `Subgraph nesting exceeds the maximum depth of ${MAX_SUBGRAPH_DEPTH}.`,
      );
    }
    // SG11-3：内置顾问子图（`system.subgraph.*`）优先从内置注册表解析（无需 fork 进项目 / 不查 DB），
    // 并做权限上卷校验：子图所需权限必须被父图 manifest 声明，否则拒绝运行。
    let loaded: { document: NodeGraphDocument; versionId: string } | null;
    if (isBuiltinAdvisorSubgraphId(subInput.ref.graphId)) {
      const builtin = getBuiltinAdvisorSubgraphById(subInput.ref.graphId);
      if (!builtin) {
        return subgraphFailure("node_graph_subgraph_not_found", `Subgraph definition not found: ${subInput.ref.graphId}`);
      }
      const missing = (builtin.permissions?.required ?? []).filter((permission: string) =>!availablePermissions.has(permission));
      if (missing.length > 0) {
        return subgraphFailure(
          "node_graph_subgraph_permission_not_granted",
          `Builtin subgraph '${subInput.ref.graphId}' requires permissions not granted by the parent graph: ${missing.join(", ")}`,
        );
      }
      loaded = {
        document: builtin,
        versionId: `builtin:${subInput.ref.graphId}:${BUILTIN_ADVISOR_SUBGRAPH_VERSION}`,
      };
    } else {
      loaded = loadSubgraphVersion(db, payload, subInput.ref);
    }
    if (!loaded) {
      return subgraphFailure("node_graph_subgraph_not_found", `Subgraph definition not found: ${subInput.ref.graphId}`);
    }

    // NG2-13 方案 A（缺口 4.5）静态执法：被 `group.node` 引用的子图（含内置顾问子图与用户子图）
    // 不得包含持久 `output.*` 写节点——正史写入只能发生在主图（父图）的单一 CommitGate 边界。
    // 在加载后、执行前拒绝，避免子图旁路 CommitGate 写正史。
    const persistentOutputNodeIds = findNodeGraphPersistentOutputNodeIds(loaded.document);
    if (persistentOutputNodeIds.length > 0) {
      return subgraphFailure(
        NODE_GRAPH_SUBGRAPH_PERSISTENT_OUTPUT_FORBIDDEN_CODE,
        `Subgraph '${subInput.ref.graphId}' contains persistent output write node(s) [${persistentOutputNodeIds.join(", ")}]; persistent history writes must happen at the parent graph's CommitGate, not inside a group.node subgraph.`,
      );
    }

    // NG2-13：为本次子图执行生成 child run id 与血缘元数据（prepare 仅收集，不写库）。
    const childGraphRunId = `ngrun_${nanoid(12)}`;
    const parentRunId = parentContext.graphRunId ?? parentContext.rootRunId ?? childGraphRunId;
    const rootRunId = parentContext.rootRunId ?? parentContext.graphRunId ?? childGraphRunId;
    // 权威子图身份写入 trace.subgraph_ref。内置顾问子图在 DB 中无定义/版本行，若用其合成 id
    // 落 node_graph_run 会违反 graphId/graphVersionId 外键，故 FK 列回退到父图（恒有效），
    // 真实身份仍由 subgraph_ref 记录（供 WB10 展示 / 后续查询）。
    const subgraphRef = { graphId: subInput.ref.graphId, graphVersionId: loaded.versionId };
    const childColumns = isBuiltinAdvisorSubgraphId(subInput.ref.graphId)
      ? { graphId: payload.graphId, graphVersionId: payload.graphVersionId }
      : { graphId: subInput.ref.graphId, graphVersionId: loaded.versionId };
    const recordChildRun = (status: "succeeded" | "failed", execResult: NodeGraphExecutionResult): void => {
      childRunRecords.push({
        childGraphRunId,
        graphId: childColumns.graphId,
        graphVersionId: childColumns.graphVersionId,
        subgraphRef,
        parentRunId,
        rootRunId,
        parentNodeId: subInput.parentNode?.id ?? null,
        status,
        nodeRuns: execResult.nodeRuns,
        trace: execResult.trace,
      });
    };

    const childExecution = await executor.execute({
      document: loaded.document,
      graphVersionId: loaded.versionId,
      context: {
        ...parentContext,
        input: subInput.inputsByPort,
        userInput: undefined,
        chatHistory: undefined,
        graphVersionId: loaded.versionId,
        // NG2-13：把 child run id 作为子图执行上下文的 graphRunId，使更深层嵌套子图能把
        // parent_run_id 指向直接父（逐层成链）；rootRunId 由 spread 保留为顶层 root。
        graphRunId: childGraphRunId,
        budget: resolveNodeGraphBudget(parentContext.budget ?? DEFAULT_NODE_GRAPH_RUNTIME_BUDGET, loaded.document.budgets),
        subgraphStack: [...stack, subInput.ref.graphId],
        subgraphRunner: runner,
      },
    });
    if (childExecution.status !== "succeeded") {
      // NG2-13：失败点也记录 child run（供父子树观测失败子图）。
      recordChildRun("failed", childExecution);
      const diagnostics: NodeGraphDiagnostic[] = childExecution.trace.failedNodes.flatMap((failed) => failed.diagnostics);
      return {
        status: "failed",
        outputsByPort: {},
        diagnostics: diagnostics.length > 0
          ? diagnostics
          : [{ severity: "error", code: "node_graph_subgraph_failed", message: "Subgraph run failed." }],
      };
    }

    // NG2-13 方案 A runtime 兜底（缺口 4.5 修复）：若子图执行仍产出了持久输出派发请求，
    // **不派发、不静默丢弃**，而是显式失败（同一诊断码）。静态执法已在加载后拒绝含 output.* 的子图，
    // 此处作为防御：把「被静默丢弃」变成「显式拒绝」，保证子图零派发、正史入口唯一。
    if (childExecution.pendingOutputDispatchRequests.length > 0) {
      recordChildRun("failed", childExecution);
      return subgraphFailure(
        NODE_GRAPH_SUBGRAPH_PERSISTENT_OUTPUT_FORBIDDEN_CODE,
        `Subgraph '${subInput.ref.graphId}' produced ${childExecution.pendingOutputDispatchRequests.length} persistent output dispatch request(s); subgraphs must not write persistent history (route persistent writes through the parent graph's CommitGate).`,
      );
    }

    // NG2-13：成功点记录 child run（child run 恒零派发，与不变量一致）。
    recordChildRun("succeeded", childExecution);
    const outputsByPort: Record<string, unknown> = {};
    for (const node of loaded.document.nodes) {
      if (node.type !== "group.output") {
        continue;
      }
      const config = isRecord(node.config) ? node.config : {};
      const nodeOutput = childExecution.nodeOutputs[node.id];
      const outs = isRecord(nodeOutput?.outputs) ? nodeOutput.outputs : {};
      if (Array.isArray(config.ports)) {
        // 单 Group Output 多端口：按 portName 回收。
        for (const port of config.ports) {
          const name = isRecord(port) && typeof port.name === "string" ? port.name : null;
          if (name) {
            outputsByPort[name] = outs[name] ?? null;
          }
        }
      } else {
        const portName = typeof config.portName === "string" && config.portName.length > 0 ? config.portName : node.id;
        outputsByPort[portName] = nodeOutput?.value ?? null;
      }
    }
    return { status: "succeeded", outputsByPort };
  };
  return { runner, childRunRecords };
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
