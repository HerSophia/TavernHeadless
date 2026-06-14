import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  SimpleTokenCounter,
  type TurnExecutionResult,
  type TurnInput,
  type TurnOrchestrator,
} from "@tavern/core";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../accounts/constants.js";
import {
  floorResultSnapshots,
  floorRunStates,
  floors,
  messagePages,
  messages,
  sessions,
  toolExecutionRecords,
} from "../../db/schema.js";
import { ChatService } from "../chat/chat-service.js";
import { GenerationCoordinatorCancelledError } from "../generation-guard-service.js";
import { FloorRunService } from "../floor-run-service.js";
import {
  buildConversationInputSnapshot,
  mergeFloorMetadataConversationInput,
} from "../chat/shared/metadata.js";

const promptAssemblerMocks = vi.hoisted(() => ({
  assemblePrompt: vi.fn(),
}));

vi.mock("../prompt-assembler.js", async () => {
  const actual = await vi.importActual<typeof import("../prompt-assembler.js")>("../prompt-assembler.js");
  return {
    ...actual,
    assemblePrompt: promptAssemblerMocks.assemblePrompt,
  };
});

describe("ChatService R2 failure boundaries", () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = createDatabase(":memory:");
    promptAssemblerMocks.assemblePrompt.mockReset();
    promptAssemblerMocks.assemblePrompt.mockImplementation(async (_db, _accountId, _sessionInfo, _history, userMessage) => (
      createAssembleResult(userMessage)
    ));
  });

  afterEach(() => {
    database.close();
  });

  it("does not commit cancelled respond attempts and marks the run as cancelled", async () => {
    const now = 1_736_700_000_000;
    const sessionId = nanoid();
    let startedFloorId: string | undefined;
    let toolExecutionRunId: string | undefined;

    await seedSession(database, sessionId, now);

    const orchestrator: TurnOrchestrator = {
      executeTurn: vi.fn(async (input: TurnInput) => {
        toolExecutionRunId = input.toolExecutionRunId;
        await insertPendingToolExecution(database, {
          floorId: input.floorId,
          runId: input.toolExecutionRunId!,
          now: now + 10,
        });
        await waitForAbort(input.abortSignal);
        return createTurnExecution(input.floorId, "should-not-commit");
      }),
    } as unknown as TurnOrchestrator;

    const floorRunService = new FloorRunService(database.db);
    const chatService = createChatService(database, orchestrator, { floorRunService });
    const abortController = new AbortController();

    await expect(chatService.respond(
      sessionId,
      { message: "Please stop." },
      {
        abortSignal: abortController.signal,
        onStart: (start) => {
          startedFloorId = start.floorId;
          abortController.abort();
        },
      },
      DEFAULT_ADMIN_ACCOUNT_ID,
    )).rejects.toMatchObject({ code: "generation_cancelled" });

    expect(startedFloorId).toBeTruthy();
    const [floorRow] = await database.db.select().from(floors).where(eq(floors.id, startedFloorId!));
    expect(floorRow?.state).toBe("failed");

    const [runRow] = await database.db.select().from(floorRunStates).where(eq(floorRunStates.floorId, startedFloorId!));
    expect(runRow?.status).toBe("cancelled");

    const resultSnapshots = await database.db.select().from(floorResultSnapshots).where(eq(floorResultSnapshots.floorId, startedFloorId!));
    expect(resultSnapshots).toEqual([]);

    const [toolRow] = await database.db
      .select()
      .from(toolExecutionRecords)
      .where(eq(toolExecutionRecords.runId, toolExecutionRunId!));
    expect(toolRow?.commitOutcome).toBe("discarded");
  });

  it("keeps the previous active output page when retryFloor is cancelled before execution starts", async () => {
    const now = 1_736_700_010_000;
    const seeded = await seedResponseOnlyConversation(database, now);

    const cancelledCoordinator = {
      execute: async <T>() => {
        throw new GenerationCoordinatorCancelledError(seeded.sessionId, "main");
      },
    } as NonNullable<ConstructorParameters<typeof ChatService>[3]>["generationCoordinator"];

    const chatService = createChatService(database, createMockTurnOrchestrator(), {
      generationCoordinator: cancelledCoordinator,
      floorRunService: new FloorRunService(database.db),
    });

    await expect(chatService.retryFloor(seeded.responseFloorId, {}, DEFAULT_ADMIN_ACCOUNT_ID)).rejects.toMatchObject({
      code: "generation_cancelled",
    });

    const [activeOutput] = await database.db.select().from(messagePages).where(eq(messagePages.id, seeded.responsePageId));
    expect(activeOutput?.isActive).toBe(true);
    expect(activeOutput?.version).toBe(1);

    const outputPages = await database.db.select().from(messagePages).where(eq(messagePages.floorId, seeded.responseFloorId));
    expect(outputPages.filter((row) => row.pageKind === "output")).toHaveLength(1);
  });

  it("rejects late retry commits from superseded attempts without touching the current run snapshot or active output", async () => {
    const now = 1_736_700_020_000;
    const seeded = await seedResponseOnlyConversation(database, now);
    const floorRunService = new FloorRunService(database.db);
    let toolExecutionRunId: string | undefined;

    const orchestrator: TurnOrchestrator = {
      executeTurn: vi.fn(async (input: TurnInput) => {
        toolExecutionRunId = input.toolExecutionRunId;
        await insertPendingToolExecution(database, {
          floorId: input.floorId,
          runId: input.toolExecutionRunId!,
          now: now + 20,
        });
        await floorRunService.startAttempt(seeded.responseFloorId, {
          attemptNo: 2,
          updatedAt: now + 30,
        });
        return createTurnExecution(input.floorId, input.messages[input.messages.length - 1]?.content ?? "retry");
      }),
    } as unknown as TurnOrchestrator;

    const chatService = createChatService(database, orchestrator, { floorRunService });

    await expect(chatService.retryFloor(seeded.responseFloorId, {}, DEFAULT_ADMIN_ACCOUNT_ID)).rejects.toMatchObject({
      code: "turn_attempt_stale",
      details: { reason: "attempt_not_current" },
    });

    const [runRow] = await database.db.select().from(floorRunStates).where(eq(floorRunStates.floorId, seeded.responseFloorId));
    expect(runRow).toMatchObject({
      status: "completed",
      attemptNo: 2,
    });

    const [activeOutput] = await database.db.select().from(messagePages).where(eq(messagePages.id, seeded.responsePageId));
    expect(activeOutput?.isActive).toBe(true);
    expect(activeOutput?.version).toBe(1);

    const outputPages = await database.db.select().from(messagePages).where(eq(messagePages.floorId, seeded.responseFloorId));
    expect(outputPages.filter((row) => row.pageKind === "output")).toHaveLength(1);

    const [toolRow] = await database.db
      .select()
      .from(toolExecutionRecords)
      .where(eq(toolExecutionRecords.runId, toolExecutionRunId!));
    expect(toolRow?.commitOutcome).toBe("discarded");
  });
});

