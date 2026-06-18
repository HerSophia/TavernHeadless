/**
 * ProjectAgentTaskBoardService：后台 Agent 运行情况的查询与取消面（R4 阶段六）。
 *
 * 它是高级开发者特性，不是普通聊天界面接口。基于 RuntimeJobQueryService 查询，
 * 固定 scope_type = agent，并按 scope_key 前缀 `${workspaceId}:${projectId}:` 过滤，
 * 保证只暴露该 project 维度的后台 Agent job。
 *
 * 取消复用 RuntimeJobQueryService.cancel，仅允许 pending / retry_waiting，
 * 并在取消前校验目标 job 属于该 project。
 */
import type { AppDb } from "../db/client.js";
import { createAgentRuntimeJobCatalog } from "./agent-runtime-job-definitions.js";
import {
  AGENT_RUNTIME_SCOPE_TYPE,
} from "./agent-runtime-job-definitions.js";
import {
  RuntimeJobQueryService,
  type RuntimeJobView,
} from "./runtime-job-query-service.js";
import type { RuntimeJobStatus } from "./runtime-job-types.js";

export type ProjectAgentJobView = {
  id: string;
  status: RuntimeJobStatus;
  phase: string | null;
  attemptCount: number;
  maxAttempts: number;
  availableAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  lastError: string | null;
  lastErrorCode: string | null;
  lastErrorClass: string | null;
  createdAt: number;
  updatedAt: number;
  agentTypeId: string | null;
  agentBindingId: string | null;
  sourceEventId: string | null;
  triggerType: string | null;
  dryRun: boolean | null;
  deliveryTargets: string[];
  result: unknown;
};

export interface ProjectAgentTaskBoardScope {
  accountId: string;
  workspaceId: string;
  projectId: string;
}

export interface ListProjectAgentJobsInput extends ProjectAgentTaskBoardScope {
  status?: RuntimeJobStatus;
  limit?: number;
  offset?: number;
}

export interface ProjectAgentJobMutationInput extends ProjectAgentTaskBoardScope {
  jobId: string;
}

export interface ProjectAgentJobGroupView {
  groupKey: string;
  agentBindingId: string | null;
  sourceEventId: string | null;
  total: number;
  statusCounts: Partial<Record<RuntimeJobStatus, number>>;
  latestJob: ProjectAgentJobView;
  jobs: ProjectAgentJobView[];
}

export class ProjectAgentTaskBoardServiceError extends Error {
  constructor(
    public readonly statusCode: 403 | 404 | 409,
   public readonly code:
      | "project_agent_job_not_found"
      | "project_agent_job_project_mismatch"
      | "project_agent_job_invalid_state",
    message: string,
  ){
    super(message);
    this.name = "ProjectAgentTaskBoardServiceError";
  }
}

function readPayloadString(payload: unknown, key: string): string | null {
  if (payload && typeof payload === "object" && key in (payload as Record<string, unknown>)) {
    const value = (payload as Record<string, unknown>)[key];
    return typeof value === "string" ? value : null;
  }
  return null;
}

function readPayloadDryRun(payload: unknown): boolean | null {
  if (payload && typeof payload === "object" && "dryRun" in (payload as Record<string, unknown>)) {
    const value = (payload as Record<string, unknown>).dryRun;
    return typeof value === "boolean" ? value : null;
  }
  return null;
}

function readDeliveryTargets(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const resolved = (payload as Record<string, unknown>).resolvedConfig;
  if (!resolved || typeof resolved !== "object") return [];
  const targets = (resolved as Record<string, unknown>).allowedOutputTargets;
  return Array.isArray(targets) ? targets.filter((item): item is string => typeof item === "string") : [];
}

