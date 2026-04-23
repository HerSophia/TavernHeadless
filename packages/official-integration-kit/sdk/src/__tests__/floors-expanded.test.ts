import { describe, expect, it, vi } from "vitest";

import { createTavernClient } from "../index.js";

const baseUrl = "http://localhost:3000";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("sdk floors expanded resource", () => {
  it("creates, gets, and updates floors", async () => {
    const floorPayload = {
      branch_id: "main",
      created_at: 100,
      floor_no: 1,
      id: "floor-1",
      parent_floor_id: null,
      session_id: "session-1",
      state: "draft",
      token_in: 0,
      token_out: 0,
      superseded_at: null,
      superseded_by_floor_id: null,
      updated_at: 101,
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: floorPayload }, 201))
      .mockResolvedValueOnce(jsonResponse({ data: floorPayload }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            ...floorPayload,
            branch_id: "branch-1",
            floor_no: 2,
            parent_floor_id: "floor-0",
            state: "committed",
            token_in: 11,
            token_out: 22,
            updated_at: 102,
          },
        }),
      );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(
      client.floors.create({
        branchId: "main",
        floorNo: 1,
        sessionId: "session-1",
      }),
    ).resolves.toEqual({
      branchId: "main",
      createdAt: 100,
      floorNo: 1,
      id: "floor-1",
      parentFloorId: null,
      sessionId: "session-1",
      state: "draft",
      supersededAt: null,
      supersededByFloorId: null,
      tokenIn: 0,
      tokenOut: 0,
      updatedAt: 101,
    });

    await expect(client.floors.getDetail({ floorId: "floor-1" })).resolves.toEqual({
      branchId: "main",
      createdAt: 100,
      floorNo: 1,
      id: "floor-1",
      parentFloorId: null,
      sessionId: "session-1",
      state: "draft",
      supersededAt: null,
      supersededByFloorId: null,
      tokenIn: 0,
      tokenOut: 0,
      updatedAt: 101,
    });

    await expect(
      client.floors.update({
        branchId: "branch-1",
        floorId: "floor-1",
        floorNo: 2,
        parentFloorId: "floor-0",
        state: "committed",
        tokenIn: 11,
        tokenOut: 22,
      }),
    ).resolves.toEqual({
      branchId: "branch-1",
      createdAt: 100,
      floorNo: 2,
      id: "floor-1",
      parentFloorId: "floor-0",
      sessionId: "session-1",
      state: "committed",
      supersededAt: null,
      supersededByFloorId: null,
      tokenIn: 11,
      tokenOut: 22,
      updatedAt: 102,
    });

    const [, createInit] = fetchImpl.mock.calls[0]!;
    const [, updateInit] = fetchImpl.mock.calls[2]!;
    expect(createInit?.body).toBe(JSON.stringify({
      branch_id: "main",
      floor_no: 1,
      session_id: "session-1",
    }));
    expect(updateInit?.body).toBe(JSON.stringify({
      branch_id: "branch-1",
      floor_no: 2,
      parent_floor_id: "floor-0",
      state: "committed",
      token_in: 11,
      token_out: 22,
    }));
  });

  it("reads floor run snapshot", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          floor_id: "floor-1",
          state: "generating",
          run: {
            run_id: "run-1",
            run_type: "respond",
            status: "running",
            phase: "page_generating",
            public_phase: "generating",
            phase_seq: 4,
            attempt_no: 1,
            started_at: 100,
            updated_at: 120,
            completed_at: null,
            pending_output: {
              temp_id: "temp-1",
              attempt_no: 1,
              state: "streaming",
              text: "Hello",
              started_at: 101,
              updated_at: 120,
              error: null,
            },
            verifier: { status: "pending", suggestion: null, issues: null },
            error: null,
          },
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.floors.getRun({ floorId: "floor-1" })).resolves.toEqual({
      floorId: "floor-1",
      state: "generating",
      run: {
        attemptNo: 1, completedAt: null, error: null,
        pendingOutput: { attemptNo: 1, error: null, startedAt: 101, state: "streaming", tempId: "temp-1", text: "Hello", updatedAt: 120 },
        phase: "page_generating", phaseSeq: 4, publicPhase: "generating", runId: "run-1", runType: "respond", startedAt: 100, status: "running",
        updatedAt: 120, verifier: { issues: [], status: "pending", suggestion: null },
      },
    });
  });

  it("reads committed floor result snapshot", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          floor_id: "floor-1",
          output_page_id: "page-2",
          assistant_message_id: "msg-2",
          generated_text: "Committed reply",
          summaries: ["s1", "s2"],
          usage: {
            prompt_tokens: 12,
            completion_tokens: 34,
            total_tokens: 46,
          },
          verifier: {
            status: "warned",
            suggestion: "tighten wording",
            issues: [{ description: "minor inconsistency", severity: "warning" }],
          },
          committed_at: 200,
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.floors.getResult({ floorId: "floor-1" })).resolves.toEqual({
      assistantMessageId: "msg-2",
      committedAt: 200,
      floorId: "floor-1",
      generatedText: "Committed reply",
      inputTokens: 12,
      outputPageId: "page-2",
      outputTokens: 34,
      summaries: ["s1", "s2"],
      totalTokens: 46,
      totalUsage: { promptTokens: 12, completionTokens: 34, totalTokens: 46 },
      verifier: { issues: [{ description: "minor inconsistency", severity: "warning" }], status: "warned", suggestion: "tighten wording" },
    });
  });

  it("lists floors with filters and defaults", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [
          null,
          {
            branch_id: "main",
            created_at: 100,
            floor_no: 1,
            id: "floor-1",
            parent_floor_id: null,
            session_id: "session-1",
            state: "committed",
            token_in: 5,
            token_out: 6,
            superseded_at: null,
            superseded_by_floor_id: null,
            updated_at: 101,
          },
        ],
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(
      client.floors.list({
        branchId: "main",
        limit: 20,
        offset: 5,
        sessionId: "session-1",
        sortBy: "floor_no",
        sortOrder: "asc",
        state: "committed",
      }),
    ).resolves.toEqual([
      {
        branchId: "main",
        createdAt: 100,
        floorNo: 1,
        id: "floor-1",
        parentFloorId: null,
        sessionId: "session-1",
        state: "committed",
        supersededAt: null,
        supersededByFloorId: null,
        tokenIn: 5,
        tokenOut: 6,
        updatedAt: 101,
      },
    ]);

    const [url] = fetchImpl.mock.calls[0]!;
    const requestUrl = new URL(url as string);
    expect(requestUrl.pathname).toBe("/floors");
    expect(requestUrl.searchParams.get("branch_id")).toBe("main");
    expect(requestUrl.searchParams.get("session_id")).toBe("session-1");
    expect(requestUrl.searchParams.get("state")).toBe("committed");
    expect(requestUrl.searchParams.get("sort_by")).toBe("floor_no");
    expect(requestUrl.searchParams.get("sort_order")).toBe("asc");
    expect(requestUrl.searchParams.get("limit")).toBe("20");
    expect(requestUrl.searchParams.get("offset")).toBe("5");
  });

  it("removes floors by reading the backend deleted flag", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          deleted: true,
          id: "floor-1",
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.floors.remove({ floorId: "floor-1" })).resolves.toBe(true);
  });

  it("prepares a branch from a floor", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          data: {
            branch_id: "branch-2",
            session_id: "session-1",
            source_floor_id: "floor-1",
            source_floor_no: 1,
          },
        },
        201,
      ),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.floors.branch({ branchId: "branch-2", floorId: "floor-1" })).resolves.toEqual({
      branchId: "branch-2",
      sessionId: "session-1",
      sourceFloorId: "floor-1",
      sourceFloorNo: 1,
    });

    const [, init] = fetchImpl.mock.calls[0]!;
    expect(init?.body).toBe(JSON.stringify({ branch_id: "branch-2" }));
  });

  it("retries a floor with optional generation overrides", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          branch_id: "main",
          floor_id: "floor-2",
          floor_no: 2,
          total_usage: {
            total_tokens: 50,
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
            prompt_mode: "compat_strict",
            prompt_digest: "digest-floor",
            token_estimate: 24,
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

    await expect(
      client.floors.retry({
        confirmedExecutionIds: ["exec-1"],
        confirmedSessionStateMutationIds: ["mutation-1"],
        config: {
          enableDirector: true,
        },
        floorId: "floor-1",
        generationParams: {
          maxOutputTokens: 200,
          reasoningEffort: "low",
        },
        debugOptions: {
          includePromptSnapshot: true,
          includeRuntimeTrace: true,
          includeWorldbookMatches: false,
        },
      }),
    ).resolves.toEqual({
      branchId: "main",
      finalState: undefined,
      floorId: "floor-2",
      floorNo: 2,
      generatedText: "",
      inputTokens: 0,
      outputTokens: 0,
      summaries: [],
      totalTokens: 50,
      totalUsage: {
        completionTokens: undefined,
        inputTokens: undefined,
        outputTokens: undefined,
        promptTokens: undefined,
        totalTokens: 50,
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
        promptMode: "compat_strict",
        promptDigest: "digest-floor",
        tokenEstimate: 24,
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
      confirmed_execution_ids: ["exec-1"],
      confirmed_session_state_mutation_ids: ["mutation-1"],
      config: {
        enableDirector: true,
      },
      debug_options: {
        include_prompt_snapshot: true,
        include_runtime_trace: true,
        include_worldbook_matches: false,
      },
      generation_params: {
        max_output_tokens: 200,
        reasoning_effort: "low",
      },
    }));
  });
});
