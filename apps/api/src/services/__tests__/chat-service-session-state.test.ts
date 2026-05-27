import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { SimpleTokenCounter, type TurnExecutionResult, type TurnInput, type TurnOrchestrator } from "@tavern/core";
import { nanoid } from "nanoid";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { accounts, floors, messagePages, messages, sessions, sessionStateMutations } from "../../db/schema.js";
import { ChatService, ChatServiceError } from "../chat-service.js";
import { FirstPartyGameStateService } from "../../session-state/first-party-game-state-service.js";
import { SessionStateCustomNamespaceService } from "../../session-state/session-state-custom-namespace-service.js";
import { SessionStateService } from "../../session-state/session-state-service.js";
import { SessionBranchRegistryService } from "../variables/host/session-branch-registry-service.js";
import { OperationLogService } from "../operation-log-service.js";

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
  let customNamespaceService: SessionStateCustomNamespaceService;
  let turnCommitMock: ReturnType<typeof vi.fn>;
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
    customNamespaceService = new SessionStateCustomNamespaceService(database.db, {
      clientData: CLIENT_DATA_CONFIG,
    });
    sessionStateService = new SessionStateService(database.db, {
      clientData: CLIENT_DATA_CONFIG,
      customNamespaceService,
    });
    firstPartyGameStateService = new FirstPartyGameStateService(database.db, sessionStateService);
    orchestrator = createMockTurnOrchestrator();
    turnCommitMock = vi.fn(async () => ({
      usage: { promptTokens: 12, completionTokens: 34, totalTokens: 46 },
      finalState: "committed" as const,
      memory: undefined,
    }));
    chatService = new ChatService(
      database.db,
      orchestrator,
      new SimpleTokenCounter(),
      {
        resolveTurnModels: async () => ({ narrator: { source: "env", generationParams: { maxOutputTokens: 128 } } }),
        turnCommitService: {
          commit: turnCommitMock,
        } as never,
        sessionStateService,
        firstPartyGameStateService,
      },
    );
  });

  afterEach(() => {
    database.close();
  });

  it("passes a rejected variable pageDecision when the source page disappears before commit", async () => {
    const sessionId = nanoid();
    const now = 1_736_020_090_000;
    let sourcePageId: string | undefined;

    await seedSession(database, sessionId, now);

    const executeTurnMock = orchestrator.executeTurn as unknown as ReturnType<typeof vi.fn>;
    executeTurnMock.mockImplementationOnce(async (input: TurnInput) => {
      expect(input.pageId).toBeDefined();
      sourcePageId = input.pageId!;
      await database.db.delete(messagePages).where(eq(messagePages.id, sourcePageId)).run();

      return {
        ...createTurnExecution(input.floorId, "Variable write after source page removal."),
        bufferedVariableMutations: [
          {
            runId: "run-page-missing",
            generationAttemptNo: 1,
            scope: "page",
            scopeId: sourcePageId,
            key: "mood",
            value: "guarded",
            intent: "promote_to_floor_on_accept",
            bufferedAt: now + 10,
          },
        ],
      } as TurnExecutionResult;
    });

    await chatService.respond(sessionId, { message: "Continue the scene." }, {}, ACCOUNT_ID);

    const commitInput = turnCommitMock.mock.calls[0]?.[0];
    expect(commitInput?.variableCommit).toMatchObject({
      pageId: sourcePageId,
      actorClientId: null,
      rerouteToSessionState: false,
    });
  });

  it("passes a discarded variable pageDecision when the source page is no longer active at commit time", async () => {
    const sessionId = nanoid();
    const now = 1_736_020_095_000;
    let sourcePageId: string | undefined;

    await seedSession(database, sessionId, now);

    const executeTurnMock = orchestrator.executeTurn as unknown as ReturnType<typeof vi.fn>;
    executeTurnMock.mockImplementationOnce(async (input: TurnInput) => {
      expect(input.pageId).toBeDefined();
      sourcePageId = input.pageId!;
      await database.db.update(messagePages).set({ isActive: false, updatedAt: now + 20 }).where(eq(messagePages.id, sourcePageId)).run();

      return {
        ...createTurnExecution(input.floorId, "Variable write after page deactivation."),
        bufferedVariableMutations: [
          {
            runId: "run-page-inactive",
            generationAttemptNo: 1,
            scope: "page",
            scopeId: sourcePageId,
            key: "topic",
            value: "storm",
            intent: "promote_to_floor_on_accept",
            bufferedAt: now + 10,
          },
        ],
      } as TurnExecutionResult;
    });

    await chatService.respond(sessionId, { message: "Continue the scene." }, {}, ACCOUNT_ID);

    const commitInput = turnCommitMock.mock.calls[0]?.[0];
    expect(commitInput?.variableCommit).toMatchObject({
      pageId: sourcePageId,
      actorClientId: null,
      rerouteToSessionState: false,
    });
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

  it("applies custom session_state_writes after a successful respond commit", async () => {
    const sessionId = nanoid();
    const now = 1_736_020_125_000;

    await seedSession(database, sessionId, now);
    customNamespaceService.registerNamespace({
      accountId: ACCOUNT_ID,
      sessionId,
      namespace: "quest_flags",
      logicalOwnerType: "plugin",
      logicalOwnerId: "quest-plugin",
    });

    turnCommitMock.mockImplementationOnce(async (input: {
      accountId: string;
      sessionId: string;
      branchId?: string;
      floorId: string;
    }) => {
      sessionStateService.applyStagedMutationsForFloor({
        accountId: input.accountId,
        sessionId: input.sessionId,
        branchId: input.branchId ?? "main",
        floorId: input.floorId,
        committedAt: now + 100,
      });
      return {
        usage: { promptTokens: 12, completionTokens: 34, totalTokens: 46 },
        finalState: "committed" as const,
        memory: undefined,
      };
    });

    const result = await chatService.respond(
      sessionId,
      {
        message: "Continue the quest.",
        sessionStateWrites: [
          {
            namespace: "quest_flags",
            slot: "companion",
            value: { mood: "ally" },
          },
          {
            namespace: "quest_flags",
            slot: "expired_hint",
            delete: true,
          },
        ],
      },
      {},
      ACCOUNT_ID,
    );

    expect(result.finalState).toBe("committed");

    const liveCompanion = sessionStateService.resolveLiveValue({
      accountId: ACCOUNT_ID,
      sessionId,
      branchId: result.branchId,
      namespace: "quest_flags",
      slot: "companion",
    });
    expect(liveCompanion?.present).toBe(true);
    expect(liveCompanion?.value).toEqual({ mood: "ally" });

    const liveDeleted = sessionStateService.resolveLiveValue({
      accountId: ACCOUNT_ID,
      sessionId,
      branchId: result.branchId,
      namespace: "quest_flags",
      slot: "expired_hint",
    });
    expect(liveDeleted?.present).toBe(false);
    expect(liveDeleted?.value).toBeNull();
  });

  it("records operation logs for turn-bound session_state_writes without storing values", async () => {
    const sessionId = nanoid();
    const now = 1_736_020_125_500;

    await seedSession(database, sessionId, now);
    customNamespaceService.registerNamespace({
      accountId: ACCOUNT_ID,
      sessionId,
      namespace: "quest_flags",
      logicalOwnerType: "plugin",
      logicalOwnerId: "quest-plugin",
    });

    turnCommitMock.mockImplementationOnce(async (input: {
      accountId: string;
      sessionId: string;
      branchId?: string;
      floorId: string;
    }) => {
      sessionStateService.applyStagedMutationsForFloor({
        accountId: input.accountId,
        sessionId: input.sessionId,
        branchId: input.branchId ?? "main",
        floorId: input.floorId,
        committedAt: now + 100,
      });
      return {
        usage: { promptTokens: 12, completionTokens: 34, totalTokens: 46 },
        finalState: "committed" as const,
        memory: undefined,
      };
    });

    const result = await chatService.respond(
      sessionId,
      {
        message: "Continue the quest.",
        sessionStateWrites: [
          {
            namespace: "quest_flags",
            slot: "companion",
            value: { secret: "SECRET_TURN_STATE_VALUE", mood: "ally" },
          },
          {
            namespace: "quest_flags",
            slot: "expired_hint",
            delete: true,
          },
        ],
        sessionStateOperationLog: {
          actorType: "user",
          actorId: ACCOUNT_ID,
          sourceType: "http",
          requestId: "request-session-state-writes",
          route: "POST /sessions/:id/respond",
        },
        turnOperationLog: {
          requestId: "request-floor-commit",
          route: "POST /sessions/:id/respond",
        },
      },
      {},
      ACCOUNT_ID,
    );

    expect(result.finalState).toBe("committed");
    const commitInput = turnCommitMock.mock.calls[0]?.[0];
    expect(commitInput?.runId).toEqual(expect.any(String));
    expect(commitInput?.operationLog).toEqual({
      requestId: "request-floor-commit",
      route: "POST /sessions/:id/respond",
    });
    const logs = new OperationLogService(database.db).list({
      accountId: ACCOUNT_ID,
      sessionId,
      targetType: "session_state_value",
      action: "stage_session_state_turn_write",
      sortOrder: "asc",
    }).rows;

    expect(logs).toHaveLength(2);
    expect(logs.map((log) => log.targetId)).toEqual([
      `${sessionId}:main:quest_flags:companion`,
      `${sessionId}:main:quest_flags:expired_hint`,
    ]);
    expect(logs[0]!.floorId).toBe(result.floorId);
    expect(logs[0]!.metadata).toEqual(expect.objectContaining({
      route: "POST /sessions/:id/respond",
      write_mode: "commit_bound",
      operation: "set",
      request_write_index: 1,
      request_write_count: 2,
    }));

    const mutationRef = logs[0]!.afterRef as { mutation?: { payload_value_summary?: { value_hash?: string } } };
    expect(mutationRef.mutation?.payload_value_summary?.value_hash).toEqual(expect.stringMatching(/^sha256:/));
    expect(JSON.stringify(logs)).not.toContain("SECRET_TURN_STATE_VALUE");
  });

  it("rejects built-in session_state_writes from client turn requests", async () => {
    const sessionId = nanoid();
    const now = 1_736_020_126_000;

    await seedSession(database, sessionId, now);

    await expect(chatService.respond(
      sessionId,
      {
        message: "Try to write scene.",
        sessionStateWrites: [
          {
            namespace: "game_state",
            slot: "scene",
            value: { revision: 1 },
          },
        ],
      },
      {},
      ACCOUNT_ID,
    )).rejects.toMatchObject({
      code: "session_state_public_write_forbidden",
    } satisfies Partial<ChatServiceError>);
  });

  it("rejects session_state_writes when session-state is unavailable", async () => {
    const sessionId = nanoid();
    const now = 1_736_020_127_000;

    await seedSession(database, sessionId, now);

    const chatServiceWithoutSessionState = new ChatService(
      database.db,
      orchestrator,
      new SimpleTokenCounter(),
      {
        resolveTurnModels: async () => ({ narrator: { source: "env", generationParams: { maxOutputTokens: 128 } } }),
        turnCommitService: {
          commit: turnCommitMock,
        } as never,
      },
    );

    await expect(chatServiceWithoutSessionState.respond(
      sessionId,
      {
        message: "Continue the quest.",
        sessionStateWrites: [
          {
            namespace: "quest_flags",
            slot: "companion",
            value: { mood: "ally" },
          },
        ],
      },
      {},
      ACCOUNT_ID,
    )).rejects.toMatchObject({
      code: "feature_unavailable",
    } satisfies Partial<ChatServiceError>);
  });

  it("discards staged custom session-state writes when commit fails", async () => {
    const sessionId = nanoid();
    const now = 1_736_020_128_000;

    await seedSession(database, sessionId, now);
    customNamespaceService.registerNamespace({
      accountId: ACCOUNT_ID,
      sessionId,
      namespace: "quest_flags",
      logicalOwnerType: "plugin",
      logicalOwnerId: "quest-plugin",
    });

    turnCommitMock.mockRejectedValueOnce(new Error("commit exploded"));

    await expect(chatService.respond(
      sessionId,
      {
        message: "Continue the quest.",
        sessionStateWrites: [
          {
            namespace: "quest_flags",
            slot: "companion",
            value: { mood: "ally" },
          },
        ],
      },
      {},
      ACCOUNT_ID,
    )).rejects.toMatchObject({
      code: "turn_commit_failed",
    } satisfies Partial<ChatServiceError>);

    const mutationRows = await database.db.select().from(sessionStateMutations);
    expect(mutationRows.some((row) => row.stateNamespace === "quest_flags" && row.status === "discarded")).toBe(true);

    const live = sessionStateService.resolveLiveValue({
      accountId: ACCOUNT_ID,
      sessionId,
      branchId: "main",
      namespace: "quest_flags",
      slot: "companion",
    });
    expect(live).toBeNull();
  });

  it("threads managed scene and world context into the shared prompt metadata carrier", () => {
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
        world: {
          namespace: "game_state",
          slot: "world",
          resolutionMode: "source_floor",
          source: "source_floor_snapshot",
          present: true,
          schemaVersion: 1,
          sessionId,
          branchId,
          floorId,
          sourceMutationIds: ["mutation-2"],
          updatedAt,
          world: buildWorldStateValue({
            sessionId,
            branchId,
            floorId,
            summaryLines: ["The room is quiet."],
            worldbookId: "worldbook-room",
            worldbookVersion: 2,
            activatedWorldbookEntryUids: [11, 12],
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
        world?: {
          source?: string;
          resolution_mode?: string;
          floor_id?: string | null;
          present?: boolean;
          schema_version?: number | null;
          source_mutation_ids?: string[];
          worldbook_id?: string | null;
          summary_line_count?: number;
          summaryLines?: string[];
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
    expect(metadata.first_party_state?.world).toMatchObject({
      source: "source_floor_snapshot",
      resolution_mode: "source_floor",
      floor_id: floorId,
      present: true,
      schema_version: 1,
      source_mutation_ids: ["mutation-2"],
      worldbook_id: "worldbook-room",
      summary_line_count: 1,
    });
    expect(metadata.first_party_state?.world?.summaryLines).toBeUndefined();
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
    await stageCommittedWorld({
      service: firstPartyGameStateService,
      sessionStateService,
      sessionId,
      branchId: "main",
      floorId: floor1,
      summaryLine: "The harbor ledger lists two active watch posts.",
      committedAt: now + 11,
      worldbookId: "worldbook-harbor",
      worldbookVersion: 4,
      activatedWorldbookEntryUids: [21, 22],
    });

    const buildSessionPromptInfoSpy = getBuildSessionPromptInfoSpy(chatService);

    const mainResult = await chatService.respond(sessionId, { message: "Continue the harbor scene." }, {}, ACCOUNT_ID);
    expect(mainResult.branchId).toBe("main");

    const mainContext = buildSessionPromptInfoSpy.mock.calls[0]?.[2] as { scene?: Record<string, unknown>; world?: Record<string, unknown> } | undefined;
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
    expect(mainContext?.world).toMatchObject({
      resolutionMode: "current_effective",
      source: "live_head",
      floorId: floor1,
      branchId: "main",
      sessionId,
      world: expect.objectContaining({
        summaryLines: ["The harbor ledger lists two active watch posts."],
      }),
    });

    const branchResult = await chatService.respond(
      sessionId,
      { message: "Branch away from the harbor scene.", branchId: "alt", sourceFloorId: floor1 },
      {},
      ACCOUNT_ID,
    );
    expect(branchResult.branchId).toBe("alt");

    const branchContext = buildSessionPromptInfoSpy.mock.calls[1]?.[2] as { scene?: Record<string, unknown>; world?: Record<string, unknown> } | undefined;
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
    expect(branchContext?.world).toMatchObject({
      resolutionMode: "source_floor",
      source: "source_floor_snapshot",
      floorId: floor1,
      branchId: "alt",
      sessionId,
      world: expect.objectContaining({
        summaryLines: ["The harbor ledger lists two active watch posts."],
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
    await stageCommittedWorld({
      service: firstPartyGameStateService,
      sessionStateService,
      sessionId,
      branchId: "main",
      floorId: floor1,
      summaryLine: "The camp inventory is still dry.",
      committedAt: now + 31,
      worldbookId: "worldbook-camp",
      worldbookVersion: 1,
      activatedWorldbookEntryUids: [31],
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
    await stageCommittedWorld({
      service: firstPartyGameStateService,
      sessionStateService,
      sessionId,
      branchId: "main",
      floorId: floor2,
      summaryLine: "The camp inventory now includes wet blankets.",
      committedAt: now + 41,
      worldbookId: "worldbook-camp",
      worldbookVersion: 2,
      activatedWorldbookEntryUids: [31, 32],
    });

    const buildSessionPromptInfoSpy = getBuildSessionPromptInfoSpy(chatService);
    const result = await chatService.regenerate(sessionId, {}, ACCOUNT_ID);

    expect(result.previousFloorId).toBe(floor2);
    const firstPartyContext = buildSessionPromptInfoSpy.mock.calls[0]?.[2] as { scene?: Record<string, unknown>; world?: Record<string, unknown> } | undefined;
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
    expect(firstPartyContext?.world).toMatchObject({
      resolutionMode: "source_floor",
      source: "source_floor_snapshot",
      floorId: floor1,
      branchId: "main",
      sessionId,
      world: expect.objectContaining({
        summaryLines: ["The camp inventory is still dry."],
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
    await stageCommittedWorld({
      service: firstPartyGameStateService,
      sessionStateService,
      sessionId,
      branchId: "main",
      floorId: floor1,
      summaryLine: "The ridge trail is still passable.",
      committedAt: now + 31,
      worldbookId: "worldbook-ridge",
      worldbookVersion: 5,
      activatedWorldbookEntryUids: [41],
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
    await stageCommittedWorld({
      service: firstPartyGameStateService,
      sessionStateService,
      sessionId,
      branchId: "main",
      floorId: floor2,
      summaryLine: "The ridge trail now floods at dusk.",
      committedAt: now + 41,
      worldbookId: "worldbook-ridge",
      worldbookVersion: 6,
      activatedWorldbookEntryUids: [41, 42],
    });

    const buildSessionPromptInfoSpy = getBuildSessionPromptInfoSpy(chatService);
    const result = await chatService.retryFloor(floor2, {}, ACCOUNT_ID);

    expect(result.floorId).toBe(floor2);
    const firstPartyContext = buildSessionPromptInfoSpy.mock.calls[0]?.[2] as { scene?: Record<string, unknown>; world?: Record<string, unknown> } | undefined;
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
    expect(firstPartyContext?.world).toMatchObject({
      resolutionMode: "source_floor",
      source: "source_floor_snapshot",
      floorId: floor1,
      branchId: "main",
      sessionId,
      world: expect.objectContaining({
        summaryLines: ["The ridge trail is still passable."],
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
    await stageCommittedWorld({
      service: firstPartyGameStateService,
      sessionStateService,
      sessionId,
      branchId: "main",
      floorId: floor1,
      summaryLine: "The archive index still points to the sealed shelf.",
      committedAt: now + 21,
      worldbookId: "worldbook-archive",
      worldbookVersion: 8,
      activatedWorldbookEntryUids: [51, 52],
    });

    const buildSessionPromptInfoSpy = getBuildSessionPromptInfoSpy(chatService);
    const result = await chatService.editAndRegenerate(
      userMessageId,
      { content: "Revise the archive scene." },
      ACCOUNT_ID,
    );

    expect(result.sourceFloorId).toBe(floor1);
    expect(result.sourceMessageId).toBe(userMessageId);
    const firstPartyContext = buildSessionPromptInfoSpy.mock.calls[0]?.[2] as { scene?: Record<string, unknown>; world?: Record<string, unknown> } | undefined;
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
    expect(firstPartyContext?.world).toMatchObject({
      resolutionMode: "source_floor",
      source: "source_floor_snapshot",
      floorId: floor1,
      branchId: result.branchId,
      sessionId,
      world: expect.objectContaining({
        summaryLines: ["The archive index still points to the sealed shelf."],
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
  new SessionBranchRegistryService(database.db).ensure({
    accountId: ACCOUNT_ID,
    sessionId,
    branchId: "main",
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

async function stageCommittedWorld(input: {
  service: FirstPartyGameStateService;
  sessionStateService: SessionStateService;
  sessionId: string;
  branchId: string;
  floorId: string;
  summaryLine: string;
  committedAt: number;
  worldbookId?: string | null;
  worldbookVersion?: number | null;
  activatedWorldbookEntryUids?: number[];
}): Promise<void> {
  input.service.stageWorldState({
    accountId: ACCOUNT_ID,
    sessionId: input.sessionId,
    branchId: input.branchId,
    floorId: input.floorId,
    runType: "respond",
    execution: createTurnExecution(input.floorId, input.summaryLine),
    promptSnapshot: {
      worldbookId: input.worldbookId ?? null,
      worldbookVersion: input.worldbookVersion ?? null,
      worldbookActivatedEntryUids: [...(input.activatedWorldbookEntryUids ?? [])],
    },
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

function buildWorldStateValue(input: {
  sessionId: string;
  branchId: string;
  floorId: string;
  summaryLines: string[];
  worldbookId: string | null;
  worldbookVersion: number | null;
  activatedWorldbookEntryUids: number[];
  updatedAt: number;
}) {
  return {
    kind: "first_party_world_state",
    schemaVersion: 1,
    sessionId: input.sessionId,
    branchId: input.branchId,
    floorId: input.floorId,
    runType: "respond",
    summaryLines: [...input.summaryLines],
    worldbookId: input.worldbookId,
    worldbookVersion: input.worldbookVersion,
    activatedWorldbookEntryUids: [...input.activatedWorldbookEntryUids],
    toolExecutionIds: [],
    updatedAt: input.updatedAt,
  };
}
