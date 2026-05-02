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

const defaultResolvedVisibility = {
  mode: "allow_all_except_hidden",
} as const;

const defaultVisibilitySourceMap = {
  mode: "system_default",
} as const;

const promptRuntimeLimitations = [
  "Memory is branch-aware. Current limitations center on page-local proposal / promotion coverage for older committed floors and legacy fallback rows.",
  "Variable commit remains page -> floor. Branch promotion is not automatic.",
] as const;

const previewMemoryTracePayload = {
  summary_injected: true,
  runtime_mode: "async_primary",
  requested_write: false,
  effective_write: false,
  strategy: "single_summary",
  summary_text: "[Memory]\n- The party recently agreed to search the northern pass.",
  summary_text_hash: "sha256:6bf5658e833e81fb6fe5061ab9197d2e9c2e0e2c76a9e813d08f74de33e5bea5",
  selected_items: [
    { memory_id: "memory-branch-summary-2", scope: "branch", scope_id: "memscope:session-1:main", branch_id: "main", kind: "macro_summary", source: "summary", score: 0.71, token_count: 22 },
  ],
  token_stats: { budget: 500, used: 22, micro_summary: 0, macro_summary: 22, direct_items: 0 },
  scope_resolution: { mode: "branch_aware", requested_scopes: ["global", "branch"], resolved_scopes: ["global", "branch"], requested_branch_id: "alt-preview", resolved_branch_id: "main", fallback_reason: null },
} as const;

const previewMemoryTrace = {
  summaryInjected: true,
  runtimeMode: "async_primary",
  requestedWrite: false,
  effectiveWrite: false,
  strategy: "single_summary",
  summaryText: "[Memory]\n- The party recently agreed to search the northern pass.",
  summaryTextHash: "sha256:6bf5658e833e81fb6fe5061ab9197d2e9c2e0e2c76a9e813d08f74de33e5bea5",
  selectedItems: [{ memoryId: "memory-branch-summary-2", scope: "branch", scopeId: "memscope:session-1:main", branchId: "main", kind: "macro_summary", source: "summary", score: 0.71, tokenCount: 22 }],
  tokenStats: { budget: 500, used: 22, microSummary: 0, macroSummary: 22, directItems: 0 },
  scopeResolution: { mode: "branch_aware", requestedScopes: ["global", "branch"], resolvedScopes: ["global", "branch"], requestedBranchId: "alt-preview", resolvedBranchId: "main", fallbackReason: null },
} as const;

const committedMemoryTracePayload = {
  summary_injected: true,
  runtime_mode: "async_primary",
  requested_write: true,
  effective_write: true,
  strategy: "dual_summary",
  summary_text_hash: "sha256:8b210f3247804d17f0e22171db253f411f4ca9bb9da6c69b75837b086d11c2fa",
  selected_items: [{ memory_id: "memory-branch-fact-1", scope: "branch", scope_id: "memscope:session-1:main", branch_id: "main", kind: "fact" }],
  token_stats: { budget: 500, used: 64, micro_summary: 14, macro_summary: 0, direct_items: 50 },
  scope_resolution: { mode: "branch_aware", requested_scopes: ["global", "branch"], resolved_scopes: ["global", "branch"], requested_branch_id: "main", resolved_branch_id: "main", fallback_reason: null },
  page_id: "page-output-12",
  proposal_batch_id: "memory-proposal:page-output-12",
  proposal_status: "promoted",
  promotion_status: "promoted",
} as const;

