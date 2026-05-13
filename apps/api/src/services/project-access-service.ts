import { and, eq } from "drizzle-orm";

import type { AppDb, DbExecutor } from "../db/client.js";
import {
  floors,
  messagePages,
  messages,
  projectMemberships,
  projects,
  sessions,
} from "../db/schema.js";

export type ProjectRole = "owner" | "observer";

export type ProjectAction =
  | "project.read"
  | "project.observe"
  | "project.write"
  | "project.manage_members"
  | "project.manage_settings";

export type ProjectAccessProject = {
  id: string;
  accountId: string;
  workspaceId: string;
  status: "active" | "archived";
};

export type ProjectAccess = {
  project: ProjectAccessProject;
  role: ProjectRole;
};

export type ProjectAccessServiceErrorCode =
  | "session_not_found"
  | "floor_not_found"
  | "page_not_found"
  | "message_not_found"
  | "session_project_scope_missing"
  | "project_not_found"
  | "project_archived"
  | "project_access_denied";

export type ProjectAccessDenyReason =
  | "not_a_member"
  | "role_forbidden";


export class ProjectAccessServiceError extends Error {
  constructor(
    public readonly statusCode: 403 | 404 | 409,
    public readonly code: ProjectAccessServiceErrorCode,
    message: string,
    public readonly denyReason?: ProjectAccessDenyReason,
  ) {
    super(message);
    this.name = "ProjectAccessServiceError";
  }
}

/**
 * Resolves Project membership and checks Project-level permissions.
 */
export class ProjectAccessService {
  constructor(private readonly db: AppDb | DbExecutor) {}

  resolveProjectAccess(actorAccountId: string, projectId: string): ProjectAccess {
    const normalizedActorAccountId = requireNonEmpty(actorAccountId, "actorAccountId");
    const normalizedProjectId = requireNonEmpty(projectId, "projectId");
    const project = this.loadActiveProject(normalizedProjectId);

    if (project.accountId === normalizedActorAccountId) {
      return { project, role: "owner" };
    }

    const membership = this.db
      .select({ role: projectMemberships.role })
      .from(projectMemberships)
      .where(and(
        eq(projectMemberships.projectId, normalizedProjectId),
        eq(projectMemberships.accountId, normalizedActorAccountId),
        eq(projectMemberships.status, "active"),
      ))
      .limit(1)
      .get();

    if (membership?.role === "owner" || membership?.role === "observer") {
      return { project, role: membership.role };
    }

    throw new ProjectAccessServiceError(
      403,
      "project_access_denied",
      `Project access denied: ${normalizedProjectId}`,
      "not_a_member",
    );
  }

  requireProjectAction(
    actorAccountId: string,
    projectId: string,
    action: ProjectAction,
  ): ProjectAccess {
    const access = this.resolveProjectAccess(actorAccountId, projectId);
    if (!canPerformProjectAction(access.role, action)) {
      throw new ProjectAccessServiceError(
        403,
        "project_access_denied",
        `Project action denied: ${action}`,
        "role_forbidden",
      );
    }

    return access;
  }

  requireProjectActionBySessionId(
    actorAccountId: string,
    sessionId: string,
    action: ProjectAction,
  ): ProjectAccess {
    const normalizedSessionId = requireNonEmpty(sessionId, "sessionId");
    const session = this.db
      .select({ projectId: sessions.projectId })
      .from(sessions)
      .where(eq(sessions.id, normalizedSessionId))
      .limit(1)
      .get();

    if (!session) {
      throw new ProjectAccessServiceError(
        404,
        "session_not_found",
        `Session not found: ${normalizedSessionId}`,
      );
    }

    if (!session.projectId) {
      throw new ProjectAccessServiceError(
        409,
        "session_project_scope_missing",
        `Session has no Project scope: ${normalizedSessionId}`,
      );
    }

    return this.requireProjectAction(actorAccountId, session.projectId, action);
  }

  requireProjectActionByFloorId(
    actorAccountId: string,
    floorId: string,
    action: ProjectAction,
  ): ProjectAccess & { sessionId: string } {
    const normalizedFloorId = requireNonEmpty(floorId, "floorId");
    const floorRow = this.db
      .select({ sessionId: floors.sessionId })
      .from(floors)
      .where(eq(floors.id, normalizedFloorId))
      .limit(1)
      .get();

    if (!floorRow) {
      throw new ProjectAccessServiceError(
        404,
        "floor_not_found",
        `Floor not found: ${normalizedFloorId}`,
      );
    }

    const access = this.requireProjectActionBySessionId(actorAccountId, floorRow.sessionId, action);
    return { ...access, sessionId: floorRow.sessionId };
  }

  requireProjectActionByPageId(
    actorAccountId: string,
    pageId: string,
    action: ProjectAction,
  ): ProjectAccess & { sessionId: string; floorId: string } {
    const normalizedPageId = requireNonEmpty(pageId, "pageId");
    const row = this.db
      .select({
        floorId: messagePages.floorId,
        sessionId: floors.sessionId,
      })
      .from(messagePages)
      .innerJoin(floors, eq(messagePages.floorId, floors.id))
      .where(eq(messagePages.id, normalizedPageId))
      .limit(1)
      .get();

    if (!row) {
      throw new ProjectAccessServiceError(
        404,
        "page_not_found",
        `Page not found: ${normalizedPageId}`,
      );
    }

    const access = this.requireProjectActionBySessionId(actorAccountId, row.sessionId, action);
    return { ...access, sessionId: row.sessionId, floorId: row.floorId };
  }

  requireProjectActionByMessageId(
    actorAccountId: string,
    messageId: string,
    action: ProjectAction,
  ): ProjectAccess & { sessionId: string; floorId: string; pageId: string } {
    const normalizedMessageId = requireNonEmpty(messageId, "messageId");
    const row = this.db
      .select({
        pageId: messages.pageId,
        floorId: messagePages.floorId,
        sessionId: floors.sessionId,
      })
      .from(messages)
      .innerJoin(messagePages, eq(messages.pageId, messagePages.id))
      .innerJoin(floors, eq(messagePages.floorId, floors.id))
      .where(eq(messages.id, normalizedMessageId))
      .limit(1)
      .get();

    if (!row) {
      throw new ProjectAccessServiceError(
        404,
        "message_not_found",
        `Message not found: ${normalizedMessageId}`,
      );
    }

    const access = this.requireProjectActionBySessionId(actorAccountId, row.sessionId, action);
    return {
      ...access,
      sessionId: row.sessionId,
      floorId: row.floorId,
      pageId: row.pageId,
    };
  }

  private loadActiveProject(projectId: string): ProjectAccessProject {
    const row = this.db
      .select({
        id: projects.id,
        accountId: projects.accountId,
        workspaceId: projects.workspaceId,
        status: projects.status,
      })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)
      .get();

    if (!row) {
      throw new ProjectAccessServiceError(
        404,
        "project_not_found",
        `Project not found: ${projectId}`,
      );
    }

    if (row.status === "archived") {
      throw new ProjectAccessServiceError(
        409,
        "project_archived",
        `Project is archived: ${projectId}`,
      );
    }

    return row;
  }
}

export function canPerformProjectAction(role: ProjectRole, action: ProjectAction): boolean {
  if (role === "owner") {
    return true;
  }

  return action === "project.read" || action === "project.observe";
}

function requireNonEmpty(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  return trimmed;
}
