import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import type { TurnExecutionResult } from "@tavern/core";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { accounts, floors, sessions } from "../../db/schema.js";
import { FirstPartyGameStateService, FirstPartyGameStateServiceError } from "../first-party-game-state-service.js";
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

const ACCOUNT_ID = "default-admin";

describe("FirstPartyGameStateService", () => {
  let database: DatabaseConnection;
  let sessionStateService: SessionStateService;
  let service: FirstPartyGameStateService;

  beforeEach(() => {
    database = createDatabase(":memory:");
    sessionStateService = new SessionStateService(database.db, {
      clientData: CLIENT_DATA_CONFIG,
    });
    service = new FirstPartyGameStateService(database.db, sessionStateService);
  });

  afterEach(() => {
    database.close();
  });

  it("loads and normalizes the current live scene state", async () => {
    const sessionId = nanoid();
    const floorId = nanoid();
    const now = 1_736_020_000_000;

    await seedSession(database, sessionId, now);
    await seedFloor(database, {
      id: floorId,
      sessionId,
      floorNo: 1,
      branchId: "main",
      parentFloorId: null,
      state: "committed",
      createdAt: now,
      updatedAt: now,
    });

    service.stageSceneState({
      accountId: ACCOUNT_ID,
      sessionId,
      branchId: "main",
      floorId,
      runType: "respond",
      execution: createExecution(floorId, "A cold wind passes through the gate."),
      stagedAt: now + 10,
    });
    sessionStateService.applyStagedMutationsForFloor({
      accountId: ACCOUNT_ID,
      sessionId,
      branchId: "main",
      floorId,
      committedAt: now + 20,
    });

    const scene = service.loadSceneContext({
      accountId: ACCOUNT_ID,
      sessionId,
      branchId: "main",
    });

    expect(scene.source).toBe("live_head");
    expect(scene.present).toBe(true);
    expect(scene.scene).toEqual(expect.objectContaining({
      kind: "first_party_scene_state",
      floorId,
      generatedText: "A cold wind passes through the gate.",
    }));
  });

  it("uses source floor snapshots when the caller requests a source-floor baseline", async () => {
    const sessionId = nanoid();
    const floor1 = nanoid();
    const floor2 = nanoid();
    const now = 1_736_020_010_000;

    await seedSession(database, sessionId, now);
    await seedFloor(database, {
      id: floor1,
      sessionId,
      floorNo: 1,
      branchId: "main",
      parentFloorId: null,
      state: "committed",
      createdAt: now,
      updatedAt: now,
    });
    await seedFloor(database, {
      id: floor2,
      sessionId,
      floorNo: 2,
      branchId: "main",
      parentFloorId: floor1,
      state: "committed",
      createdAt: now + 20,
      updatedAt: now + 20,
    });

    service.stageSceneState({
      accountId: ACCOUNT_ID,
      sessionId,
      branchId: "main",
      floorId: floor1,
      runType: "respond",
      execution: createExecution(floor1, "The square is still quiet."),
      stagedAt: now + 40,
    });
    sessionStateService.applyStagedMutationsForFloor({
      accountId: ACCOUNT_ID,
      sessionId,
      branchId: "main",
      floorId: floor1,
      committedAt: now + 50,
    });

    service.stageSceneState({
      accountId: ACCOUNT_ID,
      sessionId,
      branchId: "main",
      floorId: floor2,
      runType: "respond",
      execution: createExecution(floor2, "The square is now crowded."),
      stagedAt: now + 60,
    });
    sessionStateService.applyStagedMutationsForFloor({
      accountId: ACCOUNT_ID,
      sessionId,
      branchId: "main",
      floorId: floor2,
      committedAt: now + 70,
    });

    const current = service.loadSceneContext({
      accountId: ACCOUNT_ID,
      sessionId,
      branchId: "main",
    });
    const sourceBaseline = service.loadSceneContext({
      accountId: ACCOUNT_ID,
      sessionId,
      branchId: "main",
      sourceFloorId: floor1,
      expectedSourceBranchId: "main",
      resolutionMode: "source_floor",
    });

    expect(current.scene?.generatedText).toBe("The square is now crowded.");
    expect(current.source).toBe("live_head");
    expect(sourceBaseline.scene?.generatedText).toBe("The square is still quiet.");
    expect(sourceBaseline.source).toBe("source_floor_snapshot");
    expect(sourceBaseline.floorId).toBe(floor1);
  });

  it("rejects source floors from an unexpected branch", async () => {
    const sessionId = nanoid();
    const floorId = nanoid();
    const now = 1_736_020_020_000;

    await seedSession(database, sessionId, now);
    await seedFloor(database, {
      id: floorId,
      sessionId,
      floorNo: 1,
      branchId: "main",
      parentFloorId: null,
      state: "committed",
      createdAt: now,
      updatedAt: now,
    });

    expect(() => service.loadSceneContext({
      accountId: ACCOUNT_ID,
      sessionId,
      branchId: "alt",
      sourceFloorId: floorId,
      expectedSourceBranchId: "alt",
      resolutionMode: "source_floor",
    })).toThrowError(FirstPartyGameStateServiceError);

    try {
      service.loadSceneContext({
        accountId: ACCOUNT_ID,
        sessionId,
        branchId: "alt",
        sourceFloorId: floorId,
        expectedSourceBranchId: "alt",
        resolutionMode: "source_floor",
      });
    } catch (error) {
      expect(error).toBeInstanceOf(FirstPartyGameStateServiceError);
      expect((error as FirstPartyGameStateServiceError).code).toBe("first_party_scene_source_floor_branch_mismatch");
    }
  });

  it("maps replay blockers from SessionStateService", async () => {
    const sessionId = nanoid();
    const floorId = nanoid();
    const now = 1_736_020_030_000;

    await seedSession(database, sessionId, now);
    await seedFloor(database, {
      id: floorId,
      sessionId,
      floorNo: 1,
      branchId: "main",
      parentFloorId: null,
      state: "committed",
      createdAt: now,
      updatedAt: now,
    });

    sessionStateService.stageCommitBoundValue({
      accountId: ACCOUNT_ID,
      sessionId,
      branchId: "main",
      sourceFloorId: floorId,
      namespace: "game_state",
      slot: "scene",
      value: buildSceneStateValue({
        sessionId,
        branchId: "main",
        floorId,
        runType: "respond",
        generatedText: "The lantern flickers.",
        updatedAt: now + 10,
      }),
      replaySafety: "confirm_on_replay",
    });
    sessionStateService.applyStagedMutationsForFloor({
      accountId: ACCOUNT_ID,
      sessionId,
      branchId: "main",
      floorId,
      committedAt: now + 20,
    });

    const evaluation = service.evaluateReplayBlockersForFloor({
      accountId: ACCOUNT_ID,
      sessionId,
      floorId,
    });

    expect(evaluation.allowed).toBe(false);
    expect(evaluation.blockers).toEqual([
      expect.objectContaining({
        blockerType: "session_state_mutation",
        reason: "confirmation_required",
        targetSlot: "scene",
      }),
    ]);
  });

  it("normalizes current v1 scene payloads with full writer defaults", () => {
    const normalized = service.normalizeSceneValue({
      kind: "first_party_scene_state",
      schemaVersion: 1,
      sessionId: "session-v1",
      branchId: "main",
      floorId: "floor-v1",
      runType: "respond",
      generatedText: "A quiet morning settles in.",
      summaries: ["A quiet morning settles in."],
      usage: { promptTokens: 5, completionTokens: 7, totalTokens: 12 },
      toolExecutionIds: ["exec-1"],
      updatedAt: 1_700_000_000_000,
    });

    expect(normalized.schemaVersion).toBe(1);
    expect(normalized.generatedText).toBe("A quiet morning settles in.");
    expect(normalized.summaries).toEqual(["A quiet morning settles in."]);
    expect(normalized.toolExecutionIds).toEqual(["exec-1"]);
    expect(normalized.usage).toEqual({ promptTokens: 5, completionTokens: 7, totalTokens: 12 });
  });

  it("accepts future v2 scene payloads and fills optional fields with safe defaults", () => {
    const normalized = service.normalizeSceneValue({
      kind: "first_party_scene_state",
      schemaVersion: 2,
      sessionId: "session-v2",
      branchId: "main",
      floorId: "floor-v2",
      runType: "respond",
      updatedAt: 1_700_000_000_500,
      // generatedText / summaries / usage / toolExecutionIds intentionally omitted
    });

    expect(normalized.schemaVersion).toBe(2);
    expect(normalized.generatedText).toBe("");
    expect(normalized.summaries).toEqual([]);
    expect(normalized.toolExecutionIds).toEqual([]);
    expect(normalized.usage).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  });

  it("rejects scene payloads with schemaVersion below the minimum supported version", () => {
    expect(() => service.normalizeSceneValue({
      kind: "first_party_scene_state",
      schemaVersion: 0,
      sessionId: "session-old",
      branchId: "main",
      floorId: "floor-old",
      runType: "respond",
      updatedAt: 1_700_000_000_000,
    })).toThrowError(FirstPartyGameStateServiceError);
  });

  it("rejects scene payloads with an unsupported runType", () => {
    expect(() => service.normalizeSceneValue({
      kind: "first_party_scene_state",
      schemaVersion: 1,
      sessionId: "session-bad-run",
      branchId: "main",
      floorId: "floor-bad-run",
      runType: "something_new",
      updatedAt: 1_700_000_000_000,
    })).toThrowError(FirstPartyGameStateServiceError);
  });
});

