import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { SimpleTokenCounter, type TurnExecutionResult, type TurnInput, type TurnOrchestrator } from "@tavern/core";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../accounts/constants.js";
import { floors, messagePages, messages, sessions } from "../../db/schema.js";
import { ChatService } from "../chat/chat-service.js";
import {
  buildConversationInputSnapshot,
  mergeFloorMetadataConversationInput,
} from "../chat/shared/metadata.js";

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

describe("ChatService conversation runtime replay", () => {
  let database: DatabaseConnection;
  let orchestrator: TurnOrchestrator;
  let turnCommitMock: ReturnType<typeof vi.fn>;
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
    orchestrator = createMockTurnOrchestrator();
    turnCommitMock = vi.fn(async () => ({
      usage: { promptTokens: 12, completionTokens: 8, totalTokens: 20 },
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
      },
    );
  });

  afterEach(() => {
    database.close();
  });

  it("regenerate replays response-only floors without requiring an input page", async () => {
    const seeded = await seedResponseOnlyConversation(database, Date.now());

    const result = await chatService.regenerate(seeded.sessionId, {}, DEFAULT_ADMIN_ACCOUNT_ID);

    const executeInput = (orchestrator.executeTurn as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as TurnInput;
    expect(executeInput.pageId).toBeUndefined();

    const commitInput = turnCommitMock.mock.calls[0]?.[0];
    expect(commitInput.variableCommit?.pageId).toBeUndefined();
    expect(commitInput.conversationInputSnapshot).toMatchObject({
      mode: "merged_user_tail",
      effectiveText: "first ask",
      sourceFloorIds: [seeded.userFloorId],
      currentInputPageId: null,
      currentInputMessageId: null,
    });
    expect(result.previousFloorId).toBe(seeded.responseFloorId);
  });

  it("retryFloor replays response-only floors in place without a pageId", async () => {
    const seeded = await seedResponseOnlyConversation(database, Date.now());

    const result = await chatService.retryFloor(seeded.responseFloorId, {}, DEFAULT_ADMIN_ACCOUNT_ID);

    const executeInput = (orchestrator.executeTurn as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as TurnInput;
    expect(executeInput.pageId).toBeUndefined();

    const commitInput = turnCommitMock.mock.calls[0]?.[0];
    expect(commitInput.floorId).toBe(seeded.responseFloorId);
    expect(commitInput.variableCommit?.pageId).toBeUndefined();
    expect(commitInput.conversationInputSnapshot).toMatchObject({
      mode: "merged_user_tail",
      effectiveText: "first ask",
      sourceFloorIds: [seeded.userFloorId],
      currentInputPageId: null,
      currentInputMessageId: null,
    });
    expect(result.floorId).toBe(seeded.responseFloorId);

    const [retriedFloor] = await database.db.select().from(floors).where(eq(floors.id, seeded.responseFloorId));
    expect(retriedFloor?.state).toBe("draft");
  });
});

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

async function seedResponseOnlyConversation(
  database: DatabaseConnection,
  now: number,
): Promise<{ sessionId: string; userFloorId: string; responseFloorId: string }> {
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

  await database.db.insert(sessions).values({
    id: sessionId,
    title: "Response-only replay session",
    accountId: DEFAULT_ADMIN_ACCOUNT_ID,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
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

  return { sessionId, userFloorId, responseFloorId };
}
