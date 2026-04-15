import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SimpleTokenCounter, createEventBus, type TurnExecutionResult } from "@tavern/core";
import { nanoid } from "nanoid";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { accounts, floors, messagePages, messages, sessions } from "../../db/schema.js";
import { ChatMessagePersistence } from "../../services/chat-message-persistence.js";
import { TurnCommitService } from "../../services/turn-commit-service.js";
import { FirstPartyGameStateConsumer } from "../session-state-first-party-consumer.js";
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

describe("SessionStateService", () => {
  let database: DatabaseConnection;
  let service: SessionStateService;

  beforeEach(() => {
    database = createDatabase(":memory:");
    service = new SessionStateService(database.db, {
      clientData: CLIENT_DATA_CONFIG,
    });
  });

  afterEach(() => {
    database.close();
  });

  it("stages first-party scene state and applies it during turn commit", async () => {
    const sessionId = nanoid();
    const floorId = nanoid();
    const pageId = nanoid();
    const userMessageId = nanoid();
    const now = 1_735_900_000_000;

    await seedSession(database, sessionId, now);
    await seedFloor(database, {
      id: floorId,
      sessionId,
      floorNo: 1,
      branchId: "main",
      parentFloorId: null,
      state: "generating",
      createdAt: now,
      updatedAt: now,
    });
    await seedInputPage(database, { floorId, pageId, now });
    await seedUserMessage(database, { pageId, messageId: userMessageId, content: "Describe the scene.", now });

    const execution = createExecution({
      floorId,
      generatedText: "Rain moves across the ruined courtyard.",
      summaries: ["The courtyard is now soaked in rain."],
      promptTokens: 12,
      completionTokens: 24,
    });

    const consumer = new FirstPartyGameStateConsumer(service);
    const stagedMutation = consumer.stageSceneState({
      accountId: ACCOUNT_ID,
      sessionId,
      branchId: "main",
      floorId,
      runType: "respond",
      execution,
      stagedAt: now + 100,
    });
    expect(stagedMutation.status).toBe("staged");

    const commitService = new TurnCommitService(
      database.db,
      new ChatMessagePersistence(database.db, new SimpleTokenCounter()),
      createEventBus(),
      { sessionStateService: service },
    );

    const result = await commitService.commit({
      accountId: ACCOUNT_ID,
      floorId,
      sessionId,
      branchId: "main",
      execution,
      committedAt: now + 200,
    });

    expect(result.finalState).toBe("committed");

    const live = service.resolveLiveValue({
      accountId: ACCOUNT_ID,
      sessionId,
      branchId: "main",
      namespace: "game_state",
      slot: "scene",
    });
    expect(live).not.toBeNull();
    expect(live?.present).toBe(true);
    expect(live?.source).toBe("live_head");
    expect(asRecord(live?.value)?.generatedText).toBe("Rain moves across the ruined courtyard.");

    const snapshot = service.getFloorSnapshot({
      accountId: ACCOUNT_ID,
      sessionId,
      floorId,
      namespace: "game_state",
      slot: "scene",
    });
    expect(snapshot).not.toBeNull();
    expect(snapshot?.present).toBe(true);
    expect(asRecord(snapshot?.value)?.generatedText).toBe("Rain moves across the ruined courtyard.");
  });

  it("discarding a staged mutation does not pollute the live head", async () => {
    const sessionId = nanoid();
    const floor1 = nanoid();
    const floor2 = nanoid();
    const now = 1_735_900_010_000;

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
      state: "failed",
      createdAt: now + 10,
      updatedAt: now + 10,
    });

    await stageAndApplySceneState(service, {
      accountId: ACCOUNT_ID,
      sessionId,
      branchId: "main",
      floorId: floor1,
      committedAt: now + 100,
      value: { revision: 1, label: "alpha" },
    });

    const staged = service.stageCommitBoundValue({
      accountId: ACCOUNT_ID,
      sessionId,
      branchId: "main",
      sourceFloorId: floor2,
      namespace: "game_state",
      slot: "scene",
      value: { revision: 2, label: "beta" },
    });
    expect(staged.status).toBe("staged");

    const discarded = service.discardStagedMutationsForFloor({
      accountId: ACCOUNT_ID,
      sessionId,
      floorId: floor2,
      reason: "turn_failed",
    });
    expect(discarded).toHaveLength(1);
    expect(discarded[0]?.status).toBe("discarded");

    const live = service.resolveLiveValue({
      accountId: ACCOUNT_ID,
      sessionId,
      branchId: "main",
      namespace: "game_state",
      slot: "scene",
    });
    expect(asRecord(live?.value)?.label).toBe("alpha");
  });

  it("resolves fork_on_branch state from source floor snapshots instead of current main live head", async () => {
    const sessionId = nanoid();
    const floor1 = nanoid();
    const floor2 = nanoid();
    const branchFloor = nanoid();
    const branchFloor2 = nanoid();
    const now = 1_735_900_020_000;

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
    await seedFloor(database, {
      id: branchFloor,
      sessionId,
      floorNo: 2,
      branchId: "alt",
      parentFloorId: floor1,
      state: "committed",
      createdAt: now + 30,
      updatedAt: now + 30,
    });
    await seedFloor(database, {
      id: branchFloor2,
      sessionId,
      floorNo: 3,
      branchId: "alt",
      parentFloorId: branchFloor,
      state: "draft",
      createdAt: now + 40,
      updatedAt: now + 40,
    });

    await stageAndApplySceneState(service, {
      accountId: ACCOUNT_ID,
      sessionId,
      branchId: "main",
      floorId: floor1,
      committedAt: now + 100,
      value: { revision: 1, label: "source" },
    });
    await stageAndApplySceneState(service, {
      accountId: ACCOUNT_ID,
      sessionId,
      branchId: "main",
      floorId: floor2,
      committedAt: now + 200,
      value: { revision: 2, label: "main-latest" },
    });

    const branchPreview = service.resolveLiveValue({
      accountId: ACCOUNT_ID,
      sessionId,
      branchId: "alt",
      sourceFloorId: floor1,
      namespace: "game_state",
      slot: "scene",
    });
    expect(asRecord(branchPreview?.value)?.label).toBe("source");
    expect(branchPreview?.source).toBe("source_floor_snapshot");

    const branchMaterialized = service.applyStagedMutationsForFloor({
      accountId: ACCOUNT_ID,
      sessionId,
      branchId: "alt",
      floorId: branchFloor,
      committedAt: now + 300,
    });
    expect(branchMaterialized.snapshots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          floorId: branchFloor,
          namespace: "game_state",
          slot: "scene",
          present: true,
        }),
      ]),
    );

    const branchLiveAfterMaterialize = service.resolveLiveValue({
      accountId: ACCOUNT_ID,
      sessionId,
      branchId: "alt",
      namespace: "game_state",
      slot: "scene",
    });
    expect(asRecord(branchLiveAfterMaterialize?.value)?.label).toBe("source");
    expect(branchLiveAfterMaterialize?.source).toBe("latest_branch_snapshot");

    await stageAndApplySceneState(service, {
      accountId: ACCOUNT_ID,
      sessionId,
      branchId: "alt",
      floorId: branchFloor2,
      committedAt: now + 400,
      value: { revision: 3, label: "alt-own" },
    });

    const mainLive = service.resolveLiveValue({
      accountId: ACCOUNT_ID,
      sessionId,
      branchId: "main",
      namespace: "game_state",
      slot: "scene",
    });
    const branchLive = service.resolveLiveValue({
      accountId: ACCOUNT_ID,
      sessionId,
      branchId: "alt",
      namespace: "game_state",
      slot: "scene",
    });

    expect(asRecord(mainLive?.value)?.label).toBe("main-latest");
    expect(asRecord(branchLive?.value)?.label).toBe("alt-own");
  });

  it("uses newer direct writes when later floor snapshots are materialized without slot mutations", async () => {
    const sessionId = nanoid();
    const floor1 = nanoid();
    const floor2 = nanoid();
    const now = 1_735_900_030_000;

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

    await stageAndApplySceneState(service, {
      accountId: ACCOUNT_ID,
      sessionId,
      branchId: "main",
      floorId: floor1,
      committedAt: now + 100,
      value: { revision: 1, label: "before-direct" },
    });

    const directMutation = service.writeDirectValue({
      accountId: ACCOUNT_ID,
      sessionId,
      branchId: "main",
      namespace: "game_state",
      slot: "scene",
      value: { revision: 2, label: "direct-write" },
      requestId: "direct-scene",
    });
    expect(directMutation.status).toBe("applied");

    service.applyStagedMutationsForFloor({
      accountId: ACCOUNT_ID,
      sessionId,
      branchId: "main",
      floorId: floor2,
      committedAt: now + 200,
    });

    const snapshot = service.getFloorSnapshot({
      accountId: ACCOUNT_ID,
      sessionId,
      floorId: floor2,
      namespace: "game_state",
      slot: "scene",
    });
    expect(asRecord(snapshot?.value)?.label).toBe("direct-write");
  });

  it("evaluates replay safety for confirmation, hard block, and uncertainty", async () => {
    const sessionId = nanoid();
    const floor1 = nanoid();
    const floor2 = nanoid();
    const floor3 = nanoid();
    const now = 1_735_900_040_000;

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
    await seedFloor(database, {
      id: floor3,
      sessionId,
      floorNo: 3,
      branchId: "main",
      parentFloorId: floor2,
      state: "committed",
      createdAt: now + 40,
      updatedAt: now + 40,
    });

    const confirmMutation = await stageAndApplySceneState(service, {
      accountId: ACCOUNT_ID,
      sessionId,
      branchId: "main",
      floorId: floor1,
      committedAt: now + 100,
      value: { revision: 1, label: "confirm" },
      replaySafety: "confirm_on_replay",
    });

    const confirmationRequired = service.evaluateReplaySafetyForFloor({
      accountId: ACCOUNT_ID,
      sessionId,
      floorId: floor1,
    });
    expect(confirmationRequired.allowed).toBe(false);
    expect(confirmationRequired.blockers).toEqual([
      expect.objectContaining({
        mutationId: confirmMutation.id,
        reason: "confirmation_required",
      }),
    ]);

    const confirmed = service.evaluateReplaySafetyForFloor({
      accountId: ACCOUNT_ID,
      sessionId,
      floorId: floor1,
      confirmedMutationIds: [confirmMutation.id],
    });
    expect(confirmed.allowed).toBe(true);

    const blockedMutation = await stageAndApplySceneState(service, {
      accountId: ACCOUNT_ID,
      sessionId,
      branchId: "main",
      floorId: floor2,
      committedAt: now + 200,
      value: { revision: 2, label: "blocked" },
      replaySafety: "never_auto_replay",
    });
    const blocked = service.evaluateReplaySafetyForFloor({
      accountId: ACCOUNT_ID,
      sessionId,
      floorId: floor2,
    });
    expect(blocked.allowed).toBe(false);
    expect(blocked.blockers).toEqual([
      expect.objectContaining({
        mutationId: blockedMutation.id,
        reason: "never_auto_replay",
      }),
    ]);

    const uncertainMutation = service.writeDirectValue({
      accountId: ACCOUNT_ID,
      sessionId,
      branchId: "main",
      namespace: "game_state",
      slot: "scene",
      value: { revision: 3, label: "uncertain" },
      sourceFloorId: floor3,
      replaySafety: "uncertain",
    });
    const uncertain = service.evaluateReplaySafetyForFloor({
      accountId: ACCOUNT_ID,
      sessionId,
      floorId: floor3,
    });
    expect(uncertainMutation.status).toBe("uncertain");
    expect(uncertain.allowed).toBe(false);
    expect(uncertain.blockers).toEqual([expect.objectContaining({ reason: "uncertain" })]);
  });
});

