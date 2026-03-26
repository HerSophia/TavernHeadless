import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type {
  CoreEventBus,
  CoreEventMap,
  ExecutedToolCallRecord,
  FloorEntity,
  MemoryConsolidationOutput,
  MemoryItem,
  PromptSnapshotRecord,
  TokenUsage,
  ToolCallRecord,
  TurnExecutionResult,
} from "@tavern/core";
import { FloorNotFoundError, FloorStateConflictError } from "@tavern/core";
import type { MemoryScope, VariableEntry } from "@tavern/shared";

import type { AppDb, DbExecutor } from "../db/client.js";
import {
  floors,
  memoryEdges,
  memoryItems,
  promptSnapshots,
  toolCallRecords,
  toolExecutionRecords,
} from "../db/schema.js";
import { ChatMessagePersistence } from "./chat-message-persistence.js";
import {
  VariableCommitService,
  type VariablePromotionPolicy,
} from "./variable-commit-service.js";

type FloorRow = typeof floors.$inferSelect;
type MemoryItemRow = typeof memoryItems.$inferSelect;

type PromptSnapshotInsert = typeof promptSnapshots.$inferInsert;
type ToolExecutionInsert = typeof toolExecutionRecords.$inferInsert;

type PendingCoreEvent = {
  [K in keyof CoreEventMap]: {
    name: K;
    payload: CoreEventMap[K];
  };
}[keyof CoreEventMap];

interface MemoryCommitInput {
  summaries?: string[];
  consolidationOutput?: MemoryConsolidationOutput;
}

interface VariableCommitOptions {
  pageId?: string;
  policy?: VariablePromotionPolicy;
}

interface MemoryItemCreateInput {
  scope: MemoryScope;
  scopeId: string;
  type: MemoryItem["type"];
  content: string;
  factKey?: string;
  importance: number;
  confidence: number;
  sourceFloorId?: string;
  sourceMessageId?: string;
  status: MemoryItem["status"];
}

interface MemoryCommitCounts {
  created: number;
  updated: number;
  deprecated: number;
}

export interface TurnCommitInput {
  floorId: string;
  sessionId: string;
  execution: TurnExecutionResult;
  committedAt?: number;
  promptSnapshot?: PromptSnapshotRecord;
  toolCalls?: ToolCallRecord[];
  toolExecutionRecords?: ExecutedToolCallRecord[];
  variableCommit?: VariableCommitOptions;
  memoryCommit?: MemoryCommitInput;
}

export interface TurnCommitResult {
  floorId: string;
  outputPageId: string;
  assistantMessageId: string;
  finalState: "committed";
  usage: TokenUsage;
}

class MemoryPersistError extends Error {
  constructor(message: string, override readonly cause?: unknown) {
    super(message);
    this.name = "MemoryPersistError";
  }
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function normalizeToken(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }

  return Math.trunc(value);
}

function normalizeTokenUsage(usage: TokenUsage): TokenUsage {
  return {
    promptTokens: normalizeToken(usage.promptTokens),
    completionTokens: normalizeToken(usage.completionTokens),
    totalTokens: normalizeToken(usage.totalTokens),
  };
}

function parseContent(contentJson: string): string {
  try {
    const parsed = JSON.parse(contentJson);
    if (typeof parsed === "string") {
      return parsed;
    }

    if (typeof parsed === "object" && parsed !== null && typeof parsed.text === "string") {
      return parsed.text;
    }

    return contentJson;
  } catch {
    return contentJson;
  }
}

function toContentJson(content: string): string {
  return JSON.stringify(content);
}

