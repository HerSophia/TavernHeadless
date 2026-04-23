import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { accounts, floors, sessions } from "../../db/schema.js";
import {
  SessionStateObservationService,
  SessionStateObservationServiceError,
} from "../session-state-observation-service.js";
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

describe("SessionStateObservationService", () => {
  let database: DatabaseConnection;
  let service: SessionStateService;
  let observation: SessionStateObservationService;

  beforeEach(async () => {
    database = createDatabase(":memory:");
    service = new SessionStateService(database.db, { clientData: CLIENT_DATA_CONFIG });
    observation = new SessionStateObservationService(database.db, service);
    await seedAccount(database, ACCOUNT_A);
    await seedAccount(database, ACCOUNT_B);
  });

  afterEach(() => {
    database.close();
  });

  it("returns 404 when the session belongs to a different account", async () => {
    const sessionId = nanoid();
    await seedSession(database, sessionId, ACCOUNT_A, 1000);

    expect(() => observation.listBindingsForSession(ACCOUNT_B, sessionId)).toThrow(
      SessionStateObservationServiceError,
    );
    try {
      observation.listBindingsForSession(ACCOUNT_B, sessionId);
    } catch (error) {
      expect(error).toBeInstanceOf(SessionStateObservationServiceError);
      expect((error as SessionStateObservationServiceError).statusCode).toBe(404);
      expect((error as SessionStateObservationServiceError).code).toBe("not_found");
    }
  });

  it("returns empty arrays for a session that has no managed bindings yet", async () => {
    const sessionId = nanoid();
    await seedSession(database, sessionId, ACCOUNT_A, 1000);

    expect(observation.listBindingsForSession(ACCOUNT_A, sessionId)).toEqual([]);
    expect(observation.listLiveHeadsForSession(ACCOUNT_A, sessionId, {})).toEqual([]);

    const { rows, total } = observation.listMutationsForSession(
      ACCOUNT_A,
      sessionId,
      {},
      { limit: 20, offset: 0, sortOrder: "desc" },
    );
    expect(rows).toEqual([]);
    expect(total).toBe(0);
  });

  it("lists mutation summaries without full value and returns payload preview", async () => {
    const sessionId = nanoid();
    const floorId = nanoid();
    const now = 2000;
    await seedSession(database, sessionId, ACCOUNT_A, now);
    await seedFloor(database, { id: floorId, sessionId, floorNo: 1, branchId: "main", state: "committed", now });

    const longText = "x".repeat(600);
    service.stageCommitBoundValue({
      accountId: ACCOUNT_A,
      sessionId,
      branchId: "main",
      sourceFloorId: floorId,
      namespace: "game_state",
      slot: "scene",
      value: { text: longText },
    });

    const { rows, total } = observation.listMutationsForSession(
      ACCOUNT_A,
      sessionId,
      {},
      { limit: 20, offset: 0, sortOrder: "desc" },
    );

    expect(total).toBe(1);
    const row = rows[0]!;
    expect(row.stateNamespace).toBe("game_state");
    expect(row.targetSlot).toBe("scene");
    expect(row.status).toBe("staged");
    expect(row.payloadPresent).toBe(true);
    expect(row.payloadSizeBytes).toBeGreaterThan(256);
    expect(row.payloadPreview.length).toBe(256);
    // summary must not expose the full value
    expect(row).not.toHaveProperty("payload");
  });

  it("filters mutations by branch, status and source floor", async () => {
    const sessionId = nanoid();
    const floorMain = nanoid();
    const floorAlt = nanoid();
    const now = 3000;
    await seedSession(database, sessionId, ACCOUNT_A, now);
    await seedFloor(database, { id: floorMain, sessionId, floorNo: 1, branchId: "main", state: "committed", now });
    await seedFloor(database, { id: floorAlt, sessionId, floorNo: 1, branchId: "alt", state: "committed", now });

    service.stageCommitBoundValue({
      accountId: ACCOUNT_A,
      sessionId,
      branchId: "main",
      sourceFloorId: floorMain,
      namespace: "game_state",
      slot: "scene",
      value: { tag: "main" },
    });
    service.stageCommitBoundValue({
      accountId: ACCOUNT_A,
      sessionId,
      branchId: "alt",
      sourceFloorId: floorAlt,
      namespace: "game_state",
      slot: "scene",
      value: { tag: "alt" },
    });

    const mainOnly = observation.listMutationsForSession(
      ACCOUNT_A,
      sessionId,
      { branchId: "main" },
      { limit: 20, offset: 0, sortOrder: "desc" },
    );
    expect(mainOnly.total).toBe(1);
    expect(mainOnly.rows[0]!.branchId).toBe("main");

    const bySourceFloor = observation.listMutationsForSession(
      ACCOUNT_A,
      sessionId,
      { sourceFloorId: floorAlt },
      { limit: 20, offset: 0, sortOrder: "desc" },
    );
    expect(bySourceFloor.total).toBe(1);
    expect(bySourceFloor.rows[0]!.sourceFloorId).toBe(floorAlt);
  });

  it("returns the full payload value for single mutation detail", async () => {
    const sessionId = nanoid();
    const floorId = nanoid();
    const now = 4000;
    await seedSession(database, sessionId, ACCOUNT_A, now);
    await seedFloor(database, { id: floorId, sessionId, floorNo: 1, branchId: "main", state: "committed", now });

    const mutation = service.stageCommitBoundValue({
      accountId: ACCOUNT_A,
      sessionId,
      branchId: "main",
      sourceFloorId: floorId,
      namespace: "game_state",
      slot: "scene",
      value: { scene: "courtyard" },
    });

    const detail = observation.getMutationById(ACCOUNT_A, sessionId, mutation.id);
    expect(detail.payload.present).toBe(true);
    expect(detail.payload.value).toEqual({ scene: "courtyard" });
  });

  it("rejects getMutationById when session and mutation do not match", async () => {
    const sessionId = nanoid();
    const otherSessionId = nanoid();
    const floorId = nanoid();
    const now = 5000;
    await seedSession(database, sessionId, ACCOUNT_A, now);
    await seedSession(database, otherSessionId, ACCOUNT_A, now);
    await seedFloor(database, { id: floorId, sessionId, floorNo: 1, branchId: "main", state: "committed", now });

    const mutation = service.stageCommitBoundValue({
      accountId: ACCOUNT_A,
      sessionId,
      branchId: "main",
      sourceFloorId: floorId,
      namespace: "game_state",
      slot: "scene",
      value: { scene: "courtyard" },
    });

    expect(() => observation.getMutationById(ACCOUNT_A, otherSessionId, mutation.id)).toThrow(
      SessionStateObservationServiceError,
    );
  });

  it("exposes live head summary without value, and full value via resolveLive", async () => {
    const sessionId = nanoid();
    const floorId = nanoid();
    const now = 6000;
    await seedSession(database, sessionId, ACCOUNT_A, now);
    await seedFloor(database, { id: floorId, sessionId, floorNo: 1, branchId: "main", state: "committed", now });

    service.stageCommitBoundValue({
      accountId: ACCOUNT_A,
      sessionId,
      branchId: "main",
      sourceFloorId: floorId,
      namespace: "game_state",
      slot: "scene",
      value: { scene: "courtyard" },
    });
    service.applyStagedMutationsForFloor({
      accountId: ACCOUNT_A,
      sessionId,
      branchId: "main",
      floorId,
      committedAt: now + 10,
    });

    const liveSummary = observation.listLiveHeadsForSession(ACCOUNT_A, sessionId, {});
    expect(liveSummary.length).toBe(1);
    const entry = liveSummary[0]!;
    expect(entry.stateNamespace).toBe("game_state");
    expect(entry.slot).toBe("scene");
    expect(entry.present).toBe(true);
    expect(entry.payloadSizeBytes).toBeGreaterThan(0);
    expect(entry).not.toHaveProperty("value");

    const resolved = observation.resolveLive(ACCOUNT_A, sessionId, "main", "game_state", "scene");
    expect(resolved?.present).toBe(true);
    expect(resolved?.value).toEqual({ scene: "courtyard" });
  });

  it("lists floor snapshots without value and returns value on single-snapshot endpoint", async () => {
    const sessionId = nanoid();
    const floorId = nanoid();
    const now = 7000;
    await seedSession(database, sessionId, ACCOUNT_A, now);
    await seedFloor(database, { id: floorId, sessionId, floorNo: 1, branchId: "main", state: "committed", now });

    service.stageCommitBoundValue({
      accountId: ACCOUNT_A,
      sessionId,
      branchId: "main",
      sourceFloorId: floorId,
      namespace: "game_state",
      slot: "scene",
      value: { scene: "courtyard" },
    });
    service.applyStagedMutationsForFloor({
      accountId: ACCOUNT_A,
      sessionId,
      branchId: "main",
      floorId,
      committedAt: now + 10,
    });


    // Single snapshot endpoint should have value even if list is not materialized yet
    const snapshot = observation.getFloorSnapshot(ACCOUNT_A, sessionId, floorId, "game_state", "scene");
    expect(snapshot?.present).toBe(true);
    expect(snapshot?.value).toEqual({ scene: "courtyard" });

    const summaries = observation.listFloorSnapshots(ACCOUNT_A, sessionId, floorId, {});
    expect(summaries.length).toBeGreaterThan(0);
    const entry = summaries.find((row) => row.floorId === floorId && row.slot === "scene")!;
    expect(entry.floorId).toBe(floorId);
    expect(entry.present).toBe(true);
    expect(entry.payloadSizeBytes).toBeGreaterThan(0);
    expect(entry).not.toHaveProperty("value");
  });

  it("maps replay safety evaluation", async () => {
    const sessionId = nanoid();
    const floorId = nanoid();
    const now = 8000;
    await seedSession(database, sessionId, ACCOUNT_A, now);
    await seedFloor(database, { id: floorId, sessionId, floorNo: 1, branchId: "main", state: "committed", now });

    service.stageCommitBoundValue({
      accountId: ACCOUNT_A,
      sessionId,
      branchId: "main",
      sourceFloorId: floorId,
      namespace: "game_state",
      slot: "scene",
      value: { scene: "courtyard" },
      replaySafety: "confirm_on_replay",
    });
    service.applyStagedMutationsForFloor({
      accountId: ACCOUNT_A,
      sessionId,
      branchId: "main",
      floorId,
      committedAt: now + 10,
    });

    const evaluation = observation.evaluateReplaySafetyForFloor(ACCOUNT_A, sessionId, floorId);
    expect(evaluation.allowed).toBe(false);
    expect(evaluation.blockers.length).toBe(1);
    expect(evaluation.blockers[0]!.reason).toBe("confirmation_required");
  });

  it("diffs live against floor with includeValues opt-in", async () => {
    const sessionId = nanoid();
    const floorId = nanoid();
    const now = 9000;
    await seedSession(database, sessionId, ACCOUNT_A, now);
    await seedFloor(database, { id: floorId, sessionId, floorNo: 1, branchId: "main", state: "committed", now });

    service.stageCommitBoundValue({
      accountId: ACCOUNT_A,
      sessionId,
      branchId: "main",
      sourceFloorId: floorId,
      namespace: "game_state",
      slot: "scene",
      value: { scene: "courtyard" },
    });
    service.applyStagedMutationsForFloor({
      accountId: ACCOUNT_A,
      sessionId,
      branchId: "main",
      floorId,
      committedAt: now + 10,
    });

    const withoutValues = observation.diffFloorAgainst(
      ACCOUNT_A,
      sessionId,
      floorId,
      { kind: "live", branchId: "main" },
      { stateNamespace: "game_state" },
    );
    expect(withoutValues.length).toBeGreaterThan(0);
    for (const entry of withoutValues) {
      expect(entry).not.toHaveProperty("leftValue");
      expect(entry).not.toHaveProperty("rightValue");
    }

    const withValues = observation.diffFloorAgainst(
      ACCOUNT_A,
      sessionId,
      floorId,
      { kind: "live", branchId: "main" },
      { stateNamespace: "game_state", includeValues: true },
    );
    expect(withValues.some((entry) => entry.leftValue !== undefined || entry.rightValue !== undefined)).toBe(true);
  });
});

async function seedAccount(database: DatabaseConnection, accountId: string): Promise<void> {
  await database.db.insert(accounts).values({
    id: accountId,
    name: accountId,
    createdAt: 1,
    updatedAt: 1,
  });
}

async function seedSession(
  database: DatabaseConnection,
  sessionId: string,
  accountId: string,
  now: number,
): Promise<void> {
  await database.db.insert(sessions).values({
    id: sessionId,
    title: "Observation Test",
    accountId,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
}

async function seedFloor(
  database: DatabaseConnection,
  floor: {
    id: string;
    sessionId: string;
    floorNo: number;
    branchId: string;
    state: "draft" | "generating" | "committed" | "failed";
    now: number;
  },
): Promise<void> {
  await database.db.insert(floors).values({
    id: floor.id,
    sessionId: floor.sessionId,
    floorNo: floor.floorNo,
    branchId: floor.branchId,
    parentFloorId: null,
    state: floor.state,
    tokenIn: 0,
    tokenOut: 0,
    createdAt: floor.now,
    updatedAt: floor.now,
  });
}