async function seedSession(database: DatabaseConnection, sessionId: string, now: number): Promise<void> {
  await database.db.insert(accounts).values({
    id: ACCOUNT_ID,
    name: ACCOUNT_ID,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing();
  await database.db.insert(sessions).values({
    id: sessionId,
    title: "First Party Game State Test",
    accountId: ACCOUNT_ID,
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
    parentFloorId: string | null;
    state: "draft" | "generating" | "committed" | "failed";
    createdAt: number;
    updatedAt: number;
  },
): Promise<void> {
  await database.db.insert(floors).values({
    id: floor.id,
    sessionId: floor.sessionId,
    floorNo: floor.floorNo,
    branchId: floor.branchId,
    parentFloorId: floor.parentFloorId,
    state: floor.state,
    tokenIn: 0,
    tokenOut: 0,
    createdAt: floor.createdAt,
    updatedAt: floor.updatedAt,
  });
}

function createExecution(_floorId: string, generatedText: string): Pick<TurnExecutionResult, "generatedText" | "summaries" | "totalUsage" | "toolExecutionRecords"> {
  return {
    generatedText,
    summaries: [generatedText],
    totalUsage: {
      promptTokens: 12,
      completionTokens: 34,
      totalTokens: 46,
    },
    toolExecutionRecords: [],
  };
}

function buildSceneStateValue(input: {
  sessionId: string;
  branchId: string;
  floorId: string;
  runType: "respond" | "retry_turn" | "regenerate_page" | "edit_and_regenerate";
  generatedText: string;
  updatedAt: number;
}) {
  return {
    kind: "first_party_scene_state",
    schemaVersion: 1,
    sessionId: input.sessionId,
    branchId: input.branchId,
    floorId: input.floorId,
    runType: input.runType,
    generatedText: input.generatedText,
    summaries: [input.generatedText],
    usage: {
      promptTokens: 1,
      completionTokens: 2,
      totalTokens: 3,
    },
    toolExecutionIds: [],
    updatedAt: input.updatedAt,
  };
}
