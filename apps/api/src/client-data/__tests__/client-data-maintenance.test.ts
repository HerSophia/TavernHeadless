import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { accounts, clientDataCollections, clientDataDomains, clientDataItems } from "../../db/schema.js";
import { cleanExpiredClientDataItems, purgeDeletedClientDataDomains } from "../client-data-maintenance.js";

describe("client data maintenance", () => {
  let database: DatabaseConnection;

  beforeEach(async () => {
    database = createDatabase(":memory:");
    const now = 1_700_000_000_000;

    await database.db.insert(accounts).values({
      id: "acc-1",
      name: "Account 1",
      role: "user",
      status: "active",
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    });
  });

  afterEach(() => {
    database.close();
  });

  it("cleans expired items and updates counters", async () => {
    const now = 1_700_000_100_000;

    await database.db.insert(clientDataDomains).values({
      id: "domain-1",
      accountId: "acc-1",
      ownerType: "application",
      ownerId: "app-1",
      domainName: "prefs",
      displayName: "Prefs",
      description: null,
      status: "active",
      quotaMaxEntries: 100,
      quotaMaxBytes: 4096,
      currentEntryCount: 1,
      currentByteCount: 16,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });

    await database.db.insert(clientDataCollections).values({
      id: "collection-1",
      domainId: "domain-1",
      collectionName: "settings",
      description: null,
      defaultExpiresTtlMs: null,
      maxItemSizeBytes: 1024,
      metadataJson: null,
      itemCount: 1,
      byteCount: 16,
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(clientDataItems).values({
      id: "item-1",
      domainId: "domain-1",
      collectionId: "collection-1",
      itemKey: "theme",
      valueJson: JSON.stringify({ mode: "dark" }),
      byteSize: 16,
      version: 1,
      expiresAt: now - 1,
      createdAt: now,
      updatedAt: now,
    });

    const result = await cleanExpiredClientDataItems(database.db, {
      defaultMaxItemSizeBytes: 1024,
      defaultQuotaMaxEntries: 100,
      defaultQuotaMaxBytes: 4096,
      maxDomainsPerAccount: 10,
      maxTotalEntriesPerAccount: 1000,
      maxTotalBytesPerAccount: 100000,
    }, {
      batchSize: 50,
      now,
    });

    expect(result).toEqual({ deleted: 1, scanned: 1, skipped: 0 });

    const remainingItems = await database.db.select().from(clientDataItems);
    expect(remainingItems).toHaveLength(0);

    const [domain] = await database.db.select().from(clientDataDomains);
    const [collection] = await database.db.select().from(clientDataCollections);

    expect(domain?.currentEntryCount).toBe(0);
    expect(domain?.currentByteCount).toBe(0);
    expect(collection?.itemCount).toBe(0);
    expect(collection?.byteCount).toBe(0);
  });

  it("purges deleted domains past grace period", async () => {
    const now = 1_700_000_200_000;

    await database.db.insert(clientDataDomains).values({
      id: "domain-deleted",
      accountId: "acc-1",
      ownerType: "application",
      ownerId: "app-1",
      domainName: "archive",
      displayName: null,
      description: null,
      status: "deleted",
      quotaMaxEntries: 100,
      quotaMaxBytes: 4096,
      currentEntryCount: 0,
      currentByteCount: 0,
      createdAt: now - 1000,
      updatedAt: now - 1000,
      deletedAt: now - 10_000,
    });

    const result = await purgeDeletedClientDataDomains(database.db, {
      gracePeriodMs: 5_000,
      now,
    });

    expect(result).toEqual({ deleted: 1, scanned: 1, skipped: 0 });

    const remainingDomains = await database.db.select().from(clientDataDomains);
    expect(remainingDomains).toHaveLength(0);
  });
});
