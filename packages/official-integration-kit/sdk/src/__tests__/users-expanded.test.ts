import { describe, expect, it, vi } from "vitest";

import { createTavernClient } from "../index.js";

const baseUrl = "http://localhost:3000";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("sdk users expanded resource", () => {
  it("lists users with filters", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [
          {
            created_at: 10,
            id: "user-1",
            name: "Alice",
            revision: 0,
            snapshot: { name: "Alice" },
            status: "active",
            updated_at: 11,
          },
        ],
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(
      client.users.list({
        includeDeleted: true,
        keyword: "Ali",
        sortBy: "name",
        status: "active",
      }),
    ).resolves.toEqual([
      {
        createdAt: 10,
        id: "user-1",
        name: "Alice",
        revision: 0,
        status: "active",
        updatedAt: 11,
      },
    ]);

    const [url] = fetchImpl.mock.calls[0]!;
    const requestUrl = new URL(url as string);
    expect(requestUrl.pathname).toBe("/users");
    expect(requestUrl.searchParams.get("include_deleted")).toBe("true");
    expect(requestUrl.searchParams.get("keyword")).toBe("Ali");
    expect(requestUrl.searchParams.get("sort_by")).toBe("name");
    expect(requestUrl.searchParams.get("status")).toBe("active");
  });

  it("gets and updates full user detail records", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            created_at: 10,
            id: "user-1",
            name: "Alice",
            revision: 0,
            snapshot: { description: "desc", name: "Alice" },
            status: "active",
            updated_at: 11,
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            created_at: 10,
            id: "user-1",
            name: "Alice 2",
            revision: 1,
            snapshot: { description: "changed", name: "Alice 2" },
            status: "disabled",
            updated_at: 12,
          },
        }),
      );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.users.getDetail({ userId: "user-1" })).resolves.toEqual({
      createdAt: 10,
      id: "user-1",
      name: "Alice",
      revision: 0,
      snapshot: { description: "desc", name: "Alice" },
      status: "active",
      updatedAt: 11,
    });

    await expect(
      client.users.update({
        expectedRevision: 0,
        snapshot: { description: "changed", name: "Alice 2" },
        status: "disabled",
        userId: "user-1",
      }),
    ).resolves.toEqual({
      createdAt: 10,
      id: "user-1",
      name: "Alice 2",
      revision: 1,
      snapshot: { description: "changed", name: "Alice 2" },
      status: "disabled",
      updatedAt: 12,
    });

    const [, init] = fetchImpl.mock.calls[1]!;
    expect(init?.body).toBe(JSON.stringify({
      expected_revision: 0,
      snapshot: { description: "changed", name: "Alice 2" },
      status: "disabled",
    }));
  });

  it("removes users and maps batch results", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            deleted: true,
            id: "user-1",
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            meta: {
              not_found: 1,
              status: "disabled",
              total: 2,
              updated: 1,
            },
            results: [
              { action: "updated", id: "user-1", index: 0 },
              { action: "not_found", id: "user-2", index: 1 },
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
              { action: "deleted", id: "user-1", index: 0 },
              { action: "not_found", id: "user-2", index: 1 },
            ],
          },
        }),
      );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.users.remove({ userId: "user-1", expectedRevision: 3 })).resolves.toBe(true);

    const [removeUrl, removeInit] = fetchImpl.mock.calls[0]!;
    expect(removeUrl).toBe("http://localhost:3000/users/user-1");
    expect(removeInit?.body).toBe(JSON.stringify({ expected_revision: 3 }));

    await expect(
      client.users.batchUpdateStatus({
        ids: ["user-1", "user-2"],
        status: "disabled",
      }),
    ).resolves.toEqual({
      meta: {
        notFound: 1,
        status: "disabled",
        total: 2,
        updated: 1,
      },
      results: [
        { action: "updated", id: "user-1", index: 0 },
        { action: "not_found", id: "user-2", index: 1 },
      ],
    });

    await expect(client.users.batchDelete({ ids: ["user-1", "user-2"] })).resolves.toEqual({
      meta: {
        deleted: 1,
        notFound: 1,
        total: 2,
      },
      results: [
        { action: "deleted", id: "user-1", index: 0 },
        { action: "not_found", id: "user-2", index: 1 },
      ],
    });
  });
});
