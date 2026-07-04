import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import type { DatabaseConnection } from "../db/client.js";
import { parseWithSchema, sendError } from "../lib/http.js";
import { getRequestAuthContext } from "../plugins/auth.js";
import {
  ProjectAccessServiceError,
  type ProjectActorInput,
} from "../services/project-access-service.js";
import {
  ProjectFloorGraphBindingService,
  ProjectFloorGraphBindingServiceError,
  type ProjectFloorGraphBindingRecord,
} from "../services/project-floor-graph-binding-service.js";

const projectIdParamsSchema = z.object({ id: z.string().min(1) });
const bindingParamsSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
});
const setBindingBodySchema = z.object({
  graph_id: z.string().min(1),
  graph_version_id: z.string().min(1),
}).strict();

function actorFromRequest(request: FastifyRequest): ProjectActorInput {
  const auth = getRequestAuthContext(request);
  return {
    actorType: auth.actorType,
    actorAccountId: auth.accountId,
    actorClientId: auth.actorType === "client" ? auth.actorClientId : null,
  };
}

function bindingToResponse(record: ProjectFloorGraphBindingRecord) {
  return {
    id: record.id,
    account_id: record.accountId,
    workspace_id: record.workspaceId,
    project_id: record.projectId,
    kind: record.kind,
    graph_id: record.graphId,
    graph_version_id: record.graphVersionId,
    graph_name: record.graphName,
    graph_version_no: record.graphVersionNo,
    status: record.status,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

function handleBindingError(reply: FastifyReply, error: unknown): boolean {
  if (error instanceof ProjectAccessServiceError || error instanceof ProjectFloorGraphBindingServiceError) {
    sendError(reply, error.statusCode, error.code, error.message, "details" in error ? error.details : undefined);
    return true;
  }
  return false;
}

export async function registerProjectFloorGraphBindingRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection,
): Promise<void> {
  const service = new ProjectFloorGraphBindingService(connection.db);

  app.get("/projects/:id/settings/floor-graph-bindings", async (request, reply) => {
    const params = parseWithSchema(projectIdParamsSchema, request.params, reply);
    if (!params.ok) return;
    try {
      const items = service.listActive({
        actor: actorFromRequest(request),
        projectId: params.data.id,
      });
      return reply.send({ items: items.map(bindingToResponse) });
    } catch (error) {
      if (handleBindingError(reply, error)) return;
      throw error;
    }
  });

  app.put("/projects/:id/settings/floor-graph-bindings/:kind", async (request, reply) => {
    const params = parseWithSchema(bindingParamsSchema, request.params, reply);
    if (!params.ok) return;
    const body = parseWithSchema(setBindingBodySchema, request.body, reply);
    if (!body.ok) return;
    try {
      const item = service.setActive({
        actor: actorFromRequest(request),
        projectId: params.data.id,
        kind: params.data.kind,
        graphId: body.data.graph_id,
        graphVersionId: body.data.graph_version_id,
      });
      return reply.send({ item: bindingToResponse(item) });
    } catch (error) {
      if (handleBindingError(reply, error)) return;
      throw error;
    }
  });

  app.delete("/projects/:id/settings/floor-graph-bindings/:kind", async (request, reply) => {
    const params = parseWithSchema(bindingParamsSchema, request.params, reply);
    if (!params.ok) return;
    try {
      const result = service.clearActive({
        actor: actorFromRequest(request),
        projectId: params.data.id,
        kind: params.data.kind,
      });
      return reply.send({
        cleared: result.cleared,
        previous: result.previous ? bindingToResponse(result.previous) : null,
      });
    } catch (error) {
      if (handleBindingError(reply, error)) return;
      throw error;
    }
  });
}
