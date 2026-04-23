import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { buildBranchMemoryScopeId } from "@tavern/shared";
import { createEventBus, type CoreEventMap, type MemoryItem } from "@tavern/core";

import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../accounts/constants.js";
import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { accounts, memoryEdges, memoryItems } from "../../db/schema.js";
import {
  executeCommittedMemoryTransaction,
  ManualMemoryMutationService,
} from "../manual-memory-mutation-service.js";

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

describe("ManualMemoryMutationService", () => {
  let database: DatabaseConnection;
  let eventBus: ReturnType<typeof createEventBus>;
  let service: ManualMemoryMutationService;

  beforeEach(async () => {
    database = createDatabase(":memory:");
    eventBus = createEventBus();
    service = new ManualMemoryMutationService(database.db, { eventBus, now: () => 1_736_400_000_000 });
    await seedAccount(database, 1_736_399_999_000);
  });

  afterEach(() => {
    database.close();
  });

  it("creates manual memory items and emits committed memory.created with branch context", async () => {
    const createdHandler = vi.fn();
    eventBus.on("memory.created", createdHandler);
    const scopeId = buildBranchMemoryScopeId("session-branch-1", "branch-a");

    const created = await service.createItem({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      scope: "branch",
      scopeId,
      type: "fact",
      contentJson: JSON.stringify({ text: "manual branch fact" }),
      factKey: "topic",
      importance: 0.7,
      confidence: 0.8,
    });

    expect(created.scope).toBe("branch");
    expect(created.factKey).toBe("topic");
    expect(createdHandler).toHaveBeenCalledTimes(1);
    expect(createdHandler).toHaveBeenCalledWith(expect.objectContaining({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      sessionId: "session-branch-1",
      branchId: "branch-a",
      scope: "branch",
      scopeId,
      entityType: "memory_item",
      entityId: created.id,
      source: "manual",
      after: expect.objectContaining({ id: created.id, content: "manual branch fact" }),
    }));
  });

  it("emits memory.deprecated instead of memory.updated when a manual item becomes deprecated", async () => {
    const deprecatedHandler = vi.fn();
    const updatedHandler = vi.fn();
    eventBus.on("memory.deprecated", deprecatedHandler);
    eventBus.on("memory.updated", updatedHandler);

    const created = await service.createItem({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      scope: "chat",
      scopeId: "session-chat-1",
      type: "fact",
      contentJson: JSON.stringify("chat fact"),
      factKey: "status",
    });

    deprecatedHandler.mockClear();

    const updated = await service.updateItem({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      id: created.id,
      status: "deprecated",
    });

    expect(updated?.status).toBe("deprecated");
    expect(updated?.lifecycleStatus).toBe("deprecated");
    expect(deprecatedHandler).toHaveBeenCalledTimes(1);
    expect(updatedHandler).not.toHaveBeenCalled();
    expect(deprecatedHandler).toHaveBeenCalledWith(expect.objectContaining({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      sessionId: "session-chat-1",
      scope: "chat",
      scopeId: "session-chat-1",
      entityType: "memory_item",
      entityId: created.id,
      source: "manual",
      reason: "manual",
      before: expect.objectContaining({ id: created.id, status: "active" }),
      after: expect.objectContaining({ id: created.id, status: "deprecated" }),
    }));
  });

  it("emits cascaded edge delete truth before manual memory.deleted when deleting an item", async () => {
    const deletedHandler = vi.fn();
    const edgeDeletedHandler = vi.fn();
    eventBus.on("memory.deleted", deletedHandler);
    eventBus.on("memory.edge.deleted", edgeDeletedHandler);

    const left = await service.createItem({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      scope: "chat",
      scopeId: "session-chat-2",
      type: "fact",
      contentJson: JSON.stringify({ text: "left" }),
      factKey: "left",
    });
    const right = await service.createItem({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      scope: "chat",
      scopeId: "session-chat-2",
      type: "summary",
      contentJson: JSON.stringify({ text: "right" }),
    });

    const edge = await service.createEdge({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      fromId: left.id,
      toId: right.id,
      relation: "supports",
    });

    deletedHandler.mockClear();
    edgeDeletedHandler.mockClear();

    const deleted = await service.deleteItem({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      id: left.id,
    });

    expect(deleted?.id).toBe(left.id);
    expect(edgeDeletedHandler).toHaveBeenCalledTimes(1);
    expect(edgeDeletedHandler).toHaveBeenCalledWith(expect.objectContaining({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      sessionId: "session-chat-2",
      scope: "chat",
      scopeId: "session-chat-2",
      entityType: "memory_edge",
      entityId: edge.id,
      before: expect.objectContaining({ id: edge.id, relation: "supports" }),
      source: "manual",
    }));
    expect(deletedHandler).toHaveBeenCalledTimes(1);
    expect(deletedHandler).toHaveBeenCalledWith(expect.objectContaining({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      sessionId: "session-chat-2",
      scope: "chat",
      scopeId: "session-chat-2",
      entityType: "memory_item",
      entityId: left.id,
      before: expect.objectContaining({ id: left.id, content: "left" }),
      source: "manual",
    }));

    const persistedEdge = await database.db.select().from(memoryEdges).where(eq(memoryEdges.id, edge.id));
    expect(persistedEdge).toEqual([]);
  });

  it("emits delete-plus-create edge truth when the manual edge relation changes", async () => {
    const edgeCreatedHandler = vi.fn();
    const edgeDeletedHandler = vi.fn();
    eventBus.on("memory.edge.created", edgeCreatedHandler);
    eventBus.on("memory.edge.deleted", edgeDeletedHandler);

    const left = await service.createItem({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      scope: "chat",
      scopeId: "session-chat-3",
      type: "fact",
      contentJson: JSON.stringify("left item"),
      factKey: "left",
    });
    const right = await service.createItem({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      scope: "chat",
      scopeId: "session-chat-3",
      type: "fact",
      contentJson: JSON.stringify("right item"),
      factKey: "right",
    });

    const created = await service.createEdge({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      fromId: left.id,
      toId: right.id,
      relation: "supports",
    });

    edgeCreatedHandler.mockClear();
    edgeDeletedHandler.mockClear();

    const updated = await service.updateEdgeRelation({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      id: created.id,
      relation: "updates",
    });

    expect(updated?.relation).toBe("updates");
    expect(edgeDeletedHandler).toHaveBeenCalledTimes(1);
    expect(edgeCreatedHandler).toHaveBeenCalledTimes(1);
    expect(edgeDeletedHandler).toHaveBeenCalledWith(expect.objectContaining({
      entityId: created.id,
      before: expect.objectContaining({ id: created.id, relation: "supports" }),
      source: "manual",
    }));
    expect(edgeCreatedHandler).toHaveBeenCalledWith(expect.objectContaining({
      entityId: created.id,
      after: expect.objectContaining({ id: created.id, relation: "updates" }),
      source: "manual",
    }));
  });

  it("does not emit pending events when a committed memory transaction rolls back", async () => {
    const createdHandler = vi.fn();
    eventBus.on("memory.created", createdHandler);

    const item: MemoryItem = {
      id: "memory-rollback",
      scope: "chat",
      scopeId: "session-rollback",
      type: "fact",
      content: "rollback",
      factKey: "rollback",
      importance: 0.5,
      confidence: 1,
      status: "active",
      lifecycleStatus: "active",
      createdAt: 1_736_400_000_000,
      updatedAt: 1_736_400_000_000,
    };

    await expect(executeCommittedMemoryTransaction({
      db: database.db,
      eventBus,
      now: () => 1_736_400_000_000,
      commit: (tx, context) => {
        tx.insert(memoryItems)
          .values({
            id: item.id,
            accountId: DEFAULT_ADMIN_ACCOUNT_ID,
            scope: item.scope,
            scopeId: item.scopeId,
            type: item.type,
            summaryTier: null,
            contentJson: JSON.stringify(item.content),
            factKey: item.factKey ?? null,
            importance: item.importance,
            confidence: item.confidence,
            sourceFloorId: null,
            sourceMessageId: null,
            status: item.status,
            lifecycleStatus: item.lifecycleStatus,
            sourceJobId: null,
            tokenCountEstimate: null,
            lastUsedAt: null,
            coverageStartFloorNo: null,
            coverageEndFloorNo: null,
            derivedFromCount: null,
            createdAt: context.timestamp,
            updatedAt: context.timestamp,
          })
          .run();

        context.pendingEvents.push({
          name: "memory.created",
          payload: {
            mutationId: context.mutationId,
            accountId: DEFAULT_ADMIN_ACCOUNT_ID,
            sessionId: item.scopeId,
            scope: item.scope,
            scopeId: item.scopeId,
            entityType: "memory_item",
            entityId: item.id,
            item,
            after: item,
            source: "manual",
          } as CoreEventMap["memory.created"],
        });

        throw new Error("rollback requested");
      },
    })).rejects.toThrow("rollback requested");

    expect(createdHandler).not.toHaveBeenCalled();
    const rows = await database.db.select().from(memoryItems).where(eq(memoryItems.id, item.id));
    expect(rows).toEqual([]);
  });
});
