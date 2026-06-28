import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { NodeGraphDocument, NodeGraphNodeRunOutput } from "@tavern/core";
import { z } from "zod";

import type { DatabaseConnection } from "../db/client.js";
import { parseJsonField, parseWithSchema, sendError } from "../lib/http.js";
import { getRequestAuthContext } from "../plugins/auth.js";
import {
  NodeGraphDefinitionService,
  NodeGraphDefinitionServiceError,
  type NodeGraphDefinitionRecord,
  type NodeGraphVersionRecord,
} from "../services/node-graph-definition-service.js";
import {
  NodeGraphPackageService,
  NodeGraphPackageServiceError,
  type PreflightNodeGraphPackageResult,
} from "../services/node-graph-package-service.js";
import { NodeGraphRunService, type NodeGraphNodeRunRecord, type NodeGraphRunRecord } from "../services/node-graph-run-service.js";
import {
  buildNodeGraphRuntimeScopeKey,
  NODE_GRAPH_RUN_JOB_TYPE,
  NODE_GRAPH_RUNTIME_SCOPE_TYPE,
  createNodeGraphRuntimeJobCatalog,
} from "../services/node-graph-runtime-job-definitions.js";
import { createDefaultNodeGraphExecutor, previewNodeGraph } from "../services/node-graph-runtime/index.js";
import {
  DEFAULT_NODE_GRAPH_PROJECT_RUN_CONCURRENCY,
  DEFAULT_NODE_GRAPH_SYNC_PREVIEW_BUDGET,
  checkNodeGraphSyncSizeBudget,
} from "../services/node-graph-runtime/budget.js";
import { countActiveProjectGraphRunJobs } from "../services/node-graph-runtime/concurrency.js";
import { RUNTIME_GOVERNANCE_BUDGET_REASON_CODES } from "../services/governance/runtime-governance-types.js";
import { GOVERNANCE_OPERATION_ACTIONS } from "../services/governance/operation-log-names.js";
import { OperationLogService } from "../services/operation-log-service.js";
import {
  ProjectAccessService,
  ProjectAccessServiceError,
  type ProjectAction,
  type ProjectActorInput,
} from "../services/project-access-service.js";
import { RuntimeJobScheduler } from "../services/runtime-job-scheduler.js";

const projectIdParamsSchema = z.object({ id: z.string().min(1) });
const graphParamsSchema = z.object({
  id: z.string().min(1),
  graph_id: z.string().min(1),
});
const runParamsSchema = z.object({
  id: z.string().min(1),
  run_id: z.string().min(1),
});
const runQueryStringSchema = z.object({
  include_node_output: z.enum(["true", "false", "1", "0"]).optional(),
}).strict();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeGraphDocumentInput(value: unknown): value is NodeGraphDocument {
  if (!isRecord(value)) {
    return false;
  }
  const graphId = value.graphId;
  const policies = value.policies;
  // NG2-CORE：接受 schemaVersion 1（v1）或 2（v2 control edge / checkpoint / system graph）。
  return (value.schemaVersion === 1 || value.schemaVersion === 2)
    && (graphId === undefined || typeof graphId === "string")
    && typeof value.name === "string"
    && value.mode === "native_graph"
    && Array.isArray(value.nodes)
    && Array.isArray(value.edges)
    && (policies === undefined || isRecord(policies));
}

const documentSchema = z.custom<NodeGraphDocument>(
  isNodeGraphDocumentInput,
  "document must be a NodeGraphDocument object",
);

const createGraphBodySchema = z.object({
  name: z.string().min(1).nullable().optional(),
  document: documentSchema,
}).strict();

const createVersionBodySchema = z.object({
  document: documentSchema,
  parent_version_id: z.string().min(1).nullable().optional(),
}).strict();

const validateBodySchema = z.object({
  document: documentSchema.optional(),
}).strict().optional();

const setCurrentVersionBodySchema = z.object({
  version_id: z.string().min(1),
}).strict();

const previewBodySchema = z.object({
  version_id: z.string().min(1).optional(),
  node_id: z.string().min(1).nullable().optional(),
  input_json: z.record(z.string(), z.unknown()).optional(),
  user_input: z.string().optional(),
  chat_history: z.array(z.object({
    role: z.string(),
    content: z.string(),
  }).passthrough()).optional(),
  cached_node_outputs: z.record(z.string(), z.unknown()).optional(),
}).strict().optional();

