import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MissingAccountContextError } from "../../accounts/account-context.js";
import { createDatabase, type AppDb } from "../../db/client";
import { accounts } from "../../db/schema";
import { DrizzleMemoryRepository } from "../drizzle-memory-repository";
import type { MemoryItem, MemoryEdge } from "@tavern/core";

type CreateInput = Omit<MemoryItem, "id" | "createdAt" | "updatedAt">;

async function seedAccount(db: AppDb, id: string): Promise<void> {
  const now = Date.now();
  await db.insert(accounts).values({
    id,
    name: id,
    createdAt: now,
    updatedAt: now,
  });
}

function makeItem(overrides: Partial<CreateInput> = {}): CreateInput {
  return {
    scope: "chat",
    scopeId: "session-1",
    type: "fact",
    content: "Test fact content",
    importance: 0.5,
    confidence: 1,
    status: "active",
    ...overrides,
  };
}

describe("DrizzleMemoryRepository", () => {
  let db: AppDb;
  let repo: DrizzleMemoryRepository;
  let closeDb: () => void;

  beforeEach(() => {
    const conn = createDatabase(":memory:");
    db = conn.db;
    closeDb = conn.close;
    repo = new DrizzleMemoryRepository(db);
  });

  afterEach(() => {
    closeDb();
  });

  // ── findById ────────────────────────────────────────

  it("returns null for non-existent id", async () => {
    const result = await repo.findById("non-existent");
    expect(result).toBeNull();
  });

  it("returns MemoryItem with parsed content", async () => {
    const created = await repo.create(makeItem({ content: "The sky is blue" }));

    const result = await repo.findById(created.id);

    expect(result).not.toBeNull();
    expect(result!.id).toBe(created.id);
    expect(result!.content).toBe("The sky is blue");
    expect(result!.scope).toBe("chat");
    expect(result!.scopeId).toBe("session-1");
    expect(result!.type).toBe("fact");
    expect(result!.importance).toBe(0.5);
    expect(result!.confidence).toBe(1);
    expect(result!.status).toBe("active");
  });

  // ── create ──────────────────────────────────────────

  it("creates item with generated id and timestamps", async () => {
    const before = Date.now();
    const item = await repo.create(makeItem());
    const after = Date.now();

    expect(typeof item.id).toBe("string");
    expect(item.id.length).toBeGreaterThan(0);
    expect(item.createdAt).toBeGreaterThanOrEqual(before);
    expect(item.createdAt).toBeLessThanOrEqual(after);
    expect(item.updatedAt).toBe(item.createdAt);
  });

  it("stores sourceFloorId and sourceMessageId", async () => {
    const item = await repo.create(
      makeItem({ sourceFloorId: "floor-1", sourceMessageId: "msg-1" }),
    );

    const found = await repo.findById(item.id);
    expect(found!.sourceFloorId).toBe("floor-1");
    expect(found!.sourceMessageId).toBe("msg-1");
  });

  it("maps Memory V2 summary metadata and supports lifecycle filters", async () => {
    const item = await repo.create(
      makeItem({
        type: "summary",
        content: "Micro summary",
        summaryTier: "micro",
        lifecycleStatus: "compacted",
        sourceJobId: "job-1",
        tokenCountEstimate: 128,
        lastUsedAt: 1_735_689_660_000,
        coverageStartFloorNo: 3,
        coverageEndFloorNo: 5,
        derivedFromCount: 2,
      }),
    );

    const result = await repo.findMany({
      type: "summary",
      summaryTier: "micro",
      lifecycleStatus: "compacted",
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: item.id,
      summaryTier: "micro",
      lifecycleStatus: "compacted",
      sourceJobId: "job-1",
      tokenCountEstimate: 128,
      lastUsedAt: 1_735_689_660_000,
      coverageStartFloorNo: 3,
      coverageEndFloorNo: 5,
      derivedFromCount: 2,
    });
  });

  it("handles undefined sourceFloorId/sourceMessageId", async () => {
    const item = await repo.create(makeItem());

    const found = await repo.findById(item.id);
    expect(found!.sourceFloorId).toBeUndefined();
    expect(found!.sourceMessageId).toBeUndefined();
  });

  it("stores factKey when provided", async () => {
    const item = await repo.create(makeItem({ content: "Weather: sunny", factKey: "weather" }));

    const found = await repo.findById(item.id);

    expect(found).not.toBeNull();
    expect(found!.factKey).toBe("weather");
  });

  // ── findMany ────────────────────────────────────────

  it("returns empty array when no items match", async () => {
    const result = await repo.findMany({ scope: "global", scopeId: "g" });
    expect(result).toEqual([]);
  });

  it("filters by scope and scopeId", async () => {
    await repo.create(makeItem({ scope: "chat", scopeId: "s1", content: "A" }));
    await repo.create(makeItem({ scope: "chat", scopeId: "s2", content: "B" }));
    await repo.create(makeItem({ scope: "global", scopeId: "g", content: "C" }));

    const result = await repo.findMany({ scope: "chat", scopeId: "s1" });
    expect(result).toHaveLength(1);
    expect(result[0]!.content).toBe("A");
  });

  it("filters by type", async () => {
    await repo.create(makeItem({ type: "fact", content: "Fact" }));
    await repo.create(makeItem({ type: "summary", content: "Summary" }));

    const result = await repo.findMany({ type: "summary" });
    expect(result).toHaveLength(1);
    expect(result[0]!.content).toBe("Summary");
  });

  it("filters by status", async () => {
    await repo.create(makeItem({ status: "active", content: "Active" }));
    await repo.create(makeItem({ status: "deprecated", content: "Old" }));

    const result = await repo.findMany({ status: "active" });
    expect(result).toHaveLength(1);
    expect(result[0]!.content).toBe("Active");
  });

  it("filters by minImportance", async () => {
    await repo.create(makeItem({ importance: 0.3, content: "Low" }));
    await repo.create(makeItem({ importance: 0.8, content: "High" }));

    const result = await repo.findMany({ minImportance: 0.5 });
    expect(result).toHaveLength(1);
    expect(result[0]!.content).toBe("High");
  });

  it("sorts by importance desc by default", async () => {
    await repo.create(makeItem({ importance: 0.3, content: "Low" }));
    await repo.create(makeItem({ importance: 0.9, content: "High" }));
    await repo.create(makeItem({ importance: 0.6, content: "Mid" }));

    const result = await repo.findMany({ orderBy: "importance", orderDir: "desc" });
    expect(result.map((r) => r.content)).toEqual(["High", "Mid", "Low"]);
  });

  it("sorts by createdAt asc", async () => {
    const a = await repo.create(makeItem({ content: "First" }));
    const b = await repo.create(makeItem({ content: "Second" }));

    const result = await repo.findMany({ orderBy: "createdAt", orderDir: "asc" });
    expect(result[0]!.content).toBe("First");
    expect(result[1]!.content).toBe("Second");
  });

  it("respects limit", async () => {
    await repo.create(makeItem({ content: "A" }));
    await repo.create(makeItem({ content: "B" }));
    await repo.create(makeItem({ content: "C" }));

    const result = await repo.findMany({ limit: 2 });
    expect(result).toHaveLength(2);
  });

  it("combines multiple filters", async () => {
    await repo.create(makeItem({ scope: "chat", scopeId: "s1", type: "fact", status: "active", importance: 0.8, content: "Match" }));
    await repo.create(makeItem({ scope: "chat", scopeId: "s1", type: "fact", status: "deprecated", importance: 0.9, content: "Wrong status" }));
    await repo.create(makeItem({ scope: "chat", scopeId: "s1", type: "summary", status: "active", importance: 0.8, content: "Wrong type" }));
    await repo.create(makeItem({ scope: "chat", scopeId: "s1", type: "fact", status: "active", importance: 0.2, content: "Too low" }));

    const result = await repo.findMany({
      scope: "chat",
      scopeId: "s1",
      type: "fact",
      status: "active",
      minImportance: 0.5,
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.content).toBe("Match");
  });

  // ── update ──────────────────────────────────────────

  it("returns null when updating non-existent item", async () => {
    const result = await repo.update("non-existent", { content: "New" });
    expect(result).toBeNull();
  });

  it("updates content", async () => {
    const created = await repo.create(makeItem({ content: "Old" }));

    const updated = await repo.update(created.id, { content: "New" });

    expect(updated!.content).toBe("New");
    expect(updated!.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);
  });

  it("updates importance and confidence", async () => {
    const created = await repo.create(makeItem({ importance: 0.5, confidence: 1.0 }));

    const updated = await repo.update(created.id, { importance: 0.9, confidence: 0.7 });

    expect(updated!.importance).toBe(0.9);
    expect(updated!.confidence).toBe(0.7);
  });

  it("partial update preserves other fields", async () => {
    const created = await repo.create(makeItem({ content: "Keep", importance: 0.5 }));

    const updated = await repo.update(created.id, { importance: 0.9 });

    expect(updated!.content).toBe("Keep");
    expect(updated!.importance).toBe(0.9);
  });

  it("updates factKey", async () => {
    const created = await repo.create(makeItem({ content: "Location: town", factKey: "location" }));

    const updated = await repo.update(created.id, { factKey: "home_location" });

    expect(updated).not.toBeNull();
    expect(updated!.factKey).toBe("home_location");
  });

  it("updates lifecycleStatus without forcing deprecated status", async () => {
    const created = await repo.create(makeItem({ type: "summary", summaryTier: "micro", lifecycleStatus: "active" }));

    const updated = await repo.update(created.id, { lifecycleStatus: "compacted" });

    expect(updated).not.toBeNull();
    expect(updated!.status).toBe("active");
    expect(updated!.lifecycleStatus).toBe("compacted");
  });

  // ── deprecate ───────────────────────────────────────

  it("returns null when deprecating non-existent item", async () => {
    const result = await repo.deprecate("non-existent");
    expect(result).toBeNull();
  });

  it("sets status to deprecated", async () => {
    const created = await repo.create(makeItem({ status: "active" }));

    const deprecated = await repo.deprecate(created.id);

    expect(deprecated!.status).toBe("deprecated");
    expect(deprecated!.lifecycleStatus).toBe("deprecated");
    expect(deprecated!.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);
  });

  // ── remove / removeMany ──────────────────────────────

  it("removes item and returns the deleted snapshot", async () => {
    const created = await repo.create(makeItem({ content: "Disposable" }));

    const removed = await repo.remove(created.id);

    expect(removed).not.toBeNull();
    expect(removed!.id).toBe(created.id);
    expect(removed!.content).toBe("Disposable");
    expect(await repo.findById(created.id)).toBeNull();
  });

  it("removes many items in input order and skips missing ids", async () => {
    const first = await repo.create(makeItem({ content: "First" }));
    const second = await repo.create(makeItem({ content: "Second" }));

    const removed = await repo.removeMany(["missing", second.id, first.id]);

    expect(removed.map((item) => item.id)).toEqual([second.id, first.id]);
    expect(removed.map((item) => item.content)).toEqual(["Second", "First"]);
    expect(await repo.findById(first.id)).toBeNull();
    expect(await repo.findById(second.id)).toBeNull();
  });

  // ── createEdge ──────────────────────────────────────

  it("creates edge with generated id and timestamp", async () => {
    const item1 = await repo.create(makeItem({ content: "A" }));
    const item2 = await repo.create(makeItem({ content: "B" }));

    const before = Date.now();
    const edge = await repo.createEdge({
      fromId: item1.id,
      toId: item2.id,
      relation: "supports",
    });

    expect(typeof edge.id).toBe("string");
    expect(edge.fromId).toBe(item1.id);
    expect(edge.toId).toBe(item2.id);
    expect(edge.relation).toBe("supports");
    expect(edge.createdAt).toBeGreaterThanOrEqual(before);
  });

  // ── findEdgeById / removeEdge ───────────────────────

  it("finds and removes edges by id", async () => {
    const item1 = await repo.create(makeItem({ content: "A" }));
    const item2 = await repo.create(makeItem({ content: "B" }));
    const created = await repo.createEdge({
      fromId: item1.id,
      toId: item2.id,
      relation: "supports",
    });

    const found = await repo.findEdgeById(created.id);
    expect(found).toEqual(created);

    const removed = await repo.removeEdge(created.id);
    expect(removed).toEqual(created);
    expect(await repo.findEdgeById(created.id)).toBeNull();
    expect(await repo.findEdges(item1.id)).toEqual([]);
  });

  it("returns null for missing edge ids", async () => {
    expect(await repo.findEdgeById("missing-edge")).toBeNull();
    expect(await repo.removeEdge("missing-edge")).toBeNull();
  });

  // ── findEdges ───────────────────────────────────────

  it("returns empty array when no edges exist", async () => {
    const item = await repo.create(makeItem());
    const result = await repo.findEdges(item.id);
    expect(result).toEqual([]);
  });

  it("finds edges where item is fromId or toId", async () => {
    const a = await repo.create(makeItem({ content: "A" }));
    const b = await repo.create(makeItem({ content: "B" }));
    const c = await repo.create(makeItem({ content: "C" }));

    await repo.createEdge({ fromId: a.id, toId: b.id, relation: "supports" });
    await repo.createEdge({ fromId: c.id, toId: a.id, relation: "contradicts" });
    await repo.createEdge({ fromId: b.id, toId: c.id, relation: "updates" }); // unrelated to a

    const edges = await repo.findEdges(a.id);

    expect(edges).toHaveLength(2);
    const relations = edges.map((e) => e.relation).sort();
    expect(relations).toEqual(["contradicts", "supports"]);
  });

  it("supports shared-repository account isolation through query.accountId", async () => {
    await seedAccount(db, "account-a");
    await seedAccount(db, "account-b");

    const sharedRepo = new DrizzleMemoryRepository(db);
    await sharedRepo.create(makeItem({ scopeId: "shared-session", content: "A" }), { accountId: "account-a" });
    await sharedRepo.create(makeItem({ scopeId: "shared-session", content: "B" }), { accountId: "account-b" });

    const accountAItems = await sharedRepo.findMany({
      accountId: "account-a",
      scope: "chat",
      scopeId: "shared-session",
    });
    const accountBItems = await sharedRepo.findMany({
      accountId: "account-b",
      scope: "chat",
      scopeId: "shared-session",
    });

    expect(accountAItems.map((item) => item.content)).toEqual(["A"]);
    expect(accountBItems.map((item) => item.content)).toEqual(["B"]);
  });

  it("rejects missing account context in multi-account mode", async () => {
    const strictRepo = new DrizzleMemoryRepository(db, { accountMode: "multi" });

    await expect(
      strictRepo.findMany({ scope: "chat", scopeId: "shared-session" }),
    ).rejects.toBeInstanceOf(MissingAccountContextError);
  });

  it("does not read or mutate records across account boundaries", async () => {
    await seedAccount(db, "account-a");
    await seedAccount(db, "account-b");

    const accountARepo = new DrizzleMemoryRepository(db, "account-a");
    const accountBRepo = new DrizzleMemoryRepository(db, "account-b");
    const accountBItem = await accountBRepo.create(makeItem({ content: "Account B item" }));

    expect(await accountARepo.findById(accountBItem.id)).toBeNull();
    expect(await accountARepo.update(accountBItem.id, { content: "changed" })).toBeNull();
    expect(await accountARepo.deprecate(accountBItem.id)).toBeNull();
    expect(await accountARepo.remove(accountBItem.id)).toBeNull();

    const stillOwnedByAccountB = await accountBRepo.findById(accountBItem.id);
    expect(stillOwnedByAccountB).not.toBeNull();
    expect(stillOwnedByAccountB!.content).toBe("Account B item");
    expect(stillOwnedByAccountB!.status).toBe("active");

    const edge = await accountBRepo.createEdge({ fromId: accountBItem.id, toId: accountBItem.id, relation: "supports" });
    expect(await accountARepo.findEdgeById(edge.id)).toBeNull();
    expect(await accountARepo.removeEdge(edge.id)).toBeNull();
    expect(await accountARepo.findEdges(accountBItem.id)).toEqual([]);
    expect(await accountBRepo.findEdges(accountBItem.id)).toEqual([edge]);
  });
});
