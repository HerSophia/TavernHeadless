import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import type { DatabaseConnection } from "../db/client.js";
import { errorResponseJsonSchema } from "./schemas/common.js";
import { ensureOptionalObjectBody, parseWithSchema, sendError } from "../lib/http.js";
import { getRequestAuthContext } from "../plugins/auth.js";
import type { GenerationParamsInput } from "../lib/llm-params.js";
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
import type { GraphAssistantPendingToolCallRecord } from "../services/graph-assistant-tool-confirmation-service.js";
import type { RetryStepIrreversibleSideEffect } from "../services/chat/contracts.js";
import {
  TEMPORARY_CONVERSATION_BRANCH_ID,
  type TemporaryConversationAgentOrigin,
  type TemporaryConversationExportResult,
  type TemporaryConversationInspect,
  type TemporaryConversationInspectTranscriptFloor,
  type TemporaryConversationResource,
  type TemporaryConversationResult,
  type TemporaryConversationStreamChunk,
  type TemporaryConversationTranscript,
} from "../services/temporary-conversation-types.js";
import { GOVERNANCE_OPERATION_ACTIONS } from "../services/governance/operation-log-names.js";
import { mapRunToSnakeCase, mapUsageToSnakeCase } from "./chat/presenters.js";
import { writeSse } from "./chat/sse-writer.js";

const idParamsSchema = z.object({
  id: z.string().min(1),
});

const pendingToolCallParamsSchema = z.object({
  id: z.string().min(1),
  confirmationId: z.string().min(1),
});

const resolvePendingToolCallBodySchema = z.object({
  decision: z.enum(["approve", "reject"]),
}).strict();

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
 dynamic_context: z.string().max(200000).optional(),
  generation_params: z.object({
    reasoning_effort: z.string().min(1).max(64).optional(),
    temperature: z.number().min(0).max(2).optional(),
    top_p: z.number().min(0).max(1).optional(),
    max_output_tokens: z.number().int().min(1).optional(),
    max_context_tokens: z.number().int().min(1).optional(),
  }).strict().optional(),
  tool_transport_preference: z.enum(["auto", "native", "text_protocol"]).optional(),
}).strict();

const retryBodySchema = z.object({
  floor_id: z.string().min(1),
  dynamic_context: z.string().max(200000).optional(),
  generation_params: z.object({
    reasoning_effort: z.string().min(1).max(64).optional(),
    temperature: z.number().min(0).max(2).optional(),
    top_p: z.number().min(0).max(1).optional(),
    max_output_tokens: z.number().int().min(1).optional(),
    max_context_tokens: z.number().int().min(1).optional(),
  }).strict().optional(),
  confirmed_execution_ids: z.array(z.string().min(1)).optional(),
  confirmed_session_state_mutation_ids: z.array(z.string().min(1)).optional(),
}).strict();

const retryStepBodySchema = retryBodySchema.extend({
  from_step_index: z.number().int().min(1),
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
    dynamic_context: { type: "string", maxLength: 200000 },
    generation_params: {
      type: "object",
      properties: {
        reasoning_effort: {type: "string", minLength: 1, maxLength: 64 },
        temperature: { type: "number", minimum: 0, maximum: 2 },
        top_p: { type: "number", minimum: 0, maximum: 1 },
        max_output_tokens: { type: "integer", minimum: 1 },
        max_context_tokens: { type: "integer", minimum: 1 },
      },
      additionalProperties: false,
    },
    tool_transport_preference: { type: "string", enum: ["auto", "native", "text_protocol"] },
  },
  additionalProperties: false,
} as const;

const retryGenerationParamsJsonSchema = {
  type: "object",
  properties: {
    reasoning_effort: { type: "string", minLength: 1, maxLength: 64 },
    temperature: { type: "number", minimum: 0, maximum: 2 },
    top_p: { type: "number", minimum: 0, maximum: 1 },
    max_output_tokens: { type: "integer", minimum: 1 },
    max_context_tokens: { type: "integer", minimum: 1 },
  },
  additionalProperties: false,
} as const;

