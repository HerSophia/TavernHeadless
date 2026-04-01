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
  floors,
  memoryEdges,
  memoryItems,
  runtimeJobs,
  messagePages,
  messages,
  promptSnapshots,
  sessions,
  toolCallRecords,
  toolExecutionRecords,
  variables,
} from "../../db/schema.js";
import { ChatMessagePersistence } from "../chat-message-persistence.js";
import { TurnCommitService } from "../turn-commit-service.js";
import {
  MEMORY_RUNTIME_SCOPE_TYPE,
  buildMemoryRuntimeScopeKey,
  toMemoryRuntimeJobType,
} from "../memory-runtime-job-definitions.js";
import { createToolRuntimeJobBridge } from "../tool-runtime-job-bridge.js";

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
  scope: "global" | "chat" | "floor" | "page";
  scopeId: string;
  key: string;
  value: unknown;
  now: number;
}): Promise<void> {
  await args.database.db.insert(variables).values({
    id: nanoid(),
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
      worldbookActivatedEntryUids: [101, 202],
      regexPreRuleNames: ["trim-input"],
      regexPostRuleNames: ["strip-ooc"],
      promptMode: "native",
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
      .where(eq(toolCallRecords.id, legacyToolCalls[0]!.id));
    expect(legacyToolCall).toMatchObject({
      id: legacyToolCalls[0]!.id,
      pageId: result.outputPageId,
      seq: 1,
      callerSlot: "narrator",
      toolName: "lookup_fact",
      status: "success",
      durationMs: 17,
      createdAt: committedAt,
    });

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
    expect(await database.db.select().from(memoryItems)).toEqual([]);

    const [job] = await database.db.select().from(runtimeJobs).where(eq(runtimeJobs.floorId, floorId));
    expect(job).toMatchObject({
      id: `memory-job:ingest_turn:${floorId}`,
      jobType: toMemoryRuntimeJobType("ingest_turn"),
      accountId: DEFAULT_ACCOUNT_ID,
      scopeType: MEMORY_RUNTIME_SCOPE_TYPE,
      scopeKey: buildMemoryRuntimeScopeKey("chat", sessionId),
      status: "pending",
      floorId,
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
      enableConsolidation: true,
    }));
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


  it("flushes buffered tool variable mutations before page-to-floor promotion", async () => {
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
          key: "mood",
          value: "hopeful",
          bufferedAt: now + 10,
        },
      ],
    };

    await service.commit({
      accountId: DEFAULT_ACCOUNT_ID,
      floorId,
      sessionId,
      execution,
      committedAt,
      variableCommit: { pageId },
    });

    const [pageVariable] = await database.db.select().from(variables).where(
      and(eq(variables.scope, "page"), eq(variables.scopeId, pageId), eq(variables.key, "mood")),
    );
    expect(pageVariable).toMatchObject({
      scope: "page",
      scopeId: pageId,
      key: "mood",
      updatedAt: committedAt,
    });
    expect(pageVariable && JSON.parse(pageVariable.valueJson)).toBe("hopeful");

    const [floorVariable] = await database.db.select().from(variables).where(
      and(eq(variables.scope, "floor"), eq(variables.scopeId, floorId), eq(variables.key, "mood")),
    );
    expect(floorVariable).toMatchObject({
      scope: "floor",
      scopeId: floorId,
      key: "mood",
      updatedAt: committedAt,
    });
    expect(floorVariable && JSON.parse(floorVariable.valueJson)).toBe("hopeful");
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

  it("promotes page variables to floor inside the commit boundary", async () => {
    const sessionId = nanoid();
    const floorId = nanoid();
    const pageId = nanoid();
    const now = 1_735_689_900_000;
    const committedAt = now + 1_000;

    await seedSession(database, sessionId, now);
    await seedFloor({ database, sessionId, floorId, state: "generating", now });
    await seedInputPage({ database, floorId, pageId, now });
    await seedVariable({ database, scope: "page", scopeId: pageId, key: "mood", value: "steady", now });
    await seedVariable({ database, scope: "page", scopeId: pageId, key: "hp", value: 95, now });

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
        key: "mood",
        fromScope: "page",
        toScope: "floor",
        value: "steady",
      })
    );
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
    expect(executedToolCallRows).toEqual([]);
    expect(promotedFloorVariables).toEqual([]);
    expect(memoryItemRows).toEqual([]);
    expect(memoryEdgeRows).toEqual([]);
  });
});
