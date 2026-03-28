import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type AppDb } from "../../db/client";
import { accounts } from "../../db/schema.js";
import { DrizzleVariableRepository } from "../drizzle-variable-repository";

async function seedAccount(db: AppDb, id: string) {
  const now = Date.now();

  await db.insert(accounts).values({
    id,
    name: id,
    role: "admin",
    status: "active",
    isDefault: false,
    createdAt: now,
    updatedAt: now,
  });
}

describe("DrizzleVariableRepository", () => {
  let db: AppDb;
  let repo: DrizzleVariableRepository;
  let closeDb: () => void;

  beforeEach(() => {
    const conn = createDatabase(":memory:");
    db = conn.db;
    closeDb = conn.close;
    repo = new DrizzleVariableRepository(db);
  });

  afterEach(() => {
    closeDb();
  });

  it("returns null for non-existent key", async () => {
    const result = await repo.findByKey("global", "global", "missing");
    expect(result).toBeNull();
  });

  it("returns VariableEntry with parsed value", async () => {
    await repo.upsert("chat", "session-1", "mood", "happy");

    const result = await repo.findByKey("chat", "session-1", "mood");

    expect(result).not.toBeNull();
    expect(result!.scope).toBe("chat");
    expect(result!.scopeId).toBe("session-1");
    expect(result!.key).toBe("mood");
    expect(result!.value).toBe("happy");
    expect(typeof result!.id).toBe("string");
    expect(typeof result!.updatedAt).toBe("number");
  });

  it("returns complex JSON values correctly", async () => {
    const complexValue = { nested: { array: [1, 2, 3] }, flag: true };
    await repo.upsert("global", "global", "config", complexValue);

    const result = await repo.findByKey("global", "global", "config");
    expect(result!.value).toEqual(complexValue);
  });

  it("returns empty array when no variables exist", async () => {
    const result = await repo.findAllByScope("floor", "floor-1");
    expect(result).toEqual([]);
  });

  it("returns all variables in scope", async () => {
    await repo.upsert("chat", "s1", "mood", "happy");
    await repo.upsert("chat", "s1", "location", "tavern");
    await repo.upsert("chat", "s2", "mood", "sad");

    const result = await repo.findAllByScope("chat", "s1");

    expect(result).toHaveLength(2);
    const keys = result.map((entry) => entry.key).sort();
    expect(keys).toEqual(["location", "mood"]);
  });

  it("creates new variable on first upsert", async () => {
    const result = await repo.upsert("floor", "floor-1", "hp", 100);

    expect(result.scope).toBe("floor");
    expect(result.scopeId).toBe("floor-1");
    expect(result.key).toBe("hp");
    expect(result.value).toBe(100);
    expect(typeof result.id).toBe("string");
  });

  it("updates existing variable on conflict", async () => {
    const first = await repo.upsert("chat", "s1", "mood", "happy");
    const second = await repo.upsert("chat", "s1", "mood", "sad");

    expect(second.key).toBe("mood");
    expect(second.value).toBe("sad");
    expect(second.updatedAt).toBeGreaterThanOrEqual(first.updatedAt);

    const all = await repo.findAllByScope("chat", "s1");
    expect(all).toHaveLength(1);
  });

  it("isolates same scope key across accounts", async () => {
    await seedAccount(db, "acc-a");
    await seedAccount(db, "acc-b");

    const accountA = await repo.upsert("global", "global", "theme", "red", { accountId: "acc-a" });
    const accountB = await repo.upsert("global", "global", "theme", "blue", { accountId: "acc-b" });

    expect(accountA.id).not.toBe(accountB.id);
    expect((await repo.findByKey("global", "global", "theme", { accountId: "acc-a" }))?.value).toBe("red");
    expect((await repo.findByKey("global", "global", "theme", { accountId: "acc-b" }))?.value).toBe("blue");
    expect(await repo.findAllByScope("global", "global", { accountId: "acc-a" })).toHaveLength(1);
    expect(await repo.findAllByScope("global", "global", { accountId: "acc-b" })).toHaveLength(1);
  });

  it("supports null and boolean values", async () => {
    await repo.upsert("global", "g", "nullVal", null);
    await repo.upsert("global", "g", "boolVal", true);

    const nullResult = await repo.findByKey("global", "g", "nullVal");
    expect(nullResult!.value).toBeNull();

    const boolResult = await repo.findByKey("global", "g", "boolVal");
    expect(boolResult!.value).toBe(true);
  });

  it("returns false when deleting non-existent id", async () => {
    const result = await repo.deleteById("non-existent");
    expect(result).toBe(false);
  });

  it("deletes variable by id", async () => {
    const created = await repo.upsert("chat", "s1", "mood", "happy");

    const deleted = await repo.deleteById(created.id);
    expect(deleted).toBe(true);

    const found = await repo.findByKey("chat", "s1", "mood");
    expect(found).toBeNull();
  });

  it("does not delete foreign-account variable by id", async () => {
    await seedAccount(db, "acc-a");
    await seedAccount(db, "acc-b");

    const created = await repo.upsert("chat", "s1", "mood", "happy", { accountId: "acc-a" });

    const deleted = await repo.deleteById(created.id, { accountId: "acc-b" });
    expect(deleted).toBe(false);
    expect(await repo.findByKey("chat", "s1", "mood", { accountId: "acc-a" })).not.toBeNull();
  });

  it("returns false when deleting non-existent key", async () => {
    const result = await repo.deleteByKey("chat", "s1", "missing");
    expect(result).toBe(false);
  });

  it("deletes variable by scope+scopeId+key", async () => {
    await repo.upsert("chat", "s1", "mood", "happy");
    await repo.upsert("chat", "s1", "location", "tavern");

    const deleted = await repo.deleteByKey("chat", "s1", "mood");
    expect(deleted).toBe(true);

    const mood = await repo.findByKey("chat", "s1", "mood");
    expect(mood).toBeNull();

    const location = await repo.findByKey("chat", "s1", "location");
    expect(location).not.toBeNull();
  });
});