function normalizeFactKey(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function resolveFactAddKey(
  fact: MemoryConsolidationOutput["factsAdd"][number]
): string | undefined {
  return normalizeFactKey(fact.factKey ?? fact.key);
}

function toFactContent(factKey: string | undefined, value: string): string {
  return factKey ? `${factKey}: ${value}` : value;
}

function compareFactItemsForConflictResolution(
  a: MemoryItem,
  b: MemoryItem,
  preferredIds: Set<string>
): number {
  const aPreferred = preferredIds.has(a.id);
  const bPreferred = preferredIds.has(b.id);
  if (aPreferred !== bPreferred) {
    return aPreferred ? -1 : 1;
  }

  if (a.updatedAt !== b.updatedAt) {
    return b.updatedAt - a.updatedAt;
  }

  if (a.importance !== b.importance) {
    return b.importance - a.importance;
  }

  if (a.createdAt !== b.createdAt) {
    return b.createdAt - a.createdAt;
  }

  return b.id.localeCompare(a.id);
}

function toFloorEntity(row: FloorRow): FloorEntity {
  return {
    id: row.id,
    sessionId: row.sessionId,
    floorNo: row.floorNo,
    branchId: row.branchId,
    parentFloorId: row.parentFloorId,
    state: row.state,
    tokenIn: row.tokenIn,
    tokenOut: row.tokenOut,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toMemoryItem(row: MemoryItemRow): MemoryItem {
  return {
    id: row.id,
    scope: row.scope,
    scopeId: row.scopeId,
    type: row.type,
    content: parseContent(row.contentJson),
    factKey: row.factKey ?? undefined,
    importance: row.importance,
    confidence: row.confidence,
    sourceFloorId: row.sourceFloorId ?? undefined,
    sourceMessageId: row.sourceMessageId ?? undefined,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toPromptSnapshotInsert(record: PromptSnapshotRecord): PromptSnapshotInsert {
  return {
    floorId: record.floorId,
    sessionId: record.sessionId,
    presetId: record.presetId,
    presetUpdatedAt: record.presetUpdatedAt,
    worldbookId: record.worldbookId,
    worldbookUpdatedAt: record.worldbookUpdatedAt,
    regexProfileId: record.regexProfileId,
    regexProfileUpdatedAt: record.regexProfileUpdatedAt,
    worldbookActivatedEntryUidsJson: JSON.stringify(record.worldbookActivatedEntryUids),
    regexPreRuleNamesJson: JSON.stringify(record.regexPreRuleNames),
    regexPostRuleNamesJson: JSON.stringify(record.regexPostRuleNames),
    promptMode: record.promptMode,
    promptDigest: record.promptDigest,
    tokenEstimate: record.tokenEstimate,
    createdAt: record.createdAt,
  };
}

function toToolExecutionInsert(record: ExecutedToolCallRecord): ToolExecutionInsert {
  return {
    id: record.id,
    runId: record.runId,
    floorId: record.floorId,
    pageId: record.pageId ?? null,
    callerSlot: record.callerSlot,
    providerId: record.providerId,
    toolName: record.toolName,
    argsJson: record.argsJson,
    resultJson: record.resultJson,
    status: record.status,
    errorMessage: record.errorMessage ?? null,
    durationMs: record.durationMs,
    createdAt: record.createdAt,
  };
}

function toLegacyToolCallRecord(
  record: ExecutedToolCallRecord,
  seq: number
): ToolCallRecord {
  return {
    id: record.id,
    pageId: record.pageId ?? "",
    seq,
    callerSlot: record.callerSlot,
    toolName: record.toolName,
    argsJson: record.argsJson,
    resultJson: record.resultJson,
    status: record.status,
    durationMs: record.durationMs,
    createdAt: record.createdAt,
  };
}


function queueEvent<K extends keyof CoreEventMap>(
  pendingEvents: PendingCoreEvent[],
  name: K,
  payload: CoreEventMap[K]
): void {
  pendingEvents.push({ name, payload } as PendingCoreEvent);
}

function findMemoryItemById(tx: DbExecutor, id: string): MemoryItem | null {
  const row = tx
    .select()
    .from(memoryItems)
    .where(eq(memoryItems.id, id))
    .limit(1)
    .all()[0];

  return row ? toMemoryItem(row) : null;
}

function createMemoryItem(
  tx: DbExecutor,
  input: MemoryItemCreateInput,
  timestamp: number
): MemoryItem {
  const id = nanoid();
  const factKey = input.type === "fact" ? normalizeFactKey(input.factKey) : undefined;

  tx.insert(memoryItems)
    .values({
      id,
      scope: input.scope,
      scopeId: input.scopeId,
      type: input.type,
      contentJson: toContentJson(input.content),
      factKey: factKey ?? null,
      importance: input.importance,
      confidence: input.confidence,
      sourceFloorId: input.sourceFloorId ?? null,
      sourceMessageId: input.sourceMessageId ?? null,
      status: input.status,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();

  return {
    id,
    scope: input.scope,
    scopeId: input.scopeId,
    type: input.type,
    content: input.content,
    factKey,
    importance: input.importance,
    confidence: input.confidence,
    sourceFloorId: input.sourceFloorId,
    sourceMessageId: input.sourceMessageId,
    status: input.status,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function updateMemoryItem(
  tx: DbExecutor,
  id: string,
  patch: Partial<Pick<MemoryItem, "content" | "factKey" | "importance" | "confidence" | "status">>,
  timestamp: number
): MemoryItem | null {
  const existing = findMemoryItemById(tx, id);
  if (!existing) {
    return null;
  }
  const factKey = normalizeFactKey(patch.factKey);

  const updates: Partial<typeof memoryItems.$inferInsert> = {
    updatedAt: timestamp,
  };

  if (patch.content !== undefined) {
    updates.contentJson = toContentJson(patch.content);
  }

  if (patch.factKey !== undefined) {
    updates.factKey = factKey ?? null;
  }

  if (patch.importance !== undefined) {
    updates.importance = patch.importance;
  }

  if (patch.confidence !== undefined) {
    updates.confidence = patch.confidence;
  }

  if (patch.status !== undefined) {
    updates.status = patch.status;
  }

  const updateResult = tx.update(memoryItems).set(updates).where(eq(memoryItems.id, id)).run();
  if (updateResult.changes !== 1) {
    return null;
  }

  return {
    ...existing,
    content: patch.content ?? existing.content,
    factKey: patch.factKey !== undefined ? factKey : existing.factKey,
    importance: patch.importance ?? existing.importance,
    confidence: patch.confidence ?? existing.confidence,
    status: patch.status ?? existing.status,
    updatedAt: timestamp,
  };
}

function deprecateMemoryItem(tx: DbExecutor, id: string, timestamp: number): MemoryItem | null {
  return updateMemoryItem(tx, id, { status: "deprecated" }, timestamp);
}

function findActiveFactsByScope(tx: DbExecutor, scope: MemoryScope, scopeId: string): MemoryItem[] {
  return tx
    .select()
    .from(memoryItems)
    .where(
      and(
        eq(memoryItems.scope, scope),
        eq(memoryItems.scopeId, scopeId),
        eq(memoryItems.type, "fact"),
        eq(memoryItems.status, "active")
      )
    )
    .orderBy(desc(memoryItems.updatedAt))
    .limit(1000)
    .all()
    .map(toMemoryItem);
}

function createMemoryEdge(
  tx: DbExecutor,
  fromId: string,
  toId: string,
  relation: "supports" | "contradicts" | "updates",
  timestamp: number
): void {
  tx.insert(memoryEdges)
    .values({
      id: nanoid(),
      fromId,
      toId,
      relation,
      createdAt: timestamp,
    })
    .run();
}

function commitSummaryMemories(args: {
  tx: DbExecutor;
  floorId: string;
  sessionId: string;
  summaries: string[];
  timestamp: number;
  pendingEvents: PendingCoreEvent[];
}): void {
  for (const summary of args.summaries) {
    const trimmed = summary.trim();
    if (!trimmed) {
      continue;
    }

    const item = createMemoryItem(
      args.tx,
      {
        scope: "chat",
        scopeId: args.sessionId,
        type: "summary",
        content: trimmed,
        importance: 0.5,
        confidence: 1.0,
        sourceFloorId: args.floorId,
        status: "active",
      },
      args.timestamp
    );

    queueEvent(args.pendingEvents, "memory.created", {
      item,
      source: "extraction",
    });
  }
}

function applyConsolidationMemory(args: {
  tx: DbExecutor;
  floorId: string;
  sessionId: string;
  output: MemoryConsolidationOutput;
  timestamp: number;
  pendingEvents: PendingCoreEvent[];
}): MemoryCommitCounts {
  let createdCount = 0;
  let updatedCount = 0;
  let deprecatedCount = 0;

  const touchedFactKeysByScope = new Map<MemoryScope, Set<string>>();
  const touchedFactItemIds = new Set<string>();

  const markTouchedFactKey = (factScope: MemoryScope, key: string | undefined) => {
    if (!key) {
      return;
    }

    const normalized = normalizeFactKey(key);
    if (!normalized) {
      return;
    }

    const bucket = touchedFactKeysByScope.get(factScope) ?? new Set<string>();
    bucket.add(normalized);
    touchedFactKeysByScope.set(factScope, bucket);
  };

  if (args.output.turnSummary?.trim()) {
    const item = createMemoryItem(
      args.tx,
      {
        scope: "chat",
        scopeId: args.sessionId,
        type: "summary",
        content: args.output.turnSummary.trim(),
        importance: 0.6,
        confidence: 1.0,
        sourceFloorId: args.floorId,
        status: "active",
      },
      args.timestamp
    );

    queueEvent(args.pendingEvents, "memory.created", {
      item,
      source: "consolidation",
    });
    createdCount += 1;
  }

  for (const fact of args.output.factsAdd) {
    const factKey = resolveFactAddKey(fact);
    const factScope = fact.scope ?? "chat";
    markTouchedFactKey(factScope, factKey);

    const factContent = toFactContent(factKey, fact.value);
    const item = createMemoryItem(
      args.tx,
      {
        scope: factScope,
        scopeId: args.sessionId,
        type: "fact",
        content: factContent,
        factKey,
        importance: fact.importance ?? 0.5,
        confidence: 1.0,
        sourceFloorId: args.floorId,
        status: "active",
      },
      args.timestamp
    );

    touchedFactItemIds.add(item.id);
    queueEvent(args.pendingEvents, "memory.created", {
      item,
      source: "consolidation",
    });
    createdCount += 1;
  }

  for (const update of args.output.factsUpdate) {
    const existing = findMemoryItemById(args.tx, update.id);
    if (!existing) {
      continue;
    }

    const updated = updateMemoryItem(
      args.tx,
      update.id,
      {
        content: update.value,
        importance: update.importance,
        ...(update.factKey !== undefined ? { factKey: update.factKey } : {}),
      },
      args.timestamp
    );

    if (!updated) {
      continue;
    }

    touchedFactItemIds.add(updated.id);
    markTouchedFactKey(updated.scope, updated.factKey ?? normalizeFactKey(update.factKey));

    queueEvent(args.pendingEvents, "memory.updated", {
      item: updated,
      previousContent: existing.content,
    });
    updatedCount += 1;
  }

  for (const deprecatedFact of args.output.factsDeprecate) {
    const deprecated = deprecateMemoryItem(args.tx, deprecatedFact.id, args.timestamp);
    if (!deprecated) {
      continue;
    }

    queueEvent(args.pendingEvents, "memory.deprecated", {
      item: deprecated,
      reason: deprecatedFact.reason,
    });
    deprecatedCount += 1;
  }

  for (const [factScope, touchedKeys] of touchedFactKeysByScope) {
    if (touchedKeys.size === 0) {
      continue;
    }

    const activeFacts = findActiveFactsByScope(args.tx, factScope, args.sessionId);
    const groupedByKey = new Map<string, MemoryItem[]>();

    for (const item of activeFacts) {
      const key = item.factKey;
      if (!key || !touchedKeys.has(key)) {
        continue;
      }

      const bucket = groupedByKey.get(key);
      if (bucket) {
        bucket.push(item);
      } else {
        groupedByKey.set(key, [item]);
      }
    }

    for (const [key, items] of groupedByKey) {
      if (items.length <= 1) {
        continue;
      }

      const sorted = [...items].sort((a, b) =>
        compareFactItemsForConflictResolution(a, b, touchedFactItemIds)
      );

      const winner = sorted[0]!;
      for (const other of sorted.slice(1)) {
        const deprecated = deprecateMemoryItem(args.tx, other.id, args.timestamp);
        if (!deprecated) {
          continue;
        }

        queueEvent(args.pendingEvents, "memory.deprecated", {
          item: deprecated,
          reason: `conflict_resolution:${key}`,
        });
        deprecatedCount += 1;

        createMemoryEdge(args.tx, winner.id, deprecated.id, "updates", args.timestamp);
      }
    }
  }

  queueEvent(args.pendingEvents, "memory.consolidated", {
    floorId: args.floorId,
    created: createdCount,
    updated: updatedCount,
    deprecated: deprecatedCount,
  });

  return {
    created: createdCount,
    updated: updatedCount,
    deprecated: deprecatedCount,
  };
}

function commitMemory(args: {
  tx: DbExecutor;
  floorId: string;
  sessionId: string;
  memoryCommit: MemoryCommitInput;
  timestamp: number;
  pendingEvents: PendingCoreEvent[];
}): void {
  const summaries = args.memoryCommit.summaries ?? [];
  if (summaries.length > 0) {
    commitSummaryMemories({
      tx: args.tx,
      floorId: args.floorId,
      sessionId: args.sessionId,
      summaries,
      timestamp: args.timestamp,
      pendingEvents: args.pendingEvents,
    });
  }

  if (args.memoryCommit.consolidationOutput) {
    applyConsolidationMemory({
      tx: args.tx,
      floorId: args.floorId,
      sessionId: args.sessionId,
      output: args.memoryCommit.consolidationOutput,
      timestamp: args.timestamp,
      pendingEvents: args.pendingEvents,
    });
  }
}

export class TurnCommitService {
  constructor(
    private readonly db: AppDb,
    private readonly messagePersistence: ChatMessagePersistence,
    private readonly eventBus: CoreEventBus
  ) {}

  private readonly variableCommitService = new VariableCommitService();

  async commit(input: TurnCommitInput): Promise<TurnCommitResult> {
    const committedAt = input.committedAt ?? Date.now();
    const usage = normalizeTokenUsage(input.execution.totalUsage);
    const actualToolExecutionRecords =
      input.toolExecutionRecords ?? input.execution.toolExecutionRecords ?? [];
    const legacyToolCalls =
      input.toolCalls
      ?? input.execution.toolCalls
      ?? actualToolExecutionRecords.map((record, index) => toLegacyToolCallRecord(record, index + 1));
    const pendingEvents: PendingCoreEvent[] = [];

    let transactionResult: {
      floor: FloorEntity;
      assistantMessage: { pageId: string; messageId: string };
      variableCommit: ReturnType<VariableCommitService["promoteAll"]>;
    };
    try {
      transactionResult = this.db.transaction((tx) => {
        const assistantMessage = this.messagePersistence.saveAssistantMessageWithExecutor(
          tx,
          input.floorId,
          input.execution.generatedText,
          committedAt
        );

        if (legacyToolCalls.length > 0) {
          tx
            .insert(toolCallRecords)
            .values(
              legacyToolCalls.map((record, index) => ({
                id: record.id,
                pageId: assistantMessage.pageId,
                seq: record.seq > 0 ? record.seq : index + 1,
                callerSlot: record.callerSlot,
                toolName: record.toolName,
                argsJson: record.argsJson,
                resultJson: record.resultJson,
                status: record.status,
                durationMs: record.durationMs,
                createdAt: record.createdAt,
              }))
            )
            .run();
        }

        if (input.promptSnapshot) {
          const snapshot = toPromptSnapshotInsert(input.promptSnapshot);
          tx
            .insert(promptSnapshots)
            .values(snapshot)
            .onConflictDoUpdate({
              target: promptSnapshots.floorId,
              set: {
                sessionId: snapshot.sessionId,
                presetId: snapshot.presetId,
                presetUpdatedAt: snapshot.presetUpdatedAt,
                worldbookId: snapshot.worldbookId,
                worldbookUpdatedAt: snapshot.worldbookUpdatedAt,
                regexProfileId: snapshot.regexProfileId,
                regexProfileUpdatedAt: snapshot.regexProfileUpdatedAt,
                worldbookActivatedEntryUidsJson: snapshot.worldbookActivatedEntryUidsJson,
                regexPreRuleNamesJson: snapshot.regexPreRuleNamesJson,
                regexPostRuleNamesJson: snapshot.regexPostRuleNamesJson,
                promptMode: snapshot.promptMode,
                promptDigest: snapshot.promptDigest,
                tokenEstimate: snapshot.tokenEstimate,
                createdAt: snapshot.createdAt,
              },
            })
            .run();
        }

        if (actualToolExecutionRecords.length > 0) {
          tx
            .insert(toolExecutionRecords)
            .values(actualToolExecutionRecords.map(toToolExecutionInsert))
            .run();
        }

        const variableCommit = this.variableCommitService.promoteAll(
          {
            pageId: input.variableCommit?.pageId,
            floorId: input.floorId,
            sessionId: input.sessionId,
            policy: input.variableCommit?.policy,
            committedAt,
          },
          tx
        );

        if (input.memoryCommit) {
          try {
            commitMemory({
              tx,
              floorId: input.floorId,
              sessionId: input.sessionId,
              memoryCommit: input.memoryCommit,
              timestamp: committedAt,
              pendingEvents,
            });
          } catch (error) {
            throw new MemoryPersistError(
              `Memory persist failed: ${normalizeError(error).message}`,
              error
            );
          }
        }

        const updateResult = tx
          .update(floors)
          .set({
            tokenIn: usage.promptTokens,
            tokenOut: usage.completionTokens,
            updatedAt: committedAt,
            state: "committed",
          })
          .where(and(eq(floors.id, input.floorId), eq(floors.state, "generating")))
          .run();

        if (updateResult.changes !== 1) {
          const currentRow = tx
            .select({ id: floors.id, state: floors.state })
            .from(floors)
            .where(eq(floors.id, input.floorId))
            .limit(1)
            .all()[0];

          if (!currentRow) {
            throw new FloorNotFoundError(input.floorId);
          }

          throw new FloorStateConflictError(input.floorId, "generating", currentRow.state);
        }

        const floorRow = tx
          .select()
          .from(floors)
          .where(eq(floors.id, input.floorId))
          .limit(1)
          .all()[0];

        if (!floorRow) {
          throw new FloorNotFoundError(input.floorId);
        }

        return {
          floor: toFloorEntity(floorRow),
          assistantMessage,
          variableCommit,
        };
      });
    } catch (error) {
      if (error instanceof MemoryPersistError) {
        try {
          await this.eventBus.emit("memory.persist_failed", {
            floorId: input.floorId,
            sessionId: input.sessionId,
            error: normalizeError(error.cause ?? error),
          });
        } catch {
          // best-effort
        }
      }

      throw error;
    }

    await this.emitPostCommitEvents(
      transactionResult.floor,
      transactionResult.variableCommit.promotedVariables,
      pendingEvents
    );

    return {
      floorId: input.floorId,
      outputPageId: transactionResult.assistantMessage.pageId,
      assistantMessageId: transactionResult.assistantMessage.messageId,
      finalState: "committed",
      usage,
    };
  }

  private async emitPostCommitEvents(
    floor: FloorEntity,
    promotedVariables: VariableEntry[],
    pendingEvents: PendingCoreEvent[]
  ): Promise<void> {
    for (const event of pendingEvents) {
      try {
        await this.eventBus.emit(event.name, event.payload as never);
      } catch {
        // 事务后的事件广播属于 best-effort，不能反向影响已完成的 commit。
      }
    }

    try {
      await this.eventBus.emit("floor.stateChanged", {
        floor,
        previousState: "generating",
        newState: "committed",
      });
    } catch {
      // best-effort
    }

    try {
      await this.eventBus.emit("floor.committed", {
        floor,
        promotedVariables,
      });
    } catch {
      // best-effort
    }
  }
}
