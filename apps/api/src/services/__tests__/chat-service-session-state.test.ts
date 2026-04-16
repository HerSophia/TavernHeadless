import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SimpleTokenCounter, type TurnOrchestrator } from "@tavern/core";
import { nanoid } from "nanoid";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { accounts, floors, sessions } from "../../db/schema.js";
import { ChatService, ChatServiceError } from "../chat-service.js";
import { FirstPartyGameStateService } from "../../session-state/first-party-game-state-service.js";
import { SessionStateService } from "../../session-state/session-state-service.js";

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

describe("ChatService session-state replay gate", () => {
  let database: DatabaseConnection;
  let sessionStateService: SessionStateService;
  let firstPartyGameStateService: FirstPartyGameStateService;
  let chatService: ChatService;

  beforeEach(() => {
    database = createDatabase(":memory:");
    sessionStateService = new SessionStateService(database.db, {
      clientData: CLIENT_DATA_CONFIG,
    });
    firstPartyGameStateService = new FirstPartyGameStateService(database.db, sessionStateService);
    chatService = new ChatService(
      database.db,
      {} as TurnOrchestrator,
      new SimpleTokenCounter(),
      {
        sessionStateService,
        firstPartyGameStateService,
      },
    );
  });

  afterEach(() => {
    database.close();
  });

  it("requires explicit confirmation for session-state replay blockers", async () => {
    const sessionId = nanoid();
    const floorId = nanoid();
    const now = 1_736_020_100_000;

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

    const mutation = sessionStateService.stageCommitBoundValue({
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
        generatedText: "A torch burns in the hall.",
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

    const assertRetryReplayConfirmed = getAssertRetryReplayConfirmed(chatService);

    await expect(assertRetryReplayConfirmed({
      floorId,
      sessionId,
      accountId: ACCOUNT_ID,
      request: {},
    })).rejects.toMatchObject({
      code: "session_state_replay_confirmation_required",
      details: {
        blocking_session_state_mutations: [
          expect.objectContaining({
            mutation_id: mutation.id,
            reason: "confirmation_required",
            target_slot: "scene",
          }),
        ],
      },
    } satisfies Partial<ChatServiceError>);
  });

  it("allows retry after confirming the required session-state mutation ids", async () => {
    const sessionId = nanoid();
    const floorId = nanoid();
    const now = 1_736_020_110_000;

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

    const mutation = sessionStateService.stageCommitBoundValue({
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
        generatedText: "Rain hits the roof.",
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

    const assertRetryReplayConfirmed = getAssertRetryReplayConfirmed(chatService);

    await expect(assertRetryReplayConfirmed({
      floorId,
      sessionId,
      accountId: ACCOUNT_ID,
      request: {
        confirmedSessionStateMutationIds: [mutation.id],
      },
    })).resolves.toBeUndefined();
  });

  it("hard-blocks retry when a session-state mutation is never auto replayable", async () => {
    const sessionId = nanoid();
    const floorId = nanoid();
    const now = 1_736_020_120_000;

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

    const mutation = sessionStateService.stageCommitBoundValue({
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
        generatedText: "The altar seals itself.",
        updatedAt: now + 10,
      }),
      replaySafety: "never_auto_replay",
    });
    sessionStateService.applyStagedMutationsForFloor({
      accountId: ACCOUNT_ID,
      sessionId,
      branchId: "main",
      floorId,
      committedAt: now + 20,
    });

    const assertRetryReplayConfirmed = getAssertRetryReplayConfirmed(chatService);

    await expect(assertRetryReplayConfirmed({
      floorId,
      sessionId,
      accountId: ACCOUNT_ID,
      request: {
        confirmedSessionStateMutationIds: [mutation.id],
      },
    })).rejects.toMatchObject({
      code: "session_state_replay_blocked",
      details: {
        blocking_session_state_mutations: [
          expect.objectContaining({
            mutation_id: mutation.id,
            reason: "never_auto_replay",
          }),
        ],
      },
    } satisfies Partial<ChatServiceError>);
  });

  it("threads managed scene context into the shared prompt metadata carrier", () => {
    const buildSessionPromptInfo = getBuildSessionPromptInfo(chatService);
    const sessionId = "session-carrier";
    const branchId = "branch-carrier";
    const floorId = "floor-carrier";
    const updatedAt = 1_736_020_130_000;

    const sessionInfo = buildSessionPromptInfo(
      {
        presetId: null,
        worldbookProfileId: null,
        regexProfileId: null,
        metadataJson: JSON.stringify({ persona: { name: "Traveler" } }),
        characterSnapshotJson: null,
        promptMode: null,
        userSnapshotJson: null,
      },
      { narrator: undefined },
      {
        scene: {
          namespace: "game_state",
          slot: "scene",
          resolutionMode: "source_floor",
          source: "source_floor_snapshot",
          present: true,
          schemaVersion: 1,
          sessionId,
          branchId,
          floorId,
          sourceMutationIds: ["mutation-1"],
          updatedAt,
          scene: buildSceneStateValue({
            sessionId,
            branchId,
            floorId,
            generatedText: "The room is quiet.",
            updatedAt,
          }),
        },
      },
    );

    const metadata = JSON.parse(sessionInfo.metadataJson ?? "{}") as {
      persona?: { name?: string };
      first_party_state?: {
        scene?: {
          source?: string;
          resolution_mode?: string;
          floor_id?: string | null;
          present?: boolean;
          schema_version?: number | null;
          source_mutation_ids?: string[];
          generatedText?: string;
        };
      };
    };

    expect(metadata.persona).toEqual({ name: "Traveler" });
    expect(metadata.first_party_state?.scene).toMatchObject({
      source: "source_floor_snapshot",
      resolution_mode: "source_floor",
      floor_id: floorId,
      present: true,
      schema_version: 1,
      source_mutation_ids: ["mutation-1"],
    });
    expect(metadata.first_party_state?.scene?.generatedText).toBeUndefined();
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
    title: "Chat Service Session-State Replay Test",
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

function buildSceneStateValue(input: {
  sessionId: string;
  branchId: string;
  floorId: string;
  generatedText: string;
  updatedAt: number;
}) {
  return {
    kind: "first_party_scene_state",
    schemaVersion: 1,
    sessionId: input.sessionId,
    branchId: input.branchId,
    floorId: input.floorId,
    runType: "respond",
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

function getAssertRetryReplayConfirmed(service: ChatService): (input: {
  floorId: string;
  sessionId: string;
  accountId: string;
  request: { confirmedSessionStateMutationIds?: string[]; confirmedExecutionIds?: string[] };
}) => Promise<void> {
  return (service as unknown as {
    assertRetryReplayConfirmed: (input: {
      floorId: string;
      sessionId: string;
      accountId: string;
      request: { confirmedSessionStateMutationIds?: string[]; confirmedExecutionIds?: string[] };
    }) => Promise<void>;
  }).assertRetryReplayConfirmed.bind(service);
}

function getBuildSessionPromptInfo(service: ChatService): (
  session: {
    presetId: string | null;
    worldbookProfileId: string | null;
    regexProfileId: string | null;
    metadataJson: string | null;
    characterSnapshotJson: string | null;
    promptMode?: "compat_strict" | "compat_plus" | "native" | null;
    userSnapshotJson?: string | null;
  },
  resolvedTurnModels: unknown,
  firstPartyStateContext?: unknown,
) => { metadataJson: string | null } {
  return (service as unknown as {
    buildSessionPromptInfo: (
      session: {
        presetId: string | null;
        worldbookProfileId: string | null;
        regexProfileId: string | null;
        metadataJson: string | null;
        characterSnapshotJson: string | null;
        promptMode?: "compat_strict" | "compat_plus" | "native" | null;
        userSnapshotJson?: string | null;
      },
      resolvedTurnModels: unknown,
      firstPartyStateContext?: unknown,
    ) => { metadataJson: string | null };
  }).buildSessionPromptInfo.bind(service);
}
