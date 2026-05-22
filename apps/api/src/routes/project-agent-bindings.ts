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
  AgentPermissionPolicyError,
} from "../services/agent-permission-policy.js";
import {
  ProjectAgentBindingService,
  ProjectAgentBindingServiceError,
  type ProjectAgentBindingRecord,
} from "../services/project-agent-binding-service.js";
import { AgentTypeServiceError } from "../services/agent-type-service.js";
import { AgentJobTriggerService, AgentJobTriggerServiceError } from "../services/agent-job-trigger-service.js";
import { EffectiveConfigService, EffectiveConfigServiceError } from "../services/effective-config-service.js";
import {
  ProjectLlmProfileOverrideService,
} from"../services/project-llm-profile-override-service.js";
import {
  ProjectMcpBindingService,
} from "../services/project-mcp-binding-service.js";
import {
  ProjectToolPolicyOverrideService,
} from "../services/project-tool-policy-override-service.js";
import { AGENT_SCOPE_KIND_VALUES, PROJECT_AGENT_BINDING_STATUS_VALUES } from "../services/agent-scope-types.js";

const projectIdParamsSchema = z.object({ id: z.string().min(1) });
const bindingParamsSchema = z.object({
  id: z.string().min(1),
  binding_id: z.string().min(1),
});

const mcpEntrySchema = z.object({
  mcp_server_id: z.string().min(1),
  allowed_tools: z.array(z.string()).optional(),
  config_override_json: z.record(z.string(), z.unknown()).nullable().optional(),
});

const eventSubscriptionSchema = z.object({
  type: z.string().min(1),
  filter_json: z.record(z.string(), z.unknown()).nullable().optional(),
});