async function seedAccount(database: DatabaseConnection, accountId: string, now: number): Promise<void> {
  await database.db.insert(accounts).values({
    id: accountId,
    name: accountId,
    createdAt: now,
    updatedAt: now,
  });
}

async function seedSession(database: DatabaseConnection, sessionId: string, now: number): Promise<void> {
  await database.db.insert(sessions).values({
    id: sessionId,
    title: "Session State Test",
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

async function seedInputPage(
  database: DatabaseConnection,
  input: { floorId: string; pageId: string; now: number },
): Promise<void> {
  await database.db.insert(messagePages).values({
    id: input.pageId,
    floorId: input.floorId,
    pageNo: 0,
    pageKind: "input",
    isActive: true,
    version: 1,
    checksum: null,
    createdAt: input.now,
    updatedAt: input.now,
  });
}

async function seedUserMessage(
  database: DatabaseConnection,
  input: { pageId: string; messageId: string; content: string; now: number },
): Promise<void> {
  await database.db.insert(messages).values({
    id: input.messageId,
    pageId: input.pageId,
    seq: 0,
    role: "user",
    content: input.content,
    contentFormat: "text",
    tokenCount: input.content.length,
    isHidden: false,
    source: "api",
    createdAt: input.now,
  });
}

function createExecution(input: {
  floorId: string;
  generatedText: string;
  summaries: string[];
  promptTokens: number;
  completionTokens: number;
}): TurnExecutionResult {
  return {
    floorId: input.floorId,
    finalState: "generating",
    generatedText: input.generatedText,
    rawText: input.generatedText,
    summaries: input.summaries,
    totalUsage: {
      promptTokens: input.promptTokens,
      completionTokens: input.completionTokens,
      totalTokens: input.promptTokens + input.completionTokens,
    },
    toolExecutionRecords: [],
  };
}

async function stageAndApplySceneState(
  service: SessionStateService,
  input: {
    accountId: string;
    sessionId: string;
    branchId: string;
    floorId: string;
    committedAt: number;
    value: unknown;
    replaySafety?: "safe" | "confirm_on_replay" | "never_auto_replay" | "uncertain";
  },
) {
  const staged = service.stageCommitBoundValue({
    accountId: input.accountId,
    sessionId: input.sessionId,
    branchId: input.branchId,
    sourceFloorId: input.floorId,
    namespace: "game_state",
    slot: "scene",
    value: input.value,
    replaySafety: input.replaySafety,
  });
  service.applyStagedMutationsForFloor({
    accountId: input.accountId,
    sessionId: input.sessionId,
    branchId: input.branchId,
    floorId: input.floorId,
    committedAt: input.committedAt,
  });
  return staged;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
