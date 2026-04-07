import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

import { DEFAULT_ADMIN_ACCOUNT_ID } from "../src/accounts/constants.js";
import { createDatabase, type DatabaseConnection } from "../src/db/client";
import { accounts, memoryItems, runtimeScopeStates } from "../src/db/schema";
import { MemoryMaintenanceService } from "../src/services/memory-maintenance-service";
import { MEMORY_RUNTIME_SCOPE_TYPE, buildMemoryRuntimeScopeKey } from "../src/services/memory-runtime-job-definitions.js";
import { buildApp, listMemoryMaintenanceScopes } from "../src/app";

function toContentJson(text: string): string {
  return JSON.stringify(text);
}

describe("MemoryMaintenanceService", () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = createDatabase(":memory:");
  });

  afterEach(() => {
    database.close();
  });

  it("deprecates old summary memories based on createdAt", async () => {
    const service = new MemoryMaintenanceService(database.db);

    const dayMs = 24 * 60 * 60 * 1000;
    const now = new Date("2020-01-01T00:00:00.000Z").getTime();

    await database.db.insert(memoryItems).values([
      {
        id: "sum-old",
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scope: "chat",
        scopeId: "s1",
        type: "summary",
        contentJson: toContentJson("old summary"),
        importance: 0.5,
        confidence: 1,
        status: "active",
        createdAt: now - 40 * dayMs,
        updatedAt: now - 40 * dayMs,
        sourceFloorId: null,
        sourceMessageId: null,
      },
      {
        id: "sum-new",
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scope: "chat",
        scopeId: "s1",
        type: "summary",
        contentJson: toContentJson("new summary"),
        importance: 0.5,
        confidence: 1,
        status: "active",
        createdAt: now - 10 * dayMs,
        updatedAt: now - 10 * dayMs,
        sourceFloorId: null,
        sourceMessageId: null,
      },
      {
        id: "fact-old",
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scope: "chat",
        scopeId: "s1",
        type: "fact",
        contentJson: toContentJson("fact: old"),
        importance: 0.5,
        confidence: 1,
        status: "active",
        createdAt: now - 40 * dayMs,
        updatedAt: now - 40 * dayMs,
        sourceFloorId: null,
        sourceMessageId: null,
      },
    ]);

    const result = await service.run({
      now,
      policy: {
        summaryMaxAgeMs: 30 * dayMs,
      },
    });

    expect(result.deprecated.summary).toBe(1);
    expect(result.deprecated.openLoop).toBe(0);
    expect(result.purged).toBe(0);

    const rows = await database.db
      .select({ id: memoryItems.id, status: memoryItems.status, updatedAt: memoryItems.updatedAt })
      .from(memoryItems);

    const byId = Object.fromEntries(rows.map((row) => [row.id, row] as const));

    expect(byId["sum-old"]?.status).toBe("deprecated");
    expect(byId["sum-old"]?.updatedAt).toBe(now);

    expect(byId["sum-new"]?.status).toBe("active");
    expect(byId["fact-old"]?.status).toBe("active");
  });

  it("supports dry-run mode (does not write)", async () => {
    const service = new MemoryMaintenanceService(database.db);

    const dayMs = 24 * 60 * 60 * 1000;
    const now = new Date("2020-01-01T00:00:00.000Z").getTime();

    await database.db.insert(memoryItems).values({
      id: "sum-old",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      scope: "chat",
      scopeId: "s1",
      type: "summary",
      contentJson: toContentJson("old summary"),
      importance: 0.5,
      confidence: 1,
      status: "active",
      createdAt: now - 40 * dayMs,
      updatedAt: now - 40 * dayMs,
      sourceFloorId: null,
      sourceMessageId: null,
    });

    const result = await service.run({
      now,
      dryRun: true,
      policy: { summaryMaxAgeMs: 30 * dayMs },
    });

    expect(result.deprecated.summary).toBe(1);

    const [row] = await database.db
      .select({ status: memoryItems.status })
      .from(memoryItems)
      .where(eq(memoryItems.id, "sum-old"));

    expect(row?.status).toBe("active");
  });

  it("purges deprecated memories based on updatedAt while deprecated, not createdAt", async () => {
    const service = new MemoryMaintenanceService(database.db);

    const dayMs = 24 * 60 * 60 * 1000;
    const now = new Date("2020-01-01T00:00:00.000Z").getTime();

    await database.db.insert(memoryItems).values([
      {
        id: "dep-old",
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scope: "chat",
        scopeId: "s1",
        type: "summary",
        contentJson: toContentJson("deprecated old"),
        importance: 0.5,
        confidence: 1,
        status: "deprecated",
        createdAt: now - 200 * dayMs,
        updatedAt: now - 100 * dayMs,
        sourceFloorId: null,
        sourceMessageId: null,
      },
      {
        id: "dep-touched",
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scope: "chat",
        scopeId: "s1",
        type: "summary",
        contentJson: toContentJson("deprecated but touched recently"),
        importance: 0.5,
        confidence: 1,
        status: "deprecated",
        createdAt: now - 200 * dayMs,
        updatedAt: now - 10 * dayMs,
        sourceFloorId: null,
        sourceMessageId: null,
      },
    ]);

    const result = await service.run({
      now,
      policy: { deprecatedPurgeAgeMs: 90 * dayMs },
    });

    expect(result.purged).toBe(1);

    const remaining = await database.db
      .select({ id: memoryItems.id })
      .from(memoryItems);

    expect(remaining.map((row) => row.id).sort()).toEqual(["dep-touched"]);
  });

  it("includes scopes that only exist in memory_scope_state when scheduling maintenance", async () => {
    const now = new Date("2020-01-04T00:00:00.000Z").getTime();

    await database.db.insert(accounts).values({
      id: "maintenance-account",
      name: "maintenance-account",
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(memoryItems).values({
      id: "scope-chat-item",
      accountId: "maintenance-account",
      scope: "chat",
      scopeId: "session-1",
      type: "summary",
      contentJson: toContentJson("session summary"),
      importance: 0.5,
      confidence: 1,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(runtimeScopeStates).values([
      {
        accountId: "maintenance-account",
        scopeType: MEMORY_RUNTIME_SCOPE_TYPE,
        scopeKey: buildMemoryRuntimeScopeKey("chat", "session-1"),
        revision: 1,
        leaseOwner: null,
        leaseUntil: null,
        lastProcessedAt: now,
        lastSuccessJobId: null,
        metadataJson: JSON.stringify({
          lastProcessedFloorNo: 4,
          lastCompactionAt: null,
        }),
        updatedAt: now,
      },
      {
        accountId: "maintenance-account",
        scopeType: MEMORY_RUNTIME_SCOPE_TYPE,
        scopeKey: buildMemoryRuntimeScopeKey("global", "maintenance-account"),
        revision: 2,
        leaseOwner: null,
        leaseUntil: null,
        lastProcessedAt: now,
        lastSuccessJobId: null,
        metadataJson: JSON.stringify({
          lastProcessedFloorNo: 8,
          lastCompactionAt: now - 1_000,
        }),
        updatedAt: now,
      },
    ]);

    const scopes = await listMemoryMaintenanceScopes(database.db);

    expect(scopes).toHaveLength(2);
    expect(scopes).toEqual(expect.arrayContaining([
      { accountId: "maintenance-account", scope: "chat", scopeId: "session-1" },
      { accountId: "maintenance-account", scope: "global", scopeId: "maintenance-account" },
    ]));
  });
});

describe("buildApp memory maintenance scheduler", () => {
  it("clears the maintenance interval on app.close", async () => {
    vi.useFakeTimers();
    try {
      const { app } = await buildApp({
        databasePath: ":memory:",
        logger: false,
        enableMemory: true,
        memoryMaintenance: {
          intervalMs: 10_000,
          dryRun: true,
          policy: {},
        },
      });

      const timerCountBefore = vi.getTimerCount();
      expect(timerCountBefore).toBeGreaterThan(0);

      await app.close();

      const timerCountAfter = vi.getTimerCount();
      expect(timerCountAfter).toBeLessThan(timerCountBefore);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the async memory worker interval on app.close", async () => {
    vi.useFakeTimers();
    try {
      const { app } = await buildApp({
        databasePath: ":memory:",
        logger: false,
        enableWebSocket: false,
        enableMemory: true,
        enableAsyncMemoryIngest: true,
        orchestration: {
          providers: [
            {
              id: "test-provider",
              type: "openai-compatible",
              apiKey: "sk-test",
            },
          ],
          defaultModel: {
            providerId: "test-provider",
            modelId: "gpt-4o-mini",
          },
        },
      });

      const timerCountBefore = vi.getTimerCount();
      expect(timerCountBefore).toBeGreaterThan(0);

      await app.close();

      expect(vi.getTimerCount()).toBeLessThan(timerCountBefore);
    } finally {
      vi.useRealTimers();
    }
  });
});
