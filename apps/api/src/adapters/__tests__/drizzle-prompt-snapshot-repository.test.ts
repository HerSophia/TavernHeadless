import { beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type AppDb } from "../../db/client";
import { floors, sessions } from "../../db/schema";
import { DrizzlePromptSnapshotRepository } from "../drizzle-prompt-snapshot-repository";
import type { PromptSnapshotRecord } from "@tavern/core";

describe("DrizzlePromptSnapshotRepository", () => {
  let db: AppDb;
  let repo: DrizzlePromptSnapshotRepository;

  const sessionId = "test-session-1";

  beforeEach(async () => {
    const conn = createDatabase(":memory:");
    db = conn.db;
    repo = new DrizzlePromptSnapshotRepository(db);

    const now = Date.now();
    await db.insert(sessions).values({
      id: sessionId,
      title: "Test Session",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  });

  async function insertFloor(id = "floor-1", floorNo = 1) {
    const now = Date.now();
    await db.insert(floors).values({
      id,
      sessionId,
      floorNo,
      branchId: "main",
      parentFloorId: null,
      state: "draft",
      tokenIn: 0,
      tokenOut: 0,
      createdAt: now,
      updatedAt: now,
    });
  }

  function makeSnapshot(floorId: string): PromptSnapshotRecord {
    return {
      floorId,
      sessionId,
      presetId: null,
      presetUpdatedAt: null,
      presetVersion: null,
      worldbookId: null,
      worldbookUpdatedAt: null,
      worldbookVersion: null,
      regexProfileId: null,
      regexProfileUpdatedAt: null,
      regexProfileVersion: null,
      worldbookActivatedEntryUids: [1, 2, 3],
      regexPreRuleNames: ["pre-a"],
      regexPostRuleNames: ["post-a"],
      promptMode: "compat_plus",
      promptDigest: `digest-${floorId}`,
      tokenEstimate: 321,
      createdAt: Date.now(),
    };
  }

  it("returns null for missing floor snapshot", async () => {
    const result = await repo.findByFloorId("missing-floor");
    expect(result).toBeNull();
  });

  it("inserts and reads a prompt snapshot", async () => {
    await insertFloor("floor-1", 1);
    const snapshot = makeSnapshot("floor-1");

    const inserted = await repo.insert(snapshot);
    const found = await repo.findByFloorId("floor-1");

    expect(inserted).toEqual(snapshot);
    expect(found).toEqual(snapshot);
  });

  it("upserts the existing snapshot for the same floor", async () => {
    await insertFloor("floor-2", 2);

    await repo.insert(makeSnapshot("floor-2"));
    const updatedSnapshot: PromptSnapshotRecord = {
      ...makeSnapshot("floor-2"),
      worldbookActivatedEntryUids: [9],
      regexPostRuleNames: ["post-b"],
      promptDigest: "digest-floor-2-updated",
      tokenEstimate: 999,
    };

    await repo.insert(updatedSnapshot);
    const found = await repo.findByFloorId("floor-2");

    expect(found).toEqual(updatedSnapshot);
  });
});
