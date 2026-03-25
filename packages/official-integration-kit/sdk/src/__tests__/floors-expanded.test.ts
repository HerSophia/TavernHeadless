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
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(
      client.floors.retry({
        config: {
          enableDirector: true,
        },
        floorId: "floor-1",
        generationParams: {
          maxOutputTokens: 200,
          reasoningEffort: "low",
        },
      }),
    ).resolves.toEqual({
      branchId: "main",
      floorId: "floor-2",
      floorNo: 2,
      totalTokens: 50,
      totalUsage: {
        completionTokens: undefined,
        inputTokens: undefined,
        outputTokens: undefined,
        promptTokens: undefined,
        totalTokens: 50,
      },
    });

    const [, init] = fetchImpl.mock.calls[0]!;
    expect(init?.body).toBe(JSON.stringify({
      config: {
        enableDirector: true,
      },
      generation_params: {
        max_output_tokens: 200,
        reasoning_effort: "low",
      },
    }));
  });
});
