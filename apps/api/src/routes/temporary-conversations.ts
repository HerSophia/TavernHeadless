import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import type { DatabaseConnection } from "../db/client.js";
import { errorResponseJsonSchema } from "./schemas/common.js";
import { ensureOptionalObjectBody, parseWithSchema, sendError } from "../lib/http.js";
import { getRequestAuthContext } from "../plugins/auth.js";
import { applyCorsHeaders, type CorsConfig } from "../plugins/cors.js";
import {
  OperationLogService,
  operationActorFromRequest,
  operationRequestIdFromRequest,
} from "../services/operation-log-service.js";
import {
  ProjectAccessService,
  ProjectAccessServiceError,
  type ProjectAction,
  type ProjectActorInput,
} from "../services/project-access-service.js";
import { TemporaryConversationError } from "../services/temporary-conversation-errors.js";
import { TemporaryConversationService } from "../services/temporary-conversation-service.js";
import {
  TEMPORARY_CONVERSATION_BRANCH_ID,
  type TemporaryConversationExportResult,
  type TemporaryConversationResource,
  type TemporaryConversationTranscript,
} from "../services/temporary-conversation-types.js";
import { mapRunToSnakeCase, mapUsageToSnakeCase } from "./chat/presenters.js";
import { writeSse } from "./chat/sse-writer.js";

const idParamsSchema = z.object({
  id: z.string().min(1),
});

const createTemporaryConversationBodySchema = z.object({
  title: z.string().min(1).max(200).optional(),
  purpose: z.string().min(1).max(120),
  retention_policy: z.enum(["delete_on_finalize", "ttl", "keep_for_debug"]).optional(),
  ttl_seconds: z.number().int().positive().max(86_400).optional(),
}).strict().superRefine((value, context) => {
  if (value.retention_policy === "ttl" && value.ttl_seconds === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "ttl_seconds is required when retention_policy is ttl",
      path: ["ttl_seconds"],
    });
  }

  if (value.retention_policy !== "ttl" && value.ttl_seconds !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "ttl_seconds is only allowed when retention_policy is ttl",
      path: ["ttl_seconds"],
    });
  }
});

const appendMessageBodySchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().min(1),
}).strict();

const respondBodySchema = z.object({
  input_message: appendMessageBodySchema.optional(),
}).strict();

const exportBodySchema = z.object({
  target: z.literal("page_staged_write"),
  target_page_id: z.string().min(1),
  source_output_page_id: z.string().min(1).optional(),
  reason: z.string().min(1).max(500).optional(),
}).strict();

const idParamsJsonSchema = {
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
} as const;

const createTemporaryConversationBodyJsonSchema = {
  type: "object",
  required: ["purpose"],
  properties: {
    title: { type: "string", minLength: 1, maxLength: 200 },
    purpose: { type: "string", minLength: 1, maxLength: 120 },
    retention_policy: { type: "string", enum: ["delete_on_finalize", "ttl", "keep_for_debug"] },
    ttl_seconds: { type: "integer", minimum: 1, maximum: 86400 },
  },
  additionalProperties: false,
} as const;

const appendMessageBodyJsonSchema = {
  type: "object",
  required: ["role", "content"],
  properties: {
    role: { type: "string", enum: ["user", "assistant", "system"] },
    content: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
} as const;

const respondBodyJsonSchema = {
  type: "object",
  properties: {
    input_message: appendMessageBodyJsonSchema,
  },
  additionalProperties: false,
} as const;

const exportBodyJsonSchema = {
  type: "object",
  required: ["target", "target_page_id"],
  properties: {
    target: { type: "string", enum: ["page_staged_write"] },
    target_page_id: { type: "string", minLength: 1 },
    source_output_page_id: { type: "string", minLength: 1 },
    reason: { type: "string", minLength: 1, maxLength: 500 },
  },
  additionalProperties: false,
} as const;

const temporaryConversationResourceJsonSchema = {
  type: "object",
  required: [
    "id",
    "workspace_id",
    "project_id",
    "source_session_id",
    "branch_id",
    "kind",
    "title",
    "purpose",
    "status",
    "retention_policy",
    "visibility",
    "created_at",
    "updated_at",
    "last_activity_at",
    "expires_at",
    "finalized_at",
    "discarded_at",
    "cancelled_at",
  ],
  properties: {
    id: { type: "string" },
    workspace_id: { anyOf: [{ type: "string" }, { type: "null" }] },
    project_id: { anyOf: [{ type: "string" }, { type: "null" }] },
    source_session_id: { anyOf: [{ type: "string" }, { type: "null" }] },
    branch_id: { type: "string" },
    kind: { type: "string", enum: ["temporary"] },
    title: { anyOf: [{ type: "string" }, { type: "null" }] },
    purpose: { anyOf: [{ type: "string" }, { type: "null" }] },
    status: { type: "string", enum: ["active", "finalized", "discarded", "expired", "cancelled"] },
    retention_policy: { type: "string", enum: ["delete_on_finalize", "ttl", "keep_for_debug"] },
    visibility: { type: "string", enum: ["internal", "client_visible"] },
    created_at: { type: "integer", minimum: 0 },
    updated_at: { type: "integer", minimum: 0 },
    last_activity_at: { type: "integer", minimum: 0 },
    expires_at: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
    finalized_at: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
    discarded_at: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
    cancelled_at: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
  },
  additionalProperties: false,
} as const;

const temporaryConversationResourceResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: temporaryConversationResourceJsonSchema,
  },
  additionalProperties: false,
} as const;

const temporaryConversationMessageResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["conversation_id", "floor_id", "page_id", "message_id", "seq", "role"],
      properties: {
        conversation_id: { type: "string" },
        floor_id: { type: "string" },
        page_id: { type: "string" },
        message_id: { type: "string" },
        seq: { type: "integer", minimum: 0 },
        role: { type: "string", enum: ["user", "assistant", "system"] },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
} as const;

const temporaryConversationRespondResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: [
        "conversation_id",
        "branch_id",
        "floor_id",
        "floor_no",
        "page_id",
        "generated_text",
        "total_usage",
        "final_state",
      ],
      properties: {
        conversation_id: { type: "string" },
        branch_id: { type: "string" },
        floor_id: { type: "string" },
        floor_no: { type: "integer", minimum: 0 },
        page_id: { type: "string" },
        generated_text: { type: "string" },
        total_usage: {
          type: "object",
          required: ["prompt_tokens", "completion_tokens", "total_tokens"],
          properties: {
            prompt_tokens: { type: "integer", minimum: 0 },
            completion_tokens: { type: "integer", minimum: 0 },
            total_tokens: { type: "integer", minimum: 0 },
          },
          additionalProperties: false,
        },
        final_state: { anyOf: [{ type: "string" }, { type: "null" }] },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
} as const;

const temporaryConversationTranscriptResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["conversation_id", "branch_id", "floors"],
      properties: {
        conversation_id: { type: "string" },
        branch_id: { type: "string" },
        floors: { type: "array", items: { type: "object", additionalProperties: true } },
      },
      additionalProperties: true,
    },
  },
  additionalProperties: false,
} as const;

const temporaryConversationExportResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["conversation_id", "target", "staged_write_id", "target_page_id", "source_page_id", "created_at", "status"],
      properties: {
        conversation_id: { type: "string" },
        target: { type: "string", enum: ["page_staged_write"] },
        staged_write_id: { type: "string" },
        target_page_id: { type: "string" },
        source_page_id: { type: "string" },
        created_at: { type: "integer", minimum: 0 },
        status: { type: "string", enum: ["staged"] },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
} as const;

