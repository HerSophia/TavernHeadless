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

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import {
  ChatService,
  ChatServiceError,
  type RespondRequest,
  type RegenerateRequest,
  type DryRunRequest,
  type RetryFloorRequest,
  type EditAndRegenerateRequest,
  type RespondRuntimeOptions,
} from "../services/chat-service.js";
import { ensureOptionalObjectBody, parseWithSchema, sendError } from "../lib/http.js";
import { errorResponseJsonSchema, idParamsJsonSchema } from "./schemas/common.js";
import { buildZodObjectSchema } from "./schemas/json-schema-zod.js";
import {
  sessionIdParamsJsonSchema,
  respondBodyJsonSchema,
  regenerateBodyJsonSchema,
  promptIntentValues,
  editAndRegenerateBodyJsonSchema,
  respondSuccessResponseJsonSchema,
  regenerateSuccessResponseJsonSchema,
  retryFloorBodyJsonSchema,
  editAndRegenerateSuccessResponseJsonSchema,
  dryRunSuccessResponseJsonSchema,
  dryRunBodyJsonSchema,
  streamResponseExample,
} from "./schemas/chat-schemas.js";
import { findNativePipelineError } from "../lib/native-pipeline-error.js";
import { getRequestAuthContext } from "../plugins/auth.js";
import { applyCorsHeaders } from "../plugins/cors.js";
import type { CorsConfig } from "../plugins/cors.js";
import type { PromptRuntimeTrace, PromptSnapshotPreview } from "../services/prompt-assembler.js";
import type { WorldbookMatchDetail } from "../services/prompt-assembler.js";

// ── Zod Schemas ───────────────────────────────────────

type TurnConfigBody = {
  enableTools?: boolean;
  enableDirector?: boolean;
  enableVerifier?: boolean;
  enableMemoryConsolidation?: boolean;
  verifierFailStrategy?: "warn" | "block" | "retry";
  toolMode?: "inline" | "standalone" | "both";
  maxRetries?: number;
};

type GenerationParamsBody = {
  temperature?: number;
  max_output_tokens?: number;
  top_p?: number;
  top_k?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop_sequences?: string[];
  stream?: boolean;
  reasoning_effort?: "low" | "medium" | "high";
};

type PromptDeliveryBody = {
  allow_assistant_prefill?: boolean;
  require_last_user?: boolean;
  no_assistant?: boolean;
};

type PromptStructureBody = {
  mode: "default" | "strict_alternating" | "no_assistant";
  merge_adjacent_same_role?: boolean;
  assistant_rewrite_strategy?: "to_system" | "to_user_transcript";
  preserve_system_messages?: boolean;
};

type LiveDebugOptionsBody = {
  include_prompt_snapshot?: boolean;
  include_runtime_trace?: boolean;
  include_worldbook_matches?: boolean;
};

type DryRunDebugOptionsBody = {
  include_worldbook_matches?: boolean;
};

type FloorVisibilityRangeBody = {
  start_floor_no: number;
  end_floor_no: number;
};

type DryRunVisibilityBody = {
  hidden_floor_ranges?: FloorVisibilityRangeBody[];
  visible_floor_ranges?: FloorVisibilityRangeBody[];
  hidden_floor_ids?: string[];
  mode?: "allow_all_except_hidden" | "deny_all_except_visible";
};

type RespondBody = {
  message: string;
  prompt_intent?: (typeof promptIntentValues)[number];
  delivery?: PromptDeliveryBody;
  structure?: PromptStructureBody;
  debug_options?: LiveDebugOptionsBody;
  config?: TurnConfigBody;
  generation_params?: GenerationParamsBody;
  branch_id?: string;
  source_floor_id?: string;
};

type DryRunBody = {
  message: string;
  prompt_intent?: (typeof promptIntentValues)[number];
  debug_options?: DryRunDebugOptionsBody;
  visibility?: DryRunVisibilityBody;
  structure?: PromptStructureBody;
  delivery?: PromptDeliveryBody;
};

type RegenerateBody = {
  delivery?: PromptDeliveryBody;
  structure?: PromptStructureBody;
  debug_options?: LiveDebugOptionsBody;
  config?: TurnConfigBody;
  generation_params?: GenerationParamsBody;
};

type EditAndRegenerateBody = RegenerateBody & {
  content: string;
  branch_id?: string;
};

