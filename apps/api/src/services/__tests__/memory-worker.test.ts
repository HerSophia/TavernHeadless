import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { buildBranchMemoryScopeId } from "@tavern/shared";
import {
  MemoryStore,
  SimpleTokenCounter,
  createEventBus,
  type MemoryCompactionOutput,
  type MemoryCompactionProcessor,
  type MemoryIngestOutput,
  type MemoryIngestProcessor,
} from "@tavern/core";

import { DrizzleMemoryRepository } from "../../adapters/drizzle-memory-repository.js";
import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import {
  accounts,
  floors,
  memoryEdges,
  memoryItems,
  messagePages,
  messages,
  runtimeJobs,
  runtimeScopeStates,
  sessions,
} from "../../db/schema.js";
import { MemoryJobScheduler } from "../memory-job-scheduler.js";
import { MemoryWorker } from "../memory-worker.js";
import { createUserInputDigest } from "../memory-job-utils.js";
import {
  MEMORY_RUNTIME_SCOPE_TYPE,
  buildMemoryRuntimeScopeKey,
  fromMemoryRuntimeJobType,
  parseMemoryRuntimeScopeKey,
  readMemoryRuntimeScopeMetadata,
  toMemoryRuntimeJobType,
} from "../memory-runtime-job-definitions.js";

const DEFAULT_ACCOUNT_ID = "default-admin";