const runBodySchema = z.object({
  version_id: z.string().min(1).optional(),
  intent: z.enum(["normal", "dry_run", "regenerate", "preview"]).optional(),
  dry_run: z.boolean().optional(),
  input_json: z.record(z.string(), z.unknown()).optional(),
  session_id: z.string().min(1).nullable().optional(),
  floor_id: z.string().min(1).nullable().optional(),
  page_id: z.string().min(1).nullable().optional(),
  dedupe_key: z.string().min(1).nullable().optional(),
}).strict().optional();

// NG2-PKG：package export / import 公共面。
const exportBodySchema = z.object({
  version_id: z.string().min(1).optional(),
  package_version: z.string().min(1).optional(),
}).strict().optional();

const importPreflightBodySchema = z.object({
  package: z.record(z.string(), z.unknown()),
}).strict();

const importBodySchema = z.object({
  package: z.record(z.string(), z.unknown()),
  confirm: z.boolean().optional(),
  name: z.string().min(1).nullable().optional(),
}).strict();

function actorFromRequest(request: FastifyRequest): ProjectActorInput {
  const auth = getRequestAuthContext(request);
  return {
    actorType: auth.actorType,
    actorAccountId: auth.accountId,
    actorClientId: auth.actorType === "client" ? auth.actorClientId : null,
  };
}

