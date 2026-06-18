import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";
import { and, eq } from "drizzle-orm";
import {
  SimpleTokenCounter,
  createEventBus,
  FloorStateConflictError,
  type ExecutedToolCallRecord,
  type PromptSnapshotRecord,
  type ToolCallRecord,
  type TurnExecutionResult,
} from "@tavern/core";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import {
  accounts,
  branchLocalVariableSnapshots,
  floorResultSnapshots,
  floorRunStates,
  floors,
  memoryEdges,
  memoryItems,
  runtimeJobs,
  messagePages,
  messages,
  pageStagedMemoryProposalBatches,
  pageStagedMemoryProposalItems,
  pageStagedWrites,
  projectEvents,
  operationLogs,
  promptRuntimeExplainSnapshots,
  promptSnapshots,
  sessions,
  toolCallRecords,
  toolExecutionRecords,
  variables,
} from "../../db/schema.js";
import { ChatMessagePersistence } from "../chat-message-persistence.js";
import {
  buildPromptRuntimeCommittedExplainSnapshot,
  DEFAULT_RESOLVED_PROMPT_RUNTIME_DEBUG_POLICY,
  DEFAULT_RESOLVED_PROMPT_RUNTIME_DELIVERY_POLICY,
  DEFAULT_RESOLVED_PROMPT_RUNTIME_SOURCE_SELECTION_POLICY,
  DEFAULT_RESOLVED_PROMPT_RUNTIME_STRUCTURE_POLICY,
  type PromptRuntimeInspectionResult,
} from "../prompt-runtime-control-service.js";
import { parsePromptRuntimeExplainSourceMapEnvelope } from "../prompt-runtime/explain-snapshot.js";
import { TurnCommitService } from "../turn-commit-service.js";
import { ProjectEventLiveHub } from "../project-event-live-hub.js";
import type { ProjectEventRecord } from "../project-event-service.js";
import { createTestSessionWithScope } from "../../__tests__/helpers/workspace-project.js";

import { OperationLogService } from "../operation-log-service.js";
import { buildBranchVariableScopeId, type VariableScope } from "@tavern/shared";
import {
  MEMORY_RUNTIME_SCOPE_TYPE,
  buildMemoryRuntimeScopeKey,
  toMemoryRuntimeJobType,
} from "../memory-runtime-job-definitions.js";
import { createToolRuntimeJobBridge } from "../tool-runtime-job-bridge.js";
import { buildConversationInputSnapshot, readFloorConversationInputSnapshot } from "../chat/shared/metadata.js";

const DEFAULT_ACCOUNT_ID = "default-admin";

async function seedAccount(
  database: DatabaseConnection,
  accountId: string,
  now: number,
): Promise<void> {
  await database.db.insert(accounts).values({
    id: accountId,
    name: accountId,
    createdAt: now,
    updatedAt: now,
  });
}

