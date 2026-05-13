import { describe, expect, it, vi } from "vitest";

import { createTavernClient } from "../index.js";

const baseUrl = "http://localhost:3000";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  }), {
    headers: { "content-type": "text/event-stream" },
    status: 200,
  });
}

const projectPayload = {
  account_id: "acc-owner",
  created_at: 10,
  description: "Project description",
  id: "proj-1",
  kind: "session_default",
  name: "Project A",
  role: "observer",
  settings_override: { model: "test" },
  status: "active",
  updated_at: 20,
  workspace_id: "ws-1",
};

const eventPayload = {
  actor_account_id: "acc-owner",
  branch_id: "main",
  causation_event_id: null,
  correlation_id: "corr-1",
  created_at: 30,
  floor_id: "floor-1",
  id: "evt-1",
  message_id: "msg-1",
  operation_log_id: "op-1",
  page_id: "page-1",
  payload: { status: "active" },
  project_id: "proj-1",
  sequence: 7,
  session_id: "sess-1",
  source: "api",
  type: "session.updated",
  visibility: "project",
  workspace_id: "ws-1",
};

const memberPayload = {
  account_id: "acc-observer",
  created_at: 40,
  created_by_account_id: "acc-owner",
  id: "pmem-1",
  project_id: "proj-1",
  role: "observer",
  status: "active",
  updated_at: 50,
  workspace_id: "ws-1",
};

describe("sdk project resources", () => {
  it("lists accessible projects and maps snake_case payloads", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      items: [projectPayload, { ...projectPayload, id: "invalid", role: "reader" }],
      next_cursor: "next-page",
    }));
    const client = createTavernClient({ baseUrl, fetchImpl });

    const result = await client.projects.list({
      accountId: "acc-1",
      cursor: "cursor-1",
      limit: 2,
      role: "observer",
      status: "active",
    });

    expect(result).toEqual({
      items: [{
        accountId: "acc-owner",
        createdAt: 10,
        description: "Project description",
        id: "proj-1",
        kind: "session_default",
        name: "Project A",
        role: "observer",
        settingsOverride: { model: "test" },
        status: "active",
        updatedAt: 20,
        workspaceId: "ws-1",
      }],
      nextCursor: "next-page",
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("http://localhost:3000/projects?role=observer&status=active&limit=2&cursor=cursor-1");
    expect(init?.method).toBe("GET");
    expect((init?.headers as Headers).get("x-account-id")).toBe("acc-1");
  });

  it("lists project events with type and session filters", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      has_more: false,
      items: [eventPayload],
      next_after: 7,
    }));
    const client = createTavernClient({ baseUrl, fetchImpl });

    const result = await client.projects.listEvents({
      after: 5,
      limit: 50,
      projectId: "proj-1",
      sessionId: "sess-1",
      types: ["session.updated", "message.created"],
    });

    expect(result).toEqual({
      hasMore: false,
      items: [{
        actorAccountId: "acc-owner",
        branchId: "main",
        causationEventId: null,
        correlationId: "corr-1",
        createdAt: 30,
        floorId: "floor-1",
        id: "evt-1",
        messageId: "msg-1",
        operationLogId: "op-1",
        pageId: "page-1",
        payload: { status: "active" },
        projectId: "proj-1",
        sequence: 7,
        sessionId: "sess-1",
        source: "api",
        type: "session.updated",
        visibility: "project",
        workspaceId: "ws-1",
      }],
      nextAfter: 7,
    });

    const [url] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("http://localhost:3000/projects/proj-1/events?after=5&types=session.updated%2Cmessage.created&session_id=sess-1&limit=50");
  });

  it("streams project events, heartbeats, and Last-Event-ID", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(sseResponse([
      ": heartbeat\n\n",
      `id: 7\nevent: session.updated\ndata: ${JSON.stringify(eventPayload)}\n\n`,
    ]));
    const client = createTavernClient({ baseUrl, fetchImpl });
    const onEvent = vi.fn();
    const onHeartbeat = vi.fn();

    await client.projects.streamEvents({
      accountId: "acc-1",
      lastEventId: 6,
      onEvent,
      onHeartbeat,
      projectId: "proj-1",
      sessionId: "sess-1",
      types: "session.updated",
    });

    expect(onHeartbeat).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
      id: "evt-1",
      projectId: "proj-1",
      sequence: 7,
      type: "session.updated",
    }));

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("http://localhost:3000/projects/proj-1/events/stream?types=session.updated&session_id=sess-1");
    expect(init?.method).toBe("GET");
    expect((init?.headers as Headers).get("Last-Event-ID")).toBe("6");
    expect((init?.headers as Headers).get("x-account-id")).toBe("acc-1");
  });

  it("adds and removes observer members", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ item: memberPayload }, 201))
      .mockResolvedValueOnce(jsonResponse({ item: { ...memberPayload, status: "removed" } }));
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.projects.addObserver({
      accountId: "acc-owner",
      observerAccountId: "acc-observer",
      projectId: "proj-1",
    })).resolves.toMatchObject({
      accountId: "acc-observer",
      projectId: "proj-1",
      role: "observer",
      status: "active",
    });

    await expect(client.projects.removeMember({
      accountId: "acc-owner",
      memberAccountId: "acc-observer",
      projectId: "proj-1",
    })).resolves.toMatchObject({
      accountId: "acc-observer",
      projectId: "proj-1",
      role: "observer",
      status: "removed",
    });

    const [addUrl, addInit] = fetchImpl.mock.calls[0]!;
    expect(String(addUrl)).toBe("http://localhost:3000/projects/proj-1/members");
    expect(addInit?.method).toBe("POST");
    expect(addInit?.body).toBe(JSON.stringify({ account_id: "acc-observer", role: "observer" }));

    const [removeUrl, removeInit] = fetchImpl.mock.calls[1]!;
    expect(String(removeUrl)).toBe("http://localhost:3000/projects/proj-1/members/acc-observer");
    expect(removeInit?.method).toBe("DELETE");
  });

  it("reads session scope", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      project_id: "proj-1",
      session_id: "sess-1",
      workspace_id: "ws-1",
    }));
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.sessions.getScope({
      accountId: "acc-1",
      sessionId: "sess-1",
    })).resolves.toEqual({
      projectId: "proj-1",
      sessionId: "sess-1",
      workspaceId: "ws-1",
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("http://localhost:3000/sessions/sess-1/scope");
    expect(init?.method).toBe("GET");
    expect((init?.headers as Headers).get("x-account-id")).toBe("acc-1");
  });
});
