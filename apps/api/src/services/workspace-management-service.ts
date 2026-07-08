import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { AppDb, DbExecutor } from "../db/client.js";
import { accounts, workspaces } from "../db/schema.js";
import { GOVERNANCE_OPERATION_ACTIONS } from "./governance/operation-log-names.js";
import { summarizePayloadForOperationLog } from "./governance/trace-summary.js";
import {
  OperationLogService,
  type OperationLogActor,
} from "./operation-log-service.js";
import type { WorkspaceKind, WorkspaceScopeStatus } from "./workspace-scope-service.js";

export type WorkspaceManagementRecord = {
  id: string;
  accountId: string;
  name: string;
  kind: WorkspaceKind;
  isDefault: boolean;
  status: WorkspaceScopeStatus;
  settingsJson: string;
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type WorkspaceManagementActor = OperationLogActor & {
  actorAccountId?: string | null;
  actorClientId?: string | null;
  source?: string;
  requestId?: string | null;
};

export type WorkspaceManagementServiceErrorCode =
  | "account_not_found"
  | "workspace_not_found"
  | "workspace_name_required"
  | "workspace_update_empty"
  | "workspace_default_immutable"
  | "workspace_already_archived"
  | "workspace_not_archived";

export class WorkspaceManagementServiceError extends Error {
  constructor(
    public readonly statusCode: 400 | 404 | 409,
    public readonly code: WorkspaceManagementServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WorkspaceManagementServiceError";
  }
}

export type ListWorkspacesInput = {
  accountId: string;
  status?: WorkspaceScopeStatus;
  includeArchived?: boolean;
};

export type GetWorkspaceInput = {
  accountId: string;
  id: string;
};

export type CreateWorkspaceInput = {
  accountId: string;
  name: string;
  settings?: Record<string, unknown> | null;
  actor?: WorkspaceManagementActor;
  now?: number;
};

export type UpdateWorkspaceInput = {
  accountId: string;
  id: string;
  name?: string;
  settings?: Record<string, unknown> | null;
  actor?: WorkspaceManagementActor;
  now?: number;
};

export type ArchiveWorkspaceInput = {
  accountId: string;
  id: string;
  actor?: WorkspaceManagementActor;
  now?: number;
};

export type RestoreWorkspaceInput = ArchiveWorkspaceInput;

type WorkspaceManagementServiceOptions = {
  operationLog?: OperationLogService;
};

/**
 * WP-A1: Workspace lifecycle management.
 *
 * This service owns the manageable surface of Workspaces (list / get / create /
 * update / archive / restore). It intentionally does not take over the default
 * Workspace resolution owned by {@link WorkspaceScopeService}; instead it
 * refuses to archive the default Workspace and only ever creates `manual`
 * Workspaces.
 */
export class WorkspaceManagementService {
  private readonly operationLog: OperationLogService;

  constructor(
    private readonly db: AppDb | DbExecutor,
    options: WorkspaceManagementServiceOptions = {},
  ) {
    this.operationLog = options.operationLog ?? new OperationLogService(db);
  }

  list(input: ListWorkspacesInput): WorkspaceManagementRecord[] {
    const accountId = requireNonEmpty(input.accountId, "accountId");
    const rows = this.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.accountId, accountId))
      .orderBy(desc(workspaces.updatedAt), desc(workspaces.id))
      .all();

    const includeArchived = input.includeArchived === true || input.status === "archived";
    return rows
      .map(toWorkspaceManagementRecord)
      .filter((record) => {
        if (input.status) {
          return record.status === input.status;
        }
        return includeArchived || record.status === "active";
      });
  }

  getById(input: GetWorkspaceInput): WorkspaceManagementRecord {
    return this.requireWorkspace(input.accountId, input.id);
  }

  create(input: CreateWorkspaceInput): WorkspaceManagementRecord {
    const accountId = requireNonEmpty(input.accountId, "accountId");
    const name = normalizeName(input.name);
    if (!name) {
      throw new WorkspaceManagementServiceError(
        400,
        "workspace_name_required",
        "Workspace name must be a non-empty string",
      );
    }

    this.requireAccount(accountId);

    const now = input.now ?? Date.now();
    const settingsJson = serializeSettings(input.settings) ?? "{}";
    const id = `ws_${nanoid()}`;

    const inserted = this.db
      .insert(workspaces)
      .values({
        id,
        accountId,
        name,
        kind: "manual",
        isDefault: false,
        status: "active",
        settingsJson,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .all()[0];

    if (!inserted) {
      throw new Error("Failed to create workspace");
    }

    const record = toWorkspaceManagementRecord(inserted);
    this.appendAudit(input.actor, {
      accountId,
      workspaceId: record.id,
      action: GOVERNANCE_OPERATION_ACTIONS.workspace.create,
      afterRef: {
        id: record.id,
        name: record.name,
        kind: record.kind,
        status: record.status,
      },
      metadata: {
        workspace_kind: record.kind,
        ...(input.settings ? { settings_summary: summarizePayloadForOperationLog(input.settings) } : {}),
      },
      now,
    });

    return record;
  }

  update(input: UpdateWorkspaceInput): WorkspaceManagementRecord {
    const accountId = requireNonEmpty(input.accountId, "accountId");
    const existing = this.requireWorkspace(accountId, input.id);

    const hasName = input.name !== undefined;
    const hasSettings = input.settings !== undefined;
    if (!hasName && !hasSettings) {
      throw new WorkspaceManagementServiceError(
        400,
        "workspace_update_empty",
        "At least one workspace field must be provided",
      );
    }

    const patch: Partial<typeof workspaces.$inferInsert> = {};
    if (hasName) {
      const name = normalizeName(input.name);
      if (!name) {
        throw new WorkspaceManagementServiceError(
          400,
          "workspace_name_required",
          "Workspace name must be a non-empty string",
        );
      }
      patch.name = name;
    }
    if (hasSettings) {
      patch.settingsJson = serializeSettings(input.settings) ?? "{}";
    }

    const now = input.now ?? Date.now();
    patch.updatedAt = now;

    const updated = this.db
      .update(workspaces)
      .set(patch)
      .where(and(eq(workspaces.accountId, accountId), eq(workspaces.id, existing.id)))
      .returning()
      .all()[0];

    if (!updated) {
      throw new Error("Failed to update workspace");
    }

    const record = toWorkspaceManagementRecord(updated);
    this.appendAudit(input.actor, {
      accountId,
      workspaceId: record.id,
      action: GOVERNANCE_OPERATION_ACTIONS.workspace.update,
      beforeRef: { name: existing.name },
      afterRef: { name: record.name },
      metadata: {
        changed_fields: [hasName ? "name" : null, hasSettings ? "settings" : null].filter(Boolean),
        ...(hasSettings ? { settings_summary: summarizePayloadForOperationLog(input.settings) } : {}),
      },
      now,
    });

    return record;
  }

  archive(input: ArchiveWorkspaceInput): WorkspaceManagementRecord {
    const accountId = requireNonEmpty(input.accountId, "accountId");
    const existing = this.requireWorkspace(accountId, input.id);

    if (existing.isDefault || existing.kind === "default") {
      throw new WorkspaceManagementServiceError(
        409,
        "workspace_default_immutable",
        `Default workspace cannot be archived: ${existing.id}`,
      );
    }

    if (existing.status === "archived") {
      throw new WorkspaceManagementServiceError(
        409,
        "workspace_already_archived",
        `Workspace is already archived: ${existing.id}`,
      );
    }

    const now = input.now ?? Date.now();
    const updated = this.db
      .update(workspaces)
      .set({ status: "archived", archivedAt: now, updatedAt: now })
      .where(and(eq(workspaces.accountId, accountId), eq(workspaces.id, existing.id)))
      .returning()
      .all()[0];

    if (!updated) {
      throw new Error("Failed to archive workspace");
    }

    const record = toWorkspaceManagementRecord(updated);
    this.appendAudit(input.actor, {
      accountId,
      workspaceId: record.id,
      action: GOVERNANCE_OPERATION_ACTIONS.workspace.archive,
      beforeRef: { status: existing.status },
      afterRef: { status: record.status, archived_at: record.archivedAt },
      now,
    });

    return record;
  }

  restore(input: RestoreWorkspaceInput): WorkspaceManagementRecord {
    const accountId = requireNonEmpty(input.accountId, "accountId");
    const existing = this.requireWorkspace(accountId, input.id);

    if (existing.status !== "archived") {
      throw new WorkspaceManagementServiceError(
        409,
        "workspace_not_archived",
        `Workspace is not archived: ${existing.id}`,
      );
    }

    const now = input.now ?? Date.now();
    const updated = this.db
      .update(workspaces)
      .set({ status: "active", archivedAt: null, updatedAt: now })
      .where(and(eq(workspaces.accountId, accountId), eq(workspaces.id, existing.id)))
      .returning()
      .all()[0];

    if (!updated) {
      throw new Error("Failed to restore workspace");
    }

    const record = toWorkspaceManagementRecord(updated);
    this.appendAudit(input.actor, {
      accountId,
      workspaceId: record.id,
      action: GOVERNANCE_OPERATION_ACTIONS.workspace.restore,
      beforeRef: { status: existing.status },
      afterRef: { status: record.status },
      now,
    });

    return record;
  }

  private requireWorkspace(accountId: string, id: string): WorkspaceManagementRecord {
    const normalizedAccountId = requireNonEmpty(accountId, "accountId");
    const normalizedId = requireNonEmpty(id, "id");
    const row = this.db
      .select()
      .from(workspaces)
      .where(and(eq(workspaces.accountId, normalizedAccountId), eq(workspaces.id, normalizedId)))
      .limit(1)
      .all()[0];

    if (!row) {
      throw new WorkspaceManagementServiceError(
        404,
        "workspace_not_found",
        `Workspace not found: ${normalizedId}`,
      );
    }

    return toWorkspaceManagementRecord(row);
  }

  private requireAccount(accountId: string): void {
    const row = this.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .limit(1)
      .all()[0];

    if (!row) {
      throw new WorkspaceManagementServiceError(
        404,
        "account_not_found",
        `Account not found: ${accountId}`,
      );
    }
  }

  private appendAudit(
    actor: WorkspaceManagementActor | undefined,
    input: {
      accountId: string;
      workspaceId: string;
      action: string;
      beforeRef?: unknown;
      afterRef?: unknown;
      metadata?: Record<string, unknown>;
      now: number;
    },
  ): void {
    if (!actor) {
      return;
    }

    this.operationLog.append({
      accountId: input.accountId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      actorAccountId: actor.actorAccountId,
      actorClientId: actor.actorClientId,
      sourceType: actor.source ?? "api",
      requestId: actor.requestId ?? null,
      action: input.action,
      status: "succeeded",
      result: "allowed",
      permissionAction: input.action,
      workspaceId: input.workspaceId,
      targetType: "workspace",
      targetId: input.workspaceId,
      beforeRef: input.beforeRef,
      afterRef: input.afterRef,
      metadata: input.metadata,
      createdAt: input.now,
    });
  }
}

function toWorkspaceManagementRecord(row: typeof workspaces.$inferSelect): WorkspaceManagementRecord {
  return {
    id: row.id,
    accountId: row.accountId,
    name: row.name,
    kind: row.kind,
    isDefault: row.isDefault,
    status: row.status,
    settingsJson: row.settingsJson,
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

function requireNonEmpty(value: string, fieldName: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed.length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  return trimmed;
}