async function seedSession(
  database: DatabaseConnection,
  sessionId: string,
  now: number,
  accountId: string = DEFAULT_ACCOUNT_ID,
): Promise<void> {
  await database.db.insert(sessions).values({
    id: sessionId,
    title: "Turn Commit Test",
    accountId,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
}

async function seedFloor(args: {
  database: DatabaseConnection;
  sessionId: string;
  floorId: string;
  state: "draft" | "generating" | "committed" | "failed";
  now: number;
}): Promise<void> {
  await args.database.db.insert(floors).values({
    id: args.floorId,
    sessionId: args.sessionId,
    floorNo: 0,
    branchId: "main",
    parentFloorId: null,
    state: args.state,
    tokenIn: 0,
    tokenOut: 0,
    createdAt: args.now,
    updatedAt: args.now,
  });
}

async function seedInputPage(args: {
  database: DatabaseConnection;
  floorId: string;
  pageId: string;
  now: number;
}): Promise<void> {
  await args.database.db.insert(messagePages).values({
    id: args.pageId,
    floorId: args.floorId,
    pageNo: 0,
    pageKind: "input",
    isActive: true,
    version: 1,
    checksum: null,
    createdAt: args.now,
    updatedAt: args.now,
  });
}

async function seedVariable(args: {
  database: DatabaseConnection;
  scope: VariableScope;
  scopeId: string;
  key: string;
  value: unknown;
  now: number;
}): Promise<void> {
  await args.database.db.insert(variables).values({
    id: nanoid(),
    accountId: DEFAULT_ACCOUNT_ID,
    scope: args.scope,
    scopeId: args.scopeId,
    key: args.key,
    valueJson: JSON.stringify(args.value),
    updatedAt: args.now,
  });
}

async function seedUserMessage(args: {
  database: DatabaseConnection;
  pageId: string;
  messageId: string;
  content: string;
  now: number;
}): Promise<void> {
  await args.database.db.insert(messages).values({
    id: args.messageId,
    pageId: args.pageId,
    seq: 0,
    role: "user",
    content: args.content,
    contentFormat: "text",
    tokenCount: args.content.length,
    isHidden: false,
    source: "api",
    createdAt: args.now,
  });
}

describe("TurnCommitService", () => {
  let database: DatabaseConnection;
  let service: TurnCommitService;
  let eventBus: ReturnType<typeof createEventBus>;

  beforeEach(() => {
    database = createDatabase(":memory:");
    eventBus = createEventBus();
    service = new TurnCommitService(
      database.db,
      new ChatMessagePersistence(database.db, new SimpleTokenCounter()),
      eventBus
    );
  });

  afterEach(() => {
    database.close();
  });

  it("commits assistant output, usage, records, and events in one transaction", async () => {
    const sessionId = nanoid();
    const floorId = nanoid();
    const now = 1_735_689_720_000;
    const committedAt = now + 1_000;

    await seedSession(database, sessionId, now);
    await seedFloor({ database, sessionId, floorId, state: "generating", now });

    const execution: TurnExecutionResult = {
      floorId,
      finalState: "generating",
      generatedText: "Assistant reply after persistence.",
      rawText: "Assistant reply after persistence.",
      summaries: ["assistant summary"],
      totalUsage: {
        promptTokens: 12,
        completionTokens: 34,
        totalTokens: 46,
      },
    };

    const promptSnapshot: PromptSnapshotRecord = {
      floorId,
      sessionId,
      presetId: null,
      presetUpdatedAt: null,
      presetVersion: null,
      worldbookId: null,
      worldbookUpdatedAt: null,
      worldbookVersion: null,
      regexProfileId: null,
      regexProfileUpdatedAt: null,
      regexProfileVersion: null,
      characterId: null,
      characterVersionId: null,
      characterImportedFormat: null,
      characterContentHash: null,
      worldbookActivatedEntryUids: [101, 202],
      worldbookActivatedEntries: [],
      regexPreRuleNames: ["trim-input"],
      regexPostRuleNames: ["strip-ooc"],
      promptMode: "native",
      assetManifestDigest: null,
      promptDigest: "digest-123",
      tokenEstimate: 88,
      createdAt: committedAt,
    };

    const legacyToolCalls: ToolCallRecord[] = [
      {
        id: nanoid(),
        pageId: "placeholder-page",
        seq: 0,
        callerSlot: "narrator",
        toolName: "lookup_fact",
        argsJson: JSON.stringify({ key: "town.name" }),
        resultJson: JSON.stringify({ value: "Riverside" }),
        status: "success",
        durationMs: 17,
        createdAt: committedAt,
      },
    ];

    const executedToolCalls: ExecutedToolCallRecord[] = [
      {
        id: nanoid(),
        runId: nanoid(),
        floorId,
        callerSlot: "narrator",
        providerId: "builtin",
        toolName: "lookup_fact",
        argsJson: JSON.stringify({ key: "town.name" }),
        resultJson: JSON.stringify({ value: "Riverside" }),
        status: "success",
        durationMs: 17,
        createdAt: committedAt,
      },
    ];

    const updatedFactId = nanoid();
    const deprecatedFactId = nanoid();
    const duplicateMoodFactId = nanoid();

    await database.db.insert(memoryItems).values([
      {
        id: updatedFactId,
        accountId: DEFAULT_ACCOUNT_ID,
        scope: "chat",
        scopeId: sessionId,
        type: "fact",
        contentJson: JSON.stringify("relationship: strangers"),
        factKey: "relationship",
        importance: 0.2,
        confidence: 1,
        sourceFloorId: "seed-floor",
        sourceMessageId: null,
        status: "active",
        createdAt: now - 5_000,
        updatedAt: now - 5_000,
      },
      {
        id: deprecatedFactId,
        accountId: DEFAULT_ACCOUNT_ID,
        scope: "chat",
        scopeId: sessionId,
        type: "fact",
        contentJson: JSON.stringify("location: old square"),
        factKey: "location",
        importance: 0.3,
        confidence: 1,
        sourceFloorId: "seed-floor",
        sourceMessageId: null,
        status: "active",
        createdAt: now - 4_000,
        updatedAt: now - 4_000,
      },
      {
        id: duplicateMoodFactId,
        accountId: DEFAULT_ACCOUNT_ID,
        scope: "chat",
        scopeId: sessionId,
        type: "fact",
        contentJson: JSON.stringify("mood: anxious"),
        factKey: "mood",
        importance: 0.3,
        confidence: 1,
        sourceFloorId: "seed-floor",
        sourceMessageId: null,
        status: "active",
        createdAt: now - 4_000,
        updatedAt: now - 4_000,
      },
    ]);

    const stateChangedHandler = vi.fn();
    const committedHandler = vi.fn();
    const memoryCreatedHandler = vi.fn();
    const memoryUpdatedHandler = vi.fn();
    const memoryDeprecatedHandler = vi.fn();
    const memoryConsolidatedHandler = vi.fn();
    eventBus.on("floor.stateChanged", stateChangedHandler);
    eventBus.on("floor.committed", committedHandler);
    eventBus.on("memory.created", memoryCreatedHandler);
    eventBus.on("memory.updated", memoryUpdatedHandler);
    eventBus.on("memory.deprecated", memoryDeprecatedHandler);
    eventBus.on("memory.consolidated", memoryConsolidatedHandler);

    const result = await service.commit({
      accountId: DEFAULT_ACCOUNT_ID,
      floorId,
      sessionId,
      execution,
      committedAt,
      promptSnapshot,
      toolCalls: legacyToolCalls,
      toolExecutionRecords: executedToolCalls,
      memoryCommit: {
        summaries: execution.summaries,
        consolidationOutput: {
          turnSummary: "Alice and Bob became allies.",
          factsAdd: [{ key: "mood", value: "hopeful", scope: "chat", importance: 0.8 }],
          factsUpdate: [{ id: updatedFactId, value: "relationship: allies", importance: 0.9 }],
          factsDeprecate: [{ id: deprecatedFactId, reason: "stale" }],
        },
      },
    });

    expect(result).toEqual({
      floorId,
      outputPageId: expect.any(String),
      assistantMessageId: expect.any(String),
      finalState: "committed",
      memory: {
        mode: "sync",
        status: "applied",
      },
      usage: {
        promptTokens: 12,
        completionTokens: 34,
        totalTokens: 46,
      },
    });

    const [floor] = await database.db.select().from(floors).where(eq(floors.id, floorId));
    expect(floor).toMatchObject({
      id: floorId,
      state: "committed",
      tokenIn: 12,
      tokenOut: 34,
      updatedAt: committedAt,
    });

    const [outputPage] = await database.db.select().from(messagePages).where(eq(messagePages.id, result.outputPageId));
    expect(outputPage).toMatchObject({
      id: result.outputPageId,
      floorId,
      pageKind: "output",
      pageNo: 1,
      isActive: true,
      createdAt: committedAt,
      updatedAt: committedAt,
    });

    const [assistantMessage] = await database.db
      .select()
      .from(messages)
      .where(eq(messages.id, result.assistantMessageId));
    expect(assistantMessage).toMatchObject({
      id: result.assistantMessageId,
      pageId: result.outputPageId,
      role: "assistant",
      content: execution.generatedText,
      source: "narrator",
      createdAt: committedAt,
    });

    const [legacyToolCall] = await database.db
      .select()
      .from(toolCallRecords)
      .where(eq(toolCallRecords.id, executedToolCalls[0]!.id));
    expect(legacyToolCall).toMatchObject({
      id: executedToolCalls[0]!.id,
      pageId: result.outputPageId,
      seq: 1,
      callerSlot: "narrator",
      toolName: "lookup_fact",
      status: "success",
      durationMs: 17,
      createdAt: committedAt,
    });

    const staleLegacyRows = await database.db
      .select()
      .from(toolCallRecords)
      .where(eq(toolCallRecords.id, legacyToolCalls[0]!.id));
    expect(staleLegacyRows).toEqual([]);

    const [snapshotRow] = await database.db
      .select()
      .from(promptSnapshots)
      .where(eq(promptSnapshots.floorId, floorId));
    expect(snapshotRow).toMatchObject({
      floorId,
      sessionId,
      promptMode: "native",
      promptDigest: "digest-123",
      presetVersion: null,
      worldbookVersion: null,
      regexProfileVersion: null,
      tokenEstimate: 88,
      createdAt: committedAt,
    });
    expect(snapshotRow?.worldbookActivatedEntryUidsJson).toBe(JSON.stringify([101, 202]));
    expect(snapshotRow?.regexPreRuleNamesJson).toBe(JSON.stringify(["trim-input"]));
    expect(snapshotRow?.regexPostRuleNamesJson).toBe(JSON.stringify(["strip-ooc"]));

    const [resultSnapshotRow] = await database.db
      .select()
      .from(floorResultSnapshots)
      .where(eq(floorResultSnapshots.floorId, floorId));
    expect(resultSnapshotRow).toMatchObject({
      floorId,
      outputPageId: result.outputPageId,
      assistantMessageId: result.assistantMessageId,
      generatedText: execution.generatedText,
      committedAt,
      updatedAt: committedAt,
    });
    expect(resultSnapshotRow?.summariesJson).toBe(JSON.stringify(execution.summaries));
    expect(resultSnapshotRow?.usageJson).toBe(JSON.stringify(execution.totalUsage));
    expect(resultSnapshotRow?.verifierJson).toBeNull();

    const [executedToolCall] = await database.db
      .select()
      .from(toolExecutionRecords)
      .where(eq(toolExecutionRecords.id, executedToolCalls[0]!.id));
    expect(executedToolCall).toMatchObject({
      id: executedToolCalls[0]!.id,
      runId: executedToolCalls[0]!.runId,
      floorId,
      pageId: null,
      callerSlot: "narrator",
      providerId: "builtin",
      toolName: "lookup_fact",
      status: "success",
      lifecycleState: "finished",
      commitOutcome: "committed",
      durationMs: 17,
      startedAt: committedAt,
      createdAt: committedAt,
    });

    const committedMemoryRows = await database.db
      .select()
      .from(memoryItems)
      .where(eq(memoryItems.sourceFloorId, floorId));
    expect(committedMemoryRows).toHaveLength(3);
    expect(committedMemoryRows.map((row) => JSON.parse(row.contentJson))).toEqual(
      expect.arrayContaining([
        "assistant summary",
        "Alice and Bob became allies.",
        "mood: hopeful",
      ])
    );
    const createdMoodFact = committedMemoryRows.find((row) => row.type === "fact");
    expect(createdMoodFact?.factKey).toBe("mood");
    expect(createdMoodFact && JSON.parse(createdMoodFact.contentJson)).toBe("mood: hopeful");

    const [updatedFact] = await database.db.select().from(memoryItems).where(eq(memoryItems.id, updatedFactId));
    expect(updatedFact).toMatchObject({
      id: updatedFactId,
      status: "active",
      importance: 0.9,
      updatedAt: committedAt,
    });
    expect(JSON.parse(updatedFact!.contentJson)).toBe("relationship: allies");

    const [deprecatedFact] = await database.db.select().from(memoryItems).where(eq(memoryItems.id, deprecatedFactId));
    expect(deprecatedFact).toMatchObject({
      id: deprecatedFactId,
      status: "deprecated",
      updatedAt: committedAt,
    });

    const [duplicateMoodFact] = await database.db.select().from(memoryItems).where(eq(memoryItems.id, duplicateMoodFactId));
    expect(duplicateMoodFact).toMatchObject({
      id: duplicateMoodFactId,
      status: "deprecated",
      updatedAt: committedAt,
    });

    expect(await database.db.select().from(memoryEdges)).toEqual([
      expect.objectContaining({
        fromId: createdMoodFact?.id,
        toId: duplicateMoodFactId,
        relation: "updates",
        createdAt: committedAt,
      }),
    ]);

    expect(stateChangedHandler).toHaveBeenCalledOnce();
    expect(stateChangedHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        previousState: "generating",
        newState: "committed",
        floor: expect.objectContaining({ id: floorId, state: "committed" }),
      })
    );

    expect(committedHandler).toHaveBeenCalledOnce();
    expect(committedHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        floor: expect.objectContaining({ id: floorId, state: "committed" }),
        promotedVariables: [],
      })
    );

    expect(memoryCreatedHandler).toHaveBeenCalledTimes(3);
    expect(memoryUpdatedHandler).toHaveBeenCalledOnce();
    expect(memoryDeprecatedHandler).toHaveBeenCalledTimes(2);
    expect(memoryDeprecatedHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        item: expect.objectContaining({ id: deprecatedFactId, status: "deprecated" }),
        reason: "stale",
      })
    );
    expect(memoryDeprecatedHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        item: expect.objectContaining({ id: duplicateMoodFactId, status: "deprecated" }),
        reason: "conflict_resolution:mood",
      })
    );
    expect(memoryConsolidatedHandler).toHaveBeenCalledOnce();
    expect(memoryConsolidatedHandler).toHaveBeenCalledWith(expect.objectContaining({
      sessionId,
      scope: "chat",
      scopeId: sessionId,
      floorId,
      created: 2,
      updated: 1,
      deprecated: 2,
    }));
  });

  it("replaces the active output page for committed floor retries inside the commit transaction", async () => {
    const sessionId = nanoid();
    const floorId = nanoid();
    const previousPageId = nanoid();
    const previousMessageId = nanoid();
    const nextPageId = nanoid();
    const nextMessageId = nanoid();
    const now = 1_735_689_730_000;
    const committedAt = now + 1_000;

    await seedSession(database, sessionId, now);
    await seedFloor({ database, sessionId, floorId, state: "committed", now });
    await database.db.insert(messagePages).values({
      id: previousPageId,
      floorId,
      pageNo: 1,
      pageKind: "output",
      isActive: true,
      version: 1,
      checksum: null,
      createdAt: now,
      updatedAt: now,
    });
    await database.db.insert(messages).values({
      id: previousMessageId,
      pageId: previousPageId,
      seq: 0,
      role: "assistant",
      content: "Old committed output.",
      contentFormat: "text",
      tokenCount: 0,
      isHidden: false,
      source: "narrator",
      createdAt: now,
    });
    await database.db.insert(floorResultSnapshots).values({
      floorId,
      outputPageId: previousPageId,
      assistantMessageId: previousMessageId,
      generatedText: "Old committed output.",
      summariesJson: JSON.stringify(["old summary"]),
      usageJson: JSON.stringify({ promptTokens: 1, completionTokens: 1, totalTokens: 2 }),
      verifierJson: null,
      committedAt: now,
      updatedAt: now,
    });
    await database.db.insert(floorRunStates).values({
      floorId,
      runId: "run-retry-1",
      runType: "retry_turn",
      status: "running",
      phase: "page_generating",
      publicPhase: "generating",
      phaseSeq: 1,
      attemptNo: 2,
      pendingOutputJson: null,
      verifierJson: null,
      errorJson: null,
      startedAt: now,
      updatedAt: now,
      completedAt: null,
    });

    const execution: TurnExecutionResult = {
      floorId,
      finalState: "generating",
      generatedText: "New committed output.",
      rawText: "New committed output.",
      summaries: ["new summary"],
      totalUsage: {
        promptTokens: 9,
        completionTokens: 7,
        totalTokens: 16,
      },
    };

    const result = await service.commit({
      accountId: DEFAULT_ACCOUNT_ID,
      floorId,
      sessionId,
      execution,
      committedAt,
      assistantMessageRef: {
        pageId: nextPageId,
        messageId: nextMessageId,
      },
      attempt: {
        sessionId,
        branchId: "main",
        floorId,
        runId: "run-retry-1",
        runType: "retry_turn",
        attemptNo: 2,
        replayMode: "with_context_refresh",
        sourceFloorId: floorId,
        sourceOutputPageId: previousPageId,
        candidateOutputPageId: nextPageId,
        candidateAssistantMessageId: nextMessageId,
      },
      outputReplacement: {
        expectedActivePageId: previousPageId,
      },
    });

    expect(result).toMatchObject({
      floorId,
      outputPageId: nextPageId,
      assistantMessageId: nextMessageId,
      finalState: "committed",
    });

    const pages = await database.db
      .select()
      .from(messagePages)
      .where(eq(messagePages.floorId, floorId));
    expect(pages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: previousPageId, pageNo: 1, version: 1, isActive: false }),
        expect.objectContaining({ id: nextPageId, pageNo: 1, version: 2, isActive: true }),
      ]),
    );

    const [snapshot] = await database.db
      .select()
      .from(floorResultSnapshots)
      .where(eq(floorResultSnapshots.floorId, floorId));
    expect(snapshot).toMatchObject({
      floorId,
      outputPageId: nextPageId,
      assistantMessageId: nextMessageId,
      generatedText: "New committed output.",
      committedAt,
      updatedAt: committedAt,
    });

    const [floor] = await database.db.select().from(floors).where(eq(floors.id, floorId));
    expect(floor).toMatchObject({
      id: floorId,
      state: "committed",
      tokenIn: 9,
      tokenOut: 7,
      updatedAt: committedAt,
    });
  });

  it("rejects stale turn attempts before commit and rolls back candidate output", async () => {
    const sessionId = nanoid();
    const floorId = nanoid();
    const candidatePageId = nanoid();
    const candidateMessageId = nanoid();
    const now = 1_735_689_731_000;

    await seedSession(database, sessionId, now);
    await seedFloor({ database, sessionId, floorId, state: "generating", now });
    await database.db.insert(floorRunStates).values({
      floorId,
      runId: "run-current",
      runType: "respond",
      status: "running",
      phase: "page_generating",
      publicPhase: "generating",
      phaseSeq: 1,
      attemptNo: 2,
      pendingOutputJson: null,
      verifierJson: null,
      errorJson: null,
      startedAt: now,
      updatedAt: now,
      completedAt: null,
    });

    const execution: TurnExecutionResult = {
      floorId,
      finalState: "generating",
      generatedText: "Should not commit.",
      rawText: "Should not commit.",
      summaries: [],
      totalUsage: {
        promptTokens: 3,
        completionTokens: 4,
        totalTokens: 7,
      },
    };

    await expect(service.commit({
      accountId: DEFAULT_ACCOUNT_ID,
      floorId,
      sessionId,
      execution,
      committedAt: now + 500,
      assistantMessageRef: {
        pageId: candidatePageId,
        messageId: candidateMessageId,
      },
      attempt: {
        sessionId,
        branchId: "main",
        floorId,
        runId: "run-stale",
        runType: "respond",
        attemptNo: 1,
        replayMode: "full_floor_context",
        candidateOutputPageId: candidatePageId,
        candidateAssistantMessageId: candidateMessageId,
      },
    })).rejects.toMatchObject({
      code: "attempt_not_current",
    });

    const [floor] = await database.db.select().from(floors).where(eq(floors.id, floorId));
    expect(floor).toMatchObject({
      id: floorId,
      state: "generating",
      tokenIn: 0,
      tokenOut: 0,
      updatedAt: now,
    });

    const pages = await database.db.select().from(messagePages).where(eq(messagePages.floorId, floorId));
    const storedMessages = await database.db.select().from(messages).where(eq(messages.pageId, candidatePageId));
    const snapshots = await database.db.select().from(floorResultSnapshots).where(eq(floorResultSnapshots.floorId, floorId));
    expect(pages).toEqual([]);
    expect(storedMessages).toEqual([]);
    expect(snapshots).toEqual([]);
  });

  it("stages proposal envelopes during commit without promoting memory truth by default", async () => {
    const sessionId = nanoid();
    const floorId = nanoid();
    const now = 1_735_689_745_000;
    const committedAt = now + 1_000;
    const candidatePageId = "page-output-proposal";
    const candidateMessageId = "assistant-message-proposal";

    await seedSession(database, sessionId, now);
    await seedFloor({ database, sessionId, floorId, state: "generating", now });
    await database.db.insert(floorRunStates).values({
      floorId,
      runId: "run-proposal-stage",
      runType: "respond",
      status: "running",
      phase: "candidate_generated",
      publicPhase: "verifying",
      phaseSeq: 1,
      attemptNo: 1,
      pendingOutputJson: null,
      verifierJson: null,
      errorJson: null,
      startedAt: now,
      updatedAt: now,
      completedAt: null,
    });

    const execution: TurnExecutionResult = {
      floorId,
      finalState: "generating",
      generatedText: "Assistant reply with proposals.",
      rawText: "Assistant reply with proposals.",
      summaries: ["assistant summary"],
      totalUsage: {
        promptTokens: 12,
        completionTokens: 18,
        totalTokens: 30,
      },
    };

    const result = await service.commit({
      accountId: DEFAULT_ACCOUNT_ID,
      floorId,
      sessionId,
      execution,
      committedAt,
      assistantMessageRef: {
        pageId: candidatePageId,
        messageId: candidateMessageId,
      },
      attempt: {
        sessionId,
        branchId: "main",
        floorId,
        runId: "run-proposal-stage",
        runType: "respond",
        attemptNo: 1,
        replayMode: "full_floor_context",
        candidateOutputPageId: candidatePageId,
        candidateAssistantMessageId: candidateMessageId,
      },
      proposalEnvelope: {
        attempt: {
          sessionId,
          branchId: "main",
          floorId,
          runId: "run-proposal-stage",
          runType: "respond",
          attemptNo: 1,
          replayMode: "full_floor_context",
          candidateOutputPageId: candidatePageId,
          candidateAssistantMessageId: candidateMessageId,
        },
        outputPageId: candidatePageId,
        findings: {
          continuity: [],
          agency: [],
          style: [],
        },
        stateProposals: [
          {
            id: "state-1",
            sourceAgentId: "inline:state_proposal",
            targetNamespace: "scene",
            targetSlot: "weather",
            payload: { raw: "rain" },
            promotion: "observe_only",
          },
        ],
        memoryProposals: [
          {
            id: "memory-1",
            sourceAgentId: "inline:memory_proposal",
            kind: "summary",
            summary: "Remember the rain.",
            promotion: "stage_for_review",
          },
        ],
        relationshipProposals: [],
        openLoopProposals: [],
      },
      commitGateDecision: {
        status: "allow",
        policy: "warn_only",
        reasons: [],
      },
    });

    expect(result.proposalPromotion).toMatchObject({
      status: "staged",
 pageWriteAcceptedCount: 1,
      pageWriteDiscardedCount: 0,
      stateObservedCount: 1,
      memoryBatchCount: 1,
      memoryProposedCount: 1,
      memoryRejectedCount: 0,
      memorySupersededCount: 0,
    });

    const [pageWrite] = await database.db.select().from(pageStagedWrites).where(eq(pageStagedWrites.pageId, candidatePageId));
    expect(pageWrite).toMatchObject({
      pageId: candidatePageId,
      status: "accepted",
      reason: "agent:state_proposal",
    });

    const [batchRow] = await database.db.select().from(pageStagedMemoryProposalBatches).where(eq(pageStagedMemoryProposalBatches.pageId, candidatePageId));
    expect(batchRow).toMatchObject({
      proposalBatchId: `agent-proposal:${candidatePageId}`,
      proposalStatus: "proposed",
      promotionStatus: null,
      decisionReason: null,
      decisionCode: null,
    });

    const itemRows = await database.db.select().from(pageStagedMemoryProposalItems).where(eq(pageStagedMemoryProposalItems.batchId, `agent-proposal:${candidatePageId}`));
    expect(itemRows).toHaveLength(1);
    expect(itemRows[0]).toMatchObject({
      memoryKind: "summary",
      operationKind: "refresh_summary",
      status: "proposed",
    });
    expect(await database.db.select().from(memoryItems)).toEqual([]);
  });

  it("records floor commit operation logs without storing prompt, tool, or output content", async () => {
    const sessionId = nanoid();
    const floorId = nanoid();
    const now = 1_735_689_750_000;
    const committedAt = now + 1_000;
    const runId = "llm-run-operation-log";

    await seedSession(database, sessionId, now);
    await seedFloor({ database, sessionId, floorId, state: "generating", now });

    const execution: TurnExecutionResult = {
      floorId,
      finalState: "generating",
      generatedText: "SECRET_LLM_OUTPUT",
      rawText: "SECRET_LLM_OUTPUT",
      summaries: ["SECRET_LLM_SUMMARY"],
      totalUsage: {
        promptTokens: 21,
        completionTokens: 34,
        totalTokens: 55,
      },
      toolTransport: {
        selection: { transport: "text_protocol", reasonCode: "explicit_override" },
        toolList: {
          injected: true,
          contributorId: "builtin:tool_list",
          toolCount: 1,
          tokenCount: 96,
          budgetGroup: "tool_list",
        },
        parsing: {
          blockCount: 2,
          acceptedCount: 1,
          rejectedCount: 1,
          diagnostics: [{
            callId: "bad",
            toolName: "missing_tool",
            reason: "tool_not_registered",
            excerpt: "SECRET_TOOL_CALL_EXCERPT",
          }],
          diagnosticsByReason: { tool_not_registered: 1 },
        },
        toolResult: {
          writtenBack: true,
          blockCount: 1,
          tokenCount: 128,
          budgetGroup: "tool_result",
        },
      },
    };

    const promptSnapshot: PromptSnapshotRecord = {
      floorId,
      sessionId,
      presetId: null,
      presetUpdatedAt: null,
      presetVersion: null,
      worldbookId: null,
      worldbookUpdatedAt: null,
      worldbookVersion: null,
      regexProfileId: null,
      regexProfileUpdatedAt: null,
      regexProfileVersion: null,
      characterId: null,
      characterVersionId: null,
      characterImportedFormat: null,
      characterContentHash: null,
      worldbookActivatedEntryUids: [],
      worldbookActivatedEntries: [],
      regexPreRuleNames: [],
      regexPostRuleNames: [],
      promptMode: "native",
      assetManifestDigest: null,
      promptDigest: "sha256:operation-log-prompt-digest",
      tokenEstimate: 128,
      createdAt: committedAt,
    };

    const toolExecutionRecords: ExecutedToolCallRecord[] = [
      {
        id: nanoid(),
        runId,
        floorId,
        callerSlot: "narrator",
        providerId: "builtin",
        toolName: "lookup_secret",
        argsJson: JSON.stringify({ secret: "SECRET_TOOL_ARGS" }),
        resultJson: JSON.stringify({ secret: "SECRET_TOOL_RESULT" }),
        status: "success",
        durationMs: 9,
        createdAt: committedAt,
      },
    ];

    await service.commit({
      accountId: DEFAULT_ACCOUNT_ID,
      floorId,
      sessionId,
      execution,
      committedAt,
      promptSnapshot,
      toolExecutionRecords,
      runId,
      operationLog: {
        requestId: "request-floor-commit",
        route: "POST /sessions/:id/respond",
      },
    });

    const logs = new OperationLogService(database.db).list({
      accountId: DEFAULT_ACCOUNT_ID,
      sessionId,
      floorId,
      action: "commit_floor",
      sortOrder: "asc",
    }).rows;

    expect(logs).toHaveLength(1);
    const log = logs[0]!;
    expect(log).toMatchObject({
      actorType: "llm",
      actorId: runId,
      sourceType: "llm_run",
      action: "commit_floor",
      status: "succeeded",
      sessionId,
      branchId: "main",
      floorId,
      runId,
      targetType: "floor",
      targetId: floorId,
      requestId: "request-floor-commit",
    });

    expect(log.beforeRef).toBeNull();
    expect(log.afterRef).toEqual(expect.objectContaining({
      floor_id: floorId,
      run_id: runId,
      prompt_snapshot_present: true,
      explain_snapshot_present: false,
      floor_result_snapshot_present: true,
      tool_execution_count: 1,
      session_state_mutation_count: 0,
    }));
    expect(log.metadata).toEqual(expect.objectContaining({
      route: "POST /sessions/:id/respond",
      prompt_snapshot_present: true,
      explain_snapshot_present: false,
      floor_result_snapshot_present: true,
      tool_execution_count: 1,
      session_state_mutation_count: 0,
    }));
    expect((log.diff as { total_changes?: number } | null)?.total_changes).toBeGreaterThan(0);

    const toolTransportLogs = new OperationLogService(database.db).list({
      accountId: DEFAULT_ACCOUNT_ID,
      sessionId,
      floorId,
      action: "tool_transport.tool_result_writeback",
      sortOrder: "asc",
    }).rows;
    expect(toolTransportLogs).toHaveLength(1);
    expect(toolTransportLogs[0]).toMatchObject({
      sourceType: "tool_transport",
      status: "succeeded",
      targetType: "tool_result_prompt",
      runId,
    });

    const parseFailureLogs = new OperationLogService(database.db).list({
      accountId: DEFAULT_ACCOUNT_ID,
      sessionId,
      floorId,
      action: "tool_transport.parse_failed",
      sortOrder: "asc",
    }).rows;
    expect(parseFailureLogs).toHaveLength(1);
    expect(parseFailureLogs[0]).toMatchObject({
      sourceType: "tool_transport",
      status: "failed",
      reason: "tool_not_registered",
      targetType: "tool_transport_parse",
      runId,
    });

    const serializedLogs = JSON.stringify([
      ...logs,
      ...toolTransportLogs,
      ...parseFailureLogs,
    ]);
    expect(serializedLogs).not.toContain("SECRET_LLM_OUTPUT");
    expect(serializedLogs).not.toContain("SECRET_LLM_SUMMARY");
    expect(serializedLogs).not.toContain("SECRET_TOOL_ARGS");
    expect(serializedLogs).not.toContain("SECRET_TOOL_RESULT");
    expect(serializedLogs).not.toContain("SECRET_TOOL_CALL_EXCERPT");
  });



  it("scopes memory writes by accountId and resolves global/chat/floor scopeId correctly", async () => {
    const accountId = "account-a";
    const foreignAccountId = "account-b";
    const sessionId = nanoid();
    const floorId = nanoid();
    const now = 1_735_689_760_000;
    const committedAt = now + 1_000;
    const foreignFactId = nanoid();

    await seedAccount(database, accountId, now);
    await seedAccount(database, foreignAccountId, now);
    await seedSession(database, sessionId, now, accountId);
    await seedFloor({ database, sessionId, floorId, state: "generating", now });

    await database.db.insert(memoryItems).values({
      id: foreignFactId,
      accountId: foreignAccountId,
      scope: "chat",
      scopeId: sessionId,
      type: "fact",
      contentJson: JSON.stringify("foreign: untouched"),
      factKey: "foreign",
      importance: 0.4,
      confidence: 1,
      sourceFloorId: "foreign-floor",
      sourceMessageId: null,
      status: "active",
      createdAt: now - 5_000,
      updatedAt: now - 5_000,
    });

    const execution: TurnExecutionResult = {
      floorId,
      finalState: "generating",
      generatedText: "Scoped memory commit.",
      rawText: "Scoped memory commit.",
      summaries: [],
      totalUsage: {
        promptTokens: 7,
        completionTokens: 9,
        totalTokens: 16,
      },
    };

    await service.commit({
      accountId,
      floorId,
      sessionId,
      execution,
      committedAt,
      memoryCommit: {
        consolidationOutput: {
          turnSummary: "",
          factsAdd: [
            { key: "world_rule", value: "magic has a price", scope: "global", importance: 0.8 },
            { key: "scene", value: "watchtower balcony", scope: "floor", importance: 0.7 },
            { key: "mood", value: "focused", scope: "chat", importance: 0.6 },
          ],
          factsUpdate: [{ id: foreignFactId, value: "foreign: changed" }],
          factsDeprecate: [{ id: foreignFactId, reason: "should_not_apply" }],
        },
      },
    });

    const createdFacts = await database.db
      .select()
      .from(memoryItems)
      .where(and(eq(memoryItems.accountId, accountId), eq(memoryItems.sourceFloorId, floorId), eq(memoryItems.type, "fact")));

    expect(createdFacts).toHaveLength(3);

    const createdByKey = new Map(createdFacts.map((row) => [row.factKey, row]));
    expect(createdByKey.get("world_rule")).toMatchObject({
      scope: "global",
      scopeId: accountId,
      status: "active",
    });
    expect(createdByKey.get("scene")).toMatchObject({
      scope: "floor",
      scopeId: floorId,
      status: "active",
    });
    expect(createdByKey.get("mood")).toMatchObject({
      scope: "chat",
      scopeId: sessionId,
      status: "active",
    });

    expect(JSON.parse(createdByKey.get("world_rule")!.contentJson)).toBe("world_rule: magic has a price");
    expect(JSON.parse(createdByKey.get("scene")!.contentJson)).toBe("scene: watchtower balcony");
    expect(JSON.parse(createdByKey.get("mood")!.contentJson)).toBe("mood: focused");

    const [foreignFact] = await database.db.select().from(memoryItems).where(eq(memoryItems.id, foreignFactId));
    expect(foreignFact).toMatchObject({
      id: foreignFactId,
      accountId: foreignAccountId,
      status: "active",
      updatedAt: now - 5_000,
    });
    expect(JSON.parse(foreignFact!.contentJson)).toBe("foreign: untouched");
  });

  it("enqueues ingest_turn jobs inside the commit transaction when async memory ingest is enabled", async () => {
    const asyncService = new TurnCommitService(
      database.db,
      new ChatMessagePersistence(database.db, new SimpleTokenCounter()),
      eventBus,
      { enableAsyncMemoryIngest: true },
    );
    const sessionId = nanoid();
    const floorId = nanoid();
    const pageId = nanoid();
    const userMessageId = nanoid();
    const now = 1_735_689_770_000;
    const committedAt = now + 1_000;
    const userMessage = "Async memory enqueue should only schedule work.";

    await seedSession(database, sessionId, now);
    await seedFloor({ database, sessionId, floorId, state: "generating", now });
    await seedInputPage({ database, floorId, pageId, now });
    await seedUserMessage({
      database,
      pageId,
      messageId: userMessageId,
      content: userMessage,
      now,
    });

    const execution: TurnExecutionResult = {
      floorId,
      finalState: "generating",
      generatedText: "Assistant reply with async memory ingest.",
      rawText: "Assistant reply with async memory ingest.",
      summaries: ["A deferred summary from the assistant."],
      totalUsage: {
        promptTokens: 11,
        completionTokens: 12,
        totalTokens: 23,
      },
    };

    const result = await asyncService.commit({
      accountId: DEFAULT_ACCOUNT_ID,
      floorId,
      sessionId,
      execution,
      committedAt,
      variableCommit: { pageId },
      memoryCommit: {
        summaries: execution.summaries,
        enableConsolidation: true,
      },
    });

    expect(result.finalState).toBe("committed");
    expect(result.memory).toEqual({
      mode: "async",
      status: "queued",
      jobId: `memory-job:ingest_turn:${result.outputPageId}`,
    });
    expect(await database.db.select().from(memoryItems)).toEqual([]);

    const [job] = await database.db.select().from(runtimeJobs).where(eq(runtimeJobs.floorId, floorId));
    expect(job).toMatchObject({
      id: `memory-job:ingest_turn:${result.outputPageId}`,
      jobType: toMemoryRuntimeJobType("ingest_turn"),
      accountId: DEFAULT_ACCOUNT_ID,
      scopeType: MEMORY_RUNTIME_SCOPE_TYPE,
      scopeKey: buildMemoryRuntimeScopeKey("chat", sessionId),
      status: "pending",
      floorId,
      pageId: result.outputPageId,
      basedOnRevision: null,
      attemptCount: 0,
      maxAttempts: 5,
      availableAt: committedAt,
      progressCurrent: 0,
      leaseOwner: null,
      leaseUntil: null,
    });

    expect(JSON.parse(job!.payloadJson)).toEqual(expect.objectContaining({
      accountId: DEFAULT_ACCOUNT_ID,
      sessionId,
      floorId,
      floorNo: 0,
      assistantMessageId: result.assistantMessageId,
      userInputDigest: expect.any(String),
      committedAt,
      summaries: execution.summaries,
      pageId: result.outputPageId,
      runtimeMode: "async_primary",
      enableConsolidation: true,
    }));
  });

  it("uses conversation_input snapshot for async memory ingest when the floor has no input page", async () => {
    const asyncService = new TurnCommitService(
      database.db,
      new ChatMessagePersistence(database.db, new SimpleTokenCounter()),
      eventBus,
      { enableAsyncMemoryIngest: true },
    );
    const sessionId = nanoid();
    const floorId = nanoid();
    const now = 1_735_689_775_000;
    const committedAt = now + 1_000;
    const effectiveUserText = "Merged user tail for a response-only floor.";
    const conversationInputSnapshot = buildConversationInputSnapshot({
      effectiveText: effectiveUserText,
      sourceTurn: {
        sourceFloorIds: ["floor-user-1", "floor-user-2"],
        sourcePageIds: ["page-user-1", "page-user-2"],
        sourceMessageIds: ["msg-user-1", "msg-user-2"],
        floorRange: { start: 1, end: 2 },
        includesCurrentInput: false,
        entryCount: 2,
      },
    });

    await seedSession(database, sessionId, now);
    await seedFloor({ database, sessionId, floorId, state: "generating", now });

    const execution: TurnExecutionResult = {
      floorId,
      finalState: "generating",
      generatedText: "Assistant reply for a response-only floor.",
      rawText: "Assistant reply for a response-only floor.",
      summaries: ["Async memory for response-only floor."],
      totalUsage: {
        promptTokens: 9,
        completionTokens: 10,
        totalTokens: 19,
      },
    };

    const result = await asyncService.commit({
      accountId: DEFAULT_ACCOUNT_ID,
      floorId,
      sessionId,
      execution,
      committedAt,
      conversationInputSnapshot,
      memoryCommit: {
        summaries: execution.summaries,
        enableConsolidation: true,
      },
    });

    expect(result.memory).toEqual({
      mode: "async",
      status: "queued",
      jobId: `memory-job:ingest_turn:${result.outputPageId}`,
    });

    const [job] = await database.db.select().from(runtimeJobs).where(eq(runtimeJobs.floorId, floorId));
    expect(JSON.parse(job!.payloadJson)).toEqual(expect.objectContaining({
      userInputDigest: expect.any(String),
    }));

    const [floorRow] = await database.db.select().from(floors).where(eq(floors.id, floorId));
    expect(readFloorConversationInputSnapshot(floorRow!.metadataJson)).toEqual(conversationInputSnapshot);
  });

  it("enqueues deferred tool.execute jobs inside the commit transaction and links runtime_job_id", async () => {
    const toolBridge = createToolRuntimeJobBridge(database.db, { eventBus });
    const deferredService = new TurnCommitService(
      database.db,
      new ChatMessagePersistence(database.db, new SimpleTokenCounter()),
      eventBus,
      { toolRuntimeJobBridge: toolBridge },
    );
    const sessionId = nanoid();
    const floorId = nanoid();
    const now = 1_735_689_775_000;
    const committedAt = now + 1_000;
    const executionId = nanoid();
    const runId = nanoid();
    const jobId = `tool-job:${executionId}`;
    const receipt = {
      accepted: true as const,
      delivery_mode: "async_job" as const,
      execution_id: executionId,
      job_id: jobId,
      status: "queued" as const,
      message: "Deferred tool accepted.",
    };

    await seedSession(database, sessionId, now);
    await seedFloor({ database, sessionId, floorId, state: "generating", now });

    const execution: TurnExecutionResult = {
      floorId,
      finalState: "generating",
      generatedText: "Assistant reply with deferred tool receipt.",
      rawText: "Assistant reply with deferred tool receipt.",
      summaries: [],
      totalUsage: {
        promptTokens: 7,
        completionTokens: 9,
        totalTokens: 16,
      },
      toolExecutionRecords: [
        {
          id: executionId,
          runId,
          deliveryMode: "async_job",
          floorId,
          callerSlot: "narrator",
          providerId: "mcp:mcp-1",
          providerType: "mcp",
          toolName: "github_create_issue",
          argsJson: JSON.stringify({ title: "Need help" }),
          resultJson: JSON.stringify(receipt),
          status: "queued",
          lifecycleState: "opened",
          commitOutcome: "pending",
          sideEffectLevel: "irreversible",
          durationMs: 0,
          startedAt: committedAt,
          attemptNo: 1,
          createdAt: committedAt,
        },
      ],
      pendingToolJobs: [
        {
          executionId,
          runId,
          jobId,
          envelope: {
            executionId,
            runId,
            sessionId,
            accountId: DEFAULT_ACCOUNT_ID,
            floorId,
            callerSlot: "narrator",
            providerId: "mcp:mcp-1",
            providerType: "mcp",
            toolName: "github_create_issue",
            args: { title: "Need help" },
            sideEffectLevel: "irreversible",
            deliveryMode: "async_job",
            asyncCapability: "deferred_ok",
            resultVisibility: "deferred_receipt",
            acceptedAt: committedAt,
          },
          receipt,
        },
      ],
    };

    await deferredService.commit({
      accountId: DEFAULT_ACCOUNT_ID,
      floorId,
      sessionId,
      execution,
      committedAt,
    });

    const [job] = await database.db.select().from(runtimeJobs).where(eq(runtimeJobs.id, jobId));
    expect(job).toMatchObject({
      id: jobId,
      jobType: "tool.execute",
      accountId: DEFAULT_ACCOUNT_ID,
      scopeType: "tool_execution",
      scopeKey: `session:${sessionId}`,
      sessionId,
      floorId,
      status: "pending",
    });

    const [toolExecutionRow] = await database.db.select().from(toolExecutionRecords).where(eq(toolExecutionRecords.id, executionId));
    expect(toolExecutionRow).toMatchObject({
      id: executionId,
      status: "queued",
      lifecycleState: "opened",
      deliveryMode: "async_job",
      runtimeJobId: jobId,
      commitOutcome: "committed",
    });

    const [legacyToolCallRow] = await database.db
      .select()
      .from(toolCallRecords)
      .where(eq(toolCallRecords.id, executionId));
    expect(legacyToolCallRow).toMatchObject({
      id: executionId,
      pageId: expect.any(String),
      status: "queued",
    });
  });

  it("does not durable enqueue deferred tool jobs when the floor commit rolls back", async () => {
    const toolBridge = createToolRuntimeJobBridge(database.db, { eventBus });
    const deferredService = new TurnCommitService(
      database.db,
      new ChatMessagePersistence(database.db, new SimpleTokenCounter()),
      eventBus,
      { toolRuntimeJobBridge: toolBridge },
    );
    const sessionId = nanoid();
    const floorId = nanoid();
    const now = 1_735_689_779_000;
    const executionId = nanoid();
    const runId = nanoid();
    const jobId = `tool-job:${executionId}`;

    await seedSession(database, sessionId, now);
    await seedFloor({ database, sessionId, floorId, state: "draft", now });

    const execution: TurnExecutionResult = {
      floorId,
      finalState: "generating",
      generatedText: "Should roll back deferred tool queueing.",
      rawText: "Should roll back deferred tool queueing.",
      summaries: [],
      totalUsage: {
        promptTokens: 5,
        completionTokens: 6,
        totalTokens: 11,
      },
      toolExecutionRecords: [
        {
          id: executionId,
          runId,
          deliveryMode: "async_job",
          floorId,
          callerSlot: "narrator",
          providerId: "mcp:mcp-1",
          providerType: "mcp",
          toolName: "github_create_issue",
          argsJson: JSON.stringify({ title: "Need help" }),
          resultJson: JSON.stringify({ accepted: true, status: "queued" }),
          status: "queued",
          lifecycleState: "opened",
          commitOutcome: "pending",
          sideEffectLevel: "irreversible",
          durationMs: 0,
          startedAt: now,
          attemptNo: 1,
          createdAt: now,
        },
      ],
      pendingToolJobs: [
        {
          executionId,
          runId,
          jobId,
          envelope: {
            executionId,
            runId,
            sessionId,
            accountId: DEFAULT_ACCOUNT_ID,
            floorId,
            callerSlot: "narrator",
            providerId: "mcp:mcp-1",
            providerType: "mcp",
            toolName: "github_create_issue",
            args: { title: "Need help" },
            sideEffectLevel: "irreversible",
            deliveryMode: "async_job",
            asyncCapability: "deferred_ok",
            resultVisibility: "deferred_receipt",
            acceptedAt: now,
          },
          receipt: { accepted: true, delivery_mode: "async_job", execution_id: executionId, job_id: jobId, status: "queued", message: "Deferred tool accepted." },
        },
      ],
    };

    await expect(deferredService.commit({ accountId: DEFAULT_ACCOUNT_ID, floorId, sessionId, execution })).rejects.toThrow(FloorStateConflictError);
    expect(await database.db.select().from(runtimeJobs)).toEqual([]);
    expect(await database.db.select().from(toolExecutionRecords)).toEqual([]);
  });


  it("flushes buffered tool variable mutations into the accepted output page before page-to-floor promotion", async () => {
    const sessionId = nanoid();
    const floorId = nanoid();
    const pageId = nanoid();
    const now = 1_735_689_780_000;
    const committedAt = now + 1_000;

    await seedSession(database, sessionId, now);
    await seedFloor({ database, sessionId, floorId, state: "generating", now });
    await seedInputPage({ database, floorId, pageId, now });

    const execution: TurnExecutionResult = {
      floorId,
      finalState: "generating",
      generatedText: "Buffered variable commit.",
      rawText: "Buffered variable commit.",
      summaries: [],
      totalUsage: {
        promptTokens: 5,
        completionTokens: 8,
        totalTokens: 13,
      },
      bufferedVariableMutations: [
        {
          runId: "run-buffered",
          generationAttemptNo: 1,
          scope: "page",
          scopeId: pageId,
          intent: "promote_to_floor_on_accept",
          key: "mood",
          value: "hopeful",
          bufferedAt: now + 10,
        },
      ],
    };

    const variableSetHandler = vi.fn();
    eventBus.on("variable.set", variableSetHandler);

    const commitResult = await service.commit({
      accountId: DEFAULT_ACCOUNT_ID,
      floorId,
      sessionId,
      execution,
      committedAt,
      variableCommit: { pageId },
    });

    const outputPageId = commitResult.outputPageId;

    const pageRows = await database.db
      .select()
      .from(variables)
      .where(and(eq(variables.scope, "page"), eq(variables.scopeId, outputPageId)));
    expect(pageRows.map((row) => [row.key, JSON.parse(row.valueJson)])).toEqual([
      ["mood", "hopeful"],
    ]);

    const floorRows = await database.db
      .select()
      .from(variables)
      .where(and(eq(variables.scope, "floor"), eq(variables.scopeId, floorId)));
    expect(floorRows.map((row) => [row.key, JSON.parse(row.valueJson)])).toEqual([
      ["mood", "hopeful"],
    ]);

    expect(variableSetHandler).toHaveBeenCalledWith(expect.objectContaining({
      sessionId,
      branchId: "main",
      entry: expect.objectContaining({ scope: "page", scopeId: outputPageId, key: "mood", value: "hopeful" }),
      isNew: true,
    }));
  });

  it("derives legacy tool_call_record rows from real toolExecutionRecords when needed", async () => {
    const sessionId = nanoid();
    const floorId = nanoid();
    const now = 1_735_689_820_000;
    const committedAt = now + 1_000;

    await seedSession(database, sessionId, now);
    await seedFloor({ database, sessionId, floorId, state: "generating", now });

    const execution: TurnExecutionResult = {
      floorId,
      finalState: "generating",
      generatedText: "Assistant reply with tool records.",
      rawText: "Assistant reply with tool records.",
      summaries: [],
      totalUsage: {
        promptTokens: 8,
        completionTokens: 13,
        totalTokens: 21,
      },
    };

    const executedToolCalls: ExecutedToolCallRecord[] = [
      {
        id: nanoid(),
        runId: nanoid(),
        floorId,
        callerSlot: "narrator",
        providerId: "builtin",
        toolName: "roll_dice",
        argsJson: JSON.stringify({ sides: 6 }),
        resultJson: JSON.stringify({ total: 4 }),
        status: "success",
        durationMs: 11,
        createdAt: committedAt,
      },
    ];

    const result = await service.commit({
      accountId: DEFAULT_ACCOUNT_ID,
      floorId,
      sessionId,
      execution,
      committedAt,
      toolExecutionRecords: executedToolCalls,
    });

    const [legacyToolCall] = await database.db
      .select()
      .from(toolCallRecords)
      .where(eq(toolCallRecords.id, executedToolCalls[0]!.id));
    expect(legacyToolCall).toMatchObject({
      id: executedToolCalls[0]!.id,
      pageId: result.outputPageId,
      seq: 1,
      callerSlot: "narrator",
      toolName: "roll_dice",
      status: "success",
      durationMs: 11,
      createdAt: committedAt,
    });

    const [executedToolCall] = await database.db
      .select()
      .from(toolExecutionRecords)
      .where(eq(toolExecutionRecords.id, executedToolCalls[0]!.id));
    expect(executedToolCall).toMatchObject({
      id: executedToolCalls[0]!.id,
      floorId,
      pageId: null,
      providerId: "builtin",
      toolName: "roll_dice",
      status: "success",
      lifecycleState: "finished",
      commitOutcome: "committed",
      durationMs: 11,
      startedAt: committedAt,
      createdAt: committedAt,
    });
  });

  it("persists prompt runtime explain snapshot payload inside the commit transaction", async () => {
    const sessionId = nanoid();
    const floorId = nanoid();
    const now = 1_735_689_720_000;
    const committedAt = now + 1_000;

    await seedSession(database, sessionId, now);
    await seedFloor({ database, sessionId, floorId, state: "generating", now });

    const execution: TurnExecutionResult = {
      floorId,
      finalState: "generating",
      generatedText: "Assistant reply with persisted explain snapshot.",
      rawText: "Assistant reply with persisted explain snapshot.",
      summaries: ["assistant summary"],
      totalUsage: {
        promptTokens: 24,
        completionTokens: 12,
        totalTokens: 36,
      },
    };

    const inspection = {
      scope: {
        sessionId,
        targetBranchId: "main",
        branchExists: true,
        sourceFloorId: null,
        historySourceBranchId: "main",
        historySourceMode: "existing_branch",
      },
      assets: {
        preset: null,
        characterCard: null,
        worldbook: null,
        regexProfile: null,
      },
      resolvedPolicy: {
        structure: { ...DEFAULT_RESOLVED_PROMPT_RUNTIME_STRUCTURE_POLICY },
        delivery: { ...DEFAULT_RESOLVED_PROMPT_RUNTIME_DELIVERY_POLICY },
        budget: { maxInputTokens: 256, reservedCompletionTokens: 64 },
        sourceSelection: { ...DEFAULT_RESOLVED_PROMPT_RUNTIME_SOURCE_SELECTION_POLICY },
        visibility: {
          mode: "deny_all_except_visible",
          visibleFloorRanges: [{ startFloorNo: 3, endFloorNo: 4 }],
        },
        debug: { ...DEFAULT_RESOLVED_PROMPT_RUNTIME_DEBUG_POLICY },
      },
      sourceMap: {
        budget: { maxInputTokens: "request_override", reservedCompletionTokens: "request_override" },
        visibility: { mode: "session_policy", visibleFloorRanges: "session_policy" },
        history: { sourceBranchId: "main", sourceMode: "existing_branch" },
      },
      diagnostics: [
        {
          code: "derived_no_assistant_structure",
          message: "delivery.noAssistant forced the resolved structure.mode to no_assistant.",
          severity: "warning",
          source: "policy",
          fieldPath: "policy.structure.mode",
        },
      ],
      trimReasons: [
        {
          group: "history",
          reason: "group_limit_exceeded",
          detail: "Budget allocator capped group 'history' at 0 tokens and retained 0 of 32 estimated tokens.",
          prunedTokenCount: 32,
        },
      ],
      historyNormalization: {
        rawEntryCount: 3,
        effectiveTurnCount: 2,
        selectedTurnCount: 2,
        trailingUserSourceFloorIds: ["floor-history-2"],
        mergedUserGroups: [],
        violations: [],
      },
      excludedSources: [
        {
          source: "history",
          reason: "visibility_filtered",
          detail: "Visibility filtered 1 floor(s) from the available history window.",
        },
      ],
      sectionStats: [{ sectionName: "history", tokenCount: 128 }],
      limitations: [],
    } satisfies PromptRuntimeInspectionResult;

    const expectedSnapshot = buildPromptRuntimeCommittedExplainSnapshot({
      floorId,
      sessionId,
      createdAt: committedAt,
      inspection,
    });

    await service.commit({
      accountId: DEFAULT_ACCOUNT_ID,
      floorId,
      sessionId,
      execution,
      committedAt,
      promptRuntimeInspection: inspection,
    });

    const [inspectionSnapshotRow] = await database.db
      .select()
      .from(promptRuntimeExplainSnapshots)
      .where(eq(promptRuntimeExplainSnapshots.floorId, floorId));

    expect(expectedSnapshot).not.toHaveProperty("limitations");
    expect(inspectionSnapshotRow).toMatchObject({
      floorId: expectedSnapshot.floorId,
      sessionId: expectedSnapshot.sessionId,
      targetBranchId: expectedSnapshot.targetBranchId,
      sourceFloorId: expectedSnapshot.sourceFloorId,
      historySourceBranchId: expectedSnapshot.historySourceBranchId,
      historySourceMode: expectedSnapshot.historySourceMode,
      snapshotVersion: expectedSnapshot.snapshotVersion,
      createdAt: expectedSnapshot.createdAt,
    });
    expect(JSON.parse(inspectionSnapshotRow!.resolvedPolicyJson)).toEqual(expectedSnapshot.resolvedPolicy);
    expect(JSON.parse(inspectionSnapshotRow!.trimReasonsJson)).toEqual(expectedSnapshot.trimReasons);
    expect(JSON.parse(inspectionSnapshotRow!.excludedSourcesJson)).toEqual(expectedSnapshot.excludedSources);
    expect(JSON.parse(inspectionSnapshotRow!.sectionStatsJson)).toEqual(expectedSnapshot.sectionStats);

    expect(parsePromptRuntimeExplainSourceMapEnvelope({
      snapshotVersion: inspectionSnapshotRow!.snapshotVersion,
      sourceMapJson: inspectionSnapshotRow!.sourceMapJson,
    })).toEqual({
      snapshotVersion: expectedSnapshot.snapshotVersion,
      sourceMap: expectedSnapshot.sourceMap,
      governance: expectedSnapshot.governance,
      historyNormalization: expectedSnapshot.historyNormalization ?? null,
    });
  });


  it("promotes page variables to floor inside the commit boundary", async () => {
    const sessionId = nanoid();
    const floorId = nanoid();
    const pageId = nanoid();
    const now = 1_735_689_900_000;
    const committedAt = now + 1_000;

    await seedSession(database, sessionId, now);
    await seedFloor({ database, sessionId, floorId, state: "generating", now });
    await seedInputPage({ database, floorId, pageId, now });

    const execution: TurnExecutionResult = {
      floorId,
      finalState: "generating",
      generatedText: "Assistant reply with promoted variables.",
      rawText: "Assistant reply with promoted variables.",
      summaries: [],
      totalUsage: {
        promptTokens: 9,
        completionTokens: 6,
        totalTokens: 15,
      },
      bufferedVariableMutations: [
        {
          runId: "run-promote-page-variables",
          generationAttemptNo: 1,
          scope: "page",
          scopeId: pageId,
          key: "mood",
          value: "steady",
          intent: "promote_to_floor_on_accept",
          bufferedAt: now + 10,
        },
        {
          runId: "run-promote-page-variables",
          generationAttemptNo: 1,
          scope: "page",
          scopeId: pageId,
          key: "hp",
          value: 95,
          intent: "promote_to_floor_on_accept",
          bufferedAt: now + 20,
        },
      ],
    };

    const committedHandler = vi.fn();
    const promotedHandler = vi.fn();
    eventBus.on("floor.committed", committedHandler);
    eventBus.on("variable.promoted", promotedHandler);

    await service.commit({
      accountId: DEFAULT_ACCOUNT_ID,
      floorId,
      sessionId,
      execution,
      committedAt,
      variableCommit: {
        pageId,
      },
    });

    const promotedRows = await database.db
      .select()
      .from(variables)
      .where(and(eq(variables.scope, "floor"), eq(variables.scopeId, floorId)));

    const promotedByKey = new Map(
      promotedRows.map((row) => [row.key, JSON.parse(row.valueJson)])
    );

    expect(promotedByKey.get("mood")).toBe("steady");
    expect(promotedByKey.get("hp")).toBe(95);

    expect(committedHandler).toHaveBeenCalledOnce();
    expect(committedHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        floor: expect.objectContaining({ id: floorId, state: "committed" }),
        promotedVariables: [
          expect.objectContaining({
            scope: "floor",
            scopeId: floorId,
            key: "hp",
            value: 95,
            updatedAt: committedAt,
          }),
          expect.objectContaining({
            scope: "floor",
            scopeId: floorId,
            key: "mood",
            value: "steady",
            updatedAt: committedAt,
          }),
        ],
      })
    );

    expect(promotedHandler).toHaveBeenCalledTimes(2);
    expect(promotedHandler).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        sessionId,
        branchId: "main",
        key: "hp",
        fromScope: "page",
        toScope: "floor",
        value: 95,
      })
    );
    expect(promotedHandler).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        sessionId,
        branchId: "main",
        key: "mood",
        fromScope: "page",
        toScope: "floor",
        value: "steady",
      })
    );
  });


  it("commits macro global set/delete mutations using their real scopes", async () => {
    const sessionId = nanoid();
    const floorId = nanoid();
    const pageId = nanoid();
    const now = 1_735_689_910_000;
    const committedAt = now + 1_000;

    await seedSession(database, sessionId, now);
    await seedFloor({ database, sessionId, floorId, state: "generating", now });
    await seedInputPage({ database, floorId, pageId, now });
    await seedVariable({ database, scope: "global", scopeId: "global", key: "world_rule", value: "old", now });
    await seedVariable({ database, scope: "branch", scopeId: buildBranchVariableScopeId(sessionId, "main"), key: "mood", value: "sad", now });

    const execution: TurnExecutionResult = {
      floorId,
      finalState: "generating",
      generatedText: "Assistant reply with macro commit.",
      rawText: "Assistant reply with macro commit.",
      summaries: [],
      totalUsage: {
        promptTokens: 9,
        completionTokens: 6,
        totalTokens: 15,
      },
    };

    const variableSetHandler = vi.fn();
    const variableDeletedHandler = vi.fn();
    eventBus.on("variable.set", variableSetHandler);
    eventBus.on("variable.deleted", variableDeletedHandler);

    await service.commit({
      accountId: DEFAULT_ACCOUNT_ID,
      floorId,
      sessionId,
      branchId: "main",
      execution,
      committedAt,
      variableCommit: {
        pageId,
      },
      macroStagedMutations: [
        { kind: "set", scope: "global", key: "world_rule", value: "magic has a price", sourceMacro: "setglobalvar" },
        { kind: "delete", scope: "branch", key: "mood", sourceMacro: "deletevar" },
      ],
    });

    const [globalVariable] = await database.db.select().from(variables).where(
      and(eq(variables.scope, "global"), eq(variables.scopeId, "global"), eq(variables.key, "world_rule")),
    );
    expect(globalVariable).toBeTruthy();
    expect(globalVariable && JSON.parse(globalVariable.valueJson)).toBe("magic has a price");

    const [branchVariable] = await database.db.select().from(variables).where(
      and(eq(variables.scope, "branch"), eq(variables.scopeId, buildBranchVariableScopeId(sessionId, "main")), eq(variables.key, "mood")),
    );
    expect(branchVariable).toBeUndefined();

    // Phase 1 语义：macro set 在 commit 成功后发 durable variable.set；
    // macro delete 在 commit 成功后发 durable variable.deleted。
    const macroSetCall = variableSetHandler.mock.calls.find(
      ([payload]) => payload?.entry?.key === "world_rule",
    );
    expect(macroSetCall).toBeDefined();
    expect(macroSetCall![0]).toMatchObject({
      sessionId,
      branchId: "main",
      entry: expect.objectContaining({
        scope: "global",
        scopeId: "global",
        key: "world_rule",
        value: "magic has a price",
      }),
    });

    expect(variableDeletedHandler).toHaveBeenCalledTimes(1);
    expect(variableDeletedHandler).toHaveBeenCalledWith(expect.objectContaining({
      sessionId,
      branchId: "main",
      scope: "branch",
      key: "mood",
    }));
  });

  it("persists structured root objects from macro staged mutations", async () => {
    const sessionId = nanoid();
    const floorId = nanoid();
    const pageId = nanoid();
    const now = 1_735_689_930_000;
    const committedAt = now + 1_000;

    await seedSession(database, sessionId, now);
    await seedFloor({ database, sessionId, floorId, state: "generating", now });
    await seedInputPage({ database, floorId, pageId, now });

    const execution: TurnExecutionResult = {
      floorId,
      finalState: "generating",
      generatedText: "Assistant reply with structured macro commit.",
      rawText: "Assistant reply with structured macro commit.",
      summaries: [],
      totalUsage: {
        promptTokens: 10,
        completionTokens: 6,
        totalTokens: 16,
      },
    };

    await service.commit({
      accountId: DEFAULT_ACCOUNT_ID,
      floorId,
      sessionId,
      branchId: "main",
      execution,
      committedAt,
      variableCommit: {
        pageId,
      },
      macroStagedMutations: [
        { kind: "set", scope: "branch", key: "资产", value: { 金币: "3", 银币: 5 }, sourceMacro: "setvar" },
      ],
    });

    const [branchVariable] = await database.db.select().from(variables).where(
      and(eq(variables.scope, "branch"), eq(variables.scopeId, buildBranchVariableScopeId(sessionId, "main")), eq(variables.key, "资产")),
    );

    expect(branchVariable).toBeTruthy();
    expect(branchVariable && JSON.parse(branchVariable.valueJson)).toEqual({ 金币: "3", 银币: 5 });
  });

  it("persists branch local variable snapshots with branch-over-chat visibility", async () => {
    const sessionId = nanoid();
    const floorId = nanoid();
    const pageId = nanoid();
    const now = 1_735_689_940_000;
    const committedAt = now + 1_000;
    const branchScopeId = buildBranchVariableScopeId(sessionId, "main");

    await seedSession(database, sessionId, now);
    await seedFloor({ database, sessionId, floorId, state: "generating", now });
    await seedInputPage({ database, floorId, pageId, now });
    await seedVariable({ database, scope: "chat", scopeId: sessionId, key: "chat_only", value: "campfire", now });
    await seedVariable({ database, scope: "chat", scopeId: sessionId, key: "shared", value: "chat-shared", now: now + 1 });
    await seedVariable({ database, scope: "branch", scopeId: branchScopeId, key: "branch_only", value: { 金币: 3, 银币: 5 }, now: now + 2 });
    await seedVariable({ database, scope: "branch", scopeId: branchScopeId, key: "shared", value: "branch-shared", now: now + 3 });

    const execution: TurnExecutionResult = {
      floorId,
      finalState: "generating",
      generatedText: "Assistant reply with branch local snapshot.",
      rawText: "Assistant reply with branch local snapshot.",
      summaries: [],
      totalUsage: {
        promptTokens: 11,
        completionTokens: 7,
        totalTokens: 18,
      },
    };

    await service.commit({
      accountId: DEFAULT_ACCOUNT_ID,
      floorId,
      sessionId,
      branchId: "main",
      execution,
      committedAt,
      variableCommit: {
        pageId,
      },
    });

    const [snapshotRow] = await database.db
      .select()
      .from(branchLocalVariableSnapshots)
      .where(eq(branchLocalVariableSnapshots.floorId, floorId));

    expect(snapshotRow).toMatchObject({
      floorId,
      accountId: DEFAULT_ACCOUNT_ID,
      sessionId,
      branchId: "main",
      createdAt: committedAt,
    });
    expect(snapshotRow && JSON.parse(snapshotRow.valuesJson)).toEqual({
      chat_only: "campfire",
      shared: "branch-shared",
      branch_only: { 金币: 3, 银币: 5 },
    });
  });

  it("rolls back assistant persistence when the floor is not generating", async () => {
    const sessionId = nanoid();
    const floorId = nanoid();
    const now = 1_735_689_720_000;

    await seedSession(database, sessionId, now);
    await seedFloor({ database, sessionId, floorId, state: "draft", now });
    const pageId = nanoid();
    await seedInputPage({ database, floorId, pageId, now });
    await seedVariable({ database, scope: "page", scopeId: pageId, key: "mood", value: "worried", now });

    const execution: TurnExecutionResult = {
      floorId,
      finalState: "generating",
      generatedText: "Should not persist",
      rawText: "Should not persist",
      summaries: [],
      totalUsage: {
        promptTokens: 9,
        completionTokens: 3,
        totalTokens: 12,
      },
    };

    const memoryCreatedHandler = vi.fn();
    const memoryUpdatedHandler = vi.fn();
    const memoryDeprecatedHandler = vi.fn();
    const memoryDeletedHandler = vi.fn();
    const memoryEdgeCreatedHandler = vi.fn();
    const memoryEdgeDeletedHandler = vi.fn();
    const memoryConsolidatedHandler = vi.fn();
    const variableSetHandler = vi.fn();
    const variableDeletedHandler = vi.fn();
    const variablePromotedHandler = vi.fn();
    eventBus.on("memory.created", memoryCreatedHandler);
    eventBus.on("memory.updated", memoryUpdatedHandler);
    eventBus.on("memory.deprecated", memoryDeprecatedHandler);
    eventBus.on("memory.deleted", memoryDeletedHandler);
    eventBus.on("memory.edge.created", memoryEdgeCreatedHandler);
    eventBus.on("memory.edge.deleted", memoryEdgeDeletedHandler);
    eventBus.on("memory.consolidated", memoryConsolidatedHandler);
    eventBus.on("variable.set", variableSetHandler);
    eventBus.on("variable.deleted", variableDeletedHandler);
    eventBus.on("variable.promoted", variablePromotedHandler);

    await expect(
      service.commit({
        accountId: DEFAULT_ACCOUNT_ID,
        floorId,
        sessionId,
        execution,
        toolCalls: [
          {
            id: nanoid(),
            pageId: "placeholder-page",
            seq: 0,
            callerSlot: "narrator",
            toolName: "lookup_fact",
            argsJson: "{}",
            resultJson: "{}",
            status: "success",
            durationMs: 1,
            createdAt: now,
          },
        ],
        variableCommit: {
          pageId,
        },
        macroStagedMutations: [
          { kind: "set", scope: "branch", key: "资产", value: { 金币: "3" }, sourceMacro: "setvar" },
        ],
        memoryCommit: {
          summaries: ["should roll back"],
          consolidationOutput: {
            turnSummary: "rollback consolidation",
            factsAdd: [{ key: "mood", value: "worried", scope: "chat" }],
            factsUpdate: [],
            factsDeprecate: [],
          },
        },
      })
    ).rejects.toThrow(FloorStateConflictError);

    const [floor] = await database.db.select().from(floors).where(eq(floors.id, floorId));
    expect(floor).toMatchObject({
      id: floorId,
      state: "draft",
      tokenIn: 0,
      tokenOut: 0,
      updatedAt: now,
    });

    const pages = await database.db.select().from(messagePages).where(eq(messagePages.floorId, floorId));
    const storedMessages = await database.db.select().from(messages);
    const legacyToolCallRows = await database.db.select().from(toolCallRecords);
    const promptSnapshotRows = await database.db.select().from(promptSnapshots);
    const branchLocalSnapshotRows = await database.db.select().from(branchLocalVariableSnapshots);
    const executedToolCallRows = await database.db.select().from(toolExecutionRecords);
    const memoryItemRows = await database.db.select().from(memoryItems);
    const memoryEdgeRows = await database.db.select().from(memoryEdges);
    const promotedFloorVariables = await database.db
      .select()
      .from(variables)
      .where(and(eq(variables.scope, "floor"), eq(variables.scopeId, floorId)));

    expect(pages).toEqual([
      expect.objectContaining({ id: pageId, floorId, pageKind: "input", pageNo: 0 })
    ]);
    expect(storedMessages).toEqual([]);
    expect(legacyToolCallRows).toEqual([]);
    expect(promptSnapshotRows).toEqual([]);
    expect(branchLocalSnapshotRows).toEqual([]);
    expect(executedToolCallRows).toEqual([]);
    expect(promotedFloorVariables).toEqual([]);
    expect(memoryItemRows).toEqual([]);
    expect(memoryEdgeRows).toEqual([]);

    const [structuredVariable] = await database.db.select().from(variables).where(
      and(eq(variables.scope, "branch"), eq(variables.scopeId, buildBranchVariableScopeId(sessionId, "main")), eq(variables.key, "资产")),
    );

    expect(structuredVariable).toBeUndefined();

    // Rolled-back turn commit must not publish any committed memory event.
    expect(memoryCreatedHandler).not.toHaveBeenCalled();
    expect(memoryUpdatedHandler).not.toHaveBeenCalled();
    expect(memoryDeprecatedHandler).not.toHaveBeenCalled();
    expect(memoryDeletedHandler).not.toHaveBeenCalled();
    expect(memoryEdgeCreatedHandler).not.toHaveBeenCalled();
    expect(memoryEdgeDeletedHandler).not.toHaveBeenCalled();
    expect(memoryConsolidatedHandler).not.toHaveBeenCalled();
    // Phase 1 语义：failed commit / rollback 不能发出任何 durable
    // variable.* 事件。
    expect(variableSetHandler).not.toHaveBeenCalled();
    expect(variableDeletedHandler).not.toHaveBeenCalled();
    expect(variablePromotedHandler).not.toHaveBeenCalled();
  });

  it("writes Project Events for committed turns and publishes them to the live hub after the transaction commits", async () => {
    const sessionId = `sess_${nanoid()}`;
    const floorId = `floor_${nanoid()}`;
    const pageId = `page_${nanoid()}`;
    const now = 1_735_690_000_000;
    const committedAt = now + 1_000;

    const scope = createTestSessionWithScope(database.db, {
      id: sessionId,
      accountId: DEFAULT_ACCOUNT_ID,
      now,
    });
    await seedFloor({ database, sessionId, floorId, state: "generating", now });
    await seedInputPage({ database, floorId, pageId, now });

    const liveHub = new ProjectEventLiveHub();
    const liveEvents: ProjectEventRecord[] = [];
    const unsubscribe = liveHub.subscribe(scope.projectId, (event) => {
      liveEvents.push(event);
    });

    const turnCommitService = new TurnCommitService(
      database.db,
      new ChatMessagePersistence(database.db, new SimpleTokenCounter()),
      eventBus,
      { projectEventLiveHub: liveHub },
    );

    const execution: TurnExecutionResult = {
      floorId,
      finalState: "generating",
      generatedText: "Assistant reply with promoted variable.",
      rawText: "Assistant reply with promoted variable.",
      summaries: [],
      totalUsage: {
        promptTokens: 3,
        completionTokens: 4,
        totalTokens: 7,
      },
      bufferedVariableMutations: [
        {
          runId: "run-live-hub-project-events",
          generationAttemptNo: 1,
          scope: "page",
          scopeId: pageId,
          key: "mood",
          value: "steady",
          intent: "promote_to_floor_on_accept",
          bufferedAt: now + 10,
        },
      ],
    };

    // No project events should be observed via the live hub before the
    // commit transaction returns control to the caller.
    expect(liveEvents).toEqual([]);

    await turnCommitService.commit({
      accountId: DEFAULT_ACCOUNT_ID,
      floorId,
      sessionId,
      execution,
      committedAt,
      variableCommit: { pageId },
    });

    unsubscribe();

    const persistedEvents = await database.db
      .select()
      .from(projectEvents)
      .where(eq(projectEvents.projectId, scope.projectId))
      .orderBy(projectEvents.sequence);

    const eventTypes = persistedEvents.map((row) => row.type);
    expect(eventTypes).toEqual(
      expect.arrayContaining([
        "floor.stateChanged",
        "floor.committed",
        "variable.set",
        "variable.promoted",
      ]),
    );

    for (const row of persistedEvents) {
      expect(row.workspaceId).toBe(scope.workspaceId);
      expect(row.projectId).toBe(scope.projectId);
      expect(row.sequence).toBeGreaterThan(0);
    }

    const liveTypes = liveEvents.map((event) => event.type);
    expect(liveTypes).toEqual(eventTypes);
    expect(liveEvents.map((event) => event.sequence)).toEqual(
      persistedEvents.map((row) => row.sequence),
    );

    const floorCommitted = persistedEvents.find((row) => row.type === "floor.committed");
    expect(floorCommitted).toBeDefined();
    expect(JSON.parse(floorCommitted!.payloadJson)).toMatchObject({
      floor_id: floorId,
      session_state_mutation_count: expect.any(Number),
      tool_execution_count: expect.any(Number),
    });
  });

  it("skips memory jobs, operation logs, and Project Events for temporary sessions", async () => {
    const sessionId = `sess_${nanoid()}`;
    const floorId = `floor_${nanoid()}`;
    const pageId = `page_${nanoid()}`;
    const now = 1_735_690_500_000;
    const committedAt = now + 1_000;

    const scope = createTestSessionWithScope(database.db, {
      id: sessionId,
      accountId: DEFAULT_ACCOUNT_ID,
      now,
    });
    await database.db
      .update(sessions)
      .set({
        kind: "temporary",
        visibility: "internal",
        retentionPolicy: "delete_on_finalize",
        temporarySourceSessionId: `source_${sessionId}`,
        temporarySnapshotDigest: `sha256:${sessionId}`,
      })
      .where(eq(sessions.id, sessionId));
    await seedFloor({ database, sessionId, floorId, state: "generating", now });
    await seedInputPage({ database, floorId, pageId, now });

    const liveHub = new ProjectEventLiveHub();
    const liveEvents: ProjectEventRecord[] = [];
    const unsubscribe = liveHub.subscribe(scope.projectId, (event) => {
      liveEvents.push(event);
    });

    const temporaryService = new TurnCommitService(
      database.db,
      new ChatMessagePersistence(database.db, new SimpleTokenCounter()),
      eventBus,
      {
        enableAsyncMemoryIngest: true,
        projectEventLiveHub: liveHub,
      },
    );

    const execution: TurnExecutionResult = {
      floorId,
      finalState: "generating",
      generatedText: "Temporary assistant reply.",
      rawText: "Temporary assistant reply.",
      summaries: ["temporary summary"],
      totalUsage: {
        promptTokens: 5,
        completionTokens: 6,
        totalTokens: 11,
      },
    };

    const result = await temporaryService.commit({
      accountId: DEFAULT_ACCOUNT_ID,
      floorId,
      sessionId,
      execution,
      committedAt,
      memoryCommit: {
        summaries: execution.summaries,
        enableConsolidation: true,
      },
      variableCommit: { pageId },
    });

    unsubscribe();

    expect(result.finalState).toBe("committed");
    expect(result.memory).toBeUndefined();

    const runtimeJobRows = await database.db
      .select()
      .from(runtimeJobs)
      .where(eq(runtimeJobs.floorId, floorId));
    expect(runtimeJobRows).toEqual([]);

    const persistedEvents = await database.db
      .select()
      .from(projectEvents)
      .where(eq(projectEvents.projectId, scope.projectId));
    expect(persistedEvents).toEqual([]);
    expect(liveEvents).toEqual([]);

    const floorCommitLogs = await database.db
      .select()
      .from(operationLogs)
      .where(and(
        eq(operationLogs.sessionId, sessionId),
        eq(operationLogs.action, "commit_floor"),
      ));
    expect(floorCommitLogs).toEqual([]);
  });

  it("does not write Project Events or publish to the live hub when the commit transaction rolls back", async () => {
    const sessionId = `sess_${nanoid()}`;
    const floorId = `floor_${nanoid()}`;
    const pageId = `page_${nanoid()}`;
    const now = 1_735_691_000_000;
    const committedAt = now + 1_000;

    const scope = createTestSessionWithScope(database.db, {
      id: sessionId,
      accountId: DEFAULT_ACCOUNT_ID,
      now,
    });
    // Floor seeded in committed state -> FloorStateConflictError on commit.
    await seedFloor({ database, sessionId, floorId, state: "committed", now });
    await seedInputPage({ database, floorId, pageId, now });

    const liveHub = new ProjectEventLiveHub();
    const liveEvents: ProjectEventRecord[] = [];
    const unsubscribe = liveHub.subscribe(scope.projectId, (event) => {
      liveEvents.push(event);
    });

    const turnCommitService = new TurnCommitService(
      database.db,
      new ChatMessagePersistence(database.db, new SimpleTokenCounter()),
      eventBus,
      { projectEventLiveHub: liveHub },
    );

    const execution: TurnExecutionResult = {
      floorId,
      finalState: "generating",
      generatedText: "Should not commit.",
      rawText: "Should not commit.",
      summaries: [],
      totalUsage: {
        promptTokens: 1,
        completionTokens: 1,
        totalTokens: 2,
      },
    };

    await expect(
      turnCommitService.commit({
        accountId: DEFAULT_ACCOUNT_ID,
        floorId,
        sessionId,
        execution,
        committedAt,
        variableCommit: { pageId },
      }),
    ).rejects.toBeInstanceOf(FloorStateConflictError);

    unsubscribe();

    const rolledBack = await database.db
      .select()
      .from(projectEvents)
      .where(eq(projectEvents.projectId, scope.projectId));
    expect(rolledBack).toEqual([]);
    expect(liveEvents).toEqual([]);
  });

});
