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
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(
      client.messages.editAndRegenerate({
        branchId: "branch-1",
        config: {
          enableVerifier: true,
        },
        content: "Rewrite",
        generationParams: {
          maxOutputTokens: 128,
          reasoningEffort: "medium",
        },
        messageId: "msg-1",
      }),
    ).resolves.toEqual({
      branchId: "branch-1",
      floorId: "floor-2",
      floorNo: 2,
      totalTokens: 33,
      totalUsage: {
        completionTokens: undefined,
        inputTokens: undefined,
        outputTokens: undefined,
        promptTokens: undefined,
        totalTokens: 33,
      },
    });

    const [, init] = fetchImpl.mock.calls[0]!;
    expect(init?.body).toBe(JSON.stringify({
      branch_id: "branch-1",
      config: {
        enableVerifier: true,
      },
      content: "Rewrite",
      generation_params: {
        max_output_tokens: 128,
        reasoning_effort: "medium",
      },
    }));
  });
});
