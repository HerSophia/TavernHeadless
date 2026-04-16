import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { buildApp, type BuildAppResult } from "../../app.js";
import { clientDataAuditLogs, clientDataCollections, clientDataDomains, clientDataManagedDomains } from "../../db/schema.js";
import type { DatabaseConnection } from "../../db/client.js";

const clientDataConfig = {
  expirationIntervalMs: 300_000,
  domainPurgeGracePeriodMs: 604_800_000,
  defaultMaxItemSizeBytes: 1_048_576,
  defaultQuotaMaxEntries: 10_000,
  defaultQuotaMaxBytes: 10_485_760,
  maxDomainsPerAccount: 64,
  maxTotalEntriesPerAccount: 100_000,
  maxTotalBytesPerAccount: 104_857_600,
};

describe("client data routes", () => {
  const apps: Array<BuildAppResult & { database: DatabaseConnection["db"] }> = [];

  afterEach(async () => {
    while (apps.length > 0) {
      const current = apps.pop();
      if (current) {
        await current.app.close();
      }
    }
  });

  async function createTestApp(overrides?: {
    config?: Partial<typeof clientDataConfig>;
  }) {
    const built = await buildApp({
      databasePath: ":memory:",
      auth: { mode: "off" },
      accountMode: "single",
      enableClientData: true,
      clientData: {
        ...clientDataConfig,
        ...overrides?.config,
      },
    });

    const result = built as BuildAppResult & { database: DatabaseConnection["db"] };

    apps.push(result);
    await built.app.ready();
    return result;
  }

  async function createDomain(
    app: BuildAppResult["app"],
    body: {
      owner_type: "application" | "plugin";
      owner_id: string;
      domain_name: string;
      display_name?: string;
      description?: string;
    },
    headers?: Record<string, string>,
  ) {
    const response = await app.inject({
      method: "POST",
      url: "/client-data/domains",
      payload: body,
      headers,
    });

    expect(response.statusCode).toBe(201);
    expect(response.headers["content-type"]).toContain("application/json");
    const payload = JSON.parse(response.body) as { data: { id: string } };
    expect(payload).toHaveProperty("data");
    return payload.data.id as string;
  }

  function createImportPayload(overrides?: {
    owner_type?: "application" | "plugin";
    owner_id?: string;
    domain_name?: string;
    collection_name?: string;
    item_key?: string;
    value_json?: unknown;
  }) {
    return {
      domain: {
        owner_type: overrides?.owner_type ?? "application",
        owner_id: overrides?.owner_id ?? "app-import",
        domain_name: overrides?.domain_name ?? "import-domain",
      },
      collections: [
        {
          collection_name: overrides?.collection_name ?? "settings",
          description: null,
          default_expires_ttl_ms: null,
          max_item_size_bytes: null,
          metadata_json: { source: "import" },
          items: [
            {
              item_key: overrides?.item_key ?? "theme",
              value_json: overrides?.value_json ?? { mode: "dark" },
              expires_at: null,
            },
          ],
        },
      ],
    };
  }

  it("creates, lists, reads, updates, and soft deletes a domain", async () => {
    const { app } = await createTestApp();

    const createResponse = await app.inject({
      method: "POST",
      url: "/client-data/domains",
      payload: {
        owner_type: "application",
        owner_id: "app-1",
        domain_name: "preferences",
        display_name: "Preferences",
        description: "Client preferences",
      },
    });

    expect(createResponse.statusCode).toBe(201);
    expect(createResponse.headers["content-type"]).toContain("application/json");
    const createdBody = JSON.parse(createResponse.body);
    expect(createdBody.data.owner_type).toBe("application");
    expect(createdBody.data.domain_name).toBe("preferences");
    expect(createdBody.data.status).toBe("active");
    expect(createdBody.data.version).toBe(1);

    const domainId = createdBody.data.id as string;

    const listResponse = await app.inject({
      method: "GET",
      url: "/client-data/domains?limit=10&offset=0&sort_by=updated_at&sort_order=desc",
    });

    expect(listResponse.statusCode).toBe(200);
    const listBody = JSON.parse(listResponse.body);
    expect(listBody.data).toHaveLength(1);
    expect(listBody.meta.total).toBe(1);
    expect(listBody.meta.has_more).toBe(false);

    const detailResponse = await app.inject({
      method: "GET",
      url: `/client-data/domains/${domainId}`,
    });

    expect(detailResponse.statusCode).toBe(200);
    expect(JSON.parse(detailResponse.body).data).toMatchObject({
      quota_usage: {
        entry_count: 0,
        byte_count: 0,
      },
      version: 1,
      restorable_until: null,
    });

    const updateResponse = await app.inject({
      method: "PATCH",
      url: `/client-data/domains/${domainId}`,
      payload: {
        display_name: "Preferences Updated",
        if_version: 1,
      },
    });

    expect(updateResponse.statusCode).toBe(200);
    expect(JSON.parse(updateResponse.body).data).toMatchObject({
      display_name: "Preferences Updated",
      version: 2,
    });

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/client-data/domains/${domainId}`,
    });

    expect(deleteResponse.statusCode).toBe(200);
    expect(JSON.parse(deleteResponse.body).data).toEqual({ id: domainId, deleted: true });

    const deletedDetailResponse = await app.inject({
      method: "GET",
      url: `/client-data/domains/${domainId}`,
    });

    expect(deletedDetailResponse.statusCode).toBe(410);
    expect(JSON.parse(deletedDetailResponse.body).error.code).toBe("client_data_domain_deleted");
  });

  it("returns 409 on domain metadata if_version conflict", async () => {
    const { app } = await createTestApp();
    const domainId = await createDomain(app, {
      owner_type: "application",
      owner_id: "app-cas",
      domain_name: "cas-domain",
    });

    const response = await app.inject({
      method: "PATCH",
      url: `/client-data/domains/${domainId}`,
      payload: {
        display_name: "Should Fail",
        if_version: 999,
      },
    });

    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body).error.code).toBe("client_data_version_conflict");
  });

  it("returns a stable code when owner/name already exists", async () => {
    const { app } = await createTestApp();
    await createDomain(app, {
      owner_type: "application",
      owner_id: "app-dup-domain",
      domain_name: "preferences",
    });

    const response = await app.inject({
      method: "POST",
      url: "/client-data/domains",
      payload: {
        owner_type: "application",
        owner_id: "app-dup-domain",
        domain_name: "preferences",
      },
    });

    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body).error.code).toBe("client_data_domain_name_conflict");
  });

  it("soft deletes domains by owner", async () => {
    const { app } = await createTestApp();

    for (const domainName of ["preferences", "cache"]) {
      const response = await app.inject({
        method: "POST",
        url: "/client-data/domains",
        payload: {
          owner_type: "application",
          owner_id: "app-owner",
          domain_name: domainName,
        },
      });
      expect(response.statusCode).toBe(201);
    }

    const deleteByOwnerResponse = await app.inject({
      method: "DELETE",
      url: "/client-data/owners/application/app-owner/domains",
    });

    expect(deleteByOwnerResponse.statusCode).toBe(200);
    const body = JSON.parse(deleteByOwnerResponse.body);
    expect(body.data).toHaveLength(2);
    expect(body.data.every((item: { status: string }) => item.status === "deleted")).toBe(true);
  });

  it("creates, updates, and deletes a collection", async () => {
    const { app } = await createTestApp();
    const domainId = await createDomain(app, {
      owner_type: "plugin",
      owner_id: "app-1",
      domain_name: "collections-domain",
    });

    const createCollectionResponse = await app.inject({
      method: "POST",
      url: `/client-data/domains/${domainId}/collections`,
      payload: {
        collection_name: "settings",
        metadata_json: { source: "test" },
      },
    });

    expect(createCollectionResponse.statusCode).toBe(201);
    const collectionBody = JSON.parse(createCollectionResponse.body);
    const collectionId = collectionBody.data.id as string;
    expect(collectionBody.data.version).toBe(1);

    const updateCollectionResponse = await app.inject({
      method: "PATCH",
      url: `/client-data/domains/${domainId}/collections/${collectionId}`,
      payload: {
        description: "Updated settings collection",
        if_version: 1,
      },
    });

    expect(updateCollectionResponse.statusCode).toBe(200);
    expect(JSON.parse(updateCollectionResponse.body).data).toMatchObject({
      description: "Updated settings collection",
      version: 2,
    });

    const deleteCollectionResponse = await app.inject({
      method: "DELETE",
      url: `/client-data/domains/${domainId}/collections/${collectionId}`,
    });

    expect(deleteCollectionResponse.statusCode).toBe(200);
    expect(JSON.parse(deleteCollectionResponse.body).data).toEqual({ id: collectionId, deleted: true });
  });

  it("returns 409 on collection metadata if_version conflict", async () => {
    const { app } = await createTestApp();
    const domainId = await createDomain(app, {
      owner_type: "plugin",
      owner_id: "app-collection-cas",
      domain_name: "collection-cas-domain",
    });

    const createCollectionResponse = await app.inject({
      method: "POST",
      url: `/client-data/domains/${domainId}/collections`,
      payload: {
        collection_name: "settings",
      },
    });
    expect(createCollectionResponse.statusCode).toBe(201);
    const collectionId = JSON.parse(createCollectionResponse.body).data.id as string;

    const updateCollectionResponse = await app.inject({
      method: "PATCH",
      url: `/client-data/domains/${domainId}/collections/${collectionId}`,
      payload: {
        description: "Stale update",
        if_version: 999,
      },
    });

    expect(updateCollectionResponse.statusCode).toBe(409);
    expect(JSON.parse(updateCollectionResponse.body).error.code).toBe("client_data_version_conflict");
  });

  it("returns a stable code when collection name already exists in domain", async () => {
    const { app } = await createTestApp();
    const domainId = await createDomain(app, {
      owner_type: "plugin",
      owner_id: "app-dup-collection",
      domain_name: "dup-collection-domain",
    });

    const first = await app.inject({
      method: "POST",
      url: `/client-data/domains/${domainId}/collections`,
      payload: { collection_name: "settings" },
    });
    expect(first.statusCode).toBe(201);

    const duplicate = await app.inject({
      method: "POST",
      url: `/client-data/domains/${domainId}/collections`,
      payload: { collection_name: "settings" },
    });

    expect(duplicate.statusCode).toBe(409);
    expect(JSON.parse(duplicate.body).error.code).toBe("client_data_collection_name_conflict");
  });

  it("updates domain quota for admin and rejects quota below usage", async () => {
    const { app } = await createTestApp();
    const domainId = await createDomain(app, {
      owner_type: "plugin",
      owner_id: "app-quota",
      domain_name: "quota-domain",
    });

    const quotaResponse = await app.inject({
      method: "PATCH",
      url: `/client-data/domains/${domainId}/quota`,
      payload: {
        quota_max_entries: 20_000,
        quota_max_bytes: 20_971_520,
      },
    });

    expect(quotaResponse.statusCode).toBe(200);
    expect(JSON.parse(quotaResponse.body).data).toMatchObject({
      quota_max_entries: 20_000,
      quota_max_bytes: 20_971_520,
      version: 2,
    });

    const upsertResponse = await app.inject({
      method: "PUT",
      url: `/client-data/domains/${domainId}/items`,
      payload: {
        collection_name: "settings",
        item_key: "theme",
        value_json: { mode: "dark" },
      },
    });
    expect(upsertResponse.statusCode).toBe(200);

    const belowUsageResponse = await app.inject({
      method: "PATCH",
      url: `/client-data/domains/${domainId}/quota`,
      payload: {
        quota_max_entries: 0,
        quota_max_bytes: 1,
      },
    });

    expect(belowUsageResponse.statusCode).toBe(409);
    expect(JSON.parse(belowUsageResponse.body).error.code).toBe("client_data_domain_quota_below_usage");
  });

  it("reads item by key and applies structured list filters", async () => {
    const { app } = await createTestApp();
    const domainId = await createDomain(app, {
      owner_type: "application",
      owner_id: "app-by-key",
      domain_name: "query-domain",
    });

    const firstUpsert = await app.inject({
      method: "PUT",
      url: `/client-data/domains/${domainId}/items`,
      payload: {
        collection_name: "settings",
        item_key: "theme.dark",
        value_json: { mode: "dark" },
      },
    });
    expect(firstUpsert.statusCode).toBe(200);
    const firstItem = JSON.parse(firstUpsert.body).data.item;

    const secondUpsert = await app.inject({
      method: "PUT",
      url: `/client-data/domains/${domainId}/items`,
      payload: {
        collection_name: "settings",
        item_key: "theme.light",
        value_json: { mode: "light" },
        expires_at: Date.now() + 60_000,
      },
    });
    expect(secondUpsert.statusCode).toBe(200);
    const secondItem = JSON.parse(secondUpsert.body).data.item;

    const byKeyResponse = await app.inject({
      method: "GET",
      url: `/client-data/domains/${domainId}/items/by-key?collection_name=settings&item_key=theme.dark`,
    });

    expect(byKeyResponse.statusCode).toBe(200);
    expect(JSON.parse(byKeyResponse.body).data).toMatchObject({
      id: firstItem.id,
      item_key: "theme.dark",
    });

    const filteredResponse = await app.inject({
      method: "GET",
      url: `/client-data/domains/${domainId}/items?item_key_prefix=theme.&updated_after=${firstItem.updated_at - 1}&updated_before=${secondItem.updated_at + 1}&expires_after=${Date.now()}&expired=false&limit=10&offset=0&sort_by=item_key&sort_order=asc`,
    });

    expect(filteredResponse.statusCode).toBe(200);
    const filteredBody = JSON.parse(filteredResponse.body);
    expect(filteredBody.data).toHaveLength(1);
    expect(filteredBody.data[0].item_key).toBe("theme.light");
  });

  it("imports into an existing domain with overwrite conflict policy", async () => {
    const { app } = await createTestApp();
    const domainId = await createDomain(app, {
      owner_type: "application",
      owner_id: "app-import",
      domain_name: "import-domain",
    });

    const seedResponse = await app.inject({
      method: "PUT",
      url: `/client-data/domains/${domainId}/items`,
      payload: {
        collection_name: "settings",
        item_key: "theme",
        value_json: { mode: "light" },
      },
    });
    expect(seedResponse.statusCode).toBe(200);

    const importResponse = await app.inject({
      method: "POST",
      url: `/client-data/domains/${domainId}/import`,
      payload: {
        conflict_policy: "overwrite",
        payload: createImportPayload(),
      },
    });

    expect(importResponse.statusCode).toBe(200);
    const importBody = JSON.parse(importResponse.body);
    expect(importBody.data.summary).toMatchObject({
      items_created: 0,
      items_updated: 1,
      items_skipped: 0,
      conflict_policy: "overwrite",
    });

    const byKeyResponse = await app.inject({
      method: "GET",
      url: `/client-data/domains/${domainId}/items/by-key?collection_name=settings&item_key=theme`,
    });
    expect(byKeyResponse.statusCode).toBe(200);
    expect(JSON.parse(byKeyResponse.body).data.value_json).toEqual({ mode: "dark" });
  });

  it("creates a new domain from import payload", async () => {
    const { app } = await createTestApp();

    const importResponse = await app.inject({
      method: "POST",
      url: "/client-data/domains/import",
      payload: {
        conflict_policy: "fail",
        payload: createImportPayload({
          owner_id: "app-import-new",
          domain_name: "import-domain-new",
          collection_name: "prefs",
          item_key: "theme.dark",
        }),
      },
    });

    expect(importResponse.statusCode).toBe(201);
    const importBody = JSON.parse(importResponse.body);
    expect(importBody.data.domain.owner_id).toBe("app-import-new");
    expect(importBody.data.domain.domain_name).toBe("import-domain-new");
    expect(importBody.data.summary.items_created).toBe(1);
    expect(importBody.data.summary.conflict_policy).toBe("fail");
  });

  it("rolls back import when conflict policy is fail", async () => {
    const { app } = await createTestApp();
    const domainId = await createDomain(app, {
      owner_type: "application",
      owner_id: "app-import-fail",
      domain_name: "import-fail-domain",
    });

    const seedResponse = await app.inject({
      method: "PUT",
      url: `/client-data/domains/${domainId}/items`,
      payload: {
        collection_name: "settings",
        item_key: "theme",
        value_json: { mode: "light" },
      },
    });
    expect(seedResponse.statusCode).toBe(200);

    const importResponse = await app.inject({
      method: "POST",
      url: `/client-data/domains/${domainId}/import`,
      payload: {
        conflict_policy: "fail",
        payload: createImportPayload({
          owner_id: "app-import-fail",
          domain_name: "import-fail-domain",
        }),
      },
    });

    expect(importResponse.statusCode).toBe(409);
    expect(JSON.parse(importResponse.body).error.code).toBe("client_data_import_conflict");

    const listResponse = await app.inject({
      method: "GET",
      url: `/client-data/domains/${domainId}/items?limit=10&offset=0&sort_by=item_key&sort_order=asc`,
    });
    expect(listResponse.statusCode).toBe(200);
    const listBody = JSON.parse(listResponse.body);
    expect(listBody.data).toHaveLength(1);
    expect(listBody.data[0].value_json).toEqual({ mode: "light" });
  });

  it("skips conflicts when conflict policy is skip", async () => {
    const { app } = await createTestApp();
    const domainId = await createDomain(app, {
      owner_type: "application",
      owner_id: "app-import-skip",
      domain_name: "import-skip-domain",
    });

    const seedResponse = await app.inject({
      method: "PUT",
      url: `/client-data/domains/${domainId}/items`,
      payload: {
        collection_name: "settings",
        item_key: "theme",
        value_json: { mode: "light" },
      },
    });
    expect(seedResponse.statusCode).toBe(200);

    const importResponse = await app.inject({
      method: "POST",
      url: `/client-data/domains/${domainId}/import`,
      payload: {
        conflict_policy: "skip",
        payload: createImportPayload({
          owner_id: "app-import-skip",
          domain_name: "import-skip-domain",
        }),
      },
    });

    expect(importResponse.statusCode).toBe(200);
    const importBody = JSON.parse(importResponse.body);
    expect(importBody.data.summary.items_skipped).toBe(1);
    expect(importBody.data.summary.items_created).toBe(0);

    const byKeyResponse = await app.inject({
      method: "GET",
      url: `/client-data/domains/${domainId}/items/by-key?collection_name=settings&item_key=theme`,
    });
    expect(byKeyResponse.statusCode).toBe(200);
    expect(JSON.parse(byKeyResponse.body).data.value_json).toEqual({ mode: "light" });
  });

  it("returns 409 for import domain mismatch", async () => {
    const { app } = await createTestApp();
    const domainId = await createDomain(app, {
      owner_type: "application",
      owner_id: "app-import-mismatch",
      domain_name: "import-mismatch-domain",
    });

    const importResponse = await app.inject({
      method: "POST",
      url: `/client-data/domains/${domainId}/import`,
      payload: {
        conflict_policy: "overwrite",
        payload: createImportPayload({
          owner_id: "other-owner",
          domain_name: "other-domain",
        }),
      },
    });

    expect(importResponse.statusCode).toBe(409);
    expect(JSON.parse(importResponse.body).error.code).toBe("client_data_import_domain_mismatch");
  });

  it("returns 400 when import payload exceeds item limit", async () => {
    const { app } = await createTestApp();
    const tooManyItems = Array.from({ length: 1_001 }, (_, index) => ({
      item_key: `item-${index}`,
      value_json: { index },
      expires_at: null,
    }));

    const importResponse = await app.inject({
      method: "POST",
      url: "/client-data/domains/import",
      payload: {
        conflict_policy: "fail",
        payload: {
          domain: {
            owner_type: "application",
            owner_id: "app-import-limit",
            domain_name: "import-limit-domain",
          },
          collections: [
            {
              collection_name: "settings",
              description: null,
              default_expires_ttl_ms: null,
              max_item_size_bytes: null,
              metadata_json: null,
              items: tooManyItems,
            },
          ],
        },
      },
    });

    expect(importResponse.statusCode).toBe(400);
    expect(JSON.parse(importResponse.body).error.code).toBe("client_data_import_item_limit_exceeded");
  });

  it("returns 404 for missing item by key", async () => {
    const { app } = await createTestApp();
    const domainId = await createDomain(app, {
      owner_type: "application",
      owner_id: "app-by-key-missing",
      domain_name: "query-domain-missing",
    });

    const response = await app.inject({
      method: "GET",
      url: `/client-data/domains/${domainId}/items/by-key?collection_name=settings&item_key=theme.dark`,
    });

    expect(response.statusCode).toBe(404);
  });

  it("returns 410 for by-key lookup on deleted domain", async () => {
    const { app, database } = await createTestApp();
    const domainId = await createDomain(app, {
      owner_type: "application",
      owner_id: "app-by-key-deleted",
      domain_name: "query-domain-deleted",
    });

    const collectionResponse = await app.inject({
      method: "POST",
      url: `/client-data/domains/${domainId}/collections`,
      payload: {
        collection_name: "settings",
      },
    });
    expect(collectionResponse.statusCode).toBe(201);

    await database
      .update(clientDataDomains)
      .set({ status: "deleted", deletedAt: Date.now() })
      .where(eq(clientDataDomains.id, domainId));

    const response = await app.inject({
      method: "GET",
      url: `/client-data/domains/${domainId}/items/by-key?collection_name=settings&item_key=theme.dark`,
    });

    expect(response.statusCode).toBe(410);
    expect(JSON.parse(response.body).error.code).toBe("client_data_domain_deleted");
  });

  it("restores a deleted domain within grace period", async () => {
    const { app } = await createTestApp();
    const domainId = await createDomain(app, {
      owner_type: "application",
      owner_id: "app-restore",
      domain_name: "restore-domain",
    });

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/client-data/domains/${domainId}`,
    });
    expect(deleteResponse.statusCode).toBe(200);

    const restoreResponse = await app.inject({
      method: "POST",
      url: `/client-data/domains/${domainId}/restore`,
    });

    expect(restoreResponse.statusCode).toBe(200);
    expect(JSON.parse(restoreResponse.body).data).toMatchObject({
      status: "active",
      deleted_at: null,
    });
  });

  it("returns 409 when restore grace period is expired", async () => {
    const { app, database } = await createTestApp({
      config: {
        domainPurgeGracePeriodMs: 1,
      },
    });
    const domainId = await createDomain(app, {
      owner_type: "application",
      owner_id: "app-restore-expired",
      domain_name: "restore-expired-domain",
    });

    await app.inject({
      method: "DELETE",
      url: `/client-data/domains/${domainId}`,
    });

    await database
      .update(clientDataDomains)
      .set({ deletedAt: Date.now() - 1000 })
      .where(eq(clientDataDomains.id, domainId));

    const restoreResponse = await app.inject({
      method: "POST",
      url: `/client-data/domains/${domainId}/restore`,
    });

    expect(restoreResponse.statusCode).toBe(409);
    expect(JSON.parse(restoreResponse.body).error.code).toBe("client_data_domain_restore_expired");
  });

  it("returns 409 when restore conflicts with an active domain", async () => {
    const { app } = await createTestApp();
    const domainId = await createDomain(app, {
      owner_type: "application",
      owner_id: "app-restore-conflict",
      domain_name: "restore-conflict-domain",
    });

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/client-data/domains/${domainId}`,
    });
    expect(deleteResponse.statusCode).toBe(200);

    const duplicateResponse = await app.inject({
      method: "POST",
      url: "/client-data/domains",
      payload: {
        owner_type: "application",
        owner_id: "app-restore-conflict",
        domain_name: "restore-conflict-domain",
      },
    });
    expect(duplicateResponse.statusCode).toBe(201);

    const restoreResponse = await app.inject({
      method: "POST",
      url: `/client-data/domains/${domainId}/restore`,
    });

    expect(restoreResponse.statusCode).toBe(409);
    expect(JSON.parse(restoreResponse.body).error.code).toBe("client_data_domain_restore_conflict");
  });

  it("upserts a single item and derives TTL from collection default", async () => {
    const { app } = await createTestApp();
    const domainId = await createDomain(app, {
      owner_type: "plugin",
      owner_id: "app-ttl",
      domain_name: "ttl-domain",
    });

    const collectionResponse = await app.inject({
      method: "POST",
      url: `/client-data/domains/${domainId}/collections`,
      payload: {
        collection_name: "settings",
        default_expires_ttl_ms: 60_000,
      },
    });
    expect(collectionResponse.statusCode).toBe(201);

    const upsertResponse = await app.inject({
      method: "PUT",
      url: `/client-data/domains/${domainId}/items`,
      payload: {
        collection_name: "settings",
        item_key: "theme",
        value_json: { mode: "dark" },
      },
    });

    expect(upsertResponse.statusCode).toBe(200);
    const body = JSON.parse(upsertResponse.body);
    expect(body.data.action).toBe("created");
    expect(body.data.item.item_key).toBe("theme");
    expect(typeof body.data.item.expires_at).toBe("number");
  });

  it("returns 409 on if_version conflict", async () => {
    const { app } = await createTestApp();
    const domainId = await createDomain(app, {
      owner_type: "plugin",
      owner_id: "app-conflict",
      domain_name: "conflict-domain",
    });

    const firstUpsert = await app.inject({
      method: "PUT",
      url: `/client-data/domains/${domainId}/items`,
      payload: {
        collection_name: "settings",
        item_key: "theme",
        value_json: { mode: "dark" },
      },
    });
    expect(firstUpsert.statusCode).toBe(200);

    const conflictResponse = await app.inject({
      method: "PUT",
      url: `/client-data/domains/${domainId}/items`,
      payload: {
        collection_name: "settings",
        item_key: "theme",
        value_json: { mode: "light" },
        if_version: 999,
      },
    });

    expect(conflictResponse.statusCode).toBe(409);
    expect(JSON.parse(conflictResponse.body).error.code).toBe("client_data_version_conflict");
  });

  it("returns 409 for suspended domain writes and 410 for deleted domain reads", async () => {
    const { app, database } = await createTestApp();
    const domainId = await createDomain(app, {
      owner_type: "plugin",
      owner_id: "app-state",
      domain_name: "state-domain",
    });

    await database
      .update(clientDataDomains)
      .set({ status: "suspended" })
      .where(eq(clientDataDomains.id, domainId));

    const suspendedWriteResponse = await app.inject({
      method: "PUT",
      url: `/client-data/domains/${domainId}/items`,
      payload: {
        collection_name: "settings",
        item_key: "theme",
        value_json: { mode: "dark" },
      },
    });

    expect(suspendedWriteResponse.statusCode).toBe(409);
    expect(JSON.parse(suspendedWriteResponse.body).error.code).toBe("client_data_domain_suspended");

    await database
      .update(clientDataDomains)
      .set({ status: "deleted", deletedAt: Date.now() })
      .where(eq(clientDataDomains.id, domainId));

    const deletedReadResponse = await app.inject({
      method: "GET",
      url: `/client-data/domains/${domainId}`,
    });

    expect(deletedReadResponse.statusCode).toBe(410);
    expect(JSON.parse(deletedReadResponse.body).error.code).toBe("client_data_domain_deleted");
  });

  it("returns restorable_until in deleted detail after direct restore state setup", async () => {
    const { app, database } = await createTestApp();
    const domainId = await createDomain(app, {
      owner_type: "plugin",
      owner_id: "app-restorable-detail",
      domain_name: "restorable-detail-domain",
    });

    const deletedAt = Date.now();
    await database
      .update(clientDataDomains)
      .set({ status: "deleted", deletedAt })
      .where(eq(clientDataDomains.id, domainId));

    const detailResponse = await app.inject({
      method: "GET",
      url: `/client-data/domains/${domainId}`,
    });

    expect(detailResponse.statusCode).toBe(410);
    expect(JSON.parse(detailResponse.body).error.code).toBe("client_data_domain_deleted");
  });

  it("returns 404 for unrelated collection lookup on import-created collection table assertions", async () => {
    const { app, database } = await createTestApp();
    const importResponse = await app.inject({
      method: "POST",
      url: "/client-data/domains/import",
      payload: {
        conflict_policy: "fail",
        payload: createImportPayload({
          owner_id: "app-import-db",
          domain_name: "import-domain-db",
          collection_name: "prefs",
          item_key: "theme.pref",
        }),
      },
    });

    expect(importResponse.statusCode).toBe(201);
    const domainId = JSON.parse(importResponse.body).data.domain.id as string;

    const storedCollections = await database
      .select()
      .from(clientDataCollections)
      .where(eq(clientDataCollections.domainId, domainId));

    expect(storedCollections).toHaveLength(1);
    expect(storedCollections[0]?.collectionName).toBe("prefs");
  });

  it("enforces grant permissions for plugin caller owner and records audit logs", async () => {
    const { app, database } = await createTestApp();
    const ownerHeaders = {
      "x-client-owner-type": "plugin",
      "x-client-owner-id": "plugin-owner",
    };
    const granteeHeaders = {
      "x-client-owner-type": "plugin",
      "x-client-owner-id": "plugin-reader",
    };
    const domainId = await createDomain(app, {
      owner_type: "plugin",
      owner_id: "plugin-owner",
      domain_name: "grant-domain",
    }, ownerHeaders);

    const createGrantResponse = await app.inject({
      method: "POST",
      url: `/client-data/domains/${domainId}/grants`,
      headers: ownerHeaders,
      payload: {
        grantee_owner_type: "plugin",
        grantee_owner_id: "plugin-reader",
        can_read: true,
        can_write: false,
        can_delete: false,
        can_list: true,
        expires_at: null,
      },
    });

    expect(createGrantResponse.statusCode).toBe(201);
    const grantId = JSON.parse(createGrantResponse.body).data.id as string;

    const duplicateGrantResponse = await app.inject({
      method: "POST",
      url: `/client-data/domains/${domainId}/grants`,
      headers: ownerHeaders,
      payload: {
        grantee_owner_type: "plugin",
        grantee_owner_id: "plugin-reader",
        can_read: true,
        can_write: false,
        can_delete: false,
        can_list: true,
        expires_at: null,
      },
    });

    expect(duplicateGrantResponse.statusCode).toBe(409);
    expect(JSON.parse(duplicateGrantResponse.body).error.code).toBe("client_data_domain_grant_conflict");

    const ownerWriteResponse = await app.inject({
      method: "PUT",
      url: `/client-data/domains/${domainId}/items`,
      headers: ownerHeaders,
      payload: {
        collection_name: "settings",
        item_key: "theme",
        value_json: { mode: "dark" },
      },
    });
    expect(ownerWriteResponse.statusCode).toBe(200);

    const readerListResponse = await app.inject({
      method: "GET",
      url: `/client-data/domains/${domainId}/items?limit=10&offset=0&sort_by=updated_at&sort_order=desc`,
      headers: granteeHeaders,
    });
    expect(readerListResponse.statusCode).toBe(200);
    expect(JSON.parse(readerListResponse.body).data).toHaveLength(1);

    const forbiddenWriteResponse = await app.inject({
      method: "PUT",
      url: `/client-data/domains/${domainId}/items`,
      headers: granteeHeaders,
      payload: {
        collection_name: "settings",
        item_key: "theme-2",
        value_json: { mode: "light" },
      },
    });
    expect(forbiddenWriteResponse.statusCode).toBe(403);
    expect(JSON.parse(forbiddenWriteResponse.body).error.code).toBe("client_data_domain_forbidden");

    const listGrantsResponse = await app.inject({
      method: "GET",
      url: `/client-data/domains/${domainId}/grants`,
      headers: ownerHeaders,
    });
    expect(listGrantsResponse.statusCode).toBe(200);
    expect(JSON.parse(listGrantsResponse.body).data).toHaveLength(1);

    const updateGrantResponse = await app.inject({
      method: "PATCH",
      url: `/client-data/domains/${domainId}/grants/${grantId}`,
      headers: ownerHeaders,
      payload: {
        can_write: true,
      },
    });
    expect(updateGrantResponse.statusCode).toBe(200);
    expect(JSON.parse(updateGrantResponse.body).data.can_write).toBe(true);

    const grantedWriteResponse = await app.inject({
      method: "PUT",
      url: `/client-data/domains/${domainId}/items`,
      headers: granteeHeaders,
      payload: {
        collection_name: "settings",
        item_key: "theme-2",
        value_json: { mode: "light" },
      },
    });
    expect(grantedWriteResponse.statusCode).toBe(200);

    const auditResponse = await app.inject({
      method: "GET",
      url: `/client-data/domains/${domainId}/audit-logs?limit=20&offset=0&sort_by=created_at&sort_order=desc`,
      headers: ownerHeaders,
    });
    expect(auditResponse.statusCode).toBe(200);
    const auditBody = JSON.parse(auditResponse.body);
    expect(auditBody.data.some((entry: { action: string }) => entry.action === "grant.create")).toBe(true);
    expect(auditBody.data.some((entry: { action: string }) => entry.action === "grant.update")).toBe(true);

    const deleteGrantResponse = await app.inject({
      method: "DELETE",
      url: `/client-data/domains/${domainId}/grants/${grantId}`,
      headers: ownerHeaders,
    });
    expect(deleteGrantResponse.statusCode).toBe(200);

    const expiredWriteResponse = await app.inject({
      method: "PUT",
      url: `/client-data/domains/${domainId}/items`,
      headers: granteeHeaders,
      payload: {
        collection_name: "settings",
        item_key: "theme-3",
        value_json: { mode: "blue" },
      },
    });
    expect(expiredWriteResponse.statusCode).toBe(403);

    const storedAuditLogs = await database
      .select()
      .from(clientDataAuditLogs)
      .where(eq(clientDataAuditLogs.domainId, domainId));
    expect(storedAuditLogs.some((entry: { action: string }) => entry.action === "grant.delete")).toBe(true);
  });

  it("rejects invalid caller owner header and enforces owner-only grant management", async () => {
    const { app } = await createTestApp();
    const ownerHeaders = {
      "x-client-owner-type": "plugin",
      "x-client-owner-id": "plugin-owner-2",
    };
    const otherHeaders = {
      "x-client-owner-type": "plugin",
      "x-client-owner-id": "plugin-other",
    };
    const domainId = await createDomain(app, {
      owner_type: "plugin",
      owner_id: "plugin-owner-2",
      domain_name: "grant-domain-2",
    }, ownerHeaders);

    const invalidHeaderResponse = await app.inject({
      method: "GET",
      url: `/client-data/domains/${domainId}/items?limit=10&offset=0&sort_by=updated_at&sort_order=desc`,
      headers: {
        "x-client-owner-type": "plugin",
      },
    });
    expect(invalidHeaderResponse.statusCode).toBe(400);
    expect(JSON.parse(invalidHeaderResponse.body).error.code).toBe("client_data_caller_owner_invalid");

    const forbiddenGrantListResponse = await app.inject({
      method: "GET",
      url: `/client-data/domains/${domainId}/grants`,
      headers: otherHeaders,
    });
    expect(forbiddenGrantListResponse.statusCode).toBe(403);
    expect(JSON.parse(forbiddenGrantListResponse.body).error.code).toBe("client_data_domain_grant_manage_forbidden");
  });

  it("hides managed domains from raw lists and rejects raw managed-domain writes", async () => {
    const { app, database } = await createTestApp();
    const domainId = await createDomain(app, {
      owner_type: "application",
      owner_id: "tavern-session-state",
      domain_name: "session-state:game_state:session-1",
    });

    await database.insert(clientDataManagedDomains).values({
      domainId,
      accountId: "default-admin",
      managerKind: "session_state",
      hostType: "session",
      hostId: "session-1",
      stateNamespace: "game_state",
      requireCallerOwner: true,
      allowAutoCreateCollection: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const listResponse = await app.inject({
      method: "GET",
      url: "/client-data/domains?limit=10&offset=0&sort_by=updated_at&sort_order=desc",
    });
    expect(listResponse.statusCode).toBe(200);
    expect(JSON.parse(listResponse.body).data).toEqual([]);

    const rawWriteResponse = await app.inject({
      method: "PUT",
      url: `/client-data/domains/${domainId}/items`,
      payload: {
        collection_name: "settings",
        item_key: "theme",
        value_json: { mode: "dark" },
      },
    });
    expect(rawWriteResponse.statusCode).toBe(403);
    expect(JSON.parse(rawWriteResponse.body).error.code).toBe("client_data_managed_domain_raw_access_forbidden");

    const bulkDeleteResponse = await app.inject({
      method: "DELETE",
      url: "/client-data/owners/application/tavern-session-state/domains",
    });
    expect(bulkDeleteResponse.statusCode).toBe(403);
    expect(JSON.parse(bulkDeleteResponse.body).error.code).toBe("client_data_managed_domain_raw_access_forbidden");
  });
});
