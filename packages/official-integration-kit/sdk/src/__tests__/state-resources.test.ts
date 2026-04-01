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

  it("supports branch variable writes and branch-scoped list filters", async () => {
    const branchPayload = {
      id: "var-branch-1",
      key: "route",
      scope: "branch",
      scope_id: "branch:session-1:alt-1",
      scope_ref: {
        session_id: "session-1",
        branch_id: "alt-1",
      },
      updated_at: 210,
      value: "campfire",
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: branchPayload }, 201))
      .mockResolvedValueOnce(jsonResponse({ data: [branchPayload] }));

    const transport = createTransportClient({ baseUrl, fetchImpl });
    const variables = createVariablesResource(transport);

    await expect(
      variables.upsert({
        key: "route",
        scope: "branch",
        sessionId: "session-1",
        branchId: "alt-1",
        value: "campfire",
      }),
    ).resolves.toEqual({
      id: "var-branch-1",
      key: "route",
      scope: "branch",
      scopeId: "branch:session-1:alt-1",
      scopeRef: { sessionId: "session-1", branchId: "alt-1" },
      updatedAt: 210,
      value: "campfire",
    });

    await expect(variables.list({ scope: "branch", sessionId: "session-1", branchId: "alt-1" })).resolves.toEqual([
      {
        id: "var-branch-1",
        key: "route",
        scope: "branch",
        scopeId: "branch:session-1:alt-1",
        scopeRef: { sessionId: "session-1", branchId: "alt-1" },
        updatedAt: 210,
        value: "campfire",
      },
    ]);

    const [, upsertInit] = fetchImpl.mock.calls[0]!;
    const [listUrl] = fetchImpl.mock.calls[1]!;
    expect(upsertInit?.body).toBe(JSON.stringify({
      key: "route",
      scope: "branch",
      session_id: "session-1",
      branch_id: "alt-1",
      value: "campfire",
    }));
    const listRequestUrl = new URL(listUrl as string);
    expect(listRequestUrl.searchParams.get("scope")).toBe("branch");
    expect(listRequestUrl.searchParams.get("session_id")).toBe("session-1");
    expect(listRequestUrl.searchParams.get("branch_id")).toBe("alt-1");
  });

  it("resolves variable snapshots and keeps default list sorting aligned", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            context: {
              account_id: "acc-1",
              session_id: "session-1",
              branch_id: "alt-1",
              floor_id: "floor-1",
              page_id: "page-1",
              global_scope_id: "global",
            },
            resolved: [
              {
                key: "route",
                value: "campfire",
                source_scope: "branch",
                source_scope_id: "branch:session-1:alt-1",
                source_scope_ref: { session_id: "session-1", branch_id: "alt-1" },
                updated_at: 250,
              },
              {
                key: "hp",
                value: 95,
                source_scope: "page",
                source_scope_id: "page-1",
                updated_at: 300,
              },
              {
                key: "mood",
                value: "steady",
                source_scope: "floor",
                source_scope_id: "floor-1",
                updated_at: 200,
              },
            ],
            layers: {
              global: {
                scope: "global",
                scope_id: "global",
                items: [
                  {
                    id: "var-global-theme",
                    key: "theme",
                    scope: "global",
                    scope_id: "global",
                    updated_at: 100,
                    value: "midnight",
                  },
                ],
              },
              branch: {
                scope: "branch",
                scope_id: "branch:session-1:alt-1",
                scope_ref: {
                  session_id: "session-1",
                  branch_id: "alt-1",
                },
                items: [
                  {
                    id: "var-branch-route",
                    key: "route",
                    scope: "branch",
                    scope_id: "branch:session-1:alt-1",
                    scope_ref: { session_id: "session-1", branch_id: "alt-1" },
                    updated_at: 250,
                    value: "campfire",
                  },
                ],
              },
              floor: {
                scope: "floor",
                scope_id: "floor-1",
                items: [
                  {
                    id: "var-floor-mood",
                    key: "mood",
                    scope: "floor",
                    scope_id: "floor-1",
                    updated_at: 200,
                    value: "steady",
                  },
                ],
              },
            },
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [] }));

    const transport = createTransportClient({ baseUrl, fetchImpl });
    const variables = createVariablesResource(transport);

    await expect(
      variables.resolveContext({
        accountId: "acc-1",
        floorId: "floor-1",
        branchId: "alt-1",
        includeLayers: true,
        pageId: "page-1",
        sessionId: "session-1",
      }),
    ).resolves.toEqual({
      context: {
        accountId: "acc-1",
        branchId: "alt-1",
        floorId: "floor-1",
        globalScopeId: "global",
        pageId: "page-1",
        sessionId: "session-1",
      },
      layers: {
        branch: {
          items: [
            {
              id: "var-branch-route",
              key: "route",
              scope: "branch",
              scopeId: "branch:session-1:alt-1",
              scopeRef: { sessionId: "session-1", branchId: "alt-1" },
              updatedAt: 250,
              value: "campfire",
            },
          ],
          scope: "branch",
          scopeId: "branch:session-1:alt-1",
          scopeRef: { sessionId: "session-1", branchId: "alt-1" },
        },
        floor: {
          items: [
            {
              id: "var-floor-mood",
              key: "mood",
              scope: "floor",
              scopeId: "floor-1",
              updatedAt: 200,
              value: "steady",
            },
          ],
          scope: "floor",
          scopeId: "floor-1",
        },
        global: {
          items: [
            {
              id: "var-global-theme",
              key: "theme",
              scope: "global",
              scopeId: "global",
              updatedAt: 100,
              value: "midnight",
            },
          ],
          scope: "global",
          scopeId: "global",
        },
      },
      resolved: [
        {
          key: "route",
          sourceScope: "branch",
          sourceScopeId: "branch:session-1:alt-1",
          sourceScopeRef: { sessionId: "session-1", branchId: "alt-1" },
          updatedAt: 250,
          value: "campfire",
        },
        {
          key: "hp",
          sourceScope: "page",
          sourceScopeId: "page-1",
          updatedAt: 300,
          value: 95,
        },
        {
          key: "mood",
          sourceScope: "floor",
          sourceScopeId: "floor-1",
          updatedAt: 200,
          value: "steady",
        },
      ],
    });

    await expect(variables.list({ accountId: "acc-1" })).resolves.toEqual([]);

    const [resolveUrl, resolveInit] = fetchImpl.mock.calls[0]!;
    const resolveRequestUrl = new URL(resolveUrl as string);
    expect(resolveRequestUrl.pathname).toBe("/variables/resolve");
    expect(resolveRequestUrl.searchParams.get("session_id")).toBe("session-1");
    expect(resolveRequestUrl.searchParams.get("branch_id")).toBe("alt-1");
    expect(resolveRequestUrl.searchParams.get("floor_id")).toBe("floor-1");
    expect(resolveRequestUrl.searchParams.get("page_id")).toBe("page-1");
    expect(resolveRequestUrl.searchParams.get("include_layers")).toBe("true");
    expect((resolveInit?.headers as Headers).get("x-account-id")).toBe("acc-1");

    const [listUrl] = fetchImpl.mock.calls[1]!;
    const listRequestUrl = new URL(listUrl as string);
    expect(listRequestUrl.pathname).toBe("/variables");
    expect(listRequestUrl.searchParams.get("sort_by")).toBe("updated_at");
    expect(listRequestUrl.searchParams.get("sort_order")).toBe("desc");
    expect(listRequestUrl.searchParams.get("limit")).toBe("100");
    expect(listRequestUrl.searchParams.get("offset")).toBe("0");
  });
});
