import type { AppDb, DbExecutor } from "../db/client.js";
import {
  ProjectScopeService,
  type ProjectRecord,
} from "./project-scope-service.js";
import {
  WorkspaceScopeService,
  type WorkspaceRecord,
} from "./workspace-scope-service.js";

export type ResolvedSessionScope = {
  accountId: string;
  workspaceId: string;
  projectId: string;
  projectWasCreated: boolean;
};

type SessionScopeResolverOptions = {
  workspaceScope?: WorkspaceScopeService;
  projectScope?: ProjectScopeService;
};

export class SessionScopeResolver {
  private readonly workspaceScope: WorkspaceScopeService;
  private readonly projectScope: ProjectScopeService;

  constructor(
    db: AppDb | DbExecutor,
    options: SessionScopeResolverOptions = {},
  ) {
    this.workspaceScope = options.workspaceScope ?? new WorkspaceScopeService(db);
    this.projectScope = options.projectScope ?? new ProjectScopeService(db, {
      workspaceScope: this.workspaceScope,
    });
  }

  resolveForCreate(input: {
    accountId: string;
    projectId?: string | null;
    title?: string | null;
    sessionId: string;
    now: number;
  }): ResolvedSessionScope {
    const projectId = input.projectId?.trim() || null;

    if (projectId) {
      const project = this.projectScope.requireProjectForAccount(input.accountId, projectId);
      const workspace = this.workspaceScope.requireWorkspaceForAccount(
        input.accountId,
        project.workspaceId,
      );

      return toResolvedSessionScope(input.accountId, workspace, project, false);
    }

    const workspace = this.workspaceScope.ensureDefaultWorkspace(input.accountId, input.now);
    const project = this.projectScope.createSessionDefaultProject({
      accountId: input.accountId,
      workspaceId: workspace.id,
      sessionId: input.sessionId,
      sessionTitle: input.title,
      now: input.now,
    });

    return toResolvedSessionScope(input.accountId, workspace, project, true);
  }
}

function toResolvedSessionScope(
  accountId: string,
  workspace: WorkspaceRecord,
  project: ProjectRecord,
  projectWasCreated: boolean,
): ResolvedSessionScope {
  return {
    accountId,
    workspaceId: workspace.id,
    projectId: project.id,
    projectWasCreated,
  };
}
