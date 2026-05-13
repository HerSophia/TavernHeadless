import { and, asc, eq, gt, inArray, sql, type SQL } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { AppDb, DbExecutor } from "../db/client.js";
import { projectEventSequences, projectEvents, projects } from "../db/schema.js";

export type ProjectEventVisibility = "project" | "owner" | "internal";
export type ProjectEventSource = "api" | "runtime_job" | "migration" | "system";

export type ProjectEventRecord = {
  id: string;
  workspaceId: string;
  projectId: string;
  sequence: number;
  type: string;
  visibility: ProjectEventVisibility;
  source: ProjectEventSource;
  actorAccountId: string | null;
  sessionId: string | null;
  branchId: string | null;
  floorId: string | null;
  pageId: string | null;
  messageId: string | null;
  operationLogId: string | null;
  correlationId: string | null;
  causationEventId: string | null;
  payload: unknown;
  createdAt: number;
};

export type AppendProjectEventInput = {
  id?: string;
  workspaceId: string;
  projectId: string;
  type: string;
  visibility?: ProjectEventVisibility;
  source?: ProjectEventSource;
  actorAccountId?: string | null;
  sessionId?: string | null;
  branchId?: string | null;
  floorId?: string | null;
  pageId?: string | null;
  messageId?: string | null;
  operationLogId?: string | null;
  correlationId?: string | null;
  causationEventId?: string | null;
  payload?: unknown;
  createdAt?: number;
};

export type ListProjectEventsOptions = {
  after?: number | null;
  limit?: number | null;
  types?: readonly string[] | null;
  sessionId?: string | null;
  visibilitySet?: readonly ProjectEventVisibility[] | null;
};

export type ProjectEventListResult = {
  items: ProjectEventRecord[];
  nextAfter: number | null;
  hasMore: boolean;
};

export type ProjectEventServiceErrorCode =
  | "project_not_found"
  | "project_archived"
  | "project_event_workspace_mismatch"
  | "project_event_payload_invalid";

export class ProjectEventServiceError extends Error {
  constructor(
    public readonly statusCode: 400 | 404 | 409,
    public readonly code: ProjectEventServiceErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "ProjectEventServiceError";
  }
}

/**
 * Appends and queries persistent Project events.
 */
export class ProjectEventService {
  constructor(private readonly db: AppDb | DbExecutor) {}

