import { and, desc, eq, lt, or, type SQL } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { AppDb, DbExecutor } from "../db/client.js";
import { projectEvents, projectInboxItems } from "../db/schema.js";
import { OperationLogService } from "./operation-log-service.js";
import { ProjectAccessService, ProjectAccessServiceError, type ProjectAccess, type ProjectActorInput } from "./project-access-service.js";
import type { ProjectEventLiveHub } from "./project-event-live-hub.js";
import { ProjectEventService, type ProjectEventRecord } from "./project-event-service.js";
import { ProjectSourceScopeError, resolveProjectSourceScope, type ProjectSourceScope } from "./project-source-scope.js";

export type ProjectInboxItemStatus = "pending" | "accepted" | "rejected" | "archived";
export type ProjectInboxDecision = "accept" | "reject" | "archive";

export type ProjectInboxItemRecord = {
  id: string;
  workspaceId: string;
  projectId: string;
  accountId: string;
  senderAccountId: string;
  senderClientId: string | null;
  type: string;
  title: string | null;
  payload: unknown;
  sourceEventId: string | null;
  sourceSessionId: string | null;
  sourceFloorId: string | null;
  sourcePageId: string | null;
  status: ProjectInboxItemStatus;
  decidedByAccountId: string | null;
  decidedByClientId: string | null;
  decidedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type ProjectInboxListResult = {
  items: ProjectInboxItemRecord[];
  nextCursor: string | null;
};

export type ProjectInboxServiceErrorCode =
  | "project_inbox_read_denied"
  | "project_inbox_write_denied"
  | "project_inbox_decide_denied"
  | "project_inbox_item_not_found"
  | "project_inbox_invalid_transition"
  | "project_inbox_source_scope_mismatch"
  | "project_inbox_payload_too_large"
  | "project_inbox_payload_invalid"
  | "invalid_cursor"
  | "session_not_found"
  | "floor_not_found"
  | "page_not_found";

export class ProjectInboxServiceError extends Error {
  constructor(
    public readonly statusCode: 400 | 403 | 404 | 409 | 413,
    public readonly code: ProjectInboxServiceErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "ProjectInboxServiceError";
  }
}

type ServiceOptions = {
  projectEventLiveHub?: ProjectEventLiveHub;
  maxPayloadBytes?: number;
};

export type CreateInboxItemInput = {
  actorAccountId: string;
  actor?: ProjectActorInput;
  projectId: string;
  type: string;
  title?: string | null;
  payload?: unknown;
  sourceEventId?: string | null;
  sourceSessionId?: string | null;
  sourceFloorId?: string | null;
  sourcePageId?: string | null;
  correlationId?: string | null;
  requestId?: string | null;
  now?: number;
};

export type ListInboxItemsInput = {
  actorAccountId: string;
  actor?: ProjectActorInput;
  projectId: string;
  status?: ProjectInboxItemStatus | string | null;
  type?: string | null;
  senderAccountId?: string | null;
  sourceSessionId?: string | null;
  limit?: number | null;
  cursor?: string | null;
};

export type GetInboxItemInput = {
  actorAccountId: string;
  actor?: ProjectActorInput;
  projectId: string;
  itemId: string;
};

export type DecideInboxItemInput = {
  actorAccountId: string;
  actor?: ProjectActorInput;
  projectId: string;
  itemId: string;
  decision: ProjectInboxDecision | string;
  note?: string | null;
  correlationId?: string | null;
  requestId?: string | null;
  now?: number;
};

type ProjectInboxDb = AppDb | DbExecutor;
type SerializedJson = { json: string; byteCount: number };
type TimeIdCursor = { createdAt: number; id: string };

const DEFAULT_MAX_JSON_BYTES = 256 * 1024;
const INBOX_STATUSES: readonly ProjectInboxItemStatus[] = ["pending", "accepted", "rejected", "archived"];
const INBOX_DECISIONS: readonly ProjectInboxDecision[] = ["accept", "reject", "archive"];

/**
 * Manages Project Inbox items. Accepting an item only updates Inbox state and never writes the main Session.
 */
export class ProjectInboxService {
  private readonly accessService: ProjectAccessService;
  private readonly maxPayloadBytes: number;

  constructor(
    private readonly db: AppDb,
    private readonly options: ServiceOptions = {},
  ) {
    this.accessService = new ProjectAccessService(db);
    this.maxPayloadBytes = options.maxPayloadBytes ?? DEFAULT_MAX_JSON_BYTES;
  }

  create(input: CreateInboxItemInput): ProjectInboxItemRecord {
    const now = input.now ?? Date.now();
    const actor = this.resolveActor(input);
    const access =this.requireAccess(actor, input.projectId, "project.inbox.write", "project_inbox_write_denied");
    const senderClientId = actor.actorType ==="client" ? (actor.actorClientId ?? null) : null;
    const type = normalizeType(input.type);
    const title = normalizeTitle(input.title);
    const serialized = serializePayload(input.payload ?? {}, this.maxPayloadBytes);

    let sourceScope: ProjectSourceScope;
    try {
      sourceScope = resolveProjectSourceScope(this.db, {
        projectId: access.project.id,
        sourceSessionId: input.sourceSessionId,
        sourceFloorId: input.sourceFloorId,
        sourcePageId: input.sourcePageId,
      });
    } catch (error) {
      throw mapSourceScopeError(error, "project_inbox_source_scope_mismatch");
    }

    const sourceEventId = normalizeSourceEventId(this.db, access.project.id, input.sourceEventId);

    const transactionResult = this.db.transaction((tx) => {
      const record = insertInboxItem(tx, {
        id: `pinbox_${nanoid()}`,
        workspaceId: access.project.workspaceId,
        projectId: access.project.id,
        accountId: access.project.accountId,
        senderAccountId: input.actorAccountId,
        senderClientId,
        type,
        title,
        payloadJson: serialized.json,
        sourceEventId,
        sourceScope,
        now,
      });

      const operationLog = new OperationLogService(tx).append({
        accountId: access.project.accountId,
        actorType: "account",
        actorId: input.actorAccountId,
        actorAccountId: input.actorAccountId,
        actorClientId: senderClientId,
        requestId: input.requestId,
        sourceType: "api",
        action: "project_inbox_item.create",
        status: "succeeded",
        workspaceId: access.project.workspaceId,
        projectId: access.project.id,
        sessionId: sourceScope.sessionId,
        branchId: sourceScope.branchId,
        floorId: sourceScope.floorId,
        targetType: "project_inbox_item",
        targetId: record.id,
        metadata: buildInboxMetadata(record, serialized.byteCount),
        createdAt: now,
      });

      const event = new ProjectEventService(tx).append({
        workspaceId: access.project.workspaceId,
        projectId: access.project.id,
        type: "project_inbox.item.created",
        visibility: "project",
        source: "api",
        actorAccountId: input.actorAccountId,
        actorClientId: senderClientId,
        sessionId: sourceScope.sessionId,
        branchId: sourceScope.branchId,
        floorId: sourceScope.floorId,
        pageId: sourceScope.pageId,
        operationLogId: operationLog.id,
        correlationId: input.correlationId ?? input.requestId ?? null,
        causationEventId: sourceEventId,
        payload: buildInboxCreatedPayload(record),
        createdAt: now,
      });

      return { record, event };
    });

    this.publishProjectEvent(transactionResult.event);
    return transactionResult.record;
  }

  list(input: ListInboxItemsInput): ProjectInboxListResult {
    const actor = this.resolveActor(input);
    const access = this.requireAccess(actor, input.projectId, "project.inbox.read", "project_inbox_read_denied");
    const senderAccountId = normalizeOptionalString(input.senderAccountId);

    if (access.role === "deriver" && senderAccountId && actor.actorType === "account" && senderAccountId !== input.actorAccountId) {
      return { items: [], nextCursor: null };
    }

    const projectId = requireNonEmpty(input.projectId, "projectId");
    const limit = clampInteger(input.limit ?? 50, 1, 200);
    const cursor = decodeCursor(input.cursor);
    const filters: SQL[] = [eq(projectInboxItems.projectId, projectId)];
    const status = input.status === undefined || input.status === null ? null : normalizeStatus(input.status);
    const type = normalizeOptionalString(input.type);
    const sourceSessionId = normalizeOptionalString(input.sourceSessionId);

    if (status) filters.push(eq(projectInboxItems.status, status));
    if (type) filters.push(eq(projectInboxItems.type, type));
    if (sourceSessionId) filters.push(eq(projectInboxItems.sourceSessionId, sourceSessionId));
    if (access.role === "deriver") {
      if (actor.actorType === "client" && actor.actorClientId) {
        filters.push(eq(projectInboxItems.senderClientId, actor.actorClientId));
      } else {
        filters.push(eq(projectInboxItems.senderAccountId, input.actorAccountId));
      }
    } else if (senderAccountId) {
      filters.push(eq(projectInboxItems.senderAccountId, senderAccountId));
    }
    if (cursor) filters.push(cursorFilter(cursor));

    const rows = this.db
      .select()
      .from(projectInboxItems)
      .where(and(...filters))
      .orderBy(desc(projectInboxItems.createdAt), desc(projectInboxItems.id))
      .limit(limit + 1)
      .all();

    const hasMore = rows.length > limit;
    const visibleRows = hasMore ? rows.slice(0, limit) : rows;
    const items = visibleRows.map(mapInboxItemRow);
    const last = items.at(-1);

    return {
      items,
      nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
    };
  }

  getById(input: GetInboxItemInput): ProjectInboxItemRecord {
    const actor = this.resolveActor(input);
    const access = this.requireAccess(actor, input.projectId, "project.inbox.read", "project_inbox_read_denied");
    const record = mapInboxItemRow(this.loadInboxItem(access.project.id, input.itemId));
    const isClientActor = actor.actorType === "client" && actor.actorClientId;
    const ownsViaAccount = record.senderAccountId === input.actorAccountId;
    const ownsViaClient = isClientActor ? record.senderClientId === actor.actorClientId : false;
    if (access.role === "deriver" && !ownsViaAccount && !ownsViaClient) {
      throw new ProjectInboxServiceError(404, "project_inbox_item_not_found", `Project inbox item not found: ${input.itemId}`);
    }
    return record;
  }

  decide(input: DecideInboxItemInput): ProjectInboxItemRecord {
    const now = input.now ?? Date.now();
    const actor = this.resolveActor(input);
    const access = this.requireAccess(actor, input.projectId, "project.inbox.decide", "project_inbox_decide_denied");
    const decidedByClientId = actor.actorType === "client" ? (actor.actorClientId ?? null) : null;
    const decision = normalizeDecision(input.decision);
    const existing = mapInboxItemRow(this.loadInboxItem(access.project.id, input.itemId));
    const nextStatus = statusFromDecision(decision);

    if (existing.status === "archived" && nextStatus === "archived") {
      return existing;
    }

    if (!canTransitionStatus(existing.status, nextStatus)) {
      throw new ProjectInboxServiceError(
        409,
        "project_inbox_invalid_transition",
        `Invalid project inbox transition: ${existing.status} -> ${nextStatus}`,
      );
    }

    // Accepting an item only records the inbox decision. It does not merge payloads into the main Session.
    const transactionResult = this.db.transaction((tx) => {
      const updatedRow = tx
        .update(projectInboxItems)
        .set({
          status: nextStatus,
          decidedByAccountId: input.actorAccountId,
          decidedByClientId,
          decidedAt: now,
          updatedAt: now,
        })
        .where(and(eq(projectInboxItems.projectId, access.project.id), eq(projectInboxItems.id, existing.id)))
        .returning()
        .get();
      const record = mapInboxItemRow(updatedRow);

      const operationLog = new OperationLogService(tx).append({
        accountId: access.project.accountId,
        actorType: "account",
        actorId: input.actorAccountId,
        actorAccountId: input.actorAccountId,
        actorClientId: decidedByClientId,

        requestId: input.requestId,
        sourceType: "api",
        action: "project_inbox_item.decide",
        status: "succeeded",
        workspaceId: access.project.workspaceId,
        projectId: access.project.id,
        sessionId: record.sourceSessionId,
        floorId: record.sourceFloorId,
        targetType: "project_inbox_item",
        targetId: record.id,
        metadata: {
          ...buildInboxMetadata(record),
          decision,
          note: normalizeOptionalString(input.note),
        },
        createdAt: now,
      });

      const event = new ProjectEventService(tx).append({
        workspaceId: access.project.workspaceId,
        projectId: access.project.id,
        type: eventTypeForDecision(decision),
        visibility: "project",
        actorClientId: decidedByClientId,

        source: "api",
        actorAccountId: input.actorAccountId,
        sessionId: record.sourceSessionId,
        floorId: record.sourceFloorId,
        pageId: record.sourcePageId,
        operationLogId: operationLog.id,
        correlationId: input.correlationId ?? input.requestId ?? null,
        causationEventId: record.sourceEventId,
        payload: buildInboxDecisionPayload(record, decision),
        createdAt: now,
      });

      return { record, event };
    });

    this.publishProjectEvent(transactionResult.event);
    return transactionResult.record;
  }

  private loadInboxItem(projectId: string, itemId: string): typeof projectInboxItems.$inferSelect {
    const normalizedProjectId = requireNonEmpty(projectId, "projectId");
    const normalizedItemId = requireNonEmpty(itemId, "itemId");
    const row = this.db
      .select()
      .from(projectInboxItems)
      .where(and(eq(projectInboxItems.projectId, normalizedProjectId), eq(projectInboxItems.id, normalizedItemId)))
      .limit(1)
      .get();

    if (!row) {
      throw new ProjectInboxServiceError(
        404,
        "project_inbox_item_not_found",
        `Project inbox item not found: ${normalizedItemId}`,
      );
    }

    return row;
  }

  private requireAccess(
    actor: ProjectActorInput,
    projectId: string,
    action: Parameters<ProjectAccessService["requireProjectAction"]>[2],
    roleDeniedCode: ProjectInboxServiceErrorCode,
  ): ProjectAccess {
    try {
      return this.accessService.requireProjectActionForActor(actor,projectId, action);
    } catch (error) {
      if (error instanceof ProjectAccessServiceError && error.code === "project_access_denied" && error.denyReason === "role_forbidden") {
        throw new ProjectInboxServiceError(403, roleDeniedCode, `Project action denied: ${action}`);
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

function insertInboxItem(
  db: ProjectInboxDb,
  input: {
    id: string;
    workspaceId: string;
    projectId: string;
    accountId: string;
    senderAccountId: string;
    senderClientId: string | null;
    type: string;
    title: string | null;
    payloadJson: string;
    sourceEventId: string | null;
    sourceScope: ProjectSourceScope;
    now: number;
  },
): ProjectInboxItemRecord {
  const row = db
    .insert(projectInboxItems)
    .values({
      id: input.id,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      accountId: input.accountId,
      senderAccountId: input.senderAccountId,
      senderClientId: input.senderClientId,
      type: input.type,
      title: input.title,
      payloadJson: input.payloadJson,
      sourceEventId: input.sourceEventId,
      sourceSessionId: input.sourceScope.sessionId,
      sourceFloorId: input.sourceScope.floorId,
      sourcePageId: input.sourceScope.pageId,
      status: "pending",
      decidedByAccountId: null,
      decidedByClientId: null,
      decidedAt: null,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .returning()
    .get();

  return mapInboxItemRow(row);
}

function mapInboxItemRow(row: typeof projectInboxItems.$inferSelect): ProjectInboxItemRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    accountId: row.accountId,
    senderAccountId: row.senderAccountId,
    senderClientId: row.senderClientId,
    type: row.type,
    title: row.title,
    payload: parseJsonField(row.payloadJson),
    sourceEventId: row.sourceEventId,
    sourceSessionId: row.sourceSessionId,
    sourceFloorId: row.sourceFloorId,
    sourcePageId: row.sourcePageId,
    status: row.status,
    decidedByAccountId: row.decidedByAccountId,
    decidedByClientId: row.decidedByClientId,
    decidedAt: row.decidedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function normalizeType(value: string): string {
  const normalized = requireNonEmpty(value, "type");
  if (normalized.length > 128) {
    throw new ProjectInboxServiceError(400, "project_inbox_source_scope_mismatch", "Project inbox type is too long");
  }
  return normalized;
}

function normalizeTitle(value: string | null | undefined): string | null {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return null;
  if (normalized.length > 200) {
    throw new ProjectInboxServiceError(400, "project_inbox_source_scope_mismatch", "Project inbox title is too long");
  }
  return normalized;
}

function normalizeStatus(value: string): ProjectInboxItemStatus {
  const status = requireNonEmpty(value, "status");
  if ((INBOX_STATUSES as readonly string[]).includes(status)) {
    return status as ProjectInboxItemStatus;
  }
  throw new ProjectInboxServiceError(409, "project_inbox_invalid_transition", `Invalid project inbox status: ${status}`);
}

function normalizeDecision(value: string): ProjectInboxDecision {
  const decision = requireNonEmpty(value, "decision");
  if ((INBOX_DECISIONS as readonly string[]).includes(decision)) {
    return decision as ProjectInboxDecision;
  }
  throw new ProjectInboxServiceError(409, "project_inbox_invalid_transition", `Invalid project inbox decision: ${decision}`);
}

function statusFromDecision(decision: ProjectInboxDecision): ProjectInboxItemStatus {
  if (decision === "accept") return "accepted";
  if (decision === "reject") return "rejected";
  return "archived";
}

function canTransitionStatus(current: ProjectInboxItemStatus, next: ProjectInboxItemStatus): boolean {
  if (current === "pending") return next === "accepted" || next === "rejected" || next === "archived";
  if (current === "accepted" || current === "rejected") return next === "archived";
  return current === "archived" && next === "archived";
}

function eventTypeForDecision(decision: ProjectInboxDecision): string {
  if (decision === "accept") return "project_inbox.item.accepted";
  if (decision === "reject") return "project_inbox.item.rejected";
  return "project_inbox.item.archived";
}

function normalizeSourceEventId(db: AppDb, projectId: string, sourceEventId: string | null | undefined): string | null {
  const normalized = normalizeOptionalString(sourceEventId);
  if (!normalized) return null;

  const row = db
    .select({ id: projectEvents.id, projectId: projectEvents.projectId })
    .from(projectEvents)
    .where(eq(projectEvents.id, normalized))
    .limit(1)
    .get();

  if (!row || row.projectId !== projectId) {
    throw new ProjectInboxServiceError(
      409,
      "project_inbox_source_scope_mismatch",
      "Source project event does not belong to the project",
    );
  }

  return row.id;
}

function buildInboxMetadata(record: ProjectInboxItemRecord, payloadByteCount?: number): Record<string, unknown> {
  return {
    workspace_id: record.workspaceId,
    project_id: record.projectId,
    type: record.type,
    title: record.title,
    status: record.status,
    payload_byte_count: payloadByteCount,
    sender_account_id: record.senderAccountId,
    sender_client_id: record.senderClientId,
    source_event_id: record.sourceEventId,
    source_session_id: record.sourceSessionId,
    source_floor_id: record.sourceFloorId,
    source_page_id: record.sourcePageId,
  };
}

function buildInboxCreatedPayload(record: ProjectInboxItemRecord): Record<string, unknown> {
  return {
    inbox_item_id: record.id,
    type: record.type,
    title: record.title,
    status: record.status,
    sender_account_id: record.senderAccountId,
    sender_client_id: record.senderClientId,
    source_event_id: record.sourceEventId,
    source_session_id: record.sourceSessionId,
    source_floor_id: record.sourceFloorId,
    source_page_id: record.sourcePageId,
  };
}

function buildInboxDecisionPayload(
  record: ProjectInboxItemRecord,
  decision: ProjectInboxDecision,
): Record<string, unknown> {
  return {
    inbox_item_id: record.id,
    type: record.type,
    status: record.status,
    decision,
    sender_account_id: record.senderAccountId,
    decided_by_account_id: record.decidedByAccountId,
    decided_by_client_id: record.decidedByClientId,
    sender_client_id: record.senderClientId,
    source_event_id: record.sourceEventId,
    source_session_id: record.sourceSessionId,
    source_floor_id: record.sourceFloorId,
    source_page_id: record.sourcePageId,
  };
}

function serializePayload(value: unknown, maxBytes: number): SerializedJson {
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch (error) {
    throw new ProjectInboxServiceError(400, "project_inbox_payload_invalid", "Project inbox payload must be JSON serializable", { cause: error });
  }

  if (json === undefined) {
    throw new ProjectInboxServiceError(400, "project_inbox_payload_invalid", "Project inbox payload must be JSON serializable");
  }

  const byteCount = Buffer.byteLength(json, "utf-8");
  if (byteCount > maxBytes) {
    throw new ProjectInboxServiceError(413, "project_inbox_payload_too_large", "Project inbox payload is too large");
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

function mapSourceScopeError(error: unknown, mismatchCode: "project_inbox_source_scope_mismatch"): ProjectInboxServiceError {
  if (!(error instanceof ProjectSourceScopeError)) {
    throw error;
  }

  if (error.reason === "scope_mismatch") {
    return new ProjectInboxServiceError(409, mismatchCode, error.message);
  }
  return new ProjectInboxServiceError(404, error.reason, error.message);
}

function cursorFilter(cursor: TimeIdCursor): SQL {
  return or(
    lt(projectInboxItems.createdAt, cursor.createdAt),
    and(eq(projectInboxItems.createdAt, cursor.createdAt), lt(projectInboxItems.id, cursor.id)),
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
    throw new ProjectInboxServiceError(400, "invalid_cursor", "Project inbox cursor is invalid");
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