const retryBodyJsonSchema = {
  type: "object",
  required: ["floor_id"],
  properties: {
    floor_id: { type: "string", minLength: 1 },
    dynamic_context: { type: "string", maxLength: 200000 },
    generation_params: retryGenerationParamsJsonSchema,
    confirmed_execution_ids: { type: "array", items: { type: "string", minLength: 1 } },
    confirmed_session_state_mutation_ids: { type: "array", items: { type: "string", minLength: 1 } },
  },
  additionalProperties: false,
} as const;

const retryStepBodyJsonSchema = {
  type: "object",
  required: ["floor_id", "from_step_index"],
  properties: {
    floor_id: { type: "string", minLength: 1 },
    from_step_index: { type: "integer", minimum: 1 },
    dynamic_context: { type: "string", maxLength: 200000 },
    generation_params: retryGenerationParamsJsonSchema,
    confirmed_execution_ids: { type: "array", items: { type: "string", minLength: 1} },
    confirmed_session_state_mutation_ids: { type: "array", items: { type: "string", minLength: 1 } },
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

const temporaryConversationRetryResponseJsonSchema = temporaryConversationRespondResponseJsonSchema;

const temporaryConversationIrreversibleSideEffectJsonSchema = {
  type: "object",
  required: ["execution_id","tool_name", "side_effect_level", "started_at"],
  properties: {
    execution_id: { type: "string" },
    tool_name: { type: "string" },
    side_effect_level: { type: "string" },
    started_at: { type: "integer", minimum: 0 },
    generation_step_no: {anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }] },
  },
  additionalProperties: false,
} as const;

const temporaryConversationRetryStepResponseJsonSchema = {
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
        "discarded_from_step_index",
        "irreversible_side_effects",
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
        discarded_from_step_index: { type: "integer", minimum: 1 },
        irreversible_side_effects: {
        type: "array",
          items: temporaryConversationIrreversibleSideEffectJsonSchema,
        },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
}as const;

