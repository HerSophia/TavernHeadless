import { and, eq } from "drizzle-orm";

import type { AppDb, DbExecutor } from "../db/client.js";
import { projectAgentBindings, projectEvents } from "../db/schema.js";
import {
  AGENT_RUN_JOB_TYPE,
  AGENT_RUNTIME_SCOPE_TYPE,
  buildAgentRuntimeScopeKey,
  makeAgentRunJobId,
  type AgentRunJobPayload,
} from "./agent-runtime-job-definitions.js";
import {
  ProjectAgentBindingService,
  ProjectAgentBindingServiceError,
  type ProjectAgentBindingRecord,
  type ResolveEffectiveAgentBindingResult,
} from "./project-agent-binding-service.js";
import { AgentTypeService, type AgentTypeRecord } from "./agent-type-service.js";
import {
  RuntimeJobScheduler,
  type RuntimeJobSchedulerOptions,
} from "./runtime-job-scheduler.js";
import { RuntimeJobCatalog } from "./runtime-job-catalog.js";
import { createAgentRuntimeJobCatalog } from "./agent-runtime-job-definitions.js";
import type { EnqueueRuntimeJobResult } from "./runtime-job-types.js";
import {
  AgentPermissionPolicyError,
  FORBIDDEN_AGENT_OUTPUT_TARGETS,
} from "./agent-permission-policy.js";

export type AgentJobTriggerServiceErrorCode =
  | "event_not_found"
  | "binding_disabled"
  | "agent_type_disabled"
  | "binding_workspace_mismatch"
  | "binding_project_mismatch"
  | "agent_forbidden_output_target";

export class AgentJobTriggerServiceError extends Error {
  constructor(
    public readonly statusCode: 400 | 403 | 404 | 409,
    public readonly code: AgentJobTriggerServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AgentJobTriggerServiceError";
  }
}

export interface EvaluateEventInput {
  accountId: string;
  projectId: string;
  eventId: string;
}

export interface EvaluatedAgentTrigger {
  binding: ProjectAgentBindingRecord;
  matchedSubscription: { type: string};
}

export interface EnqueueFromEventInput extends EvaluateEventInput {
  dryRun?: boolean;
  actorClientId?: string | null;
}

export interface EnqueueFromEventResult {
  triggered: Array<EnqueueRuntimeJobResult & { agentBindingId: string }>;
}

export interface EnqueueManualInput {
  accountId: string;
  workspaceId: string;
  projectId: string;
  agentBindingId: string;
  triggerReason?: string | null;
  actorClientId?: string | null;
  dryRun?: boolean;
  inputJson?: Record<string, unknown>;
}

export class AgentJobTriggerService {
  private readonly bindingService: ProjectAgentBindingService;
  private readonly agentTypeService: AgentTypeService;
  private readonly scheduler: RuntimeJobScheduler;

  constructor(
    private readonly db: AppDb | DbExecutor,
    options: {
      bindingService?: ProjectAgentBindingService;
      agentTypeService?: AgentTypeService;
      catalog?: RuntimeJobCatalog;
      schedulerOptions?: RuntimeJobSchedulerOptions;
    } = {},
  ) {
    this.bindingService = options.bindingService ?? new ProjectAgentBindingService(db);
    this.agentTypeService = options.agentTypeService ?? new AgentTypeService(db);
    const catalog = options.catalog ?? createAgentRuntimeJobCatalog();
    this.scheduler = new RuntimeJobScheduler(catalog, options.schedulerOptions ?? {});
  }

  evaluateEvent(input: EvaluateEventInput): EvaluatedAgentTrigger[] {
    const event = this.db
      .select({
        id: projectEvents.id,
        type: projectEvents.type,
        projectId: projectEvents.projectId,
      })
      .from(projectEvents)
      .where(and(eq(projectEvents.id, input.eventId), eq(projectEvents.projectId, input.projectId)))
      .limit(1)
      .all()[0];

    if (!event) {
      throw new AgentJobTriggerServiceError(404, "event_not_found", `Project event not found: ${input.eventId}`);
    }

    const bindings = this.bindingService.listByProject({
      projectId: input.projectId,
      accountId: input.accountId,
    });

    const triggered: EvaluatedAgentTrigger[] = [];
    for (const binding of bindings) {
      if (binding.status !== "enabled") continue;
      const subscription = binding.eventSubscriptions.find((entry) => entry.type === event.type);
      if (!subscription) continue;
      triggered.push({ binding, matchedSubscription: { type: subscription.type } });
    }
    return triggered;
  }

