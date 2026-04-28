import { afterEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";

import { buildApp, type BuildAppResult } from "../../app.js";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../accounts/constants.js";
import { ClientDataService } from "../../client-data/client-data-service.js";
import { accounts, floors, sessions } from "../../db/schema.js";
import { SessionStateCustomNamespaceService } from "../../session-state/session-state-custom-namespace-service.js";
import { SessionStateService } from "../../session-state/session-state-service.js";

const clientDataConfig = {
  expirationIntervalMs: 300_000,
  domainPurgeGracePeriodMs: 604_800_000,
  defaultMaxItemSizeBytes: 1_048_576,
  defaultQuotaMaxEntries: 10_000,
  defaultQuotaMaxBytes: 10_485_760,
  maxDomainsPerAccount: 64,
  maxTotalEntriesPerAccount: 100_000,
  maxTotalBytesPerAccount: 104_857_600,
};

describe("session-state public routes", () => {
  const builtApps: BuildAppResult[] = [];

  afterEach(async () => {
    while (builtApps.length > 0) {
      const built = builtApps.pop();
      if (built) {
        await built.app.close();
      }
    }
  });

  async function buildStateApp(overrides?: { enableClientData?: boolean; clientDataConfig?: Partial<typeof clientDataConfig> }) {
    const resolvedClientDataConfig = { ...clientDataConfig, ...overrides?.clientDataConfig };
    const built = await buildApp({
      databasePath: ":memory:",
      auth: { mode: "off" },
      accountMode: "single",
      enableClientData: overrides?.enableClientData ?? true,
      clientData: resolvedClientDataConfig,
    });
    builtApps.push(built);
    await built.app.ready();
    return built;
  }

  it("returns 404 when client-data is disabled and routes are not registered", async () => {
    const built = await buildStateApp({ enableClientData: false });
    const listResponse = await built.app.inject({
      method: "GET",
      url: "/sessions/any-session/state/namespaces",
    });
    const writeResponse = await built.app.inject({
      method: "POST",
      url: "/sessions/any-session/state/values/write",
      payload: {
        branch_id: "main",
        namespace: "quest_flags",
        slot: "companion",
        value: { mood: "ally" },
      },
    });
    const deleteResponse = await built.app.inject({
      method: "DELETE",
      url: "/sessions/any-session/state/values",
      payload: { branch_id: "main", namespace: "quest_flags", slot: "companion" },
    });
    const postResponse = await built.app.inject({
      method: "POST",
      url: "/sessions/any-session/state/namespaces",
      payload: {
        namespace: "quest_flags",
        logical_owner_type: "plugin",
        logical_owner_id: "quest-plugin",
      },
    });

    expect(listResponse.statusCode).toBe(404);
    expect(postResponse.statusCode).toBe(404);
    expect(writeResponse.statusCode).toBe(404);
    expect(deleteResponse.statusCode).toBe(404);
  });

  it("returns 404 when the session belongs to a different account", async () => {
    const built = await buildStateApp();
    const db = built.database;
    const otherAccountId = `other-${nanoid()}`;
    await db.insert(accounts).values({
      id: otherAccountId,
      name: otherAccountId,
      createdAt: 1,
      updatedAt: 1,
    });
    const sessionId = nanoid();
    await db.insert(sessions).values({
      id: sessionId,
      title: "Other account session",
      accountId: otherAccountId,
      status: "active",
      createdAt: 100,
      updatedAt: 100,
    });

    const listResponse = await built.app.inject({
      method: "GET",
      url: `/sessions/${encodeURIComponent(sessionId)}/state/namespaces`,
    });
    const writeResponse = await built.app.inject({
      method: "POST",
      url: `/sessions/${encodeURIComponent(sessionId)}/state/values/write`,
      payload: {
        branch_id: "main",
        namespace: "quest_flags",
        slot: "companion",
        value: { mood: "ally" },
      },
    });
    const deleteResponse = await built.app.inject({
      method: "DELETE",
      url: `/sessions/${encodeURIComponent(sessionId)}/state/values`,
      payload: { branch_id: "main", namespace: "quest_flags", slot: "companion" },
    });
    const postResponse = await built.app.inject({
      method: "POST",
      url: `/sessions/${encodeURIComponent(sessionId)}/state/namespaces`,
      payload: {
        namespace: "quest_flags",
        logical_owner_type: "plugin",
        logical_owner_id: "quest-plugin",
      },
    });

    expect(listResponse.statusCode).toBe(404);
    expect(JSON.parse(listResponse.body).error.code).toBe("not_found");
    expect(postResponse.statusCode).toBe(404);
    expect(JSON.parse(postResponse.body).error.code).toBe("not_found");
    expect(writeResponse.statusCode).toBe(404);
    expect(JSON.parse(writeResponse.body).error.code).toBe("not_found");
    expect(deleteResponse.statusCode).toBe(404);
    expect(JSON.parse(deleteResponse.body).error.code).toBe("not_found");
  });

  it("registers a custom namespace, merges discovery, and resolves source-floor, snapshot, and diff values", async () => {
    const built = await buildStateApp();
    const db = built.database;
    const sessionId = nanoid();
    const floor1 = nanoid();
    const floor2 = nanoid();
    const now = 200;

    await db.insert(sessions).values({
      id: sessionId,
      title: "Session State Public Route Test",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(floors).values([
      {
        id: floor1,
        sessionId,
        floorNo: 1,
        branchId: "main",
        parentFloorId: null,
        state: "committed",
        tokenIn: 0,
        tokenOut: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: floor2,
        sessionId,
        floorNo: 2,
        branchId: "main",
        parentFloorId: floor1,
        state: "committed",
        tokenIn: 0,
        tokenOut: 0,
        createdAt: now + 10,
        updatedAt: now + 10,
      },
    ]);

    const sessionStateCustomNamespaceService = new SessionStateCustomNamespaceService(db, { clientData: clientDataConfig });
    const sessionStateService = new SessionStateService(db, {
      clientData: clientDataConfig,
      customNamespaceService: sessionStateCustomNamespaceService,
    });
    stageAndApplyState(sessionStateService, {
      sessionId,
      floorId: floor1,
      slot: "scene",
      value: { scene: "floor1-scene" },
      committedAt: now + 100,
    });
    stageAndApplyState(sessionStateService, {
      sessionId,
      floorId: floor1,
      slot: "world",
      value: { world: "floor1-world" },
      committedAt: now + 110,
    });
    stageAndApplyState(sessionStateService, {
      sessionId,
      floorId: floor2,
      slot: "scene",
      value: { scene: "floor2-scene" },
      committedAt: now + 200,
    });
    stageAndApplyState(sessionStateService, {
      sessionId,
      floorId: floor2,
      slot: "world",
      value: { world: "floor2-world" },
      committedAt: now + 210,
    });
    stageAndApplyState(sessionStateService, {
      sessionId,
      floorId: floor2,
      slot: "inventory",
      value: { inventory: "hidden" },
      committedAt: now + 220,
    });

    const registerRes = await built.app.inject({
      method: "POST",
      url: `/sessions/${encodeURIComponent(sessionId)}/state/namespaces`,
      payload: {
        namespace: "quest_flags",
        logical_owner_type: "plugin",
        logical_owner_id: "quest-plugin",
      },
    });
    expect(registerRes.statusCode).toBe(201);
    const registerBody = JSON.parse(registerRes.body) as {
      data: {
        namespace: string;
        owner_kind: string;
        logical_owner_type: string;
        logical_owner_id: string;
        default_slot_template: {
          default_visibility_mode: string;
          default_write_mode: string;
          default_replay_safety: string;
          client_writable: boolean;
          allowed_write_modes: string[];
        };
        slots: Array<{ slot: string }>;
      };
    };
    expect(registerBody.data.namespace).toBe("quest_flags");
    expect(registerBody.data.owner_kind).toBe("custom");
    expect(registerBody.data.logical_owner_type).toBe("plugin");
    expect(registerBody.data.logical_owner_id).toBe("quest-plugin");
    expect(registerBody.data.default_slot_template.default_visibility_mode).toBe("fork_on_branch");
    expect(registerBody.data.default_slot_template.default_write_mode).toBe("direct");
    expect(registerBody.data.default_slot_template.default_replay_safety).toBe("safe");
    expect(registerBody.data.default_slot_template.client_writable).toBe(true);
    expect(registerBody.data.default_slot_template.allowed_write_modes).toEqual(["direct", "commit_bound"]);
    expect(registerBody.data.slots).toEqual([]);

    const writeRes = await built.app.inject({
      method: "POST",
      url: `/sessions/${encodeURIComponent(sessionId)}/state/values/write`,
      payload: {
        branch_id: "main",
        namespace: "quest_flags",
        slot: "companion",
        value: { mood: "ally" },
      },
    });
    expect(writeRes.statusCode).toBe(200);
    const writeBody = JSON.parse(writeRes.body) as {
      data: {
        namespace: string;
        slot: string;
        source: string;
        present: boolean;
        value: unknown;
      };
    };
    expect(writeBody.data.namespace).toBe("quest_flags");
    expect(writeBody.data.slot).toBe("companion");
    expect(writeBody.data.source).toBe("live_head");
    expect(writeBody.data.present).toBe(true);
    expect(writeBody.data.value).toEqual({ mood: "ally" });

    sessionStateService.applyStagedMutationsForFloor({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      sessionId,
      branchId: "main",
      floorId: floor2,
      committedAt: now + 230,
    });

    const definitionsRes = await built.app.inject({
      method: "GET",
      url: `/sessions/${encodeURIComponent(sessionId)}/state/namespaces`,
    });
    expect(definitionsRes.statusCode).toBe(200);
    const definitionsBody = JSON.parse(definitionsRes.body) as {
      data: Array<{ namespace: string; owner_kind: string; slots: Array<{ slot: string }> }>;
    };
    expect(definitionsBody.data.map((entry) => entry.namespace)).toEqual(["game_state", "quest_flags"]);
    expect(definitionsBody.data.find((entry) => entry.namespace === "game_state")?.slots.map((slot) => slot.slot)).toEqual(["scene", "world"]);
    expect(definitionsBody.data.find((entry) => entry.namespace === "quest_flags")?.owner_kind).toBe("custom");
    expect(definitionsBody.data.find((entry) => entry.namespace === "quest_flags")?.slots.map((slot) => slot.slot)).toEqual(["companion"]);

    const resolveCustomRes = await built.app.inject({
      method: "GET",
      url: `/sessions/${encodeURIComponent(sessionId)}/state/resolve?branch_id=main&namespace=quest_flags`,
    });
    expect(resolveCustomRes.statusCode).toBe(200);
    const resolveCustomBody = JSON.parse(resolveCustomRes.body) as {
      data: Array<{ slot: string; source: string; present: boolean; value: unknown }>;
    };
    expect(resolveCustomBody.data).toEqual([
      expect.objectContaining({
        slot: "companion",
        source: "live_head",
        present: true,
        value: { mood: "ally" },
      }),
    ]);

    const resolveCurrentRes = await built.app.inject({
      method: "GET",
      url: `/sessions/${encodeURIComponent(sessionId)}/state/resolve?branch_id=main&namespace=game_state`,
    });
    expect(resolveCurrentRes.statusCode).toBe(200);
    const resolveCurrentBody = JSON.parse(resolveCurrentRes.body) as {
      data: Array<{ slot: string; source: string; value: unknown }>;
    };
    expect(resolveCurrentBody.data.find((entry) => entry.slot === "scene")?.value).toEqual({ scene: "floor2-scene" });
    expect(resolveCurrentBody.data.find((entry) => entry.slot === "world")?.value).toEqual({ world: "floor2-world" });
    expect(resolveCurrentBody.data.every((entry) => entry.source === "live_head")).toBe(true);

    const resolveBaselineRes = await built.app.inject({
      method: "GET",
      url: `/sessions/${encodeURIComponent(sessionId)}/state/resolve?branch_id=main&namespace=game_state&source_floor_id=${encodeURIComponent(floor1)}`,
    });
    expect(resolveBaselineRes.statusCode).toBe(200);
    const resolveBaselineBody = JSON.parse(resolveBaselineRes.body) as {
      data: Array<{ slot: string; source: string; value: unknown }>;
    };
    expect(resolveBaselineBody.data.find((entry) => entry.slot === "scene")?.value).toEqual({ scene: "floor1-scene" });
    expect(resolveBaselineBody.data.find((entry) => entry.slot === "world")?.value).toEqual({ world: "floor1-world" });
    expect(resolveBaselineBody.data.every((entry) => entry.source === "source_floor_snapshot")).toBe(true);

    const snapshotRes = await built.app.inject({
      method: "GET",
      url: `/sessions/${encodeURIComponent(sessionId)}/state/floors/${encodeURIComponent(floor1)}/snapshot?namespace=game_state`,
    });
    expect(snapshotRes.statusCode).toBe(200);
    const snapshotBody = JSON.parse(snapshotRes.body) as {
      data: Array<{ slot: string; value: unknown }>;
    };
    expect(snapshotBody.data.find((entry) => entry.slot === "scene")?.value).toEqual({ scene: "floor1-scene" });
    expect(snapshotBody.data.find((entry) => entry.slot === "world")?.value).toEqual({ world: "floor1-world" });

    const customSnapshotRes = await built.app.inject({
      method: "GET",
      url: `/sessions/${encodeURIComponent(sessionId)}/state/floors/${encodeURIComponent(floor2)}/snapshot?namespace=quest_flags`,
    });
    expect(customSnapshotRes.statusCode).toBe(200);
    const customSnapshotBody = JSON.parse(customSnapshotRes.body) as {
      data: Array<{ slot: string; present: boolean; value: unknown }>;
    };
    expect(customSnapshotBody.data).toEqual([expect.objectContaining({ slot: "companion", present: true, value: { mood: "ally" } })]);

    const diffRes = await built.app.inject({
      method: "GET",
      url: `/sessions/${encodeURIComponent(sessionId)}/state/diff?floor_id=${encodeURIComponent(floor1)}&against=live&branch_id=main&namespace=game_state`,
    });
    expect(diffRes.statusCode).toBe(200);
    const diffBody = JSON.parse(diffRes.body) as {
      data: Array<{ slot: string; change_type: string; left_value: unknown; right_value: unknown }>;
    };
    expect(diffBody.data.map((entry) => entry.slot)).toEqual(["scene", "world"]);
    expect(diffBody.data.every((entry) => entry.change_type === "changed")).toBe(true);
    expect(diffBody.data.find((entry) => entry.slot === "scene")?.left_value).toEqual({ scene: "floor2-scene" });
    expect(diffBody.data.find((entry) => entry.slot === "scene")?.right_value).toEqual({ scene: "floor1-scene" });

    const customDiffRes = await built.app.inject({
      method: "GET",
      url: `/sessions/${encodeURIComponent(sessionId)}/state/diff?floor_id=${encodeURIComponent(floor2)}&against=live&branch_id=main&namespace=quest_flags`,
    });
    expect(customDiffRes.statusCode).toBe(200);
    const customDiffBody = JSON.parse(customDiffRes.body) as {
      data: Array<{ slot: string; change_type: string }>;
    };
    expect(customDiffBody.data).toEqual([expect.objectContaining({ slot: "companion", change_type: "unchanged" })]);

    const deleteRes = await built.app.inject({
      method: "DELETE",
      url: `/sessions/${encodeURIComponent(sessionId)}/state/values`,
      payload: {
        branch_id: "main",
        namespace: "quest_flags",
        slot: "companion",
      },
    });
    expect(deleteRes.statusCode).toBe(200);
    const deleteBody = JSON.parse(deleteRes.body) as {
      data: { slot: string; present: boolean; value: unknown };
    };
    expect(deleteBody.data.slot).toBe("companion");
    expect(deleteBody.data.present).toBe(false);
    expect(deleteBody.data.value).toBeNull();

    const definitionsAfterDeleteRes = await built.app.inject({
      method: "GET",
      url: `/sessions/${encodeURIComponent(sessionId)}/state/namespaces`,
    });
    const definitionsAfterDeleteBody = JSON.parse(definitionsAfterDeleteRes.body) as {
      data: Array<{ namespace: string; slots: Array<{ slot: string }> }>;
    };
    expect(definitionsAfterDeleteBody.data.find((entry) => entry.namespace === "quest_flags")?.slots.map((slot) => slot.slot)).toEqual(["companion"]);

    const resolveCustomAfterDeleteRes = await built.app.inject({
      method: "GET",
      url: `/sessions/${encodeURIComponent(sessionId)}/state/resolve?branch_id=main&namespace=quest_flags`,
    });
    const resolveCustomAfterDeleteBody = JSON.parse(resolveCustomAfterDeleteRes.body) as {
      data: Array<{ slot: string; present: boolean; value: unknown }>;
    };
    expect(resolveCustomAfterDeleteBody.data).toEqual([expect.objectContaining({ slot: "companion", present: false, value: null })]);
  });

  it("rejects reserved and duplicate custom namespace registrations", async () => {
    const built = await buildStateApp();
    const sessionId = nanoid();
    const now = 500;

    await built.database.insert(sessions).values({
      id: sessionId,
      title: "Reserved namespace route test",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    const reservedRes = await built.app.inject({
      method: "POST",
      url: `/sessions/${encodeURIComponent(sessionId)}/state/namespaces`,
      payload: {
        namespace: "game_state",
        logical_owner_type: "plugin",
        logical_owner_id: "quest-plugin",
      },
    });
    expect(reservedRes.statusCode).toBe(409);
    expect(JSON.parse(reservedRes.body).error.code).toBe("session_state_namespace_reserved");

    const firstRes = await built.app.inject({
      method: "POST",
      url: `/sessions/${encodeURIComponent(sessionId)}/state/namespaces`,
      payload: {
        namespace: "quest_flags",
        logical_owner_type: "plugin",
        logical_owner_id: "quest-plugin",
      },
    });
    expect(firstRes.statusCode).toBe(201);

    const duplicateRes = await built.app.inject({
      method: "POST",
      url: `/sessions/${encodeURIComponent(sessionId)}/state/namespaces`,
      payload: {
        namespace: "quest_flags",
        logical_owner_type: "plugin",
        logical_owner_id: "quest-plugin",
      },
    });
    expect(duplicateRes.statusCode).toBe(409);
    expect(JSON.parse(duplicateRes.body).error.code).toBe("session_state_namespace_already_registered");
  });

  it("rejects invalid custom namespace identity inputs on the public registration route", async () => {
    const built = await buildStateApp();
    const sessionId = nanoid();
    const now = 650;

    await built.database.insert(sessions).values({
      id: sessionId,
      title: "Invalid namespace route test",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    const invalidNamespaceRes = await built.app.inject({
      method: "POST",
      url: `/sessions/${encodeURIComponent(sessionId)}/state/namespaces`,
      payload: {
        namespace: "quest-flags",
        logical_owner_type: "plugin",
        logical_owner_id: "quest-plugin",
      },
    });
    expect(invalidNamespaceRes.statusCode).toBe(400);
    expect(JSON.parse(invalidNamespaceRes.body).error.code).toBe("validation_error");

    const reservedPrefixRes = await built.app.inject({
      method: "POST",
      url: `/sessions/${encodeURIComponent(sessionId)}/state/namespaces`,
      payload: {
        namespace: "game_state.scene",
        logical_owner_type: "plugin",
        logical_owner_id: "quest-plugin",
      },
    });
    expect(reservedPrefixRes.statusCode).toBe(409);
    expect(JSON.parse(reservedPrefixRes.body).error.code).toBe("session_state_namespace_reserved");

    const invalidOwnerIdRes = await built.app.inject({
      method: "POST",
      url: `/sessions/${encodeURIComponent(sessionId)}/state/namespaces`,
      payload: {
        namespace: "quest_flags",
        logical_owner_type: "plugin",
        logical_owner_id: "QuestPlugin",
      },
    });
    expect(invalidOwnerIdRes.statusCode).toBe(400);
    expect(JSON.parse(invalidOwnerIdRes.body).error.code).toBe("validation_error");
  });

  it("rejects built-in writes and unregistered custom writes on the public routes", async () => {
    const built = await buildStateApp();
    const sessionId = nanoid();
    const now = 700;

    await built.database.insert(sessions).values({
      id: sessionId,
      title: "Public write route guard test",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    const builtInWriteRes = await built.app.inject({
      method: "POST",
      url: `/sessions/${encodeURIComponent(sessionId)}/state/values/write`,
      payload: {
        branch_id: "main",
        namespace: "game_state",
        slot: "scene",
        value: { scene: "forbidden" },
      },
    });
    expect(builtInWriteRes.statusCode).toBe(409);
    expect(JSON.parse(builtInWriteRes.body).error.code).toBe("session_state_public_write_forbidden");

    const unregisteredWriteRes = await built.app.inject({
      method: "POST",
      url: `/sessions/${encodeURIComponent(sessionId)}/state/values/write`,
      payload: {
        branch_id: "main",
        namespace: "quest_flags",
        slot: "companion",
        value: { mood: "ally" },
      },
    });
    expect(unregisteredWriteRes.statusCode).toBe(404);
    expect(JSON.parse(unregisteredWriteRes.body).error.code).toBe("session_state_namespace_not_registered");
  });

  it("maps managed namespace registration capacity errors to Session State formal errors", async () => {
    const constrainedClientDataConfig = {
      ...clientDataConfig,
      maxDomainsPerAccount: 1,
    };
    const built = await buildStateApp({ clientDataConfig: constrainedClientDataConfig });
    const sessionId = nanoid();
    const now = 720;

    await built.database.insert(sessions).values({
      id: sessionId,
      title: "Managed namespace capacity route test",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    seedRawClientDataDomain(built, constrainedClientDataConfig, { ownerId: `seed-owner-${nanoid()}` });

    const registerRes = await built.app.inject({
      method: "POST",
      url: `/sessions/${encodeURIComponent(sessionId)}/state/namespaces`,
      payload: {
        namespace: "quest_flags",
        logical_owner_type: "plugin",
        logical_owner_id: "quest-plugin",
      },
    });

    expect(registerRes.statusCode).toBe(409);
    expect(JSON.parse(registerRes.body).error.code).toBe("session_state_namespace_count_limit_exceeded");
  });

  it("maps payload size budget rejections to a stable Session State error on the public write route", async () => {
    const constrainedClientDataConfig = {
      ...clientDataConfig,
      defaultMaxItemSizeBytes: 64,
    };
    const built = await buildStateApp({ clientDataConfig: constrainedClientDataConfig });
    const sessionId = nanoid();
    const now = 730;

    await built.database.insert(sessions).values({
      id: sessionId,
      title: "Payload size budget route test",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    await registerNamespace(built, sessionId, "quest_flags");

    const writeRes = await built.app.inject({
      method: "POST",
      url: `/sessions/${encodeURIComponent(sessionId)}/state/values/write`,
      payload: {
        branch_id: "main",
        namespace: "quest_flags",
        slot: "companion",
        value: { note: "x".repeat(80) },
      },
    });

    expect(writeRes.statusCode).toBe(409);
    expect(JSON.parse(writeRes.body).error.code).toBe("session_state_payload_too_large");
  });

  it("maps namespace storage item limits to Session State formal errors on the public write route", async () => {
    const constrainedClientDataConfig = {
      ...clientDataConfig,
      defaultQuotaMaxEntries: 1,
    };
    const built = await buildStateApp({ clientDataConfig: constrainedClientDataConfig });
    const sessionId = nanoid();
    const now = 740;

    await built.database.insert(sessions).values({
      id: sessionId,
      title: "Namespace item limit route test",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    await registerNamespace(built, sessionId, "quest_flags");
    const firstWriteRes = await writeCustomState(built, sessionId, { namespace: "quest_flags", slot: "companion", value: { mood: "ally" } });
    expect(firstWriteRes.statusCode).toBe(200);

    const secondWriteRes = await writeCustomState(built, sessionId, { namespace: "quest_flags", slot: "reputation", value: { standing: "trusted" } });
    expect(secondWriteRes.statusCode).toBe(409);
    expect(JSON.parse(secondWriteRes.body).error.code).toBe("session_state_namespace_item_limit_exceeded");
  });

  it("maps namespace storage byte limits to Session State formal errors on the public write route", async () => {
    const constrainedClientDataConfig = {
      ...clientDataConfig,
      defaultMaxItemSizeBytes: 10_000,
      defaultQuotaMaxBytes: 1,
    };
    const built = await buildStateApp({ clientDataConfig: constrainedClientDataConfig });
    const sessionId = nanoid();
    const now = 750;

    await built.database.insert(sessions).values({
      id: sessionId,
      title: "Namespace byte limit route test",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    await registerNamespace(built, sessionId, "quest_flags");

    const writeRes = await writeCustomState(built, sessionId, { namespace: "quest_flags", slot: "companion", value: { mood: "ally" } });
    expect(writeRes.statusCode).toBe(409);
    expect(JSON.parse(writeRes.body).error.code).toBe("session_state_namespace_byte_limit_exceeded");
  });

  it("maps account-level storage item and byte limits to Session State formal errors on the public write route", async () => {
    const itemConstrainedClientDataConfig = {
      ...clientDataConfig,
      maxTotalEntriesPerAccount: 1,
    };
    const itemBuilt = await buildStateApp({ clientDataConfig: itemConstrainedClientDataConfig });
    const itemSessionId = nanoid();
    const itemNow = 760;

    await itemBuilt.database.insert(sessions).values({
      id: itemSessionId,
      title: "Account item limit route test",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      status: "active",
      createdAt: itemNow,
      updatedAt: itemNow,
    });

    seedRawClientDataItem(itemBuilt, itemConstrainedClientDataConfig);
    await registerNamespace(itemBuilt, itemSessionId, "quest_flags");

    const itemWriteRes = await writeCustomState(itemBuilt, itemSessionId, { namespace: "quest_flags", slot: "companion", value: { mood: "ally" } });
    expect(itemWriteRes.statusCode).toBe(409);
    expect(JSON.parse(itemWriteRes.body).error.code).toBe("session_state_account_item_limit_exceeded");

    const byteConstrainedClientDataConfig = {
      ...clientDataConfig,
      defaultMaxItemSizeBytes: 10_000,
      maxTotalBytesPerAccount: 1,
    };
    const byteBuilt = await buildStateApp({ clientDataConfig: byteConstrainedClientDataConfig });
    const byteSessionId = nanoid();
    const byteNow = 770;

    await byteBuilt.database.insert(sessions).values({
      id: byteSessionId,
      title: "Account byte limit route test",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      status: "active",
      createdAt: byteNow,
      updatedAt: byteNow,
    });

    await registerNamespace(byteBuilt, byteSessionId, "quest_flags");

    const byteWriteRes = await writeCustomState(byteBuilt, byteSessionId, { namespace: "quest_flags", slot: "companion", value: { mood: "ally" } });
    expect(byteWriteRes.statusCode).toBe(409);
    expect(JSON.parse(byteWriteRes.body).error.code).toBe("session_state_account_byte_limit_exceeded");
  });
});

function stageAndApplyState(
  service: SessionStateService,
  input: {
    sessionId: string;
    floorId: string;
    slot: "scene" | "world" | "inventory";
    value: unknown;
    committedAt: number;
  },
): void {
  service.stageCommitBoundValue({
    accountId: DEFAULT_ADMIN_ACCOUNT_ID,
    sessionId: input.sessionId,
    branchId: "main",
    sourceFloorId: input.floorId,
    namespace: "game_state",
    slot: input.slot,
    value: input.value,
  });
  service.applyStagedMutationsForFloor({
    accountId: DEFAULT_ADMIN_ACCOUNT_ID,
    sessionId: input.sessionId,
    branchId: "main",
    floorId: input.floorId,
    committedAt: input.committedAt,
  });
}

async function registerNamespace(
  built: BuildAppResult,
  sessionId: string,
  namespace: string,
) {
  return built.app.inject({
    method: "POST",
    url: `/sessions/${encodeURIComponent(sessionId)}/state/namespaces`,
    payload: {
      namespace,
      logical_owner_type: "plugin",
      logical_owner_id: "quest-plugin",
    },
  });
}

async function writeCustomState(
  built: BuildAppResult,
  sessionId: string,
  input: {
    namespace: string;
    slot: string;
    value: unknown;
  },
) {
  return built.app.inject({
    method: "POST",
    url: `/sessions/${encodeURIComponent(sessionId)}/state/values/write`,
    payload: {
      branch_id: "main",
      namespace: input.namespace,
      slot: input.slot,
      value: input.value,
    },
  });
}

function seedRawClientDataDomain(
  built: BuildAppResult,
  config: typeof clientDataConfig,
  input?: {
    ownerId?: string;
    domainName?: string;
  },
) {
  const service = new ClientDataService(built.database, config);
  return service.createDomain({
    accountId: DEFAULT_ADMIN_ACCOUNT_ID,
    ownerType: "plugin",
    ownerId: input?.ownerId ?? `seed-owner-${nanoid()}`,
    domainName: input?.domainName ?? `seed-domain-${nanoid()}`,
  });
}

function seedRawClientDataItem(
  built: BuildAppResult,
  config: typeof clientDataConfig,
) {
  const service = new ClientDataService(built.database, config);
  const domain = seedRawClientDataDomain(built, config);
  service.createCollection({
    accountId: DEFAULT_ADMIN_ACCOUNT_ID,
    domainId: domain.id,
    collectionName: "seed_collection",
  });
  return service.upsertItem({
    accountId: DEFAULT_ADMIN_ACCOUNT_ID,
    domainId: domain.id,
    collectionName: "seed_collection",
    itemKey: "seed_item",
    valueJson: { seed: true },
  });
}
