import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import { registerPromptRuntimeRoutes } from "../src/routes/prompt-runtime";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../src/accounts/constants.js";
import { sendError } from "../src/lib/http.js";
import {
  PromptRuntimeControlServiceError,
  type PromptRuntimeControlService,
} from "../src/services/prompt-runtime-control-service.js";
import { ChatServiceError, type PromptRuntimePreviewRequest, type PromptRuntimePreviewResult } from "../src/services/chat/chat-service.js";
import type {
  PromptRuntimeInspectRequest,
  PromptRuntimeInspectResult,
} from "../src/services/prompt-runtime/types.js";
import { registerDevelopmentTestAuth } from "./helpers/register-test-auth";

type PromptRuntimeControlServiceStub = {
  getResolvedState: ReturnType<typeof vi.fn>;
  getPolicy: ReturnType<typeof vi.fn>;
  getAssets: ReturnType<typeof vi.fn>;
  getBranchPolicy: ReturnType<typeof vi.fn>;
  updatePolicy: ReturnType<typeof vi.fn>;
  updateBranchPolicy: ReturnType<typeof vi.fn>;
  getHistoricalExplain: ReturnType<typeof vi.fn>;
  compareCommittedExplain: ReturnType<typeof vi.fn>;
  getCapabilities: ReturnType<typeof vi.fn>;
};

type PromptRuntimePreviewServiceStub = {
  previewPromptRuntimeText: ReturnType<typeof vi.fn<(
    sessionId: string,
    request: PromptRuntimePreviewRequest,
    accountId?: string,
  ) => Promise<PromptRuntimePreviewResult>>>;
};

type PromptRuntimeInspectServiceStub = {
  inspectPromptRuntime: ReturnType<typeof vi.fn<(
    sessionId: string,
    request: PromptRuntimeInspectRequest,
    accountId?: string,
  ) => Promise<PromptRuntimeInspectResult>>>;
};

function createPromptRuntimeControlService(
  overrides: Partial<PromptRuntimeControlServiceStub> = {},
): PromptRuntimeControlServiceStub {
  return {
    getResolvedState: vi.fn(),
    getPolicy: vi.fn(),
    getAssets: vi.fn(),
    getBranchPolicy: vi.fn(),
    updatePolicy: vi.fn(),
    updateBranchPolicy: vi.fn(),
    getHistoricalExplain: vi.fn(),
    compareCommittedExplain: vi.fn(),
    getCapabilities: vi.fn(),
    ...overrides,
  };
}

function createPromptRuntimeInspectService(
  overrides: Partial<PromptRuntimeInspectServiceStub> = {},
): PromptRuntimeInspectServiceStub {
  return {
    inspectPromptRuntime: vi.fn(),
    ...overrides,
  };
}

function createPromptRuntimePreviewService(
  overrides: Partial<PromptRuntimePreviewServiceStub> = {},
): PromptRuntimePreviewServiceStub {
  return {
    previewPromptRuntimeText: vi.fn(),
    ...overrides,
  };
}

const defaultResolvedVisibility = {
  mode: "allow_all_except_hidden",
} as const;

const defaultVisibilitySourceMap = {
  mode: "system_default",
} as const;

