import { and, desc, eq, lt, or, type SQL } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { AppDb, DbExecutor } from "../db/client.js";
import { derivedOutputs } from "../db/schema.js";
import { OperationLogService } from "./operation-log-service.js";
import { ProjectAccessService, ProjectAccessServiceError, type ProjectAccess, type ProjectActorInput } from "./project-access-service.js";
import type { ProjectEventLiveHub } from "./project-event-live-hub.js";
import { ProjectEventService, type ProjectEventRecord } from "./project-event-service.js";
import { ProjectSourceScopeError, resolveProjectSourceScope, type ProjectSourceScope } from "./project-source-scope.js";

export type DerivedOutputStatus = "draft" | "published" | "archived";

export type DerivedOutputRecord = {
  id: string;
  workspaceId: string;
  projectId: string;
  accountId: string;
  ownerAccountId: string;
  ownerClientId: string | null;
  sourceSessionId: string | null;
  sourceFloorId: string | null;
  sourcePageId: string | null;
  domain: string;
  value: unknown;
  status: DerivedOutputStatus;
  createdAt: number;
  updatedAt: number;
};

export type DerivedOutputListResult = {
  items: DerivedOutputRecord[];
  nextCursor: string | null;
};

export type DerivedOutputServiceErrorCode =
  | "derived_output_write_denied"
  | "derived_output_forbidden_for_role"
  | "derived_output_not_found"
  | "derived_output_archived_immutable"
  | "derived_output_source_scope_mismatch"
  | "derived_output_invalid_status"
  | "derived_output_payload_too_large"
  | "derived_output_payload_invalid"
  | "invalid_cursor"
  | "session_not_found"
  | "floor_not_found"
  | "page_not_found";

export class DerivedOutputServiceError extends Error {
  constructor(
    public readonly statusCode: 400 | 403 | 404 | 409 | 413,
    public readonly code: DerivedOutputServiceErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "DerivedOutputServiceError";
  }
}

type ServiceOptions = {
  projectEventLiveHub?: ProjectEventLiveHub;
  maxPayloadBytes?: number;
};

export type CreateDerivedOutputInput = {
  actorAccountId: string;
  actor?: ProjectActorInput;
  projectId: string;
  domain: string;
  value?: unknown;
  status?: DerivedOutputStatus | string | null;
  sourceSessionId?: string | null;
  sourceFloorId?: string | null;
  sourcePageId?: string | null;
  correlationId?: string | null;
  requestId?: string | null;
  now?: number;
};

export type ListDerivedOutputsInput = {
  actorAccountId: string;
  actor?: ProjectActorInput;
  projectId: string;
  domain?: string | null;
  status?: DerivedOutputStatus | string | null;
  sourceSessionId?: string | null;
  ownerAccountId?: string | null;
  limit?: number | null;
  cursor?: string | null;
};

export type GetDerivedOutputInput = {
  actorAccountId: string;
  actor?: ProjectActorInput;
  projectId: string;
  itemId: string;
};

export type UpdateDerivedOutputInput = {
  actorAccountId: string;
  actor?: ProjectActorInput;
  projectId: string;
  itemId: string;
  value?: unknown;
  status?: DerivedOutputStatus | string | null;
  correlationId?: string | null;
  requestId?: string | null;
  now?: number;
};

export type ArchiveDerivedOutputInput = {
  actorAccountId: string;
  actor?: ProjectActorInput;
  projectId: string;
  itemId: string;
  correlationId?: string | null;
  requestId?: string | null;
  now?: number;
};

type TimeIdCursor = { createdAt: number; id: string };
type DerivedOutputDb = AppDb | DbExecutor;
type SerializedJson = { json: string; byteCount: number };

const DEFAULT_MAX_JSON_BYTES = 256 * 1024;
const DERIVED_OUTPUT_STATUSES: readonly DerivedOutputStatus[] = ["draft", "published", "archived"];

/**
 * Manages derived Project data without promoting it into Session, Variable, Memory, or Session State tables.
 */
export class DerivedOutputService {
  private readonly accessService: ProjectAccessService;
  private readonly maxPayloadBytes: number;

  constructor(
    private readonly db: AppDb,
    private readonly options: ServiceOptions = {},
  ) {
    this.accessService = new ProjectAccessService(db);
    this.maxPayloadBytes = options.maxPayloadBytes ?? DEFAULT_MAX_JSON_BYTES;
  }

