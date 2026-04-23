import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SimpleTokenCounter, type TurnExecutionResult, type TurnOrchestrator } from "@tavern/core";
import { nanoid } from "nanoid";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { accounts, floors, messagePages, messages, sessions } from "../../db/schema.js";
import { ChatService, ChatServiceError } from "../chat-service.js";
import { FirstPartyGameStateService } from "../../session-state/first-party-game-state-service.js";
import { SessionStateService } from "../../session-state/session-state-service.js";

const promptAssemblerMocks = vi.hoisted(() => ({
  assemblePrompt: vi.fn(),
}));

const branchLocalSnapshotMocks = vi.hoisted(() => ({
  materializeFromSourceFloor: vi.fn(),
  persistFloorLocalSnapshot: vi.fn(),
}));

vi.mock("../prompt-assembler.js", async () => {
  const actual = await vi.importActual<typeof import("../prompt-assembler.js")>("../prompt-assembler.js");
  return {
    ...actual,
    assemblePrompt: promptAssemblerMocks.assemblePrompt,
  };
});

vi.mock("../branch-local-variable-snapshot-service.js", async () => {
  const actual = await vi.importActual<typeof import("../branch-local-variable-snapshot-service.js")>("../branch-local-variable-snapshot-service.js");

  class MockBranchLocalVariableSnapshotService {
    constructor(_db: unknown) {}

    materializeFromSourceFloor(input: unknown) {
      return branchLocalSnapshotMocks.materializeFromSourceFloor(input);
    }

    persistFloorLocalSnapshot(input: unknown) {
      return branchLocalSnapshotMocks.persistFloorLocalSnapshot(input);
    }
  }

  return {
    ...actual,
    BranchLocalVariableSnapshotService: MockBranchLocalVariableSnapshotService,
  };
});

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
  let orchestrator: TurnOrchestrator;
  let chatService: ChatService;

  beforeEach(() => {
    database = createDatabase(":memory:");
    promptAssemblerMocks.assemblePrompt.mockReset();
    promptAssemblerMocks.assemblePrompt.mockImplementation(async (_db, _accountId, _sessionInfo, _history, userMessage) => (
      createAssembleResult(userMessage)
    ));
    branchLocalSnapshotMocks.materializeFromSourceFloor.mockReset();
    branchLocalSnapshotMocks.materializeFromSourceFloor.mockImplementation(() => undefined);
    branchLocalSnapshotMocks.persistFloorLocalSnapshot.mockReset();
    branchLocalSnapshotMocks.persistFloorLocalSnapshot.mockImplementation(() => undefined);
    sessionStateService = new SessionStateService(database.db, {
      clientData: CLIENT_DATA_CONFIG,
    });
    firstPartyGameStateService = new FirstPartyGameStateService(database.db, sessionStateService);
    orchestrator = createMockTurnOrchestrator();
    const turnCommitService = {
      commit: vi.fn(async () => ({
        usage: { promptTokens: 12, completionTokens: 34, totalTokens: 46 },
        finalState: "committed" as const,
        memory: undefined,
      })),
    };
    chatService = new ChatService(
      database.db,
      orchestrator,
      new SimpleTokenCounter(),
      {
        resolveTurnModels: async () => ({ narrator: { source: "env", generationParams: { maxOutputTokens: 128 } } }),
        turnCommitService: turnCommitService as never,
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

  it("loads current-effective and source-floor scene context through public respond flows", async () => {
    const sessionId = nanoid();
    const floor1 = nanoid();
    const now = 1_736_020_140_000;

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
    await stageCommittedScene({
      service: firstPartyGameStateService,
      sessionStateService,
      sessionId,
      branchId: "main",
      floorId: floor1,
      generatedText: "The harbor is still quiet.",
      committedAt: now + 10,
    });

    const buildSessionPromptInfoSpy = getBuildSessionPromptInfoSpy(chatService);

    const mainResult = await chatService.respond(sessionId, { message: "Continue the harbor scene." }, {}, ACCOUNT_ID);
    expect(mainResult.branchId).toBe("main");

    const mainContext = buildSessionPromptInfoSpy.mock.calls[0]?.[2] as { scene?: Record<string, unknown> } | undefined;
    expect(mainContext?.scene).toMatchObject({
      resolutionMode: "current_effective",
      source: "live_head",
      floorId: floor1,
      branchId: "main",
      sessionId,
      scene: expect.objectContaining({
        generatedText: "The harbor is still quiet.",
      }),
    });

    const branchResult = await chatService.respond(
      sessionId,
      { message: "Branch away from the harbor scene.", branchId: "alt", sourceFloorId: floor1 },
      {},
      ACCOUNT_ID,
    );
    expect(branchResult.branchId).toBe("alt");

    const branchContext = buildSessionPromptInfoSpy.mock.calls[1]?.[2] as { scene?: Record<string, unknown> } | undefined;
    expect(branchContext?.scene).toMatchObject({
      resolutionMode: "source_floor",
      source: "source_floor_snapshot",
      floorId: floor1,
      branchId: "alt",
      sessionId,
      scene: expect.objectContaining({
        generatedText: "The harbor is still quiet.",
      }),
    });
  });

  it("loads the parent floor scene snapshot through regenerate", async () => {
    const { sessionId, floor1, floor2, now } = await seedCommittedMainConversation(database, 1_736_020_150_000);
    await stageCommittedScene({
      service: firstPartyGameStateService,
      sessionStateService,
      sessionId,
      branchId: "main",
      floorId: floor1,
      generatedText: "The campfire is small and steady.",
      committedAt: now + 30,
    });
    await stageCommittedScene({
      service: firstPartyGameStateService,
      sessionStateService,
      sessionId,
      branchId: "main",
      floorId: floor2,
      generatedText: "The campfire flares into a blaze.",
      committedAt: now + 40,
    });

    const buildSessionPromptInfoSpy = getBuildSessionPromptInfoSpy(chatService);
    const result = await chatService.regenerate(sessionId, {}, ACCOUNT_ID);

    expect(result.previousFloorId).toBe(floor2);
    const firstPartyContext = buildSessionPromptInfoSpy.mock.calls[0]?.[2] as { scene?: Record<string, unknown> } | undefined;
    expect(firstPartyContext?.scene).toMatchObject({
      resolutionMode: "source_floor",
      source: "source_floor_snapshot",
      floorId: floor1,
      branchId: "main",
      sessionId,
      scene: expect.objectContaining({
        generatedText: "The campfire is small and steady.",
      }),
    });
  });

  it("loads the parent floor scene snapshot through retryFloor", async () => {
    const { sessionId, floor1, floor2, now } = await seedCommittedMainConversation(database, 1_736_020_160_000);
    await stageCommittedScene({
      service: firstPartyGameStateService,
      sessionStateService,
      sessionId,
      branchId: "main",
      floorId: floor1,
      generatedText: "A storm gathers over the ridge.",
      committedAt: now + 30,
    });
    await stageCommittedScene({
      service: firstPartyGameStateService,
      sessionStateService,
      sessionId,
      branchId: "main",
      floorId: floor2,
      generatedText: "Rain hits the ridge path.",
      committedAt: now + 40,
    });

    const buildSessionPromptInfoSpy = getBuildSessionPromptInfoSpy(chatService);
    const result = await chatService.retryFloor(floor2, {}, ACCOUNT_ID);

    expect(result.floorId).toBe(floor2);
    const firstPartyContext = buildSessionPromptInfoSpy.mock.calls[0]?.[2] as { scene?: Record<string, unknown> } | undefined;
    expect(firstPartyContext?.scene).toMatchObject({
      resolutionMode: "source_floor",
      source: "source_floor_snapshot",
      floorId: floor1,
      branchId: "main",
      sessionId,
      scene: expect.objectContaining({
        generatedText: "A storm gathers over the ridge.",
      }),
    });
  });

  it("loads the source floor scene snapshot through editAndRegenerate", async () => {
    const { sessionId, floor1, userMessageId, now } = await seedEditableConversation(database, 1_736_020_170_000);
    await stageCommittedScene({
      service: firstPartyGameStateService,
      sessionStateService,
      sessionId,
      branchId: "main",
      floorId: floor1,
      generatedText: "The archive is silent.",
      committedAt: now + 20,
    });

    const buildSessionPromptInfoSpy = getBuildSessionPromptInfoSpy(chatService);
    const result = await chatService.editAndRegenerate(
      userMessageId,
      { content: "Revise the archive scene." },
      ACCOUNT_ID,
    );

    expect(result.sourceFloorId).toBe(floor1);
    expect(result.sourceMessageId).toBe(userMessageId);
    const firstPartyContext = buildSessionPromptInfoSpy.mock.calls[0]?.[2] as { scene?: Record<string, unknown> } | undefined;
    expect(firstPartyContext?.scene).toMatchObject({
      resolutionMode: "source_floor",
      source: "source_floor_snapshot",
      floorId: floor1,
      branchId: result.branchId,
      sessionId,
      scene: expect.objectContaining({
        generatedText: "The archive is silent.",
      }),
    });
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

function createTurnExecution(floorId: string, generatedText?: string): TurnExecutionResult {
  const text = generatedText ?? `Generated scene for ${floorId}`;
  return {
    floorId,
    finalState: "generating",
    generatedText: text,
    rawText: text,
    summaries: [text],
    totalUsage: {
      promptTokens: 12,
      completionTokens: 34,
      totalTokens: 46,
    },
    toolExecutionRecords: [],
    pendingToolJobs: [],
    bufferedVariableMutations: [],
  } as unknown as TurnExecutionResult;
}

function createMockTurnOrchestrator(): TurnOrchestrator {
  return {
    executeTurn: vi.fn(async (input) => createTurnExecution(input.floorId)),
  } as unknown as TurnOrchestrator;
}

function createAssembleResult(userMessage: string) {
  return {
    messages: [
      { role: "system", content: "Scene guidance" },
      { role: "user", content: userMessage },
    ],
    sendDirectives: {},
    promptSnapshot: {
      presetId: null,
      presetUpdatedAt: null,
      presetVersion: null,
      worldbookId: null,
      worldbookUpdatedAt: null,
      worldbookVersion: null,
      regexProfileId: null,
      regexProfileUpdatedAt: null,
      regexProfileVersion: null,
      worldbookActivatedEntryUids: [],
      regexPreRuleNames: [],
      regexPostRuleNames: [],
      promptMode: null,
      promptDigest: "",
      tokenEstimate: 0,
      createdAt: 1_736_020_000_000,
    },
    tokenUsage: {
      total: 4,
      availableForReply: 96,
      byGroup: {},
      bySection: [],
      prunedByGroup: {},
      allocator: {
        trimReasons: [],
        estimatedByGroup: {},
        allocatedByGroup: {},
      },
    },
    runtimeTraceSeed: {
      worldbookHits: 0,
      macroStagedMutations: [],
    },
  } as const;
}

async function seedInputPage(database: DatabaseConnection, input: { floorId: string; pageId: string; now: number }): Promise<void> {
  await database.db.insert(messagePages).values({
    id: input.pageId,
    floorId: input.floorId,
    pageNo: 1,
    pageKind: "input",
    isActive: true,
    version: 1,
    checksum: null,
    createdAt: input.now,
    updatedAt: input.now,
  });
}

async function seedUserMessage(database: DatabaseConnection, input: { pageId: string; messageId: string; content: string; now: number }): Promise<void> {
  await database.db.insert(messages).values({
    id: input.messageId,
    pageId: input.pageId,
    seq: 1,
    role: "user",
    content: input.content,
    contentFormat: "text",
    tokenCount: 0,
    isHidden: false,
    source: "user",
    createdAt: input.now,
  });
}

async function seedCommittedMainConversation(database: DatabaseConnection, now: number): Promise<{
  sessionId: string;
  floor1: string;
  floor2: string;
  userMessageId: string;
  pageId: string;
  now: number;
}> {
  const sessionId = nanoid();
  const floor1 = nanoid();
  const floor2 = nanoid();
  const pageId = nanoid();
  const userMessageId = nanoid();

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
    createdAt: now + 10,
    updatedAt: now + 10,
  });
  await seedInputPage(database, { floorId: floor2, pageId, now: now + 10 });
  await seedUserMessage(database, { pageId, messageId: userMessageId, content: "Describe what happens next.", now: now + 10 });

  return { sessionId, floor1, floor2, userMessageId, pageId, now };
}

async function seedEditableConversation(database: DatabaseConnection, now: number): Promise<{
  sessionId: string;
  floor1: string;
  userMessageId: string;
  pageId: string;
  now: number;
}> {
  const sessionId = nanoid();
  const floor1 = nanoid();
  const pageId = nanoid();
  const userMessageId = nanoid();

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
  await seedInputPage(database, { floorId: floor1, pageId, now });
  await seedUserMessage(database, { pageId, messageId: userMessageId, content: "Rewrite the archive scene.", now });

  return { sessionId, floor1, userMessageId, pageId, now };
}

async function stageCommittedScene(input: {
  service: FirstPartyGameStateService;
  sessionStateService: SessionStateService;
  sessionId: string;
  branchId: string;
  floorId: string;
  generatedText: string;
  committedAt: number;
}): Promise<void> {
  input.service.stageSceneState({
    accountId: ACCOUNT_ID,
    sessionId: input.sessionId,
    branchId: input.branchId,
    floorId: input.floorId,
    runType: "respond",
    execution: createTurnExecution(input.floorId, input.generatedText),
    stagedAt: input.committedAt - 1,
  });
  input.sessionStateService.applyStagedMutationsForFloor({
    accountId: ACCOUNT_ID,
    sessionId: input.sessionId,
    branchId: input.branchId,
    floorId: input.floorId,
    committedAt: input.committedAt,
  });
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

function getBuildSessionPromptInfoSpy(service: ChatService) {
  return vi.spyOn(
    service as unknown as {
      buildSessionPromptInfo: (
        session: unknown,
        resolvedTurnModels: unknown,
        firstPartyStateContext?: unknown,
      ) => { metadataJson: string | null };
    },
    "buildSessionPromptInfo",
  );
}
