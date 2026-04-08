import { describe, expect, it, vi } from "vitest";

import { createTavernClient } from "../index.js";

const baseUrl = "http://localhost:3000";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("sdk client data resource", () => {
  it("lists domains and maps meta to camelCase", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [
          {
            id: "domain-1",
            owner_type: "application",
            owner_id: "app-1",
            domain_name: "preferences",
            display_name: "Preferences",
            description: "Client preferences",
            status: "active",
            quota_max_entries: 100,
            quota_max_bytes: 2048,
            current_entry_count: 1,
            current_byte_count: 128,
            created_at: 10,
            updated_at: 11,
            deleted_at: null,
          },
        ],
        meta: {
          total: 1,
          limit: 20,
          offset: 0,
          has_more: false,
          sort_by: "updated_at",
          sort_order: "desc",
        },
      }),
    );

    const client = createTavernClient({ baseUrl, fetchImpl });
    const result = await client.clientData.domains.list({
      accountId: "acc-1",
      limit: 20,
      offset: 0,
      sortBy: "updated_at",
      sortOrder: "desc",
    });

    expect(result).toEqual({
      data: [
        {
          id: "domain-1",
          ownerType: "application",
          ownerId: "app-1",
          domainName: "preferences",
          displayName: "Preferences",
          description: "Client preferences",
          status: "active",
          quotaMaxEntries: 100,
          quotaMaxBytes: 2048,
          currentEntryCount: 1,
          currentByteCount: 128,
          createdAt: 10,
          updatedAt: 11,
          deletedAt: null,
        },
      ],
      meta: {
        total: 1,
        limit: 20,
        offset: 0,
        hasMore: false,
        sortBy: "updated_at",
        sortOrder: "desc",
      },
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("http://localhost:3000/client-data/domains?limit=20&offset=0&sort_by=updated_at&sort_order=desc");
    expect(init?.method).toBe("GET");
    expect((init?.headers as Headers).get("x-account-id")).toBe("acc-1");
  });

  it("creates an item with snake_case request body and maps nested payload", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          action: "created",
          collection: {
            id: "collection-1",
            domain_id: "domain-1",
            collection_name: "settings",
            description: null,
            default_expires_ttl_ms: null,
            max_item_size_bytes: 1024,
            metadata_json: { source: "client" },
            item_count: 1,
            byte_count: 16,
            created_at: 20,
            updated_at: 21,
          },
          item: {
            id: "item-1",
            domain_id: "domain-1",
            collection_id: "collection-1",
            item_key: "theme",
            value_json: { mode: "dark" },
            byte_size: 16,
            version: 1,
            expires_at: null,
            created_at: 20,
            updated_at: 21,
          },
        },
      }),
    );

    const client = createTavernClient({ baseUrl, fetchImpl });
    const result = await client.clientData.items.upsert({
      accountId: "acc-1",
      domainId: "domain-1",
      collectionName: "settings",
      itemKey: "theme",
      valueJson: { mode: "dark" },
      ifVersion: 1,
    });

    expect(result).toEqual({
      action: "created",
      collection: {
        id: "collection-1",
        domainId: "domain-1",
        collectionName: "settings",
        description: null,
        defaultExpiresTtlMs: null,
        maxItemSizeBytes: 1024,
        metadataJson: { source: "client" },
        itemCount: 1,
        byteCount: 16,
        createdAt: 20,
        updatedAt: 21,
      },
      item: {
        id: "item-1",
        domainId: "domain-1",
        collectionId: "collection-1",
        itemKey: "theme",
        valueJson: { mode: "dark" },
        byteSize: 16,
        version: 1,
        expiresAt: null,
        createdAt: 20,
        updatedAt: 21,
      },
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("http://localhost:3000/client-data/domains/domain-1/items");
    expect(init?.method).toBe("PUT");
    expect(init?.body).toBe(JSON.stringify({
      collection_name: "settings",
      item_key: "theme",
      value_json: { mode: "dark" },
      if_version: 1,
    }));
  });

  it("mounts clientData on createTavernClient", () => {
    const client = createTavernClient({
      baseUrl,
      fetchImpl: vi.fn<typeof fetch>(),
    });

    expect(client.clientData).toBeDefined();
    expect(typeof client.clientData.domains.list).toBe("function");
    expect(typeof client.clientData.collections.create).toBe("function");
    expect(typeof client.clientData.items.upsertBatch).toBe("function");
  });
});
