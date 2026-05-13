import { and, eq } from "drizzle-orm";

import type { AppDb, DbExecutor } from "../db/client.js";
import { accounts, workspaces } from "../db/schema.js";

export const DEFAULT_WORKSPACE_NAME = "默认 Workspace";

export type WorkspaceScopeStatus = "active" | "archived";

export type WorkspaceRecord = {
  id: string;
  accountId: string;
  name: string;
  kind: "default";
  isDefault: boolean;
  status: WorkspaceScopeStatus;
  settingsJson: string;
  createdAt: number;
  updatedAt: number;
};

export type WorkspaceScopeServiceErrorCode =
  | "account_not_found"
  | "workspace_not_found"
  | "workspace_archived";

export class WorkspaceScopeServiceError extends Error {
  constructor(
    public readonly statusCode: 404 | 409,
    public readonly code: WorkspaceScopeServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WorkspaceScopeServiceError";
  }
}

export class WorkspaceScopeService {
  constructor(private readonly db: AppDb | DbExecutor) {}

  ensureDefaultWorkspace(accountId: string, now = Date.now()): WorkspaceRecord {
    const existing = this.findDefaultWorkspace(accountId);
    if (existing) {
      return this.requireActiveWorkspace(existing);
    }

    const account = this.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .limit(1)
      .all()[0];

    if (!account) {
      throw new WorkspaceScopeServiceError(
        404,
        "account_not_found",
        `Account not found: ${accountId}`,
      );
    }

    const workspaceId = buildDefaultWorkspaceId(accountId);
    const inserted = this.db
      .insert(workspaces)
      .values({
        id: workspaceId,
        accountId,
        name: DEFAULT_WORKSPACE_NAME,
        kind: "default",
        isDefault: true,
        status: "active",
        settingsJson: "{}",
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .all()[0];

    if (!inserted) {
      throw new Error("Failed to create default workspace");
    }

    return toWorkspaceRecord(inserted);
  }

  getDefaultWorkspace(accountId: string): WorkspaceRecord {
    return this.ensureDefaultWorkspace(accountId);
  }

  requireWorkspaceForAccount(accountId: string, workspaceId: string): WorkspaceRecord {
    const row = this.db
      .select()
      .from(workspaces)
      .where(and(eq(workspaces.accountId, accountId), eq(workspaces.id, workspaceId)))
      .limit(1)
      .all()[0];

    if (!row) {
      throw new WorkspaceScopeServiceError(
        404,
        "workspace_not_found",
        `Workspace not found: ${workspaceId}`,
      );
    }

    return this.requireActiveWorkspace(toWorkspaceRecord(row));
  }

  private findDefaultWorkspace(accountId: string): WorkspaceRecord | null {
    const row = this.db
      .select()
      .from(workspaces)
      .where(and(eq(workspaces.accountId, accountId), eq(workspaces.isDefault, true)))
      .limit(1)
      .all()[0];

    return row ? toWorkspaceRecord(row) : null;
  }

  private requireActiveWorkspace(workspace: WorkspaceRecord): WorkspaceRecord {
    if (workspace.status === "archived") {
      throw new WorkspaceScopeServiceError(
        409,
        "workspace_archived",
        `Workspace is archived: ${workspace.id}`,
      );
    }

    return workspace;
  }
}

export function buildDefaultWorkspaceId(accountId: string): string {
  return `ws_default_${accountId}`;
}

function toWorkspaceRecord(row: typeof workspaces.$inferSelect): WorkspaceRecord {
  return {
    id: row.id,
    accountId: row.accountId,
    name: row.name,
    kind: row.kind,
    isDefault: row.isDefault,
    status: row.status,
    settingsJson: row.settingsJson,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
