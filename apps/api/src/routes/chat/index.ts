/**
 * Chat Routes
 *
 * 业务路由：核心聊天接口。
 *
 * POST /sessions/:id/respond         — 发送消息并获取 AI 回复
 * POST /sessions/:id/respond/stream  — SSE 流式聊天
 * POST /sessions/:id/respond/dry-run — Prompt 组装调试（无副作用）
 * POST /sessions/:id/regenerate      — 重新生成最后一轮 AI 回复
 */

import type { FastifyInstance } from "fastify";

import {
  type DryRunRequest,
  type EditAndRegenerateRequest,
  type RegenerateRequest,
  type RespondRequest,
  type RespondRuntimeOptions,
  type RetryFloorRequest,
} from "../../services/chat/contracts.js";
import { ChatService } from "../../services/chat/chat-service.js";
import { ChatServiceError } from "../../services/chat/errors.js";
import { ensureOptionalObjectBody, parseWithSchema, sendError } from "../../lib/http.js";
import { getRequestAuthContext } from "../../plugins/auth.js";
import { applyCorsHeaders } from "../../plugins/cors.js";

import {
  chatMutationErrorResponses,
  dryRunBodyJsonSchema,
  dryRunBodySchema,
  dryRunSuccessResponseJsonSchema,
  editAndRegenerateBodyJsonSchema,
  editAndRegenerateBodySchema,
  editAndRegenerateSuccessResponseJsonSchema,
  floorIdParamsSchema,
  idParamsJsonSchema,
  messageIdParamsSchema,
  regenerateBodyJsonSchema,
  regenerateBodySchema,
  regenerateSuccessResponseJsonSchema,
  respondBodyJsonSchema,
  respondBodySchema,
  respondSuccessResponseJsonSchema,
  retryFloorBodyJsonSchema,
  retryFloorBodySchema,
  sessionIdParamsJsonSchema,
  sessionIdParamsSchema,
  streamResponseExample,
} from "./schemas.js";
import type { RegisterChatRoutesOptions } from "./schemas.js";
import {
  ensureTurnSessionStateWritesEnabled,
  mapDryRunDebugOptionsRequest,
  mapDryRunVisibilityRequest,
  mapGenerationParams,
  mapLiveDebugOptionsRequest,
  mapPromptBudgetRequest,
  mapPromptDeliveryRequest,
  mapPromptSourceSelectionRequest,
  mapPromptStructureRequest,
  mapTurnSessionStateWritesRequest,
} from "./mappers.js";
import {
  handleChatError,
  logNativePipelineError,
  mapChatServiceError,
  mapMemoryToSnakeCase,
  mapOptionalPromptDebugResponseFields,
  mapPromptSnapshotToSnakeCase,
  mapRunToSnakeCase,
  mapUsageToSnakeCase,
  mapWorldbookMatchDetail,
} from "./presenters.js";
import { writeSse } from "./sse-writer.js";

