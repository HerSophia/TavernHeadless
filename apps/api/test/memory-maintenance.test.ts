import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

import { createDatabase, type DatabaseConnection } from "../src/db/client";
import { memoryItems } from "../src/db/schema";
import { MemoryMaintenanceService } from "../src/services/memory-maintenance-service";
import { buildApp } from "../src/app";

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
});
