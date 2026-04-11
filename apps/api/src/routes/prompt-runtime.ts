import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { sendError, parseWithSchema } from "../lib/http.js";
import { errorResponseJsonSchema, idParamsJsonSchema } from "./schemas/common.js";
import { getRequestAuthContext } from "../plugins/auth.js";
import {
  promptRuntimeAssetsResponseJsonSchema,
  promptRuntimeCapabilitiesResponseJsonSchema,
  promptRuntimePolicyViewResponseJsonSchema,
  promptRuntimePolicyPatchBodyJsonSchema,
  promptRuntimePreviewBodyJsonSchema,
  promptRuntimePreviewResponseJsonSchema,
  promptRuntimeResolvedStateResponseJsonSchema,
} from "./schemas/prompt-runtime-schemas.js";
import {
  PROMPT_RUNTIME_SUPPORTED_ASSISTANT_REWRITE_STRATEGIES,
  PROMPT_RUNTIME_SUPPORTED_STRUCTURE_MODES,
  PromptRuntimeControlService,
  PromptRuntimeControlServiceError,
  type PromptRuntimeAssetsView,
  type PromptRuntimeCapabilities,
  type PromptRuntimeDebugPolicy,
  type PromptRuntimePersistentPolicy,
  type PromptRuntimePolicyView,
  type PromptRuntimePersistentPolicyPatch,
  type PromptRuntimeResolvedState,
  type ResolvedPromptDeliveryPolicy,
  type ResolvedPromptRuntimePolicy,
  type ResolvedPromptStructurePolicy,
} from "../services/prompt-runtime-control-service.js";
import {
  ChatServiceError,
  type PromptRuntimePreviewRequest,
  type PromptRuntimePreviewResult,
} from "../services/chat-service.js";

const sessionIdParamsSchema = z.object({
  id: z.string().min(1),
});

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
}).strict().refine(
  (value) => value.structure !== undefined || value.delivery !== undefined,
  "At least one mutable field is required",
);

const promptRuntimePreviewVisibilitySchema = z.object({
  hidden_floor_ranges: z.array(z.object({
    start_floor_no: z.number().int(),
    end_floor_no: z.number().int(),
  }).strict()).optional(),
  visible_floor_ranges: z.array(z.object({
    start_floor_no: z.number().int(),
    end_floor_no: z.number().int(),
  }).strict()).optional(),
  hidden_floor_ids: z.array(z.string().min(1)).optional(),
  mode: z.enum(["allow_all_except_hidden", "deny_all_except_visible"]).optional(),
}).strict();

const promptRuntimePreviewBodySchema = z.object({
  text: z.string().min(1),
  branch_id: z.string().min(1).optional(),
  source_floor_id: z.string().min(1).optional(),
  visibility: promptRuntimePreviewVisibilitySchema.optional(),
}).strict();

interface RegisterPromptRuntimeRoutesOptions {
  previewService?: {
    previewPromptRuntimeText(sessionId: string, request: PromptRuntimePreviewRequest, accountId?: string): Promise<PromptRuntimePreviewResult>;
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

    try {
      const auth = getRequestAuthContext(request);
      const state = await promptRuntimeControlService.getResolvedState(parsedParams.data.id, auth.accountId);
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
      const policy = await promptRuntimeControlService.updatePolicy(parsedParams.data.id, auth.accountId, mapPolicyPatchBodyToCamelCase(parsedBody.data));
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
      summary: "Preview prompt runtime macros for a single text segment",
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
    policy: mapResolvedPolicyToSnakeCase(state.policy),
    ...(state.persistentPolicy ? { persistent_policy: mapPersistentPolicyToSnakeCase(state.persistentPolicy) } : {}),
    assets: mapAssetsViewToSnakeCase(state.assets),
    warnings: state.warnings,
    ...(state.sourceMap ? { source_map: mapSourceMapToSnakeCase(state.sourceMap) } : {}),
  };
}

function mapPolicyViewToSnakeCase(view: PromptRuntimePolicyView): Record<string, unknown> {
  return {
    ...(view.persistentPolicy ? { persistent_policy: mapPersistentPolicyToSnakeCase(view.persistentPolicy) } : {}),
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
  };
}

function mapPreviewResultToSnakeCase(result: PromptRuntimePreviewResult): Record<string, unknown> {
  return {
    text: result.text,
    runtime_trace: mapPreviewRuntimeTraceToSnakeCase(result.runtimeTrace),
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
  };
}

function mapResolvedPolicyToSnakeCase(policy: ResolvedPromptRuntimePolicy): Record<string, unknown> {
  return {
    structure: mapResolvedStructurePolicyToSnakeCase(policy.structure),
    delivery: mapResolvedDeliveryPolicyToSnakeCase(policy.delivery),
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

function mapAssetSummaryToSnakeCase(asset: PromptRuntimeAssetsView[keyof PromptRuntimeAssetsView]): Record<string, unknown> | null {
  if (!asset) {
    return null;
  }

  return {
    id: asset.id,
    name: asset.name,
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
      preview: {
        enabled: capabilities.observability.preview.enabled,
        returns_runtime_trace: capabilities.observability.preview.returnsRuntimeTrace,
        supports_visibility: capabilities.observability.preview.supportsVisibility,
        single_text_only: capabilities.observability.preview.singleTextOnly,
        llm_call: capabilities.observability.preview.llmCall,
        creates_floor: capabilities.observability.preview.createsFloor,
        writes_prompt_snapshot: capabilities.observability.preview.writesPromptSnapshot,
        commits_side_effects: capabilities.observability.preview.commitsSideEffects,
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
  if (error instanceof ChatServiceError) {
    switch (error.code) {
      case "session_not_found":
      case "source_floor_not_found":
        return sendError(reply, 404, error.code, error.message);
      case "session_archived":
      case "invalid_state":
      case "generation_target_stale":
      case "branch_exists":
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