export async function registerChatRoutes(
  app: FastifyInstance,
  chatService: ChatService,
  options: RegisterChatRoutesOptions = {},
): Promise<void> {
  const enableSseChat = options.enableSseChat === true;
  const enablePromptDryRun = options.enablePromptDryRun === true;
  const enableClientData = options.enableClientData === true;
  const cors = options.cors ?? { origins: true, credentials: false };

  app.post("/sessions/:id/respond/dry-run", {
    schema: {
      tags: ["chat"],
      summary: "Dry-run prompt assembly",
      description: "Assemble prompt and return debug metadata without calling LLM or writing turn data.",
      params: sessionIdParamsJsonSchema,
      body: dryRunBodyJsonSchema,
      response: {
        200: dryRunSuccessResponseJsonSchema,
        400: chatMutationErrorResponses[400],
        404: chatMutationErrorResponses[404],
        409: chatMutationErrorResponses[409],
        500: chatMutationErrorResponses[500],
      },
    },
  }, async (request, reply) => {
    if (!enablePromptDryRun) {
      return sendError(reply, 404, "not_found", "Dry-run endpoint is disabled");
    }

    const parsedParams = parseWithSchema(sessionIdParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;

    const parsedBody = parseWithSchema(dryRunBodySchema, request.body, reply);
    if (!parsedBody.ok) return;

    const dryRunRequest: DryRunRequest = {
      message: parsedBody.data.message,
      promptIntent: parsedBody.data.prompt_intent,
      debugOptions: mapDryRunDebugOptionsRequest(parsedBody.data.debug_options),
      visibility: mapDryRunVisibilityRequest(parsedBody.data.visibility),
      structure: mapPromptStructureRequest(parsedBody.data.structure),
      delivery: mapPromptDeliveryRequest(parsedBody.data.delivery),
      budget: mapPromptBudgetRequest(parsedBody.data.budget),
      sourceSelection: mapPromptSourceSelectionRequest(parsedBody.data.source_selection),
    };
    const accountId = getRequestAuthContext(request).accountId;

    try {
      const result = await chatService.dryRun(parsedParams.data.id, dryRunRequest, accountId);
      return reply.code(200).send({
        data: {
          messages: result.messages,
          token_estimate: result.tokenEstimate,
          available_for_reply: result.availableForReply,
          memory_summary: result.memorySummary ?? null,
          prompt_snapshot: mapPromptSnapshotToSnakeCase(result.promptSnapshot),
          ...mapOptionalPromptDebugResponseFields({ runtimeTrace: result.runtimeTrace }),
          assembly: {
            mode: result.assembly.mode,
            prompt_intent: result.assembly.promptIntent,
            assistant_prefill_applied: result.assembly.assistantPrefillApplied,
            assistant_prefill_strategy: result.assembly.assistantPrefillStrategy,
            preset_used: result.assembly.presetUsed,
            worldbook_hits: result.assembly.worldbookHits,
            regex_pre_rules: result.assembly.regexPreRules,
            regex_post_rules: result.assembly.regexPostRules,
            memory_summary_injected: result.assembly.memorySummaryInjected,
            reserved_variable_collisions: result.assembly.reservedVariableCollisions,
            selected_prompt_order_character_id: result.assembly.selectedPromptOrderCharacterId,
            ignored_prompt_order_character_ids: result.assembly.ignoredPromptOrderCharacterIds,
            unsupported_preset_fields: result.assembly.unsupportedPresetFields,
            ignored_preset_fields: result.assembly.ignoredPresetFields,
            unresolved_preset_markers: result.assembly.unresolvedPresetMarkers,
            preset_warnings: result.assembly.presetWarnings,
            continue_nudge_applied: result.assembly.continueNudgeApplied,
            continue_nudge_text: result.assembly.continueNudgeText ?? null,
            names_behavior_applied: result.assembly.namesBehaviorApplied,
            trigger_filtered_entry_ids: result.assembly.triggerFilteredEntryIds,
            in_chat_inserted_entry_ids: result.assembly.inChatInsertedEntryIds,
            preprocessed_user_message: result.assembly.preprocessedUserMessage ?? null,
            ...(result.assembly.worldbookMatches
              ? { worldbook_matches: result.assembly.worldbookMatches.map(mapWorldbookMatchDetail) }
              : {}),
          },
        },
      });
    } catch (error) {
      return handleChatError(error, request, reply);
    }
  });

  app.post("/sessions/:id/respond/stream", {
    schema: {
      tags: ["chat"],
      summary: "Stream chat response via SSE",
      description: "Start a chat turn and stream generated chunks as Server-Sent Events.",
      params: sessionIdParamsJsonSchema,
      body: respondBodyJsonSchema,
      response: {
        200: {
          type: "string",
          description: "SSE stream payload (start/chunk/summary/done/error events).",
          examples: [streamResponseExample],
        },
        400: chatMutationErrorResponses[400],
        404: chatMutationErrorResponses[404],
      },
    },
  }, async (request, reply) => {
    if (!enableSseChat) {
      return sendError(reply, 404, "not_found", "Stream endpoint is disabled");
    }

    const parsedParams = parseWithSchema(sessionIdParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;

    const parsedBody = parseWithSchema(respondBodySchema, request.body, reply);
    if (!parsedBody.ok) return;

    if (!ensureTurnSessionStateWritesEnabled(reply, parsedBody.data.session_state_writes, enableClientData)) {
      return;
    }

    const respondRequest: RespondRequest = {
      message: parsedBody.data.message,
      config: parsedBody.data.config,
      generationParams: parsedBody.data.generation_params
        ? mapGenerationParams(parsedBody.data.generation_params)
        : undefined,
      branchId: parsedBody.data.branch_id,
      sourceFloorId: parsedBody.data.source_floor_id,
      promptIntent: parsedBody.data.prompt_intent,
      structure: mapPromptStructureRequest(parsedBody.data.structure),
      delivery: mapPromptDeliveryRequest(parsedBody.data.delivery),
      sessionStateWrites: mapTurnSessionStateWritesRequest(parsedBody.data.session_state_writes),
      debugOptions: mapLiveDebugOptionsRequest(parsedBody.data.debug_options),
    };
    const accountId = getRequestAuthContext(request).accountId;

    reply.hijack();
    reply.raw.statusCode = 200;
    applyCorsHeaders(reply.raw, request.headers.origin, cors);
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

    const runtimeOptions: RespondRuntimeOptions = {
      abortSignal: abortController.signal,
      onStart: (start) => {
        writeSse(reply.raw, "start", {
          floor_id: start.floorId,
          floor_no: start.floorNo,
          branch_id: start.branchId,
        });
      },
      onChunk: (chunk) => {
        writeSse(reply.raw, "chunk", { chunk });
      },
      onTool: (tool) => {
        writeSse(reply.raw, "tool", {
          execution_id: tool.executionId,
          tool_name: tool.toolName,
          provider_id: tool.providerId,
          provider_type: tool.providerType ?? null,
          side_effect_level: tool.sideEffectLevel ?? null,
          phase: tool.phase,
          message: tool.message ?? null,
          duration_ms: tool.durationMs ?? null,
          replay_safety: tool.replaySafety,
        });
      },
      onRun: (run) => {
        writeSse(reply.raw, "run", mapRunToSnakeCase(run));
      },
    };

    try {
      const result = await chatService.respond(parsedParams.data.id, respondRequest, runtimeOptions, accountId);

      if (clientClosed || reply.raw.destroyed || reply.raw.writableEnded) {
        completed = true;
        return;
      }

      if (result.summaries.length > 0) {
        writeSse(reply.raw, "summary", { summaries: result.summaries });
      }

      writeSse(reply.raw, "done", {
        floor_id: result.floorId,
        floor_no: result.floorNo,
        branch_id: result.branchId,
        generated_text: result.generatedText,
        summaries: result.summaries,
        total_usage: mapUsageToSnakeCase(result.totalUsage),
        memory: mapMemoryToSnakeCase(result.memory),
        final_state: result.finalState,
        ...mapOptionalPromptDebugResponseFields(result),
      });
      completed = true;
      reply.raw.end();
    } catch (error) {
      if (clientClosed || abortController.signal.aborted || reply.raw.destroyed || reply.raw.writableEnded) {
        completed = true;
        return;
      }

      logNativePipelineError(error, request, "respond_stream");
      const mapped = error instanceof ChatServiceError
        ? mapChatServiceError(error)
        : {
            statusCode: 500,
            code: "internal_error",
            message: error instanceof Error ? error.message : "Unexpected server error",
          };
      writeSse(reply.raw, "error", { code: mapped.code, message: mapped.message });
      completed = true;
      reply.raw.end();
    }
  });

  app.post("/sessions/:id/respond", {
    schema: {
      tags: ["chat"],
      summary: "Respond in a session",
      description: "Append user input and generate assistant response for the session.",
      params: sessionIdParamsJsonSchema,
      body: respondBodyJsonSchema,
      response: {
        200: respondSuccessResponseJsonSchema,
        ...chatMutationErrorResponses,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(sessionIdParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;

    const parsedBody = parseWithSchema(respondBodySchema, request.body, reply);
    if (!parsedBody.ok) return;

    if (!ensureTurnSessionStateWritesEnabled(reply, parsedBody.data.session_state_writes, enableClientData)) {
      return;
    }

    const respondRequest: RespondRequest = {
      message: parsedBody.data.message,
      config: parsedBody.data.config,
      generationParams: parsedBody.data.generation_params
        ? mapGenerationParams(parsedBody.data.generation_params)
        : undefined,
      branchId: parsedBody.data.branch_id,
      sourceFloorId: parsedBody.data.source_floor_id,
      promptIntent: parsedBody.data.prompt_intent,
      structure: mapPromptStructureRequest(parsedBody.data.structure),
      delivery: mapPromptDeliveryRequest(parsedBody.data.delivery),
      sessionStateWrites: mapTurnSessionStateWritesRequest(parsedBody.data.session_state_writes),
      debugOptions: mapLiveDebugOptionsRequest(parsedBody.data.debug_options),
    };
    const accountId = getRequestAuthContext(request).accountId;

    try {
      const result = await chatService.respond(parsedParams.data.id, respondRequest, {}, accountId);
      return reply.code(200).send({
        data: {
          floor_id: result.floorId,
          floor_no: result.floorNo,
          branch_id: result.branchId,
          generated_text: result.generatedText,
          summaries: result.summaries,
          total_usage: mapUsageToSnakeCase(result.totalUsage),
          memory: mapMemoryToSnakeCase(result.memory),
          final_state: result.finalState,
          ...mapOptionalPromptDebugResponseFields(result),
        },
      });
    } catch (error) {
      return handleChatError(error, request, reply);
    }
  });

  app.post("/sessions/:id/regenerate", {
    schema: {
      tags: ["chat"],
      summary: "Regenerate the last assistant response",
      description: "Regenerate the latest committed floor response and keep the previous floor as superseded branch.",
      params: sessionIdParamsJsonSchema,
      body: regenerateBodyJsonSchema,
      response: {
        200: regenerateSuccessResponseJsonSchema,
        ...chatMutationErrorResponses,
      },
    },
    preValidation: (request, _reply, done) => {
      ensureOptionalObjectBody(request);
      done();
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(sessionIdParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;

    const body = request.body ?? {};
    const parsedBody = parseWithSchema(regenerateBodySchema, body, reply);
    if (!parsedBody.ok) return;

    if (!ensureTurnSessionStateWritesEnabled(reply, parsedBody.data.session_state_writes, enableClientData)) {
      return;
    }

    const regenerateRequest: RegenerateRequest = {
      config: parsedBody.data.config,
      generationParams: parsedBody.data.generation_params
        ? mapGenerationParams(parsedBody.data.generation_params)
        : undefined,
      structure: mapPromptStructureRequest(parsedBody.data.structure),
      delivery: mapPromptDeliveryRequest(parsedBody.data.delivery),
      debugOptions: mapLiveDebugOptionsRequest(parsedBody.data.debug_options),
      confirmedExecutionIds: parsedBody.data.confirmed_execution_ids,
      sessionStateWrites: mapTurnSessionStateWritesRequest(parsedBody.data.session_state_writes),
      confirmedSessionStateMutationIds: parsedBody.data.confirmed_session_state_mutation_ids,
    };
    const accountId = getRequestAuthContext(request).accountId;

    try {
      const result = await chatService.regenerate(parsedParams.data.id, regenerateRequest, accountId);
      return reply.code(200).send({
        data: {
          floor_id: result.floorId,
          floor_no: result.floorNo,
          previous_floor_id: result.previousFloorId,
          generated_text: result.generatedText,
          summaries: result.summaries,
          total_usage: mapUsageToSnakeCase(result.totalUsage),
          memory: mapMemoryToSnakeCase(result.memory),
          final_state: result.finalState,
          ...mapOptionalPromptDebugResponseFields(result),
        },
      });
    } catch (error) {
      return handleChatError(error, request, reply);
    }
  });

  app.post("/floors/:id/retry", {
    schema: {
      tags: ["chat"],
      summary: "Retry a committed floor in place",
      description:
        "Retry generation for an existing committed floor in place. "
        + "The target floor must be in the 'committed' state. "
        + "The current output page and assistant message are cleared, the floor is reset, "
        + "and a new generation attempt is run under the same floor id. "
        + "This endpoint is not a recovery path for failed floors.",
      params: idParamsJsonSchema,
      body: retryFloorBodyJsonSchema,
      response: {
        200: respondSuccessResponseJsonSchema,
        ...chatMutationErrorResponses,
      },
    },
    preValidation: (request, _reply, done) => {
      ensureOptionalObjectBody(request);
      done();
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(floorIdParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;

    const body = request.body ?? {};
    const parsedBody = parseWithSchema(retryFloorBodySchema, body, reply);
    if (!parsedBody.ok) return;

    if (!ensureTurnSessionStateWritesEnabled(reply, parsedBody.data.session_state_writes, enableClientData)) {
      return;
    }

    const retryRequest: RetryFloorRequest = {
      config: parsedBody.data.config,
      generationParams: parsedBody.data.generation_params
        ? mapGenerationParams(parsedBody.data.generation_params)
        : undefined,
      structure: mapPromptStructureRequest(parsedBody.data.structure),
      delivery: mapPromptDeliveryRequest(parsedBody.data.delivery),
      debugOptions: mapLiveDebugOptionsRequest(parsedBody.data.debug_options),
      confirmedExecutionIds: parsedBody.data.confirmed_execution_ids,
      sessionStateWrites: mapTurnSessionStateWritesRequest(parsedBody.data.session_state_writes),
      confirmedSessionStateMutationIds: parsedBody.data.confirmed_session_state_mutation_ids,
    };

    const accountId = getRequestAuthContext(request).accountId;

    try {
      const result = await chatService.retryFloor(parsedParams.data.id, retryRequest, accountId);
      return reply.code(200).send({
        data: {
          floor_id: result.floorId,
          floor_no: result.floorNo,
          branch_id: result.branchId,
          generated_text: result.generatedText,
          summaries: result.summaries,
          total_usage: mapUsageToSnakeCase(result.totalUsage),
          memory: mapMemoryToSnakeCase(result.memory),
          final_state: result.finalState,
          ...mapOptionalPromptDebugResponseFields(result),
        },
      });
    } catch (error) {
      return handleChatError(error, request, reply);
    }
  });

  app.post("/messages/:id/edit-and-regenerate", {
    schema: {
      tags: ["chat"],
      summary: "Edit a user message and regenerate",
      description: "Create a new branch floor from an edited user message and regenerate assistant response.",
      params: idParamsJsonSchema,
      body: editAndRegenerateBodyJsonSchema,
      response: {
        200: editAndRegenerateSuccessResponseJsonSchema,
        ...chatMutationErrorResponses,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(messageIdParamsSchema, request.params, reply);
    if (!parsedParams.ok) return;

    const parsedBody = parseWithSchema(editAndRegenerateBodySchema, request.body, reply);
    if (!parsedBody.ok) return;

    if (!ensureTurnSessionStateWritesEnabled(reply, parsedBody.data.session_state_writes, enableClientData)) {
      return;
    }

    const editRequest: EditAndRegenerateRequest = {
      content: parsedBody.data.content,
      branchId: parsedBody.data.branch_id,
      config: parsedBody.data.config,
      generationParams: parsedBody.data.generation_params
        ? mapGenerationParams(parsedBody.data.generation_params)
        : undefined,
      structure: mapPromptStructureRequest(parsedBody.data.structure),
      delivery: mapPromptDeliveryRequest(parsedBody.data.delivery),
      debugOptions: mapLiveDebugOptionsRequest(parsedBody.data.debug_options),
      confirmedExecutionIds: parsedBody.data.confirmed_execution_ids,
      sessionStateWrites: mapTurnSessionStateWritesRequest(parsedBody.data.session_state_writes),
      confirmedSessionStateMutationIds: parsedBody.data.confirmed_session_state_mutation_ids,
    };
    const accountId = getRequestAuthContext(request).accountId;

    try {
      const result = await chatService.editAndRegenerate(parsedParams.data.id, editRequest, accountId);
      return reply.code(200).send({
        data: {
          floor_id: result.floorId,
          floor_no: result.floorNo,
          branch_id: result.branchId,
          source_floor_id: result.sourceFloorId,
          source_message_id: result.sourceMessageId,
          generated_text: result.generatedText,
          summaries: result.summaries,
          total_usage: mapUsageToSnakeCase(result.totalUsage),
          memory: mapMemoryToSnakeCase(result.memory),
          final_state: result.finalState,
          ...mapOptionalPromptDebugResponseFields(result),
        },
      });
    } catch (error) {
      return handleChatError(error, request, reply);
    }
  });
}
