import { describe, expect, it, vi } from "vitest";

import { createTransportClient } from "../client/transport.js";
import { createPromptRuntimeResource } from "../resources/prompt-runtime.js";

const baseUrl = "http://localhost:3000";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("sdk prompt runtime resource", () => {
  it("maps session prompt runtime state, policy, assets, and capabilities", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            scope: {
              session_id: "session 1",
              target_branch_id: "alt-branch",
              branch_exists: true,
              source_floor_id: null,
              history_source_branch_id: "alt-branch",
              history_source_mode: "existing_branch",
            },
            policy: {
              structure: {
                mode: "strict_alternating",
                merge_adjacent_same_role: true,
                preserve_system_messages: true,
                assistant_rewrite_strategy: "to_system",
              },
              delivery: {
                allow_assistant_prefill: true,
                require_last_user: false,
                no_assistant: false,
              },
              budget: {},
              source_selection: { history: { mode: "full" }, memory: { enabled: true }, worldbook: { enabled: true }, examples: { enabled: true } },
              debug: {
                include_prompt_snapshot: false,
                include_runtime_trace: false,
                include_worldbook_matches: false,
              },
            },
            persistent_policy: {
              structure: {
                mode: "strict_alternating",
                preserve_system_messages: true,
              },
              delivery: {
                require_last_user: true,
              },
            },
            branch_persistent_policy: null,
            assets: {
              preset: {
                id: "preset-1",
                name: "Story Preset",
              },
              character_card: {
                id: "char-1",
                name: "Hero",
              },
              worldbook: null,
              regex_profile: {
                id: "regex-1",
                name: "Safe Regex",
              },
            },
            warnings: [
              "Session metadata contains an invalid prompt_runtime.policy object. The control plane ignored it.",
            ],
            source_map: {
              structure: {
                mode: "session_policy",
                merge_adjacent_same_role: "session_policy",
                preserve_system_messages: "session_policy",
              },
              delivery: {
                allow_assistant_prefill: "system_default",
                require_last_user: "session_policy",
                no_assistant: "system_default",
              },
              source_selection: { history: { mode: "system_default" }, memory: { enabled: "system_default" }, worldbook: { enabled: "system_default" }, examples: { enabled: "system_default" } },
              history: {
                source_branch_id: "alt-branch",
                source_mode: "existing_branch",
              },
            },
            diagnostics: [{ code: "derived_no_assistant_structure", message: "derived", severity: "warning" }],
            limitations: ["memory remains shared"],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
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
                merge_adjacent_same_role: false,
                preserve_system_messages: true,
              },
              delivery: {
                allow_assistant_prefill: true,
                require_last_user: true,
                no_assistant: false,
              },
              budget: {},
              source_selection: { history: { mode: "full" }, memory: { enabled: true }, worldbook: { enabled: true }, examples: { enabled: true } },
              debug: {
                include_prompt_snapshot: false,
                include_runtime_trace: false,
                include_worldbook_matches: false,
              },
            },
            warnings: [],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            preset: {
              id: "preset-1",
              name: "Story Preset",
            },
            character_card: {
              id: "char-1",
              name: "Hero",
            },
            worldbook: null,
            regex_profile: {
              id: "regex-1",
              name: "Safe Regex",
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
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
            budget: {
              defaults: {},
              request_override_supported: true,
              persistent_patch_supported: false,
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
              persistent_patch_supported: false,
              supported_sources: ["history", "memory", "worldbook", "examples"],
              history_modes: ["full", "windowed"],
              exclusion_reason_codes: ["disabled_by_policy", "budget_trimmed", "provider_constraint", "visibility_filtered", "not_triggered"],
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
              preview: {
                enabled: true,
                returns_runtime_trace: true,
                supports_visibility: true,
                single_text_only: true,
                llm_call: false,
                creates_floor: false,
                writes_prompt_snapshot: false,
                commits_side_effects: false,
              },
              explain: {
                enabled: true,
                read_only: true,
                requires_committed_floor: true,
                persisted_truth_only: true,
                recompute: false,
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
            unsupported: [
              "/sessions/:id/prompt-runtime/run",
              "/sessions/:id/prompt-runtime/macros",
            ],
          },
        }),
      );

    const transport = createTransportClient({ baseUrl, fetchImpl });
    const promptRuntime = createPromptRuntimeResource(transport);

    await expect(
      promptRuntime.getSession({
        accountId: "acc-1",
        sessionId: "session 1",
        branchId: "alt-branch",
      }),
    ).resolves.toEqual({
      scope: {
        sessionId: "session 1",
        targetBranchId: "alt-branch",
        branchExists: true,
        sourceFloorId: null,
        historySourceBranchId: "alt-branch",
        historySourceMode: "existing_branch",
      },
      policy: {
        structure: {
          mode: "strict_alternating",
          mergeAdjacentSameRole: true,
          preserveSystemMessages: true,
          assistantRewriteStrategy: "to_system",
        },
        delivery: {
          allowAssistantPrefill: true,
          requireLastUser: false,
          noAssistant: false,
        },
        budget: {},
        sourceSelection: { history: { mode: "full" }, memory: { enabled: true }, worldbook: { enabled: true }, examples: { enabled: true } },
        debug: {
          includePromptSnapshot: false,
          includeRuntimeTrace: false,
          includeWorldbookMatches: false,
        },
      },
      branchPersistentPolicy: null,
      persistentPolicy: {
        structure: {
          mode: "strict_alternating",
          preserveSystemMessages: true,
        },
        delivery: {
          requireLastUser: true,
        },
      },
      assets: {
        preset: {
          id: "preset-1",
          name: "Story Preset",
        },
        characterCard: {
          id: "char-1",
          name: "Hero",
        },
        worldbook: null,
        regexProfile: {
          id: "regex-1",
          name: "Safe Regex",
        },
      },
      warnings: [
        "Session metadata contains an invalid prompt_runtime.policy object. The control plane ignored it.",
      ],
      sourceMap: {
        structure: {
          mode: "session_policy",
          mergeAdjacentSameRole: "session_policy",
          preserveSystemMessages: "session_policy",
        },
        delivery: {
          allowAssistantPrefill: "system_default",
          requireLastUser: "session_policy",
          noAssistant: "system_default",
        },
        sourceSelection: { history: { mode: "system_default" }, memory: { enabled: "system_default" }, worldbook: { enabled: "system_default" }, examples: { enabled: "system_default" } },
        history: {
          sourceBranchId: "alt-branch",
          sourceMode: "existing_branch",
        },
      },
      diagnostics: [{ code: "derived_no_assistant_structure", message: "derived", severity: "warning" }],
      limitations: ["memory remains shared"],
    });

    await expect(
      promptRuntime.getPolicy({
        accountId: "acc-1",
        sessionId: "session 1",
      }),
    ).resolves.toEqual({
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
          mergeAdjacentSameRole: false,
          preserveSystemMessages: true,
        },
        delivery: {
          allowAssistantPrefill: true,
          requireLastUser: true,
          noAssistant: false,
        },
        budget: {},
        sourceSelection: { history: { mode: "full" }, memory: { enabled: true }, worldbook: { enabled: true }, examples: { enabled: true } },
        debug: {
          includePromptSnapshot: false,
          includeRuntimeTrace: false,
          includeWorldbookMatches: false,
        },
      },
      warnings: [],
    });

    await expect(
      promptRuntime.getAssets({
        accountId: "acc-1",
        sessionId: "session 1",
      }),
    ).resolves.toEqual({
      preset: {
        id: "preset-1",
        name: "Story Preset",
      },
      characterCard: {
        id: "char-1",
        name: "Hero",
      },
      worldbook: null,
      regexProfile: {
        id: "regex-1",
        name: "Safe Regex",
      },
    });

    await expect(promptRuntime.getCapabilities({ accountId: "acc-1" })).resolves.toEqual({
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
      budget: {
        defaults: {},
        requestOverrideSupported: true,
        persistentPatchSupported: false,
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
        persistentPatchSupported: false,
        supportedSources: ["history", "memory", "worldbook", "examples"],
        historyModes: ["full", "windowed"],
        exclusionReasonCodes: ["disabled_by_policy", "budget_trimmed", "provider_constraint", "visibility_filtered", "not_triggered"],
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
        preview: {
          enabled: true,
          returnsRuntimeTrace: true,
          supportsVisibility: true,
          singleTextOnly: true,
          llmCall: false,
          createsFloor: false,
          writesPromptSnapshot: false,
          commitsSideEffects: false,
        },
        explain: {
          enabled: true,
          readOnly: true,
          requiresCommittedFloor: true,
          persistedTruthOnly: true,
          recompute: false,
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
      unsupported: [
        "/sessions/:id/prompt-runtime/run",
        "/sessions/:id/prompt-runtime/macros",
      ],
    });

    expect(String(fetchImpl.mock.calls[0]![0])).toBe("http://localhost:3000/sessions/session%201/prompt-runtime?branch_id=alt-branch");
    expect(String(fetchImpl.mock.calls[1]![0])).toBe("http://localhost:3000/sessions/session%201/prompt-runtime/policy");
    expect(String(fetchImpl.mock.calls[2]![0])).toBe("http://localhost:3000/sessions/session%201/prompt-runtime/assets");
    expect(String(fetchImpl.mock.calls[3]![0])).toBe("http://localhost:3000/prompt-runtime/capabilities");

    const sessionHeaders = fetchImpl.mock.calls[0]![1]?.headers as Headers;
    const capabilitiesHeaders = fetchImpl.mock.calls[3]![1]?.headers as Headers;
    expect(sessionHeaders.get("x-account-id")).toBe("acc-1");
    expect(capabilitiesHeaders.get("x-account-id")).toBe("acc-1");
  });

  it("maps floor historical explain payload", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          floor: {
            id: "floor-12",
            session_id: "session-1",
            floor_no: 12,
            branch_id: "main",
            parent_floor_id: "floor-11",
            state: "committed",
            prompt_snapshot_created_at: 1710000003000,
            committed_at: 1710000004000,
          },
          scope: {
            session_id: "session-1",
            target_branch_id: "main",
            branch_exists: true,
            source_floor_id: null,
            history_source_branch_id: "main",
            history_source_mode: "existing_branch",
          },
          prompt_snapshot: {
            preset_id: "preset-1",
            preset_updated_at: 1710000000000,
            preset_version: 3,
            worldbook_id: null,
            worldbook_updated_at: null,
            worldbook_version: null,
            regex_profile_id: null,
            regex_profile_updated_at: null,
            regex_profile_version: null,
            worldbook_activated_entry_uids: [7],
            regex_pre_rule_names: ["Input Rule"],
            regex_post_rule_names: [],
            prompt_mode: "compat_strict",
            prompt_digest: "digest-1",
            token_estimate: 42,
          },
          resolved_policy: null,
          source_map: {
            history: {
              source_branch_id: "main",
              source_mode: "existing_branch",
            },
          },
          trim_reasons: null,
          excluded_sources: null,
          diagnostics: [
            { code: "historical_resolved_policy_unavailable", message: "policy unavailable", severity: "info", source: "policy", field_path: "resolved_policy", phase: "explain" },
          ],
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
      }),
    );

    const transport = createTransportClient({ baseUrl, fetchImpl });
    const promptRuntime = createPromptRuntimeResource(transport);

    await expect(promptRuntime.getFloorExplain({ accountId: "acc-1", floorId: "floor-12" })).resolves.toEqual({
      floor: { id: "floor-12", sessionId: "session-1", floorNo: 12, branchId: "main", parentFloorId: "floor-11", state: "committed", promptSnapshotCreatedAt: 1710000003000, committedAt: 1710000004000 },
      scope: { sessionId: "session-1", targetBranchId: "main", branchExists: true, sourceFloorId: null, historySourceBranchId: "main", historySourceMode: "existing_branch" },
      promptSnapshot: { presetId: "preset-1", presetUpdatedAt: 1710000000000, presetVersion: 3, worldbookId: null, worldbookUpdatedAt: null, worldbookVersion: null, regexProfileId: null, regexProfileUpdatedAt: null, regexProfileVersion: null, worldbookActivatedEntryUids: [7], regexPreRuleNames: ["Input Rule"], regexPostRuleNames: [], promptMode: "compat_strict", promptDigest: "digest-1", tokenEstimate: 42 },
      resolvedPolicy: null,
      sourceMap: { history: { sourceBranchId: "main", sourceMode: "existing_branch" } },
      trimReasons: null,
      excludedSources: null,
      diagnostics: [{ code: "historical_resolved_policy_unavailable", message: "policy unavailable", severity: "info", source: "policy", fieldPath: "resolved_policy", phase: "explain" }],
      limitations: ["persisted only"],
      result: { outputPageId: "page-output-12", assistantMessageId: "msg-assistant-12", generatedText: "hello", summaries: ["summary"], usage: { promptTokens: 320, completionTokens: 128, totalTokens: 448 }, verifier: null, committedAt: 1710000004000 },
    });

    expect(String(fetchImpl.mock.calls[0]![0])).toBe("http://localhost:3000/floors/floor-12/prompt-runtime/explain");
  });

  it("maps patch policy requests, preserves null clears, and normalizes the response", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          persistent_policy: {
            structure: {
              mode: "strict_alternating",
              preserve_system_messages: true,
            },
          },
          resolved_policy: {
            structure: {
              mode: "strict_alternating",
              merge_adjacent_same_role: false,
              preserve_system_messages: true,
            },
            delivery: {
              allow_assistant_prefill: true,
              require_last_user: false,
              no_assistant: false,
            },
            budget: {},
            source_selection: { history: { mode: "full" }, memory: { enabled: true }, worldbook: { enabled: true }, examples: { enabled: true } },
            debug: {
              include_prompt_snapshot: false,
              include_runtime_trace: false,
              include_worldbook_matches: false,
            },
          },
          warnings: [],
        },
      }),
    );

    const transport = createTransportClient({ baseUrl, fetchImpl });
    const promptRuntime = createPromptRuntimeResource(transport);

    await expect(
      promptRuntime.patchPolicy({
        accountId: "acc-1",
        sessionId: "session 1",
        structure: {
          mode: "strict_alternating",
          preserveSystemMessages: true,
        },
        delivery: null,
      }),
    ).resolves.toEqual({
      persistentPolicy: {
        structure: {
          mode: "strict_alternating",
          preserveSystemMessages: true,
        },
      },
      resolvedPolicy: {
        structure: {
          mode: "strict_alternating",
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
        debug: {
          includePromptSnapshot: false,
          includeRuntimeTrace: false,
          includeWorldbookMatches: false,
        },
      },
      warnings: [],
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("http://localhost:3000/sessions/session%201/prompt-runtime/policy");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({
      structure: {
        mode: "strict_alternating",
        preserve_system_messages: true,
      },
      delivery: null,
    });
  });

  it("maps branch policy requests and branch policy responses", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          persistent_policy: {
            delivery: { no_assistant: true },
          },
          resolved_policy: {
            structure: { mode: "no_assistant", merge_adjacent_same_role: false, preserve_system_messages: true, assistant_rewrite_strategy: "to_system" },
            delivery: { allow_assistant_prefill: true, require_last_user: false, no_assistant: true },
            budget: {},
            source_selection: { history: { mode: "full" }, memory: { enabled: true }, worldbook: { enabled: true }, examples: { enabled: true } },
            debug: { include_prompt_snapshot: false, include_runtime_trace: false, include_worldbook_matches: false },
          },
          warnings: ["derived"],
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          persistent_policy: {
            structure: { mode: "strict_alternating" },
          },
          resolved_policy: {
            structure: { mode: "strict_alternating", merge_adjacent_same_role: true, preserve_system_messages: true },
            delivery: { allow_assistant_prefill: true, require_last_user: false, no_assistant: false },
            budget: {},
            source_selection: { history: { mode: "full" }, memory: { enabled: true }, worldbook: { enabled: true }, examples: { enabled: true } },
            debug: { include_prompt_snapshot: false, include_runtime_trace: false, include_worldbook_matches: false },
          },
          warnings: [],
        },
      }));

    const transport = createTransportClient({ baseUrl, fetchImpl });
    const promptRuntime = createPromptRuntimeResource(transport);

    await expect(promptRuntime.getBranchPolicy({ accountId: "acc-1", sessionId: "session 1", branchId: "alt-branch" })).resolves.toEqual({
      persistentPolicy: { delivery: { noAssistant: true } },
      resolvedPolicy: { structure: { mode: "no_assistant", mergeAdjacentSameRole: false, preserveSystemMessages: true, assistantRewriteStrategy: "to_system" }, delivery: { allowAssistantPrefill: true, requireLastUser: false, noAssistant: true }, budget: {}, sourceSelection: { history: { mode: "full" }, memory: { enabled: true }, worldbook: { enabled: true }, examples: { enabled: true } }, debug: { includePromptSnapshot: false, includeRuntimeTrace: false, includeWorldbookMatches: false } },
      warnings: ["derived"],
    });

    await expect(promptRuntime.patchBranchPolicy({ accountId: "acc-1", sessionId: "session 1", branchId: "alt-branch", structure: { mode: "strict_alternating" }, delivery: null })).resolves.toEqual({
      persistentPolicy: { structure: { mode: "strict_alternating" } },
      resolvedPolicy: { structure: { mode: "strict_alternating", mergeAdjacentSameRole: true, preserveSystemMessages: true }, delivery: { allowAssistantPrefill: true, requireLastUser: false, noAssistant: false }, budget: {}, sourceSelection: { history: { mode: "full" }, memory: { enabled: true }, worldbook: { enabled: true }, examples: { enabled: true } }, debug: { includePromptSnapshot: false, includeRuntimeTrace: false, includeWorldbookMatches: false } },
      warnings: [],
    });

    expect(String(fetchImpl.mock.calls[0]![0])).toBe("http://localhost:3000/sessions/session%201/prompt-runtime/branches/alt-branch/policy");
    expect(String(fetchImpl.mock.calls[1]![0])).toBe("http://localhost:3000/sessions/session%201/prompt-runtime/branches/alt-branch/policy");
    expect(JSON.parse(String(fetchImpl.mock.calls[1]![1]?.body))).toEqual({ structure: { mode: "strict_alternating" }, delivery: null });
  });

  it("maps preview requests and preview responses", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          scope: {
            session_id: "session 1",
            target_branch_id: "alt-preview",
            branch_exists: false,
            source_floor_id: "floor-1",
            history_source_branch_id: "fork-branch",
            history_source_mode: "source_floor_branch",
          },
          policy: {
            structure: { mode: "no_assistant", merge_adjacent_same_role: false, preserve_system_messages: true, assistant_rewrite_strategy: "to_system" },
            delivery: { allow_assistant_prefill: true, require_last_user: false, no_assistant: true },
            budget: { max_input_tokens: 4096, reserved_completion_tokens: 1024 },
            source_selection: { history: { mode: "windowed", max_messages: 24 }, memory: { enabled: true }, worldbook: { enabled: true }, examples: { enabled: false } },
            debug: { include_prompt_snapshot: false, include_runtime_trace: false, include_worldbook_matches: false },
          },
          source_map: {
            delivery: { no_assistant: "request_override" },
            budget: { max_input_tokens: "request_override", reserved_completion_tokens: "request_override" },
            source_selection: { history: { mode: "request_override", max_messages: "request_override" }, memory: { enabled: "system_default" }, worldbook: { enabled: "system_default" }, examples: { enabled: "request_override" } },
            history: { source_branch_id: "fork-branch", source_mode: "source_floor_branch" },
          },
          diagnostics: [
            { code: "unmaterialized_branch_preview", message: "branch pending", severity: "info", source: "branch", phase: "preview" },
          ],
          limitations: ["memory remains shared"],
          text: '{"金币":3}/霜刃',
          runtime_trace: {
            macro: {
              warnings: [
                {
                  code: "macro_preview_side_effect_suppressed",
                  message: "Macro setvar side effect was previewed but not committed.",
                  macro_name: "setvar",
                },
              ],
              used_names: ["setvar", "getvar"],
              mutation_preview: [
                {
                  kind: "set",
                  scope: "branch",
                  key: "资产",
                  value: '{"金币":3}',
                },
              ],
              staged_mutations: [],
              traces: [
                {
                  macro_name: "setvar",
                  raw_text: "{{setvar::资产.金币::3}}",
                  resolved_text: "",
                  phase: "preview",
                  source_kind: "macro",
                },
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
      }),
    );

    const transport = createTransportClient({ baseUrl, fetchImpl });
    const promptRuntime = createPromptRuntimeResource(transport);

    await expect(
      promptRuntime.previewText({
        accountId: "acc-1",
        sessionId: "session 1",
        branchId: "alt-1",
        budget: { maxInputTokens: 4096, reservedCompletionTokens: 1024 },
        sourceSelection: { history: { mode: "windowed", maxMessages: 24 }, memory: { enabled: true }, worldbook: { enabled: true }, examples: { enabled: false } },
        sourceFloorId: "floor-1",
        delivery: { noAssistant: true },
        text: '{{setvar::资产.金币::3}}{{getvar::资产}}/{{getvar::装备["剑.名"]}}',
        visibility: {
          hiddenFloorIds: ["floor-hidden"],
          hiddenFloorRanges: [{ startFloorNo: 1, endFloorNo: 2 }],
          mode: "allow_all_except_hidden",
          visibleFloorRanges: [{ startFloorNo: 3, endFloorNo: 4 }],
        },
      }),
    ).resolves.toEqual({
      scope: {
        sessionId: "session 1",
        targetBranchId: "alt-preview",
        branchExists: false,
        sourceFloorId: "floor-1",
        historySourceBranchId: "fork-branch",
        historySourceMode: "source_floor_branch",
      },
      policy: {
        structure: { mode: "no_assistant", mergeAdjacentSameRole: false, preserveSystemMessages: true, assistantRewriteStrategy: "to_system" },
        delivery: { allowAssistantPrefill: true, requireLastUser: false, noAssistant: true },
        budget: { maxInputTokens: 4096, reservedCompletionTokens: 1024 },
        sourceSelection: { history: { mode: "windowed", maxMessages: 24 }, memory: { enabled: true }, worldbook: { enabled: true }, examples: { enabled: false } },
        debug: { includePromptSnapshot: false, includeRuntimeTrace: false, includeWorldbookMatches: false },
      },
      sourceMap: { delivery: { noAssistant: "request_override" }, budget: { maxInputTokens: "request_override", reservedCompletionTokens: "request_override" }, sourceSelection: { history: { mode: "request_override", maxMessages: "request_override" }, memory: { enabled: "system_default" }, worldbook: { enabled: "system_default" }, examples: { enabled: "request_override" } }, history: { sourceBranchId: "fork-branch", sourceMode: "source_floor_branch" } },
      diagnostics: [{ code: "unmaterialized_branch_preview", message: "branch pending", severity: "info", source: "branch", phase: "preview" }],
      limitations: ["memory remains shared"],
      text: '{"金币":3}/霜刃',
      runtimeTrace: {
        macro: {
          warnings: [
            {
              code: "macro_preview_side_effect_suppressed",
              message: "Macro setvar side effect was previewed but not committed.",
              macroName: "setvar",
            },
          ],
          usedNames: ["setvar", "getvar"],
          mutationPreview: [
            {
              kind: "set",
              scope: "branch",
              key: "资产",
              value: '{"金币":3}',
            },
          ],
          stagedMutations: [],
          traces: [
            {
              macroName: "setvar",
              rawText: "{{setvar::资产.金币::3}}",
              resolvedText: "",
              phase: "preview",
              sourceKind: "macro",
            },
          ],
        },
        visibility: {
          hiddenFloorRanges: [{ startFloorNo: 1, endFloorNo: 2 }],
          filteredFloorNos: [1, 2],
        },
        sourceSelection: {
          excludedSources: [
            {
              source: "history",
              reason: "visibility_filtered",
              detail: "Visibility filtered 2 floor(s) from the available history window.",
            },
          ],
        },
      },
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("http://localhost:3000/sessions/session%201/prompt-runtime/preview");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      text: '{{setvar::资产.金币::3}}{{getvar::资产}}/{{getvar::装备["剑.名"]}}',
      branch_id: "alt-1",
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
      source_floor_id: "floor-1",
      visibility: {
        hidden_floor_ids: ["floor-hidden"],
        hidden_floor_ranges: [{ start_floor_no: 1, end_floor_no: 2 }],
        mode: "allow_all_except_hidden",
        visible_floor_ranges: [{ start_floor_no: 3, end_floor_no: 4 }],
      },
    });
  });
});