  create(input: CreateDerivedOutputInput): DerivedOutputRecord {
    const now = input.now ?? Date.now();
    const actor = this.resolveActor(input);
    const access = this.requireAccess(actor,input.projectId, "project.derived_output.write", "derived_output_write_denied");
    const ownerClientId = actor.actorType === "client" ? (actor.actorClientId ?? null) : null;
    const domain = normalizeDomain(input.domain);
    const status = normalizeCreateStatus(input.status);
    const serialized = serializePayload(input.value ?? {}, this.maxPayloadBytes, "derived_output");

    let sourceScope: ProjectSourceScope;
    try {
      sourceScope = resolveProjectSourceScope(this.db, {
        projectId: access.project.id,
        sourceSessionId: input.sourceSessionId,
        sourceFloorId: input.sourceFloorId,
        sourcePageId: input.sourcePageId,
      });
    } catch (error) {
      throw mapSourceScopeError(error, "derived_output_source_scope_mismatch");
    }

    const transactionResult = this.db.transaction((tx) => {
      const record = insertDerivedOutput(tx, {
        id: `dout_${nanoid()}`,
        workspaceId: access.project.workspaceId,
        projectId: access.project.id,
        accountId: access.project.accountId,
        ownerAccountId: input.actorAccountId,
        ownerClientId,
        sourceScope,
        domain,
        valueJson: serialized.json,
        status,
        now,
      });

      const operationLog = new OperationLogService(tx).append({
        accountId: access.project.accountId,
        actorClientId:ownerClientId,
        actorType: "account",
        actorId: input.actorAccountId,
        actorAccountId: input.actorAccountId,
        requestId: input.requestId,
        sourceType: "api",
        action: "derived_output.create",
        status: "succeeded",
        workspaceId: access.project.workspaceId,
        projectId: access.project.id,
        sessionId: sourceScope.sessionId,
        branchId: sourceScope.branchId,
        floorId: sourceScope.floorId,
        targetType: "derived_output",
        targetId: record.id,
        metadata: buildDerivedOutputMetadata(record, serialized.byteCount),
        createdAt: now,
      });

      const event = new ProjectEventService(tx).append({
        workspaceId: access.project.workspaceId,
        projectId: access.project.id,
        type: "derived_output.created",
        visibility: "project",
        source: "api",
        actorAccountId: input.actorAccountId,
        actorClientId: ownerClientId,
        sessionId: sourceScope.sessionId,
        branchId: sourceScope.branchId,
        floorId: sourceScope.floorId,
        pageId: sourceScope.pageId,
        operationLogId: operationLog.id,
        correlationId: input.correlationId ?? input.requestId ?? null,
        payload: buildDerivedOutputEventPayload(record),
        createdAt: now,
      });

      return { record, event };
    });

    this.publishProjectEvent(transactionResult.event);
    return transactionResult.record;
  }

  list(input: ListDerivedOutputsInput): DerivedOutputListResult {
    this.requireAccess(this.resolveActor(input), input.projectId, "project.derived_output.read", "derived_output_write_denied");

    const projectId = requireNonEmpty(input.projectId, "projectId");
    const limit = clampInteger(input.limit ?? 50, 1, 200);
    const cursor = decodeCursor(input.cursor);
    const filters: SQL[] = [eq(derivedOutputs.projectId, projectId)];
    const domain = normalizeOptionalString(input.domain);
    const sourceSessionId = normalizeOptionalString(input.sourceSessionId);
    const ownerAccountId = normalizeOptionalString(input.ownerAccountId);
    const status = input.status === undefined || input.status === null ? null : normalizeStatus(input.status);

    if (domain) filters.push(eq(derivedOutputs.domain, domain));
    if (status) filters.push(eq(derivedOutputs.status, status));
    if (sourceSessionId) filters.push(eq(derivedOutputs.sourceSessionId, sourceSessionId));
    if (ownerAccountId) filters.push(eq(derivedOutputs.ownerAccountId, ownerAccountId));
    if (cursor) filters.push(cursorFilter(cursor));

    const rows = this.db
      .select()
      .from(derivedOutputs)
      .where(and(...filters))
      .orderBy(desc(derivedOutputs.createdAt), desc(derivedOutputs.id))
      .limit(limit + 1)
      .all();

    const hasMore = rows.length > limit;
    const visibleRows = hasMore ? rows.slice(0, limit) : rows;
    const items = visibleRows.map(mapDerivedOutputRow);
    const last = items.at(-1);

    return {
      items,
      nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
    };
  }

