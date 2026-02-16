import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

import { desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app";
import { createDatabase } from "../src/db/client";
import { characterVersions } from "../src/db/schema";

const CHARACTER_CARD_V2 = {
  spec: "chara_card_v2",
  spec_version: "2.0",
  data: {
    name: "Lyra",
    description: "A precise chronicle keeper.",
    personality: "Calm and thoughtful.",
    scenario: "An observatory wrapped in mist.",
    first_mes: "The record is ready whenever you are.",
    mes_example: "<START>\nLyra: We can annotate this thread together.",
  },
};

describe("Session character sync route", () => {
  let app: FastifyInstance;
  let databasePath: string;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "tavern-sync-"));
    databasePath = join(tempDir, "api.db");
    ({ app } = await buildApp({ databasePath, logger: false }));
  });

  afterEach(async () => {
    await app.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("syncs a manual-bound session to the latest character version", async () => {
    const imported = await importCharacter(app);

    const sessionRes = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: {
        title: "manual-sync",
        character_id: imported.character_id,
        character_version_id: imported.character_version_id,
        character_sync_policy: "manual",
      },
    });
    expect(sessionRes.statusCode, sessionRes.body).toBe(201);
    const sessionId = sessionRes.json<{ data: { id: string } }>().data.id;

    const latestVersionId = await appendCharacterVersion(databasePath, imported.character_id, {
      name: "Lyra Prime",
      greeting: "The revised archive is now live.",
    });

    const syncRes = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/character/sync`,
    });

    expect(syncRes.statusCode, syncRes.body).toBe(200);
    const syncBody = syncRes.json<{
      data: {
        character_binding: {
          character_version_id: string | null;
          sync_policy: "pin" | "manual" | "force";
          snapshot_summary: { name: string; has_greeting: boolean } | null;
        } | null;
      };
    }>();

    expect(syncBody.data.character_binding?.character_version_id).toBe(latestVersionId);
    expect(syncBody.data.character_binding?.sync_policy).toBe("manual");
    expect(syncBody.data.character_binding?.snapshot_summary?.name).toBe("Lyra Prime");
    expect(syncBody.data.character_binding?.snapshot_summary?.has_greeting).toBe(true);
  });

  it("blocks pin policy unless force=true", async () => {
    const imported = await importCharacter(app);

    const sessionRes = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: {
        title: "pin-sync",
        character_id: imported.character_id,
        character_version_id: imported.character_version_id,
        character_sync_policy: "pin",
      },
    });
    expect(sessionRes.statusCode, sessionRes.body).toBe(201);
    const sessionId = sessionRes.json<{ data: { id: string } }>().data.id;

    const latestVersionId = await appendCharacterVersion(databasePath, imported.character_id, {
      name: "Lyra v2",
      greeting: "Pinned, but upgrade available.",
    });

    const blockedRes = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/character/sync`,
    });

    expect(blockedRes.statusCode, blockedRes.body).toBe(409);
    expect(blockedRes.json<{ error: { code: string } }>().error.code).toBe("character_sync_blocked");

    const forcedRes = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/character/sync`,
      payload: { force: true },
    });

    expect(forcedRes.statusCode, forcedRes.body).toBe(200);
    const forcedBody = forcedRes.json<{
      data: {
        character_binding: {
          character_version_id: string | null;
        } | null;
      };
    }>();
    expect(forcedBody.data.character_binding?.character_version_id).toBe(latestVersionId);
  });

  it("returns 409 when session has no bound character", async () => {
    const sessionRes = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { title: "no-character" },
    });
    expect(sessionRes.statusCode, sessionRes.body).toBe(201);
    const sessionId = sessionRes.json<{ data: { id: string } }>().data.id;

    const syncRes = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/character/sync`,
    });

    expect(syncRes.statusCode, syncRes.body).toBe(409);
    expect(syncRes.json<{ error: { code: string } }>().error.code).toBe("character_binding_missing");
  });
});

async function importCharacter(app: FastifyInstance): Promise<{ character_id: string; character_version_id: string }> {
  const importRes = await app.inject({
    method: "POST",
    url: "/import/character",
    payload: {
      payload: CHARACTER_CARD_V2,
      create_session: false,
    },
  });

  expect(importRes.statusCode, importRes.body).toBe(201);
  return importRes.json<{ data: { character_id: string; character_version_id: string } }>().data;
}

async function appendCharacterVersion(
  databasePath: string,
  characterId: string,
  snapshot: { name: string; greeting?: string }
): Promise<string> {
  const connection = createDatabase(databasePath);
  try {
    const [latest] = await connection.db
      .select({ versionNo: characterVersions.versionNo })
      .from(characterVersions)
      .where(eq(characterVersions.characterId, characterId))
      .orderBy(desc(characterVersions.versionNo))
      .limit(1);

    const versionNo = Number(latest?.versionNo ?? 0) + 1;
    const dataJson = JSON.stringify(snapshot);
    const versionId = `cv-${nanoid()}`;

    await connection.db.insert(characterVersions).values({
      id: versionId,
      characterId,
      versionNo,
      dataJson,
      contentHash: createHash("sha256").update(dataJson).digest("hex"),
      createdAt: Date.now(),
    });

    return versionId;
  } finally {
    connection.close();
  }
}
