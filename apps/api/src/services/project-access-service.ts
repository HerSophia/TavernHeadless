import { and, eq } from "drizzle-orm";

import type { AppDb, DbExecutor } from "../db/client.js";
import {
  clients,
  floors,
  messagePages,
  messages,
  projectMemberships,
  projects,
  sessions,
} from "../db/schema.js";

export type ProjectRole = "owner" | "observer" | "deriver";

export type ProjectAction =
  | "project.read"
  | "project.observe"
  | "project.write"
  | "project.manage_members"
  | "project.manage_settings"
  | "project.derived_output.read"
  | "project.derived_output.write"
  | "project.inbox.read"
  | "project.inbox.write"
  | "project.inbox.decide"
  | "session.read_metadata"
  | "session.read_committed_messages"
  | "session.respond"
  | "session.regenerate"
  | "floor.retry"
  | "message.edit_and_regenerate"
  | "page.activate"
  | "variable.write"
  | "memory.write"
  | "session_state.write"
  | "prompt_runtime.modify"
  | "tool_policy.modify"
  | "mcp.modify"
  | "project.agent.read"
  | "project.agent.manage"
  | "project.agent.run"
  | "project.config.read"
  | "project.config.write";

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
  | "project_access_denied"
  | "client_disabled"
  | "client_not_found";

export type ProjectAccessDenyReason =
  | "not_a_member"
  | "role_forbidden";

export type ProjectActorType = "account" | "client" | "system";

export type ProjectActorInput = {
  actorType: ProjectActorType;
  actorAccountId: string;
  actorClientId?: string | null;
};

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
 *
 * In phase 4 the service understands both account actors and client actors.
 * Account actors keep their phase 3 behaviour (owner if `project.account_id`
 * matches, otherwise resolved by active account membership).
 * Client actors resolve through active client membership; default Clients of the
 * owning account are also recognised as owners. Non-default Clients never
 * inherit owner rights from their owning account.
 */
export class ProjectAccessService {
  constructor(private readonly db: AppDb | DbExecutor) {}

  resolveProjectAccess(actorAccountId: string, projectId: string): ProjectAccess {
    return this.resolveProjectAccessForActor(legacyAccountActor(actorAccountId), projectId);
  }

  resolveProjectAccessForActor(actor: ProjectActorInput, projectId: string): ProjectAccess {
    const normalizedProjectId = requireNonEmpty(projectId, "projectId");
    const project = this.loadActiveProject(normalizedProjectId);
    const role = this.resolveRoleForActor(actor, project);
    if (!role) {
      throw new ProjectAccessServiceError(
        403,
        "project_access_denied",
        `Project access denied: ${normalizedProjectId}`,
        "not_a_member",
      );
    }
    return { project, role };
  }

  requireProjectAction(
    actorAccountId: string,
    projectId: string,
    action: ProjectAction,
  ): ProjectAccess {
    return this.requireProjectActionForActor(legacyAccountActor(actorAccountId), projectId, action);
  }

  requireProjectActionForActor(
    actor: ProjectActorInput,
    projectId: string,
    action: ProjectAction,
  ): ProjectAccess {
    const access = this.resolveProjectAccessForActor(actor, projectId);
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
    return this.requireProjectActionBySessionIdForActor(
      legacyAccountActor(actorAccountId),
      sessionId,
      action,
    );
  }

  requireProjectActionBySessionIdForActor(
    actor: ProjectActorInput,
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

    return this.requireProjectActionForActor(actor, session.projectId, action);
  }

  requireProjectActionByFloorId(
    actorAccountId: string,
    floorId: string,
    action: ProjectAction,
  ): ProjectAccess & { sessionId: string } {
    return this.requireProjectActionByFloorIdForActor(
      legacyAccountActor(actorAccountId),
      floorId,
      action,
    );
  }

  requireProjectActionByFloorIdForActor(
    actor: ProjectActorInput,
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

    const access = this.requireProjectActionBySessionIdForActor(actor, floorRow.sessionId, action);
    return { ...access, sessionId: floorRow.sessionId };
  }

  requireProjectActionByPageId(
    actorAccountId: string,
    pageId: string,
    action: ProjectAction,
  ): ProjectAccess & { sessionId: string; floorId: string } {
    return this.requireProjectActionByPageIdForActor(
      legacyAccountActor(actorAccountId),
      pageId,
      action,
    );
  }

  requireProjectActionByPageIdForActor(
    actor: ProjectActorInput,
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

    const access = this.requireProjectActionBySessionIdForActor(actor, row.sessionId, action);
    return { ...access, sessionId: row.sessionId, floorId: row.floorId };
  }