  getById(input: GetDerivedOutputInput): DerivedOutputRecord {
    this.requireAccess(this.resolveActor(input), input.projectId, "project.derived_output.read", "derived_output_write_denied");
    const row = this.loadDerivedOutput(input.projectId, input.itemId);
    return mapDerivedOutputRow(row);
  }

  update(input: UpdateDerivedOutputInput): DerivedOutputRecord {
    const now = input.now ?? Date.now();
    const actor = this.resolveActor(input);
    const access = this.requireAccess(actor, input.projectId, "project.derived_output.write", "derived_output_write_denied");
    const row = this.loadDerivedOutput(access.project.id, input.itemId);
    const existing = mapDerivedOutputRow(row);
    ensureDeriverCanMutate(access, existing, actor);

    const valueProvided = Object.prototype.hasOwnProperty.call(input, "value");
    if (existing.status === "archived" && valueProvided) {
      throw new DerivedOutputServiceError(
        409,
        "derived_output_archived_immutable",
        "Archived derived output value cannot be changed",
      );
    }

    const requestedStatus = input.status === undefined || input.status === null
      ? existing.status
      : normalizeStatus(input.status);

    if (!canTransitionStatus(existing.status, requestedStatus)) {
      throw new DerivedOutputServiceError(
        400,
        "derived_output_invalid_status",
        `Invalid derived output status transition: ${existing.status} -> ${requestedStatus}`,
      );
    }

    let serialized: SerializedJson | null = null;
    const changedFields: string[] = [];
    if (valueProvided) {
      serialized = serializePayload(input.value, this.maxPayloadBytes, "derived_output");
      if (serialized.json !== row.valueJson) {
        changedFields.push("value");
      }
    }
    if (requestedStatus !== existing.status) {
      changedFields.push("status");
    }

    if (changedFields.length === 0) {
      return existing;
    }

    const eventType = requestedStatus === "archived" && existing.status !== "archived"
      ? "derived_output.archived"
      : "derived_output.updated";

    const transactionResult = this.db.transaction((tx) => {
      const updatedRow = tx
        .update(derivedOutputs)
        .set({
          ...(serialized ? { valueJson: serialized.json } : {}),
          status: requestedStatus,
          updatedAt: now,
        })
        .where(and(eq(derivedOutputs.projectId, access.project.id), eq(derivedOutputs.id, existing.id)))
        .returning()
        .get();
      const record = mapDerivedOutputRow(updatedRow);

      const operationLog = new OperationLogService(tx).append({
        accountId: access.project.accountId,
        actorType: "account",
        actorId: input.actorAccountId,
        actorAccountId: input.actorAccountId,
        requestId: input.requestId,
        sourceType: "api",
        action: eventType === "derived_output.archived" ? "derived_output.archive" : "derived_output.update",
        status: "succeeded",
        workspaceId: access.project.workspaceId,
        projectId: access.project.id,
        sessionId: record.sourceSessionId,
        floorId: record.sourceFloorId,
        targetType: "derived_output",
        targetId: record.id,
        metadata: {
          ...buildDerivedOutputMetadata(record, serialized?.byteCount),
          changed_fields: changedFields,
        },
        createdAt: now,
      });

      const event = new ProjectEventService(tx).append({
        workspaceId: access.project.workspaceId,
        projectId: access.project.id,
        type: eventType,
        visibility: "project",
        source: "api",
        actorAccountId: input.actorAccountId,
        sessionId: record.sourceSessionId,
        floorId: record.sourceFloorId,
        pageId: record.sourcePageId,
        operationLogId: operationLog.id,
        correlationId: input.correlationId ?? input.requestId ?? null,
        payload: {
          ...buildDerivedOutputEventPayload(record),
          changed_fields: changedFields,
        },
        createdAt: now,
      });

      return { record, event };
    });

    this.publishProjectEvent(transactionResult.event);
    return transactionResult.record;
  }

  archive(input: ArchiveDerivedOutputInput): DerivedOutputRecord {
    return this.update({
      actor: input.actor,
      actorAccountId: input.actorAccountId,
      projectId: input.projectId,
      itemId: input.itemId,
      status: "archived",
      correlationId: input.correlationId,
      requestId: input.requestId,
      now: input.now,
    });
  }