function mainBranchMemoryScopeId(sessionId: string): string {
  return buildBranchMemoryScopeId(sessionId, "main");
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function toLegacyMemoryJob(row: typeof runtimeJobs.$inferSelect) {
  const scopeRef = parseMemoryRuntimeScopeKey(row.scopeKey);
  return {
    ...row,
    scope: scopeRef.scope,
    scopeId: scopeRef.scopeId,
    jobType: fromMemoryRuntimeJobType(row.jobType),
  };
}

function toLegacyMemoryScopeState(row: typeof runtimeScopeStates.$inferSelect) {
  const scopeRef = parseMemoryRuntimeScopeKey(row.scopeKey);
  const metadata = readMemoryRuntimeScopeMetadata(row.metadataJson);
  return {
    ...row,
    scope: scopeRef.scope,
    scopeId: scopeRef.scopeId,
    lastProcessedFloorNo: metadata.lastProcessedFloorNo ?? null,
    lastCompactionAt: metadata.lastCompactionAt ?? null,
  };
}

async function getRuntimeMemoryScopeState(
  database: DatabaseConnection,
  scope: "global" | "chat" | "branch" | "floor",
  scopeId: string,
) {
  const [row] = await database.db.select().from(runtimeScopeStates).where(and(
    eq(runtimeScopeStates.accountId, DEFAULT_ACCOUNT_ID),
    eq(runtimeScopeStates.scopeType, MEMORY_RUNTIME_SCOPE_TYPE),
    eq(runtimeScopeStates.scopeKey, buildMemoryRuntimeScopeKey(scope, scopeId)),
  ));
  return row ? toLegacyMemoryScopeState(row) : undefined;
}

async function getRuntimeMemoryJobs(database: DatabaseConnection, jobType?: "ingest_turn" | "compact_macro" | "maintenance" | "rebuild_scope") {
  const rows = jobType === undefined
    ? await database.db.select().from(runtimeJobs).where(eq(runtimeJobs.scopeType, MEMORY_RUNTIME_SCOPE_TYPE))
    : await database.db.select().from(runtimeJobs).where(and(eq(runtimeJobs.scopeType, MEMORY_RUNTIME_SCOPE_TYPE), eq(runtimeJobs.jobType, toMemoryRuntimeJobType(jobType))));
  return rows.map(toLegacyMemoryJob);
}

function makeIngestOutput(overrides: Partial<MemoryIngestOutput> = {}): MemoryIngestOutput {
  return {
    microSummary: "Default micro summary",
    factsAdd: [],
    factsUpdate: [],
    factsDeprecate: [],
    openLoopsAdd: [],
    openLoopsResolve: [],
    ...overrides,
  };
}

function makeCompactionOutput(overrides: Partial<MemoryCompactionOutput> = {}): MemoryCompactionOutput {
  return {
    macroSummary: "Default macro summary",
    factsAdd: [],
    factsUpdate: [],
    factsDeprecate: [],
    openLoopsAdd: [],
    openLoopsResolve: [],
    sourceMicroIds: [],
    ...overrides,
  };
}

function createNoopCompactionProcessor(): MemoryCompactionProcessor {
  return {
    process: vi.fn(async () => ({
      output: makeCompactionOutput(),
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    })),
  } as unknown as MemoryCompactionProcessor;
}

async function seedAccount(database: DatabaseConnection, accountId: string, now: number): Promise<void> {
  await database.db.insert(accounts).values({
    id: accountId,
    name: accountId,
    createdAt: now,
    updatedAt: now,
  })
    .onConflictDoNothing()
    .run();
}

async function seedSession(database: DatabaseConnection, sessionId: string, now: number, accountId = DEFAULT_ACCOUNT_ID): Promise<void> {
  await database.db.insert(sessions).values({
    id: sessionId,
    title: "Memory Worker Test",
    accountId,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
}

async function seedCommittedFloorConversation(args: {
  database: DatabaseConnection;
  sessionId: string;
  floorId: string;
  floorNo: number;
  now: number;
  userMessage: string;
  assistantMessage: string;
}): Promise<{
  inputPageId: string;
  userMessageId: string;
  outputPageId: string;
  assistantMessageId: string;
}> {
  const inputPageId = nanoid();
  const userMessageId = nanoid();
  const outputPageId = nanoid();
  const assistantMessageId = nanoid();

  await args.database.db.insert(floors).values({
    id: args.floorId,
    sessionId: args.sessionId,
    floorNo: args.floorNo,
    branchId: "main",
    parentFloorId: null,
    state: "committed",
    tokenIn: 0,
    tokenOut: 0,
    createdAt: args.now,
    updatedAt: args.now,
  });

  await args.database.db.insert(messagePages).values([
    {
      id: inputPageId,
      floorId: args.floorId,
      pageNo: 0,
      pageKind: "input",
      isActive: true,
      version: 1,
      checksum: null,
      createdAt: args.now,
      updatedAt: args.now,
    },
    {
      id: outputPageId,
      floorId: args.floorId,
      pageNo: 1,
      pageKind: "output",
      isActive: true,
      version: 1,
      checksum: null,
      createdAt: args.now,
      updatedAt: args.now,
    },
  ]);

  await args.database.db.insert(messages).values([
    {
      id: userMessageId,
      pageId: inputPageId,
      seq: 0,
      role: "user",
      content: args.userMessage,
      contentFormat: "text",
      tokenCount: args.userMessage.length,
      isHidden: false,
      source: "api",
      createdAt: args.now,
    },
    {
      id: assistantMessageId,
      pageId: outputPageId,
      seq: 0,
      role: "assistant",
      content: args.assistantMessage,
      contentFormat: "text",
      tokenCount: args.assistantMessage.length,
      isHidden: false,
      source: "api",
      createdAt: args.now,
    },
  ]);

  return { inputPageId, userMessageId, outputPageId, assistantMessageId };
}

describe("MemoryWorker", () => {
  let database: DatabaseConnection;
  let eventBus: ReturnType<typeof createEventBus>;
  let memoryStore: MemoryStore;
  let jobScheduler: MemoryJobScheduler;

  beforeEach(() => {
    database = createDatabase(":memory:");
    eventBus = createEventBus();
    memoryStore = new MemoryStore(
      new DrizzleMemoryRepository(database.db),
      eventBus,
      new SimpleTokenCounter(),
    );
    jobScheduler = new MemoryJobScheduler();
  });

  afterEach(() => {
    database.close();
  });

  it("processes ingest_turn jobs with micro summaries, facts, and scope revision CAS", async () => {
    const now = 1_735_700_000_000;
    const sessionId = nanoid();
    const floorId = nanoid();
    const userMessage = "Alice asks whether Bob still has the vault key.";
    const assistantMessage = "Bob admits that he never gave the key away.";

    await seedAccount(database, DEFAULT_ACCOUNT_ID, now);
    await seedSession(database, sessionId, now);
    const conversation = await seedCommittedFloorConversation({
      database,
      sessionId,
      floorId,
      floorNo: 3,
      now,
      userMessage,
      assistantMessage,
    });

    await database.db.insert(memoryItems).values([
      {
        id: nanoid(),
        accountId: DEFAULT_ACCOUNT_ID,
        scope: "branch",
        scopeId: mainBranchMemoryScopeId(sessionId),
        type: "summary",
        summaryTier: "micro",
        contentJson: JSON.stringify("Alice had started to distrust Bob."),
        importance: 0.6,
        confidence: 1,
        status: "active",
        lifecycleStatus: "active",
        sourceFloorId: "seed-floor",
        sourceMessageId: null,
        createdAt: now - 2_000,
        updatedAt: now - 2_000,
      },
      {
        id: nanoid(),
        accountId: DEFAULT_ACCOUNT_ID,
        scope: "branch",
        scopeId: mainBranchMemoryScopeId(sessionId),
        type: "fact",
        contentJson: JSON.stringify("vault_key_owner: unknown"),
        factKey: "vault_key_owner",
        importance: 0.7,
        confidence: 1,
        status: "active",
        lifecycleStatus: "active",
        sourceFloorId: "seed-floor",
        sourceMessageId: null,
        createdAt: now - 2_000,
        updatedAt: now - 2_000,
      },
    ]);

    database.db.transaction((tx) => {
      jobScheduler.enqueueIngestTurn(tx, {
        accountId: DEFAULT_ACCOUNT_ID,
        sessionId,
        branchId: "main",
        floorId,
        floorNo: 3,
        assistantMessageId: conversation.assistantMessageId,
        userInputDigest: createUserInputDigest(userMessage),
        committedAt: now + 1_000,
        summaries: ["Alice confirms Bob still has the key."],
        enableConsolidation: true,
      });
    });

    const process = vi.fn(async () => ({
      output: makeIngestOutput({
        microSummary: "Alice confirms that Bob still keeps the vault key.",
        factsAdd: [{ factKey: "vault_key_owner", value: "Bob still holds the vault key.", importance: 0.8 }],
      }),
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    }));
    const memoryIngestProcessor = { process } as unknown as MemoryIngestProcessor;
    const memoryCreatedHandler = vi.fn();
    const memoryConsolidatedHandler = vi.fn();
    eventBus.on("memory.created", memoryCreatedHandler);
    eventBus.on("memory.consolidated", memoryConsolidatedHandler);

    const worker = new MemoryWorker(
      database.db,
      memoryStore,
      memoryIngestProcessor,
      createNoopCompactionProcessor(),
      eventBus,
      {
      workerId: "worker-1",
      leaseTtlMs: 5_000,
      },
    );

    await expect(worker.processOneDueJob()).resolves.toBe(true);

    expect(process).toHaveBeenCalledOnce();
    expect(process).toHaveBeenCalledWith(expect.objectContaining({
      currentFloorContent: `User:\n${userMessage}\n\nAssistant:\n${assistantMessage}`,
      extractedSummaries: ["Alice confirms Bob still has the key."],
      recentSummaries: [expect.objectContaining({ content: "Alice had started to distrust Bob." })],
      existingFacts: [expect.objectContaining({ factKey: "vault_key_owner", content: "vault_key_owner: unknown" })],
      existingOpenLoops: [],
      scope: "branch",
      scopeId: mainBranchMemoryScopeId(sessionId),
      sourceFloorId: floorId,
    }));

    const createdRows = await database.db
      .select()
      .from(memoryItems)
      .where(and(eq(memoryItems.accountId, DEFAULT_ACCOUNT_ID), eq(memoryItems.sourceFloorId, floorId)));

    expect(createdRows).toHaveLength(2);
    const summaryRow = createdRows.find((row) => row.type === "summary");
    const factRow = createdRows.find((row) => row.type === "fact");
    expect(summaryRow).toMatchObject({
      scope: "branch",
      scopeId: mainBranchMemoryScopeId(sessionId),
      type: "summary",
      summaryTier: "micro",
      lifecycleStatus: "active",
      sourceJobId: `memory-job:ingest_turn:${floorId}`,
      coverageStartFloorNo: 3,
      coverageEndFloorNo: 3,
    });
    expect(JSON.parse(summaryRow!.contentJson)).toBe("Alice confirms that Bob still keeps the vault key.");
    expect(summaryRow!.tokenCountEstimate).toBeGreaterThan(0);
    expect(factRow).toMatchObject({
      scope: "branch",
      scopeId: mainBranchMemoryScopeId(sessionId),
      type: "fact",
      factKey: "vault_key_owner",
      lifecycleStatus: "active",
      sourceJobId: `memory-job:ingest_turn:${floorId}`,
    });
    expect(JSON.parse(factRow!.contentJson)).toBe("vault_key_owner: Bob still holds the vault key.");

    const scopeState = await getRuntimeMemoryScopeState(database, "branch", mainBranchMemoryScopeId(sessionId));
    expect(scopeState).toMatchObject({
      accountId: DEFAULT_ACCOUNT_ID,
      scope: "branch",
      scopeId: mainBranchMemoryScopeId(sessionId),
      revision: 1,
      leaseOwner: null,
      leaseUntil: null,
      lastProcessedFloorNo: 3,
    });

    const [job] = await getRuntimeMemoryJobs(database);
    expect(job).toMatchObject({
      status: "succeeded",
      scope: "branch",
      scopeId: mainBranchMemoryScopeId(sessionId),
      floorId,
      basedOnRevision: 0,
      attemptCount: 1,
      leaseOwner: null,
      leaseUntil: null,
    });

    expect(memoryCreatedHandler).toHaveBeenCalledTimes(2);
    expect(memoryCreatedHandler).toHaveBeenCalledWith(expect.objectContaining({
      sessionId,
      scope: "branch",
      scopeId: mainBranchMemoryScopeId(sessionId),
      floorId,
      sourceJobId: `memory-job:ingest_turn:${floorId}`,
    }));
    // Committed event contract: runtime ingest path must carry the normalized
    // payload fields too (mutationId / accountId / branchId / entityType / entityId / after / source).
    expect(memoryCreatedHandler).toHaveBeenCalledWith(expect.objectContaining({
      accountId: DEFAULT_ACCOUNT_ID,
      branchId: "main",
      entityType: "memory_item",
      entityId: expect.any(String),
      mutationId: expect.any(String),
      source: "consolidation",
      after: expect.objectContaining({ id: expect.any(String) }),
    }));
    expect(memoryConsolidatedHandler).toHaveBeenCalledOnce();
    expect(memoryConsolidatedHandler).toHaveBeenCalledWith(expect.objectContaining({
      sessionId,
      scope: "branch",
      scopeId: mainBranchMemoryScopeId(sessionId),
      floorId,
      sourceJobId: `memory-job:ingest_turn:${floorId}`,
      jobType: "ingest_turn",
    }));
  });

  it("enqueues compact_macro jobs after ingest_turn when macro compaction is enabled and thresholds are met", async () => {
    const now = 1_735_700_025_000;
    const sessionId = nanoid();
    const floorId = nanoid();
    const userMessage = "Alice asks whether the archive trail is still viable.";
    const assistantMessage = "Bob confirms the trail is intact and points toward the lower district.";

    await seedAccount(database, DEFAULT_ACCOUNT_ID, now);
    await seedSession(database, sessionId, now);
    const conversation = await seedCommittedFloorConversation({
      database,
      sessionId,
      floorId,
      floorNo: 12,
      now,
      userMessage,
      assistantMessage,
    });

    const seededMicroIds = Array.from({ length: 11 }, (_, index) => `micro-${index + 1}`);
    await database.db.insert(memoryItems).values(
      seededMicroIds.map((id, index) => ({
        id,
        accountId: DEFAULT_ACCOUNT_ID,
        scope: "branch" as const,
        scopeId: mainBranchMemoryScopeId(sessionId),
        type: "summary" as const,
        summaryTier: "micro" as const,
        contentJson: JSON.stringify(`Historical micro summary ${index + 1}`),
        importance: 0.6,
        confidence: 1,
        status: "active" as const,
        lifecycleStatus: "active" as const,
        tokenCountEstimate: 60,
        coverageStartFloorNo: index + 1,
        coverageEndFloorNo: index + 1,
        sourceFloorId: `seed-floor-${index + 1}`,
        sourceMessageId: null,
        createdAt: now - (20_000 - index),
        updatedAt: now - (20_000 - index),
      })),
    );

    database.db.transaction((tx) => {
      jobScheduler.enqueueIngestTurn(tx, {
        accountId: DEFAULT_ACCOUNT_ID,
        sessionId,
        branchId: "main",
        floorId,
        floorNo: 12,
        assistantMessageId: conversation.assistantMessageId,
        userInputDigest: createUserInputDigest(userMessage),
        committedAt: now,
        summaries: ["The archive trail remains active."],
        enableConsolidation: true,
      });
    });

    const memoryIngestProcessor = {
      process: vi.fn(async () => ({
        output: makeIngestOutput({ microSummary: "Bob confirms the archive trail remains active." }),
        usage: { promptTokens: 4, completionTokens: 6, totalTokens: 10 },
      })),
    } as unknown as MemoryIngestProcessor;
    const worker = new MemoryWorker(
      database.db,
      memoryStore,
      memoryIngestProcessor,
      createNoopCompactionProcessor(),
      eventBus,
      {
        workerId: "worker-compact-enqueue",
        leaseTtlMs: 5_000,
        enableMacroCompaction: true,
      },
    );

    await expect(worker.processOneDueJob()).resolves.toBe(true);

    const compactJobs = await getRuntimeMemoryJobs(database, "compact_macro");
    expect(compactJobs).toHaveLength(1);
    expect(compactJobs[0]).toMatchObject({
      accountId: DEFAULT_ACCOUNT_ID,
      scope: "branch",
      scopeId: mainBranchMemoryScopeId(sessionId),
      status: "pending",
    });

    const compactPayload = jobScheduler.parseCompactMacroPayload(compactJobs[0]!);
    expect(compactPayload.sourceMicroIds).toEqual([
      "micro-1",
      "micro-2",
      "micro-3",
      "micro-4",
      "micro-5",
      "micro-6",
      "micro-7",
      "micro-8",
    ]);
    expect(compactPayload.coverageStartFloorNo).toBe(1);
    expect(compactPayload.coverageEndFloorNo).toBe(8);
    expect(compactPayload.triggerFloorId).toBe(floorId);
  });

  it("writes open loop add and resolve mutations with resolves edges", async () => {
    const now = 1_735_700_050_000;
    const sessionId = nanoid();
    const floorId = nanoid();
    const userMessage = "Alice asks why Bob hid the letter.";
    const assistantMessage = "Bob admits that he hid it to protect Alice from panic.";
    const resolvedOpenLoopId = nanoid();

    await seedAccount(database, DEFAULT_ACCOUNT_ID, now);
    await seedSession(database, sessionId, now);
    const conversation = await seedCommittedFloorConversation({
      database,
      sessionId,
      floorId,
      floorNo: 4,
      now,
      userMessage,
      assistantMessage,
    });

    await database.db.insert(memoryItems).values({
      id: resolvedOpenLoopId,
      accountId: DEFAULT_ACCOUNT_ID,
      scope: "branch",
      scopeId: mainBranchMemoryScopeId(sessionId),
      type: "open_loop",
      contentJson: JSON.stringify("Why did Bob hide the letter?"),
      importance: 0.8,
      confidence: 1,
      status: "active",
      lifecycleStatus: "active",
      sourceFloorId: "seed-floor",
      sourceMessageId: null,
      createdAt: now - 5_000,
      updatedAt: now - 5_000,
    });

    database.db.transaction((tx) => {
      jobScheduler.enqueueIngestTurn(tx, {
        accountId: DEFAULT_ACCOUNT_ID,
        sessionId,
        branchId: "main",
        floorId,
        floorNo: 4,
        assistantMessageId: conversation.assistantMessageId,
        userInputDigest: createUserInputDigest(userMessage),
        committedAt: now,
        summaries: [],
        enableConsolidation: false,
      });
    });

    const process = vi.fn(async () => ({
      output: makeIngestOutput({
        microSummary: "Bob explains why he hid the letter, but his full plan remains unclear.",
        openLoopsAdd: [{ content: "What else Bob is still hiding remains unresolved.", importance: 0.65 }],
        openLoopsResolve: [{ id: resolvedOpenLoopId, resolution: "Bob admits he hid the letter to protect Alice." }],
      }),
      usage: { promptTokens: 8, completionTokens: 12, totalTokens: 20 },
    }));
    const memoryIngestProcessor = { process } as unknown as MemoryIngestProcessor;
    const worker = new MemoryWorker(
      database.db,
      memoryStore,
      memoryIngestProcessor,
      createNoopCompactionProcessor(),
      eventBus,
      {
      workerId: "worker-open-loop",
      leaseTtlMs: 5_000,
      },
    );

    await expect(worker.processOneDueJob()).resolves.toBe(true);

    expect(process).toHaveBeenCalledOnce();

    const resolvedRow = await database.db
      .select()
      .from(memoryItems)
      .where(eq(memoryItems.id, resolvedOpenLoopId));
    expect(resolvedRow[0]).toMatchObject({
      id: resolvedOpenLoopId,
      status: "deprecated",
      lifecycleStatus: "deprecated",
    });

    const createdRows = await database.db
      .select()
      .from(memoryItems)
      .where(and(eq(memoryItems.accountId, DEFAULT_ACCOUNT_ID), eq(memoryItems.sourceFloorId, floorId)));
    const summaryRow = createdRows.find((row) => row.type === "summary");
    const openLoopRow = createdRows.find((row) => row.type === "open_loop");
    expect(summaryRow).toBeDefined();
    expect(openLoopRow).toMatchObject({
      type: "open_loop",
      status: "active",
      lifecycleStatus: "active",
      sourceJobId: `memory-job:ingest_turn:${floorId}`,
    });
    expect(JSON.parse(openLoopRow!.contentJson)).toBe("What else Bob is still hiding remains unresolved.");

    const edges = await database.db.select().from(memoryEdges).where(eq(memoryEdges.accountId, DEFAULT_ACCOUNT_ID));
    expect(edges).toEqual([
      expect.objectContaining({
        fromId: summaryRow!.id,
        toId: resolvedOpenLoopId,
        relation: "resolves",
      }),
    ]);
  });

  it("processes compact_macro jobs with macro summaries, lifecycle compaction, and derived edges", async () => {
    const now = 1_735_700_075_000;
    const sessionId = nanoid();
    const resolvedOpenLoopId = nanoid();
    const sourceMicroIds = [nanoid(), nanoid(), nanoid()];
    const previousMacroId = nanoid();

    await seedAccount(database, DEFAULT_ACCOUNT_ID, now);
    await seedSession(database, sessionId, now);
    await database.db.insert(memoryItems).values({
      id: previousMacroId,
      accountId: DEFAULT_ACCOUNT_ID,
      scope: "chat",
      scopeId: sessionId,
      type: "summary",
      summaryTier: "macro",
      contentJson: JSON.stringify("Earlier macro summary."),
      importance: 0.6,
      confidence: 1,
      status: "active",
      lifecycleStatus: "active",
      coverageStartFloorNo: 1,
      coverageEndFloorNo: 3,
      createdAt: now - 10_000,
      updatedAt: now - 10_000,
    });
    await database.db.insert(memoryItems).values(
      sourceMicroIds.map((id, index) => ({
        id,
        accountId: DEFAULT_ACCOUNT_ID,
        scope: "chat" as const,
        scopeId: sessionId,
        type: "summary" as const,
        summaryTier: "micro" as const,
        contentJson: JSON.stringify(`Source micro summary ${index + 1}`),
        importance: 0.6,
        confidence: 1,
        status: "active" as const,
        lifecycleStatus: "active" as const,
        tokenCountEstimate: 70,
        coverageStartFloorNo: index + 4,
        coverageEndFloorNo: index + 4,
        sourceFloorId: `micro-floor-${index + 4}`,
        sourceMessageId: null,
        createdAt: now - (5_000 - index),
        updatedAt: now - (5_000 - index),
      })),
    );
    await database.db.insert(memoryItems).values({
      id: resolvedOpenLoopId,
      accountId: DEFAULT_ACCOUNT_ID,
      scope: "chat",
      scopeId: sessionId,
      type: "open_loop",
      contentJson: JSON.stringify("Will Alice trust the guide?"),
      importance: 0.7,
      confidence: 1,
      status: "active",
      lifecycleStatus: "active",
      createdAt: now - 2_000,
      updatedAt: now - 2_000,
    });

    database.db.transaction((tx) => {
      jobScheduler.enqueueCompactMacro(tx, {
        accountId: DEFAULT_ACCOUNT_ID,
        scope: "chat",
        scopeId: sessionId,
        sessionId,
        sourceMicroIds,
        coverageStartFloorNo: 4,
        coverageEndFloorNo: 6,
        committedAt: now,
        force: false,
      });
    });

    const process = vi.fn(async () => ({
      output: makeCompactionOutput({
        macroSummary: "Alice and Bob advanced together through the archive trail, but the guide still remains uncertain.",
        openLoopsResolve: [{ id: resolvedOpenLoopId, resolution: "The guide remains uncertain, not resolved by trust." }],
        sourceMicroIds,
      }),
      usage: { promptTokens: 6, completionTokens: 9, totalTokens: 15 },
    }));
    const memoryCompactionProcessor = { process } as unknown as MemoryCompactionProcessor;
    const memoryConsolidatedHandler = vi.fn();
    eventBus.on("memory.consolidated", memoryConsolidatedHandler);
    const worker = new MemoryWorker(
      database.db,
      memoryStore,
      { process: vi.fn() } as unknown as MemoryIngestProcessor,
      memoryCompactionProcessor,
      eventBus,
      {
        workerId: "worker-compact-run",
        leaseTtlMs: 5_000,
        enableMacroCompaction: true,
      },
    );

    await expect(worker.processOneDueJob()).resolves.toBe(true);

    expect(process).toHaveBeenCalledOnce();
    expect(process).toHaveBeenCalledWith(expect.objectContaining({
      latestMacroSummary: expect.objectContaining({ id: previousMacroId }),
      sourceMicroSummaries: expect.arrayContaining(sourceMicroIds.map((id) => expect.objectContaining({ id }))),
      existingOpenLoops: [expect.objectContaining({ id: resolvedOpenLoopId })],
    }));

    const allRows = await database.db
      .select()
      .from(memoryItems)
      .where(and(eq(memoryItems.accountId, DEFAULT_ACCOUNT_ID), eq(memoryItems.scopeId, sessionId)));
    const macroRows = allRows.filter((row) => row.type === "summary" && row.summaryTier === "macro");
    expect(macroRows).toHaveLength(2);
    const createdMacroRow = macroRows.find((row) => row.id !== previousMacroId)!;
    expect(createdMacroRow).toMatchObject({
      type: "summary",
      summaryTier: "macro",
      lifecycleStatus: "active",
      sourceJobId: `memory-job:compact_macro:${sessionId}:${sourceMicroIds[2]}`,
      coverageStartFloorNo: 4,
      coverageEndFloorNo: 6,
      derivedFromCount: 3,
    });
    expect(JSON.parse(createdMacroRow.contentJson)).toBe(
      "Alice and Bob advanced together through the archive trail, but the guide still remains uncertain.",
    );

    const compactedSourceRows = allRows.filter((row) => sourceMicroIds.includes(row.id));
    expect(compactedSourceRows.every((row) => row.status === "active" && row.lifecycleStatus === "compacted")).toBe(true);

    const resolvedLoopRow = allRows.find((row) => row.id === resolvedOpenLoopId)!;
    expect(resolvedLoopRow).toMatchObject({
      status: "deprecated",
      lifecycleStatus: "deprecated",
    });

    const edges = await database.db.select().from(memoryEdges).where(eq(memoryEdges.accountId, DEFAULT_ACCOUNT_ID));
    expect(edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ fromId: createdMacroRow.id, toId: sourceMicroIds[0], relation: "compacts" }),
      expect.objectContaining({ fromId: createdMacroRow.id, toId: sourceMicroIds[0], relation: "derived_from" }),
      expect.objectContaining({ fromId: createdMacroRow.id, toId: sourceMicroIds[1], relation: "compacts" }),
      expect.objectContaining({ fromId: createdMacroRow.id, toId: sourceMicroIds[1], relation: "derived_from" }),
      expect.objectContaining({ fromId: createdMacroRow.id, toId: sourceMicroIds[2], relation: "compacts" }),
      expect.objectContaining({ fromId: createdMacroRow.id, toId: sourceMicroIds[2], relation: "derived_from" }),
      expect.objectContaining({ fromId: createdMacroRow.id, toId: resolvedOpenLoopId, relation: "resolves" }),
    ]));

    const scopeState = await getRuntimeMemoryScopeState(database, "chat", sessionId);
    expect(scopeState?.revision).toBe(1);
    expect(scopeState?.lastCompactionAt).not.toBeNull();

    const compactJob = await getRuntimeMemoryJobs(database, "compact_macro");
    expect(compactJob[0]).toMatchObject({
      status: "succeeded",
      attemptCount: 1,
      leaseOwner: null,
      leaseUntil: null,
    });
    expect(memoryConsolidatedHandler).toHaveBeenCalledOnce();
    expect(memoryConsolidatedHandler).toHaveBeenCalledWith(expect.objectContaining({
      sessionId,
      scope: "chat",
      scopeId: sessionId,
      sourceJobId: `memory-job:compact_macro:${sessionId}:${sourceMicroIds[2]}`,
      jobType: "compact_macro",
    }));
  });

  it("processes compact_macro jobs for floor scopes without chat-only context leakage", async () => {
    const now = 1_735_700_090_000;
    const sessionId = nanoid();
    const floorId = nanoid();
    const floorOpenLoopId = nanoid();
    const chatOpenLoopId = nanoid();
    const sourceMicroIds = [nanoid(), nanoid(), nanoid()];

    await seedAccount(database, DEFAULT_ACCOUNT_ID, now);
    await seedSession(database, sessionId, now);
    await database.db.insert(memoryItems).values(
      sourceMicroIds.map((id, index) => ({
        id,
        accountId: DEFAULT_ACCOUNT_ID,
        scope: "floor" as const,
        scopeId: floorId,
        type: "summary" as const,
        summaryTier: "micro" as const,
        contentJson: JSON.stringify(`Floor micro summary ${index + 1}`),
        importance: 0.6,
        confidence: 1,
        status: "active" as const,
        lifecycleStatus: "active" as const,
        tokenCountEstimate: 50,
        coverageStartFloorNo: index + 8,
        coverageEndFloorNo: index + 8,
        sourceFloorId: floorId,
        sourceMessageId: null,
        createdAt: now - (3_000 - index),
        updatedAt: now - (3_000 - index),
      })),
    );
    await database.db.insert(memoryItems).values([
      {
        id: floorOpenLoopId,
        accountId: DEFAULT_ACCOUNT_ID,
        scope: "floor",
        scopeId: floorId,
        type: "open_loop",
        contentJson: JSON.stringify("What happened on this floor remains unresolved."),
        importance: 0.7,
        confidence: 1,
        status: "active",
        lifecycleStatus: "active",
        sourceFloorId: floorId,
        sourceMessageId: null,
        createdAt: now - 1_500,
        updatedAt: now - 1_500,
      },
      {
        id: chatOpenLoopId,
        accountId: DEFAULT_ACCOUNT_ID,
        scope: "chat",
        scopeId: sessionId,
        type: "open_loop",
        contentJson: JSON.stringify("A session-level open loop that should not leak into floor compaction."),
        importance: 0.8,
        confidence: 1,
        status: "active",
        lifecycleStatus: "active",
        sourceFloorId: null,
        sourceMessageId: null,
        createdAt: now - 1_000,
        updatedAt: now - 1_000,
      },
    ]);

    database.db.transaction((tx) => {
      jobScheduler.enqueueCompactMacro(tx, {
        accountId: DEFAULT_ACCOUNT_ID,
        scope: "floor",
        scopeId: floorId,
        sourceMicroIds,
        coverageStartFloorNo: 8,
        coverageEndFloorNo: 10,
        committedAt: now,
        force: true,
      });
    });

    const process = vi.fn(async () => ({
      output: makeCompactionOutput({
        macroSummary: "This floor settles into a stable local summary.",
        openLoopsResolve: [{ id: floorOpenLoopId, resolution: "The floor-level question is resolved." }],
        sourceMicroIds,
      }),
      usage: { promptTokens: 5, completionTokens: 7, totalTokens: 12 },
    }));
    const worker = new MemoryWorker(
      database.db,
      memoryStore,
      { process: vi.fn() } as unknown as MemoryIngestProcessor,
      { process } as unknown as MemoryCompactionProcessor,
      eventBus,
      {
        workerId: "worker-floor-compact",
        leaseTtlMs: 5_000,
        enableMacroCompaction: true,
      },
    );

    await expect(worker.processOneDueJob()).resolves.toBe(true);

    expect(process).toHaveBeenCalledOnce();
    expect(process).toHaveBeenCalledWith(expect.objectContaining({
      scope: "floor",
      scopeId: floorId,
      existingOpenLoops: [expect.objectContaining({ id: floorOpenLoopId, scope: "floor", scopeId: floorId })],
    }));

    const floorRows = await database.db.select().from(memoryItems).where(and(
      eq(memoryItems.accountId, DEFAULT_ACCOUNT_ID),
      eq(memoryItems.scope, "floor"),
      eq(memoryItems.scopeId, floorId),
    ));
    const createdMacroRow = floorRows.find((row) => row.type === "summary" && row.summaryTier === "macro");
    expect(createdMacroRow).toMatchObject({
      scope: "floor",
      scopeId: floorId,
      sourceFloorId: floorId,
      sourceJobId: `memory-job:compact_macro:floor:${floorId}:${sourceMicroIds[2]}`,
      coverageStartFloorNo: 8,
      coverageEndFloorNo: 10,
      derivedFromCount: 3,
    });

    const updatedFloorOpenLoop = floorRows.find((row) => row.id === floorOpenLoopId);
    expect(updatedFloorOpenLoop).toMatchObject({
      status: "deprecated",
      lifecycleStatus: "deprecated",
    });

    const [persistedChatOpenLoop] = await database.db.select().from(memoryItems).where(eq(memoryItems.id, chatOpenLoopId));
    expect(persistedChatOpenLoop).toMatchObject({
      status: "active",
      lifecycleStatus: "active",
    });
  });

  it("processes compact_macro jobs for global scopes without session-scoped leakage", async () => {
    const now = 1_735_700_350_000;
    const sessionId = nanoid();
    const globalOpenLoopId = "global-open-loop";
    const chatOpenLoopId = "chat-open-loop";
    const sourceMicroIds = ["global-micro-1", "global-micro-2", "global-micro-3"];

    await seedAccount(database, DEFAULT_ACCOUNT_ID, now);
    await seedSession(database, sessionId, now);

    await database.db.insert(memoryItems).values([
      ...sourceMicroIds.map((id, index) => ({
        id,
        accountId: DEFAULT_ACCOUNT_ID,
        scope: "global" as const,
        scopeId: DEFAULT_ACCOUNT_ID,
        type: "summary" as const,
        summaryTier: "micro" as const,
        contentJson: JSON.stringify(`Global summary ${index + 1}`),
        importance: 0.6,
        confidence: 1,
        status: "active" as const,
        lifecycleStatus: "active" as const,
        tokenCountEstimate: 32,
        coverageStartFloorNo: 20 + index,
        coverageEndFloorNo: 20 + index,
        sourceFloorId: null,
        sourceMessageId: null,
        createdAt: now - (4_000 - index),
        updatedAt: now - (4_000 - index),
      })),
      {
        id: globalOpenLoopId,
        accountId: DEFAULT_ACCOUNT_ID,
        scope: "global",
        scopeId: DEFAULT_ACCOUNT_ID,
        type: "open_loop",
        contentJson: JSON.stringify("Track the kingdom-wide prophecy"),
        importance: 0.45,
        confidence: 1,
        status: "active",
        lifecycleStatus: "active",
        sourceFloorId: null,
        sourceMessageId: null,
        createdAt: now - 2_000,
        updatedAt: now - 2_000,
      },
      {
        id: chatOpenLoopId,
        accountId: DEFAULT_ACCOUNT_ID,
        scope: "chat",
        scopeId: sessionId,
        type: "open_loop",
        contentJson: JSON.stringify("Chat-only unresolved thread"),
        importance: 0.45,
        confidence: 1,
        status: "active",
        lifecycleStatus: "active",
        sourceFloorId: null,
        sourceMessageId: null,
        createdAt: now - 1_500,
        updatedAt: now - 1_500,
      },
    ]);

    database.db.transaction((tx) => {
      jobScheduler.enqueueCompactMacro(tx, {
        accountId: DEFAULT_ACCOUNT_ID,
        scope: "global",
        scopeId: DEFAULT_ACCOUNT_ID,
        sourceMicroIds,
        coverageStartFloorNo: 20,
        coverageEndFloorNo: 22,
        committedAt: now,
        force: true,
      });
    });

    const memoryConsolidatedHandler = vi.fn();
    eventBus.on("memory.consolidated", memoryConsolidatedHandler);
    const process = vi.fn().mockResolvedValue({
      output: makeCompactionOutput({
        macroSummary: "Global macro summary",
        openLoopsResolve: [{ id: globalOpenLoopId, resolution: "Global prophecy resolved" }],
        sourceMicroIds,
      }),
      usage: { promptTokens: 18, completionTokens: 14, totalTokens: 32 },
    });
    const worker = new MemoryWorker(
      database.db,
      memoryStore,
      { process: vi.fn() } as unknown as MemoryIngestProcessor,
      { process } as unknown as MemoryCompactionProcessor,
      eventBus,
      {
        workerId: "worker-global-compact",
        leaseTtlMs: 5_000,
        enableMacroCompaction: true,
      },
    );

    await expect(worker.processOneDueJob()).resolves.toBe(true);

    expect(process).toHaveBeenCalledWith(expect.objectContaining({
      scope: "global",
      scopeId: DEFAULT_ACCOUNT_ID,
      existingOpenLoops: [expect.objectContaining({ id: globalOpenLoopId, scope: "global", scopeId: DEFAULT_ACCOUNT_ID })],
    }));

    const globalRows = await database.db
      .select()
      .from(memoryItems)
      .where(and(
        eq(memoryItems.accountId, DEFAULT_ACCOUNT_ID),
        eq(memoryItems.scope, "global"),
        eq(memoryItems.scopeId, DEFAULT_ACCOUNT_ID),
      ));
    const createdMacroRow = globalRows.find((row) => row.type === "summary" && row.summaryTier === "macro");
    expect(createdMacroRow).toMatchObject({
      scope: "global",
      scopeId: DEFAULT_ACCOUNT_ID,
      sourceFloorId: null,
      sourceJobId: `memory-job:compact_macro:global:${DEFAULT_ACCOUNT_ID}:${sourceMicroIds[2]}`,
      coverageStartFloorNo: 20,
      coverageEndFloorNo: 22,
      derivedFromCount: 3,
    });
    const updatedGlobalOpenLoop = globalRows.find((row) => row.id === globalOpenLoopId);
    expect(updatedGlobalOpenLoop).toMatchObject({
      status: "deprecated",
      lifecycleStatus: "deprecated",
    });
    const [persistedChatOpenLoop] = await database.db.select().from(memoryItems).where(eq(memoryItems.id, chatOpenLoopId));
    expect(persistedChatOpenLoop).toMatchObject({
      status: "active",
      lifecycleStatus: "active",
    });

    expect(memoryConsolidatedHandler).toHaveBeenCalledTimes(1);
    const consolidatedEvent = memoryConsolidatedHandler.mock.calls[0]?.[0];
    expect(consolidatedEvent).toMatchObject({
      scope: "global",
      scopeId: DEFAULT_ACCOUNT_ID,
      sourceJobId: `memory-job:compact_macro:global:${DEFAULT_ACCOUNT_ID}:${sourceMicroIds[2]}`,
      jobType: "compact_macro",
    });
    expect(consolidatedEvent?.sessionId).toBeUndefined();
  });

  it("recovers jobs whose lease expired", async () => {
    const now = 1_735_700_100_000;
    const sessionId = nanoid();
    const floorId = nanoid();
    const userMessage = "A short follow-up.";
    const assistantMessage = "A short answer.";

    await seedAccount(database, DEFAULT_ACCOUNT_ID, now);
    await seedSession(database, sessionId, now);
    const conversation = await seedCommittedFloorConversation({
      database,
      sessionId,
      floorId,
      floorNo: 4,
      now,
      userMessage,
      assistantMessage,
    });

    await database.db.insert(runtimeJobs).values({
      id: `memory-job:ingest_turn:${floorId}`,
      jobType: toMemoryRuntimeJobType("ingest_turn"),
      accountId: DEFAULT_ACCOUNT_ID,
      scopeType: MEMORY_RUNTIME_SCOPE_TYPE,
      scopeKey: buildMemoryRuntimeScopeKey("chat", sessionId),
      sessionId,
      status: "leased",
      floorId,
      pageId: null,
      basedOnRevision: 0,
      payloadJson: JSON.stringify({
        accountId: DEFAULT_ACCOUNT_ID,
        sessionId,
        floorId,
        floorNo: 4,
        assistantMessageId: conversation.assistantMessageId,
        userInputDigest: createUserInputDigest(userMessage),
        committedAt: now,
        summaries: ["Recovered summary"],
        enableConsolidation: false,
      }),
      attemptCount: 0,
      maxAttempts: 5,
      availableAt: now,
      startedAt: null,
      finishedAt: null,
      leaseOwner: "stale-worker",
      leaseUntil: now - 1,
      dedupeKey: null,
      progressCurrent: 0,
      progressTotal: null,
      progressMessage: null,
      lastError: null,
      lastErrorCode: null,
      lastErrorClass: null,
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(runtimeScopeStates).values({
      accountId: DEFAULT_ACCOUNT_ID,
      scopeType: MEMORY_RUNTIME_SCOPE_TYPE,
      scopeKey: buildMemoryRuntimeScopeKey("chat", sessionId),
      revision: 0,
      leaseOwner: "stale-worker",
      leaseUntil: now - 1,
      lastProcessedAt: null,
      lastSuccessJobId: null,
      metadataJson: JSON.stringify({
        lastProcessedFloorNo: null,
        lastCompactionAt: null,
      }),
      updatedAt: now,
    });

    const memoryIngestProcessor = {
      process: vi.fn(async () => ({
        output: makeIngestOutput({ microSummary: "Recovered summary" }),
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      })),
    } as unknown as MemoryIngestProcessor;

    const worker = new MemoryWorker(
      database.db,
      memoryStore,
      memoryIngestProcessor,
      createNoopCompactionProcessor(),
      eventBus,
      {
      workerId: "worker-recovery",
      leaseTtlMs: 5_000,
      },
    );

    await expect(worker.processOneDueJob()).resolves.toBe(true);

    const [job] = (await getRuntimeMemoryJobs(database)).filter((entry) => entry.floorId === floorId);
    expect(job).toMatchObject({
      status: "succeeded",
      attemptCount: 1,
      leaseOwner: null,
      leaseUntil: null,
    });

    const createdRows = await database.db
      .select()
      .from(memoryItems)
      .where(eq(memoryItems.sourceFloorId, floorId));
    expect(createdRows.map((row) => JSON.parse(row.contentJson))).toEqual(["Recovered summary"]);
  });

  it("moves jobs to retry_waiting when revision CAS fails", async () => {
    const now = 1_735_700_200_000;
    const sessionId = nanoid();
    const floorId = nanoid();
    const userMessage = "The scene changes while the worker is thinking.";
    const assistantMessage = "The answer is delayed while events keep moving.";

    await seedAccount(database, DEFAULT_ACCOUNT_ID, now);
    await seedSession(database, sessionId, now);
    const conversation = await seedCommittedFloorConversation({
      database,
      sessionId,
      floorId,
      floorNo: 5,
      now,
      userMessage,
      assistantMessage,
    });

    database.db.transaction((tx) => {
      jobScheduler.enqueueIngestTurn(tx, {
        accountId: DEFAULT_ACCOUNT_ID,
        sessionId,
        branchId: "main",
        floorId,
        floorNo: 5,
        assistantMessageId: conversation.assistantMessageId,
        userInputDigest: createUserInputDigest(userMessage),
        committedAt: now,
        summaries: [],
        enableConsolidation: true,
      });
    });

    const deferred = createDeferred<{
      output: MemoryIngestOutput;
      usage: { promptTokens: number; completionTokens: number; totalTokens: number };
    }>();
    const process = vi.fn(() => deferred.promise);
    const memoryIngestProcessor = { process } as unknown as MemoryIngestProcessor;
    const worker = new MemoryWorker(
      database.db,
      memoryStore,
      memoryIngestProcessor,
      createNoopCompactionProcessor(),
      eventBus,
      {
      workerId: "worker-conflict",
      leaseTtlMs: 5_000,
      retryBaseDelayMs: 1_000,
      },
    );

    const processing = worker.processOneDueJob();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(process).toHaveBeenCalledOnce();

    await database.db.update(runtimeScopeStates)
      .set({
        revision: 1,
        leaseOwner: null,
        leaseUntil: null,
        updatedAt: now + 10,
      })
      .where(and(
        eq(runtimeScopeStates.accountId, DEFAULT_ACCOUNT_ID),
        eq(runtimeScopeStates.scopeType, MEMORY_RUNTIME_SCOPE_TYPE),
        eq(runtimeScopeStates.scopeKey, buildMemoryRuntimeScopeKey("branch", mainBranchMemoryScopeId(sessionId))),
      ))
      .run();

    deferred.resolve({
      output: makeIngestOutput({ microSummary: "Conflict turn micro summary" }),
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });

    await expect(processing).resolves.toBe(true);

    const [job] = (await getRuntimeMemoryJobs(database)).filter((entry) => entry.floorId === floorId);
    expect(job).toMatchObject({
      status: "retry_waiting",
      attemptCount: 1,
      leaseOwner: null,
      leaseUntil: null,
    });
    expect(job!.availableAt).toBeGreaterThan(now);
    expect(job!.lastError).toContain("revision conflict");

    const createdRows = await database.db
      .select()
      .from(memoryItems)
      .where(eq(memoryItems.sourceFloorId, floorId));
    expect(createdRows).toEqual([]);
  });

  it("emits json parse fallback events and still writes fallback micro summaries", async () => {
    const now = 1_735_700_300_000;
    const sessionId = nanoid();
    const floorId = nanoid();
    const userMessage = "Alice asks whether Bob told the truth.";
    const assistantMessage = "Bob gives an evasive answer.";

    await seedAccount(database, DEFAULT_ACCOUNT_ID, now);
    await seedSession(database, sessionId, now);
    const conversation = await seedCommittedFloorConversation({
      database,
      sessionId,
      floorId,
      floorNo: 6,
      now,
      userMessage,
      assistantMessage,
    });

    database.db.transaction((tx) => {
      jobScheduler.enqueueIngestTurn(tx, {
        accountId: DEFAULT_ACCOUNT_ID,
        sessionId,
        branchId: "main",
        floorId,
        floorNo: 6,
        assistantMessageId: conversation.assistantMessageId,
        userInputDigest: createUserInputDigest(userMessage),
        committedAt: now,
        summaries: ["Fallback summary from generation"],
        enableConsolidation: false,
      });
    });

    const parseFailedHandler = vi.fn();
    eventBus.on("memory.consolidation_json_parse_failed", parseFailedHandler);

    const memoryIngestProcessor = {
      process: vi.fn(async () => ({
        output: makeIngestOutput({ microSummary: "Fallback summary from generation" }),
        degraded: {
          reason: "json_parse_failed" as const,
          rawText: "not-json",
          error: new Error("Unexpected token"),
        },
        usage: { promptTokens: 2, completionTokens: 2, totalTokens: 4 },
      })),
    } as unknown as MemoryIngestProcessor;
    const worker = new MemoryWorker(
      database.db,
      memoryStore,
      memoryIngestProcessor,
      createNoopCompactionProcessor(),
      eventBus,
      {
      workerId: "worker-fallback",
      leaseTtlMs: 5_000,
      },
    );

    await expect(worker.processOneDueJob()).resolves.toBe(true);

    expect(parseFailedHandler).toHaveBeenCalledOnce();
    expect(parseFailedHandler).toHaveBeenCalledWith(expect.objectContaining({
      floorId,
      rawText: "not-json",
      error: expect.any(Error),
    }));

    const createdRows = await database.db
      .select()
      .from(memoryItems)
      .where(eq(memoryItems.sourceFloorId, floorId));
    expect(createdRows.map((row) => JSON.parse(row.contentJson))).toEqual(["Fallback summary from generation"]);
  });
  it("processes maintenance jobs with scope-level leasing and revision updates", async () => {
    const now = 1_735_700_400_000;
    const dayMs = 24 * 60 * 60 * 1000;
    const sessionId = nanoid();

    await seedAccount(database, DEFAULT_ACCOUNT_ID, now);
    await seedSession(database, sessionId, now);
    const memoryConsolidatedHandler = vi.fn();
    eventBus.on("memory.consolidated", memoryConsolidatedHandler);

    await database.db.insert(memoryItems).values([
      {
        id: "maintenance-summary-old",
        accountId: DEFAULT_ACCOUNT_ID,
        scope: "chat",
        scopeId: sessionId,
        type: "summary",
        summaryTier: "micro",
        contentJson: JSON.stringify("Old summary"),
        importance: 0.5,
        confidence: 1,
        status: "active",
        lifecycleStatus: "active",
        createdAt: now - 40 * dayMs,
        updatedAt: now - 40 * dayMs,
        sourceFloorId: null,
        sourceMessageId: null,
      },
      {
        id: "maintenance-deprecated-old",
        accountId: DEFAULT_ACCOUNT_ID,
        scope: "chat",
        scopeId: sessionId,
        type: "summary",
        summaryTier: "micro",
        contentJson: JSON.stringify("Very old deprecated summary"),
        importance: 0.5,
        confidence: 1,
        status: "deprecated",
        lifecycleStatus: "deprecated",
        createdAt: now - 200 * dayMs,
        updatedAt: now - 100 * dayMs,
        sourceFloorId: null,
        sourceMessageId: null,
      },
    ]);

    database.db.transaction((tx) => {
      jobScheduler.enqueueMaintenance(tx, {
        accountId: DEFAULT_ACCOUNT_ID,
        scope: "chat",
        scopeId: sessionId,
        scheduleBucket: 1,
        scheduledAt: now,
        batchSize: 50,
        dryRun: false,
        policy: {
          summaryMaxAgeMs: 30 * dayMs,
          deprecatedPurgeAgeMs: 90 * dayMs,
        },
      });
    });

    const worker = new MemoryWorker(
      database.db,
      memoryStore,
      { process: vi.fn() } as unknown as MemoryIngestProcessor,
      createNoopCompactionProcessor(),
      eventBus,
      {
        workerId: "worker-maintenance",
        leaseTtlMs: 5_000,
      },
    );

    await expect(worker.processOneDueJob()).resolves.toBe(true);

    const rows = await database.db
      .select({ id: memoryItems.id, status: memoryItems.status, lifecycleStatus: memoryItems.lifecycleStatus })
      .from(memoryItems)
      .where(and(
        eq(memoryItems.accountId, DEFAULT_ACCOUNT_ID),
        eq(memoryItems.scope, "chat"),
        eq(memoryItems.scopeId, sessionId),
      ));

    expect(rows).toEqual([
      expect.objectContaining({
        id: "maintenance-summary-old",
        status: "deprecated",
        lifecycleStatus: "deprecated",
      }),
    ]);

    const scopeState = await getRuntimeMemoryScopeState(database, "chat", sessionId);
    expect(scopeState?.revision).toBe(1);
    expect(scopeState?.leaseOwner).toBeNull();
    expect(scopeState?.leaseUntil).toBeNull();

    const [job] = await getRuntimeMemoryJobs(database, "maintenance");
    expect(job).toBeDefined();
    expect(job).toMatchObject({
      status: "succeeded",
      attemptCount: 1,
      leaseOwner: null,
      leaseUntil: null,
    });

    expect(memoryConsolidatedHandler).toHaveBeenCalledTimes(1);
    expect(memoryConsolidatedHandler).toHaveBeenCalledWith(expect.objectContaining({
      sessionId,
      scope: "chat",
      scopeId: sessionId,
      sourceJobId: job!.id,
      jobType: "maintenance",
      created: 0,
      updated: 0,
      deprecated: 1,
      purged: 1,
    }));
  });

  it("enqueues forced compact_macro jobs from rebuild_scope even when macro compaction is disabled", async () => {
    const now = 1_735_700_500_000;
    const sessionId = nanoid();

    await seedAccount(database, DEFAULT_ACCOUNT_ID, now);
    await seedSession(database, sessionId, now);

    await database.db.insert(memoryItems).values(
      Array.from({ length: 7 }, (_, index) => ({
        id: `rebuild-micro-${index + 1}`,
        accountId: DEFAULT_ACCOUNT_ID,
        scope: "chat" as const,
        scopeId: sessionId,
        type: "summary" as const,
        summaryTier: "micro" as const,
        contentJson: JSON.stringify(`Historical summary ${index + 1}`),
        importance: 0.6,
        confidence: 1,
        status: "active" as const,
        lifecycleStatus: "active" as const,
        tokenCountEstimate: 40,
        coverageStartFloorNo: index + 1,
        coverageEndFloorNo: index + 1,
        sourceFloorId: `seed-floor-${index + 1}`,
        sourceMessageId: null,
        createdAt: now - (10_000 - index),
        updatedAt: now - (10_000 - index),
      })),
    );

    database.db.transaction((tx) => {
      jobScheduler.enqueueRebuildScope(tx, {
        accountId: DEFAULT_ACCOUNT_ID,
        scope: "chat",
        scopeId: sessionId,
        committedAt: now,
        forceCompaction: true,
        seed: "manual-rebuild",
      });
    });
    const memoryConsolidatedHandler = vi.fn();
    eventBus.on("memory.consolidated", memoryConsolidatedHandler);

    const worker = new MemoryWorker(
      database.db,
      memoryStore,
      { process: vi.fn() } as unknown as MemoryIngestProcessor,
      createNoopCompactionProcessor(),
      eventBus,
      {
        workerId: "worker-rebuild",
        leaseTtlMs: 5_000,
        enableMacroCompaction: false,
      },
    );

    await expect(worker.processOneDueJob()).resolves.toBe(true);

    const [rebuildJob] = await getRuntimeMemoryJobs(database, "rebuild_scope");
    expect(rebuildJob).toMatchObject({
      status: "succeeded",
      attemptCount: 1,
    });

    const [compactJob] = await getRuntimeMemoryJobs(database, "compact_macro");
    expect(compactJob).toBeDefined();
    expect(compactJob).toMatchObject({
      status: "pending",
      scope: "chat",
      scopeId: sessionId,
    });
    expect(JSON.parse(compactJob!.payloadJson)).toEqual(expect.objectContaining({
      force: true,
      scope: "chat",
      scopeId: sessionId,
      sourceMicroIds: ["rebuild-micro-1", "rebuild-micro-2", "rebuild-micro-3"],
    }));

    expect(memoryConsolidatedHandler).not.toHaveBeenCalled();
  });

});
