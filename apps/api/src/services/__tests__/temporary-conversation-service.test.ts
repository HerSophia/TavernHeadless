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
import { floors, presets, regexProfiles, sessionBranches, sessions, worldbooks } from "../../db/schema.js";
import { ChatService } from "../chat/chat-service.js";
import { FloorRunService } from "../floor-run-service.js";
import { TemporaryConversationService } from "../temporary-conversation-service.js";
import { SessionBranchRegistryService } from "../variables/host/session-branch-registry-service.js";

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

describe("TemporaryConversationService", () => {
  let database: DatabaseConnection;
  let chatService: ChatService;
  let temporaryConversationService: TemporaryConversationService;

  beforeEach(() => {
    database = createDatabase(":memory:");
    promptAssemblerMocks.assemblePrompt.mockReset();
    promptAssemblerMocks.assemblePrompt.mockImplementation(async (_db, _accountId, _sessionInfo, history, userMessage) => ({
      messages: [
        ...history,
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
        promptMode: "native" as const,
        promptDigest: "temporary-conversation-test",
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
    }));

    chatService = new ChatService(
      database.db,
      createMockTurnOrchestrator(),
      new SimpleTokenCounter(),
      {
        resolveTurnModels: async () => ({
          narrator: {
            source: "env",
            generationParams: { maxOutputTokens: 128 },
          },
        }),
        floorRunService: new FloorRunService(database.db),
      },
    );

    temporaryConversationService = new TemporaryConversationService(database.db, chatService, {
      tokenCounter: new SimpleTokenCounter(),
    });
  });

  afterEach(() => {
    database.close();
  });

  it("creates a temporary session snapshot, appends staged messages, responds, and reads transcript", async () => {
    const source = await seedSourceSession(database, Date.now());

    const handle = await temporaryConversationService.create({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      sourceSessionId: source.sessionId,
      purpose: "utility",
    });

    expect(handle.kind).toBe("temporary");
    expect(handle.status).toBe("active");
    expect(handle.sourceSessionId).toBe(source.sessionId);

    const [temporarySession] = await database.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, handle.conversationId));

    expect(temporarySession).toMatchObject({
      id: handle.conversationId,
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      kind: "temporary",
      purpose: "utility",
      temporarySourceSessionId: source.sessionId,
      retentionPolicy: "delete_on_finalize",
      visibility: "internal",
      presetId: source.presetId,
      regexProfileId: source.regexProfileId,
      worldbookProfileId: source.worldbookProfileId,
      promptMode: "native",
    });
    expect(temporarySession?.temporarySnapshotDigest).toMatch(/^sha256:/);
    expect(JSON.parse(temporarySession!.metadataJson ?? "{}")).toMatchObject({
      tool_permissions: {
        allow_irreversible: false,
      },
      prompt_runtime_policy: {
        sourceSelection: {
          history: {
            maxMessages: 12,
          },
        },
      },
    });

    const [temporaryBranch] = await database.db
      .select()
      .from(sessionBranches)
      .where(eq(sessionBranches.sessionId, handle.conversationId));
    expect(temporaryBranch).toMatchObject({
      branchId: "main",
      sourceBranchId: "main",
      assetBindingPresetId: source.branchBinding.presetId,
      assetBindingWorldbookProfileId: source.branchBinding.worldbookProfileId,
      assetBindingRegexProfileId: source.branchBinding.regexProfileId,
      assetBindingDeepBinding: true,
    });

    const firstMessage = await temporaryConversationService.appendMessage({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      conversationId: handle.conversationId,
      role: "system",
      content: "Keep answers short.",
    });
    await temporaryConversationService.appendMessage({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      conversationId: handle.conversationId,
      role: "user",
      content: "What is the next step?",
    });

    const result = await temporaryConversationService.respond({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      conversationId: handle.conversationId,
    });

    expect(result.conversationId).toBe(handle.conversationId);
    expect(result.floorId).toBe(firstMessage.floorId);
    expect(result.pageId).toBeTruthy();
    expect(result.text).toContain("reply:What is the next step?");
    expect(result.usage).toEqual({
      promptTokens: 12,
      completionTokens: 8,
      totalTokens: 20,
    });
    expect(result.finishReason).toBe("assistant_message_committed");
    expect(result.warnings).toEqual([]);

    const transcript = await temporaryConversationService.readTranscript({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      conversationId: handle.conversationId,
    });

    expect(transcript.floors).toHaveLength(1);
    expect(transcript.floors[0]).toMatchObject({
      id: firstMessage.floorId,
      state: "committed",
    });
    expect(transcript.floors[0]?.pages[0]?.pageKind).toBe("mixed");
    expect(transcript.floors[0]?.pages[0]?.messages.map((message) => ({ role: message.role, content: message.content }))).toEqual([
      { role: "system", content: "Keep answers short." },
      { role: "user", content: "What is the next step?" },
    ]);
    expect(transcript.floors[0]?.pages[1]?.messages[0]?.content).toContain("reply:What is the next step?");

    const [committedFloor] = await database.db
      .select()
      .from(floors)
      .where(eq(floors.id, firstMessage.floorId));
    expect(committedFloor?.state).toBe("committed");
  });

  it("keeps the temporary snapshot stable after the source session changes", async () => {
    const now = Date.now();
    const source = await seedSourceSession(database, now);
    const handle = await temporaryConversationService.create({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      sourceSessionId: source.sessionId,
      purpose: "snapshot",
    });

    await database.db.update(sessions).set({
      metadataJson: JSON.stringify({ tool_permissions: { allow_irreversible: true }, changed: true }),
      presetId: "preset-changed",
      updatedAt: now + 5_000,
    }).where(eq(sessions.id, source.sessionId));

    const [temporarySession] = await database.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, handle.conversationId));

    expect(temporarySession?.presetId).toBe(source.presetId);
    expect(JSON.parse(temporarySession?.metadataJson ?? "{}")).not.toMatchObject({ changed: true });
    expect(JSON.parse(temporarySession?.metadataJson ?? "{}")).toMatchObject({
      tool_permissions: {
        allow_irreversible: false,
      },
    });
  });

  it("derives warnings and finishReason from runtime trace semantics", async () => {
    const source = await seedSourceSession(database, Date.now());
    const stubChatService = {
      respondFromPreparedDraftFloor: vi.fn(async () => ({
        floorId: "floor_stub_1",
        floorNo: 1,
        generatedText: "stub reply",
        summaries: [],
        totalUsage: {
          promptTokens: 3,
          completionTokens: 4,
          totalTokens: 7,
        },
        finalState: "committed" as const,
        branchId: "main",
        outputPageId: "page_stub_output_1",
        assistantMessageId: "msg_stub_output_1",
        runtimeTrace: {
          preset: {
            selectedPromptOrderCharacterId: null,
            ignoredPromptOrderCharacterIds: [],
            unsupportedFields: [],
            ignoredFields: [],
            unresolvedMarkers: [],
            warnings: ["trace-warning"],
            triggerFilteredEntryIds: [],
            inChatInsertedEntryIds: [],
            continueNudgeApplied: false,
          },
          macro: {
            warnings: [{ code: "macro_warning", message: "macro warning" }],
            usedNames: [],
            mutationPreview: [],
            stagedMutations: [],
            traces: [],
          },
          delivery: {
            assistantPrefillRequested: false,
            assistantPrefillApplied: false,
            assistantPrefillStrategy: "none",
            allowAssistantPrefill: true,
            requireLastUser: false,
            noAssistant: true,
            lastMessageRole: "user",
            endsWithUser: true,
            degraded: true,
            degradeReasons: ["no_assistant_override"],
          },
        },
      })),
    } as unknown as ChatService;
    const semanticService = new TemporaryConversationService(database.db, stubChatService, {
      tokenCounter: new SimpleTokenCounter(),
    });

    const handle = await semanticService.create({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      sourceSessionId: source.sessionId,
      purpose: "warning-check",
    });

    await semanticService.appendMessage({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      conversationId: handle.conversationId,
      role: "user",
      content: "Explain the next step.",
    });

    const result = await semanticService.respond({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      conversationId: handle.conversationId,
      delivery: {
        noAssistant: true,
      },
    });

    expect(result.finishReason).toBe("delivery_degraded");
    expect(result.finishReason).not.toBe(result.finalState);
    expect(result.warnings).toEqual(expect.arrayContaining([
      "preset:trace-warning",
      "macro:macro_warning",
      "delivery:no_assistant_override",
    ]));
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

async function seedSourceSession(
  database: DatabaseConnection,
  now: number,
): Promise<{
  sessionId: string;
  presetId: string;
  regexProfileId: string;
  worldbookProfileId: string;
  branchBinding: {
    presetId: string;
    worldbookProfileId: string;
    regexProfileId: string;
  };
}> {
  const sessionId = nanoid();
  const presetId = `preset-${sessionId}`;
  const regexProfileId = `regex-${sessionId}`;
  const worldbookProfileId = `world-${sessionId}`;
  const branchBinding = {
    presetId: `branch-preset-${sessionId}`,
    worldbookProfileId: `branch-world-${sessionId}`,
    regexProfileId: `branch-regex-${sessionId}`,
  };

  await database.db.insert(presets).values([
    {
      id: presetId,
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      name: `preset ${sessionId}`,
      source: "test",
      dataJson: "{}",
      version: 1,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: branchBinding.presetId,
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      name: `branch preset ${sessionId}`,
      source: "test",
      dataJson: "{}",
      version: 1,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await database.db.insert(regexProfiles).values([
    {
      id: regexProfileId,
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      name: `regex ${sessionId}`,
      source: "test",
      dataJson: "[]",
      version: 1,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: branchBinding.regexProfileId,
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      name: `branch regex ${sessionId}`,
      source: "test",
      dataJson: "[]",
      version: 1,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await database.db.insert(worldbooks).values([
    {
      id: worldbookProfileId,
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      name: `world ${sessionId}`,
      source: "test",
      dataJson: "{}",
      version: 1,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: branchBinding.worldbookProfileId,
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      name: `branch world ${sessionId}`,
      source: "test",
      dataJson: "{}",
      version: 1,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  await database.db.insert(sessions).values({
    id: sessionId,
    title: "Narrative Session",
    accountId: DEFAULT_ADMIN_ACCOUNT_ID,
    status: "active",
    presetId,
    regexProfileId,
    worldbookProfileId,
    deepBinding: false,
    promptMode: "native",
    metadataJson: JSON.stringify({
      tool_permissions: {
        allow_irreversible: true,
      },
      prompt_runtime_policy: {
        sourceSelection: {
          history: {
            maxMessages: 12,
          },
        },
      },
    }),
    createdAt: now,
    updatedAt: now,
  });

  new SessionBranchRegistryService(database.db).ensure({
    accountId: DEFAULT_ADMIN_ACCOUNT_ID,
    sessionId,
    branchId: "main",
    assetBinding: {
      presetId: branchBinding.presetId,
      presetVersionId: null,
      worldbookProfileId: branchBinding.worldbookProfileId,
      worldbookVersionId: null,
      regexProfileId: branchBinding.regexProfileId,
      regexProfileVersionId: null,
      deepBinding: true,
    },
    createdAt: now,
    updatedAt: now,
  });

  return {
    sessionId,
    presetId,
    regexProfileId,
    worldbookProfileId,
    branchBinding,
  };
}