const temporaryConversationTranscriptResponseJsonSchema= {
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

const inspectQueryStringSchema = z.object({
  include_agent_private: z.enum(["true", "false", "1", "0"]).optional(),
}).strict();

const inspectQueryStringJsonSchema = {
  type: "object",
  properties: {
    include_agent_private: { type: "string", enum: ["true", "false", "1", "0"] },
  },
  additionalProperties: false,
} as const;

const temporaryConversationInspectResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: [
        "conversation",
        "agent_private",
        "transcript_restricted",
        "source_snapshot",
        "agent_origin",
        "cleanup",
        "transcript",
        "exports",
      ],
      properties: {
        conversation: temporaryConversationResourceJsonSchema,
        agent_private: { type: "boolean" },
        transcript_restricted: { type: "boolean" },
        source_snapshot: {
          type: "object",
          required: ["digest", "source_session_id"],
          properties: {
            digest: { anyOf: [{ type: "string" }, { type: "null" }] },
            source_session_id: { anyOf: [{ type: "string" }, { type: "null" }] },
          },
          additionalProperties: false,
        },
        agent_origin: {
          anyOf: [
            { type: "object", additionalProperties: true },
            { type: "null" },
          ],
        },
        cleanup: {
          type: "object",
          required: ["cleaned", "cleaned_at", "retention_policy"],
          properties: {
            cleaned: { type: "boolean" },
            cleaned_at: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
            retention_policy: { type: "string", enum: ["delete_on_finalize", "ttl", "keep_for_debug"] },
          },
          additionalProperties: false,
        },
        transcript: {
          type: "object",
          required: ["conversation_id", "branch_id", "floors"],
          properties: {
            conversation_id: { type: "string" },
            branch_id: { type: "string" },
            floors: { type: "array", items: { type: "object", additionalProperties: true } },
          },
          additionalProperties: true,
        },
        exports: {
          type: "array",
          items: {
            type: "object",
            required: [
              "staged_write_id",
              "delivery_target",
              "target_session_id",
              "target_page_id",
              "source_page_id",
              "status",
              "reason",
              "created_at",
              "updated_at",
              "applied_at",
              "discarded_at",
            ],
            properties: {
              staged_write_id: { type: "string" },
              delivery_target: { type: "string", enum: ["page_staged_write"] },
              target_session_id: { type: "string" },
              target_page_id: { type: "string" },
              source_page_id: { anyOf: [{ type: "string" }, { type: "null" }] },
              status: { type: "string", enum: ["staged", "accepted", "applied", "discarded"] },
              reason: { anyOf: [{ type: "string" }, { type: "null" }] },
              created_at: { type: "integer", minimum: 0 },
              updated_at: { type: "integer", minimum: 0 },
              applied_at: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
              discarded_at: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
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

  function canViewAgentPrivateContent(
    request: FastifyRequest,
    conversationId: string,
  ): boolean {
    try {
      projectAccessService.requireProjectActionBySessionIdForActor(
        toActorInput(request),
        conversationId,
        "project.write",
      );
      return true;
    } catch (error) {
      if (error instanceof ProjectAccessServiceError) {
        // Single-account deployments have no Project scope; the caller is the trusted owner.
        if (error.code === "session_project_scope_missing") {
          return true;
        }
        return false;
      }
      throw error;
    }
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
          dynamicContext: parsedBody.data.dynamic_context,
          ...buildTemporaryConversationGenerationParams(parsedBody.data.generation_params),
          ...(parsedBody.data.tool_transport_preference
            ? { toolTransportPreference: parsedBody.data.tool_transport_preference }
            : {}),
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
            writeSse(reply.raw, "chunk",{ chunk: chunk.text });
            continue;
          }

          if (chunk.type === "reasoning") {
            writeSse(reply.raw, "reasoning", { delta: chunk.text });
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
              ...(chunk.event.callId ? { call_id: chunk.event.callId } : {}),
              ...(chunk.event.args ? { args: chunk.event.args } : {}),
            });
            continue;
          }

          if (chunk.type === "narration") {
            writeSse(reply.raw, "step_narration", {
              step_index: chunk.stepIndex,
              text: chunk.text,
              created_at: chunk.createdAt,
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
     dynamicContext: parsedBody.data.dynamic_context,
        ...buildTemporaryConversationGenerationParams(parsedBody.data.generation_params),
        ...(parsedBody.data.tool_transport_preference
          ?{ toolTransportPreference: parsedBody.data.tool_transport_preference }
          : {}),
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

  // 图助手 floor 级 / step 级重试（开新消息页：目标已提交楼层上新 output page version）。
  // 与 respond 一致，同时支持 JSON 与 SSE。
  app.post("/temporary-conversations/:id/retry", {
    schema: {
      tags: ["temporary-conversations"],
      summary: "Retry a floor inside a temporary conversation",
      params: idParamsJsonSchema,
      body: retryBodyJsonSchema,
      response: {
        200: temporaryConversationRetryResponseJsonSchema,
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
    if (!detail) return;

    const parsedBody = parseWithSchema(retryBodySchema, request.body, reply);
    if (!parsedBody.ok) return;

    const accountId = getRequestAuthContext(request).accountId;
    const baseInput = {
      accountId,
      conversationId: parsedParams.data.id,
      floorId: parsedBody.data.floor_id,
      ...(parsedBody.data.dynamic_context !== undefined ? { dynamicContext: parsedBody.data.dynamic_context } : {}),
      ...buildTemporaryConversationGenerationParams(parsedBody.data.generation_params),
      ...(parsedBody.data.confirmed_execution_ids ? { confirmedExecutionIds: parsedBody.data.confirmed_execution_ids } : {}),
      ...(parsedBody.data.confirmed_session_state_mutation_ids
        ? { confirmedSessionStateMutationIds: parsedBody.data.confirmed_session_state_mutation_ids }
        : {}),
    };

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
        for await (const chunk of temporaryConversationService.retryStream({
          ...baseInput,
          abortSignal: abortController.signal,
        })) {
          if (clientClosed || reply.raw.destroyed || reply.raw.writableEnded) {
            completed = true;
            return;
          }
          if (writeTemporaryConversationNonResultChunk(reply.raw, chunk)) {
            continue;
          }
          writeSse(reply.raw, "done", mapTemporaryConversationRetryResult(chunk.result));
          appendOperationLog(
            request,
            detail,
            "temporary_conversation.responded",
            "temporary_conversation",
            detail.id,
            { route: "POST /temporary-conversations/:id/retry", response_mode: "sse", output_page_id: chunk.result.pageId },
            { floorId: chunk.result.floorId, branchId: chunk.result.branchId },
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
      const result = await temporaryConversationService.retryFloor(baseInput);
      appendOperationLog(
        request,
        detail,
        "temporary_conversation.responded",
        "temporary_conversation",
        detail.id,
        { route: "POST /temporary-conversations/:id/retry", response_mode: "json", output_page_id: result.pageId },
        { floorId: result.floorId, branchId: result.branchId },
      );
      return reply.code(200).send({ data: mapTemporaryConversationRetryResult(result) });
    } catch (error) {
      if (handleTemporaryConversationRouteError(reply, error)) {
        return;
      }
      throw error;
    }
  });

  app.post("/temporary-conversations/:id/retry-step", {
    schema: {
      tags: ["temporary-conversations"],
      summary: "Retry from a step inside a temporary conversation",
      params: idParamsJsonSchema,
      body: retryStepBodyJsonSchema,
      response: {
        200: temporaryConversationRetryStepResponseJsonSchema,
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
    if (!detail) return;

    const parsedBody = parseWithSchema(retryStepBodySchema, request.body, reply);
    if (!parsedBody.ok) return;

    const accountId = getRequestAuthContext(request).accountId;
    const baseInput = {
      accountId,
      conversationId: parsedParams.data.id,
      floorId: parsedBody.data.floor_id,
      fromStepIndex: parsedBody.data.from_step_index,
      ...(parsedBody.data.dynamic_context !== undefined ? { dynamicContext: parsedBody.data.dynamic_context } : {}),
      ...buildTemporaryConversationGenerationParams(parsedBody.data.generation_params),
      ...(parsedBody.data.confirmed_execution_ids ? { confirmedExecutionIds: parsedBody.data.confirmed_execution_ids } : {}),
      ...(parsedBody.data.confirmed_session_state_mutation_ids
        ? { confirmedSessionStateMutationIds: parsedBody.data.confirmed_session_state_mutation_ids }
        : {}),
    };

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
        for await (const chunk of temporaryConversationService.retryStepStream({
          ...baseInput,
          abortSignal: abortController.signal,
        })) {
          if (clientClosed || reply.raw.destroyed || reply.raw.writableEnded) {
            completed = true;
            return;
          }
          if (writeTemporaryConversationNonResultChunk(reply.raw, chunk)) {
            continue;
          }
          writeSse(reply.raw, "done", mapTemporaryConversationRetryResult(chunk.result));
          appendOperationLog(
            request,
            detail,
            "temporary_conversation.responded",
            "temporary_conversation",
            detail.id,
            { route: "POST /temporary-conversations/:id/retry-step", response_mode: "sse", output_page_id: chunk.result.pageId },
            { floorId: chunk.result.floorId, branchId: chunk.result.branchId },
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
      const result = await temporaryConversationService.retryStep(baseInput);
      appendOperationLog(
        request,
        detail,
        "temporary_conversation.responded",
        "temporary_conversation",
        detail.id,
        { route: "POST /temporary-conversations/:id/retry-step", response_mode: "json", output_page_id: result.pageId },
        { floorId: result.floorId, branchId: result.branchId },
      );
        return reply.code(200).send({ data: mapTemporaryConversationRetryResult(result) });
    } catch (error) {
      if (handleTemporaryConversationRouteError(reply, error)) {
        return;
      }
      throw error;
    }
  });

  // 图助手「执行前确认闸」恢复接口（阶段 3）。
  // 这两个路由属于 NodeGraph 周边第一方接入面，不进入 OpenAPI / @tavern/sdk 生成面；
  // studio 经第一方薄客户端直连。读用 project.nodegraph.read，写用 project.nodegraph.write。
  app.get("/temporary-conversations/:id/pending-tool-calls", async (request, reply) => {
    const parsedParams = parseWithSchema(idParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;
    if (!authorizeConversationAction(reply, request, parsedParams.data.id, "project.nodegraph.read")) {
      return;
    }
    try {
      const items = await temporaryConversationService.listPendingToolCalls({
        accountId: getRequestAuthContext(request).accountId,
        conversationId: parsedParams.data.id,
      });
      return reply.code(200).send({ items: items.map(toPendingToolCallResponse) });
    } catch (error) {
      if (handleTemporaryConversationRouteError(reply, error)) {
        return;
      }
      throw error;
    }
  });

  app.post("/temporary-conversations/:id/pending-tool-calls/:confirmationId", async (request, reply) => {
    const parsedParams = parseWithSchema(pendingToolCallParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;
    if (!authorizeConversationAction(reply, request, parsedParams.data.id, "project.nodegraph.write")) {
      return;
    }
    ensureOptionalObjectBody(request);
    const parsedBody = parseWithSchema(resolvePendingToolCallBodySchema, request.body, reply);
    if (!parsedBody.ok) return;

    try {
      const resolved = await temporaryConversationService.resolveToolConfirmation({
        accountId: getRequestAuthContext(request).accountId,
        conversationId: parsedParams.data.id,
        confirmationId: parsedParams.data.confirmationId,
        decision: parsedBody.data.decision,
      });
      if (resolved.decision === "rejected") {
        return reply.code(200).send({
          data: {
            decision: "rejected",
            pending_tool_call: toPendingToolCallResponse(resolved.pending),
          },
        });
      }
        return reply.code(200).send({
        data: {
          decision: "approved",
          pending_tool_call: toPendingToolCallResponse(resolved.pending),
          result: {
            conversation_id: resolved.result.conversationId,
            branch_id: resolved.result.branchId,
            floor_id: resolved.result.floorId,
            floor_no: resolved.result.floorNo,
            page_id: resolved.result.pageId,
            generated_text: resolved.result.text,
            total_usage: resolved.result.usage
              ? mapUsageToSnakeCase(resolved.result.usage)
              : mapUsageToSnakeCase({ promptTokens: 0, completionTokens: 0, totalTokens: 0 }),
            final_state: resolved.result.finalState ?? resolved.result.finishReason ?? null,
          },
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

  app.get("/temporary-conversations/:id/inspect", {
    schema: {
      tags: ["temporary-conversations"],
      summary: "Inspect a temporary conversation for debug and audit",
      params: idParamsJsonSchema,
      querystring: inspectQueryStringJsonSchema,
      response: {
        200: temporaryConversationInspectResponseJsonSchema,
        404: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(idParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;
    if (!authorizeConversationAction(reply, request, parsedParams.data.id, "project.read")) {
      return;
    }
    const parsedQuery = parseWithSchema(inspectQueryStringSchema, request.query ?? {}, reply);
    if (!parsedQuery.ok) return;

    const requestedAgentPrivate = parseBooleanFlag(parsedQuery.data.include_agent_private);
    const includeAgentPrivateContent = requestedAgentPrivate
      && canViewAgentPrivateContent(request, parsedParams.data.id);

    try {
      const inspect = await temporaryConversationService.inspect({
        accountId: getRequestAuthContext(request).accountId,
        conversationId: parsedParams.data.id,
        includeAgentPrivateContent,
      });

      if (inspect.agentPrivate && includeAgentPrivateContent) {
        appendOperationLog(
          request,
          inspect.conversation,
          GOVERNANCE_OPERATION_ACTIONS.temporaryConversation.inspectTranscript,
          "temporary_conversation",
          inspect.conversation.id,
          {
            route: "GET /temporary-conversations/:id/inspect",
            include_agent_private: true,
            export_count: inspect.exports.length,
            cleaned: inspect.cleanup.cleaned,
          },
        );
      }

      return reply.code(200).send({ data: toTemporaryConversationInspectResponse(inspect) });
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

/**
 * 把临时对话流式非-result chunk 写为 SSE 事件。result chunk 返回 false，交调用方收尾。
 */
function writeTemporaryConversationNonResultChunk(
  raw: Parameters<typeof writeSse>[0],
  chunk: TemporaryConversationStreamChunk,
): chunk is Exclude<TemporaryConversationStreamChunk, { type: "result" }> {
  switch (chunk.type) {
    case "start":
      writeSse(raw, "start", { floor_id: chunk.floorId, floor_no: chunk.floorNo, branch_id: chunk.branchId });
      return true;
    case "delta":
      writeSse(raw, "chunk", { chunk: chunk.text });
      return true;
    case "reasoning":
      writeSse(raw, "reasoning", { delta: chunk.text });
      return true;
    case "tool":
      writeSse(raw, "tool", {
        execution_id: chunk.event.executionId,
        tool_name: chunk.event.toolName,
        provider_id: chunk.event.providerId,
        provider_type: chunk.event.providerType ?? null,
        side_effect_level: chunk.event.sideEffectLevel ?? null,
        phase: chunk.event.phase,
        message: chunk.event.message ?? null,
        duration_ms: chunk.event.durationMs ?? null,
        replay_safety: chunk.event.replaySafety,
        ...(chunk.event.callId ? { call_id: chunk.event.callId } : {}),
        ...(chunk.event.args ? { args: chunk.event.args } : {}),
      });
      return true;
    case "narration":
      writeSse(raw, "step_narration", { step_index: chunk.stepIndex, text: chunk.text, created_at: chunk.createdAt });
      return true;
    case "run":
      writeSse(raw, "run", mapRunToSnakeCase(chunk.event));
      return true;
    case "result":
      return false;
  }
}

/** 不可回滚副作用映射为snake_case。 */
function mapIrreversibleSideEffectToSnake(item: RetryStepIrreversibleSideEffect) {
  return {
    execution_id: item.executionId,
    tool_name: item.toolName,
    side_effect_level: item.sideEffectLevel,
    started_at: item.startedAt,
    generation_step_no: item.generationStepNo,
  };
}

/** 重试结果映射为 done 事件 / JSON data（retry-step 额外携 discarded / irreversible 字段）。 */
function mapTemporaryConversationRetryResult(result: TemporaryConversationResult) {
  return {
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
    ...(result.discardedFromStepIndex !== undefined
      ? { discarded_from_step_index: result.discardedFromStepIndex }
      : {}),
    ...(result.irreversibleSideEffects !== undefined
      ? { irreversible_side_effects: result.irreversibleSideEffects.map(mapIrreversibleSideEffectToSnake) }
      : {}),
  };
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
    case "retry_target_not_found":
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
    case "invalid_from_step_index":
      return { statusCode: 400, code: error.code, message: error.message };
    case "pending_tool_call_not_found":
      return { statusCode: 404, code: error.code, message: error.message };
    case "pending_tool_call_not_pending":
      return { statusCode: 409, code: error.code, message: error.message };
    case "ttl_required":
      return { statusCode: 400, code: error.code, message: error.message };
    case "conversation_not_active":
    case "conversation_busy":
    case "no_pending_input":
    case "missing_effective_user_tail":
    case "step_retry_blocked_side_effect":
      return { statusCode: 409, code: error.code, message: error.message };
    default:
      return { statusCode: 500, code: "internal_error", message: error.message };
  }
}

function toPendingToolCallResponse(record: GraphAssistantPendingToolCallRecord) {
  return {
    id: record.id,
    conversation_id: record.conversationId,
    branch_id: record.branchId,
    floor_id: record.floorId,
    call_id: record.callId,
    tool_name: record.toolName,
    args: record.args,
    side_effect_level: record.sideEffectLevel,
    status: record.status,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    expires_at: record.expiresAt,
  };
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

/**
 * 将请求体的 generation_params 映射为服务层 generationParams。
 *
* 承载逐回合生成参数的可选覆盖：reasoning_effort、temperature、top_p、
 * max_output_tokens、max_context_tokens。字段名从 snake_case 映射为 camelCase。
 * 未提供任何字段时不产生 generationParams。
 */
function buildTemporaryConversationGenerationParams(
  generationParams:
    | {
        reasoning_effort?: string;
        temperature?: number;
        top_p?: number;
        max_output_tokens?: number;
        max_context_tokens?: number;
      }
    | undefined,
): { generationParams?: GenerationParamsInput } {
  if (!generationParams) {
    return {};
  }
  const mapped: GenerationParamsInput = {};
  if (generationParams.reasoning_effort !== undefined) {
    mapped.reasoningEffort = generationParams.reasoning_effort;
  }
  if (generationParams.temperature !== undefined) {
    mapped.temperature = generationParams.temperature;
  }
  if (generationParams.top_p !== undefined) {
    mapped.topP = generationParams.top_p;
  }
  if (generationParams.max_output_tokens !== undefined) {
    mapped.maxOutputTokens = generationParams.max_output_tokens;
  }
  if (generationParams.max_context_tokens !== undefined) {
    mapped.maxContextTokens = generationParams.max_context_tokens;
  }
  if (Object.keys(mapped).length === 0) {
return {};
  }
  return { generationParams: mapped };
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
      reasoning_text: floor.reasoningText,
      step_narrations: floor.stepNarrations.map((narration) => ({
        step_index: narration.stepIndex,
        text: narration.text,
        created_at: narration.createdAt,
      })),
      tool_executions: floor.toolExecutions.map((exec) => ({
        id: exec.id,
        tool_name: exec.toolName,
        status: exec.status,
        args: exec.args,
        result: exec.result,
        side_effect_level: exec.sideEffectLevel,
        commit_outcome: exec.commitOutcome,
    error_message: exec.errorMessage,
        duration_ms: exec.durationMs,
        started_at: exec.startedAt,
        finished_at: exec.finishedAt,
        attempt_no: exec.attemptNo,
        replay_parent_execution_id: exec.replayParentExecutionId,
        generation_step_no: exec.generationStepNo,
      })),
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

function parseBooleanFlag(value: "true" | "false" | "1" | "0" | undefined): boolean {
  return value === "true" || value === "1";
}

function toTemporaryConversationInspectResponse(inspect: TemporaryConversationInspect) {
  return {
    conversation: toTemporaryConversationResourceResponse(inspect.conversation),
    agent_private: inspect.agentPrivate,
    transcript_restricted: inspect.transcriptRestricted,
    source_snapshot: {
      digest: inspect.sourceSnapshot.digest,
      source_session_id: inspect.sourceSnapshot.sourceSessionId,
    },
    agent_origin: inspect.agentOrigin ? toAgentOriginResponse(inspect.agentOrigin) : null,
    cleanup: {
      cleaned: inspect.cleanup.cleaned,
      cleaned_at: inspect.cleanup.cleanedAt,
      retention_policy: inspect.cleanup.retentionPolicy,
    },
    transcript: {
      conversation_id: inspect.transcript.conversationId,
      branch_id: inspect.transcript.branchId,
      floors: inspect.transcript.floors.map(toInspectTranscriptFloorResponse),
    },
    exports: inspect.exports.map((record) => ({
      staged_write_id: record.stagedWriteId,
      delivery_target: record.deliveryTarget,
      target_session_id: record.targetSessionId,
      target_page_id: record.targetPageId,
      source_page_id: record.sourcePageId,
      status: record.status,
      reason: record.reason,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
      applied_at: record.appliedAt,
      discarded_at: record.discardedAt,
    })),
  };
}

function toAgentOriginResponse(origin: TemporaryConversationAgentOrigin): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (origin.sourceAgentRunId !== undefined) result.source_agent_run_id = origin.sourceAgentRunId;
  if (origin.parentRunId !== undefined) result.parent_run_id = origin.parentRunId;
  if (origin.rootRunId !== undefined) result.root_run_id = origin.rootRunId;
  if (origin.sourceNodeRunId !== undefined) result.source_node_run_id = origin.sourceNodeRunId;
  if (origin.sourcePageId !== undefined) result.source_page_id = origin.sourcePageId;
  if (origin.sourceFloorId !== undefined) result.source_floor_id = origin.sourceFloorId;
  if (origin.sourceSessionId !== undefined) result.source_session_id = origin.sourceSessionId;
  if (origin.sourceAttemptNo !== undefined) result.source_attempt_no = origin.sourceAttemptNo;
  return result;
}

function toInspectTranscriptFloorResponse(floor: TemporaryConversationInspectTranscriptFloor) {
  return {
    id: floor.id,
    floor_no: floor.floorNo,
    branch_id: floor.branchId,
    parent_floor_id: floor.parentFloorId,
    state: floor.state,
    token_in: floor.tokenIn,
    token_out: floor.tokenOut,
    created_at: floor.createdAt,
    updated_at: floor.updatedAt,
    reasoning_text: floor.reasoningText,
    step_narrations: floor.stepNarrations.map((narration) => ({
      step_index: narration.stepIndex,
      text: narration.text,
      created_at: narration.createdAt,
    })),
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
        content_length: message.contentLength,
        content_format: message.contentFormat,
        is_hidden: message.isHidden,
        source: message.source,
        restricted: message.restricted,
        created_at: message.createdAt,
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