  private loadDerivedOutput(projectId: string, itemId: string): typeof derivedOutputs.$inferSelect {
    const normalizedProjectId = requireNonEmpty(projectId, "projectId");
    const normalizedItemId = requireNonEmpty(itemId, "itemId");
    const row = this.db
      .select()
      .from(derivedOutputs)
      .where(and(eq(derivedOutputs.projectId, normalizedProjectId), eq(derivedOutputs.id, normalizedItemId)))
      .limit(1)
      .get();

    if (!row) {
      throw new DerivedOutputServiceError(
        404,
        "derived_output_not_found",
        `Derived output not found: ${normalizedItemId}`,
      );
    }

    return row;
  }

  private requireAccess(
    actor:ProjectActorInput,
    projectId: string,
    action: Parameters<ProjectAccessService["requireProjectAction"]>[2],
    roleDeniedCode: DerivedOutputServiceErrorCode,
  ): ProjectAccess {
    try {
      return this.accessService.requireProjectActionForActor(actor, projectId, action);
    } catch (error) {
      if (error instanceof ProjectAccessServiceError && error.code === "project_access_denied" && error.denyReason === "role_forbidden") {
        throw new DerivedOutputServiceError(403, roleDeniedCode, `Project action denied: ${action}`);
      }
      throw error;
    }
  }

  private resolveActor(input: { actor?: ProjectActorInput; actorAccountId: string }): ProjectActorInput {
    if (input.actor) {
      return input.actor;
    }
    return { actorType: "account", actorAccountId: input.actorAccountId, actorClientId: null };
  }

  private publishProjectEvent(event: ProjectEventRecord): void {
    if (!this.options.projectEventLiveHub) {
      return;
    }

    try {
      this.options.projectEventLiveHub.publish(event);
    } catch {
      // Live publish must not roll back or hide the committed database transaction.
    }
  }
}

