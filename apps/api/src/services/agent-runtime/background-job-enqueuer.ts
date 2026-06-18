import type { AppDb } from "../../db/client.js";
import { AgentJobTriggerService } from "../agent-job-trigger-service.js";
import type {
  BackgroundJobEnqueueResult,
  BackgroundJobEnqueuer,
  BackgroundJobRouteRequest,
} from "./agent-executor-router.js";

export type AgentJobTriggerBackgroundJobEnqueuerErrorCode =
  | "background_job_route_missing_account_id"
  | "background_job_route_missing_workspace_id"
  | "background_job_route_missing_project_id"
  | "background_job_route_missing_agent_binding_id";

export class AgentJobTriggerBackgroundJobEnqueuerError extends Error {
  constructor(
    public readonly code: AgentJobTriggerBackgroundJobEnqueuerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AgentJobTriggerBackgroundJobEnqueuerError";
  }
}

export class AgentJobTriggerBackgroundJobEnqueuer implements BackgroundJobEnqueuer {
  constructor(private readonly db: AppDb) {}

  async enqueue(request: BackgroundJobRouteRequest): Promise<BackgroundJobEnqueueResult> {
    this.assertNonEmpty(request.accountId, "background_job_route_missing_account_id", "accountId");
    this.assertNonEmpty(request.workspaceId, "background_job_route_missing_workspace_id", "workspaceId");
    this.assertNonEmpty(request.projectId, "background_job_route_missing_project_id", "projectId");
    this.assertNonEmpty(
      request.agentBindingId,
      "background_job_route_missing_agent_binding_id",
      "agentBindingId",
    );

    const lineage = this.buildLineage(request);
    const service = new AgentJobTriggerService(this.db);
    const result = this.db.transaction((tx) =>
      service.enqueueManual(tx, {
        accountId: request.accountId,
        workspaceId: request.workspaceId,
        projectId: request.projectId,
        agentBindingId: request.agentBindingId,
        triggerReason: request.triggerReason ?? "background_job_medium",
        actorClientId: request.actorClientId ?? null,
        ...(request.dryRun !== undefined ? { dryRun: request.dryRun } : {}),
        ...(request.inputJson !== undefined ? { inputJson: request.inputJson } : {}),
        ...(lineage ? { lineage } : {}),
      }),
    );

    return {
      jobId: result.jobId,
      created: result.created,
      dryRun: request.dryRun ?? true,
    };
  }

  private assertNonEmpty(
    value: string,
    code: AgentJobTriggerBackgroundJobEnqueuerErrorCode,
    fieldName: string,
  ): void {
    if (value.trim().length === 0) {
      throw new AgentJobTriggerBackgroundJobEnqueuerError(
        code,
        `background_job route requires ${fieldName}.`,
      );
    }
  }

  /**
   * 把 route 请求里的父级 run 引用收敛为 nested lineage（缺口 3，子 -> 父）。
   * 三项都为空时返回 undefined，避免写入空对象。
   */
  private buildLineage(request: BackgroundJobRouteRequest): {
    rootRunId?: string;
    parentRunId?: string;
    parentRuntimeKind?: string;
  } | undefined {
    const rootRunId = normalizeRef(request.rootRunId);
    const parentRunId = normalizeRef(request.parentRunId);
    const parentRuntimeKind = normalizeRef(request.parentRuntimeKind);
    if (!rootRunId && !parentRunId && !parentRuntimeKind) {
      return undefined;
    }
    return {
      ...(rootRunId ? { rootRunId } : {}),
      ...(parentRunId ? { parentRunId } : {}),
      ...(parentRuntimeKind ? { parentRuntimeKind } : {}),
    };
  }
}

function normalizeRef(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
