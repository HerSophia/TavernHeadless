import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../accounts/constants.js";
import { createDatabase, type AppDb } from "../../db/client";
import { characters, characterVersions, floors, sessions } from "../../db/schema";
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
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(characters).values({
      id: "char-1",
      name: "Test Character",
      source: "sillytavern",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      status: "active",
      revision: 0,
      latestVersionNo: 2,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(characterVersions).values([
      {
        id: "char-ver-1",
        characterId: "char-1",
        versionNo: 1,
        dataJson: JSON.stringify({ name: "Test Character" }),
        contentHash: "hash-char-ver-1",
        createdAt: now,
      },
      {
        id: "char-ver-2",
        characterId: "char-1",
        versionNo: 2,
        dataJson: JSON.stringify({ name: "Test Character v2" }),
        contentHash: "hash-char-ver-2",
        createdAt: now + 1,
      },
    ]);
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
      presetVersionId: null,
      presetContentHash: null,
      worldbookId: null,
      worldbookUpdatedAt: null,
      worldbookVersion: null,
      worldbookVersionId: null,
      worldbookContentHash: null,
      regexProfileId: null,
      regexProfileUpdatedAt: null,
      regexProfileVersion: null,
      regexProfileVersionId: null,
      regexProfileContentHash: null,
      characterId: "char-1",
      characterVersionId: "char-ver-1",
      characterImportedFormat: "v2",
      characterContentHash: "character-hash-1",
      worldbookActivatedEntryUids: [1, 2, 3],
      worldbookActivatedEntries: [
        {
          uid: 1,
          activationKey: "worldbook:worldbook-1:2:entry:1",
          source: {
            kind: "session_worldbook",
            worldbookId: "worldbook-1",
            worldbookName: "Lore Book",
            assetScopeId: "worldbook:worldbook-1:2",
          },
          insertion: {
            position: "before",
          },
        },
      ],
      regexPreRuleNames: ["pre-a"],
      regexPostRuleNames: ["post-a"],
      promptMode: "compat_plus",
      assetManifestDigest: "manifest-digest-1",
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
      worldbookActivatedEntries: [
        {
          uid: 9,
          activationKey: "worldbook:character:char-1:char-ver-2:book:entry:9",
          source: {
            kind: "character_book",
            worldbookId: null,
            worldbookName: "Character Book",
            assetScopeId: "worldbook:character:char-1:char-ver-2:book",
          },
          insertion: { position: "outlet", outletName: "LoreOutlet" },
        },
      ],
      regexPostRuleNames: ["post-b"],
      promptDigest: "digest-floor-2-updated",
      tokenEstimate: 999,
    };

    await repo.insert(updatedSnapshot);
    const found = await repo.findByFloorId("floor-2");

    expect(found).toEqual(updatedSnapshot);
  });
});
