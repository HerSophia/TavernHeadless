import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { sendError, parseWithSchema } from "../../lib/http.js";
import { errorResponseJsonSchema, idParamsJsonSchema } from "../schemas/common.js";
import { getRequestAuthContext } from "../../plugins/auth.js";
import {
  promptRuntimeAssetsResponseJsonSchema,
  promptRuntimeCompareBodyJsonSchema,
  promptRuntimeCompareResponseJsonSchema,
  promptRuntimeCapabilitiesResponseJsonSchema,
  promptRuntimePolicyViewResponseJsonSchema,
  promptRuntimeHistoricalExplainResponseJsonSchema,
  promptRuntimePolicyPatchBodyJsonSchema,
  promptRuntimePreviewBodyJsonSchema,
  promptRuntimeInspectBodyJsonSchema,
  promptRuntimeInspectResponseJsonSchema,
  promptRuntimePreviewResponseJsonSchema,
  promptRuntimeResolvedStateResponseJsonSchema,
} from "../schemas/prompt-runtime-schemas.js";
import {
  PROMPT_RUNTIME_SUPPORTED_ASSISTANT_REWRITE_STRATEGIES,
  PROMPT_RUNTIME_SUPPORTED_SOURCE_SELECTION_HISTORY_MODES,
  PROMPT_RUNTIME_SUPPORTED_STRUCTURE_MODES,
  PROMPT_RUNTIME_SUPPORTED_VISIBILITY_MODES,
  PromptRuntimeControlService,
  PromptRuntimeControlServiceError,
  type PromptRuntimeAssetsView,
  type PromptRuntimeCapabilities,
  type PromptRuntimeDebugPolicy,
  type PromptRuntimeExplainDiff,
  type PromptRuntimePersistentPolicy,
  type PromptRuntimePolicyView,
  type PromptRuntimeHistoricalExplain,
  type PromptRuntimePersistentPolicyPatch,
  type PromptRuntimeResolvedState,
  type ResolvedPromptDeliveryPolicy,
  type ResolvedPromptRuntimePolicy,
  type ResolvedPromptStructurePolicy,
} from "../../services/prompt-runtime/control-service.js";
import { ChatServiceError } from "../../services/chat/errors.js";
import { isBranchLocalSnapshotMissingError } from "../../services/branch-local-variable-snapshot-service.js";
import type {
  PromptRuntimePreviewRequest,
  PromptRuntimePreviewResult,
} from "../../services/chat/contracts.js";
import type {
  PromptRuntimeInspectRequest,
  PromptRuntimeInspectResult,
} from "../../services/prompt-runtime/types.js";
import { promptRuntimeInspectBodySchema } from "./schemas.js";
import { mapPromptRuntimeInspectBodyToCamelCase } from "./mappers.js";
import { mapPromptRuntimeInspectResultToSnakeCase } from "./presenters.js";
import { sendPromptRuntimeInspectServiceError } from "./errors.js";

const sessionIdParamsSchema = z.object({
  id: z.string().min(1),
});

const sessionPromptRuntimeQuerySchema = z.object({
  branch_id: z.string().min(1).optional(),
}).strict();

const sessionBranchParamsSchema = z.object({
  id: z.string().min(1),
  branchId: z.string().min(1),
});

const promptRuntimeVisibilitySchema = z.object({
  hidden_floor_ranges: z.array(z.object({
    start_floor_no: z.number().int(),
    end_floor_no: z.number().int(),
  }).strict()).optional(),
  visible_floor_ranges: z.array(z.object({
    start_floor_no: z.number().int(),
    end_floor_no: z.number().int(),
  }).strict()).optional(),
  hidden_floor_ids: z.array(z.string().min(1)).optional(),
  mode: z.enum(PROMPT_RUNTIME_SUPPORTED_VISIBILITY_MODES).optional(),
}).strict();

const promptRuntimePolicyPatchBodySchema = z.object({
  structure: z.object({
    mode: z.enum(PROMPT_RUNTIME_SUPPORTED_STRUCTURE_MODES),
    merge_adjacent_same_role: z.boolean().optional(),
    assistant_rewrite_strategy: z.enum(PROMPT_RUNTIME_SUPPORTED_ASSISTANT_REWRITE_STRATEGIES).optional(),
    preserve_system_messages: z.boolean().optional(),
  }).strict().nullable().optional(),
  delivery: z.object({
    allow_assistant_prefill: z.boolean().optional(),
    require_last_user: z.boolean().optional(),
    no_assistant: z.boolean().optional(),
  }).strict().nullable().optional(),
  budget: z.object({
    max_input_tokens: z.number().int().positive().optional(),
    reserved_completion_tokens: z.number().int().positive().optional(),
  }).strict().nullable().optional(),
  source_selection: z.object({
    history: z.object({
      mode: z.enum(PROMPT_RUNTIME_SUPPORTED_SOURCE_SELECTION_HISTORY_MODES).optional(),
      max_messages: z.number().int().positive().optional(),
    }).strict().optional(),
    memory: z.object({ enabled: z.boolean().optional() }).strict().optional(),
    worldbook: z.object({ enabled: z.boolean().optional() }).strict().optional(),
    examples: z.object({ enabled: z.boolean().optional() }).strict().optional(),
  }).strict().nullable().optional(),
  visibility: promptRuntimeVisibilitySchema.nullable().optional(),
}).strict().refine(
  (value) => value.structure !== undefined
    || value.delivery !== undefined
    || value.budget !== undefined
    || value.source_selection !== undefined
    || value.visibility !== undefined,
  "At least one mutable field is required",
);

const promptRuntimeCompareBodySchema = z.object({
  left: z.object({ floor_id: z.string().min(1) }).strict(),
  right: z.object({ floor_id: z.string().min(1) }).strict(),
}).strict();

const promptRuntimePreviewBodySchema = z.object({
  text: z.string().min(1),
  branch_id: z.string().min(1).optional(),
  source_floor_id: z.string().min(1).optional(),
  visibility: promptRuntimeVisibilitySchema.optional(),
  structure: z.object({
    mode: z.enum(PROMPT_RUNTIME_SUPPORTED_STRUCTURE_MODES),
    merge_adjacent_same_role: z.boolean().optional(),
    assistant_rewrite_strategy: z.enum(PROMPT_RUNTIME_SUPPORTED_ASSISTANT_REWRITE_STRATEGIES).optional(),
    preserve_system_messages: z.boolean().optional(),
  }).strict().optional(),
  delivery: z.object({
    allow_assistant_prefill: z.boolean().optional(),
    require_last_user: z.boolean().optional(),
    no_assistant: z.boolean().optional(),
  }).strict().optional(),
  budget: z.object({
    max_input_tokens: z.number().int().positive().optional(),
    reserved_completion_tokens: z.number().int().positive().optional(),
  }).strict().optional(),
  source_selection: z.object({
    history: z.object({
      mode: z.enum(PROMPT_RUNTIME_SUPPORTED_SOURCE_SELECTION_HISTORY_MODES).optional(),
      max_messages: z.number().int().positive().optional(),
    }).strict().optional(),
    memory: z.object({ enabled: z.boolean().optional() }).strict().optional(),
    worldbook: z.object({ enabled: z.boolean().optional() }).strict().optional(),
    examples: z.object({ enabled: z.boolean().optional() }).strict().optional(),
  }).strict().optional(),
}).strict();

interface RegisterPromptRuntimeRoutesOptions {
  previewService?: {
    previewPromptRuntimeText(sessionId: string, request: PromptRuntimePreviewRequest, accountId?: string): Promise<PromptRuntimePreviewResult>;
  };
  inspectService?: {
    inspectPromptRuntime(sessionId: string, request: PromptRuntimeInspectRequest, accountId?: string): Promise<PromptRuntimeInspectResult>;
  };
}

