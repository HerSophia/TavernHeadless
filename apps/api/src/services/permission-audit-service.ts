import type { FastifyBaseLogger } from "fastify";

import type { AppDb, DbExecutor } from "../db/client.js";
import type { ProjectAccessServiceError } from "./project-access-service.js";
import {
  OperationLogService,
  type CreateOperationLogInput,
  type OperationLogResult,
  type OperationLogStatus,
} from "./operation-log-service.js";

export type PermissionAuditTargetType =
  | "project"
  | "workspace"
  | "session"
  | "floor"
  | "page"
  | "message"
  | "derived_output"
  | "inbox_item"
  | "client"
  | "client_api_key";

export type PermissionAuditActor = {
  accountId: string;
  actorType: "account" | "client" | "system";
  actorId: string;
  actorAccountId?: string | null;
  actorClientId?: string | null;
};

export type PermissionAuditDeniedInput = {
  actor: PermissionAuditActor;
  permissionAction: string;
  reason: string;
  targetType: PermissionAuditTargetType;
  targetId?: string | null;
  workspaceId?: string | null;
  projectId?: string | null;
  sessionId?: string | null;
  floorId?: string | null;
  runId?: string | null;
  requestId?: string | null;
  sourceType?: string;
  metadata?: Record<string, unknown>;
};

export type PermissionAuditAllowedInput = {
  actor: PermissionAuditActor;
  permissionAction: string;
  targetType: PermissionAuditTargetType;
  targetId?: string | null;
  workspaceId?: string | null;
  projectId?: string | null;
  sessionId?: string | null;
  floorId?: string | null;
  runId?: string | null;
  requestId?: string | null;
  sourceType?: string;
  status?: OperationLogStatus;
  metadata?: Record<string, unknown>;
};

export type PermissionAuditServiceOptions = {
  logger?: FastifyBaseLogger;
};

/**
 * Records permission decisions into the Operation Journal.
 *
 * The phase 4 auditpath stores allow / deny outcomes alongside the resource
 * scope (`workspace_id`, `project_id`, `session_id`, ...) and the actor
 * triple (`account`, `client`, `account_id`). Failures to write the audit
 * record are logged but never surfaced to the caller, so HTTP behaviour stays
 * unchanged when the journal itself is unavailable.
 */
export class PermissionAuditService {
  private readonly operationLogService: OperationLogService;

  constructor(
    private readonly db: AppDb | DbExecutor,
    private readonly options: PermissionAuditServiceOptions = {},
  ) {
    this.operationLogService = new OperationLogService(db);
  }

  recordDenied(input: PermissionAuditDeniedInput): void {
    const log: CreateOperationLogInput = {
      accountId: input.actor.accountId,
      actorType: input.actor.actorType === "system" ? "system" : input.actor.actorType,
      actorId: input.actor.actorId,
      actorAccountId: input.actor.actorAccountId ?? input.actor.accountId,
      actorClientId: input.actor.actorClientId ?? null,
      sourceType: input.sourceType ?? "http",
      action: "permission.denied",
      status: "denied",
      permissionAction: input.permissionAction,
      result: "denied",
      reason: input.reason,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      workspaceId: input.workspaceId ?? null,
      projectId: input.projectId ?? null,
      sessionId: input.sessionId ?? null,
      floorId: input.floorId ?? null,
      runId: input.runId ?? null,
      requestId: input.requestId ?? null,
      metadata: input.metadata ?? null,
    };
    this.safeAppend(log);
  }

  recordAllowed(input: PermissionAuditAllowedInput): void {
    const log: CreateOperationLogInput = {
      accountId: input.actor.accountId,
      actorType: input.actor.actorType === "system" ? "system" : input.actor.actorType,
      actorId: input.actor.actorId,
      actorAccountId: input.actor.actorAccountId ?? input.actor.accountId,
      actorClientId: input.actor.actorClientId ?? null,
      sourceType: input.sourceType ?? "http",
      action: "permission.allowed",
      status: input.status ?? "succeeded",
      permissionAction: input.permissionAction,
      result: "allowed" as OperationLogResult,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      workspaceId: input.workspaceId ?? null,
      projectId: input.projectId ?? null,
      sessionId: input.sessionId ?? null,
      floorId: input.floorId ?? null,
      runId: input.runId ?? null,
      requestId: input.requestId ?? null,
      metadata: input.metadata ?? null,
    };
    this.safeAppend(log);
  }

  private safeAppend(log: CreateOperationLogInput): void {
    try {
      this.operationLogService.append(log);
    } catch (error) {
      this.options.logger?.warn?.(
        { err: error, action: log.action, permission_action: log.permissionAction },
        "Failed to append permission audit log",
      );
    }
  }
}

export function reasonFromAccessError(error: ProjectAccessServiceError): string {
  if (error.denyReason) {
    return `${error.code}:${error.denyReason}`;
  }
  return error.code;
}