function insertDerivedOutput(
  db: DerivedOutputDb,
  input: {
    id: string;
    workspaceId: string;
    projectId: string;
    accountId: string;
    ownerAccountId: string;
    ownerClientId: string | null;
    sourceScope: ProjectSourceScope;
    domain: string;
    valueJson: string;
    status: DerivedOutputStatus;
    now: number;
  },
): DerivedOutputRecord {
  const row = db
    .insert(derivedOutputs)
    .values({
      id: input.id,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      accountId: input.accountId,
      ownerAccountId: input.ownerAccountId,
      ownerClientId: input.ownerClientId,
      sourceSessionId: input.sourceScope.sessionId,
      sourceFloorId: input.sourceScope.floorId,
      sourcePageId: input.sourceScope.pageId,
      domain: input.domain,
      valueJson: input.valueJson,
      status: input.status,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .returning()
    .get();

  return mapDerivedOutputRow(row);
}

function mapDerivedOutputRow(row: typeof derivedOutputs.$inferSelect): DerivedOutputRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    accountId: row.accountId,
    ownerAccountId: row.ownerAccountId,
    ownerClientId: row.ownerClientId,
    sourceSessionId: row.sourceSessionId,
    sourceFloorId: row.sourceFloorId,
    sourcePageId: row.sourcePageId,
    domain: row.domain,
    value: parseJsonField(row.valueJson),
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function normalizeDomain(value: string): string {
  const normalized = requireNonEmpty(value, "domain");
  if (normalized.length > 128) {
    throw new DerivedOutputServiceError(400, "derived_output_invalid_status", "Derived output domain is too long");
  }
  return normalized;
}

function normalizeCreateStatus(value: string | null | undefined): DerivedOutputStatus {
  if (value === undefined || value === null) return "draft";
  const status = normalizeStatus(value);
  if (status === "archived") {
    throw new DerivedOutputServiceError(400, "derived_output_invalid_status", "Derived output cannot be created as archived");
  }
  return status;
}

function normalizeStatus(value: string): DerivedOutputStatus {
  const status = requireNonEmpty(value, "status");
  if ((DERIVED_OUTPUT_STATUSES as readonly string[]).includes(status)) {
    return status as DerivedOutputStatus;
  }
  throw new DerivedOutputServiceError(400, "derived_output_invalid_status", `Invalid derived output status: ${status}`);
}

function canTransitionStatus(current: DerivedOutputStatus, next: DerivedOutputStatus): boolean {
  if (current === next) return true;
  if (current === "draft") return next === "published" || next === "archived";
  if (current === "published") return next === "archived";
  return false;
}

function ensureDeriverCanMutate(access: ProjectAccess, record: DerivedOutputRecord, actor: ProjectActorInput): void {
  if (access.role !== "deriver") {
    return;
  }
  if (actor.actorType === "client") {
    if (!actor.actorClientId || record.ownerClientId!== actor.actorClientId) {
      throw new DerivedOutputServiceError(403, "derived_output_forbidden_for_role", "Deriver can only update derived outputs owned by itself");
    }
    return;
  }
  if (record.ownerAccountId !== actor.actorAccountId) {
    throw new DerivedOutputServiceError(
      403,
      "derived_output_forbidden_for_role",
      "Deriver can only update derived outputs owned by itself",
    );
  }
}

function buildDerivedOutputMetadata(record: DerivedOutputRecord, valueByteCount?: number): Record<string, unknown> {
  return {
    workspace_id: record.workspaceId,
    project_id: record.projectId,
    domain: record.domain,
    status: record.status,
    value_byte_count: valueByteCount,
    source_session_id: record.sourceSessionId,
    source_floor_id: record.sourceFloorId,
    source_page_id: record.sourcePageId,
    owner_client_id: record.ownerClientId,
  };
}

function buildDerivedOutputEventPayload(record: DerivedOutputRecord): Record<string, unknown> {
  return {
    derived_output_id: record.id,
    domain: record.domain,
    status: record.status,
    owner_account_id: record.ownerAccountId,
    owner_client_id: record.ownerClientId,
    source_session_id: record.sourceSessionId,
    source_floor_id: record.sourceFloorId,
    source_page_id: record.sourcePageId,
  };
}

function serializePayload(value: unknown, maxBytes: number, resource: "derived_output"): SerializedJson {
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch (error) {
    throw new DerivedOutputServiceError(400, `${resource}_payload_invalid`, "Derived output value must be JSON serializable", { cause: error });
  }

  if (json === undefined) {
    throw new DerivedOutputServiceError(400, `${resource}_payload_invalid`, "Derived output value must be JSON serializable");
  }

  const byteCount = Buffer.byteLength(json, "utf-8");
  if (byteCount > maxBytes) {
    throw new DerivedOutputServiceError(413, `${resource}_payload_too_large`, "Derived output payload is too large");
  }

  return { json, byteCount };
}

function parseJsonField(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function mapSourceScopeError(error: unknown, mismatchCode: "derived_output_source_scope_mismatch"): DerivedOutputServiceError {
  if (!(error instanceof ProjectSourceScopeError)) {
    throw error;
  }

  if (error.reason === "scope_mismatch") {
    return new DerivedOutputServiceError(409, mismatchCode, error.message);
  }
  return new DerivedOutputServiceError(404, error.reason, error.message);
}

function cursorFilter(cursor: TimeIdCursor): SQL {
  return or(
    lt(derivedOutputs.createdAt, cursor.createdAt),
    and(eq(derivedOutputs.createdAt, cursor.createdAt), lt(derivedOutputs.id, cursor.id)),
  )!;
}

function encodeCursor(cursor: TimeIdCursor): string {
  return Buffer.from(JSON.stringify({ created_at: cursor.createdAt, id: cursor.id }), "utf-8").toString("base64url");
}

function decodeCursor(cursor: string | null | undefined): TimeIdCursor | null {
  const normalized = normalizeOptionalString(cursor);
  if (!normalized) return null;

  try {
    const raw = JSON.parse(Buffer.from(normalized, "base64url").toString("utf-8")) as Record<string, unknown>;
    const createdAt = raw.created_at;
    const id = raw.id;
    if (typeof createdAt !== "number" || !Number.isFinite(createdAt) || typeof id !== "string" || id.length === 0) {
      throw new Error("invalid cursor");
    }
    return { createdAt: Math.trunc(createdAt), id };
  } catch {
    throw new DerivedOutputServiceError(400, "invalid_cursor", "Derived output cursor is invalid");
  }
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function requireNonEmpty(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  return trimmed;
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  const integer = Math.trunc(value);
  return Math.min(max, Math.max(min, integer));
}
