import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { SimpleTokenCounter, createEventBus, type TurnExecutionResult } from "@tavern/core";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import {
  accounts,
  floors,
  messagePages,
  pageStagedVariableWrites,
  sessions,
  variablePromotionTraces,
  variables,
} from "../../db/schema.js";
import { ChatMessagePersistence } from "../chat-message-persistence.js";
import { TurnCommitService } from "../turn-commit-service.js";

const ACCOUNT_ID = "default-admin";

async function seedAccount(database: DatabaseConnection, now: number): Promise<void> {
  await database.db.insert(accounts).values({
    id: ACCOUNT_ID,
    name: "Default Admin",
    createdAt: now,
    updatedAt: now,
  })
    .onConflictDoNothing()
    .run();
}

async function seedSession(database: DatabaseConnection, sessionId: string, now: number): Promise<void> {
  await database.db.insert(sessions).values({
    id: sessionId,
    title: "Turn Commit Stage Test",
    accountId: ACCOUNT_ID,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
}

async function seedFloor(database: DatabaseConnection, sessionId: string, floorId: string, now: number): Promise<void> {
  await database.db.insert(floors).values({
    id: floorId,
    sessionId,
    floorNo: 0,
    branchId: "main",
    parentFloorId: null,
    state: "generating",
    tokenIn: 0,
    tokenOut: 0,
    createdAt: now,
    updatedAt: now,
  });
}

async function seedInputPage(database: DatabaseConnection, floorId: string, pageId: string, now: number): Promise<void> {
  await database.db.insert(messagePages).values({
    id: pageId,
    floorId,
    pageNo: 0,
    pageKind: "input",
    isActive: true,
    version: 1,
    checksum: null,
    createdAt: now,
    updatedAt: now,
  });
}

describe("TurnCommitService variable stage chain", () => {
  let database: DatabaseConnection;
  let eventBus: ReturnType<typeof createEventBus>;
  let service: TurnCommitService;

  beforeEach(() => {
    database = createDatabase(":memory:");
    eventBus = createEventBus();
    service = new TurnCommitService(
      database.db,
      new ChatMessagePersistence(database.db, new SimpleTokenCounter()),
      eventBus,
    );
  });

  afterEach(() => {
    database.close();
  });

  it("stages buffered writes, materializes accepted page truth, and records page -> floor promotion traces", async () => {
    const sessionId = nanoid();
    const floorId = nanoid();
    const pageId = nanoid();
    const now = 1_735_700_300_000;
    const committedAt = now + 100;
    const variableSetHandler = vi.fn();
    const variablePromotedHandler = vi.fn();
    eventBus.on("variable.set", variableSetHandler);
    eventBus.on("variable.promoted", variablePromotedHandler);

    await seedAccount(database, now);
    await seedSession(database, sessionId, now);
    await seedFloor(database, sessionId, floorId, now);
    await seedInputPage(database, floorId, pageId, now);

    const execution: TurnExecutionResult = {
      floorId,
      finalState: "generating",
      generatedText: "Accepted write.",
      rawText: "Accepted write.",
      summaries: [],
      totalUsage: {
        promptTokens: 5,
        completionTokens: 7,
        totalTokens: 12,
      },
      bufferedVariableMutations: [
        {
          runId: "run-1",
          generationAttemptNo: 1,
          scope: "page",
          scopeId: pageId,
          key: "mood",
          value: "steady",
          intent: "promote_to_floor_on_accept",
          reason: "builtin:set_variable",
          source: { toolName: "set_variable", providerId: "builtin", nodeId: "node-1" },
          bufferedAt: now + 10,
        },
      ],
    };

    await service.commit({
      accountId: ACCOUNT_ID,
      floorId,
      sessionId,
      execution,
      committedAt,
      variableCommit: { pageId },
    });

    const [stagedWrite] = await database.db.select().from(pageStagedVariableWrites).where(eq(pageStagedVariableWrites.pageId, pageId));
    expect(stagedWrite).toMatchObject({
      pageId,
      floorId,
      sessionId,
      branchId: "main",
      key: "mood",
      intent: "promote_to_floor_on_accept",
      conflictPolicy: "replace",
      reason: "builtin:set_variable",
      status: "promoted",
      resolvedAt: committedAt,
    });
    expect(stagedWrite && JSON.parse(stagedWrite.sourceJson)).toEqual({ toolName: "set_variable", providerId: "builtin", nodeId: "node-1" });
    expect(stagedWrite && JSON.parse(stagedWrite.evidenceJson)).toEqual(expect.objectContaining({ runId: "run-1", generationAttemptNo: 1, scope: "page", scopeId: pageId }));

    const [pageVariable] = await database.db.select().from(variables).where(and(
      eq(variables.scope, "page"),
      eq(variables.scopeId, pageId),
      eq(variables.key, "mood"),
    ));
    expect(pageVariable && JSON.parse(pageVariable.valueJson)).toBe("steady");

    const [floorVariable] = await database.db.select().from(variables).where(and(
      eq(variables.scope, "floor"),
      eq(variables.scopeId, floorId),
      eq(variables.key, "mood"),
    ));
    expect(floorVariable && JSON.parse(floorVariable.valueJson)).toBe("steady");

    const [trace] = await database.db.select().from(variablePromotionTraces).where(eq(variablePromotionTraces.pageId, pageId));
    expect(trace).toMatchObject({
      pageId,
      floorId,
      sessionId,
      branchId: "main",
      stagedWriteId: stagedWrite?.id,
      key: "mood",
      fromScope: "page",
      fromScopeId: pageId,
      toScope: "floor",
      toScopeId: floorId,
      conflictPolicy: "replace",
      createdAt: committedAt,
    });

    expect(variableSetHandler).toHaveBeenCalledWith(expect.objectContaining({
      sessionId,
      branchId: "main",
      entry: expect.objectContaining({ scope: "page", scopeId: pageId, key: "mood", value: "steady" }),
      isNew: true,
    }));
    expect(variablePromotedHandler).toHaveBeenCalledWith(expect.objectContaining({
      sessionId,
      branchId: "main",
      key: "mood",
      fromScope: "page",
      toScope: "floor",
      value: "steady",
    }));
  });

  it("keeps explicit page_only writes on the accepted page without floor promotion", async () => {
    const sessionId = nanoid();
    const floorId = nanoid();
    const pageId = nanoid();
    const now = 1_735_700_310_000;
    const committedAt = now + 100;
    const variablePromotedHandler = vi.fn();
    eventBus.on("variable.promoted", variablePromotedHandler);

    await seedAccount(database, now);
    await seedSession(database, sessionId, now);
    await seedFloor(database, sessionId, floorId, now);
    await seedInputPage(database, floorId, pageId, now);

    const execution: TurnExecutionResult = {
      floorId,
      finalState: "generating",
      generatedText: "Accepted page-only write.",
      rawText: "Accepted page-only write.",
      summaries: [],
      totalUsage: {
        promptTokens: 5,
        completionTokens: 7,
        totalTokens: 12,
      },
      bufferedVariableMutations: [
        {
          runId: "run-2",
          generationAttemptNo: 1,
          scope: "page",
          scopeId: pageId,
          key: "hp",
          value: 95,
          intent: "page_only",
          bufferedAt: now + 10,
        },
      ],
    };

    await service.commit({
      accountId: ACCOUNT_ID,
      floorId,
      sessionId,
      execution,
      committedAt,
      variableCommit: { pageId },
    });

    const [stagedWrite] = await database.db.select().from(pageStagedVariableWrites).where(eq(pageStagedVariableWrites.pageId, pageId));
    expect(stagedWrite).toMatchObject({ key: "hp", status: "accepted_page_only" });

    const pageRows = await database.db.select().from(variables).where(and(
      eq(variables.scope, "page"),
      eq(variables.scopeId, pageId),
    ));
    expect(pageRows.map((row) => [row.key, JSON.parse(row.valueJson)])).toEqual([["hp", 95]]);

    const floorRows = await database.db.select().from(variables).where(and(
      eq(variables.scope, "floor"),
      eq(variables.scopeId, floorId),
    ));
    expect(floorRows).toEqual([]);
    expect(await database.db.select().from(variablePromotionTraces)).toEqual([]);
    expect(variablePromotedHandler).not.toHaveBeenCalled();
  });

  it.each([
    ["rejected", "page_rejected"],
    ["discarded", "page_not_accepted"],
    ["rerouted_to_session_state", "write_rerouted_to_session_state"],
  ] as const)(
    "marks staged writes as %s without materializing durable variables when the page is not accepted",
    async (status, decisionReason) => {
      const sessionId = nanoid();
      const floorId = nanoid();
      const pageId = nanoid();
      const now = 1_735_700_320_000;
      const committedAt = now + 100;
      const variableSetHandler = vi.fn();
      const variablePromotedHandler = vi.fn();
      eventBus.on("variable.set", variableSetHandler);
      eventBus.on("variable.promoted", variablePromotedHandler);

      await seedAccount(database, now);
      await seedSession(database, sessionId, now);
      await seedFloor(database, sessionId, floorId, now);
      await seedInputPage(database, floorId, pageId, now);

      const execution: TurnExecutionResult = {
        floorId,
        finalState: "generating",
        generatedText: `Non-accepted write (${status}).`,
        rawText: `Non-accepted write (${status}).`,
        summaries: [],
        totalUsage: {
          promptTokens: 5,
          completionTokens: 7,
          totalTokens: 12,
        },
        bufferedVariableMutations: [
          {
            runId: "run-3",
            generationAttemptNo: 1,
            scope: "page",
            scopeId: pageId,
            key: "threat",
            value: "high",
            intent: "promote_to_floor_on_accept",
            bufferedAt: now + 10,
          },
        ],
      };

      await service.commit({
        accountId: ACCOUNT_ID,
        floorId,
        sessionId,
        execution,
        committedAt,
        variableCommit: {
          pageId,
          pageDecision: { status },
        },
      });

      const [stagedWrite] = await database.db.select().from(pageStagedVariableWrites).where(eq(pageStagedVariableWrites.pageId, pageId));
      const pageRows = await database.db.select().from(variables).where(and(
        eq(variables.scope, "page"),
        eq(variables.scopeId, pageId),
      ));
      const floorRows = await database.db.select().from(variables).where(and(
        eq(variables.scope, "floor"),
        eq(variables.scopeId, floorId),
      ));
      const traces = await database.db.select().from(variablePromotionTraces).where(eq(variablePromotionTraces.pageId, pageId));

      expect(stagedWrite).toMatchObject({ key: "threat", status, decisionReason, resolvedAt: committedAt });
      expect(pageRows).toEqual([]);
      expect(floorRows).toEqual([]);
      expect(traces).toEqual([]);
      expect(variableSetHandler).not.toHaveBeenCalled();
      expect(variablePromotedHandler).not.toHaveBeenCalled();
    },
  );
});
