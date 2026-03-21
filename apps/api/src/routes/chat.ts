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
  enableDirector: z.boolean().optional(),
  enableVerifier: z.boolean().optional(),
  enableMemoryConsolidation: z.boolean().optional(),
  verifierFailStrategy: z.enum(["warn", "block", "retry"]).optional(),
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

const retryFloorBodySchema = regenerateBodySchema;

const turnConfigExample = {
  enableDirector: true,
  enableVerifier: true,
  enableMemoryConsolidation: true,
  verifierFailStrategy: "warn",
  maxRetries: 1,
} as const;

const generationParamsExample = {
  temperature: 0.7,
  max_output_tokens: 256,
  top_p: 0.9,
  reasoning_effort: "low",
} as const;

const respondBodyExample = {
  message: "Please continue the campfire scene.",
  branch_id: "main",
  config: turnConfigExample,
  generation_params: generationParamsExample,
} as const;

const regenerateBodyExample = {
  config: {
    enableDirector: true,
  },
  generation_params: generationParamsExample,
} as const;

const editAndRegenerateBodyExample = {
  content: "I step closer to the fire and lower my voice.",
  branch_id: "alt-branch",
  config: {
    enableDirector: false,
  },
  generation_params: generationParamsExample,
} as const;

const usageExample = {
  prompt_tokens: 320,
  completion_tokens: 128,
  total_tokens: 448,
} as const;

const respondDataExample = {
  floor_id: "floor_12",
  floor_no: 12,
  branch_id: "main",
  generated_text: "The firelight wavers as the next part of the story begins.",
  summaries: ["The group resumes the campfire planning scene."],
  total_usage: usageExample,
  final_state: "committed",
} as const;

const respondSuccessResponseExample = {
  data: respondDataExample,
} as const;

const regenerateSuccessResponseExample = {
  data: {
    floor_id: "floor_13",
    floor_no: 13,
    previous_floor_id: "floor_12",
    generated_text: "The assistant retries the last turn with a different phrasing.",
    summaries: ["The last assistant turn was regenerated."],
    total_usage: usageExample,
    final_state: "committed",
  },
} as const;

const editAndRegenerateSuccessResponseExample = {
  data: {
    ...respondDataExample,
    branch_id: "alt-branch",
    source_floor_id: "floor_11",
    source_message_id: "msg_21",
  },
} as const;

const dryRunSuccessResponseExample = {
  data: {
    messages: [
      { role: "system", content: "Stay in character and keep the tone warm." },
      { role: "user", content: "Please continue the campfire scene." },
    ],
    token_estimate: 512,
    available_for_reply: 1536,
    memory_summary: "The party recently agreed to search the northern pass.",
    assembly: {
      mode: "preset",
      preset_used: true,
      worldbook_hits: 1,
      regex_pre_rules: ["trim_whitespace"],
      regex_post_rules: [],
      memory_summary_injected: true,
      preprocessed_user_message: "Please continue the campfire scene.",
    },
  },
} as const;

const streamResponseExample = [
  "event: start",
  'data: {"floor_id":"floor_12","floor_no":12,"branch_id":"main"}',
  "",
  "event: chunk",
  'data: {"chunk":"The firelight wavers..."}',
  "",
  "event: done",
  'data: {"floor_id":"floor_12","floor_no":12,"branch_id":"main","generated_text":"The firelight wavers as the next part of the story begins.","summaries":["The group resumes the campfire planning scene."],"total_usage":{"prompt_tokens":320,"completion_tokens":128,"total_tokens":448},"final_state":"committed"}',
].join("\n");

const sessionIdParamsJsonSchema = {
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
} as const;

const idParamsJsonSchema = {
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
} as const;

const turnConfigJsonSchema = {
  type: "object",
  properties: {
    enableDirector: { type: "boolean" },
    enableVerifier: { type: "boolean" },
    enableMemoryConsolidation: { type: "boolean" },
    verifierFailStrategy: { type: "string", enum: ["warn", "block", "retry"] },
    maxRetries: { type: "integer", minimum: 0, maximum: 5 },
  },
  examples: [turnConfigExample],
  additionalProperties: false,
} as const;

const generationParamsJsonSchema = {
  type: "object",
  properties: {
    temperature: { type: "number", minimum: 0, maximum: 2 },
    max_output_tokens: { type: "integer", minimum: 1 },
    top_p: { type: "number", minimum: 0, maximum: 1 },
    top_k: { type: "integer", minimum: 1 },
    frequency_penalty: { type: "number" },
    presence_penalty: { type: "number" },
    stop_sequences: {
      type: "array",
      items: { type: "string" },
    },
    stream: { type: "boolean" },
    reasoning_effort: { type: "string", enum: ["low", "medium", "high"] },
  },
  examples: [generationParamsExample],
  additionalProperties: false,
} as const;

const editAndRegenerateBodyJsonSchema = {
  type: "object",
  required: ["content"],
  properties: {
    content: { type: "string", minLength: 1 },
    branch_id: { type: "string", minLength: 1 },
    config: turnConfigJsonSchema,
    generation_params: generationParamsJsonSchema,
  },
  examples: [editAndRegenerateBodyExample],
  additionalProperties: false,
} as const;

const respondBodyJsonSchema = {
  type: "object",
  required: ["message"],
  properties: {
    message: { type: "string", minLength: 1 },
    config: turnConfigJsonSchema,
    generation_params: generationParamsJsonSchema,
    branch_id: { type: "string", minLength: 1 },
    source_floor_id: { type: "string", minLength: 1 },
  },
  examples: [respondBodyExample],
  additionalProperties: false,
} as const;

const regenerateBodyJsonSchema = {
  type: "object",
  properties: {
    config: turnConfigJsonSchema,
    generation_params: generationParamsJsonSchema,
  },
  examples: [regenerateBodyExample],
  additionalProperties: false,
} as const;