function definitionToResponse(record: NodeGraphDefinitionRecord) {
  return {
    id: record.id,
    account_id: record.accountId,
    workspace_id: record.workspaceId,
    project_id: record.projectId,
    name: record.name,
    status: record.status,
    current_version_id: record.currentVersionId,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

function versionToResponse(record: NodeGraphVersionRecord) {
  return {
    id: record.id,
    graph_id: record.graphId,
    version_no: record.versionNo,
    document: record.document,
    document_hash: record.documentHash,
    parent_version_id: record.parentVersionId,
    operation_log_id: record.operationLogId,
    created_at: record.createdAt,
  };
}

function runToResponse(record: NodeGraphRunRecord, options: { includeDebug: boolean }) {
  const trace = parseJsonField(record.traceJson);
  return {
    id: record.id,
    account_id: record.accountId,
    workspace_id: record.workspaceId,
    project_id: record.projectId,
    session_id: record.sessionId,
    floor_id: record.floorId,
    page_id: record.pageId,
    graph_id: record.graphId,
    graph_version_id: record.graphVersionId,
    intent: record.intent,
    status: record.status,
    // R6-3（缺口 6）：可见性分层。普通客户端只看治理摘要与状态，
    // 派发结果正文（outputDispatchResults / ref.result）走 manage debug 权限。
    trace: options.includeDebug ? trace : redactRunTraceForClient(trace),
    cleaned_at: record.cleanedAt,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

function nodeRunToResponse(record: NodeGraphNodeRunRecord, options: { includeDebug: boolean }) {
  const base = {
    id: record.id,
    graph_run_id: record.graphRunId,
    node_id: record.nodeId,
    phase: record.phase,
    status: record.status,
    input_hash: record.inputHash,
    output_hash: record.outputHash,
    started_at: record.startedAt,
    finished_at: record.finishedAt,
  };
  if (options.includeDebug) {
    return {
      ...base,
      preview: parseJsonField(record.previewJson),
      diagnostics: parseJsonField(record.diagnosticsJson),
      restricted: false,
    };
  }
  // R6-3（缺口 6）：默认裁剪节点输出正文（preview / diagnostics 可能含最终 prompt messages、agent brief）。
  return {
    ...base,
    preview: null,
    diagnostics: null,
    restricted: true,
  };
}

/**
 * R6-3（缺口 6）：为普通客户端裁剪 run trace。
 *
 * 保留治理摘要、状态计数、诊断摘要、输出/嵌套引用的目标与状态；
 * 移除可能含派发记录正文的 `outputDispatchResults` 与每个 ref 的 `result`。
 */
function redactRunTraceForClient(trace: unknown): unknown {
  if (!isRecord(trace)) {
    return trace;
  }
  const { outputDispatchResults: _omitResults, outputDispatchRefs, ...rest } = trace;
  const redactedRefs = Array.isArray(outputDispatchRefs)
    ? outputDispatchRefs.map((ref) => {
        if (!isRecord(ref)) {
          return ref;
        }
        const { result: _omitResult, ...refRest } = ref;
        return refRest;
      })
    : undefined;
  return {
    ...rest,
    ...(redactedRefs !== undefined ? { outputDispatchRefs: redactedRefs } : {}),
    restricted: true,
  };
}

function parseBooleanFlag(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

function hasProjectAction(
  accessService: ProjectAccessService,
  actor: ProjectActorInput,
  projectId: string,
  action: ProjectAction,
): boolean {
  try {
    accessService.requireProjectActionForActor(actor, projectId, action);
    return true;
  } catch (error) {
    if (error instanceof ProjectAccessServiceError) {
      return false;
    }
    throw error;
  }
}

function handleNodeGraphError(reply: FastifyReply, error: unknown): boolean {
  if (error instanceof ProjectAccessServiceError || error instanceof NodeGraphDefinitionServiceError) {
    sendError(reply, error.statusCode, error.code, error.message);
    return true;
  }
  if (error instanceof NodeGraphPackageServiceError) {
    // NG2-PKG：not_installable 时把缺失依赖诊断放进 error.details，供导入方修复。
    sendError(reply, error.statusCode, error.code, error.message, error.diagnostics);
    return true;
  }
  return false;
}

function securitySummaryToResponse(summary: PreflightNodeGraphPackageResult["securitySummary"]) {
  return {
    long_term_data_reads: summary.longTermDataReads,
    session_state_namespace_reads: summary.sessionStateNamespaceReads,
    proposes_committed_writes: summary.proposesCommittedWrites,
    persistent_output_targets: summary.persistentOutputTargets,
    mcp_servers: summary.mcpServers,
    requests_network_access: summary.requestsNetworkAccess,
    requests_file_write: summary.requestsFileWrite,
    required_permissions: summary.requiredPermissions,
  };
}

function preflightToResponse(result: PreflightNodeGraphPackageResult) {
  return {
    package_id: result.packageId,
    content_hash: result.contentHash,
    installable: result.installable,
    migration_available: result.migrationAvailable,
    migration_required: result.migrationRequired,
    counts: result.counts,
    diagnostics: result.diagnostics,
    required_node_types: result.requiredNodeTypes,
    missing_node_types: result.missingNodeTypes,
    degradable_node_types: result.degradableNodeTypes,
    security_summary: securitySummaryToResponse(result.securitySummary),
  };
}

export interface NodeGraphRoutesOptions {
  /** R6-3（缺口 7）：NodeGraph worker 是否启用。入队成功 ≠ 被执行，未启用时在 /run 响应提示。 */
  workerEnabled?: boolean;
}

export async function registerNodeGraphRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection,
  options: NodeGraphRoutesOptions = {},
): Promise<void> {
  const db = connection.db;
  const nodeGraphWorkerEnabled = options.workerEnabled === true;

  app.get("/projects/:id/node-graphs", async (request, reply) => {
    const params = parseWithSchema(projectIdParamsSchema, request.params, reply);
    if (!params.ok) return;
    const actor = actorFromRequest(request);
    try {
      const service = new NodeGraphDefinitionService(db);
      const records = service.list({ actor, projectId: params.data.id });
      return reply.send({ items: records.map(definitionToResponse) });
    } catch (error) {
      if (handleNodeGraphError(reply, error)) return;
      throw error;
    }
  });

  app.post("/projects/:id/node-graphs", async (request, reply) => {
    const params = parseWithSchema(projectIdParamsSchema, request.params, reply);
    if (!params.ok) return;
    const body = parseWithSchema(createGraphBodySchema, request.body, reply);
    if (!body.ok) return;
    const actor = actorFromRequest(request);
    try {
      const service = new NodeGraphDefinitionService(db);
      const result = service.create({
        actor,
        projectId: params.data.id,
        name: body.data.name,
        document: body.data.document,
      });
      return reply.code(201).send({
        definition: definitionToResponse(result.definition),
        version: versionToResponse(result.version),
        validation: result.validation,
      });
    } catch (error) {
      if (handleNodeGraphError(reply, error)) return;
      throw error;
    }
  });

  app.get("/projects/:id/node-graphs/:graph_id", async (request, reply) => {
    const params = parseWithSchema(graphParamsSchema, request.params, reply);
    if (!params.ok) return;
    const actor = actorFromRequest(request);
    try {
      const service = new NodeGraphDefinitionService(db);
      const definition = service.get({ actor, projectId: params.data.id, graphId: params.data.graph_id });
      const currentVersion = service.getCurrentVersion({ actor, projectId: params.data.id, graphId: params.data.graph_id });
      return reply.send({
        definition: definitionToResponse(definition),
        current_version: versionToResponse(currentVersion),
      });
    } catch (error) {
      if (handleNodeGraphError(reply, error)) return;
      throw error;
    }
  });

  app.get("/projects/:id/node-graphs/:graph_id/versions", async (request, reply) => {
    const params = parseWithSchema(graphParamsSchema, request.params, reply);
    if (!params.ok) return;
    const actor = actorFromRequest(request);
    try {
      const service = new NodeGraphDefinitionService(db);
      const versions = service.listVersions({ actor, projectId: params.data.id, graphId: params.data.graph_id });
      return reply.send({ items: versions.map(versionToResponse) });
    } catch (error) {
      if (handleNodeGraphError(reply, error)) return;
      throw error;
    }
  });

  app.post("/projects/:id/node-graphs/:graph_id/versions", async (request, reply) => {
    const params = parseWithSchema(graphParamsSchema, request.params, reply);
    if (!params.ok) return;
    const body = parseWithSchema(createVersionBodySchema, request.body, reply);
    if (!body.ok) return;
    const actor = actorFromRequest(request);
    try {
      const service = new NodeGraphDefinitionService(db);
      const result = service.createVersion({
        actor,
        projectId: params.data.id,
        graphId: params.data.graph_id,
        document: body.data.document,
        parentVersionId: body.data.parent_version_id,
      });
      return reply.code(201).send({
        definition: definitionToResponse(result.definition),
        version: versionToResponse(result.version),
        validation: result.validation,
      });
    } catch (error) {
      if (handleNodeGraphError(reply, error)) return;
      throw error;
    }
  });

  // R6-3（缺口 6）：图归档 / 版本回滚 / 设当前版本治理，需 project.nodegraph.manage。
  app.post("/projects/:id/node-graphs/:graph_id/archive", async (request, reply) => {
    const params = parseWithSchema(graphParamsSchema, request.params, reply);
    if (!params.ok) return;
    const actor = actorFromRequest(request);
    try {
      const service = new NodeGraphDefinitionService(db);
      const definition = service.archive({ actor, projectId: params.data.id, graphId: params.data.graph_id });
      return reply.send({ definition: definitionToResponse(definition) });
    } catch (error) {
      if (handleNodeGraphError(reply, error)) return;
      throw error;
    }
  });

  app.post("/projects/:id/node-graphs/:graph_id/unarchive", async (request, reply) => {
    const params = parseWithSchema(graphParamsSchema, request.params, reply);
    if (!params.ok) return;
    const actor = actorFromRequest(request);
    try {
      const service = new NodeGraphDefinitionService(db);
      const definition = service.unarchive({ actor, projectId: params.data.id, graphId: params.data.graph_id });
      return reply.send({ definition: definitionToResponse(definition) });
    } catch (error) {
      if (handleNodeGraphError(reply, error)) return;
      throw error;
    }
  });

  // 硬删除图定义本身（删除「数据存在本身」，区别于归档/清空节点）。需 project.nodegraph.manage。
  app.delete("/projects/:id/node-graphs/:graph_id", async (request, reply) => {
    const params = parseWithSchema(graphParamsSchema, request.params, reply);
    if (!params.ok) return;
    const actor = actorFromRequest(request);
    try {
      const service = new NodeGraphDefinitionService(db);
      service.delete({ actor, projectId: params.data.id, graphId: params.data.graph_id });
      return reply.code(204).send();
    } catch (error) {
      if (handleNodeGraphError(reply, error)) return;
      throw error;
    }
  });

  app.post("/projects/:id/node-graphs/:graph_id/current-version", async (request, reply) => {
    const params = parseWithSchema(graphParamsSchema, request.params, reply);
    if (!params.ok) return;
    const body = parseWithSchema(setCurrentVersionBodySchema, request.body, reply);
    if (!body.ok) return;
    const actor = actorFromRequest(request);
    try {
      const service = new NodeGraphDefinitionService(db);
      const result = service.setCurrentVersion({
        actor,
        projectId: params.data.id,
        graphId: params.data.graph_id,
        versionId: body.data.version_id,
      });
      return reply.send({
        definition: definitionToResponse(result.definition),
        version: versionToResponse(result.version),
      });
    } catch (error) {
      if (handleNodeGraphError(reply, error)) return;
      throw error;
    }
  });

  app.post("/projects/:id/node-graphs/:graph_id/validate", async (request, reply) => {
    const params = parseWithSchema(graphParamsSchema, request.params, reply);
    if (!params.ok) return;
    const body = parseWithSchema(validateBodySchema, request.body, reply);
    if (!body.ok) return;
    const actor = actorFromRequest(request);
    try {
      const service = new NodeGraphDefinitionService(db);
      const document = body.data?.document
        ?? service.getCurrentVersion({ actor, projectId: params.data.id, graphId: params.data.graph_id }).document;
      const validateSizeViolation = checkNodeGraphSyncSizeBudget(document, DEFAULT_NODE_GRAPH_SYNC_PREVIEW_BUDGET);
      if (validateSizeViolation) {
        return sendError(reply, 422, validateSizeViolation.reasonCode, validateSizeViolation.message);
      }
      return reply.send(service.validate({ actor, projectId: params.data.id, document }));
    } catch (error) {
      if (handleNodeGraphError(reply, error)) return;
      throw error;
    }
  });

  app.post("/projects/:id/node-graphs/:graph_id/preview", async (request, reply) => {
    const params = parseWithSchema(graphParamsSchema, request.params, reply);
    if (!params.ok) return;
    const body = parseWithSchema(previewBodySchema, request.body, reply);
    if (!body.ok) return;
    const actor = actorFromRequest(request);
    try {
      const access = new ProjectAccessService(db).requireProjectActionForActor(actor, params.data.id, "project.nodegraph.read");
      const service = new NodeGraphDefinitionService(db);
      const version = body.data?.version_id
        ? service.getVersion({ actor, projectId: params.data.id, graphId: params.data.graph_id, versionId: body.data.version_id })
        : service.getCurrentVersion({ actor, projectId: params.data.id, graphId: params.data.graph_id });
      const previewSizeViolation = checkNodeGraphSyncSizeBudget(version.document, DEFAULT_NODE_GRAPH_SYNC_PREVIEW_BUDGET);
      if (previewSizeViolation) {
        return sendError(reply, 422, previewSizeViolation.reasonCode, previewSizeViolation.message);
      }
      const result = await previewNodeGraph(createDefaultNodeGraphExecutor(), {
        document: version.document,
        graphVersionId: version.id,
        nodeId: body.data?.node_id,
        context: {
          accountId: access.project.accountId,
          workspaceId: access.project.workspaceId,
          projectId: access.project.id,
          input: body.data?.input_json,
          userInput: body.data?.user_input,
          chatHistory: body.data?.chat_history,
          cachedNodeOutputs: body.data?.cached_node_outputs as Record<string, NodeGraphNodeRunOutput> | undefined,
        },
      });
      return reply.send(result);
    } catch (error) {
      if (handleNodeGraphError(reply, error)) return;
      throw error;
    }
  });

  app.post("/projects/:id/node-graphs/:graph_id/run", async (request, reply) => {
    const params = parseWithSchema(graphParamsSchema, request.params, reply);
    if (!params.ok) return;
    const body = parseWithSchema(runBodySchema, request.body, reply);
    if (!body.ok) return;
    const actor = actorFromRequest(request);
    try {
      const access = new ProjectAccessService(db).requireProjectActionForActor(actor, params.data.id, "project.nodegraph.run");
      // R6-2（缺口 4）：项目级跨图并发桶，避免单项目同时排入过多 NodeGraph 运行。
      const activeRuns = countActiveProjectGraphRunJobs(db, {
        accountId: access.project.accountId,
        projectId: access.project.id,
      });
      if (activeRuns >= DEFAULT_NODE_GRAPH_PROJECT_RUN_CONCURRENCY) {
        return sendError(
          reply,
          429,
          RUNTIME_GOVERNANCE_BUDGET_REASON_CODES.nodeGraphProjectRunConcurrency,
          `Project ${access.project.id} already has ${activeRuns} active NodeGraph runs (limit ${DEFAULT_NODE_GRAPH_PROJECT_RUN_CONCURRENCY}).`,
        );
      }
      const service = new NodeGraphDefinitionService(db);
      const version = body.data?.version_id
        ? service.getVersion({ actor, projectId: params.data.id, graphId: params.data.graph_id, versionId: body.data.version_id })
        : service.getCurrentVersion({ actor, projectId: params.data.id, graphId: params.data.graph_id });
      const scheduler = new RuntimeJobScheduler(createNodeGraphRuntimeJobCatalog());
      const payload = {
        accountId: access.project.accountId,
        workspaceId: access.project.workspaceId,
        projectId: access.project.id,
        graphId: params.data.graph_id,
        graphVersionId: version.id,
        sessionId: body.data?.session_id ?? null,
        floorId: body.data?.floor_id ?? null,
        pageId: body.data?.page_id ?? null,
        actorClientId: actor.actorClientId ?? null,
        intent: body.data?.intent ?? "normal",
        dryRun: body.data?.dry_run ?? false,
        inputJson: body.data?.input_json ?? {},
      };
      const result = db.transaction((tx) => scheduler.enqueue(tx, {
        jobType: NODE_GRAPH_RUN_JOB_TYPE,
        accountId: access.project.accountId,
        workspaceId: access.project.workspaceId,
        projectId: access.project.id,
        scopeType: NODE_GRAPH_RUNTIME_SCOPE_TYPE,
        scopeKey: buildNodeGraphRuntimeScopeKey({
          workspaceId: access.project.workspaceId,
          projectId: access.project.id,
          graphId: params.data.graph_id,
        }),
        sessionId: payload.sessionId,
        floorId: payload.floorId,
        pageId: payload.pageId,
        actorClientId: payload.actorClientId,
        payload,
        dedupeKey: body.data?.dedupe_key ?? null,
      }));
      return reply.code(result.created ? 202 : 200).send({
        job_id: result.jobId,
        created: result.created,
        dedupe_key: result.dedupeKey ?? null,
        graph_id: params.data.graph_id,
        graph_version_id: version.id,
        // R6-3（缺口 7）：入队成功 ≠ 被执行。worker 未启用时此处提示，与 agent runtime worker 口径统一。
        worker_enabled: nodeGraphWorkerEnabled,
      });
    } catch (error) {
      if (handleNodeGraphError(reply, error)) return;
      throw error;
    }
  });

  app.get("/projects/:id/node-graph-runs/:run_id", async (request, reply) => {
    const params = parseWithSchema(runParamsSchema, request.params, reply);
    if (!params.ok) return;
    const query = parseWithSchema(runQueryStringSchema, request.query ?? {}, reply);
    if (!query.ok) return;
    const actor = actorFromRequest(request);
    try {
      const accessService = new ProjectAccessService(db);
      const access = accessService.requireProjectActionForActor(actor, params.data.id, "project.nodegraph.read");
      const result = new NodeGraphRunService(db).getRun({
        accountId: access.project.accountId,
        projectId: access.project.id,
        runId: params.data.run_id,
      });
      if (!result) {
        return sendError(reply, 404, "node_graph_run_not_found", `NodeGraph run not found: ${params.data.run_id}`);
      }
      // R6-3（缺口 6）：节点输出正文走 manage debug 权限。请求 include_node_output 且具备
      // project.nodegraph.manage 才返回完整正文，并写 node_graph_run.inspect 审计；否则静默裁剪。
      const includeDebug = parseBooleanFlag(query.data.include_node_output)
        && hasProjectAction(accessService, actor, params.data.id, "project.nodegraph.manage");
      if (includeDebug) {
        new OperationLogService(db).append({
          accountId: access.project.accountId,
          actorType: actor.actorType,
          actorId: actor.actorAccountId,
          actorAccountId: actor.actorAccountId,
          actorClientId: actor.actorClientId ?? null,
          sourceType: "api",
          action: GOVERNANCE_OPERATION_ACTIONS.nodeGraphRun.inspect,
          status: "succeeded",
          workspaceId: access.project.workspaceId,
          projectId: access.project.id,
          runId: result.run.id,
          targetType: "node_graph_run",
          targetId: result.run.id,
          metadata: {
            route: "GET /projects/:id/node-graph-runs/:run_id",
            include_node_output: true,
            node_run_count: result.nodeRuns.length,
          },
        });
      }
      return reply.send({
        run: runToResponse(result.run, { includeDebug }),
        node_runs: result.nodeRuns.map((nodeRun) => nodeRunToResponse(nodeRun, { includeDebug })),
        restricted: !includeDebug,
      });
    } catch (error) {
      if (handleNodeGraphError(reply, error)) return;
      throw error;
    }
  });

  // NG2-PKG（阶段 9）：把某个 graph version 导出为 NodeGraphPackage（manifest + 依赖 + 安全摘要）。
  app.post("/projects/:id/node-graphs/:graph_id/export", async (request, reply) => {
    const params = parseWithSchema(graphParamsSchema, request.params, reply);
    if (!params.ok) return;
    const body = parseWithSchema(exportBodySchema, request.body ?? {}, reply);
    if (!body.ok) return;
    const actor = actorFromRequest(request);
    try {
      const result = new NodeGraphPackageService(db).exportPackage({
        actor,
        projectId: params.data.id,
        graphId: params.data.graph_id,
        versionId: body.data?.version_id,
        packageVersion: body.data?.package_version,
      });
      return reply.send({
        package: result.package,
        security_summary: securitySummaryToResponse(result.securitySummary),
        graph_id: result.graphId,
        version_id: result.versionId,
        version_no: result.versionNo,
      });
    } catch (error) {
      if (handleNodeGraphError(reply, error)) return;
      throw error;
    }
  });

  // NG2-PKG（阶段 10）：导入预检——执行前对照 Workspace / Project 边界产出缺失依赖诊断与安全摘要。
  app.post("/projects/:id/node-graph-imports/preflight", async (request, reply) => {
    const params = parseWithSchema(projectIdParamsSchema, request.params, reply);
    if (!params.ok) return;
    const body = parseWithSchema(importPreflightBodySchema, request.body, reply);
    if (!body.ok) return;
    const actor = actorFromRequest(request);
    try {
      const result = new NodeGraphPackageService(db).preflightImport({
        actor,
        projectId: params.data.id,
        package: body.data.package,
      });
      return reply.send(preflightToResponse(result));
    } catch (error) {
      if (handleNodeGraphError(reply, error)) return;
      throw error;
    }
  });

  // NG2-PKG（阶段 10/11）：导入。预检通过且 confirm=true 才安装为新图；否则返回预检供用户确认。
  app.post("/projects/:id/node-graph-imports", async (request, reply) => {
    const params = parseWithSchema(projectIdParamsSchema, request.params, reply);
    if (!params.ok) return;
    const body = parseWithSchema(importBodySchema, request.body, reply);
    if (!body.ok) return;
    const actor = actorFromRequest(request);
    try {
      const result = new NodeGraphPackageService(db).importPackage({
        actor,
        projectId: params.data.id,
        package: body.data.package,
        confirm: body.data.confirm,
        name: body.data.name,
      });
      if (!result.confirmed) {
        return reply.code(200).send({
          confirmed: false,
          requires_confirmation: true,
          preflight: preflightToResponse(result.preflight),
        });
      }
      return reply.code(201).send({
        confirmed: true,
        requires_confirmation: false,
        definition: definitionToResponse(result.definition),
        version: versionToResponse(result.version),
        validation: result.validation,
        preflight: preflightToResponse(result.preflight),
      });
    } catch (error) {
      if (handleNodeGraphError(reply, error)) return;
      throw error;
    }
  });
}
