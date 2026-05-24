import { describe, expect, it, vi } from "vitest";

import { createTavernClient, TavernApiError } from "../index.js";

const baseUrl = "http://localhost:3000";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("sdk core resources", () => {
  it("reads health fields from a valid payload", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        database: "ok",
        service: "up",
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.health.get()).resolves.toEqual({
      database: "ok",
      service: "up",
    });
  });

  it("returns null health fields for malformed payloads", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        database: 1,
        service: null,
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.health.get()).resolves.toEqual({
      database: null,
      service: null,
    });
  });

  it("creates sessions with only defined fields and returns null when data is missing", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}));
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(
      client.sessions.create({
        accountId: "acc-1",
      }),
    ).resolves.toBeNull();

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBeInstanceOf(URL);
    expect(String(url)).toBe("http://localhost:3000/sessions");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe("{}");
    expect((init?.headers as Headers).get("x-account-id")).toBe("acc-1");
  });

  it("lists sessions without overriding backend defaults and filters invalid rows", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [
          null,
          {
            character_binding: {
              snapshot_summary: {
                has_greeting: true,
                name: "Seraphina",
              },
            },
            created_at: 10,
            id: "session-1",
            status: "active",
            title: "Session A",
            updated_at: 11,
            user_binding: {
              snapshot_summary: {
                name: "Alice",
              },
            },
            worldbook_profile_id: null,
          },
        ],
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    const result = await client.sessions.list({ accountId: "acc-1" });

    expect(result).toEqual([
      {
        characterBinding: {
          characterId: null,
          characterVersionId: null,
          snapshotSummary: {
            hasGreeting: true,
            name: "Seraphina",
          },
          syncPolicy: "pin",
        },
        createdAt: 10,
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
        updatedAt: 11,
        userBinding: {
          snapshotSummary: {
            name: "Alice",
          },
          userId: null,
        },
        worldbookProfileId: null,
      },
    ]);

    const [url] = fetchImpl.mock.calls[0]!;
    const requestUrl = new URL(url as string);

    expect(requestUrl.pathname).toBe("/sessions");
    expect(requestUrl.search).toBe("");
  });

  it("maps the session runtime tool catalog", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          session_id: "session-1",
          generated_at: 1710000000000,
          tools: [
            {
              name: "set_variable",
              provider_id: "builtin",
              provider_type: "builtin",
              source: "builtin",
              side_effect_level: "sandbox",
              allowed_slots: ["narrator"],
              availability: "available",
              availability_reason: null,
              async_capability: "inline_only",
              default_delivery_mode: "inline",
              catalog_source: null,
              result_visibility: "immediate",
              replay_safety: "safe",
            },
          ],
          conflicts: [
            {
              tool_name: "lookup_notes",
              provider_ids: ["custom:acc-1", "mcp:mcp-1"],
              reason: "name_conflict",
            },
          ],
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.sessions.getRuntimeToolCatalog({ accountId: "acc-1", sessionId: "session-1" })).resolves.toEqual({
      conflicts: [{ providerIds: ["custom:acc-1", "mcp:mcp-1"], reason: "name_conflict", toolName: "lookup_notes" }],
      generatedAt: 1710000000000,
      sessionId: "session-1",
      tools: [{
        allowedSlots: ["narrator"],
        availability: "available",
        availabilityReason: null,
        catalogSource: null,
        asyncCapability: "inline_only",
        defaultDeliveryMode: "inline",
        name: "set_variable",
        providerId: "builtin",
        providerType: "builtin",
        replaySafety: "safe",
        resultVisibility: "immediate",
        sideEffectLevel: "sandbox",
        source: "builtin",
        sideEffectLevelBasis: null,
        allowedSlotsBasis: null,
        exposure: null,
        parameterSchemaBasis: null,
        replaySafetyBasis: null,
        metadataBasisDetail: null,
      }],
    });
  });

  it("maps runtime tool catalog metadata detail and MCP exposure fields", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          session_id: "session-2",
          generated_at: 1710000000100,
          tools: [
            {
              name: "github_create_issue",
              provider_id: "mcp:mcp-1",
              provider_type: "mcp",
              source: "mcp",
              side_effect_level: "irreversible",
              allowed_slots: ["narrator"],
              availability: "available",
              availability_reason: null,
              async_capability: "deferred_ok",
              default_delivery_mode: "async_job",
              catalog_source: "cached",
              exposure: {
                scope: "project_binding",
                server_state: "enabled",
                allowed_tools_mode: "allow_list",
                allowed_tools: ["github_create_issue"],
              },
              replay_safety: "never_auto_replay",
              result_visibility: "deferred_receipt",
              side_effect_level_basis: "server_default",
              allowed_slots_basis: "platform_default",
              parameter_schema_basis: "shallow_schema_projection",
              replay_safety_basis: "inferred_from_execution_policy",
              metadata_basis_detail: {
                side_effect_level: { basis: "server_default", scope: "server" },
                allowed_slots: { basis: "platform_default", scope: "platform" },
                parameter_schema: { basis: "shallow_schema_projection", scope: "projection" },
                replay_safety: { basis: "inferred_from_execution_policy", scope: "inference" },
              },
            },
          ],
          conflicts: [],
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.sessions.getRuntimeToolCatalog({ accountId: "acc-1", sessionId: "session-1" })).resolves.toEqual({
      conflicts: [],
      generatedAt: 1710000000100,
      sessionId: "session-2",
      tools: [{
        exposure: {
          scope: "project_binding",
          serverState: "enabled",
          allowedToolsMode: "allow_list",
          allowedTools: ["github_create_issue"],
        },
        allowedSlots: ["narrator"],
        availability: "available",
        availabilityReason: null,
        catalogSource: "cached",
        asyncCapability: "deferred_ok",
        defaultDeliveryMode: "async_job",
        name: "github_create_issue",
        providerId: "mcp:mcp-1",
        providerType: "mcp",
        replaySafety: "never_auto_replay",
        resultVisibility: "deferred_receipt",
        sideEffectLevel: "irreversible",
        source: "mcp",
        sideEffectLevelBasis: "server_default",
        allowedSlotsBasis: "platform_default",
        parameterSchemaBasis: "shallow_schema_projection",
        replaySafetyBasis: "inferred_from_execution_policy",
        metadataBasisDetail: {
          sideEffectLevel: { basis: "server_default", scope: "server" },
          allowedSlots: { basis: "platform_default", scope: "platform" },
          parameterSchema: { basis: "shallow_schema_projection", scope: "projection" },
          replaySafety: { basis: "inferred_from_execution_policy", scope: "inference" },
        },
      }],
    });
  });

  it("maps respond payloads and generation params while defaulting missing usage to zero", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          branch_id: "branch-1",
          final_state: "committed",
          floor_id: "floor-1",
          floor_no: 3,
          generated_text: "Hello",
          memory: {
            mode: "async",
            status: "queued",
            job_id: "memory-job:ingest_turn:floor-1",
          },
          summaries: ["summary-1"],
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
            prompt_mode: "compat_strict",
            prompt_digest: "digest-1",
            token_estimate: 42,
          },
          runtime_trace: {
            worldbook: {
              hit_count: 1,
              matches: [],
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

    const result = await client.sessions.respond({
      accountId: "acc-1",
      generationParams: {
        frequencyPenalty: 0.1,
        maxOutputTokens: 128,
        presencePenalty: 0.2,
        stopSequences: ["END"],
        stream: true,
        temperature: 0.8,
        topK: 20,
        topP: 0.9,
      },
      debugOptions: {
        includePromptSnapshot: true,
        includeRuntimeTrace: true,
        includeWorldbookMatches: true,
      },
      message: "hello",
      sessionId: "session-1",
    });

    expect(result).toEqual({
      branchId: "branch-1",
      finalState: "committed",
      floorId: "floor-1",
      floorNo: 3,
      generatedText: "Hello",
      inputTokens: 0,
      outputTokens: 0,
      memory: {
        jobId: "memory-job:ingest_turn:floor-1",
        mode: "async",
        status: "queued",
      },
      summaries: ["summary-1"],
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
        promptMode: "compat_strict",
        promptDigest: "digest-1",
        tokenEstimate: 42,
      },
      runtimeTrace: {
        worldbook: {
          hitCount: 1,
          matches: [],
        },
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
      totalTokens: 0,
      totalUsage: {},
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("http://localhost:3000/sessions/session-1/respond");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({
      debug_options: {
        include_prompt_snapshot: true,
        include_runtime_trace: true,
        include_worldbook_matches: true,
      },
      generation_params: {
        frequency_penalty: 0.1,
        max_output_tokens: 128,
        presence_penalty: 0.2,
        stop_sequences: ["END"],
        stream: true,
        temperature: 0.8,
        top_k: 20,
        top_p: 0.9,
      },
      message: "hello",
    }));
  });

  it("throws TavernApiError when respond payload misses required floor metadata", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          generated_text: "Hello",
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(
      client.sessions.respond({
        message: "hello",
        sessionId: "session-1",
      }),
    ).rejects.toBeInstanceOf(TavernApiError);
  });

  it("forwards respondStream callbacks and signal and returns the final mapped result", async () => {
    const stream = [
      "event: start\n",
      'data: {"branch_id":"branch-1","floor_id":"floor-1","floor_no":2}\n\n',
      "event: run\n",
      'data: {"floor_id":"floor-1","run_id":"run-1","run_type":"respond","status":"running","phase":"page_generating","public_phase":"generating","phase_seq":3,"attempt_no":1,"started_at":100,"updated_at":120,"completed_at":null,"pending_output":{"temp_id":"temp-1","attempt_no":1,"state":"streaming","text":"Hello","started_at":100,"updated_at":120,"error":null},"verifier":null,"error":null}\n\n',
      "event: chunk\n",
      'data: {"chunk":"Hello"}\n\n',
      "event: tool\n",
      'data: {"execution_id":"exec-1","tool_name":"set_variable","provider_id":"builtin","provider_type":"builtin","side_effect_level":"sandbox","phase":"start","replay_safety":"uncertain"}\n\n',
      "event: summary\n",
      'data: {"summaries":["sum-1"]}\n\n',
      "event: tool\n",
      'data: {"execution_id":"exec-1","tool_name":"set_variable","provider_id":"builtin","provider_type":"builtin","side_effect_level":"sandbox","phase":"success","duration_ms":7,"replay_safety":"safe"}\n\n',
      "event: done\n",
      'data: {"branch_id":"branch-1","final_state":"committed","floor_id":"floor-1","floor_no":2,"generated_text":"Hello","summaries":["sum-1","sum-2"],"total_usage":{"input_tokens":10,"output_tokens":5,"total_tokens":15},"prompt_snapshot":{"preset_id":"preset-1","preset_updated_at":1710000000000,"preset_version":3,"worldbook_id":"worldbook-1","worldbook_updated_at":1710000001000,"worldbook_version":5,"regex_profile_id":"regex-1","regex_profile_updated_at":1710000002000,"regex_profile_version":2,"worldbook_activated_entry_uids":[7],"regex_pre_rule_names":["pre-rule"],"regex_post_rule_names":[],"prompt_mode":"compat_strict","prompt_digest":"digest-1","token_estimate":42},"runtime_trace":{"worldbook":{"hit_count":1},"delivery":{"assistant_prefill_requested":true,"assistant_prefill_applied":false,"assistant_prefill_strategy":"assistant_message_fallback","allow_assistant_prefill":true,"require_last_user":true,"no_assistant":false,"last_message_role":"user","ends_with_user":true,"degraded":true,"degrade_reasons":["require_last_user"]}}}\n\n',
    ].join("");
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(stream, {
        headers: { "content-type": "text/event-stream" },
        status: 200,
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });
    const controller = new AbortController();
    const events: string[] = [];
    const chunks: string[] = [];
    const summaries: string[][] = [];
    const starts: Array<{ branchId?: string; floorId?: string; floorNo?: number }> = [];
    const runs: Array<Record<string, unknown>> = [];
    const tools: Array<Record<string, unknown>> = [];

    const result = await client.sessions.respondStream({
      message: "hello",
      onChunk: (payload) => chunks.push(payload.chunk),
      onEvent: (event) => events.push(event.type),
      onRun: (payload) => runs.push(payload as Record<string, unknown>),
      onStart: (payload) => starts.push(payload),
      onSummary: (payload) => summaries.push(payload.summaries),
      onTool: (payload) => tools.push(payload as Record<string, unknown>),
      sessionId: "session-1",
      signal: controller.signal,
    });

    expect(starts).toEqual([
      {
        branchId: "branch-1",
        floorId: "floor-1",
        floorNo: 2,
      },
    ]);
    expect(chunks).toEqual(["Hello"]);
    expect(runs).toEqual([{ attemptNo: 1, completedAt: null, error: null, floorId: "floor-1", pendingOutput: { attemptNo: 1, error: null, startedAt: 100, state: "streaming", tempId: "temp-1", text: "Hello", updatedAt: 120 }, phase: "page_generating", phaseSeq: 3, publicPhase: "generating", runId: "run-1", runType: "respond", startedAt: 100, status: "running", updatedAt: 120, verifier: null }]);
    expect(summaries).toEqual([["sum-1"]]);
    expect(tools).toEqual([{ executionId: "exec-1", phase: "start", providerId: "builtin", providerType: "builtin", replaySafety: "uncertain", sideEffectLevel: "sandbox", toolName: "set_variable" }, { durationMs: 7, executionId: "exec-1", phase: "success", providerId: "builtin", providerType: "builtin", replaySafety: "safe", sideEffectLevel: "sandbox", toolName: "set_variable" }]);
    expect(events).toEqual(["start", "run", "chunk", "tool", "summary", "tool", "done"]);
    expect(result).toEqual({
      branchId: "branch-1",
      finalState: "committed",
      floorId: "floor-1",
      floorNo: 2,
      generatedText: "Hello",
      inputTokens: 10,
      outputTokens: 5,
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
        promptMode: "compat_strict",
        promptDigest: "digest-1",
        tokenEstimate: 42,
      },
      runtimeTrace: {
        worldbook: {
          hitCount: 1,
        },
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
      summaries: ["sum-1", "sum-2"],
      totalTokens: 15,
      totalUsage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      },
    });

    const [, init] = fetchImpl.mock.calls[0]!;
    expect(init?.signal).toBe(controller.signal);
  });

  it("throws TavernApiError with SSE error payload code on respondStream failure", async () => {
    const stream = [
      "event: error\n",
      'data: {"code":"generation_timeout","message":"Turn orchestration failed: LLM request timed out after 60000ms"}\n\n',
    ].join("");
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(stream, {
        headers: { "content-type": "text/event-stream" },
        status: 200,
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    try {
      await client.sessions.respondStream({
        message: "hello",
        sessionId: "session-1",
      });

      throw new Error("respondStream should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(TavernApiError);
      expect(error).toMatchObject({
        code: "generation_timeout",
        message: "Turn orchestration failed: LLM request timed out after 60000ms",
        status: 200,
      });
    }
  });

  it("maps timeline payloads with default query and filtered nested records", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          branch_id: "main",
          floors: [
            null,
            {
              active_page: {
                id: "page-1",
                messages: [
                  null,
                  {
                    content: "hello",
                    content_format: "markdown",
                    id: "msg-1",
                    role: "assistant",
                    seq: 1,
                  },
                ],
                page_kind: "main",
                page_no: 1,
                version: 2,
              },
              created_at: 100,
              floor_no: 1,
              id: "floor-1",
              page_count: 1,
              state: "completed",
              token_in: 5,
              token_out: 7,
            },
            {
              active_page: null,
              created_at: 101,
              floor_no: 2,
              id: "floor-2",
              page_count: 0,
              state: "completed",
              token_in: 0,
              token_out: 0,
            },
          ],
          session_id: "session-1",
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    const result = await client.sessions.timeline({
      accountId: "acc-1",
      sessionId: "session-1",
    });

    expect(result).toEqual({
      branchId: "main",
      floors: [
        {
          pages: [
            {
              id: "page-1",
              isActive: true,
              messages: [
                {
                  content: "hello",
                  contentFormat: "markdown",
                  id: "msg-1",
                  role: "assistant",
                  seq: 1,
                },
              ],
              pageKind: "main",
              pageNo: 1,
              version: 2,
            },
          ],
          activePages: [
            {
              id: "page-1",
              isActive: true,
              messages: [
                {
                  content: "hello",
                  contentFormat: "markdown",
                  id: "msg-1",
                  role: "assistant",
                  seq: 1,
                },
              ],
              pageKind: "main",
              pageNo: 1,
              version: 2,
            },
          ],
          activePage: {
            id: "page-1",
            isActive: true,
            messages: [
              {
                content: "hello",
                contentFormat: "markdown",
                id: "msg-1",
                role: "assistant",
                seq: 1,
              },
            ],
            pageKind: "main",
            pageNo: 1,
            version: 2,
          },
          messages: [
            {
              content: "hello",
              contentFormat: "markdown",
              id: "msg-1",
              role: "assistant",
              seq: 1,
            },
          ],
          createdAt: 100,
          floorNo: 1,
          id: "floor-1",
          pageCount: 1,
          state: "completed",
          tokenIn: 5,
          tokenOut: 7,
        },
        {
          pages: [],
          activePages: [],
          activePage: null,
          messages: [],
          createdAt: 101,
          floorNo: 2,
          id: "floor-2",
          pageCount: 0,
          state: "completed",
          tokenIn: 0,
          tokenOut: 0,
        },
      ],
      sessionId: "session-1",
    });

    const [url] = fetchImpl.mock.calls[0]!;
    const requestUrl = new URL(url as string);

    expect(requestUrl.pathname).toBe("/sessions/session-1/timeline");
    expect(requestUrl.searchParams.get("branch_id")).toBe("main");
    expect(requestUrl.searchParams.get("limit")).toBe("200");
    expect(requestUrl.searchParams.get("offset")).toBe("0");
  });

  it("maps page-aware timeline payloads with multi active page and null activePage", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          branch_id: "main",
          session_id: "session-1",
          floors: [
            {
              id: "floor-1",
              floor_no: 1,
              state: "committed",
              token_in: 0,
              token_out: 0,
              created_at: 100,
              pages: [
                {
                  id: "page-in",
                  page_no: 0,
                  page_kind: "input",
                  is_active: true,
                  version: 1,
                  messages: [
                    { id: "msg-u", seq: 0, role: "user", content: "hello", content_format: "text" },
                  ],
                },
                {
                  id: "page-out",
                  page_no: 1,
                  page_kind: "output",
                  is_active: true,
                  version: 1,
                  messages: [
                    { id: "msg-a", seq: 0, role: "assistant", content: "world", content_format: "text" },
                  ],
                },
              ],
              active_pages: [
                {
                  id: "page-in",
                  page_no: 0,
                  page_kind: "input",
                  version: 1,
                  messages: [
                    { id: "msg-u", seq: 0, role: "user", content: "hello", content_format: "text" },
                  ],
                },
                {
                  id: "page-out",
                  page_no: 1,
                  page_kind: "output",
                  version: 1,
                  messages: [
                    { id: "msg-a", seq: 0, role: "assistant", content: "world", content_format: "text" },
                  ],
                },
              ],
              // 后端在多 active page 场景下返回 null；序列化要确保 SDK 保持同语义。
              active_page: null,
              messages: [
                { id: "msg-u", seq: 0, role: "user", content: "hello", content_format: "text" },
                { id: "msg-a", seq: 0, role: "assistant", content: "world", content_format: "text" },
              ],
              page_count: 2,
            },
          ],
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    const result = await client.sessions.timeline({
      accountId: "acc-1",
      sessionId: "session-1",
    });

    const floor = result.floors[0]!;
    expect(floor.pages).toHaveLength(2);
    expect(floor.activePages).toHaveLength(2);
    expect(floor.activePage).toBeNull();
    expect(floor.messages.map((m) => m.content)).toEqual(["hello", "world"]);
    expect(floor.pages.every((p) => p.isActive)).toBe(true);
  });


  it("updates sessions with expanded payloads and returns the updated session", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          character_binding: null,
          created_at: 10,
          id: "session-1",
          metadata: { source: "sdk-test" },
          model_name: "gpt-4o-mini",
          model_params: { temperature: 0.7 },
          model_provider: "openai",
          preset_id: "preset-1",
          prompt_mode: "native",
          regex_profile_id: "regex-1",
          status: "active",
          title: "Renamed",
          updated_at: 11,
          user_binding: null,
          worldbook_profile_id: "wb-1",
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(
      client.sessions.update({
        metadata: { source: "sdk-test" },
        modelName: "gpt-4o-mini",
        modelParams: { temperature: 0.7 },
        modelProvider: "openai",
        presetId: "preset-1",
        promptMode: "native",
        regexProfileId: "regex-1",
        sessionId: "session-1",
        title: "Renamed",
        worldbookProfileId: "wb-1",
      }),
    ).resolves.toEqual({
      characterBinding: null,
      createdAt: 10,
      id: "session-1",
      metadata: { source: "sdk-test" },
      modelName: "gpt-4o-mini",
      modelParams: { temperature: 0.7 },
      modelProvider: "openai",
      presetId: "preset-1",
      promptMode: "native",
      regexProfileId: "regex-1",
      status: "active",
      title: "Renamed",
      updatedAt: 11,
      userBinding: null,
      worldbookProfileId: "wb-1",
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBeInstanceOf(URL);
    expect(String(url)).toBe("http://localhost:3000/sessions/session-1");
    expect(init?.method).toBe("PATCH");
    expect(init?.body).toBe(JSON.stringify({
      metadata: { source: "sdk-test" },
      model_name: "gpt-4o-mini",
      model_params: { temperature: 0.7 },
      model_provider: "openai",
      preset_id: "preset-1",
      prompt_mode: "native",
      regex_profile_id: "regex-1",
      title: "Renamed",
      worldbook_profile_id: "wb-1",
    }));
  });

  it("returns boolean delete results for sessions", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 204,
        }),
      );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.sessions.remove({ sessionId: "session-1" })).resolves.toBe(true);
    await expect(client.sessions.remove({ sessionId: "session-2" })).resolves.toBe(false);
  });

  it("updates messages and returns null when the data payload is missing", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}));
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(
      client.messages.update({
        content: "Edited",
        messageId: "msg-1",
      }),
    ).resolves.toBeNull();

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBeInstanceOf(URL);
    expect(String(url)).toBe("http://localhost:3000/messages/msg-1");
    expect(init?.method).toBe("PATCH");
    expect(init?.body).toBe(JSON.stringify({ content: "Edited" }));
  });

  it("returns boolean delete results for messages", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 204,
        }),
      );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.messages.remove({ messageId: "msg-1" })).resolves.toBe(true);
    await expect(client.messages.remove({ messageId: "msg-2" })).resolves.toBe(false);
  });

  it("maps edit-and-regenerate results and defaults missing usage to zero", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          branch_id: "branch-2",
          final_state: "committed",
          floor_id: "floor-2",
          floor_no: 4,
          generated_text: "Rewrite complete",
          source_floor_id: "floor-1",
          memory: {
            mode: "sync",
            status: "applied",
            job_id: null,
          },
          source_message_id: "msg-1",
          summaries: ["summary-1"],
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(
      client.messages.editAndRegenerate({
        content: "Rewrite",
        messageId: "msg-1",
      }),
    ).resolves.toEqual({
      branchId: "branch-2",
      finalState: "committed",
      floorId: "floor-2",
      floorNo: 4,
      generatedText: "Rewrite complete",
      inputTokens: 0,
      outputTokens: 0,
      memory: {
        jobId: null,
        mode: "sync",
        status: "applied",
      },
      sourceFloorId: "floor-1",
      sourceMessageId: "msg-1",
      summaries: ["summary-1"],
      totalTokens: 0,
      totalUsage: {},
    });
  });

  it("throws TavernApiError when edit-and-regenerate payload is invalid", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          branch_id: "branch-2",
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(
      client.messages.editAndRegenerate({
        content: "Rewrite",
        messageId: "msg-1",
      }),
    ).rejects.toBeInstanceOf(TavernApiError);
  });

  it("maps floor retry results and posts an empty body", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          final_state: "committed",
          floor_id: "floor-3",
          floor_no: 5,
          generated_text: "Retry complete",
          memory: {
            mode: "sync",
            status: "applied",
            job_id: null,
          },
          summaries: ["summary-1"],
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.floors.retry({ floorId: "floor-3" })).resolves.toEqual({
      branchId: undefined,
      finalState: "committed",
      floorId: "floor-3",
      floorNo: 5,
      generatedText: "Retry complete",
      inputTokens: 0,
      outputTokens: 0,
      memory: {
        jobId: null,
        mode: "sync",
        status: "applied",
      },
      summaries: ["summary-1"],
      totalTokens: 0,
      totalUsage: {},
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("http://localhost:3000/floors/floor-3/retry");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({}));
  });

  it("throws TavernApiError when floor retry payload is invalid", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          branch_id: "branch-3",
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.floors.retry({ floorId: "floor-3" })).rejects.toBeInstanceOf(TavernApiError);
  });
});
