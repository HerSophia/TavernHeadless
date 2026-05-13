import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { AppDb, DbExecutor } from "../db/client.js";
import { projects } from "../db/schema.js";
import {
  WorkspaceScopeService,
  WorkspaceScopeServiceError,
  type WorkspaceRecord,
} from "./workspace-scope-service.js";
import { ensureOwnerProjectMembership } from "./project-membership-service.js";

export type ProjectScopeStatus = "active" | "archived";
export type ProjectScopeKind = "session_default" | "manual";

export type ProjectRecord = {
  id: string;
  accountId: string;
  workspaceId: string;
  name: string;
  description: string | null;
  kind: ProjectScopeKind;
  status: ProjectScopeStatus;
  settingsOverrideJson: string;
  createdAt: number;
  updatedAt: number;
};

export type ProjectScopeServiceErrorCode =
  | "account_not_found"
  | "workspace_not_found"
  | "workspace_archived"
  | "project_not_found"
  | "project_archived"
  | "project_workspace_mismatch";

export class ProjectScopeServiceError extends Error {
  constructor(
    public readonly statusCode: 404 | 409,
    public readonly code: ProjectScopeServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProjectScopeServiceError";
  }
}

type ProjectScopeServiceOptions = {
  workspaceScope?: WorkspaceScopeService;
};

export class ProjectScopeService {
  private readonly workspaceScope: WorkspaceScopeService;

  constructor(
    private readonly db: AppDb | DbExecutor,
    options: ProjectScopeServiceOptions = {},
  ) {
    this.workspaceScope = options.workspaceScope ?? new WorkspaceScopeService(db);
  }

  createSessionDefaultProject(input: {
    accountId: string;
    workspaceId: string;
    sessionId: string;
    sessionTitle?: string | null;
    now: number;
  }): ProjectRecord {
    this.requireWorkspaceForNewProject(input.accountId, input.workspaceId);

    const inserted = this.db
      .insert(projects)
      .values({
        id: nanoid(),
        accountId: input.accountId,
        workspaceId: input.workspaceId,
        name: buildSessionDefaultProjectName(input.sessionTitle, input.sessionId),
        description: null,
        kind: "session_default",
        status: "active",
        settingsOverrideJson: "{}",
        createdAt: input.now,
        updatedAt: input.now,
      })
      .returning()
      .all()[0];

    if (!inserted) {
      throw new Error("Failed to create session default project");
    }

    ensureOwnerProjectMembership(this.db, {
      accountId: inserted.accountId,
      workspaceId: inserted.workspaceId,
      projectId: inserted.id,
      now: input.now,
    });

    return toProjectRecord(inserted);
  }

  requireProjectForAccount(accountId: string, projectId: string): ProjectRecord {
    const row = this.db
      .select()
      .from(projects)
      .where(and(eq(projects.accountId, accountId), eq(projects.id, projectId)))
      .limit(1)
      .all()[0];

    if (!row) {
      throw new ProjectScopeServiceError(
        404,
        "project_not_found",
        `Project not found: ${projectId}`,
      );
    }

    const project = toProjectRecord(row);

    if (project.status === "archived") {
      throw new ProjectScopeServiceError(
        409,
        "project_archived",
        `Project is archived: ${project.id}`,
      );
    }

    this.requireWorkspaceForExistingProject(project);
    return project;
  }

  private requireWorkspaceForNewProject(accountId: string, workspaceId: string): WorkspaceRecord {
    try {
      return this.workspaceScope.requireWorkspaceForAccount(accountId, workspaceId);
    } catch (error) {
      if (error instanceof WorkspaceScopeServiceError) {
        throw new ProjectScopeServiceError(error.statusCode, error.code, error.message);
      }

      throw error;
    }
  }

  private requireWorkspaceForExistingProject(project: ProjectRecord): WorkspaceRecord {
    try {
      return this.workspaceScope.requireWorkspaceForAccount(project.accountId, project.workspaceId);
    } catch (error) {
      if (error instanceof WorkspaceScopeServiceError) {
        if (error.code === "workspace_archived") {
          throw new ProjectScopeServiceError(409, "workspace_archived", error.message);
        }

        throw new ProjectScopeServiceError(
          409,
          "project_workspace_mismatch",
          `Project workspace is unavailable or belongs to another account: ${project.workspaceId}`,
        );
      }

      throw error;
    }
  }
}

export function buildSessionDefaultProjectName(
  sessionTitle: string | null | undefined,
  sessionId: string,
): string {
  const title = sessionTitle?.trim();
  return title ? title : `默认项目 - ${sessionId}`;
}

function toProjectRecord(row: typeof projects.$inferSelect): ProjectRecord {
  return {
    id: row.id,
    accountId: row.accountId,
    workspaceId: row.workspaceId,
    name: row.name,
    description: row.description,
    kind: row.kind,
    status: row.status,
    settingsOverrideJson: row.settingsOverrideJson,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