export async function registerPromptRuntimeRoutes(
  app: FastifyInstance,
  promptRuntimeControlService: PromptRuntimeControlService,
  options: RegisterPromptRuntimeRoutesOptions = {},
): Promise<void> {
  app.get("/sessions/:id/prompt-runtime", {
    schema: {
      tags: ["prompt-runtime"],
      summary: "Get session prompt runtime resolved state",
      operationId: "getSessionPromptRuntime",
      params: idParamsJsonSchema,
      querystring: { type: "object", properties: { branch_id: { type: "string", minLength: 1 } }, additionalProperties: false },
      response: {
        200: promptRuntimeResolvedStateResponseJsonSchema,
        404: errorResponseJsonSchema,
        500: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(sessionIdParamsSchema, request.params, reply);
    if (!parsedParams.ok) {
      return;
    }
    const parsedQuery = parseWithSchema(sessionPromptRuntimeQuerySchema, request.query, reply);
    if (!parsedQuery.ok) {
      return;
    }

    try {
      const auth = getRequestAuthContext(request);
      const state = await promptRuntimeControlService.getResolvedState(parsedParams.data.id, auth.accountId, parsedQuery.data.branch_id);
      return reply.send({ data: mapResolvedStateToSnakeCase(state) });
    } catch (error) {
      return sendPromptRuntimeControlServiceError(reply, error);
    }
  });

  app.get("/sessions/:id/prompt-runtime/policy", {
    schema: {
      tags: ["prompt-runtime"],
      summary: "Get session prompt runtime persistent and resolved policy",
      operationId: "getSessionPromptRuntimePolicy",
      params: idParamsJsonSchema,
      response: {
        200: promptRuntimePolicyViewResponseJsonSchema,
        404: errorResponseJsonSchema,
        500: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(sessionIdParamsSchema, request.params, reply);
    if (!parsedParams.ok) {
      return;
    }

    try {
      const auth = getRequestAuthContext(request);
      const policy = await promptRuntimeControlService.getPolicy(parsedParams.data.id, auth.accountId);
      return reply.send({ data: mapPolicyViewToSnakeCase(policy) });
    } catch (error) {
      return sendPromptRuntimeControlServiceError(reply, error);
    }
  });

  app.patch("/sessions/:id/prompt-runtime/policy", {
    schema: {
      tags: ["prompt-runtime"],
      summary: "Patch session prompt runtime persistent policy",
      operationId: "patchSessionPromptRuntimePolicy",
      params: idParamsJsonSchema,
      body: promptRuntimePolicyPatchBodyJsonSchema,
      response: {
        200: promptRuntimePolicyViewResponseJsonSchema,
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        500: errorResponseJsonSchema,
      },
    },
    preValidation: async (request, reply) => {
      const parsedBody = parseWithSchema(promptRuntimePolicyPatchBodySchema, request.body, reply);
      if (!parsedBody.ok) {
        return reply;
      }

      (request as typeof request & { body: z.infer<typeof promptRuntimePolicyPatchBodySchema> }).body = parsedBody.data;
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(sessionIdParamsSchema, request.params, reply);
    if (!parsedParams.ok) {
      return;
    }
    const parsedBody = parseWithSchema(promptRuntimePolicyPatchBodySchema, request.body, reply);
    if (!parsedBody.ok) {
      return;
    }

    try {
      const auth = getRequestAuthContext(request);
      const policy = await promptRuntimeControlService.updatePolicy(
        parsedParams.data.id,
        auth.accountId,
        mapPolicyPatchBodyToCamelCase(parsedBody.data),
        auth.subject ?? auth.accountId,
      );
      return reply.send({ data: mapPolicyViewToSnakeCase(policy) });
    } catch (error) {
      return sendPromptRuntimeControlServiceError(reply, error);
    }
  });

  app.get("/sessions/:id/prompt-runtime/branches/:branchId/policy", {
    schema: {
      tags: ["prompt-runtime"],
      summary: "Get branch prompt runtime persistent and resolved policy",
      operationId: "getSessionPromptRuntimeBranchPolicy",
      params: {
        type: "object",
        required: ["id", "branchId"],
        properties: {
          id: { type: "string", minLength: 1 },
          branchId: { type: "string", minLength: 1 },
        },
        additionalProperties: false,
      },
      response: {
        200: promptRuntimePolicyViewResponseJsonSchema,
        404: errorResponseJsonSchema,
        500: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(sessionBranchParamsSchema, request.params, reply);
    if (!parsedParams.ok) {
      return;
    }

    try {
      const auth = getRequestAuthContext(request);
      const policy = await promptRuntimeControlService.getBranchPolicy(parsedParams.data.id, parsedParams.data.branchId, auth.accountId);
      return reply.send({ data: mapPolicyViewToSnakeCase(policy) });
    } catch (error) {
      return sendPromptRuntimeControlServiceError(reply, error);
    }
  });

  app.patch("/sessions/:id/prompt-runtime/branches/:branchId/policy", {
    schema: {
      tags: ["prompt-runtime"],
      summary: "Patch branch prompt runtime persistent policy",
      operationId: "patchSessionPromptRuntimeBranchPolicy",
      params: {
        type: "object",
        required: ["id", "branchId"],
        properties: {
          id: { type: "string", minLength: 1 },
          branchId: { type: "string", minLength: 1 },
        },
        additionalProperties: false,
      },
      body: promptRuntimePolicyPatchBodyJsonSchema,
      response: {
        200: promptRuntimePolicyViewResponseJsonSchema,
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        500: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(sessionBranchParamsSchema, request.params, reply);
    if (!parsedParams.ok) {
      return;
    }
    const parsedBody = parseWithSchema(promptRuntimePolicyPatchBodySchema, request.body, reply);
    if (!parsedBody.ok) {
      return;
    }

    try {
      const auth = getRequestAuthContext(request);
      const policy = await promptRuntimeControlService.updateBranchPolicy(
        parsedParams.data.id,
        parsedParams.data.branchId,
        auth.accountId,
        mapPolicyPatchBodyToCamelCase(parsedBody.data),
        auth.subject ?? auth.accountId,
      );
      return reply.send({ data: mapPolicyViewToSnakeCase(policy) });
    } catch (error) {
      return sendPromptRuntimeControlServiceError(reply, error);
    }
  });

  app.get("/sessions/:id/prompt-runtime/assets", {
    schema: {
      tags: ["prompt-runtime"],
      summary: "Get session prompt runtime asset bindings",
      operationId: "getSessionPromptRuntimeAssets",
      params: idParamsJsonSchema,
      response: {
        200: promptRuntimeAssetsResponseJsonSchema,
        404: errorResponseJsonSchema,
        500: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(sessionIdParamsSchema, request.params, reply);
    if (!parsedParams.ok) {
      return;
    }

    try {
      const auth = getRequestAuthContext(request);
      const assets = await promptRuntimeControlService.getAssets(parsedParams.data.id, auth.accountId);
      return reply.send({ data: mapAssetsViewToSnakeCase(assets) });
    } catch (error) {
      return sendPromptRuntimeControlServiceError(reply, error);
    }
  });

  app.post("/sessions/:id/prompt-runtime/preview", {
    schema: {
      tags: ["prompt-runtime"],
      summary: "Preview macro resolution for a single text segment (macro_text_preview)",
      description: "Resolves macros, source_selection, and visibility against the current session state for one ad-hoc text segment. This is a macro_text_preview sub-view, not a full runtime preview: it does not run prompt assembly, budget allocation, or delivery materialization, and it never creates floors, writes prompt snapshots, or calls an LLM.",
      operationId: "previewSessionPromptRuntime",
      params: idParamsJsonSchema,
      body: promptRuntimePreviewBodyJsonSchema,
      response: {
        200: promptRuntimePreviewResponseJsonSchema,
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
        500: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    if (!options.previewService) {
      return sendError(reply, 404, "not_found", "Prompt runtime preview endpoint is disabled");
    }

    const parsedParams = parseWithSchema(sessionIdParamsSchema, request.params, reply);
    if (!parsedParams.ok) {
      return;
    }
    const parsedBody = parseWithSchema(promptRuntimePreviewBodySchema, request.body, reply);
    if (!parsedBody.ok) {
      return;
    }

    try {
      const auth = getRequestAuthContext(request);
      const result = await options.previewService.previewPromptRuntimeText(parsedParams.data.id, mapPreviewBodyToCamelCase(parsedBody.data), auth.accountId);
      return reply.send({ data: mapPreviewResultToSnakeCase(result) });
    } catch (error) {
      return sendPromptRuntimePreviewServiceError(reply, error);
    }
  });

  app.post("/sessions/:id/prompt-runtime/inspect", {
    schema: {
      tags: ["prompt-runtime"],
      summary: "Inspect branch-aware prepared prompt turn without side effects",
      description: "Builds the full prepared-turn prompt view for a branch-aware request without calling an LLM, creating floors, staging session state writes, or committing any side effects.",
      operationId: "inspectSessionPromptRuntime",
      params: idParamsJsonSchema,
      body: promptRuntimeInspectBodyJsonSchema,
      response: {
        200: promptRuntimeInspectResponseJsonSchema,
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
        500: errorResponseJsonSchema,
        503: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    if (!options.inspectService) {
      return sendError(reply, 404, "not_found", "Prompt runtime inspect endpoint is disabled");
    }

    const parsedParams = parseWithSchema(sessionIdParamsSchema, request.params, reply);
    if (!parsedParams.ok) {
      return;
    }
    const parsedBody = parseWithSchema(promptRuntimeInspectBodySchema, request.body, reply);
    if (!parsedBody.ok) {
      return;
    }

    try {
      const auth = getRequestAuthContext(request);
      const result = await options.inspectService.inspectPromptRuntime(parsedParams.data.id, mapPromptRuntimeInspectBodyToCamelCase(parsedBody.data), auth.accountId);
      return reply.send({ data: mapPromptRuntimeInspectResultToSnakeCase(result) });
    } catch (error) {
      return sendPromptRuntimeInspectServiceError(reply, error);
    }
  });

  app.get("/floors/:id/prompt-runtime/explain", {
    schema: {
      tags: ["prompt-runtime"],
      summary: "Explain committed floor prompt runtime from persisted truth",
      description: "Returns prompt runtime facts that were actually persisted when this floor was committed. It never re-runs prompt assembly, macro evaluation, or budget decisions. If the floor was committed before the explain snapshot feature existed, resolved policy, source map, trim reasons, excluded sources, and section stats may be returned as null.",
      operationId: "getFloorPromptRuntimeExplain",
      params: idParamsJsonSchema,
      response: {
        200: promptRuntimeHistoricalExplainResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
        500: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(sessionIdParamsSchema, request.params, reply);
    if (!parsedParams.ok) {
      return;
    }

    try {
      const auth = getRequestAuthContext(request);
      const explain = await promptRuntimeControlService.getHistoricalExplain(parsedParams.data.id, auth.accountId);
      return reply.send({ data: mapHistoricalExplainToSnakeCase(explain) });
    } catch (error) {
      return sendPromptRuntimeControlServiceError(reply, error);
    }
  });

  app.post("/sessions/:id/prompt-runtime/compare", {
    schema: {
      tags: ["prompt-runtime"],
      summary: "Compare committed floor prompt runtime snapshots",
      operationId: "compareSessionPromptRuntime",
      params: idParamsJsonSchema,
      body: promptRuntimeCompareBodyJsonSchema,
      response: {
        200: promptRuntimeCompareResponseJsonSchema,
        400: errorResponseJsonSchema,
        404: errorResponseJsonSchema,
        409: errorResponseJsonSchema,
        500: errorResponseJsonSchema,
      },
    },
  }, async (request, reply) => {
    const parsedParams = parseWithSchema(sessionIdParamsSchema, request.params, reply);
    if (!parsedParams.ok) {
      return;
    }
    const parsedBody = parseWithSchema(promptRuntimeCompareBodySchema, request.body, reply);
    if (!parsedBody.ok) {
      return;
    }

    try {
      const auth = getRequestAuthContext(request);
      const diff = await promptRuntimeControlService.compareCommittedExplain(
        parsedParams.data.id,
        parsedBody.data.left.floor_id,
        parsedBody.data.right.floor_id,
        auth.accountId,
      );
      return reply.send({ data: mapExplainDiffToSnakeCase(diff) });
    } catch (error) {
      return sendPromptRuntimeControlServiceError(reply, error);
    }
  });

  app.get("/prompt-runtime/capabilities", {
    schema: {
      tags: ["prompt-runtime"],
      summary: "Get prompt runtime capabilities and boundaries",
      operationId: "getPromptRuntimeCapabilities",
      response: {
        200: promptRuntimeCapabilitiesResponseJsonSchema,
        500: errorResponseJsonSchema,
      },
    },
  }, async (_request, reply) => {
    return reply.send({ data: mapCapabilitiesToSnakeCase(promptRuntimeControlService.getCapabilities()) });
  });
}

function mapResolvedStateToSnakeCase(state: PromptRuntimeResolvedState): Record<string, unknown> {
  return {
    scope: mapScopeToSnakeCase(state.scope),
    policy: mapResolvedPolicyToSnakeCase(state.policy),
    ...(state.persistentPolicy ? { persistent_policy: mapPersistentPolicyToSnakeCase(state.persistentPolicy) } : {}),
    ...(state.persistentPolicyEnvelope !== undefined
      ? { persistent_policy_envelope: mapPersistedPolicyEnvelopeToSnakeCase(state.persistentPolicyEnvelope) }
      : {}),
    branch_persistent_policy: state.branchPersistentPolicy
      ? mapPersistentPolicyToSnakeCase(state.branchPersistentPolicy)
      : null,
    ...(state.branchPersistentPolicyEnvelope !== undefined
      ? { branch_persistent_policy_envelope: mapPersistedPolicyEnvelopeToSnakeCase(state.branchPersistentPolicyEnvelope) }
      : {}),
    assets: mapAssetsViewToSnakeCase(state.assets),
    warnings: state.warnings,
    diagnostics: state.diagnostics.map((diagnostic) => mapDiagnosticToSnakeCase(diagnostic)),
    limitations: state.limitations,
    ...(state.sourceMap ? { source_map: mapSourceMapToSnakeCase(state.sourceMap) } : {}),
  };
}

function mapPolicyViewToSnakeCase(view: PromptRuntimePolicyView): Record<string, unknown> {
  return {
    ...(view.persistentPolicy ? { persistent_policy: mapPersistentPolicyToSnakeCase(view.persistentPolicy) } : {}),
    ...(view.persistentPolicyEnvelope !== undefined
      ? { persistent_policy_envelope: mapPersistedPolicyEnvelopeToSnakeCase(view.persistentPolicyEnvelope) }
      : {}),
    resolved_policy: mapResolvedPolicyToSnakeCase(view.resolvedPolicy),
    warnings: view.warnings,
  };
}

function mapPolicyPatchBodyToCamelCase(body: z.infer<typeof promptRuntimePolicyPatchBodySchema>): PromptRuntimePersistentPolicyPatch {
  return {
    ...(body.structure !== undefined
      ? {
          structure: body.structure === null
            ? null
            : {
                mode: body.structure.mode,
                ...(body.structure.merge_adjacent_same_role !== undefined ? { mergeAdjacentSameRole: body.structure.merge_adjacent_same_role } : {}),
                ...(body.structure.assistant_rewrite_strategy !== undefined ? { assistantRewriteStrategy: body.structure.assistant_rewrite_strategy } : {}),
                ...(body.structure.preserve_system_messages !== undefined ? { preserveSystemMessages: body.structure.preserve_system_messages } : {}),
              },
        }
      : {}),
    ...(body.delivery !== undefined
      ? {
          delivery: body.delivery === null ? null : {
            ...(body.delivery.allow_assistant_prefill !== undefined ? { allowAssistantPrefill: body.delivery.allow_assistant_prefill } : {}),
            ...(body.delivery.require_last_user !== undefined ? { requireLastUser: body.delivery.require_last_user } : {}),
            ...(body.delivery.no_assistant !== undefined ? { noAssistant: body.delivery.no_assistant } : {}),
          },
        }
      : {}),
    ...(body.budget !== undefined
      ? {
          budget: body.budget === null ? null : {
            ...(body.budget.max_input_tokens !== undefined ? { maxInputTokens: body.budget.max_input_tokens } : {}),
            ...(body.budget.reserved_completion_tokens !== undefined ? { reservedCompletionTokens: body.budget.reserved_completion_tokens } : {}),
          },
        }
      : {}),
    ...(body.source_selection !== undefined
      ? {
          sourceSelection: body.source_selection === null ? null : {
            ...(body.source_selection.history !== undefined
              ? {
                  history: {
                    ...(body.source_selection.history.mode !== undefined ? { mode: body.source_selection.history.mode } : {}),
                    ...(body.source_selection.history.max_messages !== undefined ? { maxMessages: body.source_selection.history.max_messages } : {}),
                  },
                }
              : {}),
            ...(body.source_selection.memory !== undefined ? { memory: { ...(body.source_selection.memory.enabled !== undefined ? { enabled: body.source_selection.memory.enabled } : {}) } } : {}),
            ...(body.source_selection.worldbook !== undefined ? { worldbook: { ...(body.source_selection.worldbook.enabled !== undefined ? { enabled: body.source_selection.worldbook.enabled } : {}) } } : {}),
            ...(body.source_selection.examples !== undefined ? { examples: { ...(body.source_selection.examples.enabled !== undefined ? { enabled: body.source_selection.examples.enabled } : {}) } } : {}),
          },
        }
      : {}),
    ...(body.visibility !== undefined
      ? {
          visibility: body.visibility === null
            ? null
            : {
                ...(body.visibility.hidden_floor_ranges !== undefined
                  ? {
                      hiddenFloorRanges: body.visibility.hidden_floor_ranges.map((range) => ({
                        startFloorNo: range.start_floor_no,
                        endFloorNo: range.end_floor_no,
                      })),
                    }
                  : {}),
                ...(body.visibility.visible_floor_ranges !== undefined ? { visibleFloorRanges: body.visibility.visible_floor_ranges.map((range) => ({ startFloorNo: range.start_floor_no, endFloorNo: range.end_floor_no })) } : {}),
                ...(body.visibility.hidden_floor_ids !== undefined ? { hiddenFloorIds: body.visibility.hidden_floor_ids } : {}),
                ...(body.visibility.mode !== undefined ? { mode: body.visibility.mode } : {}),
              },
        }
      : {}),
  };
}

function mapPreviewBodyToCamelCase(body: z.infer<typeof promptRuntimePreviewBodySchema>): PromptRuntimePreviewRequest {
  return {
    text: body.text,
    ...(body.branch_id !== undefined ? { branchId: body.branch_id } : {}),
    ...(body.source_floor_id !== undefined ? { sourceFloorId: body.source_floor_id } : {}),
    ...(body.visibility !== undefined
      ? {
          visibility: {
            ...(body.visibility.hidden_floor_ranges !== undefined
              ? {
                  hiddenFloorRanges: body.visibility.hidden_floor_ranges.map((range) => ({
                    startFloorNo: range.start_floor_no,
                    endFloorNo: range.end_floor_no,
                  })),
                }
              : {}),
            ...(body.visibility.visible_floor_ranges !== undefined
              ? {
                  visibleFloorRanges: body.visibility.visible_floor_ranges.map((range) => ({
                    startFloorNo: range.start_floor_no,
                    endFloorNo: range.end_floor_no,
                  })),
                }
              : {}),
            ...(body.visibility.hidden_floor_ids !== undefined ? { hiddenFloorIds: body.visibility.hidden_floor_ids } : {}),
            ...(body.visibility.mode !== undefined ? { mode: body.visibility.mode } : {}),
          },
        }
      : {}),
    ...(body.structure !== undefined
      ? {
          structure: {
            mode: body.structure.mode,
            ...(body.structure.merge_adjacent_same_role !== undefined ? { mergeAdjacentSameRole: body.structure.merge_adjacent_same_role } : {}),
            ...(body.structure.assistant_rewrite_strategy !== undefined ? { assistantRewriteStrategy: body.structure.assistant_rewrite_strategy } : {}),
            ...(body.structure.preserve_system_messages !== undefined ? { preserveSystemMessages: body.structure.preserve_system_messages } : {}),
          },
        }
      : {}),
    ...(body.delivery !== undefined
      ? {
          delivery: {
            ...(body.delivery.allow_assistant_prefill !== undefined ? { allowAssistantPrefill: body.delivery.allow_assistant_prefill } : {}),
            ...(body.delivery.require_last_user !== undefined ? { requireLastUser: body.delivery.require_last_user } : {}),
            ...(body.delivery.no_assistant !== undefined ? { noAssistant: body.delivery.no_assistant } : {}),
          },
        }
      : {}),
    ...(body.budget !== undefined
      ? {
          budget: {
            ...(body.budget.max_input_tokens !== undefined ? { maxInputTokens: body.budget.max_input_tokens } : {}),
            ...(body.budget.reserved_completion_tokens !== undefined ? { reservedCompletionTokens: body.budget.reserved_completion_tokens } : {}),
          },
        }
      : {}),
    ...(body.source_selection !== undefined
      ? {
          sourceSelection: {
            ...(body.source_selection.history !== undefined
              ? {
                  history: {
                    ...(body.source_selection.history.mode !== undefined ? { mode: body.source_selection.history.mode } : {}),
                    ...(body.source_selection.history.max_messages !== undefined ? { maxMessages: body.source_selection.history.max_messages } : {}),
                  },
                }
              : {}),
            ...(body.source_selection.memory !== undefined ? { memory: { ...(body.source_selection.memory.enabled !== undefined ? { enabled: body.source_selection.memory.enabled } : {}) } } : {}),
            ...(body.source_selection.worldbook !== undefined ? { worldbook: { ...(body.source_selection.worldbook.enabled !== undefined ? { enabled: body.source_selection.worldbook.enabled } : {}) } } : {}),
            ...(body.source_selection.examples !== undefined ? { examples: { ...(body.source_selection.examples.enabled !== undefined ? { enabled: body.source_selection.examples.enabled } : {}) } } : {}),
          },
        }
      : {}),
  };
}

function mapPreviewResultToSnakeCase(result: PromptRuntimePreviewResult): Record<string, unknown> {
  return {
    scope: mapScopeToSnakeCase(result.scope),
    policy: mapResolvedPolicyToSnakeCase(result.policy),
    diagnostics: result.diagnostics.map((diagnostic) => mapDiagnosticToSnakeCase(diagnostic)),
    limitations: result.limitations,
    ...(result.sourceMap ? { source_map: mapSourceMapToSnakeCase(result.sourceMap) } : {}),
    text: result.text,
    runtime_trace: mapPreviewRuntimeTraceToSnakeCase(result.runtimeTrace),
  };
}

function mapHistoricalExplainToSnakeCase(explain: PromptRuntimeHistoricalExplain): Record<string, unknown> {
  return {
    floor: {
      id: explain.floor.id,
      session_id: explain.floor.sessionId,
      floor_no: explain.floor.floorNo,
      branch_id: explain.floor.branchId,
      parent_floor_id: explain.floor.parentFloorId,
      state: explain.floor.state,
      prompt_snapshot_created_at: explain.floor.promptSnapshotCreatedAt,
      committed_at: explain.floor.committedAt,
    },
    scope: mapScopeToSnakeCase(explain.scope),
    snapshot_available: explain.snapshotAvailable,
    assets: explain.assets ? mapAssetsViewToSnakeCase(explain.assets) : null,
    prompt_snapshot: mapPromptSnapshotToSnakeCase(explain.promptSnapshot),
    resolved_policy: explain.resolvedPolicy ? mapResolvedPolicyToSnakeCase(explain.resolvedPolicy) : null,
    governance: explain.governance ? mapUnknownKeysToSnakeCase(explain.governance) : null,
    ...(explain.sourceMap ? { source_map: mapSourceMapToSnakeCase(explain.sourceMap) } : {}),
    trim_reasons: explain.trimReasons
      ? explain.trimReasons.map((reason) => ({
          group: reason.group,
          reason: reason.reason,
          ...(reason.detail ? { detail: reason.detail } : {}),
          ...(reason.prunedTokenCount !== undefined ? { pruned_token_count: reason.prunedTokenCount } : {}),
        }))
      : null,
    excluded_sources: explain.excludedSources
      ? explain.excludedSources.map((item) => ({ source: item.source, reason: item.reason, ...(item.detail ? { detail: item.detail } : {}) }))
      : null,
    section_stats: explain.sectionStats ? explain.sectionStats.map((item) => mapSectionStatToSnakeCase(item)) : null,
    diagnostics: explain.diagnostics.map((diagnostic) => mapDiagnosticToSnakeCase(diagnostic)),
    limitations: explain.limitations,
    result: mapHistoricalExplainResultToSnakeCase(explain.result),
  };
}

function mapExplainDiffToSnakeCase(diff: PromptRuntimeExplainDiff): Record<string, unknown> {
  return {
    left: {
      floor_id: diff.left.floorId,
      snapshot_available: diff.left.snapshotAvailable,
    },
    right: {
      floor_id: diff.right.floorId,
      snapshot_available: diff.right.snapshotAvailable,
    },
    scope_changes: diff.scopeChanges.map((entry) => mapDiffEntryToSnakeCase(entry)),
    policy_changes: diff.policyChanges.map((entry) => mapDiffEntryToSnakeCase(entry)),
    asset_changes: diff.assetChanges.map((entry) => mapDiffEntryToSnakeCase(entry)),
    diagnostics_changes: diff.diagnosticsChanges.map((entry) => mapDiffEntryToSnakeCase(entry)),
    trim_changes: diff.trimChanges.map((entry) => mapDiffEntryToSnakeCase(entry)),
    exclusion_changes: diff.exclusionChanges.map((entry) => mapDiffEntryToSnakeCase(entry)),
    governance_changes: diff.governanceChanges.map((entry) => mapDiffEntryToSnakeCase(entry)),
    limitations: diff.limitations,
  };
}

function mapPreviewRuntimeTraceToSnakeCase(runtimeTrace: PromptRuntimePreviewResult["runtimeTrace"]): Record<string, unknown> {
  return {
    ...(runtimeTrace.macro ? { macro: mapPreviewMacroTraceToSnakeCase(runtimeTrace.macro) } : {}),
    ...(runtimeTrace.visibility
      ? {
          visibility: {
            ...(runtimeTrace.visibility.hiddenFloorRanges
              ? {
                  hidden_floor_ranges: runtimeTrace.visibility.hiddenFloorRanges.map((range) => ({
                    start_floor_no: range.startFloorNo,
                    end_floor_no: range.endFloorNo,
                  })),
                }
              : {}),
            filtered_floor_nos: runtimeTrace.visibility.filteredFloorNos,
          },
        }
      : {}),
    ...(runtimeTrace.sourceSelection
      ? {
          source_selection: {
            excluded_sources: runtimeTrace.sourceSelection.excludedSources.map((item) => ({
              source: item.source,
              reason: item.reason,
              ...(item.detail ? { detail: item.detail } : {}),
            })),
          },
        }
      : {}),
  };
}

function mapPreviewMacroTraceToSnakeCase(macro: NonNullable<PromptRuntimePreviewResult["runtimeTrace"]["macro"]>): Record<string, unknown> {
  return {
    warnings: macro.warnings.map((warning) => ({
      code: warning.code,
      message: warning.message,
      ...(warning.macroName ? { macro_name: warning.macroName } : {}),
      ...(warning.rawText ? { raw_text: warning.rawText } : {}),
    })),
    used_names: macro.usedNames,
    mutation_preview: macro.mutationPreview.map((preview) => ({
      kind: preview.kind,
      scope: preview.scope,
      key: preview.key,
      ...(preview.value !== undefined ? { value: preview.value } : {}),
    })),
    staged_mutations: macro.stagedMutations.map((mutation) => ({
      kind: mutation.kind,
      scope: mutation.scope,
      key: mutation.key,
      ...(mutation.value !== undefined ? { value: mutation.value } : {}),
      source_macro: mutation.sourceMacro,
    })),
    traces: macro.traces.map((trace) => mapPreviewMacroTraceEntryToSnakeCase(trace)),
  };
}

function mapPreviewMacroTraceEntryToSnakeCase(trace: NonNullable<PromptRuntimePreviewResult["runtimeTrace"]["macro"]>["traces"][number]): Record<string, unknown> {
  return {
    macro_name: trace.macroName,
    raw_text: trace.rawText,
    resolved_text: trace.resolvedText,
    ...(trace.phase ? { phase: trace.phase } : {}),
    ...(trace.sourceKind ? { source_kind: trace.sourceKind } : {}),
    ...(trace.selectedBranch ? { selected_branch: trace.selectedBranch } : {}),
  };
}

function mapPersistentPolicyToSnakeCase(policy: PromptRuntimePersistentPolicy): Record<string, unknown> {
  return {
    ...(policy.structure ? { structure: mapStructurePolicyToSnakeCase(policy.structure) } : {}),
    ...(policy.delivery ? { delivery: mapDeliveryPolicyToSnakeCase(policy.delivery) } : {}),
    ...(policy.budget ? { budget: mapBudgetPolicyToSnakeCase(policy.budget) } : {}),
    ...(policy.sourceSelection ? { source_selection: mapSourceSelectionPolicyToSnakeCase(policy.sourceSelection) } : {}),
    ...(policy.visibility ? { visibility: mapVisibilityPolicyToSnakeCase(policy.visibility) } : {}),
  };
}

function mapPersistedPolicyEnvelopeToSnakeCase(
  envelope: PromptRuntimePolicyView["persistentPolicyEnvelope"] | PromptRuntimeResolvedState["persistentPolicyEnvelope"] | PromptRuntimeResolvedState["branchPersistentPolicyEnvelope"],
): Record<string, unknown> | null {
  if (!envelope) {
    return null;
  }

  return {
    version: envelope.version,
    updated_at: envelope.updatedAt,
    updated_by: envelope.updatedBy ?? null,
    value: mapPersistentPolicyToSnakeCase(envelope.value),
  };
}

function mapSectionStatToSnakeCase(item: { sectionName: string; tokenCount: number }): Record<string, unknown> {
  return {
    section_name: item.sectionName,
    token_count: item.tokenCount,
  };
}

function mapDiffEntryToSnakeCase(entry: { path: string; changeType: string; left?: unknown; right?: unknown }): Record<string, unknown> {
  return {
    path: toSnakeCasePath(entry.path),
    change_type: entry.changeType,
    ...(entry.left !== undefined ? { left: mapUnknownKeysToSnakeCase(entry.left) } : {}),
    ...(entry.right !== undefined ? { right: mapUnknownKeysToSnakeCase(entry.right) } : {}),
  };
}

function mapUnknownKeysToSnakeCase(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => mapUnknownKeysToSnakeCase(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [
      toSnakeCaseName(key),
      mapUnknownKeysToSnakeCase(nestedValue),
    ]),
  );
}

function toSnakeCasePath(path: string): string {
  return path.split(".").map((segment) => toSnakeCaseName(segment)).join(".");
}

function toSnakeCaseName(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

function mapResolvedPolicyToSnakeCase(policy: ResolvedPromptRuntimePolicy): Record<string, unknown> {
  return {
    structure: mapResolvedStructurePolicyToSnakeCase(policy.structure),
    delivery: mapResolvedDeliveryPolicyToSnakeCase(policy.delivery),
    budget: mapBudgetPolicyToSnakeCase(policy.budget),
    source_selection: mapSourceSelectionPolicyToSnakeCase(policy.sourceSelection),
    visibility: mapVisibilityPolicyToSnakeCase(policy.visibility),
    debug: mapDebugPolicyToSnakeCase(policy.debug),
  };
}

function mapStructurePolicyToSnakeCase(policy: NonNullable<PromptRuntimePersistentPolicy["structure"]>): Record<string, unknown> {
  return {
    mode: policy.mode,
    ...(policy.mergeAdjacentSameRole !== undefined
      ? { merge_adjacent_same_role: policy.mergeAdjacentSameRole }
      : {}),
    ...(policy.assistantRewriteStrategy !== undefined
      ? { assistant_rewrite_strategy: policy.assistantRewriteStrategy }
      : {}),
    ...(policy.preserveSystemMessages !== undefined
      ? { preserve_system_messages: policy.preserveSystemMessages }
      : {}),
  };
}

function mapDeliveryPolicyToSnakeCase(policy: NonNullable<PromptRuntimePersistentPolicy["delivery"]>): Record<string, unknown> {
  return {
    ...(policy.allowAssistantPrefill !== undefined
      ? { allow_assistant_prefill: policy.allowAssistantPrefill }
      : {}),
    ...(policy.requireLastUser !== undefined
      ? { require_last_user: policy.requireLastUser }
      : {}),
    ...(policy.noAssistant !== undefined
      ? { no_assistant: policy.noAssistant }
      : {}),
  };
}

function mapResolvedStructurePolicyToSnakeCase(policy: ResolvedPromptStructurePolicy): Record<string, unknown> {
  return {
    mode: policy.mode,
    merge_adjacent_same_role: policy.mergeAdjacentSameRole,
    preserve_system_messages: policy.preserveSystemMessages,
    ...(policy.assistantRewriteStrategy
      ? { assistant_rewrite_strategy: policy.assistantRewriteStrategy }
      : {}),
  };
}

function mapResolvedDeliveryPolicyToSnakeCase(policy: ResolvedPromptDeliveryPolicy): Record<string, unknown> {
  return {
    allow_assistant_prefill: policy.allowAssistantPrefill,
    require_last_user: policy.requireLastUser,
    no_assistant: policy.noAssistant,
  };
}

function mapBudgetPolicyToSnakeCase(policy: { maxInputTokens?: number; reservedCompletionTokens?: number }): Record<string, unknown> {
  return {
    ...(policy.maxInputTokens !== undefined ? { max_input_tokens: policy.maxInputTokens } : {}),
    ...(policy.reservedCompletionTokens !== undefined ? { reserved_completion_tokens: policy.reservedCompletionTokens } : {}),
  };
}

function mapSourceSelectionPolicyToSnakeCase(policy: {
  history?: { mode?: string; maxMessages?: number };
  memory?: { enabled?: boolean };
  worldbook?: { enabled?: boolean };
  examples?: { enabled?: boolean };
}): Record<string, unknown> {
  return {
    ...(policy.history ? { history: { ...(policy.history.mode !== undefined ? { mode: policy.history.mode } : {}), ...(policy.history.maxMessages !== undefined ? { max_messages: policy.history.maxMessages } : {}) } } : {}),
    ...(policy.memory ? { memory: { ...(policy.memory.enabled !== undefined ? { enabled: policy.memory.enabled } : {}) } } : {}),
    ...(policy.worldbook ? { worldbook: { ...(policy.worldbook.enabled !== undefined ? { enabled: policy.worldbook.enabled } : {}) } } : {}),
    ...(policy.examples ? { examples: { ...(policy.examples.enabled !== undefined ? { enabled: policy.examples.enabled } : {}) } } : {}),
  };
}

function mapVisibilityPolicyToSnakeCase(policy: {
  hiddenFloorRanges?: Array<{ startFloorNo: number; endFloorNo: number }>;
  visibleFloorRanges?: Array<{ startFloorNo: number; endFloorNo: number }>;
  hiddenFloorIds?: string[];
  mode?: string;
}): Record<string, unknown> {
  return {
    ...(policy.hiddenFloorRanges ? { hidden_floor_ranges: policy.hiddenFloorRanges.map((range) => ({ start_floor_no: range.startFloorNo, end_floor_no: range.endFloorNo })) } : {}),
    ...(policy.visibleFloorRanges ? { visible_floor_ranges: policy.visibleFloorRanges.map((range) => ({ start_floor_no: range.startFloorNo, end_floor_no: range.endFloorNo })) } : {}),
    ...(policy.hiddenFloorIds ? { hidden_floor_ids: policy.hiddenFloorIds } : {}),
    ...(policy.mode !== undefined ? { mode: policy.mode } : {}),
  };
}

function mapDebugPolicyToSnakeCase(policy: PromptRuntimeDebugPolicy): Record<string, unknown> {
  return {
    include_prompt_snapshot: policy.includePromptSnapshot,
    include_runtime_trace: policy.includeRuntimeTrace,
    include_worldbook_matches: policy.includeWorldbookMatches,
  };
}

function mapAssetsViewToSnakeCase(assets: PromptRuntimeAssetsView): Record<string, unknown> {
  return {
    preset: mapAssetSummaryToSnakeCase(assets.preset),
    character_card: mapAssetSummaryToSnakeCase(assets.characterCard),
    worldbook: mapAssetSummaryToSnakeCase(assets.worldbook),
    regex_profile: mapAssetSummaryToSnakeCase(assets.regexProfile),
  };
}

function mapPromptSnapshotWorldbookActivationToSnakeCase(
  activation: NonNullable<PromptRuntimeHistoricalExplain["promptSnapshot"]["worldbookActivatedEntries"]>[number],
): Record<string, unknown> {
  return {
    uid: activation.uid,
    activation_key: activation.activationKey,
    source: {
      kind: activation.source.kind,
      worldbook_id: activation.source.worldbookId,
      worldbook_name: activation.source.worldbookName,
      asset_scope_id: activation.source.assetScopeId,
    },
    insertion: {
      position: activation.insertion.position,
      ...(activation.insertion.depth !== undefined ? { depth: activation.insertion.depth } : {}),
      ...(activation.insertion.role ? { role: activation.insertion.role } : {}),
      ...(activation.insertion.outletName ? { outlet_name: activation.insertion.outletName } : {}),
    },
  };
}

function mapPromptSnapshotToSnakeCase(snapshot: PromptRuntimeHistoricalExplain["promptSnapshot"]): Record<string, unknown> {
  return {
    preset_id: snapshot.presetId,
    preset_updated_at: snapshot.presetUpdatedAt,
    preset_version: snapshot.presetVersion,
    worldbook_id: snapshot.worldbookId,
    worldbook_updated_at: snapshot.worldbookUpdatedAt,
    worldbook_version: snapshot.worldbookVersion,
    regex_profile_id: snapshot.regexProfileId,
    regex_profile_updated_at: snapshot.regexProfileUpdatedAt,
    regex_profile_version: snapshot.regexProfileVersion,
    character_id: snapshot.characterId ?? null,
    character_version_id: snapshot.characterVersionId ?? null,
    character_imported_format: snapshot.characterImportedFormat ?? null,
    character_content_hash: snapshot.characterContentHash ?? null,
    worldbook_activated_entry_uids: snapshot.worldbookActivatedEntryUids,
    worldbook_activated_entries: (snapshot.worldbookActivatedEntries ?? []).map(mapPromptSnapshotWorldbookActivationToSnakeCase),
    regex_pre_rule_names: snapshot.regexPreRuleNames,
    regex_post_rule_names: snapshot.regexPostRuleNames,
    prompt_mode: snapshot.promptMode,
    asset_manifest_digest: snapshot.assetManifestDigest ?? null,
    prompt_digest: snapshot.promptDigest,
    token_estimate: snapshot.tokenEstimate,
  };
}

function mapAssetSummaryToSnakeCase(asset: PromptRuntimeAssetsView[keyof PromptRuntimeAssetsView]): Record<string, unknown> | null {
  if (!asset) {
    return null;
  }

  return {
    id: asset.id,
    name: asset.name,
  };
}

function mapSourceSelectionSourceMapToSnakeCase(sourceSelection: NonNullable<NonNullable<PromptRuntimeResolvedState["sourceMap"]>["sourceSelection"]>): Record<string, unknown> {
  return {
    ...(sourceSelection.history ? { history: { ...(sourceSelection.history.mode ? { mode: sourceSelection.history.mode } : {}), ...(sourceSelection.history.maxMessages ? { max_messages: sourceSelection.history.maxMessages } : {}) } } : {}),
    ...(sourceSelection.memory ? { memory: { ...(sourceSelection.memory.enabled ? { enabled: sourceSelection.memory.enabled } : {}) } } : {}),
    ...(sourceSelection.worldbook ? { worldbook: { ...(sourceSelection.worldbook.enabled ? { enabled: sourceSelection.worldbook.enabled } : {}) } } : {}),
    ...(sourceSelection.examples ? { examples: { ...(sourceSelection.examples.enabled ? { enabled: sourceSelection.examples.enabled } : {}) } } : {}),
  };
}

function mapSourceMapToSnakeCase(sourceMap: NonNullable<PromptRuntimeResolvedState["sourceMap"]>): Record<string, unknown> {
  const structure = sourceMap.structure
    ? {
        ...(sourceMap.structure.mode ? { mode: sourceMap.structure.mode } : {}),
        ...(sourceMap.structure.mergeAdjacentSameRole
          ? { merge_adjacent_same_role: sourceMap.structure.mergeAdjacentSameRole }
          : {}),
      ...(sourceMap.structure.preserveSystemMessages
          ? { preserve_system_messages: sourceMap.structure.preserveSystemMessages }
          : {}),
        ...(sourceMap.structure.assistantRewriteStrategy
          ? { assistant_rewrite_strategy: sourceMap.structure.assistantRewriteStrategy }
          : {}),
      }
    : undefined;

  const delivery = sourceMap.delivery
    ? {
        ...(sourceMap.delivery.allowAssistantPrefill
          ? { allow_assistant_prefill: sourceMap.delivery.allowAssistantPrefill }
          : {}),
        ...(sourceMap.delivery.requireLastUser
          ? { require_last_user: sourceMap.delivery.requireLastUser }
          : {}),
        ...(sourceMap.delivery.noAssistant
          ? { no_assistant: sourceMap.delivery.noAssistant }
          : {}),
      }
    : undefined;

  const debug = sourceMap.debug
    ? {
        ...(sourceMap.debug.includePromptSnapshot
          ? { include_prompt_snapshot: sourceMap.debug.includePromptSnapshot }
          : {}),
        ...(sourceMap.debug.includeRuntimeTrace
          ? { include_runtime_trace: sourceMap.debug.includeRuntimeTrace }
          : {}),
        ...(sourceMap.debug.includeWorldbookMatches
          ? { include_worldbook_matches: sourceMap.debug.includeWorldbookMatches }
          : {}),
      }
    : undefined;

  return {
    ...(structure && Object.keys(structure).length > 0
      ? { structure }
      : {}),
    ...(delivery && Object.keys(delivery).length > 0
      ? { delivery }
      : {}),
    ...(debug && Object.keys(debug).length > 0
      ? { debug }
      : {}),
    ...(sourceMap.budget
      ? { budget: { ...(sourceMap.budget.maxInputTokens ? { max_input_tokens: sourceMap.budget.maxInputTokens } : {}), ...(sourceMap.budget.reservedCompletionTokens ? { reserved_completion_tokens: sourceMap.budget.reservedCompletionTokens } : {}) } }
      : {}),
    ...(sourceMap.sourceSelection
      ? { source_selection: mapSourceSelectionSourceMapToSnakeCase(sourceMap.sourceSelection) }
      : {}),
    ...(sourceMap.visibility
      ? {
          visibility: {
            ...(sourceMap.visibility.mode ? { mode: sourceMap.visibility.mode } : {}),
            ...(sourceMap.visibility.hiddenFloorRanges ? { hidden_floor_ranges: sourceMap.visibility.hiddenFloorRanges } : {}),
            ...(sourceMap.visibility.visibleFloorRanges ? { visible_floor_ranges: sourceMap.visibility.visibleFloorRanges } : {}),
            ...(sourceMap.visibility.hiddenFloorIds ? { hidden_floor_ids: sourceMap.visibility.hiddenFloorIds } : {}),
          },
        }
      : {}),
    ...(sourceMap.history
      ? {
          history: {
            ...(sourceMap.history.sourceBranchId ? { source_branch_id: sourceMap.history.sourceBranchId } : {}),
            ...(sourceMap.history.sourceMode ? { source_mode: sourceMap.history.sourceMode } : {}),
          },
        }
      : {}),
  };
}


function mapScopeToSnakeCase(scope: PromptRuntimeResolvedState["scope"] | PromptRuntimePreviewResult["scope"]): Record<string, unknown> {
  return {
    session_id: scope.sessionId,
    target_branch_id: scope.targetBranchId,
    branch_exists: scope.branchExists,
    ...(scope.sourceFloorId !== undefined ? { source_floor_id: scope.sourceFloorId } : {}),
    history_source_branch_id: scope.historySourceBranchId,
    history_source_mode: scope.historySourceMode,
  };
}

function mapHistoricalExplainResultToSnakeCase(result: PromptRuntimeHistoricalExplain["result"]): Record<string, unknown> {
  return {
    output_page_id: result.outputPageId,
    assistant_message_id: result.assistantMessageId,
    generated_text: result.generatedText,
    summaries: result.summaries,
    usage: {
      prompt_tokens: result.usage.promptTokens,
      completion_tokens: result.usage.completionTokens,
      total_tokens: result.usage.totalTokens,
    },
    verifier: result.verifier
      ? {
          status: result.verifier.status,
          suggestion: result.verifier.suggestion ?? null,
          issues: result.verifier.issues ?? null,
        }
      : null,
    committed_at: result.committedAt,
  };
}

function mapDiagnosticToSnakeCase(
  diagnostic: PromptRuntimeResolvedState["diagnostics"][number]
    | PromptRuntimePreviewResult["diagnostics"][number]
    | PromptRuntimeHistoricalExplain["diagnostics"][number],
): Record<string, unknown> {
  return {
    code: diagnostic.code,
    message: diagnostic.message,
    severity: diagnostic.severity,
    ...(diagnostic.source ? { source: diagnostic.source } : {}),
    ...(diagnostic.fieldPath ? { field_path: diagnostic.fieldPath } : {}),
    ...(diagnostic.phase ? { phase: diagnostic.phase } : {}),
  };
}



function mapCapabilitiesToSnakeCase(capabilities: PromptRuntimeCapabilities): Record<string, unknown> {
  return {
    structure: {
      modes: [...capabilities.structure.modes],
      defaults: mapResolvedStructurePolicyToSnakeCase(capabilities.structure.defaults),
    },
    delivery: {
      defaults: mapResolvedDeliveryPolicyToSnakeCase(capabilities.delivery.defaults),
    },
    budget: {
      defaults: mapBudgetPolicyToSnakeCase(capabilities.budget.defaults),
      request_override_supported: capabilities.budget.requestOverrideSupported,
      persistent_patch_supported: capabilities.budget.persistentPatchSupported,
      supported_fields: [...capabilities.budget.supportedFields],
      trim_reason_codes: [...capabilities.budget.trimReasonCodes],
    },
    source_selection: {
      defaults: mapSourceSelectionPolicyToSnakeCase(capabilities.sourceSelection.defaults),
      request_override_supported: capabilities.sourceSelection.requestOverrideSupported,
      persistent_patch_supported: capabilities.sourceSelection.persistentPatchSupported,
      supported_sources: [...capabilities.sourceSelection.supportedSources],
      history_modes: [...capabilities.sourceSelection.historyModes],
      exclusion_reason_codes: [...capabilities.sourceSelection.exclusionReasonCodes],
    },
    governance: {
      session: {
        envelope_metadata: capabilities.governance.session.envelopeMetadata,
        null_clears_field: capabilities.governance.session.nullClearsField,
        object_patch: capabilities.governance.session.objectPatch,
        supported_fields: [...capabilities.governance.session.supportedFields],
      },
      branch: {
        envelope_metadata: capabilities.governance.branch.envelopeMetadata,
        materialized_branches_only: capabilities.governance.branch.materializedBranchesOnly,
        null_clears_field: capabilities.governance.branch.nullClearsField,
        object_patch: capabilities.governance.branch.objectPatch,
        supported_fields: [...capabilities.governance.branch.supportedFields],
      },
    },
    compare: {
      enabled: capabilities.compare.enabled,
      committed_floors_only: capabilities.compare.committedFloorsOnly,
      mixed_preview_supported: capabilities.compare.mixedPreviewSupported,
      limitations_instead_of_recompute: capabilities.compare.limitationsInsteadOfRecompute,
    },
    observability: {
      live: {
        enabled: capabilities.observability.live.enabled,
        default_off: capabilities.observability.live.defaultOff,
        request_scoped_only: capabilities.observability.live.requestScopedOnly,
        include_prompt_snapshot: capabilities.observability.live.includePromptSnapshot,
        include_runtime_trace: capabilities.observability.live.includeRuntimeTrace,
        include_worldbook_matches: capabilities.observability.live.includeWorldbookMatches,
        worldbook_matches_requires_runtime_trace: capabilities.observability.live.worldbookMatchesRequiresRuntimeTrace,
        worldbook_matches_requires_opt_in: capabilities.observability.live.worldbookMatchesRequiresOptIn,
        visibility_request_supported: capabilities.observability.live.visibilityRequestSupported,
      },
      dry_run: {
        enabled: capabilities.observability.dryRun.enabled,
        returns_assembly: capabilities.observability.dryRun.returnsAssembly,
        returns_runtime_trace: capabilities.observability.dryRun.returnsRuntimeTrace,
        supports_visibility: capabilities.observability.dryRun.supportsVisibility,
        include_worldbook_matches: capabilities.observability.dryRun.includeWorldbookMatches,
      },
      inspect: {
        enabled: capabilities.observability.inspect.enabled,
        mode: capabilities.observability.inspect.mode,
        supports_branch: capabilities.observability.inspect.supportsBranch,
        supports_source_floor: capabilities.observability.inspect.supportsSourceFloor,
        supports_visibility: capabilities.observability.inspect.supportsVisibility,
        returns_prepared_turn: capabilities.observability.inspect.returnsPreparedTurn,
        returns_governance: capabilities.observability.inspect.returnsGovernance,
        llm_call: capabilities.observability.inspect.llmCall,
        creates_floor: capabilities.observability.inspect.createsFloor,
        writes_prompt_snapshot: capabilities.observability.inspect.writesPromptSnapshot,
        writes_explain_snapshot: capabilities.observability.inspect.writesExplainSnapshot,
        commits_side_effects: capabilities.observability.inspect.commitsSideEffects,
      },
      preview: {
        enabled: capabilities.observability.preview.enabled,
        mode: capabilities.observability.preview.mode,
        returns_runtime_trace: capabilities.observability.preview.returnsRuntimeTrace,
        returns_assembly_truth: capabilities.observability.preview.returnsAssemblyTruth,
        supports_visibility: capabilities.observability.preview.supportsVisibility,
        single_text_only: capabilities.observability.preview.singleTextOnly,
        llm_call: capabilities.observability.preview.llmCall,
        creates_floor: capabilities.observability.preview.createsFloor,
        writes_prompt_snapshot: capabilities.observability.preview.writesPromptSnapshot,
        commits_side_effects: capabilities.observability.preview.commitsSideEffects,
        trace_subset: [...capabilities.observability.preview.traceSubset],
      },
      explain: {
        enabled: capabilities.observability.explain.enabled,
        read_only: capabilities.observability.explain.readOnly,
        returns_governance: capabilities.observability.explain.returnsGovernance,
        requires_committed_floor: capabilities.observability.explain.requiresCommittedFloor,
        persisted_truth_only: capabilities.observability.explain.persistedTruthOnly,
        recompute: capabilities.observability.explain.recompute,
        snapshot_supported: capabilities.observability.explain.snapshotSupported,
        legacy_floor_fallback: capabilities.observability.explain.legacyFloorFallback,
        snapshot_availability_field: capabilities.observability.explain.snapshotAvailabilityField,
      },
      stream: {
        enabled: capabilities.observability.stream.enabled,
        prompt_debug_payload: capabilities.observability.stream.promptDebugPayload,
        new_sse_event_family: capabilities.observability.stream.newSseEventFamily,
      },
    },
    macro: {
      built_in_read_only_values_persistable: capabilities.macro.builtInReadOnlyValuesPersistable,
      st_compatibility_snapshots_persistable: capabilities.macro.stCompatibilitySnapshotsPersistable,
      run_kind_persistable: capabilities.macro.runKindPersistable,
      diagnostics_surface: capabilities.macro.diagnosticsSurface,
      dedicated_macros_route: capabilities.macro.dedicatedMacrosRoute,
      recent_message_respects_visibility: capabilities.macro.recentMessageRespectsVisibility,
    },
    unsupported: [...capabilities.unsupported],
  };
}

function sendPromptRuntimePreviewServiceError(
  reply: Parameters<typeof sendError>[0],
  error: unknown,
) {
  if (isBranchLocalSnapshotMissingError(error)) {
    return sendError(reply, 409, "branch_local_snapshot_missing", error.message);
  }

  if (error instanceof ChatServiceError) {
    switch (error.code) {
      case "session_not_found":
      case "source_floor_not_found":
        return sendError(reply, 404, error.code, error.message);
      case "session_archived":
      case "invalid_state":
      case "generation_target_stale":
      case "branch_exists":
      case "branch_local_snapshot_missing":
        return sendError(reply, 409, error.code, error.message);
      default:
        return sendError(reply, 500, error.code, error.message);
    }
  }

  throw error;
}

function sendPromptRuntimeControlServiceError(
  reply: Parameters<typeof sendError>[0],
  error: unknown,
) {
  if (error instanceof PromptRuntimeControlServiceError) {
    return sendError(reply, error.statusCode, error.code, error.message);
  }

  throw error;
}