const errorResponseJsonSchema = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message"],
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        details: {},
      },
      additionalProperties: true,
    },
  },
  additionalProperties: false,
} as const;

const usageJsonSchema = {
  type: "object",
  required: ["prompt_tokens", "completion_tokens", "total_tokens"],
  properties: {
    prompt_tokens: { type: "integer", minimum: 0 },
    completion_tokens: { type: "integer", minimum: 0 },
    total_tokens: { type: "integer", minimum: 0 },
  },
  examples: [usageExample],
  additionalProperties: false,
} as const;

const respondDataJsonSchema = {
  type: "object",
  required: ["floor_id", "floor_no", "branch_id", "generated_text", "summaries", "total_usage", "final_state"],
  properties: {
    floor_id: { type: "string" },
    floor_no: { type: "integer", minimum: 0 },
    branch_id: { type: "string" },
    generated_text: { type: "string" },
    summaries: { type: "array", items: { type: "string" } },
    total_usage: usageJsonSchema,
    final_state: { type: "string" },
  },
  examples: [respondDataExample],
  additionalProperties: false,
} as const;

const editAndRegenerateDataJsonSchema = {
  ...respondDataJsonSchema,
  required: [...respondDataJsonSchema.required, "source_floor_id", "source_message_id"],
  properties: {
    ...respondDataJsonSchema.properties,
    source_floor_id: { type: "string" },
    source_message_id: { type: "string" },
  },
  examples: [editAndRegenerateSuccessResponseExample.data],
} as const;

const editAndRegenerateSuccessResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: { data: editAndRegenerateDataJsonSchema },
  examples: [editAndRegenerateSuccessResponseExample],
  additionalProperties: false,
} as const;

const regenerateDataJsonSchema = {
  type: "object",
  required: ["floor_id", "floor_no", "previous_floor_id", "generated_text", "summaries", "total_usage", "final_state"],
  properties: {
    floor_id: { type: "string" },
    floor_no: { type: "integer", minimum: 0 },
    previous_floor_id: { type: "string" },
    generated_text: { type: "string" },
    summaries: { type: "array", items: { type: "string" } },
    total_usage: usageJsonSchema,
    final_state: { type: "string" },
  },
  examples: [regenerateSuccessResponseExample.data],
  additionalProperties: false,
} as const;

const dryRunDataJsonSchema = {
  type: "object",
  required: ["messages", "token_estimate", "available_for_reply", "memory_summary", "assembly"],
  properties: {
    messages: {
      type: "array",
      items: {
        type: "object",
        required: ["role", "content"],
        properties: {
          role: { type: "string", enum: ["system", "user", "assistant"] },
          content: { type: "string" },
        },
        additionalProperties: false,
      },
    },
    token_estimate: { type: "integer", minimum: 0 },
    available_for_reply: { type: "integer", minimum: 0 },
    memory_summary: { anyOf: [{ type: "string" }, { type: "null" }] },
    assembly: {
      type: "object",
      required: [
        "mode",
        "preset_used",
        "worldbook_hits",
        "regex_pre_rules",
        "regex_post_rules",
        "memory_summary_injected",
        "preprocessed_user_message",
      ],
      properties: {
        mode: { type: "string", enum: ["preset", "fallback"] },
        preset_used: { type: "boolean" },
        worldbook_hits: { type: "integer", minimum: 0 },
        regex_pre_rules: { type: "array", items: { type: "string" } },
        regex_post_rules: { type: "array", items: { type: "string" } },
        memory_summary_injected: { type: "boolean" },
        preprocessed_user_message: { anyOf: [{ type: "string" }, { type: "null" }] },
      },
      additionalProperties: false,
    },
  },
  examples: [dryRunSuccessResponseExample.data],
  additionalProperties: false,
} as const;

const respondSuccessResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: respondDataJsonSchema,
  },
  examples: [respondSuccessResponseExample],
  additionalProperties: false,
} as const;

const regenerateSuccessResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: regenerateDataJsonSchema,
  },
  examples: [regenerateSuccessResponseExample],
  additionalProperties: false,
} as const;

const dryRunSuccessResponseJsonSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: dryRunDataJsonSchema,
  },
  examples: [dryRunSuccessResponseExample],
  additionalProperties: false,
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
          assembly: {
            mode: result.assembly.mode,
            preset_used: result.assembly.presetUsed,
            worldbook_hits: result.assembly.worldbookHits,
            regex_pre_rules: result.assembly.regexPreRules,
            regex_post_rules: result.assembly.regexPostRules,
            memory_summary_injected: result.assembly.memorySummaryInjected,
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

    request.raw.on("close", () => {
      if (!completed) {
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
    };

    try {
      const result = await chatService.respond(parsedParams.data.id, respondRequest, runtimeOptions, accountId);

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
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
        500: errorResponseJsonSchema,
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
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
        500: errorResponseJsonSchema,
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
      body: regenerateBodyJsonSchema,
      response: {
        200: respondSuccessResponseJsonSchema,
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
        500: errorResponseJsonSchema,
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
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
        500: errorResponseJsonSchema,
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
      return { statusCode: 400, code: error.code, message: error.message };
    case "invalid_state":
    case "branch_exists":
      return { statusCode: 409, code: error.code, message: error.message };
    case "profile_not_found":
    case "profile_disabled":
      return { statusCode: 409, code: error.code, message: error.message };
    case "secret_unavailable":
      return { statusCode: 503, code: error.code, message: error.message };
    case "orchestration_failed":
      return { statusCode: 500, code: "orchestration_failed", message: error.message };
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
  return sendError(reply, mapped.statusCode, mapped.code, mapped.message);
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