function createChatService(
  database: DatabaseConnection,
  orchestrator: TurnOrchestrator,
  overrides: Partial<NonNullable<ConstructorParameters<typeof ChatService>[3]>> = {},
): ChatService {
  return new ChatService(
    database.db,
    orchestrator,
    new SimpleTokenCounter(),
    {
      resolveTurnModels: async () => ({ narrator: { source: "env", generationParams: { maxOutputTokens: 128 } } }),
      ...overrides,
    },
  );
}

function createMockTurnOrchestrator(): TurnOrchestrator {
  return {
    executeTurn: vi.fn(async (input: TurnInput) => createTurnExecution(input.floorId, input.messages[input.messages.length - 1]?.content ?? "")),
  } as unknown as TurnOrchestrator;
}

function createTurnExecution(floorId: string, userMessage: string): TurnExecutionResult {
  return {
    floorId,
    finalState: "generating",
    generatedText: `reply:${userMessage}`,
    rawText: `reply:${userMessage}`,
    summaries: [],
    totalUsage: {
      promptTokens: 12,
      completionTokens: 8,
      totalTokens: 20,
    },
  };
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
      createdAt: 1_736_200_000_000,
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

async function seedSession(database: DatabaseConnection, sessionId: string, now: number): Promise<void> {
  await database.db.insert(sessions).values({
    id: sessionId,
    title: "R2 Failure Boundary Session",
    accountId: DEFAULT_ADMIN_ACCOUNT_ID,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
}

async function seedResponseOnlyConversation(
  database: DatabaseConnection,
  now: number,
): Promise<{ sessionId: string; userFloorId: string; responseFloorId: string; responsePageId: string }> {
  const sessionId = nanoid();
  const userFloorId = nanoid();
  const userPageId = nanoid();
  const userMessageId = nanoid();
  const responseFloorId = nanoid();
  const responsePageId = nanoid();
  const responseMessageId = nanoid();
  const conversationInputSnapshot = buildConversationInputSnapshot({
    effectiveText: "first ask",
    sourceTurn: {
      sourceFloorIds: [userFloorId],
      sourcePageIds: [userPageId],
      sourceMessageIds: [userMessageId],
      floorRange: { start: 1, end: 1 },
      includesCurrentInput: false,
      entryCount: 1,
    },
  });

  await seedSession(database, sessionId, now);
  await database.db.insert(floors).values({
    id: userFloorId,
    sessionId,
    floorNo: 1,
    branchId: "main",
    parentFloorId: null,
    state: "committed",
    tokenIn: 0,
    tokenOut: 0,
    createdAt: now,
    updatedAt: now,
  });
  await database.db.insert(messagePages).values({
    id: userPageId,
    floorId: userFloorId,
    pageNo: 0,
    pageKind: "input",
    isActive: true,
    version: 1,
    checksum: null,
    createdAt: now,
    updatedAt: now,
  });
  await database.db.insert(messages).values({
    id: userMessageId,
    pageId: userPageId,
    seq: 0,
    role: "user",
    content: "first ask",
    contentFormat: "text",
    tokenCount: 0,
    isHidden: false,
    source: "api",
    createdAt: now,
  });
  await database.db.insert(floors).values({
    id: responseFloorId,
    sessionId,
    floorNo: 2,
    branchId: "main",
    parentFloorId: userFloorId,
    state: "committed",
    metadataJson: mergeFloorMetadataConversationInput(null, conversationInputSnapshot),
    tokenIn: 0,
    tokenOut: 0,
    createdAt: now + 1,
    updatedAt: now + 1,
  });
  await database.db.insert(messagePages).values({
    id: responsePageId,
    floorId: responseFloorId,
    pageNo: 1,
    pageKind: "output",
    isActive: true,
    version: 1,
    checksum: null,
    createdAt: now + 1,
    updatedAt: now + 1,
  });
  await database.db.insert(messages).values({
    id: responseMessageId,
    pageId: responsePageId,
    seq: 0,
    role: "assistant",
    content: "assistant reply",
    contentFormat: "text",
    tokenCount: 0,
    isHidden: false,
    source: "narrator",
    createdAt: now + 1,
  });

  return { sessionId, userFloorId, responseFloorId, responsePageId };
}

async function insertPendingToolExecution(database: DatabaseConnection, input: {
  floorId: string;
  runId: string;
  now: number;
}): Promise<void> {
  await database.db.insert(toolExecutionRecords).values({
    id: nanoid(),
    runId: input.runId,
    floorId: input.floorId,
    pageId: null,
    callerSlot: "narrator",
    providerId: "builtin",
    providerType: "builtin",
    toolName: "lookup_fact",
    argsJson: "{}",
    resultJson: "{}",
    status: "running",
    lifecycleState: "opened",
    commitOutcome: "pending",
    deliveryMode: "inline",
    runtimeJobId: null,
    sideEffectLevel: null,
    errorMessage: null,
    durationMs: 0,
    startedAt: input.now,
    finishedAt: null,
    attemptNo: 1,
    replayParentExecutionId: null,
    createdAt: input.now,
  });
}

async function waitForAbort(signal: AbortSignal | undefined): Promise<never> {
  if (!signal) {
    throw new Error("Abort signal is required for cancellation tests");
  }

  if (signal.aborted) {
    throw new Error("operation aborted");
  }

  await new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
  throw new Error("operation aborted");
}