const committedMemoryTrace = {
  summaryInjected: true,
  runtimeMode: "async_primary",
  requestedWrite: true,
  effectiveWrite: true,
  strategy: "dual_summary",
  summaryTextHash: "sha256:8b210f3247804d17f0e22171db253f411f4ca9bb9da6c69b75837b086d11c2fa",
  selectedItems: [{ memoryId: "memory-branch-fact-1", scope: "branch", scopeId: "memscope:session-1:main", branchId: "main", kind: "fact" }],
  tokenStats: { budget: 500, used: 64, microSummary: 14, macroSummary: 0, directItems: 50 },
  scopeResolution: { mode: "branch_aware", requestedScopes: ["global", "branch"], resolvedScopes: ["global", "branch"], requestedBranchId: "main", resolvedBranchId: "main", fallbackReason: null },
  pageId: "page-output-12",
  proposalBatchId: "memory-proposal:page-output-12",
  proposalStatus: "promoted",
  promotionStatus: "promoted",
} as const;

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
              visibility: { mode: "allow_all_except_hidden" },
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
              visibility: { mode: "system_default" },
              history: {
                source_branch_id: "alt-branch",
                source_mode: "existing_branch",
              },
            },
            diagnostics: [{ code: "derived_no_assistant_structure", message: "derived", severity: "warning" }],
            limitations: [...promptRuntimeLimitations],
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
              visibility: { mode: "allow_all_except_hidden" },
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
                returns_assembly_truth: false,
                returns_runtime_trace: true,
                supports_visibility: true,
                single_text_only: true,
                llm_call: false,
                creates_floor: false,
                writes_prompt_snapshot: false,
                commits_side_effects: false,
                trace_subset: ["macro", "source_selection", "visibility", "history_normalization"],
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
        visibility: defaultResolvedVisibility,
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
        visibility: defaultVisibilitySourceMap,
        history: {
          sourceBranchId: "alt-branch",
          sourceMode: "existing_branch",
        },
      },
      diagnostics: [{ code: "derived_no_assistant_structure", message: "derived", severity: "warning" }],
      limitations: [...promptRuntimeLimitations],
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
        visibility: defaultResolvedVisibility,
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
          returnsAssemblyTruth: false,
          returnsRuntimeTrace: true,
          supportsVisibility: true,
          singleTextOnly: true,
          llmCall: false,
          createsFloor: false,
          writesPromptSnapshot: false,
          commitsSideEffects: false,
          traceSubset: ["macro", "source_selection", "visibility", "history_normalization"],
        },
        explain: {
          enabled: true,
          legacyFloorFallback: true,
          returnsGovernance: true,
          readOnly: true,
          requiresCommittedFloor: true,
          persistedTruthOnly: true,
          recompute: false,
          snapshotAvailabilityField: "snapshot_available",
          snapshotSupported: true,
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
          snapshot_available: true,
          assets: {
            preset: { id: "preset-1", name: "Story Preset" },
            character_card: { id: "char-1", name: "Hero" },
            worldbook: null,
            regex_profile: null,
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
            character_id: "char-1",
            character_version_id: "charver-1",
            character_imported_format: "tavern_card_v2",
            character_content_hash: "char-hash-1",
            worldbook_activated_entry_uids: [7],
            worldbook_activated_entries: [
              {
                uid: 7,
                activation_key: "worldbook:worldbook-1:5:entry:7",
                source: {
                  kind: "session_worldbook",
                  worldbook_id: null,
                  worldbook_name: "Historical Worldbook",
                  asset_scope_id: "worldbook:worldbook-1:5",
                },
                insertion: { position: "before" },
              },
            ],
            regex_pre_rule_names: ["Input Rule"],
            regex_post_rule_names: [],
            prompt_mode: "compat_strict",
            asset_manifest_digest: null,
            prompt_digest: "digest-1",
            token_estimate: 42,
          },
          resolved_policy: null,
          memory: committedMemoryTracePayload,
          governance: {
            entries: [
              {
                source_kind: "history",
                declared_level: "budget_prunable",
                registered: true,
                effective_retention: "budget_prunable",
                pinned: false,
                prunable: true,
                budget_groups: ["history"],
                section_names: ["chatHistory"],
                token_count: 320,
                retained_token_count: 256,
                pruned_token_count: 64,
              },
            ],
            mismatches: [],
            limitations: ["captured at commit time"],
          },
          source_map: {
            history: {
              source_branch_id: "main",
              source_mode: "existing_branch",
            },
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
      snapshotAvailable: true,
      assets: { preset: { id: "preset-1", name: "Story Preset" }, characterCard: { id: "char-1", name: "Hero" }, worldbook: null, regexProfile: null },
      memory: committedMemoryTrace,
      promptSnapshot: { presetId: "preset-1", presetUpdatedAt: 1710000000000, presetVersion: 3, worldbookId: null, worldbookUpdatedAt: null, worldbookVersion: null, regexProfileId: null, regexProfileUpdatedAt: null, regexProfileVersion: null, characterId: "char-1", characterVersionId: "charver-1", characterImportedFormat: "tavern_card_v2", characterContentHash: "char-hash-1", worldbookActivatedEntryUids: [7], worldbookActivatedEntries: [{ uid: 7, activationKey: "worldbook:worldbook-1:5:entry:7", source: { kind: "session_worldbook", worldbookId: null, worldbookName: "Historical Worldbook", assetScopeId: "worldbook:worldbook-1:5" }, insertion: { position: "before" } }], regexPreRuleNames: ["Input Rule"], regexPostRuleNames: [], promptMode: "compat_strict", assetManifestDigest: null, promptDigest: "digest-1", tokenEstimate: 42 },
      resolvedPolicy: null,
      governance: {
        entries: [
          {
            sourceKind: "history",
            declaredLevel: "budget_prunable",
            registered: true,
            effectiveRetention: "budget_prunable",
            pinned: false,
            prunable: true,
            budgetGroups: ["history"],
            sectionNames: ["chatHistory"],
            tokenCount: 320,
            retainedTokenCount: 256,
            prunedTokenCount: 64,
          },
        ],
        mismatches: [],
        limitations: ["captured at commit time"],
      },
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
      result: { outputPageId: "page-output-12", assistantMessageId: "msg-assistant-12", generatedText: "hello", summaries: ["summary"], usage: { promptTokens: 320, completionTokens: 128, totalTokens: 448 }, verifier: null, committedAt: 1710000004000 },
    });

    expect(String(fetchImpl.mock.calls[0]![0])).toBe("http://localhost:3000/floors/floor-12/prompt-runtime/explain");
  });

  it("maps committed prompt runtime compare payload", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
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
          governance_changes: [{
            path: "governance.entries[0].effective_retention",
            change_type: "changed",
            left: "budget_prunable",
            right: "fixed",
          }],
          limitations: ["Right floor 'floor-right' has no committed prompt runtime snapshot. Compare skipped recomputation and returned limitations only."],
        },
      }),
    );

    const transport = createTransportClient({ baseUrl, fetchImpl });
    const promptRuntime = createPromptRuntimeResource(transport);

    await expect(promptRuntime.compare({ accountId: "acc-1", sessionId: "session-1", leftFloorId: "floor-left", rightFloorId: "floor-right" })).resolves.toEqual({
      left: { floorId: "floor-left", snapshotAvailable: true },
      right: { floorId: "floor-right", snapshotAvailable: false },
      scopeChanges: [],
      policyChanges: [{ path: "policy.resolved_policy.delivery.no_assistant", changeType: "changed", left: false, right: true }],
      assetChanges: [],
      diagnosticsChanges: [],
      trimChanges: [{
        path: "trim_reasons",
        changeType: "changed",
        left: [{ group: "section:main", reason: "group_limit_exceeded", pruned_token_count: 32 }],
        right: [{ group: "section:main", reason: "group_limit_exceeded", pruned_token_count: 64 }],
      }],
      exclusionChanges: [{
        path: "excluded_sources",
        changeType: "changed",
        left: [{ source: "history", reason: "visibility_filtered" }],
        right: [{ source: "examples", reason: "disabled_by_policy" }],
      }],
      governanceChanges: [{
        path: "governance.entries[0].effective_retention",
        changeType: "changed",
        left: "budget_prunable",
        right: "fixed",
      }],
      limitations: ["Right floor 'floor-right' has no committed prompt runtime snapshot. Compare skipped recomputation and returned limitations only."],
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("http://localhost:3000/sessions/session-1/prompt-runtime/compare");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      left: { floor_id: "floor-left" },
      right: { floor_id: "floor-right" },
    });
  });

  it("maps inspect requests and inspect responses", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          scope: {
            session_id: "session 1",
            target_branch_id: "alt-inspect",
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
            visibility: { mode: "allow_all_except_hidden", hidden_floor_ranges: [{ start_floor_no: 1, end_floor_no: 2 }] },
            debug: { include_prompt_snapshot: false, include_runtime_trace: true, include_worldbook_matches: true },
          },
          source_map: {
            delivery: { no_assistant: "request_override" },
            history: { source_branch_id: "fork-branch", source_mode: "source_floor_branch" },
          },
          diagnostics: [
            { code: "unmaterialized_branch_inspect", message: "branch pending", severity: "info", source: "branch", phase: "assemble" },
          ],
          trim_reasons: [
            { group: "history", reason: "group_limit_exceeded", pruned_token_count: 32 },
          ],
          excluded_sources: [
            { source: "history", reason: "visibility_filtered", detail: "Visibility filtered 2 floor(s) from the available history window." },
          ],
          section_stats: [
            { section_name: "history", token_count: 256 },
          ],
          limitations: ["inspect is read-only"],
          prepared_turn: {
            messages: [
              { role: "system", content: "System prompt" },
              { role: "user", content: "Hello there" },
            ],
            token_estimate: 320,
            available_for_reply: 704,
            preprocessed_user_message: "Hello there",
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
              character_id: "char-1",
              character_version_id: "charver-1",
              character_imported_format: "tavern_card_v2",
              character_content_hash: "char-hash-1",
              worldbook_activated_entry_uids: [7],
              worldbook_activated_entries: [
                {
                  uid: 7,
                  activation_key: "worldbook:worldbook-1:5:entry:7",
                  source: {
                    kind: "session_worldbook",
                    worldbook_id: null,
                    worldbook_name: "Inspect Worldbook",
                    asset_scope_id: "worldbook:worldbook-1:5",
                  },
                  insertion: { position: "before" },
                },
              ],
              regex_pre_rule_names: ["Input Rule"],
              regex_post_rule_names: [],
              prompt_mode: "native",
              asset_manifest_digest: null,
              prompt_digest: "digest-inspect",
              token_estimate: 320,
            },
            runtime_trace: {
              memory: committedMemoryTracePayload,
              budgets: {
                by_group: [
                  { group: "history", token_count: 256 },
                ],
              },
            },
            memory: committedMemoryTracePayload,
            memory_summary: "Remember the promise.",
            generation_params: {
              max_output_tokens: 256,
              temperature: 0.7,
              reasoning_effort: "medium",
            },
            requested_turn_config: {
              enable_tools: true,
              tool_mode: "both",
            },
            turn_config: {
              enable_tools: true,
              tool_mode: "both",
            },
            session_state_writes: {
              total: 1,
              writes: [
                { namespace: "quest_flags", slot: "companion", operation: "set" },
              ],
            },
          },
          governance: {
            entries: [
              {
                source_kind: "memory",
                declared_level: "soft_required",
                registered: true,
                effective_retention: "soft_required",
                pinned: false,
                prunable: false,
                budget_groups: ["memory"],
                section_names: ["memory"],
                token_count: 64,
                retained_token_count: 64,
                pruned_token_count: 0,
              },
            ],
            mismatches: [],
            limitations: [],
          },
        },
      }),
    );

    const transport = createTransportClient({ baseUrl, fetchImpl });
    const promptRuntime = createPromptRuntimeResource(transport);

    await expect(
      promptRuntime.inspect({
        accountId: "acc-1",
        sessionId: "session 1",
        message: "Hello there",
        branchId: "alt-1",
        sourceFloorId: "floor-1",
        promptIntent: "continue",
        config: { enableTools: true, toolMode: "both" },
        generationParams: { maxOutputTokens: 256, temperature: 0.7, reasoningEffort: "medium" },
        sessionStateWrites: [{ namespace: "quest_flags", slot: "companion", value: { mood: "ally" } }],
        debugOptions: { includeRuntimeTrace: true, includeWorldbookMatches: true },
        visibility: { mode: "allow_all_except_hidden", hiddenFloorRanges: [{ startFloorNo: 1, endFloorNo: 2 }] },
        delivery: { noAssistant: true },
        budget: { maxInputTokens: 4096, reservedCompletionTokens: 1024 },
        sourceSelection: { history: { mode: "windowed", maxMessages: 24 }, memory: { enabled: true }, worldbook: { enabled: true }, examples: { enabled: false } },
      }),
    ).resolves.toMatchObject({
      scope: { sessionId: "session 1", targetBranchId: "alt-inspect", branchExists: false, sourceFloorId: "floor-1", historySourceBranchId: "fork-branch", historySourceMode: "source_floor_branch" },
      sourceMap: { delivery: { noAssistant: "request_override" }, history: { sourceBranchId: "fork-branch", sourceMode: "source_floor_branch" } },
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
        promptSnapshot: { characterId: "char-1", characterVersionId: "charver-1", characterImportedFormat: "tavern_card_v2", characterContentHash: "char-hash-1", worldbookActivatedEntries: [{ uid: 7, activationKey: "worldbook:worldbook-1:5:entry:7", source: { kind: "session_worldbook", worldbookId: null, worldbookName: "Inspect Worldbook", assetScopeId: "worldbook:worldbook-1:5" }, insertion: { position: "before" } }] },
        runtimeTrace: { budgets: { byGroup: [{ group: "history", tokenCount: 256 }] }, memory: committedMemoryTrace },
        memory: committedMemoryTrace,
        memorySummary: "Remember the promise.",
        generationParams: { maxOutputTokens: 256, temperature: 0.7, reasoningEffort: "medium" },
        requestedTurnConfig: { enableTools: true, toolMode: "both" },
        turnConfig: { enableTools: true, toolMode: "both" },
        sessionStateWrites: { total: 1, writes: [{ namespace: "quest_flags", slot: "companion", operation: "set" }] },
      },
      governance: {
        entries: [{ sourceKind: "memory", declaredLevel: "soft_required", registered: true, effectiveRetention: "soft_required", pinned: false, prunable: false, budgetGroups: ["memory"], sectionNames: ["memory"], tokenCount: 64, retainedTokenCount: 64, prunedTokenCount: 0 }],
        mismatches: [],
        limitations: [],
      },
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("http://localhost:3000/sessions/session%201/prompt-runtime/inspect");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      message: "Hello there",
      branch_id: "alt-1",
      source_floor_id: "floor-1",
      prompt_intent: "continue",
      config: { enable_tools: true, tool_mode: "both" },
      generation_params: { max_output_tokens: 256, temperature: 0.7, reasoning_effort: "medium" },
      session_state_writes: [{ namespace: "quest_flags", slot: "companion", value: { mood: "ally" } }],
      debug_options: { include_runtime_trace: true, include_worldbook_matches: true },
      visibility: { mode: "allow_all_except_hidden", hidden_floor_ranges: [{ start_floor_no: 1, end_floor_no: 2 }] },
      delivery: { no_assistant: true },
      budget: { max_input_tokens: 4096, reserved_completion_tokens: 1024 },
      source_selection: { history: { mode: "windowed", max_messages: 24 }, memory: { enabled: true }, worldbook: { enabled: true }, examples: { enabled: false } },
    });
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
            visibility: { mode: "allow_all_except_hidden" },
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
        visibility: {
          mode: "allow_all_except_hidden",
          hiddenFloorRanges: [{ startFloorNo: 1, endFloorNo: 2 }],
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
        visibility: defaultResolvedVisibility,
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
      visibility: {
        mode: "allow_all_except_hidden",
        hidden_floor_ranges: [{ start_floor_no: 1, end_floor_no: 2 }],
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
            visibility: { mode: "allow_all_except_hidden" },
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
            visibility: {
              mode: "deny_all_except_visible",
              visible_floor_ranges: [{ start_floor_no: 3, end_floor_no: 4 }],
            },
            debug: { include_prompt_snapshot: false, include_runtime_trace: false, include_worldbook_matches: false },
          },
          warnings: [],
        },
      }));

    const transport = createTransportClient({ baseUrl, fetchImpl });
    const promptRuntime = createPromptRuntimeResource(transport);

    await expect(promptRuntime.getBranchPolicy({ accountId: "acc-1", sessionId: "session 1", branchId: "alt-branch" })).resolves.toEqual({
      persistentPolicy: { delivery: { noAssistant: true } },
      resolvedPolicy: { structure: { mode: "no_assistant", mergeAdjacentSameRole: false, preserveSystemMessages: true, assistantRewriteStrategy: "to_system" }, delivery: { allowAssistantPrefill: true, requireLastUser: false, noAssistant: true }, budget: {}, sourceSelection: { history: { mode: "full" }, memory: { enabled: true }, worldbook: { enabled: true }, examples: { enabled: true } }, visibility: defaultResolvedVisibility, debug: { includePromptSnapshot: false, includeRuntimeTrace: false, includeWorldbookMatches: false } },
      warnings: ["derived"],
    });

    await expect(promptRuntime.patchBranchPolicy({ accountId: "acc-1", sessionId: "session 1", branchId: "alt-branch", structure: { mode: "strict_alternating" }, visibility: { mode: "deny_all_except_visible", visibleFloorRanges: [{ startFloorNo: 3, endFloorNo: 4 }] }, delivery: null })).resolves.toEqual({
      persistentPolicy: { structure: { mode: "strict_alternating" } },
      resolvedPolicy: { structure: { mode: "strict_alternating", mergeAdjacentSameRole: true, preserveSystemMessages: true }, delivery: { allowAssistantPrefill: true, requireLastUser: false, noAssistant: false }, budget: {}, sourceSelection: { history: { mode: "full" }, memory: { enabled: true }, worldbook: { enabled: true }, examples: { enabled: true } }, visibility: { mode: "deny_all_except_visible", visibleFloorRanges: [{ startFloorNo: 3, endFloorNo: 4 }] }, debug: { includePromptSnapshot: false, includeRuntimeTrace: false, includeWorldbookMatches: false } },
      warnings: [],
    });

    expect(String(fetchImpl.mock.calls[0]![0])).toBe("http://localhost:3000/sessions/session%201/prompt-runtime/branches/alt-branch/policy");
    expect(String(fetchImpl.mock.calls[1]![0])).toBe("http://localhost:3000/sessions/session%201/prompt-runtime/branches/alt-branch/policy");
    expect(JSON.parse(String(fetchImpl.mock.calls[1]![1]?.body))).toEqual({ structure: { mode: "strict_alternating" }, visibility: { mode: "deny_all_except_visible", visible_floor_ranges: [{ start_floor_no: 3, end_floor_no: 4 }] }, delivery: null });
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
          diagnostics: [
            { code: "unmaterialized_branch_preview", message: "branch pending", severity: "info", source: "branch", phase: "preview" },
          ],
          limitations: [...promptRuntimeLimitations],
          memory: previewMemoryTracePayload,
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
        visibility: { mode: "allow_all_except_hidden", hiddenFloorRanges: [{ startFloorNo: 1, endFloorNo: 2 }] },
        debug: { includePromptSnapshot: false, includeRuntimeTrace: false, includeWorldbookMatches: false },
      },
      sourceMap: { delivery: { noAssistant: "request_override" }, budget: { maxInputTokens: "request_override", reservedCompletionTokens: "request_override" }, sourceSelection: { history: { mode: "request_override", maxMessages: "request_override" }, memory: { enabled: "system_default" }, worldbook: { enabled: "system_default" }, examples: { enabled: "request_override" } }, visibility: { mode: "request_override", hiddenFloorRanges: "request_override" }, history: { sourceBranchId: "fork-branch", sourceMode: "source_floor_branch" } },
      diagnostics: [{ code: "unmaterialized_branch_preview", message: "branch pending", severity: "info", source: "branch", phase: "preview" }],
      limitations: [...promptRuntimeLimitations],
      memory: previewMemoryTrace,
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

  it("ignores unsupported preview runtime trace fields and accepts an empty filtered preview trace", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          scope: {
            session_id: "session-1",
            target_branch_id: "main",
            branch_exists: true,
            source_floor_id: null,
            history_source_branch_id: "main",
            history_source_mode: "existing_branch",
          },
          policy: {
            structure: { mode: "default", merge_adjacent_same_role: false, preserve_system_messages: true },
            delivery: { allow_assistant_prefill: true, require_last_user: false, no_assistant: false },
            budget: {},
            source_selection: { history: { mode: "full" }, memory: { enabled: true }, worldbook: { enabled: true }, examples: { enabled: true } },
            visibility: { mode: "allow_all_except_hidden" },
            debug: { include_prompt_snapshot: false, include_runtime_trace: false, include_worldbook_matches: false },
          },
          text: "Preview plain text",
          runtime_trace: {
            structure: {
              mode: "flattened",
              merge_adjacent_same_role: false,
              assistant_rewrite_count: 0,
              tail_assistant_detected: false,
            },
            delivery: {
              assistant_prefill_requested: false,
              assistant_prefill_applied: false,
              allow_assistant_prefill: true,
              require_last_user: false,
              no_assistant: false,
              last_message_role: null,
              ends_with_user: false,
              degraded: false,
              degrade_reasons: [],
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
        sessionId: "session-1",
        text: "plain text",
      }),
    ).resolves.toMatchObject({
      scope: {
        sessionId: "session-1",
        targetBranchId: "main",
        branchExists: true,
        sourceFloorId: null,
        historySourceBranchId: "main",
        historySourceMode: "existing_branch",
      },
      policy: {
        structure: { mode: "default", mergeAdjacentSameRole: false, preserveSystemMessages: true },
        delivery: { allowAssistantPrefill: true, requireLastUser: false, noAssistant: false },
      },
      text: "Preview plain text",
      runtimeTrace: {},
    });
  });
});
