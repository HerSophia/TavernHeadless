import { describe, expect, it, vi } from "vitest";

import { createAccountsResource } from "../resources/accounts.js";
import { createVariablesResource } from "../resources/variables.js";
import { createTransportClient } from "../client/transport.js";

const baseUrl = "http://localhost:3000";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("sdk state resources", () => {
  it("lists, creates, gets, updates, and removes accounts", async () => {
    const accountPayload = {
      created_at: 100,
      id: "acc-1",
      is_default: false,
      name: "Workspace A",
      role: "user",
      status: "active",
      updated_at: 101,
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: [null, accountPayload] }))
      .mockResolvedValueOnce(jsonResponse({ data: accountPayload }, 201))
      .mockResolvedValueOnce(jsonResponse({ data: accountPayload }))
      .mockResolvedValueOnce(jsonResponse({ data: { ...accountPayload, name: "Workspace B", status: "disabled" } }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: "acc-1", deleted: true } }));

    const transport = createTransportClient({ baseUrl, fetchImpl });
    const accounts = createAccountsResource(transport);

    await expect(accounts.list()).resolves.toEqual([
      {
        createdAt: 100,
        id: "acc-1",
        isDefault: false,
        name: "Workspace A",
        role: "user",
        status: "active",
        updatedAt: 101,
      },
    ]);

    await expect(
      accounts.create({
        id: "acc-1",
        name: "Workspace A",
        role: "user",
      }),
    ).resolves.toEqual({
      createdAt: 100,
      id: "acc-1",
      isDefault: false,
      name: "Workspace A",
      role: "user",
      status: "active",
      updatedAt: 101,
    });

    await expect(accounts.getDetail({ accountRecordId: "acc-1" })).resolves.toEqual({
      createdAt: 100,
      id: "acc-1",
      isDefault: false,
      name: "Workspace A",
      role: "user",
      status: "active",
      updatedAt: 101,
    });

    await expect(
      accounts.update({
        accountRecordId: "acc-1",
        name: "Workspace B",
        status: "disabled",
      }),
    ).resolves.toEqual({
      createdAt: 100,
      id: "acc-1",
      isDefault: false,
      name: "Workspace B",
      role: "user",
      status: "disabled",
      updatedAt: 101,
    });

    await expect(accounts.remove({ accountRecordId: "acc-1" })).resolves.toBe(true);

    const [, createInit] = fetchImpl.mock.calls[1]!;
    const [, updateInit] = fetchImpl.mock.calls[3]!;

    expect(createInit?.body).toBe(JSON.stringify({
      id: "acc-1",
      name: "Workspace A",
      role: "user",
    }));
    expect(updateInit?.body).toBe(JSON.stringify({
      name: "Workspace B",
      status: "disabled",
    }));
  });

  it("upserts, batch upserts, lists, gets, and removes variables", async () => {
    const variablePayload = {
      id: "var-1",
      key: "mood",
      scope: "chat",
      scope_id: "session-1",
      updated_at: 200,
      value: { score: 20 },
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: variablePayload }, 201))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            meta: {
              created: 1,
              total: 2,
              updated: 1,
            },
            results: [
              {
                action: "updated",
                data: variablePayload,
                index: 0,
              },
              {
                action: "created",
                data: {
                  id: "var-2",
                  key: "topic",
                  scope: "chat",
                  scope_id: "session-1",
                  updated_at: 201,
                  value: "campfire",
                },
                index: 1,
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [null, variablePayload] }))
      .mockResolvedValueOnce(jsonResponse({ data: variablePayload }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: "var-1", deleted: true } }));

    const transport = createTransportClient({ baseUrl, fetchImpl });
    const variables = createVariablesResource(transport);

    await expect(
      variables.upsert({
        key: "mood",
        scope: "chat",
        scopeId: "session-1",
        value: { score: 20 },
      }),
    ).resolves.toEqual({
      id: "var-1",
      key: "mood",
      scope: "chat",
      scopeId: "session-1",
      updatedAt: 200,
      value: { score: 20 },
    });

    await expect(
      variables.upsertMany({
        items: [
          {
            key: "mood",
            scope: "chat",
            scopeId: "session-1",
            value: { score: 20 },
          },
          {
            key: "topic",
            scope: "chat",
            scopeId: "session-1",
            value: "campfire",
          },
        ],
      }),
    ).resolves.toEqual({
      meta: {
        created: 1,
        total: 2,
        updated: 1,
      },
      results: [
        {
          action: "updated",
          data: {
            id: "var-1",
            key: "mood",
            scope: "chat",
            scopeId: "session-1",
            updatedAt: 200,
            value: { score: 20 },
          },
          index: 0,
        },
        {
          action: "created",
          data: {
            id: "var-2",
            key: "topic",
            scope: "chat",
            scopeId: "session-1",
            updatedAt: 201,
            value: "campfire",
          },
          index: 1,
        },
      ],
    });

    await expect(
      variables.list({
        key: "mood",
        limit: 10,
        offset: 1,
        scope: "chat",
        scopeId: "session-1",
        sortBy: "key",
        sortOrder: "asc",
      }),
    ).resolves.toEqual([
      {
        id: "var-1",
        key: "mood",
        scope: "chat",
        scopeId: "session-1",
        updatedAt: 200,
        value: { score: 20 },
      },
    ]);

    await expect(variables.getDetail({ variableId: "var-1" })).resolves.toEqual({
      id: "var-1",
      key: "mood",
      scope: "chat",
      scopeId: "session-1",
      updatedAt: 200,
      value: { score: 20 },
    });

    await expect(variables.remove({ variableId: "var-1" })).resolves.toBe(true);

    const [, upsertInit] = fetchImpl.mock.calls[0]!;
    const [, batchUpsertInit] = fetchImpl.mock.calls[1]!;
    const [listUrl] = fetchImpl.mock.calls[2]!;

    expect(upsertInit?.body).toBe(JSON.stringify({
      key: "mood",
      scope: "chat",
      scope_id: "session-1",
      value: { score: 20 },
    }));
    expect(batchUpsertInit?.body).toBe(JSON.stringify({
      items: [
        {
          key: "mood",
          scope: "chat",
          scope_id: "session-1",
          value: { score: 20 },
        },
        {
          key: "topic",
          scope: "chat",
          scope_id: "session-1",
          value: "campfire",
        },
      ],
    }));

    const requestUrl = new URL(listUrl as string);
    expect(requestUrl.pathname).toBe("/variables");
    expect(requestUrl.searchParams.get("key")).toBe("mood");
    expect(requestUrl.searchParams.get("scope")).toBe("chat");
    expect(requestUrl.searchParams.get("scope_id")).toBe("session-1");
    expect(requestUrl.searchParams.get("sort_by")).toBe("key");
    expect(requestUrl.searchParams.get("sort_order")).toBe("asc");
    expect(requestUrl.searchParams.get("limit")).toBe("10");
    expect(requestUrl.searchParams.get("offset")).toBe("1");
  });
});
