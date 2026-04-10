import { describe, expect, it, vi } from "vitest";

import { createTavernClient, TavernApiError } from "../index.js";

const baseUrl = "http://localhost:3000";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("sdk sessions expanded resource", () => {
  it("reads session detail with full binding and config fields", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          character_binding: {
            character_id: "char-1",
            character_version_id: "charver-2",
            snapshot_summary: {
              has_greeting: true,
              name: "Hero",
            },
            sync_policy: "pin",
          },
          created_at: 10,
          id: "session-1",
          metadata: { source: "import" },
          model_name: "gpt-4o",
          model_params: { temperature: 0.7 },
          model_provider: "openai",
          preset_id: "preset-1",
          prompt_mode: "native",
          regex_profile_id: "regex-1",
          status: "active",
          title: "Session A",
          updated_at: 11,
          user_binding: {
            snapshot_summary: {
              name: "Alice",
            },
            user_id: "user-1",
          },
          worldbook_profile_id: "wb-1",
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.sessions.getDetail({ accountId: "acc-1", sessionId: "session-1" })).resolves.toEqual({
      characterBinding: {
        characterId: "char-1",
        characterVersionId: "charver-2",
        snapshotSummary: {
          hasGreeting: true,
          name: "Hero",
        },
        syncPolicy: "pin",
      },
      createdAt: 10,
      id: "session-1",
      metadata: { source: "import" },
      modelName: "gpt-4o",
      modelParams: { temperature: 0.7 },
      modelProvider: "openai",
      presetId: "preset-1",
      promptMode: "native",
      regexProfileId: "regex-1",
      status: "active",
      title: "Session A",
      updatedAt: 11,
      userBinding: {
        snapshotSummary: {
          name: "Alice",
        },
        userId: "user-1",
      },
      worldbookProfileId: "wb-1",
    });
  });

  it("reads session active run summary", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          session_id: "session-1",
          active_run: {
            branch_id: "main",
            latest_floor_id: "floor-9",
            active_run_id: "run-9",
            active_run_type: "retry_turn",
            busy: true,
            public_phase: "post_processing",
            updated_at: 200,
          },
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.sessions.getActiveRun({ accountId: "acc-1", sessionId: "session-1" })).resolves.toEqual({
      sessionId: "session-1",
      activeRun: {
        activeRunId: "run-9",
        activeRunType: "retry_turn",
        branchId: "main",
        busy: true,
        latestFloorId: "floor-9",
        publicPhase: "post_processing",
        updatedAt: 200,
      },
    });
  });

  it("supports dry-run request options and maps the returned payload", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          assembly: {
            memory_summary_injected: true,
            mode: "preset",
            prompt_intent: "continue",
            assistant_prefill_applied: true,
            assistant_prefill_strategy: "assistant_message_fallback",
            selected_prompt_order_character_id: 100000,
            ignored_prompt_order_character_ids: [200001],
            preprocessed_user_message: "Hello there",
            preset_used: true,
            regex_post_rules: ["post-rule"],
            regex_pre_rules: ["pre-rule"],
            worldbook_hits: 1,
            reserved_variable_collisions: ["char", "user"],
            unsupported_preset_fields: [],
            ignored_preset_fields: ["top_level.openai_model"],
            unresolved_preset_markers: ["customMarker"],
            preset_warnings: [
              "检测到 2 条 prompt_order 上下文轨道；当前运行时只会使用 character_id=100000 的 active 轨道。",
            ],
            continue_nudge_applied: true,
            continue_nudge_text: "[Continue]",
            names_behavior_applied: "always",
            trigger_filtered_entry_ids: ["quietPrompt"],
            in_chat_inserted_entry_ids: ["continueHint"],
            worldbook_matches: [
              {
                uid: 7,
                comment: "Campfire Lore",
                content_preview: "The northern pass is watched by old sentries.",
                order: 100,
                source: {
                  kind: "session_worldbook",
                  worldbook_id: "worldbook-1",
                  worldbook_name: "Campfire Worldbook",
                },
                insertion: {
                  position: "before",
                },
                activation: {
                  mode: "triggered",
                  recursion_level: 0,
                  first_match: {
                    source_kind: "message",
                    message_index_from_latest: 0,
                    matched_key: "campfire",
                    matched_key_scope: "primary",
                    matched_key_type: "plain",
                    char_start: 20,
                    char_end: 28,
                    excerpt: "Please continue the campfire scene.",
                  },
                },
              },
            ],
          },
          available_for_reply: 512,
          memory_summary: "memo",
          messages: [{ role: "system", content: "prompt" }],
          prompt_snapshot: {
            preset_id: "preset-1",
            preset_updated_at: 1710000000000,
            preset_version: 3,
            worldbook_id: "worldbook-1",
            worldbook_updated_at: 1710000001000,
            worldbook_version: 5,
            regex_profile_id: "regex-1",
            regex_profile_updated_at: 1710000002000,
            regex_profile_version: 2,
            worldbook_activated_entry_uids: [7],
            regex_pre_rule_names: ["pre-rule"],
            regex_post_rule_names: ["post-rule"],
            prompt_mode: "native",
            prompt_digest: "digest-1",
            token_estimate: 42,
          },
          token_estimate: 42,
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(
      client.sessions.respondDryRun({
        accountId: "acc-1",
        debugOptions: {
          includeWorldbookMatches: true,
        },
        message: "hello",
        promptIntent: "continue",
        sessionId: "session-1",
      }),
    ).resolves.toEqual({
      assembly: {
        memorySummaryInjected: true,
        mode: "preset",
        promptIntent: "continue",
        assistantPrefillApplied: true,
        assistantPrefillStrategy: "assistant_message_fallback",
        preprocessedUserMessage: "Hello there",
        presetUsed: true,
        selectedPromptOrderCharacterId: 100000,
        ignoredPromptOrderCharacterIds: [200001],
        unsupportedPresetFields: [],
        ignoredPresetFields: ["top_level.openai_model"],
        unresolvedPresetMarkers: ["customMarker"],
        presetWarnings: ["检测到 2 条 prompt_order 上下文轨道；当前运行时只会使用 character_id=100000 的 active 轨道。"],
        continueNudgeApplied: true,
        continueNudgeText: "[Continue]",
        namesBehaviorApplied: "always",
        triggerFilteredEntryIds: ["quietPrompt"],
        inChatInsertedEntryIds: ["continueHint"],
        regexPostRules: ["post-rule"],
        regexPreRules: ["pre-rule"],
        reservedVariableCollisions: ["char", "user"],
        worldbookHits: 1,
        worldbookMatches: [
          {
            uid: 7,
            comment: "Campfire Lore",
            contentPreview: "The northern pass is watched by old sentries.",
            order: 100,
            source: {
              kind: "session_worldbook",
              worldbookId: "worldbook-1",
              worldbookName: "Campfire Worldbook",
            },
            insertion: {
              position: "before",
            },
            activation: {
              mode: "triggered",
              recursionLevel: 0,
              firstMatch: {
                sourceKind: "message",
                messageIndexFromLatest: 0,
                matchedKey: "campfire",
                matchedKeyScope: "primary",
                matchedKeyType: "plain",
                charStart: 20,
                charEnd: 28,
                excerpt: "Please continue the campfire scene.",
              },
            },
          },
        ],
      },
      availableForReply: 512,
      memorySummary: "memo",
      messages: [{ role: "system", content: "prompt" }],
      promptSnapshot: {
        presetId: "preset-1",
        presetUpdatedAt: 1710000000000,
        presetVersion: 3,
        worldbookId: "worldbook-1",
        worldbookUpdatedAt: 1710000001000,
        worldbookVersion: 5,
        regexProfileId: "regex-1",
        regexProfileUpdatedAt: 1710000002000,
        regexProfileVersion: 2,
        worldbookActivatedEntryUids: [7],
        regexPreRuleNames: ["pre-rule"],
        regexPostRuleNames: ["post-rule"],
        promptMode: "native",
        promptDigest: "digest-1",
        tokenEstimate: 42,
      },
      tokenEstimate: 42,
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("http://localhost:3000/sessions/session-1/respond/dry-run");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({
      debug_options: {
        include_worldbook_matches: true,
      },
      message: "hello",
      prompt_intent: "continue",
    }));
  });

  it("syncs character bindings and posts only defined fields", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          character_binding: {
            character_id: "char-1",
            character_version_id: "charver-3",
            snapshot_summary: {
              has_greeting: false,
              name: "Hero",
            },
            sync_policy: "force",
          },
          created_at: 1,
          id: "session-1",
          metadata: null,
          model_name: null,
          model_params: null,
          model_provider: null,
          preset_id: null,
          prompt_mode: null,
          regex_profile_id: null,
          status: "active",
          title: "Session A",
          updated_at: 2,
          user_binding: null,
          worldbook_profile_id: null,
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(
      client.sessions.syncCharacter({
        accountId: "acc-1",
        force: true,
        sessionId: "session-1",
      }),
    ).resolves.toEqual({
      characterBinding: {
        characterId: "char-1",
        characterVersionId: "charver-3",
        snapshotSummary: {
          hasGreeting: false,
          name: "Hero",
        },
        syncPolicy: "force",
      },
      createdAt: 1,
      id: "session-1",
      metadata: null,
      modelName: null,
      modelParams: null,
      modelProvider: null,
      presetId: null,
      promptMode: null,
      regexProfileId: null,
      status: "active",
      title: "Session A",
      updatedAt: 2,
      userBinding: null,
      worldbookProfileId: null,
    });

    const [, init] = fetchImpl.mock.calls[0]!;
    expect(init?.body).toBe(JSON.stringify({ force: true }));
  });

  it("lists branches with query defaults and maps branch summaries", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [
          null,
          {
            branch_id: "main",
            floor_count: 3,
            latest_floor_id: "floor-3",
            latest_floor_no: 2,
            latest_state: "committed",
            updated_at: 100,
          },
        ],
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.sessions.listBranches({ sessionId: "session-1" })).resolves.toEqual([
      {
        branchId: "main",
        floorCount: 3,
        latestFloorId: "floor-3",
        latestFloorNo: 2,
        latestState: "committed",
        updatedAt: 100,
      },
    ]);

    const [url] = fetchImpl.mock.calls[0]!;
    const requestUrl = new URL(url as string);
    expect(requestUrl.pathname).toBe("/sessions/session-1/branches");
    expect(requestUrl.searchParams.get("limit")).toBe("50");
    expect(requestUrl.searchParams.get("offset")).toBe("0");
    expect(requestUrl.searchParams.get("sort_by")).toBe("updated_at");
    expect(requestUrl.searchParams.get("sort_order")).toBe("desc");
  });

  it("diffs branches and accepts floor summaries from camelCase backend rows", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          base_branch_id: "main",
          base_only_floors: [{ branchId: "main", floorNo: 2, id: "floor-2", state: "committed" }],
          fork_floor_no: 1,
          session_id: "session-1",
          shared_floor_nos: [0, 1],
          target_branch_id: "alt-1",
          target_only_floors: [{ branchId: "alt-1", floorNo: 2, id: "floor-3", state: "committed" }],
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(
      client.sessions.diffBranches({
        baseBranchId: "main",
        sessionId: "session-1",
        targetBranchId: "alt-1",
      }),
    ).resolves.toEqual({
      baseBranchId: "main",
      baseOnlyFloors: [{ branchId: "main", floorNo: 2, id: "floor-2", state: "committed" }],
      forkFloorNo: 1,
      sessionId: "session-1",
      sharedFloorNos: [0, 1],
      targetBranchId: "alt-1",
      targetOnlyFloors: [{ branchId: "alt-1", floorNo: 2, id: "floor-3", state: "committed" }],
    });
  });

  it("maps regenerate payloads with previous floor metadata", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          branch_id: "main",
          final_state: "committed",
          floor_id: "floor-5",
          floor_no: 5,
          generated_text: "Hello",
          previous_floor_id: "floor-4",
          summaries: ["summary-1"],
          memory: {
            mode: "sync",
            status: "applied",
            job_id: null,
          },
          total_usage: {
            completion_tokens: 5,
            prompt_tokens: 10,
            total_tokens: 15,
          },
          prompt_snapshot: {
            preset_id: "preset-1",
            preset_updated_at: 1710000000000,
            preset_version: 3,
            worldbook_id: "worldbook-1",
            worldbook_updated_at: 1710000001000,
            worldbook_version: 5,
            regex_profile_id: "regex-1",
            regex_profile_updated_at: 1710000002000,
            regex_profile_version: 2,
            worldbook_activated_entry_uids: [7],
            regex_pre_rule_names: ["pre-rule"],
            regex_post_rule_names: [],
            prompt_mode: "native",
            prompt_digest: "digest-1",
            token_estimate: 42,
          },
          runtime_trace: {
            worldbook: {
              hit_count: 1,
            },
            delivery: {
              assistant_prefill_requested: true,
              assistant_prefill_applied: false,
              assistant_prefill_strategy: "assistant_message_fallback",
              allow_assistant_prefill: true,
              require_last_user: true,
              no_assistant: false,
              last_message_role: "user",
              ends_with_user: true,
              degraded: true,
              degrade_reasons: ["require_last_user"],
            },
          },
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.sessions.regenerate({
      sessionId: "session-1",
      debugOptions: {
        includePromptSnapshot: true,
        includeRuntimeTrace: true,
        includeWorldbookMatches: false,
      },
    })).resolves.toEqual({
      branchId: "main",
      finalState: "committed",
      floorId: "floor-5",
      floorNo: 5,
      generatedText: "Hello",
      inputTokens: 10,
      outputTokens: 5,
      memory: {
        jobId: null,
        mode: "sync",
        status: "applied",
      },
      previousFloorId: "floor-4",
      summaries: ["summary-1"],
      totalTokens: 15,
      totalUsage: {
        completionTokens: 5,
        inputTokens: undefined,
        outputTokens: undefined,
        promptTokens: 10,
        totalTokens: 15,
      },
      promptSnapshot: {
        presetId: "preset-1",
        presetUpdatedAt: 1710000000000,
        presetVersion: 3,
        worldbookId: "worldbook-1",
        worldbookUpdatedAt: 1710000001000,
        worldbookVersion: 5,
        regexProfileId: "regex-1",
        regexProfileUpdatedAt: 1710000002000,
        regexProfileVersion: 2,
        worldbookActivatedEntryUids: [7],
        regexPreRuleNames: ["pre-rule"],
        regexPostRuleNames: [],
        promptMode: "native",
        promptDigest: "digest-1",
        tokenEstimate: 42,
      },
      runtimeTrace: {
        worldbook: { hitCount: 1 },
        delivery: {
          assistantPrefillRequested: true,
          assistantPrefillApplied: false,
          assistantPrefillStrategy: "assistant_message_fallback",
          allowAssistantPrefill: true,
          requireLastUser: true,
          noAssistant: false,
          lastMessageRole: "user",
          endsWithUser: true,
          degraded: true,
          degradeReasons: ["require_last_user"],
        },
      },
    });

    const [, init] = fetchImpl.mock.calls[0]!;
    expect(init?.body).toBe(JSON.stringify({
      debug_options: {
        include_prompt_snapshot: true,
        include_runtime_trace: true,
        include_worldbook_matches: false,
      },
    }));
  });

  it("throws TavernApiError when regenerate payload is invalid", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          previous_floor_id: "floor-4",
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.sessions.regenerate({ sessionId: "session-1" })).rejects.toBeInstanceOf(TavernApiError);
  });

  it("maps batch session updates and deletes", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            meta: {
              not_found: 1,
              status: "archived",
              total: 2,
              updated: 1,
            },
            results: [
              { action: "updated", id: "session-1", index: 0 },
              { action: "not_found", id: "session-2", index: 1 },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            meta: {
              deleted: 1,
              not_found: 1,
              total: 2,
            },
            results: [
              { action: "deleted", id: "session-1", index: 0 },
              { action: "not_found", id: "session-2", index: 1 },
            ],
          },
        }),
      );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(
      client.sessions.batchUpdateStatus({
        ids: ["session-1", "session-2"],
        status: "archived",
      }),
    ).resolves.toEqual({
      meta: {
        notFound: 1,
        status: "archived",
        total: 2,
        updated: 1,
      },
      results: [
        { action: "updated", id: "session-1", index: 0 },
        { action: "not_found", id: "session-2", index: 1 },
      ],
    });

    await expect(
      client.sessions.batchDelete({
        ids: ["session-1", "session-2"],
      }),
    ).resolves.toEqual({
      meta: {
        deleted: 1,
        notFound: 1,
        total: 2,
      },
      results: [
        { action: "deleted", id: "session-1", index: 0 },
        { action: "not_found", id: "session-2", index: 1 },
      ],
    });
  });

  it("gets, replaces, and patches session tool permissions", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            allow_irreversible: true,
            enabled: false,
            max_calls_per_turn: 4,
            max_steps_per_generation: 2,
            slot_allow_list: {
              narrator: ["search"],
            },
            slot_deny_list: {
              memory: ["delete"],
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            enabled: true,
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            slot_allow_list: {
              narrator: ["search", "browse"],
            },
          },
        }),
      );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.sessions.getToolPermissions({ sessionId: "session-1" })).resolves.toEqual({
      allowIrreversible: true,
      enabled: false,
      maxCallsPerTurn: 4,
      maxStepsPerGeneration: 2,
      slotAllowList: {
        narrator: ["search"],
      },
      slotDenyList: {
        memory: ["delete"],
      },
    });

    await expect(
      client.sessions.putToolPermissions({
        permissions: {
          enabled: true,
        },
        sessionId: "session-1",
      }),
    ).resolves.toEqual({
      enabled: true,
      maxCallsPerTurn: undefined,
      maxStepsPerGeneration: undefined,
      slotAllowList: undefined,
      slotDenyList: undefined,
    });

    await expect(
      client.sessions.patchToolPermissions({
        permissions: {
          slotAllowList: {
            narrator: ["search", "browse"],
          },
        },
        sessionId: "session-1",
      }),
    ).resolves.toEqual({
      slotAllowList: {
        narrator: ["search", "browse"],
      },
      allowIrreversible: undefined,
      enabled: undefined,
      maxCallsPerTurn: undefined,
      maxStepsPerGeneration: undefined,
      slotDenyList: undefined,
    });

    const [, putInit] = fetchImpl.mock.calls[1]!;
    const [, patchInit] = fetchImpl.mock.calls[2]!;
    expect(putInit?.body).toBe(JSON.stringify({ enabled: true }));
    expect(patchInit?.body).toBe(JSON.stringify({
      slot_allow_list: {
        narrator: ["search", "browse"],
      },
    }));
  });
});