type RetryFloorBody = RegenerateBody & {
  confirmed_execution_ids?: string[];
};

const sessionIdParamsSchema = z.object({
  id: z.string().min(1),
});

const floorIdParamsSchema = z.object({
  id: z.string().min(1),
});

const messageIdParamsSchema = z.object({
  id: z.string().min(1),
});

const respondBodySchema = buildZodObjectSchema<RespondBody>(respondBodyJsonSchema);

const dryRunBodySchema = buildZodObjectSchema<DryRunBody>(dryRunBodyJsonSchema);

const regenerateBodySchema = buildZodObjectSchema<RegenerateBody>(regenerateBodyJsonSchema);

const editAndRegenerateBodySchema = buildZodObjectSchema<EditAndRegenerateBody>(editAndRegenerateBodyJsonSchema);

const retryFloorBodySchema = buildZodObjectSchema<RetryFloorBody>(retryFloorBodyJsonSchema);



const chatMutationErrorResponses = {
  400: errorResponseJsonSchema,
  404: errorResponseJsonSchema,
  499: errorResponseJsonSchema,
  409: errorResponseJsonSchema,
  500: errorResponseJsonSchema,
  503: errorResponseJsonSchema,
  504: errorResponseJsonSchema,
} as const;

interface RegisterChatRoutesOptions {
  enableSseChat?: boolean;
  enablePromptDryRun?: boolean;
  cors?: CorsConfig;
}

// ── Route Registration ────────────────────────────────

/**
 * 注册聊天业务路由。
 *
 * @param app - Fastify 实例
 * @param chatService - ChatService 实例
 */
