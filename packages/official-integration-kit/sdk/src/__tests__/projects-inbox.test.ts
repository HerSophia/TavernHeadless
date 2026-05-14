import { describe, expect, it, vi } from "vitest";

import { createTavernClient } from "../index.js";

const baseUrl = "http://localhost:3000";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

const inboxPayload = {
  account_id: "acc-owner",
  created_at: 10,
  decided_at: null,
  decided_by_account_id: null,
  id: "pinbox-1",
  payload: { proposal: true },
  project_id: "proj-1",
  sender_account_id: "acc-deriver",
  source_event_id: "evt-1",
  source_floor_id: "floor-1",
  source_page_id: "page-1",
  source_session_id: "sess-1",
  status: "pending",
  title: "Proposal",
  type: "world.summary",
  updated_at: 20,
  workspace_id: "ws-1",
};

const deriverMemberPayload = {
  account_id: "acc-deriver",
  created_at: 30,
  created_by_account_id: "acc-owner",
  id: "pmem-deriver",
  project_id: "proj-1",
  role: "deriver",
  status: "active",
  updated_at: 40,
  workspace_id: "ws-1",
};

describe("sdk project inbox resources", () => {
  it("lists, maps and creates inbox items", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ items: [inboxPayload], next_cursor: "next-inbox" }))
      .mockResolvedValueOnce(jsonResponse({ item: inboxPayload }, 201));
    const client = createTavernClient({ baseUrl, fetchImpl });

    const listResult = await client.projects.inbox.list("proj-1", {
      accountId: "acc-1",
      cursor: "cursor-1",
      limit: 2,
      senderAccountId: "acc-deriver",
      sourceSessionId: "sess-1",
      status: "pending",
      type: "world.summary",
    });
    expect(listResult).toEqual({
      items: [{
        accountId: "acc-owner",
        createdAt: 10,
        decidedAt: null,
        decidedByAccountId: null,
        id: "pinbox-1",
        payload: { proposal: true },
        projectId: "proj-1",
        senderAccountId: "acc-deriver",
        sourceEventId: "evt-1",
        sourceFloorId: "floor-1",
        sourcePageId: "page-1",
        sourceSessionId: "sess-1",
        status: "pending",
        title: "Proposal",
        type: "world.summary",
        updatedAt: 20,
        workspaceId: "ws-1",
      }],
      nextCursor: "next-inbox",
    });

    const created = await client.projects.inbox.create("proj-1", {
      type: "world.summary",
      title: "Proposal",
      payload: { proposal: true },
      sourceEventId: "evt-1",
      sourceSessionId: "sess-1",
    }, { accountId: "acc-1" });
    expect(created).toMatchObject({ id: "pinbox-1", senderAccountId: "acc-deriver" });

    expect(String(fetchImpl.mock.calls[0]![0])).toBe("http://localhost:3000/projects/proj-1/inbox?status=pending&type=world.summary&sender_account_id=acc-deriver&source_session_id=sess-1&limit=2&cursor=cursor-1");
    expect((fetchImpl.mock.calls[0]![1]?.headers as Headers).get("x-account-id")).toBe("acc-1");
    expect(fetchImpl.mock.calls[1]![1]?.body).toBe(JSON.stringify({
      type: "world.summary",
      title: "Proposal",
      payload: { proposal: true },
      source_event_id: "evt-1",
      source_session_id: "sess-1",
    }));
  });

  it("gets and decides inbox items with action helpers", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ item: inboxPayload }))
      .mockResolvedValueOnce(jsonResponse({ item: { ...inboxPayload, status: "accepted", decided_by_account_id: "acc-owner", decided_at: 50 } }))
      .mockResolvedValueOnce(jsonResponse({ item: { ...inboxPayload, status: "rejected", decided_by_account_id: "acc-owner", decided_at: 60 } }))
      .mockResolvedValueOnce(jsonResponse({ item: { ...inboxPayload, status: "archived", decided_by_account_id: "acc-owner", decided_at: 70 } }));
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.projects.inbox.get("proj-1", "pinbox-1", { accountId: "acc-1" }))
      .resolves.toMatchObject({ id: "pinbox-1" });
    await expect(client.projects.inbox.accept("proj-1", "pinbox-1", { accountId: "acc-1", note: "ok" }))
      .resolves.toMatchObject({ status: "accepted", decidedByAccountId: "acc-owner" });
    await expect(client.projects.inbox.reject("proj-1", "pinbox-1", { accountId: "acc-1" }))
      .resolves.toMatchObject({ status: "rejected" });
    await expect(client.projects.inbox.archive("proj-1", "pinbox-1", { accountId: "acc-1" }))
      .resolves.toMatchObject({ status: "archived" });

    expect(fetchImpl.mock.calls[1]![1]?.body).toBe(JSON.stringify({ decision: "accept", note: "ok" }));
    expect(fetchImpl.mock.calls[2]![1]?.body).toBe(JSON.stringify({ decision: "reject" }));
    expect(fetchImpl.mock.calls[3]![1]?.body).toBe(JSON.stringify({ decision: "archive" }));
    expect(fetchImpl.mock.calls.slice(1).every(([, init]) => init?.method === "PATCH")).toBe(true);
  });

  it("adds deriver members through generic and convenience methods", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ item: deriverMemberPayload }, 201))
      .mockResolvedValueOnce(jsonResponse({ item: deriverMemberPayload }, 201));
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.projects.addMember("proj-1", { accountId: "acc-deriver", role: "deriver" }, { accountId: "acc-owner" }))
      .resolves.toMatchObject({ accountId: "acc-deriver", role: "deriver" });
    await expect(client.projects.addDeriver("proj-1", "acc-deriver", { accountId: "acc-owner" }))
      .resolves.toMatchObject({ accountId: "acc-deriver", role: "deriver" });

    expect(String(fetchImpl.mock.calls[0]![0])).toBe("http://localhost:3000/projects/proj-1/members");
    expect(fetchImpl.mock.calls[0]![1]?.body).toBe(JSON.stringify({ account_id: "acc-deriver", role: "deriver" }));
    expect(fetchImpl.mock.calls[1]![1]?.body).toBe(JSON.stringify({ account_id: "acc-deriver", role: "deriver" }));
  });
});
