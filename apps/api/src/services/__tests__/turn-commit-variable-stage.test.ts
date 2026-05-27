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
  sessionStateMutations,
  variablePromotionTraces,
  variables,
} from "../../db/schema.js";
import { ChatMessagePersistence } from "../chat-message-persistence.js";
import { TurnCommitService } from "../turn-commit-service.js";
import { SessionStateService } from "../../session-state/session-state-service.js";
import { SessionStateCustomNamespaceService } from "../../session-state/session-state-custom-namespace-service.js";

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
  let sessionStateService: SessionStateService;
  let customNamespaceService: SessionStateCustomNamespaceService;

  beforeEach(() => {
    database = createDatabase(":memory:");
    eventBus = createEventBus();
    customNamespaceService = new SessionStateCustomNamespaceService(database.db, { clientData: { domainPurgeGracePeriodMs: 604_800_000, defaultMaxItemSizeBytes: 1_048_576, defaultQuotaMaxEntries: 10_000, defaultQuotaMaxBytes: 10_485_760, maxDomainsPerAccount: 64, maxTotalEntriesPerAccount: 100_000, maxTotalBytesPerAccount: 104_857_600 } });
    service = new TurnCommitService(
      database.db,
      new ChatMessagePersistence(database.db, new SimpleTokenCounter()),
      eventBus,
      {
        sessionStateService: (sessionStateService = new SessionStateService(database.db, {
          clientData: {
            defaultMaxItemSizeBytes: 1_048_576,
            defaultQuotaMaxEntries: 10_000,
            defaultQuotaMaxBytes: 10_485_760,
            maxDomainsPerAccount: 64,
            maxTotalEntriesPerAccount: 100_000,
            maxTotalBytesPerAccount: 104_857_600,
            domainPurgeGracePeriodMs: 604_800_000,
          },
          customNamespaceService,
        })),
      },
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

    const commitResult = await service.commit({
      accountId: ACCOUNT_ID,
      floorId,
      sessionId,
      execution,
      committedAt,
      variableCommit: { pageId },
    });
    const outputPageId = commitResult.outputPageId;

    const [stagedWrite] = await database.db.select().from(pageStagedVariableWrites).where(eq(pageStagedVariableWrites.pageId, outputPageId));
    expect(stagedWrite).toMatchObject({
      pageId: outputPageId,
      floorId,
      sessionId,
      branchId: "main",
      sourceKind: "tool",
      actorClientId: null,
      decisionCode: "promotion_allowed",
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
      eq(variables.scopeId, outputPageId),
      eq(variables.key, "mood"),
    ));
    expect(pageVariable && JSON.parse(pageVariable.valueJson)).toBe("steady");

    const [floorVariable] = await database.db.select().from(variables).where(and(
      eq(variables.scope, "floor"),
      eq(variables.scopeId, floorId),
      eq(variables.key, "mood"),
    ));
    expect(floorVariable && JSON.parse(floorVariable.valueJson)).toBe("steady");

    const [trace] = await database.db.select().from(variablePromotionTraces).where(eq(variablePromotionTraces.pageId, outputPageId));
    expect(trace).toMatchObject({
      pageId: outputPageId,
      floorId,
      sessionId,
      branchId: "main",
      stagedWriteId: stagedWrite?.id,
      key: "mood",
      fromScope: "page",
      fromScopeId: outputPageId,
      toScope: "floor",
      toScopeId: floorId,
      sourceKind: "tool",
      actorClientId: null,
      sourceJson: JSON.stringify({ toolName: "set_variable", providerId: "builtin", nodeId: "node-1" }),
      evidenceJson: expect.any(String),
      decisionCode: "promotion_allowed",
      decisionReason: null,
      conflictPolicy: "replace",
      createdAt: committedAt,
    });

    expect(variableSetHandler).toHaveBeenCalledWith(expect.objectContaining({
      sessionId,
      branchId: "main",
      entry: expect.objectContaining({ scope: "page", scopeId: outputPageId, key: "mood", value: "steady" }),
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

    const commitResult = await service.commit({
      accountId: ACCOUNT_ID,
      floorId,
      sessionId,
      execution,
      committedAt,
      variableCommit: { pageId },
    });
    const outputPageId = commitResult.outputPageId;

    const [stagedWrite] = await database.db.select().from(pageStagedVariableWrites).where(eq(pageStagedVariableWrites.pageId, outputPageId));
    expect(stagedWrite).toMatchObject({ key: "hp", status: "accepted_page_only", decisionCode: "promotion_allowed" });

    const pageRows = await database.db.select().from(variables).where(and(
      eq(variables.scope, "page"),
      eq(variables.scopeId, outputPageId),
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

      const commitResult = await service.commit({
        accountId: ACCOUNT_ID,
        floorId,
        sessionId,
        execution,
        committedAt,
        variableCommit: {
          pageId,
          pageDecision: { status, decisionReason },
        },
      });
      const outputPageId = commitResult.outputPageId;

      const stagedWrites = await database.db.select().from(pageStagedVariableWrites).where(eq(pageStagedVariableWrites.pageId, outputPageId));
      const pageRows = await database.db.select().from(variables).where(and(
        eq(variables.scope, "page"),
        eq(variables.scopeId, outputPageId),
      ));
      const floorRows = await database.db.select().from(variables).where(and(
        eq(variables.scope, "floor"),
        eq(variables.scopeId, floorId),
      ));
      const traces = await database.db.select().from(variablePromotionTraces).where(eq(variablePromotionTraces.pageId, outputPageId));
      const expectedDecisionCode = status === "rerouted_to_session_state" ? "rerouted_to_session_state" : "policy_forbidden";

      expect(stagedWrites).toContainEqual(expect.objectContaining({ key: "threat", status, decisionReason, decisionCode: expectedDecisionCode, resolvedAt: committedAt }));
      expect(pageRows).toEqual([]);
      expect(floorRows).toEqual([]);
      expect(traces).toEqual([]);
      expect(variableSetHandler).not.toHaveBeenCalled();
      expect(variablePromotedHandler).not.toHaveBeenCalled();
    },
  );

  it("reroutes session-state candidate variable writes during turn commit and records page/session-state inspection links", async () => {
    const sessionId = nanoid();
    const floorId = nanoid();
    const pageId = nanoid();
    const now = 1_735_700_330_000;
    const committedAt = now + 100;

    await seedAccount(database, now);
    await seedSession(database, sessionId, now);
    await seedFloor(database, sessionId, floorId, now);
    await seedInputPage(database, floorId, pageId, now);

    customNamespaceService.registerNamespace({
      accountId: ACCOUNT_ID,
      sessionId,
      namespace: "custom.world",
      logicalOwnerType: "test",
      logicalOwnerId: "turn-commit-variable-stage-test",
    });

    const execution: TurnExecutionResult = {
      floorId,
      finalState: "generating",
      generatedText: "Rerouted write.",
      rawText: "Rerouted write.",
      summaries: [],
      totalUsage: {
        promptTokens: 5,
        completionTokens: 7,
        totalTokens: 12,
      },
      bufferedVariableMutations: [
        {
          runId: "run-reroute-commit",
          generationAttemptNo: 1,
          scope: "page",
          scopeId: pageId,
          key: "scene_state",
          value: { weather: "rain" },
          intent: "promote_to_floor_on_accept",
          source: {
            toolName: "set_variable",
            providerId: "builtin",
            targetSurface: "session_state",
            sessionStateNamespace: "custom.world",
            sessionStateSlot: "scene",
          },
          bufferedAt: now + 10,
        },
      ],
    };

    const commitResult = await service.commit({
      accountId: ACCOUNT_ID,
      floorId,
      sessionId,
      execution,
      committedAt,
      variableCommit: {
        pageId,
        rerouteToSessionState: true,
      },
    });
    const outputPageId = commitResult.outputPageId;

    const outputPage = await database.db.select().from(messagePages).where(and(eq(messagePages.floorId, floorId), eq(messagePages.pageKind, "output"))).all()[0];
    const [stagedWrite] = await database.db.select().from(pageStagedVariableWrites).where(eq(pageStagedVariableWrites.pageId, outputPage?.id ?? ""));
    const [trace] = await database.db.select().from(variablePromotionTraces).where(eq(variablePromotionTraces.pageId, outputPage?.id ?? ""));
    const [mutation] = await database.db.select().from(sessionStateMutations).where(eq(sessionStateMutations.sourcePageId, outputPageId));
    const floorRows = await database.db.select().from(variables).where(and(
      eq(variables.scope, "floor"),
      eq(variables.scopeId, floorId),
    ));

    expect(floorRows).toEqual([]);
    expect(stagedWrite).toBeDefined();
    expect(stagedWrite).toMatchObject({
      status: "rerouted_to_session_state",
      decisionCode: "rerouted_to_session_state",
      linkedSessionStateMutationId: mutation?.id,
    });
    expect(trace).toMatchObject({
      key: "scene_state",
      toScope: "session_state",
      toScopeId: "session_state:custom.world:scene",
      linkedSessionStateMutationId: mutation?.id,
    });
    expect(mutation).toMatchObject({
      commitMode: "variable_reroute",
      linkedVariableStageId: stagedWrite?.id,
      sourcePageId: outputPageId,
    });
  });
});
