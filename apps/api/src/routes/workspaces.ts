import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import type { DatabaseConnection } from "../db/client.js";
import { parseJsonField, parseWithSchema, sendError } from "../lib/http.js";
import { getRequestAuthContext } from "../plugins/auth.js";
import {
  AgentPermissionPolicyError,
} from "../services/agent-permission-policy.js";
import {
  AgentTypeService,
  AgentTypeServiceError,
  type AgentTypeRecord,
} from "../services/agent-type-service.js";
import { AGENT_SCOPE_KIND_VALUES, AGENT_TYPE_STATUS_VALUES } from "../services/agent-scope-types.js";
import {
  WorkspaceManagementService,
  WorkspaceManagementServiceError,
  type WorkspaceManagementActor,
  type WorkspaceManagementRecord,
} from "../services/workspace-management-service.js";
import { errorResponseJsonSchema, idParamsJsonSchema } from "./schemas/common.js";

const workspaceIdParamsSchema = z.object({ id: z.string().min(1) });

const workspaceSettingsSchema = z.record(z.string(), z.unknown());

const listWorkspacesQuerySchema = z
  .object({
    status: z.enum(["active", "archived"]).optional(),
    include_archived: z.boolean().optional(),
  })
  .strict();

const createWorkspaceBodySchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    settings: workspaceSettingsSchema.optional(),
  })
  .strict();

const updateWorkspaceBodySchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    settings: workspaceSettingsSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined || Object.prototype.hasOwnProperty.call(value, "settings"),
    { message: "At least one workspace field must be provided" },
  );

const workspaceJsonSchema = {
  type: "object",
  required: [
    "id",
    "account_id",
    "name",
    "kind",
    "is_default",
    "status",
    "settings",
    "archived_at",
    "created_at",
    "updated_at",
  ],
  properties: {
    id: { type: "string" },
    account_id: { type: "string" },
    name: { type: "string" },
    kind: { type: "string", enum: ["default", "manual"] },
    is_default: { type: "boolean" },
    status: { type: "string", enum: ["active", "archived"] },
    settings: {},
    archived_at: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
    created_at: { type: "integer", minimum: 0 },
    updated_at: { type: "integer", minimum: 0 },
  },
  additionalProperties: false,
} as const;

const workspaceListResponseJsonSchema = {
  type: "object",
  required: ["items"],
  properties: {
    items: { type: "array", items: workspaceJsonSchema },
  },
  additionalProperties: false,
} as const;

const listWorkspacesQueryJsonSchema = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["active", "archived"] },
    include_archived: { type: "boolean" },
  },
  additionalProperties: false,
} as const;

const createWorkspaceBodyJsonSchema = {
  type: "object",
  required: ["name"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 200 },
    settings: { type: "object", additionalProperties: true },
  },
  additionalProperties: false,
} as const;

const updateWorkspaceBodyJsonSchema = {
  type: "object",
  properties: {
    name: { type: "string", minLength: 1, maxLength: 200 },
    settings: { anyOf: [{ type: "object", additionalProperties: true }, { type: "null" }] },
  },
  additionalProperties: false,
} as const;

const agentTypeIdParamsSchema = z.object({
  id: z.string().min(1),
  agent_type_id: z.string().min(1),
});

const agentMcpEntrySchema = z.object({
  mcp_server_id: z.string().min(1),
  allowed_tools: z.array(z.string()).optional(),
  config_override_json: z.record(z.string(), z.unknown()).nullable().optional(),
});

const agentEventSubscriptionSchema = z.object({
  type: z.string().min(1),
  filter_json: z.record(z.string(), z.unknown()).nullable().optional(),
});