  append(input: AppendProjectEventInput): ProjectEventRecord {
    const now = input.createdAt ?? Date.now();
    const workspaceId = requireNonEmpty(input.workspaceId, "workspaceId");
    const projectId = requireNonEmpty(input.projectId, "projectId");
    const type = requireNonEmpty(input.type, "type");
    const project = this.requireProject(projectId);

    if (project.workspaceId !== workspaceId) {
      throw new ProjectEventServiceError(
        409,
        "project_event_workspace_mismatch",
        `Project workspace mismatch: ${projectId}`,
      );
    }

    this.db
      .insert(projectEventSequences)
      .values({
        projectId,
        currentSequence: 0,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .run();

    this.db
      .update(projectEventSequences)
      .set({
        currentSequence: sql`${projectEventSequences.currentSequence} + 1`,
        updatedAt: now,
      })
      .where(eq(projectEventSequences.projectId, projectId))
      .run();

    const sequenceRow = this.db
      .select({ currentSequence: projectEventSequences.currentSequence })
      .from(projectEventSequences)
      .where(eq(projectEventSequences.projectId, projectId))
      .limit(1)
      .get();

    if (!sequenceRow) {
      throw new Error(`Failed to allocate project event sequence: ${projectId}`);
    }

    const row = this.db
      .insert(projectEvents)
      .values({
        id: input.id ?? `evt_${nanoid()}`,
        workspaceId,
        projectId,
        sequence: sequenceRow.currentSequence,
        type,
        visibility: input.visibility ?? "project",
        source: input.source ?? "api",
        actorAccountId: normalizeNullableString(input.actorAccountId),
        sessionId: normalizeNullableString(input.sessionId),
        branchId: normalizeNullableString(input.branchId),
        floorId: normalizeNullableString(input.floorId),
        pageId: normalizeNullableString(input.pageId),
        messageId: normalizeNullableString(input.messageId),
        operationLogId: normalizeNullableString(input.operationLogId),
        correlationId: normalizeNullableString(input.correlationId),
        causationEventId: normalizeNullableString(input.causationEventId),
        payloadJson: stringifyProjectEventPayload(input.payload),
        createdAt: now,
      })
      .returning()
      .get();

    return mapProjectEventRow(row);
  }

  appendMany(inputs: readonly AppendProjectEventInput[]): ProjectEventRecord[] {
    return inputs.map((input) => this.append(input));
  }

  list(projectId: string, options: ListProjectEventsOptions = {}): ProjectEventListResult {
    const normalizedProjectId = requireNonEmpty(projectId, "projectId");
    const limit = clampInteger(options.limit ?? 100, 1, 500);
    const after = normalizeSequenceCursor(options.after);
    const filters: SQL[] = [eq(projectEvents.projectId, normalizedProjectId)];

    if (after > 0) {
      filters.push(gt(projectEvents.sequence, after));
    }

    const types = normalizeStringList(options.types);
    if (types.length > 0) {
      filters.push(inArray(projectEvents.type, types));
    }

    const sessionId = normalizeNullableString(options.sessionId);
    if (sessionId) {
      filters.push(eq(projectEvents.sessionId, sessionId));
    }

    const visibilitySet = normalizeVisibilitySet(options.visibilitySet ?? ["project"]);
    if (visibilitySet.length === 0) {
      filters.push(sql`1 = 0`);
    } else {
      filters.push(inArray(projectEvents.visibility, visibilitySet));
    }

    const rows = this.db
      .select()
      .from(projectEvents)
      .where(and(...filters))
      .orderBy(asc(projectEvents.sequence))
      .limit(limit + 1)
      .all();

    const hasMore = rows.length > limit;
    const visibleRows = hasMore ? rows.slice(0, limit) : rows;
    const items = visibleRows.map(mapProjectEventRow);
    const last = items.at(-1);

    return {
      items,
      nextAfter: last?.sequence ?? (options.after ?? null),
      hasMore,
    };
  }

  private requireProject(projectId: string): { id: string; workspaceId: string; status: "active" | "archived" } {
    const row = this.db
      .select({
        id: projects.id,
        workspaceId: projects.workspaceId,
        status: projects.status,
      })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)
      .get();

    if (!row) {
      throw new ProjectEventServiceError(
        404,
        "project_not_found",
        `Project not found: ${projectId}`,
      );
    }

    if (row.status === "archived") {
      throw new ProjectEventServiceError(
        409,
        "project_archived",
        `Project is archived: ${projectId}`,
      );
    }

    return row;
  }
}

export function mapProjectEventRow(row: typeof projectEvents.$inferSelect): ProjectEventRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    sequence: row.sequence,
    type: row.type,
    visibility: row.visibility,
    source: row.source,
    actorAccountId: row.actorAccountId,
    sessionId: row.sessionId,
    branchId: row.branchId,
    floorId: row.floorId,
    pageId: row.pageId,
    messageId: row.messageId,
    operationLogId: row.operationLogId,
    correlationId: row.correlationId,
    causationEventId: row.causationEventId,
    payload: parseProjectEventPayload(row.payloadJson),
    createdAt: row.createdAt,
  };
}

export function stringifyProjectEventPayload(payload: unknown): string {
  if (payload === undefined || payload === null) {
    return "{}";
  }

  try {
    const json = JSON.stringify(payload);
    return json === undefined ? "{}" : json;
  } catch (error) {
    throw new ProjectEventServiceError(
      400,
      "project_event_payload_invalid",
      "Project event payload must be JSON serializable",
      { cause: error },
    );
  }
}

export function parseProjectEventPayload(payloadJson: string): unknown {
  try {
    return JSON.parse(payloadJson);
  } catch {
    return payloadJson;
  }
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeStringList(values: readonly string[] | null | undefined): string[] {
  if (!values) return [];
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function normalizeVisibilitySet(values: readonly ProjectEventVisibility[] | null | undefined): ProjectEventVisibility[] {
  if (!values) return [];
  return Array.from(new Set(values));
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

function normalizeSequenceCursor(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.trunc(value));
}