export async function registerChatRoutes(
  app: FastifyInstance,
  chatService: ChatService,
  options: RegisterChatRoutesOptions = {}
): Promise<void> {
  const enableSseChat = options.enableSseChat === true;
  const enablePromptDryRun = options.enablePromptDryRun === true;
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
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
        500: errorResponseJsonSchema,
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
          ...mapOptionalRuntimeTraceResponseField(result.runtimeTrace),
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
            ...(result.assembly.worldbookMatches ? { worldbook_matches: result.assembly.worldbookMatches.map(mapWorldbookMatchDetail) } : {}),
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
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
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

  /**
   * POST /sessions/:id/respond
   *
   * 发送用户消息并获取 AI 回复。
   */
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

    // 将 snake_case 的请求体映射为 camelCase 的 RespondRequest
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

  /**
   * POST /sessions/:id/regenerate
   *
   * 重新生成最后一轮的 AI 回复。
   * 创建新楼层替代旧楼层，旧楼层移入 superseded 分支保留。
   */
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

    // body 可以为空（全部使用默认参数）
    const body = request.body ?? {};
    const parsedBody = parseWithSchema(regenerateBodySchema, body, reply);
    if (!parsedBody.ok) return;

    const regenerateRequest: RegenerateRequest = {
      config: parsedBody.data.config,
      generationParams: parsedBody.data.generation_params
        ? mapGenerationParams(parsedBody.data.generation_params)
        : undefined,
      structure: mapPromptStructureRequest(parsedBody.data.structure),
      delivery: mapPromptDeliveryRequest(parsedBody.data.delivery),
      debugOptions: mapLiveDebugOptionsRequest(parsedBody.data.debug_options),
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
      summary: "Retry a failed floor",
      description: "Retry generation for an existing failed floor.",
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

    const retryRequest: RetryFloorRequest = {
      config: parsedBody.data.config,
      generationParams: parsedBody.data.generation_params
        ? mapGenerationParams(parsedBody.data.generation_params)
        : undefined,
      structure: mapPromptStructureRequest(parsedBody.data.structure),
      delivery: mapPromptDeliveryRequest(parsedBody.data.delivery),
      debugOptions: mapLiveDebugOptionsRequest(parsedBody.data.debug_options),
      confirmedExecutionIds: parsedBody.data.confirmed_execution_ids,
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

// ── 工具函数 ──────────────────────────────────────────

/** 将 snake_case 的生成参数映射为 camelCase */
function mapGenerationParams(
  params: GenerationParamsBody
): RespondRequest["generationParams"] {
  return {
    temperature: params.temperature,
    maxOutputTokens: params.max_output_tokens,
    topP: params.top_p,
    topK: params.top_k,
    frequencyPenalty: params.frequency_penalty,
    presencePenalty: params.presence_penalty,
    stopSequences: params.stop_sequences,
    stream: params.stream,
    reasoningEffort: params.reasoning_effort,
  };
}

/** 将 camelCase 的 usage 映射为 snake_case */
function mapUsageToSnakeCase(usage: { promptTokens: number; completionTokens: number; totalTokens: number }) {
  return {
    prompt_tokens: usage.promptTokens,
    completion_tokens: usage.completionTokens,
    total_tokens: usage.totalTokens,
  };
}

function mapMemoryToSnakeCase(memory: { mode: "sync" | "async"; status: "applied" | "queued"; jobId?: string } | undefined) {
  if (!memory) {
    return undefined;
  }

  return {
    mode: memory.mode,
    status: memory.status,
    job_id: memory.jobId ?? null,
  };
}

function mapRunToSnakeCase(run: {
  floorId: string;
  runId: string;
  runType: string;
  status: string;
  phase: string;
  publicPhase: string;
  phaseSeq: number;
  attemptNo: number;
  startedAt: number;
  updatedAt: number;
  completedAt?: number | null;
  pendingOutput?: { tempId: string; attemptNo: number; state: string; text: string; startedAt: number; updatedAt: number; error?: string } | null;
  verifier?: { status: string; suggestion?: string; issues?: Array<{ description: string; severity: string }> } | null;
  error?: { code: string; message: string } | null;
}) {
  return {
    floor_id: run.floorId, run_id: run.runId, run_type: run.runType, status: run.status, phase: run.phase,
    public_phase: run.publicPhase, phase_seq: run.phaseSeq, attempt_no: run.attemptNo, started_at: run.startedAt,
    updated_at: run.updatedAt, completed_at: run.completedAt ?? null,
    pending_output: run.pendingOutput ? {
      temp_id: run.pendingOutput.tempId, attempt_no: run.pendingOutput.attemptNo, state: run.pendingOutput.state,
      text: run.pendingOutput.text, started_at: run.pendingOutput.startedAt, updated_at: run.pendingOutput.updatedAt,
      error: run.pendingOutput.error ?? null,
    } : null,
    verifier: run.verifier ? { status: run.verifier.status, suggestion: run.verifier.suggestion ?? null, issues: run.verifier.issues ?? null } : null,
    error: run.error ? { code: run.error.code, message: run.error.message } : null,
  };
}

function writeSse(rawReply: import("http").ServerResponse, event: string, data: unknown): void {
  if (rawReply.writableEnded || rawReply.destroyed) {
    return;
  }

  const payload = JSON.stringify(data);
  try {
    rawReply.write(`event: ${event}\n`);
    rawReply.write(`data: ${payload}\n\n`);
  } catch {
    // 客户端可能已断连，静默忽略。
  }
}

function mapPromptStructureRequest(
  structure: PromptStructureBody | undefined,
): RespondRequest["structure"] {
  if (!structure) {
    return undefined;
  }

  return {
    mode: structure.mode,
    mergeAdjacentSameRole: structure.merge_adjacent_same_role,
    assistantRewriteStrategy: structure.assistant_rewrite_strategy,
    preserveSystemMessages: structure.preserve_system_messages,
  };
}

function mapPromptDeliveryRequest(
  delivery: PromptDeliveryBody | undefined,
): RespondRequest["delivery"] {
  if (!delivery) {
    return undefined;
  }

  return {
    allowAssistantPrefill: delivery.allow_assistant_prefill,
    requireLastUser: delivery.require_last_user,
    noAssistant: delivery.no_assistant,
  };
}

function mapLiveDebugOptionsRequest(
  debugOptions: LiveDebugOptionsBody | undefined,
): RespondRequest["debugOptions"] {
  if (!debugOptions) {
    return undefined;
  }

  const mapped = {
    ...(debugOptions.include_prompt_snapshot !== undefined
      ? { includePromptSnapshot: debugOptions.include_prompt_snapshot }
      : {}),
    ...(debugOptions.include_runtime_trace !== undefined
      ? { includeRuntimeTrace: debugOptions.include_runtime_trace }
      : {}),
    ...(debugOptions.include_worldbook_matches !== undefined
      ? { includeWorldbookMatches: debugOptions.include_worldbook_matches }
      : {}),
  };

  return Object.keys(mapped).length > 0 ? mapped : undefined;
}

function mapDryRunDebugOptionsRequest(
  debugOptions: DryRunDebugOptionsBody | undefined,
): DryRunRequest["debugOptions"] {
  if (!debugOptions) {
    return undefined;
  }

  return {
    includeWorldbookMatches: debugOptions.include_worldbook_matches,
  };
}

function mapDryRunVisibilityRequest(
  visibility: DryRunVisibilityBody | undefined,
): DryRunRequest["visibility"] {
  if (!visibility) {
    return undefined;
  }

  return {
    hiddenFloorRanges: visibility.hidden_floor_ranges?.map((range) => ({
      startFloorNo: range.start_floor_no,
      endFloorNo: range.end_floor_no,
    })),
    visibleFloorRanges: visibility.visible_floor_ranges?.map((range) => ({
      startFloorNo: range.start_floor_no,
      endFloorNo: range.end_floor_no,
    })),
    hiddenFloorIds: visibility.hidden_floor_ids,
    mode: visibility.mode,
  };
}

function mapPromptSnapshotToSnakeCase(promptSnapshot: PromptSnapshotPreview): Record<string, unknown> {
  return {
    preset_id: promptSnapshot.presetId,
    preset_updated_at: promptSnapshot.presetUpdatedAt,
    preset_version: promptSnapshot.presetVersion,
    worldbook_id: promptSnapshot.worldbookId,
    worldbook_updated_at: promptSnapshot.worldbookUpdatedAt,
    worldbook_version: promptSnapshot.worldbookVersion,
    regex_profile_id: promptSnapshot.regexProfileId,
    regex_profile_updated_at: promptSnapshot.regexProfileUpdatedAt,
    regex_profile_version: promptSnapshot.regexProfileVersion,
    worldbook_activated_entry_uids: promptSnapshot.worldbookActivatedEntryUids,
    regex_pre_rule_names: promptSnapshot.regexPreRuleNames,
    regex_post_rule_names: promptSnapshot.regexPostRuleNames,
    prompt_mode: promptSnapshot.promptMode,
    prompt_digest: promptSnapshot.promptDigest,
    token_estimate: promptSnapshot.tokenEstimate,
  };
}

function mapRuntimeTraceToSnakeCase(runtimeTrace: PromptRuntimeTrace): Record<string, unknown> {
  return {
    ...(runtimeTrace.preset
      ? {
          preset: {
            selected_prompt_order_character_id: runtimeTrace.preset.selectedPromptOrderCharacterId,
            ignored_prompt_order_character_ids: runtimeTrace.preset.ignoredPromptOrderCharacterIds,
            unsupported_fields: runtimeTrace.preset.unsupportedFields,
            ignored_fields: runtimeTrace.preset.ignoredFields,
            unresolved_markers: runtimeTrace.preset.unresolvedMarkers,
            warnings: runtimeTrace.preset.warnings,
            trigger_filtered_entry_ids: runtimeTrace.preset.triggerFilteredEntryIds,
            in_chat_inserted_entry_ids: runtimeTrace.preset.inChatInsertedEntryIds,
            continue_nudge_applied: runtimeTrace.preset.continueNudgeApplied,
            continue_nudge_text: runtimeTrace.preset.continueNudgeText ?? null,
            names_behavior_applied: runtimeTrace.preset.namesBehaviorApplied ?? null,
          },
        }
      : {}),
    ...(runtimeTrace.worldbook
      ? {
          worldbook: {
            hit_count: runtimeTrace.worldbook.hitCount,
            ...(runtimeTrace.worldbook.matches
              ? {
                  matches: runtimeTrace.worldbook.matches.map(mapWorldbookMatchDetail),
                }
              : {}),
          },
        }
      : {}),
    ...(runtimeTrace.regex
      ? {
          regex: {
            user_input_rules: runtimeTrace.regex.userInputRules,
            ai_output_rules: runtimeTrace.regex.aiOutputRules,
            preprocessed_user_message: runtimeTrace.regex.preprocessedUserMessage ?? null,
          },
        }
      : {}),
    ...(runtimeTrace.budgets
      ? {
          budgets: {
            by_group: runtimeTrace.budgets.byGroup.map((item) => ({
              group: item.group,
              token_count: item.tokenCount,
              ...(item.prunedTokenCount !== undefined ? { pruned_token_count: item.prunedTokenCount } : {}),
            })),
          },
        }
      : {}),
    ...(runtimeTrace.structure
      ? {
          structure: {
            mode: runtimeTrace.structure.mode,
            merge_adjacent_same_role: runtimeTrace.structure.mergeAdjacentSameRole,
            assistant_rewrite_count: runtimeTrace.structure.assistantRewriteCount,
            assistant_rewrite_strategy: runtimeTrace.structure.assistantRewriteStrategy ?? null,
            tail_assistant_detected: runtimeTrace.structure.tailAssistantDetected,
          },
        }
      : {}),
    ...(runtimeTrace.memory ? { memory: { summary_injected: runtimeTrace.memory.summaryInjected } } : {}),
    ...(runtimeTrace.macro
      ? {
          macro: {
            warnings: runtimeTrace.macro.warnings.map((warning) => ({
              code: warning.code,
              message: warning.message,
              ...(warning.macroName ? { macro_name: warning.macroName } : {}),
              ...(warning.rawText ? { raw_text: warning.rawText } : {}),
            })),
            used_names: runtimeTrace.macro.usedNames,
            mutation_preview: runtimeTrace.macro.mutationPreview.map((preview) => ({
              kind: preview.kind,
              scope: preview.scope,
              key: preview.key,
              ...(preview.value !== undefined ? { value: preview.value } : {}),
            })),
            staged_mutations: runtimeTrace.macro.stagedMutations.map((mutation) => ({
              kind: mutation.kind,
              scope: mutation.scope,
              key: mutation.key,
              ...(mutation.value !== undefined ? { value: mutation.value } : {}),
              source_macro: mutation.sourceMacro,
            })),
            traces: runtimeTrace.macro.traces.map((trace) => mapMacroTraceEntryToSnakeCase(trace)),
          },
        }
      : {}),
    ...(runtimeTrace.delivery
      ? {
          delivery: {
            assistant_prefill_requested: runtimeTrace.delivery.assistantPrefillRequested,
            assistant_prefill_applied: runtimeTrace.delivery.assistantPrefillApplied,
            assistant_prefill_strategy: runtimeTrace.delivery.assistantPrefillStrategy ?? null,
            allow_assistant_prefill: runtimeTrace.delivery.allowAssistantPrefill,
            require_last_user: runtimeTrace.delivery.requireLastUser,
            no_assistant: runtimeTrace.delivery.noAssistant,
            last_message_role: runtimeTrace.delivery.lastMessageRole ?? null,
            ends_with_user: runtimeTrace.delivery.endsWithUser,
            degraded: runtimeTrace.delivery.degraded,
            degrade_reasons: runtimeTrace.delivery.degradeReasons,
          },
        }
      : {}),
    ...(runtimeTrace.visibility
      ? {
          visibility: {
            hidden_floor_ranges: runtimeTrace.visibility.hiddenFloorRanges?.map((range) => ({
              start_floor_no: range.startFloorNo,
              end_floor_no: range.endFloorNo,
            })),
            filtered_floor_nos: runtimeTrace.visibility.filteredFloorNos,
          },
        }
      : {}),
  };
}

function mapOptionalRuntimeTraceResponseField(runtimeTrace?: PromptRuntimeTrace): Record<string, unknown> {
  return runtimeTrace
    ? { runtime_trace: mapRuntimeTraceToSnakeCase(runtimeTrace) }
    : {};
}

function mapOptionalPromptDebugResponseFields(
  payload: {
    promptSnapshot?: PromptSnapshotPreview;
    runtimeTrace?: PromptRuntimeTrace;
  },
): Record<string, unknown> {
  return {
    ...(payload.promptSnapshot
      ? { prompt_snapshot: mapPromptSnapshotToSnakeCase(payload.promptSnapshot) }
      : {}),
    ...mapOptionalRuntimeTraceResponseField(payload.runtimeTrace),
  };
}

function mapMacroTraceEntryToSnakeCase(trace: NonNullable<PromptRuntimeTrace["macro"]>["traces"][number]): Record<string, unknown> {
  return {
    macro_name: trace.macroName,
    raw_text: trace.rawText,
    resolved_text: trace.resolvedText,
    ...(trace.phase ? { phase: trace.phase } : {}),
    ...(trace.sourceKind ? { source_kind: trace.sourceKind } : {}),
    ...(trace.selectedBranch ? { selected_branch: trace.selectedBranch } : {}),
  };
}

function mapWorldbookMatchDetail(match: WorldbookMatchDetail): Record<string, unknown> {
  return {
    uid: match.uid,
    comment: match.comment,
    content_preview: match.contentPreview,
    order: match.order,
    source: {
      kind: match.source.kind,
      worldbook_id: match.source.worldbookId,
      worldbook_name: match.source.worldbookName,
    },
    insertion: {
      position: match.insertion.position,
      ...(match.insertion.depth !== undefined ? { depth: match.insertion.depth } : {}),
      ...(match.insertion.role ? { role: match.insertion.role } : {}),
      ...(match.insertion.outletName ? { outlet_name: match.insertion.outletName } : {}),
    },
    activation: {
      mode: match.activation.mode,
      recursion_level: match.activation.recursionLevel,
      first_match: match.activation.firstMatch
        ? {
            source_kind: match.activation.firstMatch.sourceKind,
            ...(match.activation.firstMatch.messageIndexFromLatest !== undefined
              ? { message_index_from_latest: match.activation.firstMatch.messageIndexFromLatest }
              : {}),
            ...(match.activation.firstMatch.injectionIndex !== undefined
              ? { injection_index: match.activation.firstMatch.injectionIndex }
              : {}),
            matched_key: match.activation.firstMatch.matchedKey,
            matched_key_scope: match.activation.firstMatch.matchedKeyScope,
            matched_key_type: match.activation.firstMatch.matchedKeyType,
            char_start: match.activation.firstMatch.charStart,
            char_end: match.activation.firstMatch.charEnd,
            excerpt: match.activation.firstMatch.excerpt,
          }
        : null,
    },
  };
}

function mapChatServiceError(error: ChatServiceError): { statusCode: number; code: string; message: string } {

  switch (error.code) {
    case "session_not_found":
      return { statusCode: 404, code: "not_found", message: error.message };
    case "session_archived":
      return { statusCode: 409, code: "session_archived", message: error.message };
    case "message_not_found":
    case "floor_not_found":
    case "source_floor_not_found":
      return { statusCode: 404, code: error.code, message: error.message };
    case "no_floor_to_regenerate":
    case "no_user_message":
      return { statusCode: 404, code: error.code, message: error.message };
    case "invalid_message_role":
    case "invalid_message_scope":
    case "invalid_tool_mode":
      return { statusCode: 400, code: error.code, message: error.message };
    case "invalid_state":
    case "generation_target_stale":
    case "branch_exists":
      return { statusCode: 409, code: error.code, message: error.message };
    case "generation_cancelled":
      return { statusCode: 499, code: error.code, message: error.message };
    case "generation_conflict":
    case "commit_conflict":
      return { statusCode: 409, code: error.code, message: error.message };
    case "tool_replay_blocked":
    case "tool_replay_confirmation_required":
    case "profile_not_found":
    case "tool_catalog_conflict":
    case "instance_slot_disabled_required":
    case "profile_disabled":
      return { statusCode: 409, code: error.code, message: error.message };
    case "secret_unavailable":
    case "commit_busy":
    case "generation_queue_timeout":
      return { statusCode: 503, code: error.code, message: error.message };
    case "generation_timeout":
      return { statusCode: 504, code: error.code, message: error.message };
    case "secret_invalid_format":
    case "orchestration_failed":
    case "turn_commit_failed":
      return { statusCode: 500, code: error.code, message: error.message };
    default:
      return { statusCode: 500, code: "internal_error", message: error.message };
  }
}

/** 统一处理 ChatService 错误 */
function handleChatError(error: unknown, request: FastifyRequest, reply: import("fastify").FastifyReply) {
  logNativePipelineError(error, request, "chat_route");

  if (!(error instanceof ChatServiceError)) {
    throw error;
  }

  const mapped = mapChatServiceError(error);
  return sendError(reply, mapped.statusCode, mapped.code, mapped.message, error.details);
}

function logNativePipelineError(
  error: unknown,
  request: FastifyRequest,
  stage: "chat_route" | "respond_stream"
): void {
  const nativePipelineError = findNativePipelineError(error);
  if (!nativePipelineError) {
    return;
  }

  request.log.error(
    {
      request_id: request.id,
      route: request.routeOptions.url ?? request.url.split("?")[0] ?? "/",
      stage,
      error_code: "native_pipeline_failed",
      node_name: nativePipelineError.nodeName,
      input_summary: nativePipelineError.inputSummary,
      state_summary: nativePipelineError.stateSummary,
      err: error,
    },
    "native prompt pipeline failed"
  );
}
