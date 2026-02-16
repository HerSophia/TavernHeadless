import { beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type AppDb } from "../../db/client";
import { DrizzleVariableRepository } from "../drizzle-variable-repository";

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

  // ── findByKey ───────────────────────────────────────

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

  // ── findAllByScope ──────────────────────────────────

  it("returns empty array when no variables exist", async () => {
    const result = await repo.findAllByScope("floor", "floor-1");
    expect(result).toEqual([]);
  });

  it("returns all variables in scope", async () => {
    await repo.upsert("chat", "s1", "mood", "happy");
    await repo.upsert("chat", "s1", "location", "tavern");
    await repo.upsert("chat", "s2", "mood", "sad"); // different scopeId

    const result = await repo.findAllByScope("chat", "s1");

    expect(result).toHaveLength(2);
    const keys = result.map((e) => e.key).sort();
    expect(keys).toEqual(["location", "mood"]);
  });

  // ── upsert ──────────────────────────────────────────

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

    // same key should update, not create
    expect(second.key).toBe("mood");
    expect(second.value).toBe("sad");
    expect(second.updatedAt).toBeGreaterThanOrEqual(first.updatedAt);

    // verify only one entry exists
    const all = await repo.findAllByScope("chat", "s1");
    expect(all).toHaveLength(1);
  });

  it("supports null and boolean values", async () => {
    await repo.upsert("global", "g", "nullVal", null);
    await repo.upsert("global", "g", "boolVal", true);

    const nullResult = await repo.findByKey("global", "g", "nullVal");
    expect(nullResult!.value).toBeNull();

    const boolResult = await repo.findByKey("global", "g", "boolVal");
    expect(boolResult!.value).toBe(true);
  });

  // ── deleteById ──────────────────────────────────────

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

  // ── deleteByKey ─────────────────────────────────────

  it("returns false when deleting non-existent key", async () => {
    const result = await repo.deleteByKey("chat", "s1", "missing");
    expect(result).toBe(false);
  });

  it("deletes variable by scope+scopeId+key", async () => {
    await repo.upsert("chat", "s1", "mood", "happy");
    await repo.upsert("chat", "s1", "location", "tavern");

    const deleted = await repo.deleteByKey("chat", "s1", "mood");
    expect(deleted).toBe(true);

    // mood deleted, location still exists
    const mood = await repo.findByKey("chat", "s1", "mood");
    expect(mood).toBeNull();

    const location = await repo.findByKey("chat", "s1", "location");
    expect(location).not.toBeNull();
  });
});
