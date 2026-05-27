import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../accounts/constants.js";
import { createDatabase } from "../../db/client.js";
import { registerPromptRuntimeRoutes } from "../prompt-runtime.js";
import { PromptRuntimeControlService } from "../../services/prompt-runtime/control-service.js";
import type { PromptRuntimePreviewResult } from "../../services/chat/contracts.js";
import type { PromptRuntimeInspectResult } from "../../services/prompt-runtime/types.js";

const apps: FastifyInstance[] = [];

describe("prompt-runtime preview and inspect routes", () => {
  afterEach(async () => {
    while (apps.length > 0) {
      const app = apps.pop();
      if (app) {
        await app.close();
      }
    }
  });

  it("returns structured memory_injection and memory on preview", async () => {
    const previewResult = createPreviewResult();
    const built = await buildPromptRuntimeRouteApp({ previewResult });

    const response = await built.app.inject({
      method: "POST",
      url: "/sessions/session-1/prompt-runtime/preview",
      payload: {
        text: "{{getvar::资产.金币}}",
        branch_id: "alt-branch",
        source_floor_id: "floor-source",
        source_selection: {
          history: { mode: "windowed", max_messages: 24 },
          memory: { enabled: true },
          worldbook: { enabled: true },
          examples: { enabled: false },
        },
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(built.previewPromptRuntimeText).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({
        text: "{{getvar::资产.金币}}",
        branchId: "alt-branch",
        sourceFloorId: "floor-source",
        sourceSelection: {
          history: { mode: "windowed", maxMessages: 24 },
          memory: { enabled: true },
          worldbook: { enabled: true },
          examples: { enabled: false },
        },
      }),
      DEFAULT_ADMIN_ACCOUNT_ID,
    );

    expect(response.json()).toMatchObject({
      data: {
        scope: {
          session_id: "session-1",
          target_branch_id: "alt-branch",
          branch_exists: true,
          source_floor_id: "floor-source",
          history_source_branch_id: "alt-branch",
          history_source_mode: "existing_branch",
        },
        memory_injection: {
          items: [
            {
              id: "memory-branch-fact-1",
              scope: "branch",
              scope_id: "memscope:session-1:main",
              type: "fact",
              summary_tier: null,
              content: "Bob still holds the vault key.",
              fact_key: "vault_key_owner",
              importance: 0.82,
              confidence: 1,
              source_floor_id: null,
              source_message_id: null,
              status: "active",
              token_count_estimate: 18,
            },
          ],
          formatted_text: "[Memory]\n- Bob still holds the vault key.",
          token_count: 64,
          scope_resolution: {
            mode: "visible_refs",
            strict: false,
            scope_refs: [
              { scope: "global", scopeId: "default-admin" },
              { scope: "branch", scopeId: "memscope:session-1:main" },
            ],
          },
        },
        memory: {
          summary_injected: true,
          runtime_mode: "async_primary",
          requested_write: false,
          effective_write: false,
          strategy: "dual_summary",
          summary_text: "[Memory]\n- Bob still holds the vault key.",
          summary_text_hash: "sha256:preview-memory-trace",
          selected_items: [
            {
              memory_id: "memory-branch-fact-1",
              scope: "branch",
              scope_id: "memscope:session-1:main",
              branch_id: "main",
              kind: "fact",
              source: "store",
              score: 0.82,
              token_count: 18,
              selected_reason: null,
            },
          ],
          token_stats: {
            budget: 500,
            used: 64,
            micro_summary: 14,
            macro_summary: 0,
            direct_items: 50,
          },
          scope_resolution: {
            mode: "branch_aware",
            requested_scopes: ["global", "branch"],
            resolved_scopes: ["global", "branch"],
            requested_branch_id: "main",
            resolved_branch_id: "main",
            fallback_reason: null,
          },
        },
      },
    });
  });

  it("returns prepared_turn memory_injection, memory, and memory_summary on inspect", async () => {
    const inspectResult = createInspectResult();
    const built = await buildPromptRuntimeRouteApp({ inspectResult });

    const response = await built.app.inject({
      method: "POST",
      url: "/sessions/session-1/prompt-runtime/inspect",
      payload: {
        message: "Please continue the campfire scene.",
        branch_id: "alt-branch",
        source_floor_id: "floor-source",
        session_state_writes: [
          {
            namespace: "quest_flags",
            slot: "companion",
            value: { mood: "ally" },
          },
          {
            namespace: "quest_flags",
            slot: "expired_hint",
            delete: true,
          },
        ],
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(built.inspectPromptRuntime).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({
        message: "Please continue the campfire scene.",
        branchId: "alt-branch",
        sourceFloorId: "floor-source",
        sessionStateWrites: [
          {
            namespace: "quest_flags",
            slot: "companion",
            value: { mood: "ally" },
          },
          {
            namespace: "quest_flags",
            slot: "expired_hint",
            delete: true,
          },
        ],
      }),
      DEFAULT_ADMIN_ACCOUNT_ID,
    );

    expect(response.json()).toMatchObject({
      data: {
        scope: {
          session_id: "session-1",
          target_branch_id: "alt-branch",
          branch_exists: true,
          source_floor_id: "floor-source",
          history_source_branch_id: "alt-branch",
          history_source_mode: "existing_branch",
        },
        prepared_turn: {
          prompt_snapshot: null,
          runtime_trace: null,
          memory_injection: {
            items: [
              {
                id: "memory-branch-fact-1",
                scope: "branch",
                scope_id: "memscope:session-1:main",
                type: "fact",
                content: "Bob still holds the vault key.",
              },
            ],
            scope_resolution: {
              mode: "visible_refs",
              strict: false,
              scope_refs: [
                { scope: "global", scopeId: "default-admin" },
                { scope: "branch", scopeId: "memscope:session-1:main" },
              ],
            },
          },
          memory_summary: "The party recently agreed to search the northern pass.",
          memory: {
            summary_injected: true,
            runtime_mode: "async_primary",
            requested_write: false,
            effective_write: false,
            strategy: "dual_summary",
          },
          generation_params: {
            temperature: 0.7,
            max_output_tokens: 256,
          },
          requested_turn_config: {
            enable_tools: false,
            enable_director: false,
            enable_verifier: false,
          },
          turn_config: {
            enable_tools: false,
            enable_director: false,
            enable_verifier: false,
          },
          session_state_writes: {
            total: 1,
            writes: [
              {
                namespace: "quest_flags",
                slot: "companion",
                operation: "set",
              },
            ],
          },
          prepare_phase_trace: [
            {
              phase: "source_resolve",
              detail: {
                selected_memory_count: 1,
                memory_summary_injected: true,
              },
            },
          ],
        },
      },
    });
  });
});

async function buildPromptRuntimeRouteApp(input: {
  previewResult?: PromptRuntimePreviewResult;
  inspectResult?: PromptRuntimeInspectResult;
}): Promise<{
  app: FastifyInstance;
  previewPromptRuntimeText: ReturnType<typeof vi.fn>;
  inspectPromptRuntime: ReturnType<typeof vi.fn>;
}> {
  const connection = createDatabase(":memory:");
  const app = Fastify({ logger: false });

  app.addHook("onRequest", async (request) => {
    request.authContext = {
      kind: "authenticated",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      role: "admin",
      status: "active",
      actorType: "account",
      actorId: DEFAULT_ADMIN_ACCOUNT_ID,
      actorAccountId: DEFAULT_ADMIN_ACCOUNT_ID,
      actorClientId: null,
      authMethod: "dev",
    };
  });
  app.addHook("onClose", async () => {
    connection.close();
  });

  const previewPromptRuntimeText = vi.fn(async () => input.previewResult ?? createPreviewResult());
  const inspectPromptRuntime = vi.fn(async () => input.inspectResult ?? createInspectResult());

  await registerPromptRuntimeRoutes(
    app,
    new PromptRuntimeControlService(connection.db),
    {
      previewService: { previewPromptRuntimeText },
      inspectService: { inspectPromptRuntime },
    },
  );

  await app.ready();
  apps.push(app);

  return {
    app,
    previewPromptRuntimeText,
    inspectPromptRuntime,
  };
}

function createScope() {
  return {
    sessionId: "session-1",
    targetBranchId: "alt-branch",
    branchExists: true,
    sourceFloorId: "floor-source",
    historySourceBranchId: "alt-branch",
    historySourceMode: "existing_branch" as const,
  };
}

function createResolvedPolicy() {
  return {
    structure: {
      mode: "no_assistant" as const,
      mergeAdjacentSameRole: true,
      preserveSystemMessages: true,
      assistantRewriteStrategy: "to_system" as const,
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
    budget: {
      maxInputTokens: 4096,
      reservedCompletionTokens: 1024,
    },
    sourceSelection: {
      history: { mode: "windowed" as const, maxMessages: 24 },
      memory: { enabled: true },
      worldbook: { enabled: true },
      examples: { enabled: false },
    },
    visibility: {
      mode: "allow_all_except_hidden" as const,
      hiddenFloorRanges: [{ startFloorNo: 1, endFloorNo: 2 }],
    },
  };
}

function createSourceMap() {
  return {
    structure: {
      mode: "request_override" as const,
      mergeAdjacentSameRole: "request_override" as const,
      preserveSystemMessages: "system_default" as const,
      assistantRewriteStrategy: "system_default" as const,
    },
    delivery: {
      allowAssistantPrefill: "system_default" as const,
      requireLastUser: "session_policy" as const,
      noAssistant: "request_override" as const,
    },
    budget: {
      maxInputTokens: "request_override" as const,
      reservedCompletionTokens: "request_override" as const,
    },
    sourceSelection: {
      history: {
        mode: "request_override" as const,
        maxMessages: "request_override" as const,
      },
      memory: { enabled: "system_default" as const },
      worldbook: { enabled: "system_default" as const },
      examples: { enabled: "request_override" as const },
    },
    visibility: {
      mode: "request_override" as const,
      hiddenFloorRanges: "request_override" as const,
    },
    history: {
      sourceBranchId: "alt-branch",
      sourceMode: "existing_branch" as const,
    },
  };
}

function createHistoryNormalization() {
  return {
    rawEntryCount: 4,
    effectiveTurnCount: 2,
    selectedTurnCount: 2,
    trailingUserSourceFloorIds: ["floor-1", "floor-2"],
    mergedUserGroups: [
      {
        effectiveRole: "user" as const,
        sourceFloorIds: ["floor-1", "floor-2"],
        sourceMessageIds: ["msg-1", "msg-2"],
        includesCurrentInput: true,
      },
    ],
    violations: [],
  };
}

function createMemoryInjection() {
  return {
    items: [
      {
        id: "memory-branch-fact-1",
        scope: "branch" as const,
        scopeId: "memscope:session-1:main",
        type: "fact" as const,
        content: "Bob still holds the vault key.",
        factKey: "vault_key_owner",
        importance: 0.82,
        confidence: 1,
        status: "active" as const,
        tokenCountEstimate: 18,
        createdAt: 1710000000100,
        updatedAt: 1710000000200,
      },
    ],
    formattedText: "[Memory]\n- Bob still holds the vault key.",
    tokenCount: 64,
    scopeResolution: {
      mode: "visible_refs" as const,
      strict: false,
      scopeRefs: [
        { scope: "global" as const, scopeId: "default-admin" },
        { scope: "branch" as const, scopeId: "memscope:session-1:main" },
      ],
    },
  };
}

function createMemoryTrace() {
  return {
    summaryInjected: true,
    runtimeMode: "async_primary" as const,
    requestedWrite: false,
    effectiveWrite: false,
    strategy: "dual_summary" as const,
    summaryText: "[Memory]\n- Bob still holds the vault key.",
    summaryTextHash: "sha256:preview-memory-trace",
    selectedItems: [
      {
        memoryId: "memory-branch-fact-1",
        scope: "branch" as const,
        scopeId: "memscope:session-1:main",
        branchId: "main",
        kind: "fact" as const,
        source: "store" as const,
        score: 0.82,
        tokenCount: 18,
        selectedReason: null,
      },
    ],
    tokenStats: {
      budget: 500,
      used: 64,
      microSummary: 14,
      macroSummary: 0,
      directItems: 50,
    },
    scopeResolution: {
      mode: "branch_aware" as const,
      requestedScopes: ["global", "branch"],
      resolvedScopes: ["global", "branch"],
      requestedBranchId: "main",
      resolvedBranchId: "main",
      fallbackReason: null,
    },
  };
}

function createPreviewResult(): PromptRuntimePreviewResult {
  return {
    scope: createScope(),
    policy: createResolvedPolicy(),
    sourceMap: createSourceMap(),
    diagnostics: [
      {
        code: "derived_no_assistant_structure",
        message: "Delivery policy implied a no-assistant prompt structure.",
        severity: "warning",
        source: "policy",
        fieldPath: "policy.structure.mode",
      },
    ],
    limitations: ["preview_limit"],
    text: '{"资产":3}',
    memoryInjection: createMemoryInjection(),
    memory: createMemoryTrace(),
    runtimeTrace: {
      macro: {
        warnings: [],
        usedNames: ["getvar"],
        mutationPreview: [],
        stagedMutations: [],
        traces: [
          {
            macroName: "getvar",
            rawText: "{{getvar::资产.金币}}",
            resolvedText: "3",
            phase: "dry_run",
            sourceKind: "macro",
          },
        ],
      },
      historyNormalization: createHistoryNormalization(),
      visibility: {
        hiddenFloorRanges: [{ startFloorNo: 1, endFloorNo: 2 }],
        filteredFloorNos: [2],
      },
      sourceSelection: {
        excludedSources: [
          {
            source: "examples",
            reason: "disabled_by_policy",
            detail: "examples disabled",
          },
        ],
      },
    },
  } as PromptRuntimePreviewResult;
}

function createInspectResult(): PromptRuntimeInspectResult {
  return {
    scope: createScope(),
    mode: {
      promptMode: "native",
      sessionPromptMode: "native",
      effectivePromptMode: "native",
      defaultPromptMode: "compat_strict",
      legacyFallback: false,
      source: "session",
    },
    policy: createResolvedPolicy(),
    sourceMap: createSourceMap(),
    diagnostics: [
      {
        code: "derived_no_assistant_structure",
        message: "Delivery policy implied a no-assistant prompt structure.",
        severity: "warning",
        source: "policy",
        fieldPath: "policy.structure.mode",
      },
    ],
    trimReasons: [
      {
        group: "history",
        reason: "group_limit_exceeded",
        detail: "Prompt runtime pruned 64 tokens from budget group 'history'.",
        prunedTokenCount: 64,
      },
    ],
    historyNormalization: createHistoryNormalization(),
    excludedSources: [
      {
        source: "examples",
        reason: "disabled_by_policy",
        detail: "examples disabled",
      },
    ],
    sectionStats: [
      {
        sectionName: "history",
        tokenCount: 320,
      },
    ],
    limitations: ["inspect_limit"],
    preparedTurn: {
      messages: [
        { role: "system", content: "Stay in character and keep the tone warm." },
        { role: "user", content: "Please continue the campfire scene." },
      ],
      tokenEstimate: 512,
      availableForReply: 1536,
      preprocessedUserMessage: "Please continue the campfire scene.",
      memoryInjection: createMemoryInjection(),
      memory: createMemoryTrace(),
      memorySummary: "The party recently agreed to search the northern pass.",
      generationParams: {
        temperature: 0.7,
        maxOutputTokens: 256,
      },
      requestedTurnConfig: {
        enableTools: false,
        enableDirector: false,
        enableVerifier: false,
      },
      turnConfig: {
        enableTools: false,
        enableDirector: false,
        enableVerifier: false,
      },
      sessionStateWrites: {
        total: 1,
        writes: [
          {
            namespace: "quest_flags",
            slot: "companion",
            operation: "set",
          },
        ],
      },
      contributors: [
        {
          id: "builtin:memory_projection",
          kind: "memory_projection",
          sourceKind: "memory",
          modeScope: "native",
          promptRenderable: {
            title: "Memory summary",
            content: "The party recently agreed to search the northern pass.",
          },
          deterministic: true,
          cacheScope: "floor",
        },
      ],
      preparePhaseTrace: [
        {
          phase: "source_resolve",
          detail: {
            selectedMemoryCount: 1,
            memorySummaryInjected: true,
          },
        },
      ],
    },
    governance: {
      entries: [],
      mismatches: [],
      limitations: [],
    },
  } as PromptRuntimeInspectResult;
}
