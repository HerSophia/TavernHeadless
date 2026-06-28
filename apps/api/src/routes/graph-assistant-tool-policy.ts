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
  GraphAssistantToolPolicyService,
  GraphAssistantToolPolicyServiceError,
  type GraphAssistantToolEffectivePolicy,
} from "../services/graph-assistant-tool-policy-service.js";

const projectIdParamsSchema = z.object({ id: z.string().min(1) });

const updateBodySchema = z.object({
  policies: z.array(z.object({
    tool_name: z.string().min(1),
    decision: z.enum(["auto", "confirm"]),
  })).min(1),
}).strict();

function actorFromRequest(request: FastifyRequest): ProjectActorInput {
  const auth = getRequestAuthContext(request);
  return {
    actorType: auth.actorType,
    actorAccountId: auth.accountId,
    actorClientId: auth.actorType === "client" ? auth.actorClientId : null,
  };
}

function policyToResponse(policy: GraphAssistantToolEffectivePolicy) {
  return {
    tool_name: policy.toolName,
    side_effect_level: policy.sideEffectLevel,
    default_decision: policy.defaultDecision,
    decision: policy.decision,
    source: policy.source,
  };
}

function handlePolicyError(reply: FastifyReply, error: unknown): boolean {
  if (error instanceof ProjectAccessServiceError) {
    sendError(reply, error.statusCode,error.code, error.message);
    return true;
  }
  if (error instanceof GraphAssistantToolPolicyServiceError) {
    sendError(reply, error.statusCode, error.code, error.message);
    return true;
  }
  return false;
}

/**
 * 注册图助手逐工具「自动执行 / 需要确认」策略的项目级路由。
 *
 * 这些路由属于 NodeGraph 周边第一方接入面，不进入 OpenAPI / @tavern/sdk 生成面；
 * studio 经第一方薄客户端直连。读用 `project.nodegraph.read`，写用 `project.nodegraph.write`。
 */
export async function registerGraphAssistantToolPolicyRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection,
): Promise<void> {
  const db = connection.db;

  app.get("/projects/:id/graph-assistant/tool-policy", async (request, reply) => {
    const params = parseWithSchema(projectIdParamsSchema, request.params, reply);
    if (!params.ok) return;
    const actor = actorFromRequest(request);
    try {
      new ProjectAccessService(db).requireProjectActionForActor(actor, params.data.id, "project.nodegraph.read");
      const policies = new GraphAssistantToolPolicyService(db).resolveEffective({ projectId: params.data.id });
      return reply.send({ items: policies.map(policyToResponse) });
    } catch (error) {
      if (handlePolicyError(reply, error)) return;
      throw error;
    }
  });

  app.put("/projects/:id/graph-assistant/tool-policy", async (request, reply) => {
    const params = parseWithSchema(projectIdParamsSchema, request.params, reply);
    if (!params.ok) return;
    const body = parseWithSchema(updateBodySchema, request.body, reply);
    if(!body.ok) return;
    const actor = actorFromRequest(request);
    try {
      const access = new ProjectAccessService(db).requireProjectActionForActor(
        actor,
        params.data.id,
        "project.nodegraph.write",
      );
      const policies = new GraphAssistantToolPolicyService(db).upsert({
        workspaceId: access.project.workspaceId,
        projectId: access.project.id,
        accountId: access.project.accountId,
        policies: body.data.policies.map((policy) => ({
          toolName: policy.tool_name,
          decision: policy.decision,
        })),
      });
      return reply.send({ items: policies.map(policyToResponse) });
    } catch (error) {
      if (handlePolicyError(reply, error)) return;
      throw error;
    }
  });
}