  enqueueFromEvent(
    tx: DbExecutor,
    input: EnqueueFromEventInput,
  ): EnqueueFromEventResult {
    const evaluations = this.evaluateEvent(input);
    const dryRun = input.dryRun ?? true;
    const triggered: EnqueueFromEventResult["triggered"] = [];

    for (const evaluation of evaluations) {
      const effective = this.bindingService.resolveEffective({
        id: evaluation.binding.id,
        accountId: input.accountId,
      });
      const payload = this.buildPayload({
        binding: evaluation.binding,
        effective,
        triggerType: "event",
        triggerReason: `event:${evaluation.matchedSubscription.type}`,
        sourceEventId: input.eventId,
        actorClientId: input.actorClientId ?? null,
        dryRun,
      });

      const result = this.scheduler.enqueue(tx, {
        jobType: AGENT_RUN_JOB_TYPE,
        jobId: makeAgentRunJobId({
          agentBindingId: evaluation.binding.id,
          sourceEventId: input.eventId,
          triggerType: "event",
        }),
        accountId: input.accountId,
        scopeType: AGENT_RUNTIME_SCOPE_TYPE,
        scopeKey: buildAgentRuntimeScopeKey({
          workspaceId: evaluation.binding.workspaceId,
          projectId: evaluation.binding.projectId,
          agentTypeId: evaluation.binding.agentTypeId,
        }),
        workspaceId: evaluation.binding.workspaceId,
        projectId: evaluation.binding.projectId,
        agentTypeId: evaluation.binding.agentTypeId,
        agentBindingId: evaluation.binding.id,
        actorClientId: input.actorClientId ?? null,
        sourceEventId: input.eventId,
        payload,
        dedupeKey: `agent:event:${evaluation.binding.id}:${input.eventId}`,
      });

      triggered.push({ ...result, agentBindingId: evaluation.binding.id });
    }

    return { triggered };
  }

  enqueueManual(
    tx: DbExecutor,
    input: EnqueueManualInput,
  ): EnqueueRuntimeJobResult & { agentBindingId: string } {
    const binding = this.bindingService.getById({
      id: input.agentBindingId,
      accountId: input.accountId,
    });
    if (binding.status !== "enabled") {
      throw new AgentJobTriggerServiceError(
        409,
        "binding_disabled",
        `Agent binding is not enabled: ${input.agentBindingId}`,
      );
    }
    if (binding.projectId !== input.projectId) {
      throw new AgentJobTriggerServiceError(
        409,
        "binding_project_mismatch",
        `Agent binding does not belong to project ${input.projectId}`,
      );
    }
    if (binding.workspaceId !== input.workspaceId) {
      throw new AgentJobTriggerServiceError(
        409,
        "binding_workspace_mismatch",
        `Agent binding does not belong to workspace ${input.workspaceId}`,
      );
    }

    const agentType = this.agentTypeService.getById({
      id: binding.agentTypeId,
      accountId: input.accountId,
    });
    if (agentType.status !== "active") {
      throw new AgentJobTriggerServiceError(
        409,
        "agent_type_disabled",
        `Agent type is not active: ${binding.agentTypeId}`,
      );
    }

    const effective = this.bindingService.resolveEffective({
      id: binding.id,
      accountId: input.accountId,
    });

    const dryRun = input.dryRun ?? true;
    const payload = this.buildPayload({
      binding,
      effective,
      triggerType: "manual",
      triggerReason: input.triggerReason ?? null,
      sourceEventId: null,
      actorClientId: input.actorClientId ?? null,
      dryRun,
      inputJson: input.inputJson,
    });

    const result = this.scheduler.enqueue(tx, {
      jobType: AGENT_RUN_JOB_TYPE,
      accountId: input.accountId,
      scopeType: AGENT_RUNTIME_SCOPE_TYPE,
      scopeKey: buildAgentRuntimeScopeKey({
        workspaceId: binding.workspaceId,
        projectId: binding.projectId,
        agentTypeId: binding.agentTypeId,
      }),
      workspaceId: binding.workspaceId,
      projectId: binding.projectId,
      agentTypeId: binding.agentTypeId,
      agentBindingId: binding.id,
      actorClientId: input.actorClientId ?? null,
      sourceEventId: null,
      payload,
    });

    return { ...result, agentBindingId: binding.id };
  }

  private buildPayload(args: {
    binding: ProjectAgentBindingRecord;
    effective: ResolveEffectiveAgentBindingResult;
    triggerType: "event" | "manual";
    triggerReason: string | null;
    sourceEventId: string | null;
    actorClientId: string | null;
    dryRun: boolean;
    inputJson?: Record<string, unknown>;
  }): AgentRunJobPayload {
    const { binding, effective } = args;
    for (const target of effective.effective.allowedOutputTargets) {
      if (FORBIDDEN_AGENT_OUTPUT_TARGETS.has(target)) {
        throw new AgentPermissionPolicyError(
          403,
          "agent_allowed_output_target_forbidden",
          `Agent allowed output target is forbidden: ${target}`,
          { target },
        );
      }
    }

    return {
      accountId: binding.accountId,
      workspaceId: binding.workspaceId,
      projectId: binding.projectId,
      agentTypeId: binding.agentTypeId,
      agentBindingId: binding.id,
      sourceEventId: args.sourceEventId,
      actorClientId: args.actorClientId,
      triggerType: args.triggerType,
      triggerReason: args.triggerReason,
      scopeKind: binding.scopeKind,
      resolvedConfig: {
        llmProfileId: effective.effective.llmProfileId,
        toolPolicyId: effective.effective.toolPolicyId,
        mcpBindings: effective.effective.mcpBindings,
        eventSubscriptions: effective.effective.eventSubscriptions,
        grants: effective.effective.grants,
        allowedOutputTargets: effective.effective.allowedOutputTargets,
      },
      dryRun: args.dryRun,
      inputJson: args.inputJson ?? {},
    };
  }
}

// Re-export for convenience.
export { ProjectAgentBindingServiceError };
export { AgentPermissionPolicyError };