function toProjectAgentJobView(job: RuntimeJobView): ProjectAgentJobView {
  return {
    id: job.id,
    status: job.status,
    phase: job.phase,
    attemptCount: job.attemptCount,
    maxAttempts: job.maxAttempts,
    availableAt: job.availableAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    lastError: job.lastError,
    lastErrorCode: job.lastErrorCode,
    lastErrorClass: job.lastErrorClass,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    agentTypeId: readPayloadString(job.payload, "agentTypeId"),
    agentBindingId: readPayloadString(job.payload, "agentBindingId"),
    sourceEventId: readPayloadString(job.payload, "sourceEventId"),
    triggerType: readPayloadString(job.payload, "triggerType"),
    dryRun: readPayloadDryRun(job.payload),
    deliveryTargets: readDeliveryTargets(job.payload),
    result: job.result,
  };
}

export class ProjectAgentTaskBoardService {
  private readonly queryService: RuntimeJobQueryService;

  constructor(
    db: AppDb,
    options: { queryService?: RuntimeJobQueryService } = {},
  ) {
    this.queryService = options.queryService
      ?? new RuntimeJobQueryService(db, { catalog: createAgentRuntimeJobCatalog() });
  }

  private buildScopeKeyPrefix(scope: ProjectAgentTaskBoardScope): string {
    return `${scope.workspaceId}:${scope.projectId}:`;
  }

  async list(input: ListProjectAgentJobsInput): Promise<{ jobs: ProjectAgentJobView[]; total: number }> {
const result = await this.queryService.list({
      accountId: input.accountId,
      scopeType: AGENT_RUNTIME_SCOPE_TYPE,
      scopeKeyPrefix: this.buildScopeKeyPrefix(input),
      ...(input.status ? { status: input.status } : {}),
      ...(input.limit !== undefined ? { limit: input.limit } : {}),
      ...(input.offset !== undefined ? { offset: input.offset } : {}),
    });
    return {
      jobs: result.jobs.map(toProjectAgentJobView),
      total: result.total,
    };
}

  async listGroupedBySource(
    input: ListProjectAgentJobsInput,
  ): Promise<{ groups: ProjectAgentJobGroupView[]; total: number }> {
    const result = await this.list(input);
    const groups = new Map<string, ProjectAgentJobGroupView>();

    for (const job of result.jobs) {
      const groupKey = job.sourceEventId ?? job.agentBindingId ?? job.id;
      const existing = groups.get(groupKey);
      if (!existing) {
        groups.set(groupKey, {
          groupKey,
          agentBindingId: job.agentBindingId,
          sourceEventId: job.sourceEventId,
          total: 1,
          statusCounts: { [job.status]: 1 },
          latestJob: job,
          jobs: [job],
        });
        continue;
      }

      existing.total += 1;
      existing.statusCounts[job.status] = (existing.statusCounts[job.status] ?? 0) + 1;
      existing.jobs.push(job);
      if (job.updatedAt >= existing.latestJob.updatedAt) {
        existing.latestJob = job;
      }
    }

    return {
      groups: [...groups.values()],
      total: result.total,
    };
  }

  async get(input: ProjectAgentJobMutationInput): Promise<ProjectAgentJobView> {
    const job = await this.requireProjectJob(input);
    return toProjectAgentJobView(job);
  }

  async cancel(input: ProjectAgentJobMutationInput): Promise<ProjectAgentJobView> {
    await this.requireProjectJob(input);
    const result = await this.queryService.cancel({
      accountId: input.accountId,
      jobId: input.jobId,
      scopeType: AGENT_RUNTIME_SCOPE_TYPE,
    });
    return toProjectAgentJobView(result.job);
  }

  private async requireProjectJob(input: ProjectAgentJobMutationInput): Promise<RuntimeJobView> {
    const job = await this.queryService.get({
      accountId: input.accountId,
      jobId: input.jobId,
      scopeType: AGENT_RUNTIME_SCOPE_TYPE,
    });
    if (!job) {
      throw new ProjectAgentTaskBoardServiceError(
        404,
        "project_agent_job_not_found",
        `Project agent job not found: ${input.jobId}`,
      );
    }
    if (!job.scopeKey.startsWith(this.buildScopeKeyPrefix(input))) {
      throw new ProjectAgentTaskBoardServiceError(
        404,
        "project_agent_job_project_mismatch",
        `Agent job does not belong to project ${input.projectId}`,
      );
    }
    return job;
  }
}