const agentDefaultsSchema = z.object({
  llm_profile_id: z.string().nullable().optional(),
  tool_policy_id: z.string().nullable().optional(),
  mcp_bindings: z.array(agentMcpEntrySchema).optional(),
  event_subscriptions: z.array(agentEventSubscriptionSchema).optional(),
  grants: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

const createAgentTypeBodySchema = z.object({
  key: z.string().min(1).max(120),
  name: z.string().min(1).max(200),
  scope_kind: z.enum(AGENT_SCOPE_KIND_VALUES),
  defaults: agentDefaultsSchema.optional(),
}).strict();

const updateAgentTypeBodySchema = z.object({
name: z.string().min(1).max(200).optional(),
  status: z.enum(AGENT_TYPE_STATUS_VALUES).optional(),
  defaults: agentDefaultsSchema.optional(),
}).strict();

type AgentDefaultsBody = z.infer<typeof agentDefaultsSchema>;

function requireAccountActor(
  request: FastifyRequest,
  reply: FastifyReply,
  options: { code?: string; message?: string } = {},
): { accountId: string } | null {
  const auth = getRequestAuthContext(request);
  if (auth.actorType !== "account") {
    sendError(
      reply,
      403,
      options.code ?? "agent_type_account_only",
      options.message ?? "Workspace-level agent type management requires an account actor",
    );
    return null;
  }
  return { accountId: auth.accountId };
}

function requireWorkspaceAccountActor(
  request: FastifyRequest,
  reply: FastifyReply,
): { accountId: string } | null {
  return requireAccountActor(request, reply, {
    code: "workspace_account_only",
    message: "Workspace management requires an account actor",
  });
}

function buildWorkspaceActor(request: FastifyRequest): WorkspaceManagementActor {
  const auth = getRequestAuthContext(request);
  return {
    actorType: auth.actorType,
    actorId: auth.actorId,
    actorAccountId: auth.actorAccountId,
    actorClientId: auth.actorClientId,
    source: "api",
    requestId: typeof request.id === "string" && request.id.trim().length > 0 ? request.id : null,
  };
}

function workspaceToResponse(record: WorkspaceManagementRecord) {
  return {
    id: record.id,
    account_id: record.accountId,
    name: record.name,
    kind: record.kind,
    is_default: record.isDefault,
    status: record.status,
    settings: parseJsonField(record.settingsJson),
    archived_at: record.archivedAt,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

function handleWorkspaceManagementError(error: unknown, reply: FastifyReply) {
  if (error instanceof WorkspaceManagementServiceError) {
    return sendError(reply, error.statusCode, error.code, error.message);
  }
  throw error;
}

function agentTypeToResponse(record: AgentTypeRecord) {
  return {
    id: record.id,
    workspace_id: record.workspaceId,
    account_id: record.accountId,
    key: record.key,
    name: record.name,
    scope_kind: record.scopeKind,
    status: record.status,
    defaults: {
      llm_profile_id: record.defaults.llmProfileId,
      tool_policy_id: record.defaults.toolPolicyId,
      mcp_bindings: record.defaults.mcpBindings.map((entry) => ({
        mcp_server_id: entry.mcpServerId,
        allowed_tools: entry.allowedTools ?? null,
        config_override_json: entry.configOverrideJson ?? null,
      })),
      event_subscriptions: record.defaults.eventSubscriptions.map((entry) => ({
        type: entry.type,
        filter_json: entry.filterJson ?? null,
      })),
      grants: record.defaults.grants,
      metadata: record.defaults.metadata,
    },
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

function transformDefaults(defaults: AgentDefaultsBody | undefined) {
  if (!defaults) return undefined;
  return {
    llmProfileId: defaults.llm_profile_id ?? null,
    toolPolicyId: defaults.tool_policy_id ?? null,
    mcpBindings: (defaults.mcp_bindings ?? []).map((entry) => ({
      mcpServerId: entry.mcp_server_id,
      allowedTools: entry.allowed_tools,
      configOverrideJson: entry.config_override_json ?? null,
    })),
    eventSubscriptions: (defaults.event_subscriptions ?? []).map((entry) => ({
      type: entry.type,
      filterJson: entry.filter_json ?? null,
    })),
    grants: defaults.grants ?? {},
    metadata: defaults.metadata ?? {},
  };
}

export async function registerWorkspaceRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection,
): Promise<void> {
  const db = connection.db;
  const workspaceManagementService = new WorkspaceManagementService(db);

  app.get(
    "/workspaces",
    {
      schema: {
        tags: ["workspaces"],
        summary: "List workspaces",
        querystring: listWorkspacesQueryJsonSchema,
        response: {
          200: workspaceListResponseJsonSchema,
          400: errorResponseJsonSchema,
          403: errorResponseJsonSchema,
        },
      },
    },
    async (request, reply) => {
      const actor = requireWorkspaceAccountActor(request, reply);
      if (!actor) return;
      const parsed = parseWithSchema(listWorkspacesQuerySchema, request.query, reply);
      if (!parsed.ok) return;
      const records = workspaceManagementService.list({
        accountId: actor.accountId,
        status: parsed.data.status,
        includeArchived: parsed.data.include_archived,
      });
      return reply.send({ items: records.map(workspaceToResponse) });
    },
  );

  app.get(
    "/workspaces/:id",
    {
      schema: {
        tags: ["workspaces"],
        summary: "Get workspace detail",
        params: idParamsJsonSchema,
        response: {
          200: workspaceJsonSchema,
          400: errorResponseJsonSchema,
          403: errorResponseJsonSchema,
          404: errorResponseJsonSchema,
        },
      },
    },
    async (request, reply) => {
      const actor = requireWorkspaceAccountActor(request, reply);
      if (!actor) return;
      const parsed = parseWithSchema(workspaceIdParamsSchema, request.params, reply);
      if (!parsed.ok) return;
      try {
        const record = workspaceManagementService.getById({
          accountId: actor.accountId,
          id: parsed.data.id,
        });
        return reply.send(workspaceToResponse(record));
      } catch (error) {
        return handleWorkspaceManagementError(error, reply);
      }
    },
  );

  app.post(
    "/workspaces",
    {
      schema: {
        tags: ["workspaces"],
        summary: "Create workspace",
        body: createWorkspaceBodyJsonSchema,
        response: {
          201: workspaceJsonSchema,
          400: errorResponseJsonSchema,
          403: errorResponseJsonSchema,
          404: errorResponseJsonSchema,
          409: errorResponseJsonSchema,
        },
      },
    },
    async (request, reply) => {
      const actor = requireWorkspaceAccountActor(request, reply);
      if (!actor) return;
      const parsed = parseWithSchema(createWorkspaceBodySchema, request.body, reply);
      if (!parsed.ok) return;
      try {
        const record = workspaceManagementService.create({
          accountId: actor.accountId,
          name: parsed.data.name,
          settings: parsed.data.settings,
          actor: buildWorkspaceActor(request),
        });
        return reply.code(201).send(workspaceToResponse(record));
      } catch (error) {
        return handleWorkspaceManagementError(error, reply);
      }
    },
  );

  app.patch(
    "/workspaces/:id",
    {
      schema: {
        tags: ["workspaces"],
        summary: "Update workspace",
        params: idParamsJsonSchema,
        body: updateWorkspaceBodyJsonSchema,
        response: {
          200: workspaceJsonSchema,
          400: errorResponseJsonSchema,
          403: errorResponseJsonSchema,
          404: errorResponseJsonSchema,
          409: errorResponseJsonSchema,
        },
      },
    },
    async (request, reply) => {
      const actor = requireWorkspaceAccountActor(request, reply);
      if (!actor) return;
      const params = parseWithSchema(workspaceIdParamsSchema, request.params, reply);
      if (!params.ok) return;
      const body = parseWithSchema(updateWorkspaceBodySchema, request.body, reply);
      if (!body.ok) return;
      const settingsPatch = Object.prototype.hasOwnProperty.call(body.data, "settings")
        ? { settings: body.data.settings ?? null }
        : {};
      try {
        const record = workspaceManagementService.update({
          accountId: actor.accountId,
          id: params.data.id,
          name: body.data.name,
          ...settingsPatch,
          actor: buildWorkspaceActor(request),
        });
        return reply.send(workspaceToResponse(record));
      } catch (error) {
        return handleWorkspaceManagementError(error, reply);
      }
    },
  );

  app.post(
    "/workspaces/:id/archive",
    {
      schema: {
        tags: ["workspaces"],
        summary: "Archive workspace",
        params: idParamsJsonSchema,
        response: {
          200: workspaceJsonSchema,
          400: errorResponseJsonSchema,
          403: errorResponseJsonSchema,
          404: errorResponseJsonSchema,
          409: errorResponseJsonSchema,
        },
      },
    },
    async (request, reply) => {
      const actor = requireWorkspaceAccountActor(request, reply);
      if (!actor) return;
      const parsed = parseWithSchema(workspaceIdParamsSchema, request.params, reply);
      if (!parsed.ok) return;
      try {
        const record = workspaceManagementService.archive({
          accountId: actor.accountId,
          id: parsed.data.id,
          actor: buildWorkspaceActor(request),
        });
        return reply.send(workspaceToResponse(record));
      } catch (error) {
        return handleWorkspaceManagementError(error, reply);
      }
    },
  );

  app.post(
    "/workspaces/:id/restore",
    {
      schema: {
        tags: ["workspaces"],
        summary: "Restore workspace",
        params: idParamsJsonSchema,
        response: {
          200: workspaceJsonSchema,
          400: errorResponseJsonSchema,
          403: errorResponseJsonSchema,
          404: errorResponseJsonSchema,
          409: errorResponseJsonSchema,
        },
      },
    },
    async (request, reply) => {
      const actor = requireWorkspaceAccountActor(request, reply);
      if (!actor) return;
      const parsed = parseWithSchema(workspaceIdParamsSchema, request.params, reply);
      if (!parsed.ok) return;
      try {
        const record = workspaceManagementService.restore({
          accountId: actor.accountId,
          id: parsed.data.id,
          actor: buildWorkspaceActor(request),
        });
        return reply.send(workspaceToResponse(record));
      } catch (error) {
        return handleWorkspaceManagementError(error, reply);
      }
    },
  );

  app.get(
    "/workspaces/:id/agent-types",
    async (request, reply) => {
      const actor = requireAccountActor(request, reply);
      if (!actor) return;
      const parsed = parseWithSchema(workspaceIdParamsSchema, request.params, reply);
      if (!parsed.ok) return;
      const service = new AgentTypeService(db);
      const records = service.list({ workspaceId: parsed.data.id, accountId: actor.accountId });
      return reply.send({ items: records.map(agentTypeToResponse) });
    },
  );

  app.get(
    "/workspaces/:id/agent-types/:agent_type_id",
    async (request, reply) => {
      const actor = requireAccountActor(request, reply);
      if (!actor) return;
      const params = parseWithSchema(agentTypeIdParamsSchema, request.params, reply);
      if (!params.ok) return;
      const service = new AgentTypeService(db);
      try {
        const record = service.getById({ id: params.data.agent_type_id, accountId: actor.accountId });
        return reply.send(agentTypeToResponse(record));
      } catch (error) {
        if (error instanceof AgentTypeServiceError) return sendError(reply, error.statusCode, error.code, error.message);
        throw error;
      }
    },
  );

  app.post(
    "/workspaces/:id/agent-types",
    async (request, reply) => {
      const actor = requireAccountActor(request, reply);
      if (!actor) return;
      const params = parseWithSchema(workspaceIdParamsSchema, request.params, reply);
      if (!params.ok) return;
      const body = parseWithSchema(createAgentTypeBodySchema, request.body, reply);
      if (!body.ok) return;
      const service = new AgentTypeService(db);
      try {
        const record = service.create({
          workspaceId: params.data.id,
          accountId: actor.accountId,
          key: body.data.key,
          name: body.data.name,
          scopeKind: body.data.scope_kind,
          defaults: transformDefaults(body.data.defaults),
        });
        return reply.code(201).send(agentTypeToResponse(record));
      } catch (error) {
        if (error instanceof AgentTypeServiceError) {
          return sendError(reply, error.statusCode, error.code, error.message);
        }
        if (error instanceof AgentPermissionPolicyError) {
          return sendError(reply, error.statusCode, error.code, error.message, error.details);
        }
        throw error;
      }
    },
  );

  app.patch(
    "/workspaces/:id/agent-types/:agent_type_id",
    async (request, reply) => {
      const actor = requireAccountActor(request, reply);
      if (!actor) return;
      const params = parseWithSchema(agentTypeIdParamsSchema, request.params, reply);
      if (!params.ok) return;
      const body = parseWithSchema(updateAgentTypeBodySchema, request.body, reply);
      if (!body.ok) return;
      const service = new AgentTypeService(db);
      try {
        const record = service.update(
          { id: params.data.agent_type_id, accountId: actor.accountId },
          {
            name: body.data.name,
            status: body.data.status,
            defaults: transformDefaults(body.data.defaults),
          },
        );
        return reply.send(agentTypeToResponse(record));
      } catch (error) {
        if (error instanceof AgentTypeServiceError) {
          return sendError(reply, error.statusCode, error.code, error.message);
        }
        if (error instanceof AgentPermissionPolicyError) {
          return sendError(reply, error.statusCode, error.code, error.message, error.details);
        }
        throw error;
      }
    },
  );

  app.post(
    "/workspaces/:id/agent-types/:agent_type_id/disable",
    async (request, reply) => {
      const actor = requireAccountActor(request, reply);
      if (!actor) return;
      const params = parseWithSchema(agentTypeIdParamsSchema, request.params, reply);
      if (!params.ok) return;
      const service = new AgentTypeService(db);
      try {
        const record = service.setStatus({
          id: params.data.agent_type_id,
          accountId: actor.accountId,
          status: "disabled",
        });
        return reply.send(agentTypeToResponse(record));
      } catch (error) {
        if (error instanceof AgentTypeServiceError) {
          return sendError(reply, error.statusCode, error.code, error.message);
        }
        throw error;
      }
    },
  );

  app.post(
    "/workspaces/:id/agent-types/:agent_type_id/enable",
    async (request, reply) => {
      const actor = requireAccountActor(request, reply);
      if (!actor) return;
      const params = parseWithSchema(agentTypeIdParamsSchema, request.params, reply);
      if (!params.ok) return;
      const service = new AgentTypeService(db);
      try {
        const record = service.setStatus({
          id: params.data.agent_type_id,
          accountId: actor.accountId,
          status: "active",
        });
        return reply.send(agentTypeToResponse(record));
      } catch (error) {
        if (error instanceof AgentTypeServiceError) {
          return sendError(reply, error.statusCode, error.code, error.message);
        }
        throw error;
      }
    },
  );
}
