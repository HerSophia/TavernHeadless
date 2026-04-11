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
            },
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
      }),
    ).resolves.toEqual({
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
        debug: {
          includePromptSnapshot: false,
          includeRuntimeTrace: false,
          includeWorldbookMatches: false,
        },
      },
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
      },
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

    expect(String(fetchImpl.mock.calls[0]![0])).toBe("http://localhost:3000/sessions/session%201/prompt-runtime");
    expect(String(fetchImpl.mock.calls[1]![0])).toBe("http://localhost:3000/sessions/session%201/prompt-runtime/policy");
    expect(String(fetchImpl.mock.calls[2]![0])).toBe("http://localhost:3000/sessions/session%201/prompt-runtime/assets");
    expect(String(fetchImpl.mock.calls[3]![0])).toBe("http://localhost:3000/prompt-runtime/capabilities");

    const sessionHeaders = fetchImpl.mock.calls[0]![1]?.headers as Headers;
    const capabilitiesHeaders = fetchImpl.mock.calls[3]![1]?.headers as Headers;
    expect(sessionHeaders.get("x-account-id")).toBe("acc-1");
    expect(capabilitiesHeaders.get("x-account-id")).toBe("acc-1");
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

  it("maps preview requests and preview responses", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
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
        sourceFloorId: "floor-1",
        text: '{{setvar::资产.金币::3}}{{getvar::资产}}/{{getvar::装备["剑.名"]}}',
        visibility: {
          hiddenFloorIds: ["floor-hidden"],
          hiddenFloorRanges: [{ startFloorNo: 1, endFloorNo: 2 }],
          mode: "allow_all_except_hidden",
          visibleFloorRanges: [{ startFloorNo: 3, endFloorNo: 4 }],
        },
      }),
    ).resolves.toEqual({
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
      },
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("http://localhost:3000/sessions/session%201/prompt-runtime/preview");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      text: '{{setvar::资产.金币::3}}{{getvar::资产}}/{{getvar::装备["剑.名"]}}',
      branch_id: "alt-1",
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