export async function registerTemporaryConversationRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection,
  options: {
    temporaryConversationService: TemporaryConversationService;
    cors?: CorsConfig;
  },
): Promise<void> {
  const temporaryConversationService = options.temporaryConversationService;
  const projectAccessService = new ProjectAccessService(connection.db);
  const operationLogService = new OperationLogService(connection.db);

  function toActorInput(request: FastifyRequest): ProjectActorInput {
    const auth = getRequestAuthContext(request);
    return {
      actorType: auth.actorType,
      actorAccountId: auth.actorAccountId,
      actorClientId: auth.actorClientId,
    };
  }

  function authorizeConversationAction(
    reply: FastifyReply,
    request: FastifyRequest,
    conversationId: string,
    action: ProjectAction,
  ): boolean {
    try {
      projectAccessService.requireProjectActionBySessionIdForActor(
        toActorInput(request),
        conversationId,
        action,
      );
      return true;
    } catch (error) {
      if (error instanceof ProjectAccessServiceError) {
        if (error.code === "session_project_scope_missing") {
          return true;
        }
        if (error.code === "session_not_found") {
          sendError(reply, 404, "conversation_not_found", "Temporary conversation not found");
          return false;
        }
        if (error.code === "project_access_denied" && error.denyReason === "not_a_member") {
          sendError(reply, 404, "conversation_not_found", "Temporary conversation not found");
          return false;
        }
        sendError(reply, error.statusCode, error.code, error.message);
        return false;
      }
      throw error;
    }
  }

  function authorizeSourceSessionCreate(
    reply: FastifyReply,
    request: FastifyRequest,
    sourceSessionId: string,
  ): boolean {
    return authorizeConversationAction(reply, request, sourceSessionId, "project.write");
  }

  function authorizeProjectCreate(
    reply: FastifyReply,
    request: FastifyRequest,
    projectId: string,
  ): boolean {
    try {
      projectAccessService.requireProjectActionForActor(toActorInput(request), projectId, "project.write");
      return true;
    } catch (error) {
      if (error instanceof ProjectAccessServiceError) {
        if (error.code === "project_access_denied" && error.denyReason === "not_a_member") {
          sendError(reply, 404, "project_not_found", "Project not found");
          return false;
        }
        sendError(reply, error.statusCode, error.code, error.message);
        return false;
      }
      throw error;
    }
  }

  function authorizeTargetPageExport(
    reply: FastifyReply,
    request: FastifyRequest,
    pageId: string,
  ): boolean {
    try {
      projectAccessService.requireProjectActionByPageIdForActor(toActorInput(request), pageId, "project.write");
      return true;
    } catch (error) {
      if (error instanceof ProjectAccessServiceError) {
        if (error.code === "session_project_scope_missing") {
          return true;
        }
        if (
          error.code === "page_not_found"
          || error.code === "floor_not_found"
          || error.code === "session_not_found"
          || (error.code === "project_access_denied" && error.denyReason === "not_a_member")
        ) {
          sendError(reply, 404, "target_page_not_found", "Target page not found");
          return false;
        }
        sendError(reply, error.statusCode, error.code, error.message);
        return false;
      }
      throw error;
    }
  }

  async function loadPublicConversationDetail(
    reply: FastifyReply,
    accountId: string,
    conversationId: string,
  ): Promise<TemporaryConversationResource | null> {
    try {
      const detail = await temporaryConversationService.getDetail({
        accountId,
        conversationId,
      });
      if (detail.visibility !== "client_visible") {
        sendError(reply, 404, "conversation_not_found", "Temporary conversation not found");
        return null;
      }
      return detail;
    } catch (error) {
      if (handleTemporaryConversationRouteError(reply, error)) {
        return null;
      }
      throw error;
    }
  }

  function appendOperationLog(
    request: FastifyRequest,
    detail: TemporaryConversationResource,
    action: string,
    targetType: string,
    targetId: string,
    metadata?: Record<string, unknown>,
    extra?: {
      floorId?: string | null;
      branchId?: string | null;
    },
  ): void {
    const auth = getRequestAuthContext(request);
    const actor = operationActorFromRequest(request);
    operationLogService.append({
      ...actor,
      accountId: auth.accountId,
      actorAccountId: auth.actorAccountId,
      actorClientId: auth.actorClientId,
      requestId: operationRequestIdFromRequest(request),
      sourceType: "api",
      action,
      status: "succeeded",
      sessionId: detail.id,
      branchId: extra?.branchId ?? TEMPORARY_CONVERSATION_BRANCH_ID,
      floorId: extra?.floorId ?? null,
      workspaceId: detail.workspaceId,
      projectId: detail.projectId,
      targetType,
      targetId,
      metadata,
    });
  }

  app.post("/sessions/:id/temporary-conversations", {
    schema: {
      tags: ["temporary-conversations"],
      summary: "Create a temporary conversation from a source session",
      params: idParamsJsonSchema,
      body: createTemporaryConversationBodyJsonSchema,
      response: {
        201: temporaryConversationResourceResponseJsonSchema,
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(idParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;
    if (!authorizeSourceSessionCreate(reply, request, parsedParams.data.id)) {
      return;
    }
    const parsedBody = parseWithSchema(createTemporaryConversationBodySchema, request.body, reply);
    if (!parsedBody.ok) return;

    try {
      const created = await temporaryConversationService.create({
        accountId: getRequestAuthContext(request).accountId,
        sourceSessionId: parsedParams.data.id,
        title: parsedBody.data.title,
        purpose: parsedBody.data.purpose,
        retentionPolicy: parsedBody.data.retention_policy,
        ttlSeconds: parsedBody.data.ttl_seconds,
        visibility: "client_visible",
      });
      const detail = await temporaryConversationService.getDetail({
        accountId: getRequestAuthContext(request).accountId,
        conversationId: created.conversationId,
      });
      appendOperationLog(
        request,
        detail,
        "temporary_conversation.created",
        "temporary_conversation",
        detail.id,
        {
          route: "POST /sessions/:id/temporary-conversations",
          source_session_id: parsedParams.data.id,
          purpose: detail.purpose,
          retention_policy: detail.retentionPolicy,
        },
      );
      return reply.code(201).send({ data: toTemporaryConversationResourceResponse(detail) });
    } catch (error) {
      if (handleTemporaryConversationRouteError(reply, error)) {
        return;
      }
      throw error;
    }
  });

  app.post("/projects/:id/temporary-conversations", {
    schema: {
      tags: ["temporary-conversations"],
      summary: "Create a temporary conversation from a project scope",
      params: idParamsJsonSchema,
      body: createTemporaryConversationBodyJsonSchema,
      response: {
        201: temporaryConversationResourceResponseJsonSchema,
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(idParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;
    if (!authorizeProjectCreate(reply, request, parsedParams.data.id)) {
      return;
    }
    const parsedBody = parseWithSchema(createTemporaryConversationBodySchema, request.body, reply);
    if (!parsedBody.ok) return;

    try {
      const created = await temporaryConversationService.createFromProject({
        accountId: getRequestAuthContext(request).accountId,
        projectId: parsedParams.data.id,
        title: parsedBody.data.title,
        purpose: parsedBody.data.purpose,
        retentionPolicy: parsedBody.data.retention_policy,
        ttlSeconds: parsedBody.data.ttl_seconds,
        visibility: "client_visible",
      });
      const detail = await temporaryConversationService.getDetail({
        accountId: getRequestAuthContext(request).accountId,
        conversationId: created.conversationId,
      });
      appendOperationLog(
        request,
        detail,
        "temporary_conversation.created",
        "temporary_conversation",
        detail.id,
        {
          route: "POST /projects/:id/temporary-conversations",
          project_id: parsedParams.data.id,
          purpose: detail.purpose,
          retention_policy: detail.retentionPolicy,
        },
      );
      return reply.code(201).send({ data: toTemporaryConversationResourceResponse(detail) });
    } catch (error) {
      if (handleTemporaryConversationRouteError(reply, error)) {
        return;
      }
      throw error;
    }
  });

  app.get("/temporary-conversations/:id", {
    schema: {
      tags: ["temporary-conversations"],
      summary: "Get temporary conversation detail",
      params: idParamsJsonSchema,
      response: {
        200: temporaryConversationResourceResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(idParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;
    if (!authorizeConversationAction(reply, request, parsedParams.data.id, "project.read")) {
      return;
    }

    const detail = await loadPublicConversationDetail(
      reply,
      getRequestAuthContext(request).accountId,
      parsedParams.data.id,
    );
    if (!detail) {
      return;
    }

    return reply.code(200).send({ data: toTemporaryConversationResourceResponse(detail) });
  });

  app.post("/temporary-conversations/:id/messages", {
    schema: {
      tags: ["temporary-conversations"],
      summary: "Append a message to a temporary conversation",
      params: idParamsJsonSchema,
      body: appendMessageBodyJsonSchema,
      response: {
        200: temporaryConversationMessageResponseJsonSchema,
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(idParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;
    if (!authorizeConversationAction(reply, request, parsedParams.data.id, "project.write")) {
      return;
    }
    const detail = await loadPublicConversationDetail(reply, getRequestAuthContext(request).accountId, parsedParams.data.id);
    if (!detail) {
      return;
    }
    const parsedBody = parseWithSchema(appendMessageBodySchema, request.body, reply);
    if (!parsedBody.ok) return;

    try {
      const result = await temporaryConversationService.appendMessage({
        accountId: getRequestAuthContext(request).accountId,
        conversationId: parsedParams.data.id,
        role: parsedBody.data.role,
        content: parsedBody.data.content,
      });
      appendOperationLog(
        request,
        detail,
        "temporary_conversation.message_appended",
        "temporary_conversation_message",
        result.messageId,
        {
          route: "POST /temporary-conversations/:id/messages",
          page_id: result.pageId,
          seq: result.seq,
          role: result.role,
        },
        {
          floorId: result.floorId,
        },
      );
      return reply.code(200).send({
        data: {
          conversation_id: result.conversationId,
          floor_id: result.floorId,
          page_id: result.pageId,
          message_id: result.messageId,
          seq: result.seq,
          role: result.role,
        },
      });
    } catch (error) {
      if (handleTemporaryConversationRouteError(reply, error)) {
        return;
      }
      throw error;
    }
  });

  app.post("/temporary-conversations/:id/respond", {
    schema: {
      tags: ["temporary-conversations"],
      summary: "Respond inside a temporary conversation",
      params: idParamsJsonSchema,
      body: respondBodyJsonSchema,
      response: {
        200: temporaryConversationRespondResponseJsonSchema,
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(idParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;
    if (!authorizeConversationAction(reply, request, parsedParams.data.id, "project.write")) {
      return;
    }
    const detail = await loadPublicConversationDetail(reply, getRequestAuthContext(request).accountId, parsedParams.data.id);
    if (!detail) {
      return;
    }

    ensureOptionalObjectBody(request);
    const parsedBody = parseWithSchema(respondBodySchema, request.body, reply);
    if (!parsedBody.ok) return;

    if (acceptsEventStream(request)) {
      reply.hijack();
      reply.raw.statusCode = 200;
      applyCorsHeaders(reply.raw, request.headers.origin, options.cors ?? { origins: true, credentials: false });
      reply.raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
      reply.raw.setHeader("Connection", "keep-alive");
      reply.raw.setHeader("X-Accel-Buffering", "no");
      reply.raw.flushHeaders?.();

      const abortController = new AbortController();
      let completed = false;
      let clientClosed = false;

      reply.raw.on("close", () => {
        if (!completed) {
          clientClosed = true;
          abortController.abort();
        }
      });

      try {
        for await (const chunk of temporaryConversationService.stream({
          accountId: getRequestAuthContext(request).accountId,
          conversationId: parsedParams.data.id,
          inputMessage: parsedBody.data.input_message
            ? {
                role: parsedBody.data.input_message.role,
                content: parsedBody.data.input_message.content,
              }
            : undefined,
          abortSignal: abortController.signal,
        })) {
          if (clientClosed || reply.raw.destroyed || reply.raw.writableEnded) {
            completed = true;
            return;
          }

          if (chunk.type === "start") {
            writeSse(reply.raw, "start", {
              floor_id: chunk.floorId,
              floor_no: chunk.floorNo,
              branch_id: chunk.branchId,
            });
            continue;
          }

          if (chunk.type === "delta") {
            writeSse(reply.raw, "chunk", { chunk: chunk.text });
            continue;
          }

          if (chunk.type === "tool") {
            writeSse(reply.raw, "tool", {
              execution_id: chunk.event.executionId,
              tool_name: chunk.event.toolName,
              provider_id: chunk.event.providerId,
              provider_type: chunk.event.providerType ?? null,
              side_effect_level: chunk.event.sideEffectLevel ?? null,
              phase: chunk.event.phase,
              message: chunk.event.message ?? null,
              duration_ms: chunk.event.durationMs ?? null,
              replay_safety: chunk.event.replaySafety,
            });
            continue;
          }

          if (chunk.type === "run") {
            writeSse(reply.raw, "run", mapRunToSnakeCase(chunk.event));
            continue;
          }

          writeSse(reply.raw, "done", {
            conversation_id: chunk.result.conversationId,
            branch_id: chunk.result.branchId,
            floor_id: chunk.result.floorId,
            floor_no: chunk.result.floorNo,
            page_id: chunk.result.pageId,
            generated_text: chunk.result.text,
            summaries: [],
            total_usage: chunk.result.usage ? mapUsageToSnakeCase(chunk.result.usage) : mapUsageToSnakeCase({
              promptTokens: 0,
              completionTokens: 0,
              totalTokens: 0,
            }),
            final_state: chunk.result.finalState ?? chunk.result.finishReason ?? null,
          });
          appendOperationLog(
            request,
            detail,
            "temporary_conversation.responded",
            "temporary_conversation",
            detail.id,
            {
              route: "POST /temporary-conversations/:id/respond",
              response_mode: "sse",
              output_page_id: chunk.result.pageId,
            },
            {
              floorId: chunk.result.floorId,
              branchId: chunk.result.branchId,
            },
          );
          completed = true;
          reply.raw.end();
          return;
        }
      } catch (error) {
        if (clientClosed || abortController.signal.aborted || reply.raw.destroyed || reply.raw.writableEnded) {
          completed = true;
          return;
        }
        const mapped = mapTemporaryConversationRouteError(error);
        writeSse(reply.raw, "error", { code: mapped.code, message: mapped.message });
        completed = true;
        reply.raw.end();
      }
      return;
    }

    try {
      const result = await temporaryConversationService.respond({
        accountId: getRequestAuthContext(request).accountId,
        conversationId: parsedParams.data.id,
        inputMessage: parsedBody.data.input_message
          ? {
              role: parsedBody.data.input_message.role,
              content: parsedBody.data.input_message.content,
            }
          : undefined,
      });
      appendOperationLog(
        request,
        detail,
        "temporary_conversation.responded",
        "temporary_conversation",
        detail.id,
        {
          route: "POST /temporary-conversations/:id/respond",
          response_mode: "json",
          output_page_id: result.pageId,
        },
        {
          floorId: result.floorId,
          branchId: result.branchId,
        },
      );
      return reply.code(200).send({
        data: {
          conversation_id: result.conversationId,
          branch_id: result.branchId,
          floor_id: result.floorId,
          floor_no: result.floorNo,
          page_id: result.pageId,
          generated_text: result.text,
          total_usage: result.usage
            ? mapUsageToSnakeCase(result.usage)
            : mapUsageToSnakeCase({ promptTokens: 0, completionTokens: 0, totalTokens: 0 }),
          final_state: result.finalState ?? result.finishReason ?? null,
        },
      });
    } catch (error) {
      if (handleTemporaryConversationRouteError(reply, error)) {
        return;
      }
      throw error;
    }
  });

  app.get("/temporary-conversations/:id/transcript", {
    schema: {
      tags: ["temporary-conversations"],
      summary: "Read a temporary conversation transcript",
      params: idParamsJsonSchema,
      response: {
        200: temporaryConversationTranscriptResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(idParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;
    if (!authorizeConversationAction(reply, request, parsedParams.data.id, "project.read")) {
      return;
    }
    const detail = await loadPublicConversationDetail(reply, getRequestAuthContext(request).accountId, parsedParams.data.id);
    if (!detail) {
      return;
    }

    try {
      const transcript = await temporaryConversationService.readTranscript({
        accountId: getRequestAuthContext(request).accountId,
        conversationId: parsedParams.data.id,
      });
      return reply.code(200).send({
        data: toTemporaryConversationTranscriptResponse(transcript),
      });
    } catch (error) {
      if (handleTemporaryConversationRouteError(reply, error)) {
        return;
      }
      throw error;
    }
  });

  app.post("/temporary-conversations/:id/finalize", {
    schema: {
      tags: ["temporary-conversations"],
      summary: "Finalize a temporary conversation",
      params: idParamsJsonSchema,
      response: {
        200: temporaryConversationResourceResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(idParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;
    if (!authorizeConversationAction(reply, request, parsedParams.data.id, "project.write")) {
      return;
    }
    const detail = await loadPublicConversationDetail(reply, getRequestAuthContext(request).accountId, parsedParams.data.id);
    if (!detail) {
      return;
    }

    try {
      const finalized = await temporaryConversationService.finalize({
        accountId: getRequestAuthContext(request).accountId,
        conversationId: parsedParams.data.id,
      });
      appendOperationLog(
        request,
        finalized,
        "temporary_conversation.finalized",
        "temporary_conversation",
        finalized.id,
        { route: "POST /temporary-conversations/:id/finalize" },
      );
      return reply.code(200).send({ data: toTemporaryConversationResourceResponse(finalized) });
    } catch (error) {
      if (handleTemporaryConversationRouteError(reply, error)) {
        return;
      }
      throw error;
    }
  });

  app.post("/temporary-conversations/:id/discard", {
    schema: {
      tags: ["temporary-conversations"],
      summary: "Discard a temporary conversation",
      params: idParamsJsonSchema,
      response: {
        200: temporaryConversationResourceResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(idParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;
    if (!authorizeConversationAction(reply, request, parsedParams.data.id, "project.write")) {
      return;
    }
    const detail = await loadPublicConversationDetail(reply, getRequestAuthContext(request).accountId, parsedParams.data.id);
    if (!detail) {
      return;
    }

    try {
      const discarded = await temporaryConversationService.discard({
        accountId: getRequestAuthContext(request).accountId,
        conversationId: parsedParams.data.id,
      });
      appendOperationLog(
        request,
        discarded,
        "temporary_conversation.discarded",
        "temporary_conversation",
        discarded.id,
        { route: "POST /temporary-conversations/:id/discard" },
      );
      return reply.code(200).send({ data: toTemporaryConversationResourceResponse(discarded) });
    } catch (error) {
      if (handleTemporaryConversationRouteError(reply, error)) {
        return;
      }
      throw error;
    }
  });

  app.post("/temporary-conversations/:id/cancel", {
    schema: {
      tags: ["temporary-conversations"],
      summary: "Cancel a temporary conversation",
      params: idParamsJsonSchema,
      response: {
        200: temporaryConversationResourceResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(idParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;
    if (!authorizeConversationAction(reply, request, parsedParams.data.id, "project.write")) {
      return;
    }
    const detail = await loadPublicConversationDetail(reply, getRequestAuthContext(request).accountId, parsedParams.data.id);
    if (!detail) {
      return;
    }

    try {
      const cancelled = await temporaryConversationService.cancel({
        accountId: getRequestAuthContext(request).accountId,
        conversationId: parsedParams.data.id,
      });
      appendOperationLog(
        request,
        cancelled,
        "temporary_conversation.cancelled",
        "temporary_conversation",
        cancelled.id,
        { route: "POST /temporary-conversations/:id/cancel" },
      );
      return reply.code(200).send({ data: toTemporaryConversationResourceResponse(cancelled) });
    } catch (error) {
      if (handleTemporaryConversationRouteError(reply, error)) {
        return;
      }
      throw error;
    }
  });

  app.post("/temporary-conversations/:id/export", {
    schema: {
      tags: ["temporary-conversations"],
      summary: "Export a temporary conversation result to a staged page write",
      params: idParamsJsonSchema,
      body: exportBodyJsonSchema,
      response: {
        200: temporaryConversationExportResponseJsonSchema,
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(idParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;
    if (!authorizeConversationAction(reply, request, parsedParams.data.id, "project.write")) {
      return;
    }
    const detail = await loadPublicConversationDetail(reply, getRequestAuthContext(request).accountId, parsedParams.data.id);
    if (!detail) {
      return;
    }
    const parsedBody = parseWithSchema(exportBodySchema, request.body, reply);
    if (!parsedBody.ok) return;
    if (!authorizeTargetPageExport(reply, request, parsedBody.data.target_page_id)) {
      return;
    }

    try {
      const exported = await temporaryConversationService.exportResult({
        accountId: getRequestAuthContext(request).accountId,
        conversationId: parsedParams.data.id,
        target: parsedBody.data.target,
        targetPageId: parsedBody.data.target_page_id,
        sourceOutputPageId: parsedBody.data.source_output_page_id,
        reason: parsedBody.data.reason,
      });
      appendTemporaryConversationExportLog(operationLogService, request, detail, exported);
      return reply.code(200).send({ data: toTemporaryConversationExportResponse(exported) });
    } catch (error) {
      if (handleTemporaryConversationRouteError(reply, error)) {
        return;
      }
      throw error;
    }
  });
}

function acceptsEventStream(request: FastifyRequest): boolean {
  const accept = request.headers.accept;
  const values = typeof accept === "string"
    ? [accept]
    : Array.isArray(accept)
      ? accept
      : [];
  return values.some((value) => value.includes("text/event-stream"));
}

function appendTemporaryConversationExportLog(
  operationLogService: OperationLogService,
  request: FastifyRequest,
  detail: TemporaryConversationResource,
  exported: TemporaryConversationExportResult,
): void {
  const auth = getRequestAuthContext(request);
  const actor = operationActorFromRequest(request);
  operationLogService.append({
    ...actor,
    accountId: auth.accountId,
    actorAccountId: auth.actorAccountId,
    actorClientId: auth.actorClientId,
    requestId: operationRequestIdFromRequest(request),
    sourceType: "api",
    action: "temporary_conversation.exported",
    status: "succeeded",
    sessionId: detail.id,
    branchId: TEMPORARY_CONVERSATION_BRANCH_ID,
    workspaceId: detail.workspaceId,
    projectId: detail.projectId,
    targetType: "page_staged_write",
    targetId: exported.stagedWriteId,
    metadata: {
      route: "POST /temporary-conversations/:id/export",
      export_target: exported.target,
      source_page_id: exported.sourcePageId,
      target_page_id: exported.targetPageId,
    },
  });
}

function handleTemporaryConversationRouteError(reply: FastifyReply, error: unknown): boolean {
  if (error instanceof TemporaryConversationError) {
    const mapped = mapTemporaryConversationRouteError(error);
    sendError(reply, mapped.statusCode, mapped.code, mapped.message);
    return true;
  }

  if (error instanceof ProjectAccessServiceError) {
    if (error.code === "project_access_denied" && error.denyReason === "not_a_member") {
      sendError(reply, 404, "conversation_not_found", "Temporary conversation not found");
      return true;
    }
    sendError(reply, error.statusCode, error.code, error.message);
    return true;
  }

  return false;
}

function mapTemporaryConversationRouteError(error: unknown): {
  statusCode: number;
  code: string;
  message: string;
} {
  if (!(error instanceof TemporaryConversationError)) {
    return {
      statusCode: 500,
      code: "internal_error",
      message: error instanceof Error ? error.message : "Unexpected server error",
    };
  }

  switch (error.code) {
    case "source_session_not_found":
    case "source_project_not_found":
    case "conversation_not_found":
    case "source_output_page_not_found":
    case "target_page_not_found":
      return { statusCode: 404, code: error.code, message: error.message };
    case "invalid_kind":
    case "unsupported_branch":
    case "invalid_message_role":
    case "empty_message_content":
    case "invalid_retention_policy":
    case "invalid_ttl_seconds":
    case "invalid_visibility":
    case "unsupported_export_target":
    case "invalid_source_output_page":
      return { statusCode: 400, code: error.code, message: error.message };
    case "ttl_required":
      return { statusCode: 400, code: error.code, message: error.message };
    case "conversation_not_active":
    case "conversation_busy":
    case "no_pending_input":
    case "missing_effective_user_tail":
      return { statusCode: 409, code: error.code, message: error.message };
    default:
      return { statusCode: 500, code: "internal_error", message: error.message };
  }
}

function toTemporaryConversationResourceResponse(detail: TemporaryConversationResource) {
  return {
    id: detail.id,
    workspace_id: detail.workspaceId,
    project_id: detail.projectId,
    source_session_id: detail.sourceSessionId,
    branch_id: detail.branchId,
    kind: detail.kind,
    title: detail.title,
    purpose: detail.purpose,
    status: detail.status,
    retention_policy: detail.retentionPolicy,
    visibility: detail.visibility,
    created_at: detail.createdAt,
    updated_at: detail.updatedAt,
    last_activity_at: detail.lastActivityAt,
    expires_at: detail.expiresAt,
    finalized_at: detail.finalizedAt,
    discarded_at: detail.discardedAt,
    cancelled_at: detail.cancelledAt,
  };
}

function toTemporaryConversationTranscriptResponse(transcript: TemporaryConversationTranscript) {
  return {
    conversation_id: transcript.conversationId,
    branch_id: transcript.branchId,
    floors: transcript.floors.map((floor) => ({
      id: floor.id,
      floor_no: floor.floorNo,
      branch_id: floor.branchId,
      parent_floor_id: floor.parentFloorId,
      state: floor.state,
      token_in: floor.tokenIn,
      token_out: floor.tokenOut,
      created_at: floor.createdAt,
      updated_at: floor.updatedAt,
      pages: floor.pages.map((page) => ({
        id: page.id,
        page_no: page.pageNo,
        page_kind: page.pageKind,
        is_active: page.isActive,
        version: page.version,
        checksum: page.checksum,
        created_at: page.createdAt,
        updated_at: page.updatedAt,
        messages: page.messages.map((message) => ({
          id: message.id,
          seq: message.seq,
          role: message.role,
          content: message.content,
          content_format: message.contentFormat,
          is_hidden: message.isHidden,
          source: message.source,
          created_at: message.createdAt,
        })),
      })),
    })),
  };
}

function toTemporaryConversationExportResponse(exported: TemporaryConversationExportResult) {
  return {
    conversation_id: exported.conversationId,
    target: exported.target,
    staged_write_id: exported.stagedWriteId,
    target_page_id: exported.targetPageId,
    source_page_id: exported.sourcePageId,
    created_at: exported.createdAt,
    status: exported.status,
  };
}
