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
                preserve_system_messages: "session_policy",
              },
              delivery: {
                require_last_user: "session_policy",
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
          preserveSystemMessages: "session_policy",
        },
        delivery: {
          requireLastUser: "session_policy",
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
});
