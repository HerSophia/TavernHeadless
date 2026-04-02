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
import {
  sessionIdParamsJsonSchema,
  respondBodyJsonSchema,
  regenerateBodyJsonSchema,
  editAndRegenerateBodyJsonSchema,
  respondSuccessResponseJsonSchema,
  regenerateSuccessResponseJsonSchema,
  retryFloorBodyJsonSchema,
  editAndRegenerateSuccessResponseJsonSchema,
  dryRunSuccessResponseJsonSchema,
  streamResponseExample,
} from "./schemas/chat-schemas.js";
import { findNativePipelineError } from "../lib/native-pipeline-error.js";
import { getRequestAuthContext } from "../plugins/auth.js";

// ── Zod Schemas ───────────────────────────────────────

const sessionIdParamsSchema = z.object({
  id: z.string().min(1),
});

const floorIdParamsSchema = z.object({
  id: z.string().min(1),
});

const messageIdParamsSchema = z.object({
  id: z.string().min(1),
});

const turnConfigSchema = z.object({
  enableTools: z.boolean().optional(),
  enableDirector: z.boolean().optional(),
  enableVerifier: z.boolean().optional(),
  enableMemoryConsolidation: z.boolean().optional(),
  verifierFailStrategy: z.enum(["warn", "block", "retry"]).optional(),
  toolMode: z.enum(["inline", "standalone", "both"]).optional(),
  maxRetries: z.number().int().min(0).max(5).optional(),
});

const generationParamsSchema = z.object({
  temperature: z.number().min(0).max(2).optional(),
  max_output_tokens: z.number().int().min(1).optional(),
  top_p: z.number().min(0).max(1).optional(),
  top_k: z.number().int().min(1).optional(),
  frequency_penalty: z.number().optional(),
  presence_penalty: z.number().optional(),
  stop_sequences: z.array(z.string()).optional(),
  stream: z.boolean().optional(),
  reasoning_effort: z.enum(["low", "medium", "high"]).optional(),
});

const respondBodySchema = z.object({
  /** 用户消息文本 */
  message: z.string().min(1, "Message cannot be empty"),
  /** 回合配置覆盖（可选） */
  config: turnConfigSchema.optional(),
  /** 生成参数覆盖（可选） */
  generation_params: generationParamsSchema.optional(),
  branch_id: z.string().min(1).optional(),
  source_floor_id: z.string().min(1).optional(),
});

const regenerateBodySchema = z.object({
  /** 回合配置覆盖（可选） */
  config: turnConfigSchema.optional(),
  /** 生成参数覆盖（可选） */
  generation_params: generationParamsSchema.optional(),
});

const editAndRegenerateBodySchema = regenerateBodySchema.extend({
  content: z.string().min(1, "Content cannot be empty"),
  branch_id: z.string().min(1).optional(),
});

const retryFloorBodySchema = regenerateBodySchema.extend({
  confirmed_execution_ids: z.array(z.string().min(1)).optional(),
});



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

  app.post("/sessions/:id/respond/dry-run", {
    schema: {
      tags: ["chat"],
      summary: "Dry-run prompt assembly",
      description: "Assemble prompt and return debug metadata without calling LLM or writing turn data.",
      params: sessionIdParamsJsonSchema,
      body: respondBodyJsonSchema,
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

    const parsedBody = parseWithSchema(respondBodySchema, request.body, reply);
    if (!parsedBody.ok) return;

    const dryRunRequest: DryRunRequest = {
      message: parsedBody.data.message,
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
          prompt_snapshot: {
            preset_id: result.promptSnapshot.presetId,
            preset_updated_at: result.promptSnapshot.presetUpdatedAt,
            preset_version: result.promptSnapshot.presetVersion,
            worldbook_id: result.promptSnapshot.worldbookId,
            worldbook_updated_at: result.promptSnapshot.worldbookUpdatedAt,
            worldbook_version: result.promptSnapshot.worldbookVersion,
            regex_profile_id: result.promptSnapshot.regexProfileId,
            regex_profile_updated_at: result.promptSnapshot.regexProfileUpdatedAt,
            regex_profile_version: result.promptSnapshot.regexProfileVersion,
            worldbook_activated_entry_uids: result.promptSnapshot.worldbookActivatedEntryUids,
            regex_pre_rule_names: result.promptSnapshot.regexPreRuleNames,
            regex_post_rule_names: result.promptSnapshot.regexPostRuleNames,
            prompt_mode: result.promptSnapshot.promptMode,
            prompt_digest: result.promptSnapshot.promptDigest,
            token_estimate: result.promptSnapshot.tokenEstimate,
          },
          assembly: {
            mode: result.assembly.mode,
            preset_used: result.assembly.presetUsed,
            worldbook_hits: result.assembly.worldbookHits,
            regex_pre_rules: result.assembly.regexPreRules,
            regex_post_rules: result.assembly.regexPostRules,
            memory_summary_injected: result.assembly.memorySummaryInjected,
            reserved_variable_collisions: result.assembly.reservedVariableCollisions,
            preprocessed_user_message: result.assembly.preprocessedUserMessage ?? null,
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
    };
    const accountId = getRequestAuthContext(request).accountId;

    reply.hijack();
    reply.raw.statusCode = 200;
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
        final_state: result.finalState,
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
          final_state: result.finalState,
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
          final_state: result.finalState,
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
          final_state: result.finalState,
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
          final_state: result.finalState,
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
  params: z.infer<typeof generationParamsSchema>
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
