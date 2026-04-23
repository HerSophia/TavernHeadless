import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { buildBranchMemoryScopeId } from "@tavern/shared";

import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../accounts/constants.js";
import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { accounts } from "../../db/schema.js";
import {
  applyTransactionalMemoryMutations,
  type PendingCoreEvent,
} from "../memory-transaction-mutations.js";

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

describe("applyTransactionalMemoryMutations committed event payload", () => {
  let database: DatabaseConnection;
  const timestamp = 1_736_400_000_000;

  beforeEach(async () => {
    database = createDatabase(":memory:");
    await seedAccount(database, timestamp - 1_000);
  });

  afterEach(() => {
    database.close();
  });

  it("emits memory.created for branch-scoped summaries with mutationId, accountId, branchId, entityType, entityId, after", () => {
    const pendingEvents: PendingCoreEvent[] = [];
    const scopeId = buildBranchMemoryScopeId("session-1", "branch-a");

    const result = database.db.transaction((tx) => {
      return applyTransactionalMemoryMutations({
        tx,
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        timestamp,
        pendingEvents,
        summaries: ["branch summary truth"],
        defaultScope: "branch",
        defaultScopeId: scopeId,
        scopeContext: {
          accountId: DEFAULT_ADMIN_ACCOUNT_ID,
          sessionId: "session-1",
          branchId: "branch-a",
          floorId: "floor-x",
        },
        sourceFloorId: "floor-x",
      });
    });

    expect(result.created).toBe(1);
    const createdEvent = pendingEvents.find((entry) => entry.name === "memory.created");
    expect(createdEvent).toBeDefined();
    const payload = createdEvent!.payload as unknown as Record<string, unknown>;
    expect(payload.mutationId).toEqual(expect.any(String));
    expect(payload.accountId).toBe(DEFAULT_ADMIN_ACCOUNT_ID);
    expect(payload.sessionId).toBe("session-1");
    expect(payload.branchId).toBe("branch-a");
    expect(payload.scope).toBe("branch");
    expect(payload.scopeId).toBe(scopeId);
    expect(payload.floorId).toBe("floor-x");
    expect(payload.entityType).toBe("memory_item");
    const item = payload.item as { id?: string } | undefined;
    expect(typeof item?.id).toBe("string");
    expect(payload.entityId).toBe(item!.id);
    expect(payload.source).toBe("extraction");
    const after = payload.after as { id?: string } | undefined;
    expect(after?.id).toBe(item!.id);
  });

  it("accepts an external mutationId so multiple committed events within one transaction share the same mutationId", () => {
    const pendingEvents: PendingCoreEvent[] = [];
    const externalMutationId = "mut-external-test";

    database.db.transaction((tx) => {
      return applyTransactionalMemoryMutations({
        tx,
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        timestamp,
        pendingEvents,
        mutationId: externalMutationId,
        summaries: ["summary a", "summary b"],
        defaultScope: "chat",
        defaultScopeId: "session-1",
        scopeContext: {
          accountId: DEFAULT_ADMIN_ACCOUNT_ID,
          sessionId: "session-1",
        },
        sourceFloorId: "floor-y",
      });
    });

    const createdEvents = pendingEvents.filter((entry) => entry.name === "memory.created");
    expect(createdEvents).toHaveLength(2);
    for (const event of createdEvents) {
      const payload = event.payload as unknown as Record<string, unknown>;
      expect(payload.mutationId).toBe(externalMutationId);
      expect(payload.accountId).toBe(DEFAULT_ADMIN_ACCOUNT_ID);
      expect(payload.sessionId).toBe("session-1");
      expect(payload.scope).toBe("chat");
      expect(payload.scopeId).toBe("session-1");
      expect(payload.entityType).toBe("memory_item");
      expect(payload.source).toBe("extraction");
    }
  });
});
