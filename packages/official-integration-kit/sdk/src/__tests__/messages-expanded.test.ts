import { describe, expect, it, vi } from "vitest";

import { createTavernClient } from "../index.js";

const baseUrl = "http://localhost:3000";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("sdk messages expanded resource", () => {
  it("creates and reads full message records", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            data: {
              content: "Hello",
              content_format: "markdown",
              created_at: 100,
              id: "msg-1",
              is_hidden: true,
              page_id: "page-1",
              role: "assistant",
              seq: 1,
              source: "model",
              token_count: 99,
            },
          },
          201,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            content: "Hello",
            content_format: "markdown",
            created_at: 100,
            id: "msg-1",
            is_hidden: true,
            page_id: "page-1",
            role: "assistant",
            seq: 1,
            source: "model",
            token_count: 99,
          },
        }),
      );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(
      client.messages.create({
        accountId: "acc-1",
        content: "Hello",
        contentFormat: "markdown",
        isHidden: true,
        pageId: "page-1",
        role: "assistant",
        seq: 1,
        source: "model",
        tokenCount: 99,
      }),
    ).resolves.toEqual({
      content: "Hello",
      contentFormat: "markdown",
      createdAt: 100,
      id: "msg-1",
      isHidden: true,
      pageId: "page-1",
      role: "assistant",
      seq: 1,
      source: "model",
      tokenCount: 99,
    });

    await expect(client.messages.getDetail({ messageId: "msg-1" })).resolves.toEqual({
      content: "Hello",
      contentFormat: "markdown",
      createdAt: 100,
      id: "msg-1",
      isHidden: true,
      pageId: "page-1",
      role: "assistant",
      seq: 1,
      source: "model",
      tokenCount: 99,
    });

    const [, init] = fetchImpl.mock.calls[0]!;
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({
      content: "Hello",
      content_format: "markdown",
      is_hidden: true,
      page_id: "page-1",
      role: "assistant",
      seq: 1,
      source: "model",
      token_count: 99,
    }));
  });

  it("lists messages with filters and skips invalid rows", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [
          null,
          {
            content: "Visible",
            content_format: "text",
            created_at: 10,
            id: "msg-1",
            is_hidden: false,
            page_id: "page-1",
            role: "user",
            seq: 0,
            source: null,
            token_count: 1,
          },
        ],
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(
      client.messages.list({
        isHidden: false,
        limit: 20,
        offset: 5,
        pageId: "page-1",
        role: "user",
        sortBy: "seq",
        sortOrder: "asc",
      }),
    ).resolves.toEqual([
      {
        content: "Visible",
        contentFormat: "text",
        createdAt: 10,
        id: "msg-1",
        isHidden: false,
        pageId: "page-1",
        role: "user",
        seq: 0,
        source: null,
        tokenCount: 1,
      },
    ]);

    const [url] = fetchImpl.mock.calls[0]!;
    const requestUrl = new URL(url as string);
    expect(requestUrl.pathname).toBe("/messages");
    expect(requestUrl.searchParams.get("page_id")).toBe("page-1");
    expect(requestUrl.searchParams.get("role")).toBe("user");
    expect(requestUrl.searchParams.get("is_hidden")).toBe("false");
    expect(requestUrl.searchParams.get("sort_by")).toBe("seq");
    expect(requestUrl.searchParams.get("sort_order")).toBe("asc");
    expect(requestUrl.searchParams.get("limit")).toBe("20");
    expect(requestUrl.searchParams.get("offset")).toBe("5");
  });

  it("updates messages with expanded patch fields while keeping the legacy return shape", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          content: "Updated",
          id: "msg-1",
          role: "narrator",
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(
      client.messages.update({
        content: "Updated",
        contentFormat: "json",
        isHidden: true,
        messageId: "msg-1",
        role: "narrator",
        seq: 2,
        source: "tool",
        tokenCount: 12,
      }),
    ).resolves.toEqual({
      content: "Updated",
      id: "msg-1",
      role: "narrator",
    });

    const [, init] = fetchImpl.mock.calls[0]!;
    expect(init?.body).toBe(JSON.stringify({
      content: "Updated",
      content_format: "json",
      is_hidden: true,
      role: "narrator",
      seq: 2,
      source: "tool",
      token_count: 12,
    }));
  });

  it("maps batch visibility and batch delete payloads", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            meta: {
              is_hidden: true,
              not_found: 1,
              total: 2,
              updated: 1,
            },
            results: [
              {
                action: "updated",
                data: {
                  content: "Hidden",
                  content_format: "text",
                  created_at: 10,
                  id: "msg-1",
                  is_hidden: true,
                  page_id: "page-1",
                  role: "assistant",
                  seq: 1,
                  source: null,
                  token_count: 0,
                },
                id: "msg-1",
                index: 0,
              },
              {
                action: "not_found",
                id: "msg-2",
                index: 1,
              },
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
              { action: "deleted", id: "msg-1", index: 0 },
              { action: "not_found", id: "msg-2", index: 1 },
            ],
          },
        }),
      );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(
      client.messages.batchUpdateVisibility({
        ids: ["msg-1", "msg-2"],
        isHidden: true,
      }),
    ).resolves.toEqual({
      meta: {
        isHidden: true,
        notFound: 1,
        total: 2,
        updated: 1,
      },
      results: [
        {
          action: "updated",
          data: {
            content: "Hidden",
            contentFormat: "text",
            createdAt: 10,
            id: "msg-1",
            isHidden: true,
            pageId: "page-1",
            role: "assistant",
            seq: 1,
            source: null,
            tokenCount: 0,
          },
          id: "msg-1",
          index: 0,
        },
        {
          action: "not_found",
          data: undefined,
          id: "msg-2",
          index: 1,
        },
      ],
    });

    await expect(client.messages.batchDelete({ ids: ["msg-1", "msg-2"] })).resolves.toEqual({
      meta: {
        deleted: 1,
        notFound: 1,
        total: 2,
      },
      results: [
        { action: "deleted", id: "msg-1", index: 0 },
        { action: "not_found", id: "msg-2", index: 1 },
      ],
    });
  });

  it("supports branch and generation overrides when editing and regenerating", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          branch_id: "branch-1",
          floor_id: "floor-2",
          floor_no: 2,
          total_usage: {
            total_tokens: 33,
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
            prompt_digest: "digest-message",
            token_estimate: 16,
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
      client.messages.editAndRegenerate({
        branchId: "branch-1",
        confirmedExecutionIds: ["exec-2"],
        confirmedSessionStateMutationIds: ["mutation-2"],
        config: {
          enableVerifier: true,
        },
        content: "Rewrite",
        generationParams: {
          maxOutputTokens: 128,
          reasoningEffort: "medium",
        },
        debugOptions: {
          includePromptSnapshot: true,
          includeRuntimeTrace: true,
          includeWorldbookMatches: false,
        },
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
        messageId: "msg-1",
      }),
    ).resolves.toEqual({
      branchId: "branch-1",
      finalState: undefined,
      floorId: "floor-2",
      floorNo: 2,
      generatedText: "",
      inputTokens: 0,
      outputTokens: 0,
      sourceFloorId: undefined,
      sourceMessageId: undefined,
      summaries: [],
      totalTokens: 33,
      totalUsage: {
        completionTokens: undefined,
        inputTokens: undefined,
        outputTokens: undefined,
        promptTokens: undefined,
        totalTokens: 33,
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
        promptDigest: "digest-message",
        tokenEstimate: 16,
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
      branch_id: "branch-1",
      confirmed_execution_ids: ["exec-2"],
      confirmed_session_state_mutation_ids: ["mutation-2"],
      config: {
        enableVerifier: true,
      },
      content: "Rewrite",
      debug_options: {
        include_prompt_snapshot: true,
        include_runtime_trace: true,
        include_worldbook_matches: false,
      },
      generation_params: {
        max_output_tokens: 128,
        reasoning_effort: "medium",
      },
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

    }));
  });
});
