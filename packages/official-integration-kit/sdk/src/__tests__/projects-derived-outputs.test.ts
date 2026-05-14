import { describe, expect, it, vi } from "vitest";

import { createTavernClient } from "../index.js";

const baseUrl = "http://localhost:3000";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

const derivedOutputPayload = {
  account_id: "acc-owner",
  created_at: 10,
  domain: "analysis.summary",
  id: "dout-1",
  owner_account_id: "acc-deriver",
  project_id: "proj-1",
  source_floor_id: "floor-1",
  source_page_id: "page-1",
  source_session_id: "sess-1",
  status: "published",
  updated_at: 20,
  value: { score: 1 },
  workspace_id: "ws-1",
};

describe("sdk project derived output resources", () => {
  it("lists and maps derived outputs with snake_case query fields", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      items: [derivedOutputPayload],
      next_cursor: "next-derived",
    }));
    const client = createTavernClient({ baseUrl, fetchImpl });

    const result = await client.projects.derivedOutputs.list("proj-1", {
      accountId: "acc-1",
      cursor: "cursor-1",
      domain: "analysis.summary",
      limit: 2,
      ownerAccountId: "acc-deriver",
      sourceSessionId: "sess-1",
      status: "published",
    });

    expect(result).toEqual({
      items: [{
        accountId: "acc-owner",
        createdAt: 10,
        domain: "analysis.summary",
        id: "dout-1",
        ownerAccountId: "acc-deriver",
        projectId: "proj-1",
        sourceFloorId: "floor-1",
        sourcePageId: "page-1",
        sourceSessionId: "sess-1",
        status: "published",
        updatedAt: 20,
        value: { score: 1 },
        workspaceId: "ws-1",
      }],
      nextCursor: "next-derived",
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("http://localhost:3000/projects/proj-1/derived-outputs?domain=analysis.summary&status=published&source_session_id=sess-1&owner_account_id=acc-deriver&limit=2&cursor=cursor-1");
    expect(init?.method).toBe("GET");
    expect((init?.headers as Headers).get("x-account-id")).toBe("acc-1");
  });

  it("gets, creates, updates and archives derived outputs", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ item: derivedOutputPayload }))
      .mockResolvedValueOnce(jsonResponse({ item: { ...derivedOutputPayload, id: "dout-created", status: "draft" } }, 201))
      .mockResolvedValueOnce(jsonResponse({ item: { ...derivedOutputPayload, value: { score: 2 } } }))
      .mockResolvedValueOnce(jsonResponse({ item: { ...derivedOutputPayload, status: "archived" } }));
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.projects.derivedOutputs.get("proj-1", "dout-1", { accountId: "acc-1" }))
      .resolves.toMatchObject({ id: "dout-1", ownerAccountId: "acc-deriver" });
    await expect(client.projects.derivedOutputs.create("proj-1", {
      domain: "analysis.summary",
      sourceSessionId: "sess-1",
      value: { score: 1 },
      status: "draft",
    }, { accountId: "acc-1" })).resolves.toMatchObject({ id: "dout-created", status: "draft" });
    await expect(client.projects.derivedOutputs.update("proj-1", "dout-1", {
      value: { score: 2 },
      status: "published",
    }, { accountId: "acc-1" })).resolves.toMatchObject({ value: { score: 2 } });
    await expect(client.projects.derivedOutputs.archive("proj-1", "dout-1", { accountId: "acc-1" }))
      .resolves.toMatchObject({ status: "archived" });

    expect(String(fetchImpl.mock.calls[0]![0])).toBe("http://localhost:3000/projects/proj-1/derived-outputs/dout-1");
    expect(fetchImpl.mock.calls[1]![1]?.body).toBe(JSON.stringify({
      domain: "analysis.summary",
      source_session_id: "sess-1",
      value: { score: 1 },
      status: "draft",
    }));
    expect(fetchImpl.mock.calls[2]![1]?.method).toBe("PATCH");
    expect(fetchImpl.mock.calls[2]![1]?.body).toBe(JSON.stringify({ value: { score: 2 }, status: "published" }));
    expect(fetchImpl.mock.calls[3]![1]?.method).toBe("DELETE");
  });
});
