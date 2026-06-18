/**
 * RuntimeTraceQueryService：R6-1（缺口 1、3）统一运行 trace 查询。
 *
 * 它把分散在 `node_graph_run`、`runtime_job`（agent.run / graph.run）与 operation log
 * 的运行记录聚合成统一条目，并解析 graph run ↔ 后台 agent job 的**双向** nested lineage：
 *
 *  - 父 -> 子：graph run trace 里的 `nestedJobRefs(jobId)`，以及 payload.lineage.parentRunId
 *    指向该 graph run 的 agent.run job。
 *  - 子 -> 父：agent.run job 的 payload.lineage.parentRunId / parentRuntimeKind 指回父级 run。
 *
 * 第一版只做服务层聚合 helper，不直接公开 HTTP。所有查询都按 accountId 做账号隔离，
 * 只返回引用 / 摘要 / reason code / 副作用计数，不返回大正文。
 */
import { and, desc, eq, inArray, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";

import type { AppDb, DbExecutor } from "../../db/client.js";
import {
  nodeGraphNodeRuns,
  nodeGraphRuns,
  operationLogs,
  runtimeJobs,
} from "../../db/schema.js";
import { isGovernanceOperationAction } from "../governance/operation-log-names.js";

type RuntimeTraceDb = AppDb | DbExecutor;

export type RuntimeTraceSource = "node_graph_run" | "runtime_job" | "operation_log";

export interface RuntimeTraceNestedJobRef {
  jobId: string;
  nodeId?: string | null;
  medium?: string | null;
}

export interface RuntimeTraceParentRef {
  runId: string;
  runtimeKind: string | null;
}

export interface RuntimeTraceEntry {
  source: RuntimeTraceSource;
  runtimeKind: string;
  id: string;
  runId: string | null;
  jobId: string | null;
  rootRunId: string | null;
  parentRunId: string | null;
  parentRuntimeKind: string | null;
  status: string;
  reasonCode: string | null;
  accountId: string;
  workspaceId: string | null;
  projectId: string | null;
  sessionId: string | null;
  floorId: string | null;
  graphId: string | null;
  graphVersionId: string | null;
  jobType: string | null;
  action: string | null;
  createdAt: number;
  sideEffects: unknown;
  nestedJobRefs: RuntimeTraceNestedJobRef[];
}

export interface RuntimeTraceQueryInput {
  accountId: string;
  workspaceId?: string | null;
  projectId?: string | null;
  sessionId?: string | null;
  floorId?: string | null;
  graphRunId?: string | null;
  jobId?: string | null;
  rootRunId?: string | null;
  /** 是否包含 operation log 来源（默认 false，避免噪声）。 */
  includeOperationLogs?: boolean;
  limit?: number;
}

export interface RuntimeTraceQueryResult {
  entries: RuntimeTraceEntry[];
}

export interface RuntimeGraphRunLineageInput {
  accountId: string;
  projectId?: string | null;
  graphRunId: string;
}

export interface RuntimeGraphRunLineageResult {
  run: RuntimeTraceEntry | null;
  nodeRuns: Array<{
    id: string;
    nodeId: string;
    phase: string;
    status: string;
    inputHash: string | null;
    outputHash: string | null;
    startedAt: number | null;
    finishedAt: number | null;
  }>;
  nestedJobs: RuntimeTraceEntry[];
}

export interface RuntimeAgentJobLineageInput {
  accountId: string;
  jobId: string;
}

export interface RuntimeAgentJobLineageResult {
  job: RuntimeTraceEntry | null;
  parentRun: RuntimeTraceEntry | null;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const RUNTIME_JOB_TRACE_TYPES = ["agent.run", "graph.run"] as const;

export class RuntimeTraceQueryService {
  constructor(private readonly db: RuntimeTraceDb) {}

  /** 聚合查询统一运行 trace 条目，按 createdAt 倒序。 */
  query(input: RuntimeTraceQueryInput): RuntimeTraceQueryResult {
    assertNonEmpty(input.accountId, "accountId");
    const limit = clampLimit(input.limit);

    const graphRunEntries = this.queryNodeGraphRuns(input, limit);
    const jobEntries = this.queryRuntimeJobs(input, limit);
    const logEntries = input.includeOperationLogs ? this.queryOperationLogs(input, limit) : [];

    const entries = [...graphRunEntries, ...jobEntries, ...logEntries]
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, limit);
    return { entries };
  }

  /** graph run -> nested agent job（父 -> 子）。 */
  resolveGraphRunLineage(input: RuntimeGraphRunLineageInput): RuntimeGraphRunLineageResult {
    assertNonEmpty(input.accountId, "accountId");
    assertNonEmpty(input.graphRunId, "graphRunId");

    const filters: SQL[] = [
      eq(nodeGraphRuns.accountId, input.accountId),
      eq(nodeGraphRuns.id, input.graphRunId),
    ];
    pushOptionalFilter(filters, nodeGraphRuns.projectId, input.projectId);
    const runRow = this.db
      .select()
      .from(nodeGraphRuns)
      .where(and(...filters))
      .limit(1)
      .get();

    if (!runRow) {
      return { run: null, nodeRuns: [], nestedJobs: [] };
    }

    const run = mapNodeGraphRunEntry(runRow);
    const nodeRunRows = this.db
      .select()
      .from(nodeGraphNodeRuns)
      .where(eq(nodeGraphNodeRuns.graphRunId, runRow.id))
      .all();
    const nodeRuns = nodeRunRows.map((row) => ({
      id: row.id,
      nodeId: row.nodeId,
      phase: row.phase,
      status: row.status,
      inputHash: row.inputHash ?? null,
      outputHash: row.outputHash ?? null,
      startedAt: row.startedAt ?? null,
      finishedAt: row.finishedAt ?? null,
    }));

    const nestedJobs = this.resolveNestedAgentJobs(input.accountId, runRow.id, run.nestedJobRefs);
    return { run, nodeRuns, nestedJobs };
  }

  /** agent job -> parent run（子 -> 父）。 */
  resolveAgentJobLineage(input: RuntimeAgentJobLineageInput): RuntimeAgentJobLineageResult {
    assertNonEmpty(input.accountId, "accountId");
    assertNonEmpty(input.jobId, "jobId");

    const jobRow = this.db
      .select()
      .from(runtimeJobs)
      .where(and(eq(runtimeJobs.accountId, input.accountId), eq(runtimeJobs.id, input.jobId)))
      .limit(1)
      .get();

    if (!jobRow) {
      return { job: null, parentRun: null };
    }

    const job = mapRuntimeJobEntry(jobRow);
    if (!job.parentRunId) {
      return { job, parentRun: null };
    }

    // 子 -> 父：父级是 node graph run 时回查 graph run 行。
    if (job.parentRuntimeKind === "node_graph_run" || job.parentRuntimeKind === null) {
      const parentRow = this.db
        .select()
        .from(nodeGraphRuns)
        .where(and(
          eq(nodeGraphRuns.accountId, input.accountId),
          eq(nodeGraphRuns.id, job.parentRunId),
        ))
        .limit(1)
        .get();
      if (parentRow) {
        return { job, parentRun: mapNodeGraphRunEntry(parentRow) };
      }
    }

    return { job, parentRun: null };
  }

  private resolveNestedAgentJobs(
    accountId: string,
    graphRunId: string,
    nestedJobRefs: RuntimeTraceNestedJobRef[],
  ): RuntimeTraceEntry[] {
    const refJobIds = nestedJobRefs.map((ref) => ref.jobId).filter((id): id is string => typeof id === "string" && id.length > 0);
    const byId = new Map<string, RuntimeTraceEntry>();

    if (refJobIds.length > 0) {
      const rows = this.db
        .select()
        .from(runtimeJobs)
        .where(and(eq(runtimeJobs.accountId, accountId), inArray(runtimeJobs.id, refJobIds)))
        .all();
      for (const row of rows) {
        byId.set(row.id, mapRuntimeJobEntry(row));
      }
    }

    // 同时按 payload.lineage.parentRunId 反查，覆盖 trace 未登记但 lineage 已回填的 job。
    const candidates = this.db
      .select()
      .from(runtimeJobs)
      .where(and(eq(runtimeJobs.accountId, accountId), eq(runtimeJobs.jobType, "agent.run")))
      .orderBy(desc(runtimeJobs.createdAt))
      .limit(MAX_LIMIT)
      .all();
    for (const row of candidates) {
      const entry = mapRuntimeJobEntry(row);
      if (entry.parentRunId === graphRunId) {
        byId.set(row.id, entry);
      }
    }

    return [...byId.values()].sort((left, right) => right.createdAt - left.createdAt);
  }

  private queryNodeGraphRuns(input: RuntimeTraceQueryInput, limit: number): RuntimeTraceEntry[] {
    if (input.jobId) {
      // 单 job 查询不属于 node graph run 来源。
      return [];
    }
    const filters: SQL[] = [eq(nodeGraphRuns.accountId, input.accountId)];
    pushOptionalFilter(filters, nodeGraphRuns.workspaceId, input.workspaceId);
    pushOptionalFilter(filters, nodeGraphRuns.projectId, input.projectId);
    pushOptionalFilter(filters, nodeGraphRuns.sessionId, input.sessionId);
    pushOptionalFilter(filters, nodeGraphRuns.floorId, input.floorId);
    pushOptionalFilter(filters, nodeGraphRuns.id, input.graphRunId);

    const rows = this.db
      .select()
      .from(nodeGraphRuns)
      .where(and(...filters))
      .orderBy(desc(nodeGraphRuns.createdAt))
      .limit(limit)
      .all();

    const entries = rows.map(mapNodeGraphRunEntry);
    return input.rootRunId
      ? entries.filter((entry) => entry.rootRunId === input.rootRunId || entry.runId === input.rootRunId)
      : entries;
  }

  private queryRuntimeJobs(input: RuntimeTraceQueryInput, limit: number): RuntimeTraceEntry[] {
    if (input.graphRunId && !input.jobId) {
      // graph run 范围内的 nested job 由 resolveGraphRunLineage 处理，聚合查询用 lineage 过滤。
    }
    const filters: SQL[] = [
      eq(runtimeJobs.accountId, input.accountId),
      inArray(runtimeJobs.jobType, [...RUNTIME_JOB_TRACE_TYPES]),
    ];
    pushOptionalFilter(filters, runtimeJobs.workspaceId, input.workspaceId);
    pushOptionalFilter(filters, runtimeJobs.projectId, input.projectId);
    pushOptionalFilter(filters, runtimeJobs.sessionId, input.sessionId);
    pushOptionalFilter(filters, runtimeJobs.floorId, input.floorId);
    pushOptionalFilter(filters, runtimeJobs.id, input.jobId);

    const rows = this.db
      .select()
      .from(runtimeJobs)
      .where(and(...filters))
      .orderBy(desc(runtimeJobs.createdAt))
      .limit(limit)
      .all();

    let entries = rows.map(mapRuntimeJobEntry);
    if (input.graphRunId) {
      entries = entries.filter((entry) => entry.parentRunId === input.graphRunId || entry.id === input.graphRunId);
    }
    if (input.rootRunId) {
      entries = entries.filter((entry) => entry.rootRunId === input.rootRunId || entry.parentRunId === input.rootRunId);
    }
    return entries;
  }

  private queryOperationLogs(input: RuntimeTraceQueryInput, limit: number): RuntimeTraceEntry[] {
    const filters: SQL[] = [eq(operationLogs.accountId, input.accountId)];
    pushOptionalFilter(filters, operationLogs.workspaceId, input.workspaceId);
    pushOptionalFilter(filters, operationLogs.projectId, input.projectId);
    pushOptionalFilter(filters, operationLogs.sessionId, input.sessionId);
    pushOptionalFilter(filters, operationLogs.floorId, input.floorId);
    pushOptionalFilter(filters, operationLogs.runId, input.graphRunId);

    const rows = this.db
      .select()
      .from(operationLogs)
      .where(and(...filters))
      .orderBy(desc(operationLogs.createdAt))
      .limit(limit)
      .all();

    return rows
      .filter((row) => isGovernanceOperationAction(row.action))
      .map(mapOperationLogEntry);
  }
}

function mapNodeGraphRunEntry(row: typeof nodeGraphRuns.$inferSelect): RuntimeTraceEntry {
  const trace = parseJson(row.traceJson);
  const traceRecord = isRecord(trace) ? trace : {};
  return {
    source: "node_graph_run",
    runtimeKind: readString(traceRecord.runtime_kind) ?? "node_graph_run",
    id: row.id,
    runId: row.id,
    jobId: null,
    rootRunId: readString(traceRecord.root_run_id) ?? row.id,
    parentRunId: readString(traceRecord.parent_run_id),
    parentRuntimeKind: null,
    status: row.status,
    reasonCode: readString(traceRecord.reason_code),
    accountId: row.accountId,
    workspaceId: row.workspaceId ?? null,
    projectId: row.projectId ?? null,
    sessionId: row.sessionId ?? null,
    floorId: row.floorId ?? null,
    graphId: row.graphId,
    graphVersionId: row.graphVersionId,
    jobType: null,
    action: null,
    createdAt: row.createdAt,
    sideEffects: isRecord(traceRecord.side_effects) ? traceRecord.side_effects : null,
    nestedJobRefs: readNestedJobRefs(traceRecord.nestedJobRefs),
  };
}

function mapRuntimeJobEntry(row: typeof runtimeJobs.$inferSelect): RuntimeTraceEntry {
  const payload = parseJson(row.payloadJson);
  const lineage = isRecord(payload) && isRecord(payload.lineage) ? payload.lineage : {};
  const runtimeKind = row.jobType === "agent.run"
    ? "agent_run"
    : row.jobType === "graph.run"
      ? "node_graph_run_job"
      : "runtime_job";
  return {
    source: "runtime_job",
    runtimeKind,
    id: row.id,
    runId: row.id,
    jobId: row.id,
    rootRunId: readString(lineage.rootRunId) ?? row.id,
    parentRunId: readString(lineage.parentRunId),
    parentRuntimeKind: readString(lineage.parentRuntimeKind),
    status: row.status,
    reasonCode: readString(row.lastErrorCode),
    accountId: row.accountId,
    workspaceId: row.workspaceId ?? null,
    projectId: row.projectId ?? null,
    sessionId: row.sessionId ?? null,
    floorId: row.floorId ?? null,
    graphId: null,
    graphVersionId: null,
    jobType: row.jobType,
    action: null,
    createdAt: row.createdAt,
    sideEffects: null,
    nestedJobRefs: [],
  };
}

function mapOperationLogEntry(row: typeof operationLogs.$inferSelect): RuntimeTraceEntry {
  return {
    source: "operation_log",
    runtimeKind: row.action.split(".")[0] ?? "operation_log",
    id: row.id,
    runId: row.runId ?? null,
    jobId: null,
    rootRunId: row.runId ?? null,
    parentRunId: null,
    parentRuntimeKind: null,
    status: row.status,
    reasonCode: row.reason ?? null,
    accountId: row.accountId,
    workspaceId: row.workspaceId ?? null,
    projectId: row.projectId ?? null,
    sessionId: row.sessionId ?? null,
    floorId: row.floorId ?? null,
    graphId: null,
    graphVersionId: null,
    jobType: null,
    action: row.action,
    createdAt: row.createdAt,
    sideEffects: null,
    nestedJobRefs: [],
  };
}

function readNestedJobRefs(value: unknown): RuntimeTraceNestedJobRef[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const refs: RuntimeTraceNestedJobRef[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }
    const jobId = readString(item.jobId);
    if (!jobId) {
      continue;
    }
    refs.push({
      jobId,
      nodeId: readString(item.nodeId),
      medium: readString(item.medium),
    });
  }
  return refs;
}

function pushOptionalFilter(filters: SQL[], column: AnySQLiteColumn, value: string | null | undefined): void {
  if (typeof value === "string" && value.trim().length > 0) {
    filters.push(eq(column, value.trim()));
  }
}

function parseJson(value: string | null): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function clampLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_LIMIT;
  }
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(value)));
}

function assertNonEmpty(value: string, fieldName: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
}
