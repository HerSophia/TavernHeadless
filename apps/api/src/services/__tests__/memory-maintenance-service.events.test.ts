import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createEventBus } from "@tavern/core";

import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../accounts/constants.js";
import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { accounts, memoryEdges, memoryItems } from "../../db/schema.js";
import { MemoryMaintenanceService } from "../memory-maintenance-service.js";

async function seedAccount(database: DatabaseConnection, now: number): Promise<void> {
  const existing = await database.db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, DEFAULT_ADMIN_ACCOUNT_ID)).limit(1);
  if (existing.length > 0) {
    return;
  }

  await database.db.insert(accounts).values({
    id: DEFAULT_ADMIN_ACCOUNT_ID,
    name: "Admin",
    role: "admin",
    status: "active",
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  });
}

function toContentJson(text: string): string {
  return JSON.stringify(text);
}

describe("MemoryMaintenanceService committed event contract", () => {
  let database: DatabaseConnection;
  let eventBus: ReturnType<typeof createEventBus>;
  const now = new Date("2020-01-01T00:00:00.000Z").getTime();
  const dayMs = 24 * 60 * 60 * 1000;

  beforeEach(async () => {
    database = createDatabase(":memory:");
    eventBus = createEventBus();
    await seedAccount(database, now - 365 * dayMs);
  });

  afterEach(() => {
    database.close();
  });

  it("emits per-item memory.deprecated events with source='maintenance' when deprecating aged summaries", async () => {
    const service = new MemoryMaintenanceService(database.db, { eventBus });
    const deprecatedHandler = vi.fn();
    const updatedHandler = vi.fn();
    eventBus.on("memory.deprecated", deprecatedHandler);
    eventBus.on("memory.updated", updatedHandler);

    await database.db.insert(memoryItems).values([
      {
        id: "sum-aged",
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scope: "chat",
        scopeId: "s1",
        type: "summary",
        contentJson: toContentJson("old summary"),
        importance: 0.5,
        confidence: 1,
        status: "active",
        lifecycleStatus: "active",
        createdAt: now - 40 * dayMs,
        updatedAt: now - 40 * dayMs,
      },
      {
        id: "sum-fresh",
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scope: "chat",
        scopeId: "s1",
        type: "summary",
        contentJson: toContentJson("new summary"),
        importance: 0.5,
        confidence: 1,
        status: "active",
        lifecycleStatus: "active",
        createdAt: now - 10 * dayMs,
        updatedAt: now - 10 * dayMs,
      },
    ]);

    const result = await service.run({
      now,
      policy: { summaryMaxAgeMs: 30 * dayMs },
    });

    expect(result.deprecated.summary).toBe(1);
    expect(updatedHandler).not.toHaveBeenCalled();
    expect(deprecatedHandler).toHaveBeenCalledTimes(1);
    expect(deprecatedHandler).toHaveBeenCalledWith(expect.objectContaining({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      sessionId: "s1",
      scope: "chat",
      scopeId: "s1",
      entityType: "memory_item",
      entityId: "sum-aged",
      reason: "maintenance",
      source: "maintenance",
      before: expect.objectContaining({ id: "sum-aged", status: "active" }),
      after: expect.objectContaining({ id: "sum-aged", status: "deprecated", lifecycleStatus: "deprecated" }),
    }));
  });

  it("emits memory.edge.deleted before memory.deleted when purging deprecated items with edges", async () => {
    const service = new MemoryMaintenanceService(database.db, { eventBus });
    const emissions: Array<{ name: string; payload: unknown }> = [];
    eventBus.on("memory.deleted", (payload) => {
      emissions.push({ name: "memory.deleted", payload });
    });
    eventBus.on("memory.edge.deleted", (payload) => {
      emissions.push({ name: "memory.edge.deleted", payload });
    });

    await database.db.insert(memoryItems).values([
      {
        id: "dep-purge",
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scope: "chat",
        scopeId: "s1",
        type: "summary",
        contentJson: toContentJson("old deprecated"),
        importance: 0.5,
        confidence: 1,
        status: "deprecated",
        lifecycleStatus: "deprecated",
        createdAt: now - 200 * dayMs,
        updatedAt: now - 100 * dayMs,
      },
      {
        id: "dep-keep",
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scope: "chat",
        scopeId: "s1",
        type: "summary",
        contentJson: toContentJson("keep summary"),
        importance: 0.5,
        confidence: 1,
        status: "active",
        lifecycleStatus: "active",
        createdAt: now - 200 * dayMs,
        updatedAt: now - 100 * dayMs,
      },
    ]);

    await database.db.insert(memoryEdges).values({
      id: "edge-purge",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      fromId: "dep-keep",
      toId: "dep-purge",
      relation: "updates",
      createdAt: now - 100 * dayMs,
    });

    const result = await service.run({
      now,
      policy: { deprecatedPurgeAgeMs: 90 * dayMs },
    });

    expect(result.purged).toBe(1);

    const edgeIndex = emissions.findIndex((entry) => entry.name === "memory.edge.deleted");
    const itemIndex = emissions.findIndex((entry) => entry.name === "memory.deleted");
    expect(edgeIndex).toBeGreaterThanOrEqual(0);
    expect(itemIndex).toBeGreaterThanOrEqual(0);
    expect(edgeIndex).toBeLessThan(itemIndex);

    const itemPayload = emissions[itemIndex]?.payload as { entityType?: string; entityId?: string; source?: string };
    expect(itemPayload.entityType).toBe("memory_item");
    expect(itemPayload.entityId).toBe("dep-purge");
    expect(itemPayload.source).toBe("maintenance");

    const edgePayload = emissions[edgeIndex]?.payload as { entityType?: string; entityId?: string; source?: string };
    expect(edgePayload.entityType).toBe("memory_edge");
    expect(edgePayload.entityId).toBe("edge-purge");
    expect(edgePayload.source).toBe("maintenance");
  });

  it("does not emit any events in dry-run mode", async () => {
    const service = new MemoryMaintenanceService(database.db, { eventBus });
    const handler = vi.fn();
    eventBus.on("memory.deprecated", handler);
    eventBus.on("memory.deleted", handler);
    eventBus.on("memory.edge.deleted", handler);

    await database.db.insert(memoryItems).values({
      id: "sum-aged",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      scope: "chat",
      scopeId: "s1",
      type: "summary",
      contentJson: toContentJson("old summary"),
      importance: 0.5,
      confidence: 1,
      status: "active",
      lifecycleStatus: "active",
      createdAt: now - 40 * dayMs,
      updatedAt: now - 40 * dayMs,
    });

    const result = await service.run({
      now,
      dryRun: true,
      policy: { summaryMaxAgeMs: 30 * dayMs },
    });

    expect(result.deprecated.summary).toBe(1);
    expect(handler).not.toHaveBeenCalled();
  });

  it("emits no memory events when runInTransaction results are dropped by an outer transaction rollback", async () => {
    const service = new MemoryMaintenanceService(database.db, { eventBus });
    const handler = vi.fn();
    eventBus.on("memory.deprecated", handler);
    eventBus.on("memory.deleted", handler);
    eventBus.on("memory.edge.deleted", handler);

    await database.db.insert(memoryItems).values({
      id: "sum-rollback",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      scope: "chat",
      scopeId: "s1",
      type: "summary",
      contentJson: toContentJson("aged summary"),
      importance: 0.5,
      confidence: 1,
      status: "active",
      lifecycleStatus: "active",
      createdAt: now - 40 * dayMs,
      updatedAt: now - 40 * dayMs,
    });

    expect(() => {
      database.db.transaction((tx) => {
        // 误写入 pendingEvents、然后主动抛错触发外层事务回滚。
        const result = service.runInTransaction(tx, {
          now,
          policy: { summaryMaxAgeMs: 30 * dayMs },
        }, []);
        expect(result.deprecated.summary).toBe(1);
        throw new Error("forced rollback");
      });
    }).toThrow("forced rollback");

    // 事务回滚后：数据库行不应持久化。
    const rows = await database.db
      .select({ status: memoryItems.status })
      .from(memoryItems)
      .where(eq(memoryItems.id, "sum-rollback"));
    expect(rows[0]?.status).toBe("active");

    // 模拟运行时作业处理器的不变量：pendingEvents 仅在 afterCommit 干活中发布，
    // 而回滚路径下调用方不会跳到 afterCommit，所以事件总体不会被观察到。
    expect(handler).not.toHaveBeenCalled();
  });

});
