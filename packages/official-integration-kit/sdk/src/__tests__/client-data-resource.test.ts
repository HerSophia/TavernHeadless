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
            version: 3,
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
          version: 3,
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

  it("maps domain detail restorableUntil and version fields", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          id: "domain-1",
          owner_type: "plugin",
          owner_id: "plugin-1",
          domain_name: "cache",
          display_name: null,
          description: null,
          status: "deleted",
          version: 4,
          quota_max_entries: 100,
          quota_max_bytes: 2048,
          current_entry_count: 2,
          current_byte_count: 256,
          created_at: 10,
          updated_at: 20,
          deleted_at: 30,
          quota_usage: {
            entry_count: 2,
            byte_count: 256,
          },
          restorable_until: 40,
        },
      }),
    );

    const client = createTavernClient({ baseUrl, fetchImpl });
    const result = await client.clientData.domains.getDetail({
      accountId: "acc-1",
      domainId: "domain-1",
    });

    expect(result).toEqual({
      id: "domain-1",
      ownerType: "plugin",
      ownerId: "plugin-1",
      domainName: "cache",
      displayName: null,
      description: null,
      status: "deleted",
      version: 4,
      quotaMaxEntries: 100,
      quotaMaxBytes: 2048,
      currentEntryCount: 2,
      currentByteCount: 256,
      createdAt: 10,
      updatedAt: 20,
      deletedAt: 30,
      quotaUsage: {
        entryCount: 2,
        byteCount: 256,
      },
      restorableUntil: 40,
    });
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
            version: 1,
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
        version: 1,
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

  it("uses new list item filters with snake_case query parameters", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [],
        meta: {
          total: 0,
          limit: 5,
          offset: 10,
          has_more: false,
          sort_by: "updated_at",
          sort_order: "asc",
        },
      }),
    );

    const client = createTavernClient({ baseUrl, fetchImpl });
    await client.clientData.items.list({
      accountId: "acc-1",
      domainId: "domain-1",
      collectionId: "collection-1",
      itemKeyPrefix: "theme.",
      updatedAfter: 100,
      updatedBefore: 200,
      expiresAfter: 300,
      expiresBefore: 400,
      expired: false,
      limit: 5,
      offset: 10,
      sortBy: "updated_at",
      sortOrder: "asc",
    });

    const [url] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(
      "http://localhost:3000/client-data/domains/domain-1/items?collection_id=collection-1&item_key_prefix=theme.&updated_after=100&updated_before=200&expires_after=300&expires_before=400&expired=false&limit=5&offset=10&sort_by=updated_at&sort_order=asc",
    );
  });

  it("reads item by collection_name and item_key", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          id: "item-1",
          domain_id: "domain-1",
          collection_id: "collection-1",
          item_key: "theme",
          value_json: { mode: "dark" },
          byte_size: 16,
          version: 2,
          expires_at: null,
          created_at: 20,
          updated_at: 25,
        },
      }),
    );

    const client = createTavernClient({ baseUrl, fetchImpl });
    const result = await client.clientData.items.getByKey({
      accountId: "acc-1",
      domainId: "domain-1",
      collectionName: "settings",
      itemKey: "theme",
    });

    expect(result).toEqual({
      id: "item-1",
      domainId: "domain-1",
      collectionId: "collection-1",
      itemKey: "theme",
      valueJson: { mode: "dark" },
      byteSize: 16,
      version: 2,
      expiresAt: null,
      createdAt: 20,
      updatedAt: 25,
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("http://localhost:3000/client-data/domains/domain-1/items/by-key?collection_name=settings&item_key=theme");
    expect(init?.method).toBe("GET");
  });

  it("updates domain quota with snake_case request body", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          id: "domain-1",
          owner_type: "application",
          owner_id: "app-1",
          domain_name: "preferences",
          display_name: null,
          description: null,
          status: "active",
          version: 2,
          quota_max_entries: 200,
          quota_max_bytes: 4096,
          current_entry_count: 1,
          current_byte_count: 128,
          created_at: 10,
          updated_at: 11,
          deleted_at: null,
        },
      }),
    );

    const client = createTavernClient({ baseUrl, fetchImpl });
    const result = await client.clientData.domains.updateQuota({
      accountId: "acc-1",
      domainId: "domain-1",
      quotaMaxEntries: 200,
      quotaMaxBytes: 4096,
    });

    expect(result.version).toBe(2);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("http://localhost:3000/client-data/domains/domain-1/quota");
    expect(init?.method).toBe("PATCH");
    expect(init?.body).toBe(JSON.stringify({
      quota_max_entries: 200,
      quota_max_bytes: 4096,
    }));
  });

  it("restores a deleted domain", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          id: "domain-1",
          owner_type: "application",
          owner_id: "app-1",
          domain_name: "preferences",
          display_name: null,
          description: null,
          status: "active",
          version: 5,
          quota_max_entries: 100,
          quota_max_bytes: 2048,
          current_entry_count: 1,
          current_byte_count: 128,
          created_at: 10,
          updated_at: 11,
          deleted_at: null,
        },
      }),
    );

    const client = createTavernClient({ baseUrl, fetchImpl });
    const result = await client.clientData.domains.restore({
      accountId: "acc-1",
      domainId: "domain-1",
    });

    expect(result.status).toBe("active");
    expect(result.version).toBe(5);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("http://localhost:3000/client-data/domains/domain-1/restore");
    expect(init?.method).toBe("POST");
  });

  it("imports into an existing domain with snake_case request body", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          domain: {
            id: "domain-1",
            owner_type: "application",
            owner_id: "app-1",
            domain_name: "preferences",
            display_name: null,
            description: null,
            status: "active",
            version: 3,
            quota_max_entries: 100,
            quota_max_bytes: 2048,
            current_entry_count: 1,
            current_byte_count: 128,
            created_at: 10,
            updated_at: 11,
            deleted_at: null,
          },
          collections: [
            {
              id: "collection-1",
              domain_id: "domain-1",
              collection_name: "settings",
              description: null,
              default_expires_ttl_ms: null,
              max_item_size_bytes: null,
              version: 2,
              metadata_json: { source: "import" },
              item_count: 1,
              byte_count: 16,
              created_at: 10,
              updated_at: 11,
            },
          ],
          summary: {
            collections_created: 0,
            items_created: 0,
            items_updated: 1,
            items_skipped: 0,
            imported_item_count: 1,
            imported_byte_count: 16,
            conflict_policy: "overwrite",
          },
        },
      }),
    );

    const client = createTavernClient({ baseUrl, fetchImpl });
    const result = await client.clientData.domains.import({
      accountId: "acc-1",
      domainId: "domain-1",
      conflictPolicy: "overwrite",
      payload: {
        domain: {
          ownerType: "application",
          ownerId: "app-1",
          domainName: "preferences",
        },
        collections: [
          {
            collectionName: "settings",
            description: null,
            defaultExpiresTtlMs: null,
            maxItemSizeBytes: null,
            metadataJson: { source: "import" },
            items: [
              {
                itemKey: "theme",
                valueJson: { mode: "dark" },
                expiresAt: null,
              },
            ],
          },
        ],
      },
    });

    expect(result.summary.itemsUpdated).toBe(1);
    expect(result.summary.conflictPolicy).toBe("overwrite");

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("http://localhost:3000/client-data/domains/domain-1/import");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({
      conflict_policy: "overwrite",
      payload: {
        domain: {
          owner_type: "application",
          owner_id: "app-1",
          domain_name: "preferences",
        },
        collections: [
          {
            collection_name: "settings",
            description: null,
            default_expires_ttl_ms: null,
            max_item_size_bytes: null,
            metadata_json: { source: "import" },
            items: [
              {
                item_key: "theme",
                value_json: { mode: "dark" },
                expires_at: null,
              },
            ],
          },
        ],
      },
    }));
  });

  it("imports as new domain and maps summary to camelCase", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          domain: {
            id: "domain-2",
            owner_type: "application",
            owner_id: "app-2",
            domain_name: "backup",
            display_name: null,
            description: null,
            status: "active",
            version: 1,
            quota_max_entries: 100,
            quota_max_bytes: 2048,
            current_entry_count: 1,
            current_byte_count: 16,
            created_at: 10,
            updated_at: 11,
            deleted_at: null,
          },
          collections: [],
          summary: {
            collections_created: 1,
            items_created: 1,
            items_updated: 0,
            items_skipped: 0,
            imported_item_count: 1,
            imported_byte_count: 16,
            conflict_policy: "fail",
          },
        },
      }, 201),
    );

    const client = createTavernClient({ baseUrl, fetchImpl });
    const result = await client.clientData.domains.importAsNew({
      accountId: "acc-1",
      conflictPolicy: "fail",
      payload: {
        domain: {
          ownerType: "application",
          ownerId: "app-2",
          domainName: "backup",
        },
        collections: [],
      },
    });

    expect(result.domain.id).toBe("domain-2");
    expect(result.summary.collectionsCreated).toBe(1);
    expect(result.summary.itemsCreated).toBe(1);
    expect(result.summary.conflictPolicy).toBe("fail");

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("http://localhost:3000/client-data/domains/import");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({
      conflict_policy: "fail",
      payload: {
        domain: {
          owner_type: "application",
          owner_id: "app-2",
          domain_name: "backup",
        },
        collections: [],
      },
    }));
  });

  it("adds caller owner headers to domain-scoped requests", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [],
        meta: {
          total: 0,
          limit: 10,
          offset: 0,
          has_more: false,
          sort_by: "updated_at",
          sort_order: "desc",
        },
      }),
    );

    const client = createTavernClient({ baseUrl, fetchImpl });
    await client.clientData.items.list({
      accountId: "acc-1",
      domainId: "domain-1",
      callerOwner: {
        ownerType: "plugin",
        ownerId: "chat-annotator",
      },
      limit: 10,
      offset: 0,
    });

    const [, init] = fetchImpl.mock.calls[0]!;
    expect((init?.headers as Headers).get("x-account-id")).toBe("acc-1");
    expect((init?.headers as Headers).get("x-client-owner-type")).toBe("plugin");
    expect((init?.headers as Headers).get("x-client-owner-id")).toBe("chat-annotator");
  });

  it("lists, creates, updates, and removes grants", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        data: [
          {
            id: "grant-1",
            domain_id: "domain-1",
            grantee_owner_type: "plugin",
            grantee_owner_id: "reader",
            can_read: true,
            can_write: false,
            can_delete: false,
            can_list: true,
            created_at: 10,
            updated_at: 11,
            expires_at: null,
          },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: "grant-2",
          domain_id: "domain-1",
          grantee_owner_type: "plugin",
          grantee_owner_id: "writer",
          can_read: true,
          can_write: true,
          can_delete: false,
          can_list: true,
          created_at: 20,
          updated_at: 21,
          expires_at: null,
        },
      }, 201))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: "grant-2",
          domain_id: "domain-1",
          grantee_owner_type: "plugin",
          grantee_owner_id: "writer",
          can_read: true,
          can_write: false,
          can_delete: false,
          can_list: true,
          created_at: 20,
          updated_at: 22,
          expires_at: null,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: "grant-2", deleted: true } }));

    const client = createTavernClient({ baseUrl, fetchImpl });
    const callerOwner = { ownerType: "plugin" as const, ownerId: "owner-plugin" };

    const listed = await client.clientData.grants.list({
      accountId: "acc-1",
      domainId: "domain-1",
      callerOwner,
    });
    expect(listed).toEqual([
      {
        id: "grant-1",
        domainId: "domain-1",
        granteeOwnerType: "plugin",
        granteeOwnerId: "reader",
        canRead: true,
        canWrite: false,
        canDelete: false,
        canList: true,
        createdAt: 10,
        updatedAt: 11,
        expiresAt: null,
      },
    ]);

    const created = await client.clientData.grants.create({
      accountId: "acc-1",
      domainId: "domain-1",
      callerOwner,
      granteeOwnerType: "plugin",
      granteeOwnerId: "writer",
      canRead: true,
      canWrite: true,
      canDelete: false,
      canList: true,
      expiresAt: null,
    });
    expect(created.canWrite).toBe(true);

    const updated = await client.clientData.grants.update({
      accountId: "acc-1",
      domainId: "domain-1",
      grantId: "grant-2",
      callerOwner,
      canWrite: false,
    });
    expect(updated.canWrite).toBe(false);

    const removed = await client.clientData.grants.remove({
      accountId: "acc-1",
      domainId: "domain-1",
      grantId: "grant-2",
      callerOwner,
    });
    expect(removed).toBe(true);

    const [, listInit] = fetchImpl.mock.calls[0]!;
    const [, createInit] = fetchImpl.mock.calls[1]!;
    const [, updateInit] = fetchImpl.mock.calls[2]!;
    const [, removeInit] = fetchImpl.mock.calls[3]!;
    expect((listInit?.headers as Headers).get("x-client-owner-id")).toBe("owner-plugin");
    expect(createInit?.body).toBe(JSON.stringify({
      grantee_owner_type: "plugin",
      grantee_owner_id: "writer",
      can_read: true,
      can_write: true,
      can_delete: false,
      can_list: true,
      expires_at: null,
    }));
    expect(updateInit?.body).toBe(JSON.stringify({ can_write: false }));
    expect(removeInit?.method).toBe("DELETE");
  });

  it("lists audit logs and maps meta to camelCase", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [
          {
            id: "audit-1",
            account_id: "acc-1",
            domain_id: "domain-1",
            owner_type: "plugin",
            owner_id: "owner-plugin",
            actor_type: "owner:plugin",
            actor_id: "owner-plugin",
            action: "grant.create",
            target_type: "grant",
            target_id: "grant-1",
            request_id: "req-1",
            metadata_json: { can_write: false },
            created_at: 20,
          },
        ],
        meta: {
          total: 1,
          limit: 20,
          offset: 0,
          has_more: false,
          sort_by: "created_at",
          sort_order: "desc",
        },
      }),
    );

    const client = createTavernClient({ baseUrl, fetchImpl });
    const result = await client.clientData.auditLogs.list({
      accountId: "acc-1",
      domainId: "domain-1",
      callerOwner: { ownerType: "plugin", ownerId: "owner-plugin" },
      limit: 20,
      offset: 0,
    });

    expect(result).toEqual({
      data: [
        {
          id: "audit-1",
          accountId: "acc-1",
          domainId: "domain-1",
          ownerType: "plugin",
          ownerId: "owner-plugin",
          actorType: "owner:plugin",
          actorId: "owner-plugin",
          action: "grant.create",
          targetType: "grant",
          targetId: "grant-1",
          requestId: "req-1",
          metadataJson: { can_write: false },
          createdAt: 20,
        },
      ],
      meta: {
        total: 1,
        limit: 20,
        offset: 0,
        hasMore: false,
        sortBy: "created_at",
        sortOrder: "desc",
      },
    });
  });

  it("mounts import helpers on createTavernClient", () => {
    const client = createTavernClient({ baseUrl, fetchImpl: vi.fn<typeof fetch>() });
    expect(typeof client.clientData.domains.import).toBe("function");
    expect(typeof client.clientData.domains.importAsNew).toBe("function");
  });

  it("mounts clientData on createTavernClient", () => {
    const client = createTavernClient({
      baseUrl,
      fetchImpl: vi.fn<typeof fetch>(),
    });

    expect(client.clientData).toBeDefined();
    expect(typeof client.clientData.domains.list).toBe("function");
    expect(typeof client.clientData.domains.updateQuota).toBe("function");
    expect(typeof client.clientData.domains.restore).toBe("function");
    expect(typeof client.clientData.domains.import).toBe("function");
    expect(typeof client.clientData.domains.importAsNew).toBe("function");
    expect(typeof client.clientData.collections.create).toBe("function");
    expect(typeof client.clientData.items.getByKey).toBe("function");
    expect(typeof client.clientData.items.upsertBatch).toBe("function");
    expect(typeof client.clientData.grants.create).toBe("function");
    expect(typeof client.clientData.auditLogs.list).toBe("function");
  });
});
