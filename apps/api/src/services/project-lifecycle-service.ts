import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { AppDb, DbExecutor } from "../db/client.js";
import { projects } from "../db/schema.js";
import { GOVERNANCE_OPERATION_ACTIONS } from "./governance/operation-log-names.js";
import { summarizePayloadForOperationLog } from "./governance/trace-summary.js";
import { OperationLogService } from "./operation-log-service.js";
import {
  ProjectAccessService,
  type ProjectActorInput,
} from "./project-access-service.js";
import { ProjectEventService } from "./project-event-service.js";
import { ensureOwnerProjectMembership } from "./project-membership-service.js";
import {
  WorkspaceScopeService,
  WorkspaceScopeServiceError,
} from "./workspace-scope-service.js";

export type ProjectLifecycleStatus = "active" | "archived";
export type ProjectLifecycleKind = "session_default" | "manual";

export type ProjectLifecycleRecord = {
  id: string;
  accountId: string;
  workspaceId: string;
  name: string;
  description: string | null;
  kind: ProjectLifecycleKind;
  status: ProjectLifecycleStatus;
  settingsOverrideJson: string;
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

/**
 * Combined access + audit actor. Access checks use the {@link ProjectActorInput}
 * fields; the operation-log actor identity is derived from them.
 */
export type ProjectLifecycleActor = ProjectActorInput & {
  source?: string;
  requestId?: string | null;
};

export type ProjectLifecycleServiceErrorCode =
  | "workspace_not_found"
  | "workspace_archived"
  | "project_name_required"
  | "project_update_empty"
  | "project_not_found"
  | "project_not_archived"
  | "project_session_default_immutable";

export class ProjectLifecycleServiceError extends Error {
  constructor(
    public readonly statusCode: 400 | 404 | 409,
    public readonly code: ProjectLifecycleServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProjectLifecycleServiceError";
  }
}

export type CreateProjectInput = {
  actor: ProjectLifecycleActor;
  workspaceId?: string | null;
  name: string;
  description?: string | null;
  settings?: Record<string, unknown> | null;
  now?: number;
};

export type UpdateProjectInput = {
  actor: ProjectLifecycleActor;
  id: string;
  name?: string;
  description?: string | null;
  settings?: Record<string, unknown> | null;
  now?: number;
};

export type ArchiveProjectInput = {
  actor: ProjectLifecycleActor;
  id: string;
  now?: number;
};

export type RestoreProjectInput = ArchiveProjectInput;

export type DuplicateProjectInput = {
  actor: ProjectLifecycleActor;
  id: string;
  name?: string;
  now?: number;
};

type ProjectLifecycleServiceOptions = {
  operationLog?: OperationLogService;
  projectEvents?: ProjectEventService;
  projectAccess?: ProjectAccessService;
  workspaceScope?: WorkspaceScopeService;
};

const PROJECT_LIFECYCLE_EVENT = {
  created: "project.lifecycle.created",
  updated: "project.lifecycle.updated",
  archived: "project.lifecycle.archived",
  restored: "project.lifecycle.restored",
} as const;

/**
 * WP-A2: explicit Project lifecycle writes.
 *
 * Read paths keep using the existing project queries and {@link ProjectAccessService}.
 * This service owns create / update / archive / restore / duplicate, always
 * writing a `project.*` operation-log entry plus a `project.lifecycle.*` project
 * event, and never breaking the `session_default` Project invariant.
 */
export class ProjectLifecycleService {
  private readonly operationLog: OperationLogService;
  private readonly projectEvents: ProjectEventService;
  private readonly access: ProjectAccessService;
  private readonly workspaceScope: WorkspaceScopeService;

  constructor(
    private readonly db: AppDb | DbExecutor,
    options: ProjectLifecycleServiceOptions = {},
  ) {
    this.operationLog = options.operationLog ?? new OperationLogService(db);
    this.projectEvents = options.projectEvents ?? new ProjectEventService(db);
    this.access = options.projectAccess ?? new ProjectAccessService(db);
    this.workspaceScope = options.workspaceScope ?? new WorkspaceScopeService(db);
  }

  create(input: CreateProjectInput): ProjectLifecycleRecord {
    const accountId = requireNonEmpty(input.actor.actorAccountId, "actorAccountId");
    const name = normalizeName(input.name);
    if (!name) {
      throw new ProjectLifecycleServiceError(
        400,
        "project_name_required",
        "Project name must be a non-empty string",
      );
    }

    const now = input.now ?? Date.now();
    const workspace = this.resolveWorkspaceForCreate(accountId, input.workspaceId, now);
    const description = normalizeDescription(input.description);
    const settingsOverrideJson = serializeSettings(input.settings) ?? "{}";
    const projectId = `proj_${nanoid()}`;

    const inserted = this.db
      .insert(projects)
      .values({
        id: projectId,
        accountId,
        workspaceId: workspace.id,
        name,
        description,
        kind: "manual",
        status: "active",
        settingsOverrideJson,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .all()[0];

    if (!inserted) {
      throw new Error("Failed to create project");
    }

    ensureOwnerProjectMembership(this.db, {
      accountId,
      workspaceId: workspace.id,
      projectId,
      createdByAccountId: accountId,
      now,
    });

    const record = toProjectLifecycleRecord(inserted);
    const logId = this.appendAudit(input.actor, {
      accountId,
      workspaceId: record.workspaceId,
      projectId: record.id,
      action: GOVERNANCE_OPERATION_ACTIONS.project.create,
      afterRef: { id: record.id, name: record.name, kind: record.kind, status: record.status },
      metadata: {
        project_kind: record.kind,
        ...(input.settings ? { settings_summary: summarizePayloadForOperationLog(input.settings) } : {}),
      },
      now,
    });
    this.emitEvent(input.actor, record, PROJECT_LIFECYCLE_EVENT.created, logId, {
      name: record.name,
      kind: record.kind,
    }, now);

    return record;
  }

  update(input: UpdateProjectInput): ProjectLifecycleRecord {
    const now = input.now ?? Date.now();
    const access = this.access.requireProjectActionForActor(input.actor, input.id, "project.manage_settings");
    const existing = this.requireProjectRow(access.project.id);

    const hasName = input.name !== undefined;
    const hasDescription = input.description !== undefined;
    const hasSettings = input.settings !== undefined;
    if (!hasName && !hasDescription && !hasSettings) {
      throw new ProjectLifecycleServiceError(
        400,
        "project_update_empty",
        "At least one project field must be provided",
      );
    }

    const patch: Partial<typeof projects.$inferInsert> = {};
    if (hasName) {
      const name = normalizeName(input.name);
      if (!name) {
        throw new ProjectLifecycleServiceError(
          400,
          "project_name_required",
          "Project name must be a non-empty string",
        );
      }
      patch.name = name;
    }
    if (hasDescription) {
      patch.description = normalizeDescription(input.description);
    }
    if (hasSettings) {
      patch.settingsOverrideJson = serializeSettings(input.settings) ?? "{}";
    }
    patch.updatedAt = now;

    const updated = this.db
      .update(projects)
      .set(patch)
      .where(eq(projects.id, existing.id))
      .returning()
      .all()[0];

    if (!updated) {
      throw new Error("Failed to update project");
    }

    const record = toProjectLifecycleRecord(updated);
    const changedFields = [
      hasName ? "name" : null,
      hasDescription ? "description" : null,
      hasSettings ? "settings" : null,
    ].filter(Boolean);
    const logId = this.appendAudit(input.actor, {
      accountId: record.accountId,
      workspaceId: record.workspaceId,
      projectId: record.id,
      action: GOVERNANCE_OPERATION_ACTIONS.project.update,
      beforeRef: { name: existing.name, description: existing.description },
      afterRef: { name: record.name, description: record.description },
      metadata: {
        changed_fields: changedFields,
        ...(hasSettings ? { settings_summary: summarizePayloadForOperationLog(input.settings) } : {}),
      },
      now,
    });
    this.emitEvent(input.actor, record, PROJECT_LIFECYCLE_EVENT.updated, logId, {
      changed_fields: changedFields,
    }, now);

    return record;
  }

  archive(input: ArchiveProjectInput): ProjectLifecycleRecord {
    const now = input.now ?? Date.now();
    const access = this.access.requireProjectActionForActor(input.actor, input.id, "project.write");
    const existing = this.requireProjectRow(access.project.id);

    if (existing.kind === "session_default") {
      throw new ProjectLifecycleServiceError(
        409,
        "project_session_default_immutable",
        `Session default project cannot be archived: ${existing.id}`,
      );
    }

    // The project event must be appended while the project is still active,
    // because ProjectEventService rejects archived projects.
    const logId = this.appendAudit(input.actor, {
      accountId: existing.accountId,
      workspaceId: existing.workspaceId,
      projectId: existing.id,
      action: GOVERNANCE_OPERATION_ACTIONS.project.archive,
      beforeRef: { status: existing.status },
      afterRef: { status: "archived", archived_at: now },
      now,
    });
    this.emitEvent(
      input.actor,
      toProjectLifecycleRecord(existing),
      PROJECT_LIFECYCLE_EVENT.archived,
      logId,
      { archived_at: now },
      now,
    );

    const updated = this.db
      .update(projects)
      .set({ status: "archived", archivedAt: now, updatedAt: now })
      .where(eq(projects.id, existing.id))
      .returning()
      .all()[0];

    if (!updated) {
      throw new Error("Failed to archive project");
    }

    return toProjectLifecycleRecord(updated);
  }

  restore(input: RestoreProjectInput): ProjectLifecycleRecord {
    const now = input.now ?? Date.now();
    const access = this.access.requireProjectActionForActor(input.actor, input.id, "project.write", {
      allowArchived: true,
    });
    const existing = this.requireProjectRow(access.project.id);

    if (existing.status !== "archived") {
      throw new ProjectLifecycleServiceError(
        409,
        "project_not_archived",
        `Project is not archived: ${existing.id}`,
      );
    }

    const updated = this.db
      .update(projects)
      .set({ status: "active", archivedAt: null, updatedAt: now })
      .where(eq(projects.id, existing.id))
      .returning()
      .all()[0];

    if (!updated) {
      throw new Error("Failed to restore project");
    }

    const record = toProjectLifecycleRecord(updated);
    const logId = this.appendAudit(input.actor, {
      accountId: record.accountId,
      workspaceId: record.workspaceId,
      projectId: record.id,
      action: GOVERNANCE_OPERATION_ACTIONS.project.restore,
      beforeRef: { status: existing.status },
      afterRef: { status: record.status },
      now,
    });
    this.emitEvent(input.actor, record, PROJECT_LIFECYCLE_EVENT.restored, logId, {}, now);

    return record;
  }

  duplicate(input: DuplicateProjectInput): ProjectLifecycleRecord {
    const now = input.now ?? Date.now();
    const access = this.access.requireProjectActionForActor(input.actor, input.id, "project.manage_settings", {
      allowArchived: true,
    });
    const source = this.requireProjectRow(access.project.id);

    // Duplicate only copies metadata into the same (active) workspace.
    const workspace = this.resolveWorkspaceForCreate(source.accountId, source.workspaceId, now);
    const name = normalizeName(input.name) ?? `${source.name} (副本)`;
    const projectId = `proj_${nanoid()}`;

    const inserted = this.db
      .insert(projects)
      .values({
        id: projectId,
        accountId: source.accountId,
        workspaceId: workspace.id,
        name,
        description: source.description ?? null,
        kind: "manual",
        status: "active",
        settingsOverrideJson: source.settingsOverrideJson,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .all()[0];

    if (!inserted) {
      throw new Error("Failed to duplicate project");
    }

    ensureOwnerProjectMembership(this.db, {
      accountId: source.accountId,
      workspaceId: workspace.id,
      projectId,
      createdByAccountId: input.actor.actorAccountId,
      now,
    });

    const record = toProjectLifecycleRecord(inserted);
    const logId = this.appendAudit(input.actor, {
      accountId: record.accountId,
      workspaceId: record.workspaceId,
      projectId: record.id,
      action: GOVERNANCE_OPERATION_ACTIONS.project.duplicate,
      afterRef: { id: record.id, name: record.name },
      metadata: { duplicated_from: source.id },
      now,
    });
    this.emitEvent(input.actor, record, PROJECT_LIFECYCLE_EVENT.created, logId, {
      duplicated_from: source.id,
    }, now);

    return record;
  }

  private resolveWorkspaceForCreate(
    accountId: string,
    workspaceId: string | null | undefined,
    now: number,
  ) {
    try {
      const normalizedWorkspaceId = typeof workspaceId === "string" ? workspaceId.trim() : "";
      if (normalizedWorkspaceId.length > 0) {
        return this.workspaceScope.requireWorkspaceForAccount(accountId, normalizedWorkspaceId);
      }
      return this.workspaceScope.ensureDefaultWorkspace(accountId, now);
    } catch (error) {
      if (error instanceof WorkspaceScopeServiceError) {
        if (error.code === "workspace_archived") {
          throw new ProjectLifecycleServiceError(409, "workspace_archived", error.message);
        }
        // account_not_found / workspace_not_found → treat as not-found scope.
        throw new ProjectLifecycleServiceError(404, "workspace_not_found", error.message);
      }
      throw error;
    }
  }

  private requireProjectRow(projectId: string): typeof projects.$inferSelect {
    const row = this.db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)
      .all()[0];

    if (!row) {
      throw new ProjectLifecycleServiceError(
        404,
        "project_not_found",
        `Project not found: ${projectId}`,
      );
    }

    return row;
  }

  private appendAudit(
    actor: ProjectLifecycleActor,
    input: {
      accountId: string;
      workspaceId: string;
      projectId: string;
      action: string;
      beforeRef?: unknown;
      afterRef?: unknown;
      metadata?: Record<string, unknown>;
      now: number;
    },
  ): string {
    const log = this.operationLog.append({
      accountId: input.accountId,
      actorType: actor.actorType,
      actorId: actor.actorClientId ?? actor.actorAccountId,
      actorAccountId: actor.actorAccountId,
      actorClientId: actor.actorClientId ?? null,
      sourceType: actor.source ?? "api",
      requestId: actor.requestId ?? null,
      action: input.action,
      status: "succeeded",
      result: "allowed",
      permissionAction: input.action,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      targetType: "project",
      targetId: input.projectId,
      beforeRef: input.beforeRef,
      afterRef: input.afterRef,
      metadata: input.metadata,
      createdAt: input.now,
    });
    return log.id;
  }

  private emitEvent(
    actor: ProjectLifecycleActor,
    record: ProjectLifecycleRecord,
    type: string,
    operationLogId: string | null,
    payload: Record<string, unknown>,
    now: number,
  ): void {
    this.projectEvents.append({
      workspaceId: record.workspaceId,
      projectId: record.id,
      type,
      visibility: "project",
      source: actor.source === "runtime_job" ? "runtime_job" : "api",
      actorAccountId: actor.actorAccountId,
      actorClientId: actor.actorClientId ?? null,
      operationLogId,
      payload,
      createdAt: now,
    });
  }
}

export function toProjectLifecycleRecord(row: typeof projects.$inferSelect): ProjectLifecycleRecord {
  return {
    id: row.id,
    accountId: row.accountId,
    workspaceId: row.workspaceId,
    name: row.name,
    description: row.description,
    kind: row.kind,
    status: row.status,
    settingsOverrideJson: row.settingsOverrideJson,
    archivedAt: row.archivedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function serializeSettings(settings: Record<string, unknown> | null | undefined): string | null {
  if (settings === undefined || settings === null) {
    return null;
  }
  return JSON.stringify(settings);
}

function normalizeName(name: string | undefined): string | null {
  if (typeof name !== "string") {
    return null;
  }
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeDescription(description: string | null | undefined): string | null {
  if (description === undefined || description === null) {
    return null;
  }
  const trimmed = description.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function requireNonEmpty(value: string, fieldName: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed.length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  return trimmed;
}
