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
import { registerDevelopmentTestAuth } from "./helpers/register-test-auth";

type PromptRuntimeControlServiceStub = {
  getResolvedState: ReturnType<typeof vi.fn>;
  getPolicy: ReturnType<typeof vi.fn>;
  getAssets: ReturnType<typeof vi.fn>;
  updatePolicy: ReturnType<typeof vi.fn>;
  getCapabilities: ReturnType<typeof vi.fn>;
};

function createPromptRuntimeControlService(
  overrides: Partial<PromptRuntimeControlServiceStub> = {},
): PromptRuntimeControlServiceStub {
  return {
    getResolvedState: vi.fn(),
    getPolicy: vi.fn(),
    getAssets: vi.fn(),
    updatePolicy: vi.fn(),
    getCapabilities: vi.fn(),
    ...overrides,
  };
}

describe("prompt runtime routes", () => {
  let app: FastifyInstance;

  async function mountRoutes(service: PromptRuntimeControlServiceStub) {
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
    await registerPromptRuntimeRoutes(app, service as unknown as PromptRuntimeControlService);
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
        },
        warnings: ["compat warning"],
      })),
    });

    await mountRoutes(controlService);

    const response = await app.inject({
      method: "GET",
      url: "/sessions/s1/prompt-runtime",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
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
        },
        warnings: ["compat warning"],
      },
    });

    expect(controlService.getResolvedState).toHaveBeenCalledWith("s1", DEFAULT_ADMIN_ACCOUNT_ID);
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
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        persistent_policy: {
          structure: { mode: "strict_alternating", preserve_system_messages: true },
          delivery: { require_last_user: true },
        },
        resolved_policy: {
          structure: { mode: "strict_alternating", merge_adjacent_same_role: true, preserve_system_messages: true },
          delivery: { allow_assistant_prefill: true, require_last_user: true, no_assistant: false },
          debug: { include_prompt_snapshot: false, include_runtime_trace: false, include_worldbook_matches: false },
        },
        warnings: [],
      },
    });
    expect(controlService.updatePolicy).toHaveBeenCalledWith("s1", DEFAULT_ADMIN_ACCOUNT_ID, {
      structure: { mode: "strict_alternating", preserveSystemMessages: true },
      delivery: { requireLastUser: true },
    });
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
          debug: { include_prompt_snapshot: false, include_runtime_trace: false, include_worldbook_matches: false },
        },
        warnings: [],
      },
    });
    expect(controlService.updatePolicy).toHaveBeenCalledWith("s1", DEFAULT_ADMIN_ACCOUNT_ID, {
      structure: null,
      delivery: null,
    });
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

  it("maps GET /prompt-runtime/capabilities response to snake_case", async () => {
    const controlService = createPromptRuntimeControlService({
      getCapabilities: vi.fn(() => ({
        structure: {
          modes: ["default", "strict_alternating", "no_assistant"],
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
          modes: ["default", "strict_alternating", "no_assistant"],
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
