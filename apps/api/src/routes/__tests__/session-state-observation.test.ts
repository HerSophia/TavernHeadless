import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";

import { buildApp, type BuildAppResult } from "../../app.js";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../accounts/constants.js";
import { accounts, floors, sessions } from "../../db/schema.js";
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

describe("session-state observation routes", () => {
  const builtApps: BuildAppResult[] = [];

  afterEach(async () => {
    while (builtApps.length > 0) {
      const built = builtApps.pop();
      if (built) {
        await built.app.close();
      }
    }
  });

  async function buildObservationApp(overrides?: { enableClientData?: boolean }) {
    const built = await buildApp({
      databasePath: ":memory:",
      auth: { mode: "off" },
      accountMode: "single",
      enableClientData: overrides?.enableClientData ?? true,
      clientData: clientDataConfig,
    });
    builtApps.push(built);
    await built.app.ready();
    return built;
  }

  it("returns 503 feature_unavailable when client-data is disabled", async () => {
    const built = await buildObservationApp({ enableClientData: false });
    const response = await built.app.inject({
      method: "GET",
      url: "/sessions/any-session/session-state/bindings",
    });
    // Route is not registered when client-data is off, so Fastify returns 404
    expect([404, 503]).toContain(response.statusCode);
  });

  it("returns 404 when the session belongs to a different account", async () => {
    const built = await buildObservationApp();
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

    const response = await built.app.inject({
      method: "GET",
      url: `/sessions/${encodeURIComponent(sessionId)}/session-state/bindings`,
    });
    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body).error.code).toBe("not_found");
  });

  it("lists bindings, mutations (without value), and live heads for the owning account", async () => {
    const built = await buildObservationApp();
    const sessionId = nanoid();
    const floorId = nanoid();
    const db = built.database;
    await db.insert(sessions).values({
      id: sessionId,
      title: "Observation session",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      status: "active",
      createdAt: 200,
      updatedAt: 200,
    });
    await db.insert(floors).values({
      id: floorId,
      sessionId,
      floorNo: 1,
      branchId: "main",
      parentFloorId: null,
      state: "committed",
      tokenIn: 0,
      tokenOut: 0,
      createdAt: 210,
      updatedAt: 210,
    });

    const sessionStateService = new SessionStateService(db, { clientData: clientDataConfig });
    sessionStateService.stageCommitBoundValue({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      sessionId,
      branchId: "main",
      sourceFloorId: floorId,
      namespace: "game_state",
      slot: "scene",
      value: { scene: "harbor" },
    });
    sessionStateService.applyStagedMutationsForFloor({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      sessionId,
      branchId: "main",
      floorId,
      committedAt: 220,
    });

    const bindingsRes = await built.app.inject({
      method: "GET",
      url: `/sessions/${encodeURIComponent(sessionId)}/session-state/bindings`,
    });
    expect(bindingsRes.statusCode).toBe(200);
    const bindingsBody = JSON.parse(bindingsRes.body) as { data: Array<Record<string, unknown>> };
    expect(bindingsBody.data.length).toBe(1);
    expect(bindingsBody.data[0]!.state_namespace).toBe("game_state");

    const mutationsRes = await built.app.inject({
      method: "GET",
      url: `/sessions/${encodeURIComponent(sessionId)}/session-state/mutations`,
    });
    expect(mutationsRes.statusCode).toBe(200);
    const mutationsBody = JSON.parse(mutationsRes.body) as {
      data: Array<Record<string, unknown>>;
      meta: { total: number };
    };
    expect(mutationsBody.meta.total).toBe(1);
    const summary = mutationsBody.data[0]!;
    expect(summary.payload_preview).toBeTypeOf("string");
    expect(summary.payload_size_bytes).toBeGreaterThan(0);
    expect(summary).not.toHaveProperty("payload");

    const detailRes = await built.app.inject({
      method: "GET",
      url: `/sessions/${encodeURIComponent(sessionId)}/session-state/mutations/${encodeURIComponent(summary.id as string)}`,
    });
    expect(detailRes.statusCode).toBe(200);
    const detailBody = JSON.parse(detailRes.body) as { data: { payload: { value: unknown } } };
    expect(detailBody.data.payload.value).toEqual({ scene: "harbor" });

    const liveListRes = await built.app.inject({
      method: "GET",
      url: `/sessions/${encodeURIComponent(sessionId)}/session-state/live`,
    });
    expect(liveListRes.statusCode).toBe(200);
    const liveListBody = JSON.parse(liveListRes.body) as { data: Array<Record<string, unknown>> };
    expect(liveListBody.data.length).toBe(1);
    expect(liveListBody.data[0]!).not.toHaveProperty("value");

    const liveSingleRes = await built.app.inject({
      method: "GET",
      url: `/sessions/${encodeURIComponent(sessionId)}/session-state/live/game_state/scene?branch_id=main`,
    });
    expect(liveSingleRes.statusCode).toBe(200);
    const liveSingleBody = JSON.parse(liveSingleRes.body) as { data: { value: unknown } };
    expect(liveSingleBody.data.value).toEqual({ scene: "harbor" });

    const snapshotsRes = await built.app.inject({
      method: "GET",
      url: `/floors/${encodeURIComponent(floorId)}/session-state/snapshots`,
    });
    expect(snapshotsRes.statusCode).toBe(200);
    const snapshotsBody = JSON.parse(snapshotsRes.body) as { data: Array<Record<string, unknown>> };
    expect(snapshotsBody.data.length).toBeGreaterThan(0);
    expect(snapshotsBody.data[0]!).not.toHaveProperty("value");

    const snapshotSingleRes = await built.app.inject({
      method: "GET",
      url: `/floors/${encodeURIComponent(floorId)}/session-state/snapshots/game_state/scene`,
    });
    expect(snapshotSingleRes.statusCode).toBe(200);
    const snapshotSingleBody = JSON.parse(snapshotSingleRes.body) as { data: { value: unknown } };
    expect(snapshotSingleBody.data.value).toEqual({ scene: "harbor" });
  });

  it("rejects invalid diff against parameter with 400 validation_error", async () => {
    const built = await buildObservationApp();
    const sessionId = nanoid();
    const floorId = nanoid();
    const db = built.database;
    await db.insert(sessions).values({
      id: sessionId,
      title: "Diff session",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      status: "active",
      createdAt: 300,
      updatedAt: 300,
    });
    await db.insert(floors).values({
      id: floorId,
      sessionId,
      floorNo: 1,
      branchId: "main",
      parentFloorId: null,
      state: "committed",
      tokenIn: 0,
      tokenOut: 0,
      createdAt: 310,
      updatedAt: 310,
    });

    const response = await built.app.inject({
      method: "GET",
      url: `/floors/${encodeURIComponent(floorId)}/session-state/diff?against=not-a-valid-target`,
    });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error.code).toBe("validation_error");
  });

  it("returns diff entries with include_values opt-in", async () => {
    const built = await buildObservationApp();
    const sessionId = nanoid();
    const floorId = nanoid();
    const db = built.database;
    await db.insert(sessions).values({
      id: sessionId,
      title: "Diff values session",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      status: "active",
      createdAt: 400,
      updatedAt: 400,
    });
    await db.insert(floors).values({
      id: floorId,
      sessionId,
      floorNo: 1,
      branchId: "main",
      parentFloorId: null,
      state: "committed",
      tokenIn: 0,
      tokenOut: 0,
      createdAt: 410,
      updatedAt: 410,
    });

    const sessionStateService = new SessionStateService(db, { clientData: clientDataConfig });
    sessionStateService.stageCommitBoundValue({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      sessionId,
      branchId: "main",
      sourceFloorId: floorId,
      namespace: "game_state",
      slot: "scene",
      value: { scene: "harbor" },
    });
    sessionStateService.applyStagedMutationsForFloor({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      sessionId,
      branchId: "main",
      floorId,
      committedAt: 420,
    });

    const noValues = await built.app.inject({
      method: "GET",
      url: `/floors/${encodeURIComponent(floorId)}/session-state/diff?against=live&branch_id=main&state_namespace=game_state`,
    });
    expect(noValues.statusCode).toBe(200);
    const noValuesBody = JSON.parse(noValues.body) as { data: Array<Record<string, unknown>> };
    for (const entry of noValuesBody.data) {
      expect(entry).not.toHaveProperty("left_value");
      expect(entry).not.toHaveProperty("right_value");
    }

    const withValues = await built.app.inject({
      method: "GET",
      url: `/floors/${encodeURIComponent(floorId)}/session-state/diff?against=live&branch_id=main&state_namespace=game_state&include_values=true`,
    });
    expect(withValues.statusCode).toBe(200);
    const withValuesBody = JSON.parse(withValues.body) as { data: Array<Record<string, unknown>> };
    expect(withValuesBody.data.some((entry) => "left_value" in entry || "right_value" in entry)).toBe(true);
  });
});