  requireProjectActionByMessageId(
    actorAccountId: string,
    messageId: string,
    action: ProjectAction,
  ): ProjectAccess & { sessionId: string; floorId: string; pageId: string } {
    return this.requireProjectActionByMessageIdForActor(
      legacyAccountActor(actorAccountId),
  messageId,
      action,
    );
  }

  requireProjectActionByMessageIdForActor(
    actor: ProjectActorInput,
    messageId: string,
    action: ProjectAction,
  ): ProjectAccess & { sessionId: string; floorId: string; pageId: string } {
    const normalizedMessageId = requireNonEmpty(messageId, "messageId");
    const row =this.db
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

    const access = this.requireProjectActionBySessionIdForActor(actor, row.sessionId, action);
    return {
      ...access,
      sessionId: row.sessionId,
      floorId: row.floorId,
      pageId: row.pageId,
    };
  }

  private resolveRoleForActor(actor: ProjectActorInput, project: ProjectAccessProject): ProjectRole | null {
    if (actor.actorType === "client") {
      return this.resolveClientRole(actor, project);
    }
    return this.resolveAccountRole(actor.actorAccountId, project);
  }

  private resolveAccountRole(actorAccountId: string, project: ProjectAccessProject): ProjectRole | null {
    const normalizedActorAccountId = requireNonEmpty(actorAccountId, "actorAccountId");
    if (project.accountId === normalizedActorAccountId) {
      return "owner";
    }

    const membership = this.db
      .select({ role: projectMemberships.role })
      .from(projectMemberships)
      .where(and(
        eq(projectMemberships.projectId, project.id),
        eq(projectMemberships.subjectType, "account"),
        eq(projectMemberships.subjectId, normalizedActorAccountId),
        eq(projectMemberships.status, "active"),
    ))
      .limit(1)
      .get();

    if (membership?.role === "owner" || membership?.role === "observer" || membership?.role === "deriver") {
      return membership.role;
    }

    // Legacy data may have subject_type IS NULL. Fall back to account_id match.
    const legacy = this.db
      .select({ role: projectMemberships.role })
      .from(projectMemberships)
      .where(and(
        eq(projectMemberships.projectId, project.id),
        eq(projectMemberships.accountId, normalizedActorAccountId),
        eq(projectMemberships.status, "active"),
      ))
      .limit(1)
      .get();

    if (legacy?.role === "owner" || legacy?.role === "observer" || legacy?.role === "deriver") {
      return legacy.role;
    }

    return null;
  }

  private resolveClientRole(actor: ProjectActorInput, project: ProjectAccessProject): ProjectRole | null {
    const clientId = actor.actorClientId ?? "";
    if (clientId.trim().length === 0) {
      return null;
    }

    const client = this.db
      .select({
        id: clients.id,
   accountId: clients.accountId,
        status: clients.status,
        isDefault: clients.isDefault,
      })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1)
      .get();

    if (!client || client.status !== "active") {
      return null;
    }

    if (client.isDefault && client.accountId === project.accountId) {
      return "owner";
    }

    const membership = this.db
      .select({ role: projectMemberships.role })
      .from(projectMemberships)
      .where(and(
        eq(projectMemberships.projectId, project.id),
        eq(projectMemberships.subjectType, "client"),
        eq(projectMemberships.subjectId, clientId),
        eq(projectMemberships.status, "active"),
      ))
      .limit(1)
      .get();

    if (membership?.role === "owner" || membership?.role === "observer" || membership?.role === "deriver") {
      return membership.role;
    }

    return null;
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

  if (role === "observer") {
    return OBSERVER_ALLOWED_ACTIONS.has(action);
  }

  if (role === "deriver") {
    return DERIVER_ALLOWED_ACTIONS.has(action);
  }

  return false;
}

const OBSERVER_ALLOWED_ACTIONS: ReadonlySet<ProjectAction> =new Set([
  "project.read",
  "project.observe",
  "project.derived_output.read",
  "session.read_metadata",
  "session.read_committed_messages",
  "project.agent.read",
  "project.config.read",
]);

const DERIVER_ALLOWED_ACTIONS: ReadonlySet<ProjectAction> = new Set([
  "project.read",
  "project.observe",
  "project.derived_output.read",
  "project.derived_output.write",
  "project.inbox.read",
  "project.inbox.write",
  "session.read_metadata",
  "session.read_committed_messages",
  "project.agent.read",
  "project.config.read",
]);

function legacyAccountActor(actorAccountId: string): ProjectActorInput {
  return {
    actorType: "account",
    actorAccountId,
    actorClientId: null,
  };
}

function requireNonEmpty(value: string, fieldName: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed.length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  return trimmed;
}
