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
  GraphAssistantPromptConfigService,
  GraphAssistantPromptConfigServiceError,
  type GraphAssistantPromptConfigEffective,
} from "../services/graph-assistant-prompt-config-service.js";

const projectIdParamsSchema = z.object({ id: z.string().min(1) });

const updateBodySchema = z
  .object({
    static_mode: z.enum(["append", "override"]),
    static_text: z.string(),
    dynamic_template: z.string().optional(),
    context_config: z.record(z.unknown()).nullable().optional(),
  })
  .strict();

function actorFromRequest(request: FastifyRequest): ProjectActorInput {
  const auth = getRequestAuthContext(request);
  return {
    actorType: auth.actorType,
    actorAccountId: auth.accountId,
    actorClientId: auth.actorType === "client"? auth.actorClientId : null,
  };
}

function configToResponse(config: GraphAssistantPromptConfigEffective) {
  return {
    static_mode: config.staticMode,
    static_text: config.staticText,
    dynamic_template: config.dynamicTemplate,
    context_config: config.contextConfig,
    builtin_default: config.builtinDefault,
  };
}

function handleConfigError(reply: FastifyReply, error: unknown): boolean {
  if (error instanceof ProjectAccessServiceError) {
    sendError(reply, error.statusCode, error.code, error.message);
    return true;
  }
  if (error instanceof GraphAssistantPromptConfigServiceError) {
    sendError(reply, error.statusCode, error.code, error.message);
    return true;
  }
  return false;
}

/**
 * 注册图助手「上下文与提示词」项目级配置路由。
 *
 * 这些路由属于 NodeGraph 周边第一方接入面，不进入 OpenAPI / @tavern/sdk 生成面；
 * studio 经第一方薄客户端直连。读用 `project.nodegraph.read`，写用 `project.nodegraph.write`。
 */
export async function registerGraphAssistantPromptConfigRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection,
): Promise<void> {
  const db = connection.db;

  app.get("/projects/:id/graph-assistant/prompt-config", async (request, reply) => {
    const params = parseWithSchema(projectIdParamsSchema, request.params, reply);
    if (!params.ok) return;
    const actor = actorFromRequest(request);
    try {
      new ProjectAccessService(db).requireProjectActionForActor(actor, params.data.id, "project.nodegraph.read");
      const config = new GraphAssistantPromptConfigService(db).getByProject({ projectId: params.data.id });
      return reply.send(configToResponse(config));
    } catch (error) {
      if (handleConfigError(reply, error)) return;
      throw error;
    }
  });

  app.put("/projects/:id/graph-assistant/prompt-config", async (request, reply) => {
    const params = parseWithSchema(projectIdParamsSchema, request.params, reply);
    if (!params.ok) return;
    const body = parseWithSchema(updateBodySchema, request.body, reply);
    if (!body.ok) return;
    const actor =actorFromRequest(request);
    try {
      const access = new ProjectAccessService(db).requireProjectActionForActor(
        actor,
        params.data.id,
        "project.nodegraph.write",
      );
      const config = new GraphAssistantPromptConfigService(db).upsert({
        workspaceId: access.project.workspaceId,
        projectId: access.project.id,
        accountId: access.project.accountId,
        staticMode: body.data.static_mode,
        staticText: body.data.static_text,
        dynamicTemplate: body.data.dynamic_template,
        contextConfig: body.data.context_config ?? undefined,
      });
      return reply.send(configToResponse(config));
    } catch (error) {
      if (handleConfigError(reply, error)) return;
      throw error;
    }
  });
}
