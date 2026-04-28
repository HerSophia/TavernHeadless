import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { accounts, floors, sessions } from "../../db/schema.js";
import {
  SessionStatePublicService,
  SessionStatePublicServiceError,
} from "../session-state-public-service.js";
import {
  SessionStateCustomNamespaceService,
} from "../session-state-custom-namespace-service.js";
import { SessionStateService } from "../session-state-service.js";

const CLIENT_DATA_CONFIG = {
  defaultMaxItemSizeBytes: 1_048_576,
  defaultQuotaMaxEntries: 10_000,
  defaultQuotaMaxBytes: 10_485_760,
  maxDomainsPerAccount: 64,
  maxTotalEntriesPerAccount: 100_000,
  maxTotalBytesPerAccount: 104_857_600,
  domainPurgeGracePeriodMs: 604_800_000,
};

const ACCOUNT_A = "account-a";
const ACCOUNT_B = "account-b";

describe("SessionStatePublicService", () => {
  let database: DatabaseConnection;
  let sessionStateService: SessionStateService;
  let customNamespaceService: SessionStateCustomNamespaceService;
  let publicService: SessionStatePublicService;

  beforeEach(async () => {
    database = createDatabase(":memory:");
    customNamespaceService = new SessionStateCustomNamespaceService(database.db, { clientData: CLIENT_DATA_CONFIG });
    sessionStateService = new SessionStateService(database.db, {
      clientData: CLIENT_DATA_CONFIG,
      customNamespaceService,
    });
    publicService = new SessionStatePublicService(database.db, sessionStateService, customNamespaceService);
    await seedAccount(database, ACCOUNT_A);
    await seedAccount(database, ACCOUNT_B);
  });

  afterEach(() => {
    database.close();
  });

  it("lists only public-stable built-in slot definitions", async () => {
    const sessionId = nanoid();
    await seedSession(database, sessionId, ACCOUNT_A, 1_000);

    const namespaces = publicService.listNamespaces(ACCOUNT_A, sessionId);
    expect(namespaces).toHaveLength(1);
    expect(namespaces[0]!.namespace).toBe("game_state");
    expect(namespaces[0]!.ownerKind).toBe("built_in");
    expect(namespaces[0]!.slots.map((slot) => slot.slot)).toEqual(["scene", "world"]);
    expect(namespaces[0]!.slots.every((slot) => slot.exposureLifecycle === "public_stable")).toBe(true);
  });

  it("merges registered custom namespaces into public discovery", async () => {
    const sessionId = nanoid();
    await seedSession(database, sessionId, ACCOUNT_A, 1_500);

    customNamespaceService.registerNamespace({
      accountId: ACCOUNT_A,
      sessionId,
      namespace: "quest_flags",
      logicalOwnerType: "plugin",
      logicalOwnerId: "quest-plugin",
    });

    const namespaces = publicService.listNamespaces(ACCOUNT_A, sessionId);
    expect(namespaces.map((entry) => entry.namespace)).toEqual(["game_state", "quest_flags"]);

    const customNamespace = namespaces.find((entry) => entry.namespace === "quest_flags");
    expect(customNamespace).toBeDefined();
    expect(customNamespace?.ownerKind).toBe("custom");
    expect(customNamespace && customNamespace.ownerKind === "custom" ? customNamespace.logicalOwnerType : null).toBe("plugin");
    expect(customNamespace && customNamespace.ownerKind === "custom" ? customNamespace.logicalOwnerId : null).toBe("quest-plugin");
    expect(customNamespace && customNamespace.ownerKind === "custom" ? customNamespace.defaultSlotTemplate.defaultVisibilityMode : null).toBe("fork_on_branch");
    expect(customNamespace && customNamespace.ownerKind === "custom" ? customNamespace.defaultSlotTemplate.defaultWriteMode : null).toBe("direct");
    expect(customNamespace && customNamespace.ownerKind === "custom" ? customNamespace.defaultSlotTemplate.allowedWriteModes : null).toEqual(["direct", "commit_bound"]);
    expect(customNamespace?.slots).toEqual([]);
  });

  it("writes, deletes, and exposes materialized custom slots across discovery and public reads", async () => {
    const sessionId = nanoid();
    const floor1 = nanoid();
    const floor2 = nanoid();
    const now = 1_800;

    await seedSession(database, sessionId, ACCOUNT_A, now);
    await seedFloor(database, { id: floor1, sessionId, floorNo: 1, branchId: "main", state: "committed", now });
    await seedFloor(database, { id: floor2, sessionId, floorNo: 2, branchId: "main", state: "committed", now: now + 20 });

    customNamespaceService.registerNamespace({
      accountId: ACCOUNT_A,
      sessionId,
      namespace: "quest_flags",
      logicalOwnerType: "plugin",
      logicalOwnerId: "quest-plugin",
    });

    const written = publicService.writeValue({
      accountId: ACCOUNT_A,
      sessionId,
      branchId: "main",
      namespace: "quest_flags",
      slot: "companion",
      value: { mood: "ally" },
    });
    expect(written.source).toBe("live_head");
    expect(written.present).toBe(true);
    expect(written.value).toEqual({ mood: "ally" });

    const namespacesAfterWrite = publicService.listNamespaces(ACCOUNT_A, sessionId);
    const customNamespace = namespacesAfterWrite.find((entry) => entry.namespace === "quest_flags");
    expect(customNamespace && customNamespace.ownerKind === "custom" ? customNamespace.slots.map((slot) => slot.slot) : []).toEqual(["companion"]);

    const resolvedCustom = publicService.resolveValues({
      accountId: ACCOUNT_A,
      sessionId,
      branchId: "main",
      namespace: "quest_flags",
    });
    expect(resolvedCustom).toEqual([
      expect.objectContaining({
        namespace: "quest_flags",
        slot: "companion",
        source: "live_head",
        present: true,
        value: { mood: "ally" },
      }),
    ]);

    sessionStateService.applyStagedMutationsForFloor({
      accountId: ACCOUNT_A,
      sessionId,
      branchId: "main",
      floorId: floor2,
      committedAt: now + 100,
    });

    const snapshots = publicService.listFloorSnapshots({
      accountId: ACCOUNT_A,
      sessionId,
      floorId: floor2,
      namespace: "quest_flags",
    });
    expect(snapshots).toEqual([
      expect.objectContaining({
        namespace: "quest_flags",
        slot: "companion",
        present: true,
        value: { mood: "ally" },
      }),
    ]);

    const diff = publicService.diff({
      accountId: ACCOUNT_A,
      sessionId,
      floorId: floor2,
      against: { kind: "live", branchId: "main" },
      namespace: "quest_flags",
    });
    expect(diff).toEqual([
      expect.objectContaining({
        namespace: "quest_flags",
        slot: "companion",
        changeType: "unchanged",
      }),
    ]);

    const deleted = publicService.deleteValue({
      accountId: ACCOUNT_A,
      sessionId,
      branchId: "main",
      namespace: "quest_flags",
      slot: "companion",
    });
    expect(deleted.present).toBe(false);
    expect(deleted.value).toBeNull();

    const namespacesAfterDelete = publicService.listNamespaces(ACCOUNT_A, sessionId);
    const customAfterDelete = namespacesAfterDelete.find((entry) => entry.namespace === "quest_flags");
    expect(customAfterDelete && customAfterDelete.ownerKind === "custom" ? customAfterDelete.slots.map((slot) => slot.slot) : []).toEqual(["companion"]);
  });

  it("rejects built-in and unregistered custom writes from the public surface", async () => {
    const sessionId = nanoid();
    await seedSession(database, sessionId, ACCOUNT_A, 1_900);

    expect(() => publicService.writeValue({
      accountId: ACCOUNT_A,
      sessionId,
      branchId: "main",
      namespace: "game_state",
      slot: "scene",
      value: { scene: "forbidden" },
    })).toThrow(SessionStatePublicServiceError);

    expect(() => publicService.writeValue({
      accountId: ACCOUNT_A,
      sessionId,
      branchId: "main",
      namespace: "quest_flags",
      slot: "companion",
      value: { mood: "ally" },
    })).toThrow(SessionStatePublicServiceError);

    try {
      publicService.writeValue({
        accountId: ACCOUNT_A,
        sessionId,
        branchId: "main",
        namespace: "quest_flags",
        slot: "companion",
        value: { mood: "ally" },
      });
    } catch (error) {
      expect(error).toBeInstanceOf(SessionStatePublicServiceError);
      expect((error as SessionStatePublicServiceError).code).toBe("session_state_namespace_not_registered");
    }
  });

  it("resolves current-effective and source-floor values for scene and world", async () => {
    const sessionId = nanoid();
    const floor1 = nanoid();
    const floor2 = nanoid();
    const now = 2_000;

    await seedSession(database, sessionId, ACCOUNT_A, now);
    await seedFloor(database, { id: floor1, sessionId, floorNo: 1, branchId: "main", state: "committed", now });
    await seedFloor(database, { id: floor2, sessionId, floorNo: 2, branchId: "main", state: "committed", now: now + 20 });

    await stageAndApplyState(sessionStateService, {
      accountId: ACCOUNT_A,
      sessionId,
      branchId: "main",
      floorId: floor1,
      slot: "scene",
      value: { scene: "source-scene" },
      committedAt: now + 100,
    });
    await stageAndApplyState(sessionStateService, {
      accountId: ACCOUNT_A,
      sessionId,
      branchId: "main",
      floorId: floor1,
      slot: "world",
      value: { world: "source-world" },
      committedAt: now + 110,
    });
    await stageAndApplyState(sessionStateService, {
      accountId: ACCOUNT_A,
      sessionId,
      branchId: "main",
      floorId: floor2,
      slot: "scene",
      value: { scene: "current-scene" },
      committedAt: now + 200,
    });
    await stageAndApplyState(sessionStateService, {
      accountId: ACCOUNT_A,
      sessionId,
      branchId: "main",
      floorId: floor2,
      slot: "world",
      value: { world: "current-world" },
      committedAt: now + 210,
    });

    const current = publicService.resolveValues({
      accountId: ACCOUNT_A,
      sessionId,
      branchId: "main",
      namespace: "game_state",
    });
    expect(current.map((entry) => entry.slot)).toEqual(["scene", "world"]);
    expect(current.find((entry) => entry.slot === "scene")?.value).toEqual({ scene: "current-scene" });
    expect(current.find((entry) => entry.slot === "world")?.value).toEqual({ world: "current-world" });
    expect(current.every((entry) => entry.source === "live_head")).toBe(true);

    const baseline = publicService.resolveValues({
      accountId: ACCOUNT_A,
      sessionId,
      branchId: "main",
      sourceFloorId: floor1,
      namespace: "game_state",
    });
    expect(baseline.find((entry) => entry.slot === "scene")?.value).toEqual({ scene: "source-scene" });
    expect(baseline.find((entry) => entry.slot === "world")?.value).toEqual({ world: "source-world" });
    expect(baseline.every((entry) => entry.source === "source_floor_snapshot")).toBe(true);
  });

  it("lists floor snapshots and diffs only for public-stable slots", async () => {
    const sessionId = nanoid();
    const floor1 = nanoid();
    const floor2 = nanoid();
    const now = 3_000;

    await seedSession(database, sessionId, ACCOUNT_A, now);
    await seedFloor(database, { id: floor1, sessionId, floorNo: 1, branchId: "main", state: "committed", now });
    await seedFloor(database, { id: floor2, sessionId, floorNo: 2, branchId: "main", state: "committed", now: now + 20 });

    await stageAndApplyState(sessionStateService, {
      accountId: ACCOUNT_A,
      sessionId,
      branchId: "main",
      floorId: floor1,
      slot: "scene",
      value: { scene: "floor1" },
      committedAt: now + 100,
    });
    await stageAndApplyState(sessionStateService, {
      accountId: ACCOUNT_A,
      sessionId,
      branchId: "main",
      floorId: floor1,
      slot: "world",
      value: { world: "floor1" },
      committedAt: now + 110,
    });
    await stageAndApplyState(sessionStateService, {
      accountId: ACCOUNT_A,
      sessionId,
      branchId: "main",
      floorId: floor2,
      slot: "scene",
      value: { scene: "floor2" },
      committedAt: now + 200,
    });
    await stageAndApplyState(sessionStateService, {
      accountId: ACCOUNT_A,
      sessionId,
      branchId: "main",
      floorId: floor2,
      slot: "world",
      value: { world: "floor2" },
      committedAt: now + 210,
    });
    await stageAndApplyState(sessionStateService, {
      accountId: ACCOUNT_A,
      sessionId,
      branchId: "main",
      floorId: floor2,
      slot: "inventory",
      value: { inventory: "hidden" },
      committedAt: now + 220,
    });

    const snapshots = publicService.listFloorSnapshots({
      accountId: ACCOUNT_A,
      sessionId,
      floorId: floor1,
      namespace: "game_state",
    });
    expect(snapshots.map((entry) => entry.slot)).toEqual(["scene", "world"]);
    expect(snapshots.find((entry) => entry.slot === "scene")?.value).toEqual({ scene: "floor1" });
    expect(snapshots.find((entry) => entry.slot === "world")?.value).toEqual({ world: "floor1" });

    const diff = publicService.diff({
      accountId: ACCOUNT_A,
      sessionId,
      floorId: floor1,
      against: { kind: "live", branchId: "main" },
      namespace: "game_state",
    });
    expect(diff.map((entry) => entry.slot)).toEqual(["scene", "world"]);
    expect(diff.every((entry) => entry.changeType === "changed")).toBe(true);
    expect(diff.find((entry) => entry.slot === "scene")?.leftValue).toEqual({ scene: "floor2" });
    expect(diff.find((entry) => entry.slot === "scene")?.rightValue).toEqual({ scene: "floor1" });
  });

  it("returns not_found for cross-account access", async () => {
    const sessionId = nanoid();
    await seedSession(database, sessionId, ACCOUNT_A, 4_000);

    expect(() => publicService.listNamespaces(ACCOUNT_B, sessionId)).toThrow(SessionStatePublicServiceError);
    try {
      publicService.listNamespaces(ACCOUNT_B, sessionId);
    } catch (error) {
      expect(error).toBeInstanceOf(SessionStatePublicServiceError);
      expect((error as SessionStatePublicServiceError).statusCode).toBe(404);
      expect((error as SessionStatePublicServiceError).code).toBe("not_found");
    }
  });
});

