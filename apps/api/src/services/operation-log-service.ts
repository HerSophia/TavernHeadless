import { and, asc, count, desc, eq, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import type { FastifyRequest } from "fastify";
import { nanoid } from "nanoid";

import type { AppDb, DbExecutor } from "../db/client.js";
import { operationLogs } from "../db/schema.js";
import { getRequestAuthContext, type AuthenticatedAuthContext } from "../plugins/auth.js";

type OperationLogDb = AppDb | DbExecutor;
type OperationLogRow = typeof operationLogs.$inferSelect;

export type OperationLogStatus = "succeeded" | "failed" | "denied" | "cancelled";

export type OperationLogActor = {
  actorType: string;
  actorId?: string | null;
};

export type CreateOperationLogInput = OperationLogActor & {
  id?: string;
  accountId: string;
  operationGroupId?: string | null;
  requestId?: string | null;
  sourceType: string;
  action: string;
  status: OperationLogStatus;
  workspaceId?: string | null;
  projectId?: string | null;
  actorAccountId?: string | null;
  sessionId?: string | null;
  branchId?: string | null;
  floorId?: string | null;
  runId?: string | null;
  targetType: string;
  targetId?: string | null;
  beforeRef?: unknown;
  afterRef?: unknown;
  diff?: unknown;
  metadata?: unknown;
  createdAt?: number;
};

export type OperationLogRecord = {
  id: string;
  accountId: string;
  actorType: string;
  actorId: string | null;
  operationGroupId: string | null;
  requestId: string | null;
  sourceType: string;
  action: string;
  status: OperationLogStatus;
  workspaceId: string | null;
  projectId: string | null;
  actorAccountId: string | null;
  sessionId: string | null;
  branchId: string | null;
  floorId: string | null;
  runId: string | null;
  targetType: string;
  targetId: string | null;
  beforeRef: unknown | null;
  afterRef: unknown | null;
  diff: unknown | null;
  metadata: unknown | null;
  createdAt: number;
};

export type OperationLogListOptions = {
  accountId: string;
  workspaceId?: string | null;
  projectId?: string | null;
  actorAccountId?: string | null;
  sessionId?: string | null;
  floorId?: string | null;
  runId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  action?: string | null;
  actorType?: string | null;
  status?: OperationLogStatus | null;
  operationGroupId?: string | null;
  requestId?: string | null;
  limit?: number;
  offset?: number;
  sortOrder?: "asc" | "desc";
};

/**
 * Appends and queries Operation Journal records.
 *
 * The service stores references and summary diffs only. Business tables remain the source of
 * truth for floors, assets, tools, and Session State mutations.
 */
export class OperationLogService {
  constructor(private readonly db: OperationLogDb) {}

  append(input: CreateOperationLogInput): OperationLogRecord {
    assertNonEmpty(input.accountId, "accountId");
    assertNonEmpty(input.actorType, "actorType");
    assertNonEmpty(input.sourceType, "sourceType");
    assertNonEmpty(input.action, "action");
    assertNonEmpty(input.status, "status");
    assertNonEmpty(input.targetType, "targetType");

    const metadataWorkspaceId = readMetadataString(input.metadata, "workspace_id");
    const metadataProjectId = readMetadataString(input.metadata, "project_id");
    const workspaceId = normalizeNullableString(input.workspaceId) ?? metadataWorkspaceId;
    const projectId = normalizeNullableString(input.projectId) ?? metadataProjectId;
    const inputActorAccountId = normalizeNullableString(input.actorAccountId);
    const actorAccountId = input.actorType === "account"
      ? normalizeNullableString(input.actorId) ?? inputActorAccountId ?? normalizeNullableString(input.accountId)
      : inputActorAccountId ?? normalizeNullableString(input.accountId);
    const metadata = mergeOperationScopeMetadata(input.metadata, { workspaceId, projectId });

    const row = this.db
      .insert(operationLogs)
      .values({
        id: input.id ?? nanoid(),
        accountId: input.accountId,
        actorType: input.actorType,
        actorId: normalizeNullableString(input.actorId),
        operationGroupId: normalizeNullableString(input.operationGroupId),
        requestId: normalizeNullableString(input.requestId),
        sourceType: input.sourceType,
        action: input.action,
        status: input.status,
        sessionId: normalizeNullableString(input.sessionId),
        branchId: normalizeNullableString(input.branchId),
        floorId: normalizeNullableString(input.floorId),
        runId: normalizeNullableString(input.runId),
        targetType: input.targetType,
        targetId: normalizeNullableString(input.targetId),
        beforeRefJson: stringifyNullableJson(input.beforeRef),
        afterRefJson: stringifyNullableJson(input.afterRef),
        diffJson: stringifyNullableJson(input.diff),
        workspaceId,
        projectId,
        actorAccountId,
        metadataJson: stringifyNullableJson(metadata),
        createdAt: input.createdAt ?? Date.now(),
      })
      .returning()
      .get();

    return mapOperationLogRow(row);
  }

  list(options: OperationLogListOptions): { rows: OperationLogRecord[]; total: number } {
    assertNonEmpty(options.accountId, "accountId");
    const limit = clampInteger(options.limit ?? 50, 1, 200);
    const offset = Math.max(0, Math.trunc(options.offset ?? 0));
    const sortOrder = options.sortOrder ?? "desc";
    const whereClause = buildOperationLogWhereClause(options);
    const orderBy = sortOrder === "asc"
      ? asc(operationLogs.createdAt)
      : desc(operationLogs.createdAt);

    const rows = this.db
      .select()
      .from(operationLogs)
      .where(whereClause)
      .orderBy(orderBy)
      .limit(limit)
      .offset(offset)
      .all()
      .map(mapOperationLogRow);
    const totalRow = this.db
      .select({ value: count() })
      .from(operationLogs)
      .where(whereClause)
      .get();

    return { rows, total: totalRow?.value ?? 0 };
  }
}

export function operationActorFromAuth(auth: AuthenticatedAuthContext): OperationLogActor {
  return {
    actorType: "user",
    actorId: auth.subject ?? auth.accountId,
  };
}

export function operationActorFromRequest(request: FastifyRequest): OperationLogActor {
  return operationActorFromAuth(getRequestAuthContext(request));
}

export function operationRequestIdFromRequest(request: FastifyRequest): string | null {
  return typeof request.id === "string" && request.id.trim().length > 0 ? request.id : null;
}

function buildOperationLogWhereClause(options: OperationLogListOptions): SQL {
  const filters: SQL[] = [eq(operationLogs.accountId, options.accountId)];
  pushOptionalFilter(filters, operationLogs.workspaceId, options.workspaceId);
  pushOptionalFilter(filters, operationLogs.projectId, options.projectId);
  pushOptionalFilter(filters, operationLogs.actorAccountId, options.actorAccountId);
  pushOptionalFilter(filters, operationLogs.sessionId, options.sessionId);
  pushOptionalFilter(filters, operationLogs.floorId, options.floorId);
  pushOptionalFilter(filters, operationLogs.runId, options.runId);
  pushOptionalFilter(filters, operationLogs.targetType, options.targetType);
  pushOptionalFilter(filters, operationLogs.targetId, options.targetId);
  pushOptionalFilter(filters, operationLogs.action, options.action);
  pushOptionalFilter(filters, operationLogs.actorType, options.actorType);
  pushOptionalFilter(filters, operationLogs.status, options.status);
  pushOptionalFilter(filters, operationLogs.operationGroupId, options.operationGroupId);
  pushOptionalFilter(filters, operationLogs.requestId, options.requestId);
  return and(...filters) ?? filters[0]!;
}

function pushOptionalFilter(
  filters: SQL[],
  column: AnySQLiteColumn,
  value: string | null | undefined,
): void {
  if (typeof value === "string" && value.trim().length > 0) {
    filters.push(eq(column, value.trim()));
  }
}

function mapOperationLogRow(row: OperationLogRow): OperationLogRecord {
  return {
    id: row.id,
    accountId: row.accountId,
    actorType: row.actorType,
    actorId: row.actorId,
    operationGroupId: row.operationGroupId,
    requestId: row.requestId,
    sourceType: row.sourceType,
    action: row.action,
    status: row.status as OperationLogStatus,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    actorAccountId: row.actorAccountId,
    sessionId: row.sessionId,
    branchId: row.branchId,
    floorId: row.floorId,
    runId: row.runId,
    targetType: row.targetType,
    targetId: row.targetId,
    beforeRef: parseNullableJson(row.beforeRefJson),
    afterRef: parseNullableJson(row.afterRefJson),
    diff: parseNullableJson(row.diffJson),
    metadata: parseNullableJson(row.metadataJson),
    createdAt: row.createdAt,
  };
}

function normalizeNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function stringifyNullableJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value);
}

function parseNullableJson(value: string | null): unknown | null {
  if (value === null) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function readMetadataString(metadata: unknown, key: string): string | null {
  if (!isPlainRecord(metadata)) {
    return null;
  }

  return normalizeNullableString(metadata[key]);
}

function mergeOperationScopeMetadata(
  metadata: unknown,
  scope: { workspaceId: string | null; projectId: string | null },
): unknown {
  const additions: Record<string, string> = {};
  if (scope.workspaceId) {
    additions.workspace_id = scope.workspaceId;
  }
  if (scope.projectId) {
    additions.project_id = scope.projectId;
  }

  if (Object.keys(additions).length === 0) {
    return metadata;
  }

  if (metadata === undefined || metadata === null) {
    return additions;
  }

  if (isPlainRecord(metadata)) {
    return { ...metadata, ...additions };
  }

  return { value: metadata, ...additions };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertNonEmpty(value: string, fieldName: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  const integer = Math.trunc(value);
  return Math.min(max, Math.max(min, integer));
}
