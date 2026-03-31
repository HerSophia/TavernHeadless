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
import { characters, characterVersions, sessions } from "../src/db/schema";

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

type ErrorResponse = {
  error: {
    code: string;
    message: string;
  };
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

describe("Session character binding multi-account isolation", () => {
  let app: FastifyInstance;
  let databasePath: string;
  let tempDir: string;
  let rootToken: string;
  let tokenA: string;
  let tokenB: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "tavern-session-binding-"));
    databasePath = join(tempDir, "api.db");
    ({ app } = await buildApp({
      databasePath,
      logger: false,
      accountMode: "multi",
      auth: { mode: "jwt", jwtSecret: "test-secret" },
    }));

    rootToken = app.jwt.sign({ sub: "root", account_id: "default-admin", role: "user" });

    await createAccount(app, rootToken, "acc-a", "Account A");
    await createAccount(app, rootToken, "acc-b", "Account B");

    tokenA = app.jwt.sign({ sub: "u-a", account_id: "acc-a", role: "admin" });
    tokenB = app.jwt.sign({ sub: "u-b", account_id: "acc-b", role: "admin" });
  });

  afterEach(async () => {
    await app.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("rejects foreign character bindings on create and patch", async () => {
    const foreignCharacter = await importCharacter(app, authHeader(tokenB));
    const ownCharacter = await importCharacter(app, authHeader(tokenA));

    const createByForeignCharacterId = await app.inject({
      method: "POST",
      url: "/sessions",
      headers: authHeader(tokenA),
      payload: {
        title: "foreign-char-id",
        character_id: foreignCharacter.character_id,
      },
    });
    expect(createByForeignCharacterId.statusCode).toBe(404);
    expect(createByForeignCharacterId.json<ErrorResponse>().error.code).toBe("character_not_found");

    const createByForeignVersionId = await app.inject({
      method: "POST",
      url: "/sessions",
      headers: authHeader(tokenA),
      payload: {
        title: "foreign-version-id",
        character_version_id: foreignCharacter.character_version_id,
      },
    });
    expect(createByForeignVersionId.statusCode).toBe(404);
    expect(createByForeignVersionId.json<ErrorResponse>().error.code).toBe("character_not_found");

    const createOwnedSession = await app.inject({
      method: "POST",
      url: "/sessions",
      headers: authHeader(tokenA),
      payload: {
        title: "owned-char",
        character_id: ownCharacter.character_id,
      },
    });
    expect(createOwnedSession.statusCode, createOwnedSession.body).toBe(201);
    const sessionId = createOwnedSession.json<{ data: { id: string } }>().data.id;

    const patchForeignCharacterId = await app.inject({
      method: "PATCH",
      url: `/sessions/${sessionId}`,
      headers: authHeader(tokenA),
      payload: {
        character_id: foreignCharacter.character_id,
      },
    });
    expect(patchForeignCharacterId.statusCode).toBe(404);
    expect(patchForeignCharacterId.json<ErrorResponse>().error.code).toBe("character_not_found");

    const patchForeignVersionId = await app.inject({
      method: "PATCH",
      url: `/sessions/${sessionId}`,
      headers: authHeader(tokenA),
      payload: {
        character_version_id: foreignCharacter.character_version_id,
      },
    });
    expect(patchForeignVersionId.statusCode).toBe(404);
    expect(patchForeignVersionId.json<ErrorResponse>().error.code).toBe("character_not_found");
  });

  it("repairs historical cross-account character bindings on startup", async () => {
    const foreignCharacter = await importCharacter(app, authHeader(tokenB));

    const createSessionRes = await app.inject({
      method: "POST",
      url: "/sessions",
      headers: authHeader(tokenA),
      payload: { title: "legacy-dirty-binding" },
    });
    expect(createSessionRes.statusCode, createSessionRes.body).toBe(201);
    const sessionId = createSessionRes.json<{ data: { id: string } }>().data.id;

    await app.close();

    const connection = createDatabase(databasePath);
    try {
      await connection.db
        .update(sessions)
        .set({
          characterId: foreignCharacter.character_id,
          characterVersionId: foreignCharacter.character_version_id,
          characterSnapshotJson: JSON.stringify({ name: "Foreign Snapshot" }),
          updatedAt: Date.now(),
        })
        .where(eq(sessions.id, sessionId));
    } finally {
      connection.close();
    }

    ({ app } = await buildApp({
      databasePath,
      logger: false,
      accountMode: "multi",
      auth: { mode: "jwt", jwtSecret: "test-secret" },
    }));

    tokenA = app.jwt.sign({ sub: "u-a", account_id: "acc-a", role: "admin" });

    const getSessionRes = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}`,
      headers: authHeader(tokenA),
    });
    expect(getSessionRes.statusCode, getSessionRes.body).toBe(200);
    expect(getSessionRes.json<{ data: { character_binding: unknown | null } }>().data.character_binding).toBeNull();
  });
});

function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function createAccount(app: FastifyInstance, token: string, id: string, name: string) {
  const response = await app.inject({
    method: "POST",
    url: "/accounts",
    headers: authHeader(token),
    payload: { id, name },
  });

  expect(response.statusCode, response.body).toBe(201);
}

async function importCharacter(
  app: FastifyInstance,
  headers?: Record<string, string>
): Promise<{ character_id: string; character_version_id: string }> {
  const importRes = await app.inject({
    method: "POST",
    url: "/import/character",
    headers,
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
    const [character] = await connection.db
      .select({ latestVersionNo: characters.latestVersionNo, revision: characters.revision })
      .from(characters)
      .where(eq(characters.id, characterId))
      .limit(1);

    const [latest] = await connection.db
      .select({ versionNo: characterVersions.versionNo })
      .from(characterVersions)
      .where(eq(characterVersions.characterId, characterId))
      .orderBy(desc(characterVersions.versionNo))
      .limit(1);

    const versionNo = Number(character?.latestVersionNo ?? latest?.versionNo ?? 0) + 1;
    const dataJson = JSON.stringify(snapshot);
    const versionId = `cv-${nanoid()}`;
    const now = Date.now();

    await connection.db.insert(characterVersions).values({
      id: versionId,
      characterId,
      versionNo,
      dataJson,
      contentHash: createHash("sha256").update(dataJson).digest("hex"),
      createdAt: now,
    });

    await connection.db
      .update(characters)
      .set({
        name: snapshot.name,
        latestVersionNo: versionNo,
        revision: Number(character?.revision ?? 0) + 1,
        updatedAt: now,
      })
      .where(eq(characters.id, characterId));

    return versionId;
  } finally {
    connection.close();
  }
}
