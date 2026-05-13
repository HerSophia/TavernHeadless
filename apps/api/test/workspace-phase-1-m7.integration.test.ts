import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../src/accounts/constants";
import type { AppDb } from "../src/db/client";
import {
  accountUsers,
  characterVersions,
  characters,
  presets,
  regexProfiles,
  worldbooks,
} from "../src/db/schema";
import {
  createTestWorkspace,
  ensureTestDefaultWorkspace,
} from "../src/__tests__/helpers/workspace-project";

type ListBody = { data: Array<{ id: string; name: string }> };
type ErrorBody = { error: { code: string } };

describe("Workspace phase 1 M7 coverage", () => {
  let app: FastifyInstance;
  let db: AppDb;

  beforeEach(async () => {
    const result = await buildApp({ databasePath: ":memory:", logger: false });
    app = result.app;
    db = result.database;
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  async function seedDefaultAndOtherWorkspaceAssets() {
    const now = Date.now();
    const { workspaceId: defaultWorkspaceId } = ensureTestDefaultWorkspace(db, DEFAULT_ADMIN_ACCOUNT_ID, now);
    const { workspaceId: otherWorkspaceId } = createTestWorkspace(db, {
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      id: "ws_other_assets",
      isDefault: false,
      now,
    });

    await db.insert(accountUsers).values([
      {
        id: "user-default-ws",
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        workspaceId: defaultWorkspaceId,
        name: "Default Workspace User",
        snapshotJson: JSON.stringify({ name: "Default Workspace User" }),
        status: "active",
        revision: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "user-other-ws",
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        workspaceId: otherWorkspaceId,
        name: "Other Workspace User",
        snapshotJson: JSON.stringify({ name: "Other Workspace User" }),
        status: "active",
        revision: 0,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await db.insert(characters).values([
      {
        id: "char-default-ws",
        name: "Default Workspace Character",
        source: "test",
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        workspaceId: defaultWorkspaceId,
        status: "active",
        deletedAt: null,
        revision: 0,
        latestVersionNo: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "char-other-ws",
        name: "Other Workspace Character",
        source: "test",
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        workspaceId: otherWorkspaceId,
        status: "active",
        deletedAt: null,
        revision: 0,
        latestVersionNo: 1,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await db.insert(characterVersions).values({
      id: "char-other-ws-v1",
      characterId: "char-other-ws",
      versionNo: 1,
      dataJson: JSON.stringify({ name: "Other Workspace Character" }),
      contentHash: "char-other-ws-hash",
      sourceArtifactJson: null,
      sourceArtifactFormat: null,
      sourceArtifactDigest: null,
      createdAt: now,
    });

    await db.insert(presets).values([
      {
        id: "preset-default-ws",
        name: "Default Workspace Preset",
        source: "test",
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        workspaceId: defaultWorkspaceId,
        dataJson: JSON.stringify({ prompts: [], prompt_order: [] }),
        version: 1,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "preset-other-ws",
        name: "Other Workspace Preset",
        source: "test",
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        workspaceId: otherWorkspaceId,
        dataJson: JSON.stringify({ prompts: [], prompt_order: [] }),
        version: 1,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await db.insert(worldbooks).values([
      {
        id: "worldbook-default-ws",
        name: "Default Workspace Worldbook",
        source: "test",
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        workspaceId: defaultWorkspaceId,
        dataJson: JSON.stringify({}),
        version: 1,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "worldbook-other-ws",
        name: "Other Workspace Worldbook",
        source: "test",
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        workspaceId: otherWorkspaceId,
        dataJson: JSON.stringify({}),
        version: 1,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await db.insert(regexProfiles).values([
      {
        id: "regex-default-ws",
        name: "Default Workspace Regex",
        source: "test",
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        workspaceId: defaultWorkspaceId,
        dataJson: JSON.stringify([]),
        version: 1,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "regex-other-ws",
        name: "Other Workspace Regex",
        source: "test",
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        workspaceId: otherWorkspaceId,
        dataJson: JSON.stringify([]),
        version: 1,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    return { defaultWorkspaceId, otherWorkspaceId };
  }

  it("lists only default Workspace prompt assets, characters, and users", async () => {
    await seedDefaultAndOtherWorkspaceAssets();

    const usersRes = await app.inject({ method: "GET", url: "/users?sort_by=name&sort_order=asc" });
    const charactersRes = await app.inject({ method: "GET", url: "/characters?sort_by=name&sort_order=asc" });
    const presetsRes = await app.inject({ method: "GET", url: "/presets" });
    const worldbooksRes = await app.inject({ method: "GET", url: "/worldbooks" });
    const regexRes = await app.inject({ method: "GET", url: "/regex-profiles" });

    expect(usersRes.statusCode, usersRes.body).toBe(200);
    expect(charactersRes.statusCode, charactersRes.body).toBe(200);
    expect(presetsRes.statusCode, presetsRes.body).toBe(200);
    expect(worldbooksRes.statusCode, worldbooksRes.body).toBe(200);
    expect(regexRes.statusCode, regexRes.body).toBe(200);

    expect(usersRes.json<ListBody>().data.map((item) => item.name)).toEqual(["Default Workspace User"]);
    expect(charactersRes.json<ListBody>().data.map((item) => item.name)).toEqual(["Default Workspace Character"]);
    expect(presetsRes.json<ListBody>().data.map((item) => item.name)).toEqual(["Default Workspace Preset"]);
    expect(worldbooksRes.json<ListBody>().data.map((item) => item.name)).toEqual(["Default Workspace Worldbook"]);
    expect(regexRes.json<ListBody>().data.map((item) => item.name)).toEqual(["Default Workspace Regex"]);
  });

  it("rejects session bindings to assets from another Workspace", async () => {
    await seedDefaultAndOtherWorkspaceAssets();

    const cases = [
      {
        payload: { title: "Bad character", character_id: "char-other-ws" },
        code: "character_not_found",
      },
      {
        payload: { title: "Bad user", user_id: "user-other-ws" },
        code: "user_not_found",
      },
      {
        payload: { title: "Bad preset", preset_id: "preset-other-ws" },
        code: "preset_not_found",
      },
      {
        payload: { title: "Bad worldbook", worldbook_profile_id: "worldbook-other-ws" },
        code: "worldbook_not_found",
      },
      {
        payload: { title: "Bad regex", regex_profile_id: "regex-other-ws" },
        code: "regex_profile_not_found",
      },
    ];

    for (const testCase of cases) {
      const res = await app.inject({ method: "POST", url: "/sessions", payload: testCase.payload });
      expect(res.statusCode, res.body).toBe(404);
      expect(res.json<ErrorBody>().error.code).toBe(testCase.code);
    }
  });
});
