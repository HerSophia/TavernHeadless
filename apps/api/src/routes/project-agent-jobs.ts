/**
 * ProjectAgentTaskBoard 路由（R4 阶段六）。
 *
 * 提供后台 Agent job 的只读列表 / 详情与取消能力，挂在 project 维度。
 * 它是高级开发者特性，不是普通聊天界面接口。
 *
 * 鉴权沿用 project-agent-bindings.ts 的风格：
 *  - 列表 / 详情需要 project.agent.read。
 *  - 取消需要 project.agent.run。
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import type { DatabaseConnection } from "../db/client.js";
import { parseWithSchema, sendError } from "../lib/http.js";
import { getRequestAuthContext } from "../plugins/auth.js";
import {
  ProjectAccessService,
  ProjectAccessServiceError,
  type ProjectActorInput,
} from "../services/project-access-service.js";
import {
  ProjectAgentTaskBoardService,
  ProjectAgentTaskBoardServiceError,
  type ProjectAgentJobView,
} from "../services/project-agent-task-board-service.js";
import {
  RuntimeJobInvalidStateError,
  RuntimeJobNotFoundError,
} from "../services/runtime-job-query-service.js";
import { RUNTIME_JOB_STATUSES } from "../services/runtime-job-types.js";

const projectIdParamsSchema = z.object({ id: z.string().min(1) });
const jobParamsSchema = z.object({
  id: z.string().min(1),
  job_id: z.string().min(1),
});
const listQuerySchema = z.object({
  status: z.enum(RUNTIME_JOB_STATUSES).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});

function actorFromRequest(request: FastifyRequest): ProjectActorInput {
  const auth = getRequestAuthContext(request);
  return {
    actorType: auth.actorType,
    actorAccountId: auth.accountId,
    actorClientId: auth.actorType === "client" ? auth.actorClientId : null,
  };
}

function jobToResponse(job: ProjectAgentJobView) {
  return {
    id: job.id,
    status: job.status,
phase: job.phase,
    attempt_count: job.attemptCount,
    max_attempts: job.maxAttempts,
    available_at:job.availableAt,
    started_at: job.startedAt,
    finished_at: job.finishedAt,
    last_error: job.lastError,
    last_error_code: job.lastErrorCode,
    last_error_class: job.lastErrorClass,
   created_at: job.createdAt,
    updated_at: job.updatedAt,
    agent_type_id: job.agentTypeId,
    agent_binding_id: job.agentBindingId,
    source_event_id: job.sourceEventId,
    trigger_type: job.triggerType,
    dry_run: job.dryRun,
    delivery_targets: job.deliveryTargets,
    result: job.result,
  };
}

function handleTaskBoardError(reply: FastifyReply, error: unknown): boolean {
  if (error instanceof ProjectAccessServiceError
    || error instanceof ProjectAgentTaskBoardServiceError) {
    sendError(reply, (error as { statusCode: number }).statusCode, (error as { code: string }).code, error.message);
    return true;
  }
  if (error instanceof RuntimeJobNotFoundError) {
    sendError(reply, 404, "project_agent_job_not_found", error.message);
    return true;
  }
  if (error instanceof RuntimeJobInvalidStateError) {
    sendError(reply, 409, "project_agent_job_invalid_state", error.message);
    return true;
  }
  return false;
}

export async function registerProjectAgentJobRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection,
): Promise<void> {
  const db = connection.db;

  app.get("/projects/:id/agent-jobs", async (request, reply) => {
    const params = parseWithSchema(projectIdParamsSchema, request.params, reply);
    if (!params.ok) return;
    const query = parseWithSchema(listQuerySchema, request.query ?? {}, reply);
    if (!query.ok) return;
    const actor = actorFromRequest(request);
    try {
      const access = new ProjectAccessService(db).requireProjectActionForActor(actor, params.data.id, "project.agent.read");
      const service = new ProjectAgentTaskBoardService(db);
      const result = await service.list({
accountId: access.project.accountId,
        workspaceId: access.project.workspaceId,
        projectId: access.project.id,
        ...(query.data.status ? { status: query.data.status } : {}),
        ...(query.data.limit !== undefined ? { limit: query.data.limit } : {}),
        ...(query.data.offset !==undefined ? { offset: query.data.offset } : {}),
      });
      return reply.send({
        items: result.jobs.map(jobToResponse),
        total: result.total,
      });
    } catch (error) {
      if (handleTaskBoardError(reply, error)) return;
      throw error;
    }
  });

  app.get("/projects/:id/agent-jobs/:job_id", async (request, reply) => {
    const params = parseWithSchema(jobParamsSchema, request.params, reply);
    if (!params.ok) return;
    const actor = actorFromRequest(request);
    try {
      const access = new ProjectAccessService(db).requireProjectActionForActor(actor, params.data.id, "project.agent.read");
      const service = new ProjectAgentTaskBoardService(db);
      const job = await service.get({
        accountId: access.project.accountId,
        workspaceId: access.project.workspaceId,
        projectId: access.project.id,
        jobId: params.data.job_id,
      });
      return reply.send(jobToResponse(job));
    } catch (error) {
      if (handleTaskBoardError(reply, error)) return;
      throw error;
    }
  });

  app.post("/projects/:id/agent-jobs/:job_id/cancel", async (request, reply) => {
    const params = parseWithSchema(jobParamsSchema, request.params, reply);
    if (!params.ok) return;
    const actor = actorFromRequest(request);
    try {
      const access = new ProjectAccessService(db).requireProjectActionForActor(actor, params.data.id, "project.agent.run");
      const service = new ProjectAgentTaskBoardService(db);
      const job = await service.cancel({
        accountId: access.project.accountId,
        workspaceId: access.project.workspaceId,
        projectId: access.project.id,
        jobId: params.data.job_id,
      });
      return reply.send(jobToResponse(job));
    } catch (error) {
      if (handleTaskBoardError(reply, error)) return;
      throw error;
    }
  });
}
