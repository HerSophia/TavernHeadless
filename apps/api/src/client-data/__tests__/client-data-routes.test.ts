import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { buildApp, type BuildAppResult } from "../../app.js";
import { clientDataDomains } from "../../db/schema.js";
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

  async function createTestApp(overrides?: Partial<typeof clientDataConfig>) {
    const built = await buildApp({
      databasePath: ":memory:",
      auth: { mode: "off" },
      accountMode: "single",
      enableClientData: true,
      clientData: {
        ...clientDataConfig,
        ...overrides,
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
  ) {
    const response = await app.inject({
      method: "POST",
      url: "/client-data/domains",
      payload: body,
    });

    expect(response.statusCode).toBe(201);
    expect(response.headers["content-type"]).toContain("application/json");
    const payload = JSON.parse(response.body) as { data: { id: string } };
    expect(payload).toHaveProperty("data");
    return payload.data.id as string;
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
    expect(JSON.parse(detailResponse.body).data.quota_usage).toEqual({
      entry_count: 0,
      byte_count: 0,
    });

    const updateResponse = await app.inject({
      method: "PATCH",
      url: `/client-data/domains/${domainId}`,
      payload: {
        display_name: "Preferences Updated",
      },
    });

    expect(updateResponse.statusCode).toBe(200);
    expect(JSON.parse(updateResponse.body).data.display_name).toBe("Preferences Updated");

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
    const collectionId = JSON.parse(createCollectionResponse.body).data.id as string;

    const updateCollectionResponse = await app.inject({
      method: "PATCH",
      url: `/client-data/domains/${domainId}/collections/${collectionId}`,
      payload: {
        description: "Updated settings collection",
      },
    });

    expect(updateCollectionResponse.statusCode).toBe(200);
    expect(JSON.parse(updateCollectionResponse.body).data.description).toBe("Updated settings collection");

    const deleteCollectionResponse = await app.inject({
      method: "DELETE",
      url: `/client-data/domains/${domainId}/collections/${collectionId}`,
    });

    expect(deleteCollectionResponse.statusCode).toBe(200);
    expect(JSON.parse(deleteCollectionResponse.body).data).toEqual({ id: collectionId, deleted: true });
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

  it("rejects domain creation when maxDomainsPerAccount is exceeded", async () => {
    const { app } = await createTestApp({ maxDomainsPerAccount: 1 });

    const firstCreate = await app.inject({
      method: "POST",
      url: "/client-data/domains",
      payload: {
        owner_type: "application",
        owner_id: "app-limit",
        domain_name: "first",
      },
    });
    expect(firstCreate.statusCode).toBe(201);

    const secondCreate = await app.inject({
      method: "POST",
      url: "/client-data/domains",
      payload: {
        owner_type: "application",
        owner_id: "app-limit",
        domain_name: "second",
      },
    });

    expect(secondCreate.statusCode).toBe(409);
    expect(JSON.parse(secondCreate.body).error.code).toBe("client_data_account_domain_limit_exceeded");
  });

  it("rolls back batch upsert when one item exceeds size quota", async () => {
    const { app } = await createTestApp({ defaultMaxItemSizeBytes: 20 });
    const domainId = await createDomain(app, {
      owner_type: "plugin",
      owner_id: "app-batch",
      domain_name: "batch-domain",
    });

    const batchResponse = await app.inject({
      method: "PUT",
      url: `/client-data/domains/${domainId}/items/batch`,
      payload: {
        items: [
          {
            collection_name: "settings",
            item_key: "theme",
            value_json: { mode: "dark" },
          },
          {
            collection_name: "settings",
            item_key: "oversized",
            value_json: { long: "123456789012345678901234567890" },
          },
        ],
      },
    });

    expect(batchResponse.statusCode).toBe(409);
    expect(JSON.parse(batchResponse.body).error.code).toBe("client_data_item_too_large");

    const listResponse = await app.inject({
      method: "GET",
      url: `/client-data/domains/${domainId}/items?limit=10&offset=0&sort_by=updated_at&sort_order=desc`,
    });

    expect(listResponse.statusCode).toBe(200);
    expect(JSON.parse(listResponse.body).data).toHaveLength(0);
  });
});