async function seedAccount(database: DatabaseConnection, accountId: string): Promise<void> {
  await database.db.insert(accounts).values({
    id: accountId,
    name: accountId,
    createdAt: 1,
    updatedAt: 1,
  }).onConflictDoNothing();
}

async function seedSession(
  database: DatabaseConnection,
  sessionId: string,
  accountId: string,
  now: number,
): Promise<void> {
  await database.db.insert(sessions).values({
    id: sessionId,
    title: "Session State Public Service Test",
    accountId,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
}

async function seedFloor(
  database: DatabaseConnection,
  input: {
    id: string;
    sessionId: string;
    floorNo: number;
    branchId: string;
    state: "draft" | "generating" | "committed" | "failed";
    now: number;
  },
): Promise<void> {
  await database.db.insert(floors).values({
    id: input.id,
    sessionId: input.sessionId,
    floorNo: input.floorNo,
    branchId: input.branchId,
    parentFloorId: input.floorNo === 1 ? null : undefined,
    state: input.state,
    tokenIn: 0,
    tokenOut: 0,
    createdAt: input.now,
    updatedAt: input.now,
  });
}

async function stageAndApplyState(
  service: SessionStateService,
  input: {
    accountId: string;
    sessionId: string;
    branchId: string;
    floorId: string;
    slot: "scene" | "world" | "inventory";
    value: unknown;
    committedAt: number;
  },
): Promise<void> {
  service.stageCommitBoundValue({
    accountId: input.accountId,
    sessionId: input.sessionId,
    branchId: input.branchId,
    sourceFloorId: input.floorId,
    namespace: "game_state",
    slot: input.slot,
    value: input.value,
  });
  service.applyStagedMutationsForFloor({
    accountId: input.accountId,
    sessionId: input.sessionId,
    branchId: input.branchId,
    floorId: input.floorId,
    committedAt: input.committedAt,
  });
}