const createBindingBodySchema = z.object({
  agent_type_id: z.string().min(1),
  scope_kind: z.enum(AGENT_SCOPE_KIND_VALUES).optional(),
  llm_profile_id: z.string().nullable().optional(),
  tool_policy_id: z.string().nullable().optional(),
  mcp_bindings: z.array(mcpEntrySchema).optional(),
  event_subscriptions: z.array(eventSubscriptionSchema).optional(),
  grants: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

const updateBindingBodySchema = z.object({
  scope_kind: z.enum(AGENT_SCOPE_KIND_VALUES).optional(),
  status: z.enum(PROJECT_AGENT_BINDING_STATUS_VALUES).optional(),
  llm_profile_id: z.string().nullable().optional(),
  tool_policy_id: z.string().nullable().optional(),
  mcp_bindings: z.array(mcpEntrySchema).optional(),
  event_subscriptions: z.array(eventSubscriptionSchema).optional(),
  grants: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

const runBindingBodySchema = z.object({
  trigger_reason: z.string().nullable().optional(),
  dry_run: z.boolean().optional(),
  input_json: z.record(z.string(), z.unknown()).optional(),
}).strict().optional();

const llmOverrideBodySchema = z.object({
  base_profile_id: z.string().min(1),
  override_json: z.record(z.string(), z.unknown()).optional(),
}).strict();

const mcpBindingBodySchema = z.object({
  mcp_server_id: z.string().min(1),
  allowed_tools: z.array(z.string()).optional(),
  config_override_json: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(["enabled", "disabled"]).optional(),
}).strict();

const toolPolicyOverrideBodySchema = z.object({
  base_policy_id: z.string().min(1),
  override_json: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(["active", "archived"]).optional(),
}).strict();

function actorFromRequest(request: FastifyRequest): ProjectActorInput {
  const auth = getRequestAuthContext(request);
  return {
    actorType: auth.actorType,
    actorAccountId: auth.accountId,
    actorClientId: auth.actorType === "client" ? auth.actorClientId : null,
  };
}

function bindingToResponse(record: ProjectAgentBindingRecord) {
  return {
    id: record.id,
    workspace_id: record.workspaceId,
    project_id: record.projectId,
    account_id: record.accountId,
    agent_type_id: record.agentTypeId,
    status: record.status,
    scope_kind: record.scopeKind,
    llm_profile_id: record.llmProfileId,
    tool_policy_id: record.toolPolicyId,
    mcp_bindings: record.mcpBindings.map((entry) => ({
      mcp_server_id: entry.mcpServerId,
      allowed_tools: entry.allowedTools ?? null,
      config_override_json: entry.configOverrideJson ?? null,
    })),
    event_subscriptions: record.eventSubscriptions.map((entry) => ({
      type: entry.type,
      filter_json: entry.filterJson ?? null,
    })),
    grants: record.grants,
    metadata: record.metadata,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

function handleAgentError(reply: FastifyReply, error: unknown): boolean {
  if (error instanceof ProjectAgentBindingServiceError
    || error instanceof AgentJobTriggerServiceError
    || error instanceof AgentTypeServiceError
    || error instanceof ProjectAccessServiceError
    || error instanceof EffectiveConfigServiceError) {
    sendError(reply, (error as { statusCode: number }).statusCode, (error as { code: string }).code, error.message);
    return true;
  }
  if (error instanceof AgentPermissionPolicyError) {
  sendError(reply, error.statusCode, error.code, error.message, error.details);
    return true;
}
  return false;
}

export async function registerProjectAgentBindingRoutes(
  app: FastifyInstance,
 connection: DatabaseConnection,
): Promise<void> {
  const db = connection.db;

  app.get("/projects/:id/agent-bindings", async (request, reply) => {
    const params = parseWithSchema(projectIdParamsSchema, request.params, reply);
    if(!params.ok) return;
    const actor = actorFromRequest(request);
    try {
      const access = new ProjectAccessService(db).requireProjectActionForActor(actor, params.data.id, "project.agent.read");
      const service = new ProjectAgentBindingService(db);
      const records = service.listByProject({
        projectId: params.data.id,
        accountId: access.project.accountId,
      });
      return reply.send({ items: records.map(bindingToResponse) });
    } catch (error) {
      if (handleAgentError(reply, error)) return;
      throw error;
    }
  });

  app.get("/projects/:id/agent-bindings/:binding_id", async (request, reply) => {
    const params = parseWithSchema(bindingParamsSchema, request.params, reply);
    if (!params.ok) return;
    const actor = actorFromRequest(request);
    try {
      const access = new ProjectAccessService(db).requireProjectActionForActor(actor, params.data.id, "project.agent.read");
      const service = new ProjectAgentBindingService(db);
      const record = service.getById({
        id: params.data.binding_id,
        accountId: access.project.accountId,
      });
      return reply.send(bindingToResponse(record));
    } catch (error) {
      if (handleAgentError(reply, error)) return;
      throw error;
    }
  });

  app.post("/projects/:id/agent-bindings", async (request, reply) => {
    const params = parseWithSchema(projectIdParamsSchema, request.params, reply);
    if (!params.ok) return;
    const body = parseWithSchema(createBindingBodySchema, request.body, reply);
    if (!body.ok) return;
    const actor = actorFromRequest(request);
    try {
      const access = new ProjectAccessService(db).requireProjectActionForActor(actor, params.data.id, "project.agent.manage");
      const service = new ProjectAgentBindingService(db);
      const record = service.create({
        workspaceId: access.project.workspaceId,
        projectId: access.project.id,
        accountId: access.project.accountId,
        agentTypeId: body.data.agent_type_id,
        scopeKind: body.data.scope_kind,
        llmProfileId: body.data.llm_profile_id ?? null,
        toolPolicyId: body.data.tool_policy_id ?? null,
        mcpBindings: (body.data.mcp_bindings ?? []).map((entry) => ({
          mcpServerId: entry.mcp_server_id,
          allowedTools: entry.allowed_tools,
          configOverrideJson: entry.config_override_json ?? null,
        })),
  eventSubscriptions: (body.data.event_subscriptions ?? []).map((entry) => ({
          type: entry.type,
          filterJson: entry.filter_json ??null,
        })),
        grants: body.data.grants ?? {},
        metadata: body.data.metadata ?? {},
      });
 return reply.code(201).send(bindingToResponse(record));
    } catch (error) {
      if (handleAgentError(reply, error)) return;
      throw error;
    }
  });

  app.patch("/projects/:id/agent-bindings/:binding_id", async (request, reply) => {
    const params = parseWithSchema(bindingParamsSchema, request.params, reply);
    if (!params.ok) return;
    const body = parseWithSchema(updateBindingBodySchema, request.body, reply);
    if (!body.ok) return;
    const actor = actorFromRequest(request);
    try {
      const access =new ProjectAccessService(db).requireProjectActionForActor(actor, params.data.id, "project.agent.manage");
      const service = new ProjectAgentBindingService(db);
      const record = service.update(
        { id: params.data.binding_id, accountId: access.project.accountId },
        {
          scopeKind: body.data.scope_kind,
          status: body.data.status,
          llmProfileId: body.data.llm_profile_id ?? null,
          toolPolicyId: body.data.tool_policy_id ?? null,
          mcpBindings: body.data.mcp_bindings
            ? body.data.mcp_bindings.map((entry)=> ({
                mcpServerId: entry.mcp_server_id,
                allowedTools: entry.allowed_tools,
                configOverrideJson: entry.config_override_json ?? null,
          }))
            : undefined,
          eventSubscriptions: body.data.event_subscriptions
            ? body.data.event_subscriptions.map((entry) => ({
                type: entry.type,
           filterJson: entry.filter_json ?? null,
              }))
            : undefined,
          grants: body.data.grants,
     metadata: body.data.metadata,
        },
      );
      return reply.send(bindingToResponse(record));
    } catch (error) {
      if (handleAgentError(reply, error)) return;
      throw error;
    }
  });

  app.post("/projects/:id/agent-bindings/:binding_id/disable", async (request, reply) => {
    const params = parseWithSchema(bindingParamsSchema, request.params, reply);
    if (!params.ok) return;
    const actor = actorFromRequest(request);
    try {
      const access = new ProjectAccessService(db).requireProjectActionForActor(actor, params.data.id, "project.agent.manage");
      const service = new ProjectAgentBindingService(db);
      const record = service.update(
        { id: params.data.binding_id, accountId: access.project.accountId },
        { status: "disabled" },
      );
      return reply.send(bindingToResponse(record));
    } catch (error) {
      if (handleAgentError(reply, error)) return;
      throw error;
    }
  });

  app.post("/projects/:id/agent-bindings/:binding_id/enable", async (request, reply) => {
    const params = parseWithSchema(bindingParamsSchema, request.params, reply);
    if (!params.ok) return;
    const actor = actorFromRequest(request);
    try {
      const access = new ProjectAccessService(db).requireProjectActionForActor(actor, params.data.id, "project.agent.manage");
      const service = new ProjectAgentBindingService(db);
      const record = service.update(
        { id: params.data.binding_id, accountId: access.project.accountId },
        { status: "enabled" },
      );
      return reply.send(bindingToResponse(record));
    } catch (error) {
      if (handleAgentError(reply, error)) return;
      throw error;
    }
  });

  app.post("/projects/:id/agent-bindings/:binding_id/run", async (request, reply) => {
    const params = parseWithSchema(bindingParamsSchema, request.params, reply);
    if (!params.ok) return;
    const body = parseWithSchema(runBindingBodySchema, request.body ?? {}, reply);
    if (!body.ok) return;
    const actor = actorFromRequest(request);
    try {
      const access = new ProjectAccessService(db).requireProjectActionForActor(actor, params.data.id, "project.agent.run");
      const triggerService = new AgentJobTriggerService(db);
      const result = await db.transaction(async (tx) =>
        triggerService.enqueueManual(tx, {
          accountId: access.project.accountId,
          workspaceId: access.project.workspaceId,
          projectId: access.project.id,
          agentBindingId: params.data.binding_id,
          triggerReason: body.data?.trigger_reason ?? null,
          actorClientId: actor.actorClientId ?? null,
          dryRun: body.data?.dry_run ?? true,
          inputJson: body.data?.input_json,
        }),
      );
      return reply.code(202).send({
    job_id: result.jobId,
        created: result.created,
        agent_binding_id: result.agentBindingId,
        dedupe_key: result.dedupeKey ?? null,
      });
    } catch (error) {
      if (handleAgentError(reply, error)) return;
      throw error;
    }
  });

  app.get("/projects/:id/effective-config", async (request, reply) => {
    const params = parseWithSchema(projectIdParamsSchema,request.params, reply);
    if (!params.ok) return;
    const actor = actorFromRequest(request);
    try {
      const access = new ProjectAccessService(db).requireProjectActionForActor(actor, params.data.id, "project.config.read");
      const service = new EffectiveConfigService(db);
      const view = service.forProject({ projectId: access.project.id, accountId: access.project.accountId });
      return reply.send(view);
    } catch (error) {
      if (handleAgentError(reply, error)) return;
      throw error;
    }
  });

  app.get("/projects/:id/settings/llm-profile-override", async (request, reply) => {
    const params = parseWithSchema(projectIdParamsSchema, request.params, reply);
    if (!params.ok) return;
    const actor = actorFromRequest(request);
    try {
      const access = new ProjectAccessService(db).requireProjectActionForActor(actor, params.data.id, "project.config.read");
      const service = new ProjectLlmProfileOverrideService(db);
      const record = service.getActive({ projectId: access.project.id, accountId: access.project.accountId });
      return reply.send({ item: record ? {
        id: record.id,
        workspace_id: record.workspaceId,
        project_id: record.projectId,
        base_profile_id: record.baseProfileId,
        override_json: record.overrideJson,
        status: record.status,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      } : null });
    } catch (error) {
      if (handleAgentError(reply, error)) return;
      throw error;
    }
  });

  app.put("/projects/:id/settings/llm-profile-override", async (request, reply) => {
    const params = parseWithSchema(projectIdParamsSchema, request.params, reply);
    if (!params.ok) return;
    const body = parseWithSchema(llmOverrideBodySchema, request.body, reply);
    if (!body.ok) return;
    const actor = actorFromRequest(request);
    try {
      const access = new ProjectAccessService(db).requireProjectActionForActor(actor, params.data.id, "project.config.write");
      const service = new ProjectLlmProfileOverrideService(db);
      const record = service.upsert({
        workspaceId: access.project.workspaceId,
        projectId: access.project.id,
        accountId: access.project.accountId,
        baseProfileId: body.data.base_profile_id,
        overrideJson: body.data.override_json ?? {},
      });
      return reply.send({
        id: record.id,
        workspace_id: record.workspaceId,
        project_id: record.projectId,
        base_profile_id: record.baseProfileId,
        override_json: record.overrideJson,
        status: record.status,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      });
    } catch (error) {
      if (handleAgentError(reply, error)) return;
      throw error;
    }
  });

  app.get("/projects/:id/settings/mcp-bindings", async (request, reply) => {
    const params = parseWithSchema(projectIdParamsSchema, request.params, reply);
    if (!params.ok) return;
    const actor = actorFromRequest(request);
    try {
      const access = new ProjectAccessService(db).requireProjectActionForActor(actor, params.data.id, "project.config.read");
      const service = new ProjectMcpBindingService(db);
      const items = service.listByProject({ projectId: access.project.id, accountId: access.project.accountId });
      return reply.send({ items: items.map((record) => ({
        id: record.id,
        workspace_id: record.workspaceId,
        project_id: record.projectId,
        mcp_server_id: record.mcpServerId,
        status: record.status,
        allowed_tools: record.allowedTools,
        config_override_json: record.configOverrideJson,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      })) });
    } catch (error) { if (handleAgentError(reply, error)) return; throw error; }
  });

  app.put("/projects/:id/settings/mcp-bindings", async (request, reply) => {
    const params = parseWithSchema(projectIdParamsSchema, request.params, reply);
    if (!params.ok) return;
    const body = parseWithSchema(mcpBindingBodySchema, request.body, reply);
    if (!body.ok) return;
    const actor = actorFromRequest(request);
    try {
      const access = new ProjectAccessService(db).requireProjectActionForActor(actor, params.data.id, "project.config.write");
      const service = new ProjectMcpBindingService(db);
      const record = service.upsert({
        workspaceId: access.project.workspaceId,
        projectId: access.project.id,
        accountId: access.project.accountId,
        mcpServerId: body.data.mcp_server_id,
        allowedTools: body.data.allowed_tools,
        configOverrideJson: body.data.config_override_json,
        status: body.data.status,
      });
      return reply.send({
        id: record.id,
        workspace_id: record.workspaceId,
        project_id: record.projectId,
        mcp_server_id: record.mcpServerId,
        status: record.status,
        allowed_tools: record.allowedTools,
        config_override_json: record.configOverrideJson,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      });
    } catch (error) {
      if (handleAgentError(reply, error)) return;
      throw error;
    }
  });

  app.get("/projects/:id/settings/tool-policy-overrides", async (request, reply) => {
    const params = parseWithSchema(projectIdParamsSchema, request.params, reply);
    if (!params.ok) return;
    const actor = actorFromRequest(request);
    try {
      const access = new ProjectAccessService(db).requireProjectActionForActor(actor, params.data.id, "project.config.read");
      const service = new ProjectToolPolicyOverrideService(db);
      const items = service.listByProject({ projectId: access.project.id, accountId: access.project.accountId });
      return reply.send({ items: items.map((record) => ({
        id: record.id,
        workspace_id: record.workspaceId,
        project_id: record.projectId,
        base_policy_id: record.basePolicyId,
        override_json: record.overrideJson,
        status: record.status,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      })) });
    } catch (error) { if (handleAgentError(reply, error)) return; throw error; }
  });

  app.put("/projects/:id/settings/tool-policy-overrides", async (request, reply) => {
    const params = parseWithSchema(projectIdParamsSchema, request.params, reply);
    if (!params.ok) return;
    const body = parseWithSchema(toolPolicyOverrideBodySchema, request.body, reply);
    if (!body.ok) return;
    const actor = actorFromRequest(request);
    try {
      const access = new ProjectAccessService(db).requireProjectActionForActor(actor, params.data.id, "project.config.write");
      const service = new ProjectToolPolicyOverrideService(db);
      const record = service.upsert({
        workspaceId: access.project.workspaceId,
        projectId: access.project.id,
        accountId: access.project.accountId,
        basePolicyId: body.data.base_policy_id,
        overrideJson: body.data.override_json,
        status: body.data.status,
      });
      return reply.send({
        id: record.id,
        workspace_id: record.workspaceId,
        project_id: record.projectId,
        base_policy_id: record.basePolicyId,
        override_json: record.overrideJson,
        status: record.status,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      });
    } catch (error) {
      if (handleAgentError(reply, error)) return;
      throw error;
    }
  });

  app.get("/sessions/:id/effective-config", async (request, reply) => {
    const params = parseWithSchema(projectIdParamsSchema, request.params, reply);
    if (!params.ok) return;
    const actor = actorFromRequest(request);
    try {
      const access = new ProjectAccessService(db).requireProjectActionBySessionIdForActor(actor, params.data.id, "project.config.read");
      const service = new EffectiveConfigService(db);
      const view = service.forSession({ sessionId: params.data.id, accountId: access.project.accountId });
      return reply.send(view);
    } catch (error) {
      if (handleAgentError(reply, error)) return;
      throw error;
    }
  });
}