describe("prompt runtime routes", () => {
  let app: FastifyInstance;

  async function mountRoutes(
    service: PromptRuntimeControlServiceStub,
    previewService?: PromptRuntimePreviewServiceStub,
    inspectService?: PromptRuntimeInspectServiceStub,
  ) {
    app = Fastify({ logger: false });
    await registerDevelopmentTestAuth(app);
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof ZodError) {
        return sendError(reply, 400, "validation_error", "Request validation failed");
      }

      const fastifyValidationError = error as {
        code?: string;
        message: string;
        statusCode?: number;
      };

      if (fastifyValidationError.code === "FST_ERR_VALIDATION") {
        return sendError(reply, 400, "validation_error", "Request validation failed");
      }

      const errorMessage = error instanceof Error ? error.message : fastifyValidationError.message;

      return sendError(reply, fastifyValidationError.statusCode ?? 500, fastifyValidationError.code ?? "internal_error", errorMessage);
    });
    await registerPromptRuntimeRoutes(app, service as unknown as PromptRuntimeControlService, {
      previewService: previewService as unknown as { previewPromptRuntimeText: PromptRuntimePreviewServiceStub["previewPromptRuntimeText"] } | undefined,
      inspectService: inspectService as unknown as { inspectPromptRuntime: PromptRuntimeInspectServiceStub["inspectPromptRuntime"] } | undefined,
    });
  }

  afterEach(async () => {
    vi.restoreAllMocks();
    if (app) {
      await app.close();
    }
  });

  it("maps GET /sessions/:id/prompt-runtime response to snake_case", async () => {
    const controlService = createPromptRuntimeControlService({
      getResolvedState: vi.fn(async () => ({
        scope: {
          sessionId: "s1",
          targetBranchId: "alt-branch",
          branchExists: true,
          sourceFloorId: null,
          historySourceBranchId: "alt-branch",
          historySourceMode: "existing_branch",
        },
        policy: {
          structure: {
            mode: "no_assistant",
            mergeAdjacentSameRole: false,
            preserveSystemMessages: true,
            assistantRewriteStrategy: "to_system",
          },
          delivery: {
            allowAssistantPrefill: true,
            requireLastUser: true,
            noAssistant: true,
          },
          budget: {},
          sourceSelection: { history: { mode: "full" }, memory: { enabled: true }, worldbook: { enabled: true }, examples: { enabled: true } },
          visibility: defaultResolvedVisibility,
          debug: {
            includePromptSnapshot: false,
            includeRuntimeTrace: false,
            includeWorldbookMatches: false,
          },
        },
        persistentPolicy: {
          delivery: {
            noAssistant: true,
          },
        },
        branchPersistentPolicy: {
          delivery: {
            noAssistant: true,
          },
        },
        assets: {
          preset: { id: "preset-1", name: "Preset One" },
          characterCard: { id: "char-1", name: "Hero" },
          worldbook: null,
          regexProfile: { id: "regex-1", name: null },
        },
        sourceMap: {
          structure: {
            mode: "session_policy",
            mergeAdjacentSameRole: "session_policy",
            preserveSystemMessages: "system_default",
            assistantRewriteStrategy: "system_default",
          },
          delivery: {
            allowAssistantPrefill: "system_default",
            requireLastUser: "session_policy",
            noAssistant: "system_default",
          },
          sourceSelection: { history: { mode: "system_default" }, memory: { enabled: "system_default" }, worldbook: { enabled: "system_default" }, examples: { enabled: "system_default" } },
          visibility: defaultVisibilitySourceMap,
          history: {
            sourceBranchId: "alt-branch",
            sourceMode: "existing_branch",
          },
        },
        warnings: ["compat warning"],
        diagnostics: [{
          code: "derived_no_assistant_structure",
          message: "compat warning",
          severity: "warning",
        }],
        limitations: ["memory remains shared"],
      })),
    });

    await mountRoutes(controlService);

    const response = await app.inject({
      method: "GET",
      url: "/sessions/s1/prompt-runtime?branch_id=alt-branch",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        scope: {
          session_id: "s1",
          target_branch_id: "alt-branch",
          branch_exists: true,
          source_floor_id: null,
          history_source_branch_id: "alt-branch",
          history_source_mode: "existing_branch",
        },
        policy: {
          structure: {
            mode: "no_assistant",
            merge_adjacent_same_role: false,
            preserve_system_messages: true,
            assistant_rewrite_strategy: "to_system",
          },
          delivery: {
            allow_assistant_prefill: true,
            require_last_user: true,
            no_assistant: true,
          },
          budget: {},
          source_selection: { history: { mode: "full" }, memory: { enabled: true }, worldbook: { enabled: true }, examples: { enabled: true } },
          visibility: defaultResolvedVisibility,
          debug: {
            include_prompt_snapshot: false,
            include_runtime_trace: false,
            include_worldbook_matches: false,
          },
        },
        persistent_policy: {
          delivery: {
            no_assistant: true,
          },
        },
        branch_persistent_policy: {
          delivery: {
            no_assistant: true,
          },
        },
        assets: {
          preset: { id: "preset-1", name: "Preset One" },
          character_card: { id: "char-1", name: "Hero" },
          worldbook: null,
          regex_profile: { id: "regex-1", name: null },
        },
        source_map: {
          structure: {
            mode: "session_policy",
            merge_adjacent_same_role: "session_policy",
            preserve_system_messages: "system_default",
            assistant_rewrite_strategy: "system_default",
          },
          delivery: {
            allow_assistant_prefill: "system_default",
            require_last_user: "session_policy",
            no_assistant: "system_default",
          },
          source_selection: { history: { mode: "system_default" }, memory: { enabled: "system_default" }, worldbook: { enabled: "system_default" }, examples: { enabled: "system_default" } },
          visibility: defaultVisibilitySourceMap,
          history: {
            source_branch_id: "alt-branch",
            source_mode: "existing_branch",
          },
        },
        warnings: ["compat warning"],
        diagnostics: [{ code: "derived_no_assistant_structure", message: "compat warning", severity: "warning" }],
        limitations: ["memory remains shared"],
      },
    });

    expect(controlService.getResolvedState).toHaveBeenCalledWith("s1", DEFAULT_ADMIN_ACCOUNT_ID, "alt-branch");
  });

  it("maps GET /sessions/:id/prompt-runtime/policy response to snake_case", async () => {
    const controlService = createPromptRuntimeControlService({
      getPolicy: vi.fn(async () => ({
        persistentPolicy: {
          structure: {
            mode: "strict_alternating",
          },
          delivery: {
            requireLastUser: true,
          },
        },
        resolvedPolicy: {
          structure: {
            mode: "strict_alternating",
            mergeAdjacentSameRole: true,
            preserveSystemMessages: true,
          },
          delivery: {
            allowAssistantPrefill: true,
            requireLastUser: true,
            noAssistant: false,
          },
          budget: {},
          sourceSelection: { history: { mode: "full" }, memory: { enabled: true }, worldbook: { enabled: true }, examples: { enabled: true } },
          visibility: defaultResolvedVisibility,
          debug: {
            includePromptSnapshot: false,
            includeRuntimeTrace: false,
            includeWorldbookMatches: false,
          },
        },
        warnings: [],
      })),
    });

    await mountRoutes(controlService);

    const response = await app.inject({
      method: "GET",
      url: "/sessions/s1/prompt-runtime/policy",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        persistent_policy: {
          structure: {
            mode: "strict_alternating",
          },
          delivery: {
            require_last_user: true,
          },
        },
        resolved_policy: {
          structure: {
            mode: "strict_alternating",
            merge_adjacent_same_role: true,
            preserve_system_messages: true,
          },
          delivery: {
            allow_assistant_prefill: true,
            require_last_user: true,
            no_assistant: false,
          },
          budget: {},
          source_selection: { history: { mode: "full" }, memory: { enabled: true }, worldbook: { enabled: true }, examples: { enabled: true } },
          visibility: defaultResolvedVisibility,
          debug: {
            include_prompt_snapshot: false,
            include_runtime_trace: false,
            include_worldbook_matches: false,
          },
        },
        warnings: [],
      },
    });

    expect(controlService.getPolicy).toHaveBeenCalledWith("s1", DEFAULT_ADMIN_ACCOUNT_ID);
  });

  it("maps PATCH /sessions/:id/prompt-runtime/policy request and response", async () => {
    const controlService = createPromptRuntimeControlService({
      updatePolicy: vi.fn(async () => ({
        persistentPolicy: {
          structure: {
            mode: "strict_alternating",
            preserveSystemMessages: true,
          },
          delivery: {
            requireLastUser: true,
          },
          visibility: {
            mode: "allow_all_except_hidden",
            hiddenFloorRanges: [{ startFloorNo: 1, endFloorNo: 2 }],
          },
        },
        resolvedPolicy: {
          structure: {
            mode: "strict_alternating",
            mergeAdjacentSameRole: true,
            preserveSystemMessages: true,
          },
          delivery: {
            allowAssistantPrefill: true,
            requireLastUser: true,
            noAssistant: false,
          },
          budget: {},
          sourceSelection: { history: { mode: "full" }, memory: { enabled: true }, worldbook: { enabled: true }, examples: { enabled: true } },
          visibility: defaultResolvedVisibility,
          debug: {
            includePromptSnapshot: false,
            includeRuntimeTrace: false,
            includeWorldbookMatches: false,
          },
        },
        warnings: [],
      })),
    });

    await mountRoutes(controlService);

    const response = await app.inject({
      method: "PATCH",
      url: "/sessions/s1/prompt-runtime/policy",
      payload: {
        structure: {
          mode: "strict_alternating",
          preserve_system_messages: true,
        },
        delivery: {
          require_last_user: true,
        },
        visibility: {
          mode: "allow_all_except_hidden",
          hidden_floor_ranges: [{ start_floor_no: 1, end_floor_no: 2 }],
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        persistent_policy: {
          structure: { mode: "strict_alternating", preserve_system_messages: true },
          delivery: { require_last_user: true },
          visibility: { mode: "allow_all_except_hidden", hidden_floor_ranges: [{ start_floor_no: 1, end_floor_no: 2 }] },
        },
        resolved_policy: {
          structure: { mode: "strict_alternating", merge_adjacent_same_role: true, preserve_system_messages: true },
          delivery: { allow_assistant_prefill: true, require_last_user: true, no_assistant: false },
          budget: {},
          source_selection: { history: { mode: "full" }, memory: { enabled: true }, worldbook: { enabled: true }, examples: { enabled: true } },
          visibility: defaultResolvedVisibility,
          debug: { include_prompt_snapshot: false, include_runtime_trace: false, include_worldbook_matches: false },
        },
        warnings: [],
      },
    });
    expect(controlService.updatePolicy).toHaveBeenCalledWith("s1", DEFAULT_ADMIN_ACCOUNT_ID, {
      structure: { mode: "strict_alternating", preserveSystemMessages: true },
      delivery: { requireLastUser: true },
      visibility: { mode: "allow_all_except_hidden", hiddenFloorRanges: [{ startFloorNo: 1, endFloorNo: 2 }] },
    }, DEFAULT_ADMIN_ACCOUNT_ID);
  });

  it("maps PATCH /sessions/:id/prompt-runtime/policy null clearing semantics", async () => {
    const controlService = createPromptRuntimeControlService({
      updatePolicy: vi.fn(async () => ({
        resolvedPolicy: {
          structure: {
            mode: "default",
            mergeAdjacentSameRole: false,
            preserveSystemMessages: true,
          },
          delivery: {
            allowAssistantPrefill: true,
            requireLastUser: false,
            noAssistant: false,
          },
          budget: {},
          sourceSelection: { history: { mode: "full" }, memory: { enabled: true }, worldbook: { enabled: true }, examples: { enabled: true } },
          visibility: defaultResolvedVisibility,
          debug: {
            includePromptSnapshot: false,
            includeRuntimeTrace: false,
            includeWorldbookMatches: false,
          },
        },
        warnings: [],
      })),
    });

    await mountRoutes(controlService);

    const response = await app.inject({
      method: "PATCH",
      url: "/sessions/s1/prompt-runtime/policy",
      payload: {
        structure: null,
        delivery: null,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        resolved_policy: {
          structure: { mode: "default", merge_adjacent_same_role: false, preserve_system_messages: true },
          delivery: { allow_assistant_prefill: true, require_last_user: false, no_assistant: false },
          budget: {},
          source_selection: { history: { mode: "full" }, memory: { enabled: true }, worldbook: { enabled: true }, examples: { enabled: true } },
          visibility: defaultResolvedVisibility,
          debug: { include_prompt_snapshot: false, include_runtime_trace: false, include_worldbook_matches: false },
        },
        warnings: [],
      },
    });
    expect(controlService.updatePolicy).toHaveBeenCalledWith("s1", DEFAULT_ADMIN_ACCOUNT_ID, {
      structure: null,
      delivery: null,
    }, DEFAULT_ADMIN_ACCOUNT_ID);
  });

  it("maps GET /sessions/:id/prompt-runtime/branches/:branchId/policy response to snake_case", async () => {
    const controlService = createPromptRuntimeControlService({
      getBranchPolicy: vi.fn(async () => ({
        persistentPolicy: {
          delivery: {
            noAssistant: true,
          },
        },
        resolvedPolicy: {
          structure: {
            mode: "no_assistant",
            mergeAdjacentSameRole: false,
            preserveSystemMessages: true,
            assistantRewriteStrategy: "to_system",
          },
          delivery: {
            allowAssistantPrefill: true,
            requireLastUser: false,
            noAssistant: true,
          },
          budget: {},
          sourceSelection: { history: { mode: "full" }, memory: { enabled: true }, worldbook: { enabled: true }, examples: { enabled: true } },
          visibility: defaultResolvedVisibility,
          debug: {
            includePromptSnapshot: false,
            includeRuntimeTrace: false,
            includeWorldbookMatches: false,
          },
        },
        warnings: ["derived"],
      })),
    });

    await mountRoutes(controlService);

    const response = await app.inject({
      method: "GET",
      url: "/sessions/s1/prompt-runtime/branches/alt-branch/policy",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        persistent_policy: {
          delivery: { no_assistant: true },
        },
        resolved_policy: {
          structure: { mode: "no_assistant", merge_adjacent_same_role: false, preserve_system_messages: true, assistant_rewrite_strategy: "to_system" },
          delivery: { allow_assistant_prefill: true, require_last_user: false, no_assistant: true },
          budget: {},
          source_selection: { history: { mode: "full" }, memory: { enabled: true }, worldbook: { enabled: true }, examples: { enabled: true } },
          visibility: defaultResolvedVisibility,
          debug: { include_prompt_snapshot: false, include_runtime_trace: false, include_worldbook_matches: false },
        },
        warnings: ["derived"],
      },
    });
    expect(controlService.getBranchPolicy).toHaveBeenCalledWith("s1", "alt-branch", DEFAULT_ADMIN_ACCOUNT_ID);
  });

  it("maps PATCH /sessions/:id/prompt-runtime/branches/:branchId/policy request and response", async () => {
    const controlService = createPromptRuntimeControlService({
      updateBranchPolicy: vi.fn(async () => ({
        persistentPolicy: {
          structure: {
            mode: "strict_alternating",
          },
        },
        resolvedPolicy: {
          structure: {
            mode: "strict_alternating",
            mergeAdjacentSameRole: true,
            preserveSystemMessages: true,
          },
          delivery: {
            allowAssistantPrefill: true,
            requireLastUser: false,
            noAssistant: false,
          },
          budget: {},
          sourceSelection: { history: { mode: "full" }, memory: { enabled: true }, worldbook: { enabled: true }, examples: { enabled: true } },
          visibility: defaultResolvedVisibility,
          debug: {
            includePromptSnapshot: false,
            includeRuntimeTrace: false,
            includeWorldbookMatches: false,
          },
        },
        warnings: [],
      })),
    });

    await mountRoutes(controlService);

    const response = await app.inject({
      method: "PATCH",
      url: "/sessions/s1/prompt-runtime/branches/alt-branch/policy",
      payload: {
        structure: { mode: "strict_alternating" },
        visibility: { mode: "deny_all_except_visible", visible_floor_ranges: [{ start_floor_no: 3, end_floor_no: 4 }] },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(controlService.updateBranchPolicy).toHaveBeenCalledWith("s1", "alt-branch", DEFAULT_ADMIN_ACCOUNT_ID, { structure: { mode: "strict_alternating" }, visibility: { mode: "deny_all_except_visible", visibleFloorRanges: [{ startFloorNo: 3, endFloorNo: 4 }] } }, DEFAULT_ADMIN_ACCOUNT_ID);
  });

  it("rejects macro-related write attempts outside the mutable policy surface", async () => {
    const controlService = createPromptRuntimeControlService();

    await mountRoutes(controlService);

    const response = await app.inject({
      method: "PATCH",
      url: "/sessions/s1/prompt-runtime/policy",
      payload: {
        delivery: { require_last_user: true },
        macro: {
          built_in_values: { last_generation_type: "retry" },
          st_compatibility_snapshots: { local: {}, global: {} },
          run_kind: "retry",
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "validation_error" } });
    expect(controlService.updatePolicy).not.toHaveBeenCalled();
  });

  it("maps GET /sessions/:id/prompt-runtime/assets response to snake_case", async () => {
    const controlService = createPromptRuntimeControlService({
      getAssets: vi.fn(async () => ({
        preset: { id: "preset-1", name: "Preset One" },
        characterCard: { id: "char-1", name: "Hero" },
        worldbook: { id: "wb-1", name: "Lorebook" },
        regexProfile: null,
      })),
    });

    await mountRoutes(controlService);

    const response = await app.inject({
      method: "GET",
      url: "/sessions/s1/prompt-runtime/assets",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        preset: { id: "preset-1", name: "Preset One" },
        character_card: { id: "char-1", name: "Hero" },
        worldbook: { id: "wb-1", name: "Lorebook" },
        regex_profile: null,
      },
    });

    expect(controlService.getAssets).toHaveBeenCalledWith("s1", DEFAULT_ADMIN_ACCOUNT_ID);
  });

  it("maps POST /sessions/:id/prompt-runtime/preview request and response", async () => {
    const controlService = createPromptRuntimeControlService();
    const previewService = createPromptRuntimePreviewService({
      previewPromptRuntimeText: vi.fn(async () => ({
        scope: {
          sessionId: "s1",
          targetBranchId: "alt-preview",
          branchExists: false,
          sourceFloorId: "floor-source",
          historySourceBranchId: "fork-branch",
          historySourceMode: "source_floor_branch",
        },
        policy: {
          structure: {
            mode: "no_assistant",
            mergeAdjacentSameRole: false,
            preserveSystemMessages: true,
            assistantRewriteStrategy: "to_system",
          },
          delivery: {
            allowAssistantPrefill: true,
            requireLastUser: false,
            noAssistant: true,
          },
          budget: { maxInputTokens: 4096, reservedCompletionTokens: 1024 },
          sourceSelection: { history: { mode: "windowed", maxMessages: 24 }, memory: { enabled: true }, worldbook: { enabled: true }, examples: { enabled: false } },
          visibility: { mode: "allow_all_except_hidden", hiddenFloorRanges: [{ startFloorNo: 1, endFloorNo: 2 }] },
          debug: { includePromptSnapshot: false, includeRuntimeTrace: false, includeWorldbookMatches: false },
        },
        sourceMap: { delivery: { noAssistant: "request_override" }, budget: { maxInputTokens: "request_override", reservedCompletionTokens: "request_override" }, sourceSelection: { history: { mode: "request_override", maxMessages: "request_override" }, memory: { enabled: "system_default" }, worldbook: { enabled: "system_default" }, examples: { enabled: "request_override" } }, visibility: { mode: "request_override", hiddenFloorRanges: "request_override" }, history: { sourceBranchId: "fork-branch", sourceMode: "source_floor_branch" } },
        diagnostics: [{ code: "unmaterialized_branch_preview", message: "branch pending", severity: "info", source: "branch", phase: "preview" }],
        limitations: ["memory remains shared"],
        text: "3",
        runtimeTrace: {
          sourceSelection: { excludedSources: [{ source: "history", reason: "visibility_filtered", detail: "Visibility filtered 2 floor(s) from the available history window." }] },
          macro: {
            warnings: [{ code: "macro_preview_side_effect_suppressed", message: "previewed", macroName: "setvar" }],
            usedNames: ["setvar", "getvar"],
            mutationPreview: [{ kind: "set", scope: "branch", key: "资产", value: '{"金币":3}' }],
            stagedMutations: [],
            traces: [
              { macroName: "setvar", rawText: "{{.资产.金币=3}}", resolvedText: "", phase: "preview", sourceKind: "macro" },
              { macroName: "getvar", rawText: "{{getvar::资产.金币}}", resolvedText: "3", phase: "preview", sourceKind: "macro" },
            ],
          },
          visibility: {
            hiddenFloorRanges: [{ startFloorNo: 1, endFloorNo: 2 }],
            filteredFloorNos: [1, 2],
          },
        },
      })),
    });

    await mountRoutes(controlService, previewService);

    const response = await app.inject({
      method: "POST",
      url: "/sessions/s1/prompt-runtime/preview",
      payload: {
        text: "{{.资产.金币=3}}{{getvar::资产.金币}}",
        branch_id: "alt-preview",
        source_floor_id: "floor-source",
        delivery: {
          no_assistant: true,
        },
        budget: {
          max_input_tokens: 4096,
          reserved_completion_tokens: 1024,
        },
        source_selection: {
          history: { mode: "windowed", max_messages: 24 },
          memory: { enabled: true },
          worldbook: { enabled: true },
          examples: { enabled: false },
        },
        visibility: {
          mode: "allow_all_except_hidden",
          hidden_floor_ranges: [{ start_floor_no: 1, end_floor_no: 2 }],
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        scope: {
          session_id: "s1",
          target_branch_id: "alt-preview",
          branch_exists: false,
          source_floor_id: "floor-source",
          history_source_branch_id: "fork-branch",
          history_source_mode: "source_floor_branch",
        },
        policy: {
          structure: { mode: "no_assistant", merge_adjacent_same_role: false, preserve_system_messages: true, assistant_rewrite_strategy: "to_system" },
          delivery: { allow_assistant_prefill: true, require_last_user: false, no_assistant: true },
          budget: { max_input_tokens: 4096, reserved_completion_tokens: 1024 },
          source_selection: { history: { mode: "windowed", max_messages: 24 }, memory: { enabled: true }, worldbook: { enabled: true }, examples: { enabled: false } },
          visibility: { mode: "allow_all_except_hidden", hidden_floor_ranges: [{ start_floor_no: 1, end_floor_no: 2 }] },
          debug: { include_prompt_snapshot: false, include_runtime_trace: false, include_worldbook_matches: false },
        },
        source_map: {
          delivery: { no_assistant: "request_override" },
          budget: { max_input_tokens: "request_override", reserved_completion_tokens: "request_override" },
          source_selection: { history: { mode: "request_override", max_messages: "request_override" }, memory: { enabled: "system_default" }, worldbook: { enabled: "system_default" }, examples: { enabled: "request_override" } },
          visibility: { mode: "request_override", hidden_floor_ranges: "request_override" },
          history: { source_branch_id: "fork-branch", source_mode: "source_floor_branch" },
        },
        diagnostics: [{ code: "unmaterialized_branch_preview", message: "branch pending", severity: "info", source: "branch", phase: "preview" }],
        limitations: ["memory remains shared"],
        text: "3",
        runtime_trace: {
          macro: {
            warnings: [{ code: "macro_preview_side_effect_suppressed", message: "previewed", macro_name: "setvar" }],
            used_names: ["setvar", "getvar"],
            mutation_preview: [{ kind: "set", scope: "branch", key: "资产", value: '{"金币":3}' }],
            staged_mutations: [],
            traces: [
              { macro_name: "setvar", raw_text: "{{.资产.金币=3}}", resolved_text: "", phase: "preview", source_kind: "macro" },
              { macro_name: "getvar", raw_text: "{{getvar::资产.金币}}", resolved_text: "3", phase: "preview", source_kind: "macro" },
            ],
          },
          visibility: {
            hidden_floor_ranges: [{ start_floor_no: 1, end_floor_no: 2 }],
            filtered_floor_nos: [1, 2],
          },
          source_selection: {
            excluded_sources: [
              {
                source: "history",
                reason: "visibility_filtered",
                detail: "Visibility filtered 2 floor(s) from the available history window.",
              },
            ],
          },
        },
      },
    });
    expect(previewService.previewPromptRuntimeText).toHaveBeenCalledWith("s1", {
      text: "{{.资产.金币=3}}{{getvar::资产.金币}}",
      branchId: "alt-preview",
      sourceFloorId: "floor-source",
      visibility: {
        mode: "allow_all_except_hidden",
        hiddenFloorRanges: [{ startFloorNo: 1, endFloorNo: 2 }],
      },
      delivery: {
        noAssistant: true,
      },
      budget: {
        maxInputTokens: 4096,
        reservedCompletionTokens: 1024,
      },
      sourceSelection: {
        history: { mode: "windowed", maxMessages: 24 },
        memory: { enabled: true },
        worldbook: { enabled: true },
        examples: { enabled: false },
      },
    }, DEFAULT_ADMIN_ACCOUNT_ID);
  });

  it("accepts flattened preview structure overrides without expanding preview runtime trace contract", async () => {
    const controlService = createPromptRuntimeControlService();

    const overbroadPreviewRuntimeTrace = {
      macro: {
        warnings: [],
        usedNames: ["lastUserMessage"],
        mutationPreview: [],
        stagedMutations: [],
        traces: [],
      },
      structure: {
        mode: "flattened",
        mergeAdjacentSameRole: false,
        assistantRewriteCount: 0,
        tailAssistantDetected: false,
        transcriptized: true,
        transcriptMessageCount: 1,
        assistantPrefillTranscriptized: false,
      },
      delivery: {
        assistantPrefillRequested: false,
        assistantPrefillApplied: false,
        assistantPrefillStrategy: "none",
        allowAssistantPrefill: true,
        requireLastUser: true,
        noAssistant: true,
        lastMessageRole: "user",
        endsWithUser: true,
        degraded: false,
        degradeReasons: [],
      },
    } as unknown as PromptRuntimePreviewResult["runtimeTrace"];

    const previewService = createPromptRuntimePreviewService({
      previewPromptRuntimeText: vi.fn(async () => ({
        scope: {
          sessionId: "s1",
          targetBranchId: "alt-preview",
          branchExists: true,
          sourceFloorId: null,
          historySourceBranchId: "alt-preview",
          historySourceMode: "existing_branch",
        },
        policy: {
          structure: {
            mode: "flattened",
            mergeAdjacentSameRole: false,
            preserveSystemMessages: true,
          },
          delivery: {
            allowAssistantPrefill: true,
            requireLastUser: true,
            noAssistant: true,
          },
          budget: {},
          sourceSelection: { history: { mode: "full" }, memory: { enabled: true }, worldbook: { enabled: true }, examples: { enabled: true } },
          visibility: { mode: "allow_all_except_hidden" },
          debug: { includePromptSnapshot: false, includeRuntimeTrace: false, includeWorldbookMatches: false },
        },
        diagnostics: [],
        limitations: [],
        text: "Preview flatten boundary",
        runtimeTrace: overbroadPreviewRuntimeTrace,
      })),
    });

    await mountRoutes(controlService, previewService);

    const response = await app.inject({
      method: "POST",
      url: "/sessions/s1/prompt-runtime/preview",
      payload: {
        text: "{{lastUserMessage}}",
        branch_id: "alt-preview",
        structure: { mode: "flattened" },
        delivery: { require_last_user: true, no_assistant: true },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.policy.structure).toEqual({ mode: "flattened", merge_adjacent_same_role: false, preserve_system_messages: true });
    expect(response.json().data.policy.delivery).toEqual({ allow_assistant_prefill: true, require_last_user: true, no_assistant: true });
    expect(response.json().data.runtime_trace).not.toHaveProperty("structure");
    expect(response.json().data.runtime_trace).not.toHaveProperty("delivery");
    expect(previewService.previewPromptRuntimeText).toHaveBeenCalledWith("s1", {
      text: "{{lastUserMessage}}",
      branchId: "alt-preview",
      structure: { mode: "flattened" },
      delivery: { requireLastUser: true, noAssistant: true },
    }, DEFAULT_ADMIN_ACCOUNT_ID);
  });

  it("returns 404 when prompt runtime preview endpoint is disabled", async () => {
    const controlService = createPromptRuntimeControlService();

    await mountRoutes(controlService);

    const response = await app.inject({
      method: "POST",
      url: "/sessions/s1/prompt-runtime/preview",
      payload: { text: "{{lastMessage}}" },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: { code: "not_found", message: "Prompt runtime preview endpoint is disabled" } });
  });

  it("maps prompt runtime preview service errors to stable http errors", async () => {
    const controlService = createPromptRuntimeControlService();
    const previewService = createPromptRuntimePreviewService({
      previewPromptRuntimeText: vi.fn(async () => {
        throw new ChatServiceError("source_floor_not_found", "Source floor is missing");
      }),
    });

    await mountRoutes(controlService, previewService);

    const response = await app.inject({
      method: "POST",
      url: "/sessions/s1/prompt-runtime/preview",
      payload: { text: "{{lastMessage}}", source_floor_id: "missing" },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: { code: "source_floor_not_found", message: "Source floor is missing" } });
  });

  it("maps branch_local_snapshot_missing preview errors to 409", async () => {
    const controlService = createPromptRuntimeControlService();
    const previewService = createPromptRuntimePreviewService({
      previewPromptRuntimeText: vi.fn(async () => {
        throw new ChatServiceError("branch_local_snapshot_missing", "Source floor snapshot is missing");
      }),
    });

    await mountRoutes(controlService, previewService);

    const response = await app.inject({
      method: "POST",
      url: "/sessions/s1/prompt-runtime/preview",
      payload: { text: "{{getvar::mood}}", branch_id: "alt-preview", source_floor_id: "floor-old" },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: { code: "branch_local_snapshot_missing", message: "Source floor snapshot is missing" } });
  });

  it("maps POST /sessions/:id/prompt-runtime/inspect request and response", async () => {
    const controlService = createPromptRuntimeControlService();
    const inspectService = createPromptRuntimeInspectService({
      inspectPromptRuntime: vi.fn(async () => ({
        scope: {
          sessionId: "s1",
          targetBranchId: "alt-inspect",
          branchExists: false,
          sourceFloorId: "floor-12",
          historySourceBranchId: "fork-branch",
          historySourceMode: "source_floor_branch",
        },
        policy: {
          structure: { mode: "no_assistant", mergeAdjacentSameRole: false, preserveSystemMessages: true, assistantRewriteStrategy: "to_system" },
          delivery: { allowAssistantPrefill: true, requireLastUser: false, noAssistant: true },
          budget: { maxInputTokens: 4096, reservedCompletionTokens: 1024 },
          sourceSelection: { history: { mode: "windowed", maxMessages: 24 }, memory: { enabled: true }, worldbook: { enabled: true }, examples: { enabled: false } },
          visibility: { mode: "allow_all_except_hidden", hiddenFloorRanges: [{ startFloorNo: 1, endFloorNo: 2 }] },
          debug: { includePromptSnapshot: false, includeRuntimeTrace: true, includeWorldbookMatches: true },
        },
        sourceMap: {
          delivery: { noAssistant: "request_override" },
          history: { sourceBranchId: "fork-branch", sourceMode: "source_floor_branch" },
        },
        diagnostics: [{ code: "unmaterialized_branch_inspect", message: "branch pending", severity: "info", source: "branch", phase: "assemble" }],
        trimReasons: [{ group: "history", reason: "group_limit_exceeded", prunedTokenCount: 32 }],
        excludedSources: [{ source: "history", reason: "visibility_filtered", detail: "Visibility filtered 2 floor(s) from the available history window." }],
        sectionStats: [{ sectionName: "history", tokenCount: 256 }],
        limitations: ["inspect is read-only"],
        preparedTurn: {
          messages: [{ role: "system", content: "System prompt" }, { role: "user", content: "Hello there" }],
          tokenEstimate: 320,
          availableForReply: 704,
          preprocessedUserMessage: "Hello there",
          promptSnapshot: {
            presetId: "preset-1",
            presetUpdatedAt: 1710000000000,
            presetVersion: 3,
            worldbookId: null,
            worldbookUpdatedAt: null,
            worldbookVersion: null,
            regexProfileId: null,
            regexProfileUpdatedAt: null,
            regexProfileVersion: null,
            worldbookActivatedEntryUids: [7],
            regexPreRuleNames: ["Input Rule"],
            regexPostRuleNames: [],
            promptMode: "native",
            promptDigest: "digest-inspect",
            tokenEstimate: 320,
          },
          runtimeTrace: {
            budgets: {
              byGroup: [{ group: "history", tokenCount: 256 }],
            },
          },
          memorySummary: "Remember the promise.",
          generationParams: { maxOutputTokens: 256, temperature: 0.7 },
          requestedTurnConfig: { enableTools: true, toolMode: "both" },
          turnConfig: { enableTools: true, toolMode: "both" },
          sessionStateWrites: {
            total: 1,
            writes: [{ namespace: "quest_flags", slot: "companion", operation: "set" }],
          },
        },
        governance: {
          entries: [{ sourceKind: "memory", declaredLevel: "soft_required", registered: true, effectiveRetention: "soft_required", pinned: false, prunable: false, budgetGroups: ["memory"], sectionNames: ["memory"], tokenCount: 64, retainedTokenCount: 64, prunedTokenCount: 0 }],
          mismatches: [],
          limitations: [],
        },
      })),
    });

    await mountRoutes(controlService, undefined, inspectService);

    const response = await app.inject({
      method: "POST",
      url: "/sessions/s1/prompt-runtime/inspect",
      payload: {
        message: "Hello there",
        branch_id: "alt-inspect",
        source_floor_id: "floor-12",
        generation_params: { max_output_tokens: 256, temperature: 0.7 },
        session_state_writes: [{ namespace: "quest_flags", slot: "companion", value: { mood: "ally" } }],
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.scope).toEqual({
      session_id: "s1",
      target_branch_id: "alt-inspect",
      branch_exists: false,
      source_floor_id: "floor-12",
      history_source_branch_id: "fork-branch",
      history_source_mode: "source_floor_branch",
    });
    expect(body.data.source_map).toEqual({ delivery: { no_assistant: "request_override" }, history: { source_branch_id: "fork-branch", source_mode: "source_floor_branch" } });
    expect(body.data.prepared_turn.messages).toEqual([{ role: "system", content: "System prompt" }, { role: "user", content: "Hello there" }]);
    expect(body.data.prepared_turn.session_state_writes).toEqual({ total: 1, writes: [{ namespace: "quest_flags", slot: "companion", operation: "set" }] });
    expect(body.data.governance.entries).toEqual([{ source_kind: "memory", declared_level: "soft_required", registered: true, effective_retention: "soft_required", pinned: false, prunable: false, budget_groups: ["memory"], section_names: ["memory"], token_count: 64, retained_token_count: 64, pruned_token_count: 0 }]);
    expect(body.data.trim_reasons).toEqual([{ group: "history", reason: "group_limit_exceeded", pruned_token_count: 32 }]);
    expect(body.data.excluded_sources).toEqual([{ source: "history", reason: "visibility_filtered", detail: "Visibility filtered 2 floor(s) from the available history window." }]);

    expect(inspectService.inspectPromptRuntime).toHaveBeenCalledWith("s1", {
      message: "Hello there",
      branchId: "alt-inspect",
      sourceFloorId: "floor-12",
      generationParams: { maxOutputTokens: 256, temperature: 0.7 },
      sessionStateWrites: [{ namespace: "quest_flags", slot: "companion", value: { mood: "ally" } }],
    }, DEFAULT_ADMIN_ACCOUNT_ID);
  });


  it("maps GET /floors/:id/prompt-runtime/explain response to snake_case", async () => {
    const controlService = createPromptRuntimeControlService({
      getHistoricalExplain: vi.fn(async () => ({
        floor: {
          id: "floor-12",
          sessionId: "s1",
          floorNo: 12,
          branchId: "main",
          parentFloorId: "floor-11",
          state: "committed",
          promptSnapshotCreatedAt: 1710000003000,
          committedAt: 1710000004000,
        },
        scope: {
          sessionId: "s1",
          targetBranchId: "main",
          branchExists: true,
          sourceFloorId: null,
          historySourceBranchId: "main",
          historySourceMode: "existing_branch",
        },
        snapshotAvailable: true,
        assets: {
          preset: { id: "preset-1", name: "Preset One" },
          characterCard: { id: "char-1", name: "Hero" },
          worldbook: { id: "wb-1", name: "Lorebook" },
          regexProfile: null,
        },
        promptSnapshot: {
          presetId: "preset-1",
          presetUpdatedAt: 1710000000000,
          presetVersion: 3,
          worldbookId: "wb-1",
          worldbookUpdatedAt: 1710000001000,
          worldbookVersion: 5,
          regexProfileId: "regex-1",
          regexProfileUpdatedAt: 1710000002000,
          regexProfileVersion: 2,
          worldbookActivatedEntryUids: [7],
          regexPreRuleNames: ["Input Rule"],
          regexPostRuleNames: [],
          promptMode: "compat_strict",
          promptDigest: "digest-1",
          tokenEstimate: 42,
        },
        resolvedPolicy: null,
        governance: null,
        sourceMap: { history: { sourceBranchId: "main", sourceMode: "existing_branch" } },
        trimReasons: [{
          group: "section:main",
          reason: "budget_exceeded",
          detail: "Prompt runtime pruned 128 tokens from budget group 'section:main'.",
          prunedTokenCount: 128,
        }],
        excludedSources: [{
          source: "examples",
          reason: "disabled_by_policy",
          detail: "sourceSelection.examples.enabled=false removed example dialogue from prompt assembly.",
        }],
        sectionStats: [{ sectionName: "history", tokenCount: 320 }, { sectionName: "main", tokenCount: 96 }],
        diagnostics: [{ code: "historical_resolved_policy_unavailable", message: "policy unavailable", severity: "info", source: "policy", fieldPath: "resolved_policy", phase: "explain" }],
        limitations: ["persisted only"],
        result: {
          outputPageId: "page-output-12",
          assistantMessageId: "msg-assistant-12",
          generatedText: "hello",
          summaries: ["summary"],
          usage: { promptTokens: 320, completionTokens: 128, totalTokens: 448 },
          verifier: null,
          committedAt: 1710000004000,
        },
      })),
    });

    await mountRoutes(controlService);

    const response = await app.inject({
      method: "GET",
      url: "/floors/floor-12/prompt-runtime/explain",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        floor: {
          id: "floor-12",
          session_id: "s1",
          floor_no: 12,
          branch_id: "main",
          parent_floor_id: "floor-11",
          state: "committed",
          prompt_snapshot_created_at: 1710000003000,
          committed_at: 1710000004000,
        },
        scope: {
          session_id: "s1",
          target_branch_id: "main",
          branch_exists: true,
          source_floor_id: null,
          history_source_branch_id: "main",
          history_source_mode: "existing_branch",
        },
        snapshot_available: true,
        assets: {
          preset: { id: "preset-1", name: "Preset One" },
          character_card: { id: "char-1", name: "Hero" },
          worldbook: { id: "wb-1", name: "Lorebook" },
          regex_profile: null,
        },
        prompt_snapshot: {
          preset_id: "preset-1",
          preset_updated_at: 1710000000000,
          preset_version: 3,
          worldbook_id: "wb-1",
          worldbook_updated_at: 1710000001000,
          worldbook_version: 5,
          regex_profile_id: "regex-1",
          regex_profile_updated_at: 1710000002000,
          regex_profile_version: 2,
          worldbook_activated_entry_uids: [7],
          regex_pre_rule_names: ["Input Rule"],
          regex_post_rule_names: [],
          prompt_mode: "compat_strict",
          prompt_digest: "digest-1",
          token_estimate: 42,
        },
        resolved_policy: null,
        governance: null,
        source_map: {
          history: { source_branch_id: "main", source_mode: "existing_branch" },
        },
        trim_reasons: [{
          group: "section:main",
          reason: "budget_exceeded",
          detail: "Prompt runtime pruned 128 tokens from budget group 'section:main'.",
          pruned_token_count: 128,
        }],
        excluded_sources: [{
          source: "examples",
          reason: "disabled_by_policy",
          detail: "sourceSelection.examples.enabled=false removed example dialogue from prompt assembly.",
        }],
        section_stats: [{ section_name: "history", token_count: 320 }, { section_name: "main", token_count: 96 }],
        diagnostics: [{ code: "historical_resolved_policy_unavailable", message: "policy unavailable", severity: "info", source: "policy", field_path: "resolved_policy", phase: "explain" }],
        limitations: ["persisted only"],
        result: {
          output_page_id: "page-output-12",
          assistant_message_id: "msg-assistant-12",
          generated_text: "hello",
          summaries: ["summary"],
          usage: { prompt_tokens: 320, completion_tokens: 128, total_tokens: 448 },
          verifier: null,
          committed_at: 1710000004000,
        },
      },
    });

    expect(controlService.getHistoricalExplain).toHaveBeenCalledWith("floor-12", DEFAULT_ADMIN_ACCOUNT_ID);
  });

  it("maps POST /sessions/:id/prompt-runtime/compare response to snake_case", async () => {
    const controlService = createPromptRuntimeControlService({
      compareCommittedExplain: vi.fn(async () => ({
        left: { floorId: "floor-left", snapshotAvailable: true },
        right: { floorId: "floor-right", snapshotAvailable: false },
        scopeChanges: [],
        policyChanges: [{ path: "policy.resolvedPolicy.delivery.noAssistant", changeType: "changed", left: false, right: true }],
        assetChanges: [],
        diagnosticsChanges: [],
        trimChanges: [{
          path: "trimReasons",
          changeType: "changed",
          left: [{ group: "section:main", reason: "group_limit_exceeded", prunedTokenCount: 32 }],
          right: [{ group: "section:main", reason: "group_limit_exceeded", prunedTokenCount: 64 }],
        }],
        exclusionChanges: [{
          path: "excludedSources",
          changeType: "changed",
          left: [{ source: "history", reason: "visibility_filtered" }],
          right: [{ source: "examples", reason: "disabled_by_policy" }],
        }],
        governanceChanges: [],
        limitations: ["Right floor 'floor-right' has no committed prompt runtime snapshot. Compare skipped recomputation and returned limitations only."],
      })),
    });

    await mountRoutes(controlService);

    const response = await app.inject({
      method: "POST",
      url: "/sessions/s1/prompt-runtime/compare",
      payload: {
        left: { floor_id: "floor-left" },
        right: { floor_id: "floor-right" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        left: { floor_id: "floor-left", snapshot_available: true },
        right: { floor_id: "floor-right", snapshot_available: false },
        scope_changes: [],
        policy_changes: [{ path: "policy.resolved_policy.delivery.no_assistant", change_type: "changed", left: false, right: true }],
        asset_changes: [],
        diagnostics_changes: [],
        trim_changes: [{
          path: "trim_reasons",
          change_type: "changed",
          left: [{ group: "section:main", reason: "group_limit_exceeded", pruned_token_count: 32 }],
          right: [{ group: "section:main", reason: "group_limit_exceeded", pruned_token_count: 64 }],
        }],
        exclusion_changes: [{
          path: "excluded_sources",
          change_type: "changed",
          left: [{ source: "history", reason: "visibility_filtered" }],
          right: [{ source: "examples", reason: "disabled_by_policy" }],
        }],
        governance_changes: [],
        limitations: ["Right floor 'floor-right' has no committed prompt runtime snapshot. Compare skipped recomputation and returned limitations only."],
      },
    });
    expect(controlService.compareCommittedExplain).toHaveBeenCalledWith("s1", "floor-left", "floor-right", DEFAULT_ADMIN_ACCOUNT_ID);
  });

  it("maps GET /prompt-runtime/capabilities response to snake_case", async () => {
    const controlService = createPromptRuntimeControlService({
      getCapabilities: vi.fn(() => ({
        structure: {
          modes: ["default", "strict_alternating", "no_assistant", "flattened"],
          defaults: {
            mode: "default",
            mergeAdjacentSameRole: false,
            preserveSystemMessages: true,
          },
        },
        delivery: {
          defaults: {
            allowAssistantPrefill: true,
            requireLastUser: false,
            noAssistant: false,
          },
        },
        budget: {
          defaults: {},
          requestOverrideSupported: true,
          persistentPatchSupported: true,
          supportedFields: ["maxInputTokens", "reservedCompletionTokens"],
          trimReasonCodes: ["budget_exceeded", "group_limit_exceeded", "provider_constraint", "policy_disabled"],
        },
        sourceSelection: {
          defaults: {
            history: { mode: "full" },
            memory: { enabled: true },
            worldbook: { enabled: true },
            examples: { enabled: true },
          },
          requestOverrideSupported: true,
          persistentPatchSupported: true,
          supportedSources: ["history", "memory", "worldbook", "examples"],
          historyModes: ["full", "windowed"],
          exclusionReasonCodes: ["disabled_by_policy", "budget_trimmed", "provider_constraint", "visibility_filtered", "not_triggered"],
        },
        governance: {
          session: {
            envelopeMetadata: true,
            nullClearsField: true,
            objectPatch: "deep_merge",
            supportedFields: ["structure", "delivery", "budget", "sourceSelection", "visibility"],
          },
          branch: {
            envelopeMetadata: true,
            materializedBranchesOnly: true,
            nullClearsField: true,
            objectPatch: "deep_merge",
            supportedFields: ["structure", "delivery", "budget", "sourceSelection", "visibility"],
          },
        },
        compare: {
          enabled: true,
          committedFloorsOnly: true,
          mixedPreviewSupported: false,
          limitationsInsteadOfRecompute: true,
        },
        observability: {
          live: {
            enabled: true,
            defaultOff: true,
            requestScopedOnly: true,
            includePromptSnapshot: true,
            includeRuntimeTrace: true,
            includeWorldbookMatches: true,
            worldbookMatchesRequiresRuntimeTrace: true,
            worldbookMatchesRequiresOptIn: true,
            visibilityRequestSupported: false,
          },
          dryRun: {
            enabled: true,
            returnsAssembly: true,
            returnsRuntimeTrace: true,
            supportsVisibility: true,
            includeWorldbookMatches: true,
          },
          inspect: {
            enabled: true,
            mode: "prepared_turn",
            supportsBranch: true,
            supportsSourceFloor: true,
            supportsVisibility: true,
            returnsPreparedTurn: true,
            returnsGovernance: true,
            llmCall: false,
            createsFloor: false,
            writesPromptSnapshot: false,
            writesExplainSnapshot: false,
            commitsSideEffects: false,
          },
          preview: {
            enabled: true,
            mode: "macro_text_preview",
            returnsRuntimeTrace: true,
            returnsAssemblyTruth: false,
            supportsVisibility: true,
            singleTextOnly: true,
            llmCall: false,
            createsFloor: false,
            writesPromptSnapshot: false,
            commitsSideEffects: false,
            traceSubset: ["macro", "source_selection", "visibility"],
          },
          explain: {
            enabled: true,
            readOnly: true,
            returnsGovernance: true,
            requiresCommittedFloor: true,
            persistedTruthOnly: true,
            recompute: false,
            snapshotSupported: true,
            legacyFloorFallback: true,
            snapshotAvailabilityField: "snapshot_available",
          },
          stream: {
            enabled: true,
            promptDebugPayload: "done_only",
            newSseEventFamily: false,
          },
        },
        macro: {
          builtInReadOnlyValuesPersistable: false,
          stCompatibilitySnapshotsPersistable: false,
          runKindPersistable: false,
          diagnosticsSurface: "unified_observability",
          dedicatedMacrosRoute: false,
          recentMessageRespectsVisibility: true,
        },
        unsupported: ["/sessions/:id/prompt-runtime/macros"],
      })),
    });

    await mountRoutes(controlService);

    const response = await app.inject({
      method: "GET",
      url: "/prompt-runtime/capabilities",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        structure: {
          modes: ["default", "strict_alternating", "no_assistant", "flattened"],
          defaults: {
            mode: "default",
            merge_adjacent_same_role: false,
            preserve_system_messages: true,
          },
        },
        delivery: {
          defaults: {
            allow_assistant_prefill: true,
            require_last_user: false,
            no_assistant: false,
          },
        },
        budget: {
          defaults: {},
          request_override_supported: true,
          persistent_patch_supported: true,
          supported_fields: ["maxInputTokens", "reservedCompletionTokens"],
          trim_reason_codes: ["budget_exceeded", "group_limit_exceeded", "provider_constraint", "policy_disabled"],
        },
        source_selection: {
          defaults: {
            history: { mode: "full" },
            memory: { enabled: true },
            worldbook: { enabled: true },
            examples: { enabled: true },
          },
          request_override_supported: true,
          persistent_patch_supported: true,
          supported_sources: ["history", "memory", "worldbook", "examples"],
          history_modes: ["full", "windowed"],
          exclusion_reason_codes: ["disabled_by_policy", "budget_trimmed", "provider_constraint", "visibility_filtered", "not_triggered"],
        },
        governance: {
          session: {
            envelope_metadata: true,
            null_clears_field: true,
            object_patch: "deep_merge",
            supported_fields: ["structure", "delivery", "budget", "sourceSelection", "visibility"],
          },
          branch: {
            envelope_metadata: true,
            materialized_branches_only: true,
            null_clears_field: true,
            object_patch: "deep_merge",
            supported_fields: ["structure", "delivery", "budget", "sourceSelection", "visibility"],
          },
        },
        compare: {
          enabled: true,
          committed_floors_only: true,
          mixed_preview_supported: false,
          limitations_instead_of_recompute: true,
        },
        observability: {
          live: {
            enabled: true,
            default_off: true,
            request_scoped_only: true,
            include_prompt_snapshot: true,
            include_runtime_trace: true,
            include_worldbook_matches: true,
            worldbook_matches_requires_runtime_trace: true,
            worldbook_matches_requires_opt_in: true,
            visibility_request_supported: false,
          },
          dry_run: {
            enabled: true,
            returns_assembly: true,
            returns_runtime_trace: true,
            supports_visibility: true,
            include_worldbook_matches: true,
          },
          inspect: {
            enabled: true,
            mode: "prepared_turn",
            supports_branch: true,
            supports_source_floor: true,
            supports_visibility: true,
            returns_prepared_turn: true,
            returns_governance: true,
            llm_call: false,
            creates_floor: false,
            writes_prompt_snapshot: false,
            writes_explain_snapshot: false,
            commits_side_effects: false,
          },
          preview: {
            enabled: true,
            mode: "macro_text_preview",
            returns_runtime_trace: true,
            returns_assembly_truth: false,
            supports_visibility: true,
            single_text_only: true,
            llm_call: false,
            creates_floor: false,
            writes_prompt_snapshot: false,
            commits_side_effects: false,
            trace_subset: ["macro", "source_selection", "visibility"],
          },
          explain: {
            enabled: true,
            read_only: true,
            returns_governance: true,
            requires_committed_floor: true,
            persisted_truth_only: true,
            recompute: false,
            snapshot_supported: true,
            legacy_floor_fallback: true,
            snapshot_availability_field: "snapshot_available",
          },
          stream: {
            enabled: true,
            prompt_debug_payload: "done_only",
            new_sse_event_family: false,
          },
        },
        macro: {
          built_in_read_only_values_persistable: false,
          st_compatibility_snapshots_persistable: false,
          run_kind_persistable: false,
          diagnostics_surface: "unified_observability",
          dedicated_macros_route: false,
          recent_message_respects_visibility: true,
        },
        unsupported: ["/sessions/:id/prompt-runtime/macros"],
      },
    });

    expect(controlService.getCapabilities).toHaveBeenCalledTimes(1);
  });

  it("maps PromptRuntimeControlServiceError to stable http error", async () => {
    const controlService = createPromptRuntimeControlService({
      getResolvedState: vi.fn(async () => {
        throw new PromptRuntimeControlServiceError(404, "not_found", "Session not found");
      }),
    });

    await mountRoutes(controlService);

    const response = await app.inject({
      method: "GET",
      url: "/sessions/missing/prompt-runtime",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: {
        code: "not_found",
        message: "Session not found",
      },
    });
  });
});
