import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import {
  accounts,
  clients,
  floors,
  messagePages,
  pageStagedVariableWrites,
  sessions,
  variablePromotionTraces,
  variables,
} from "../../db/schema.js";
import { VariablePromotionService } from "../variables/commit/variable-promotion-service.js";
import { PageVariableStageService } from "../variables/stage/page-variable-stage-service.js";
import { PageVariableDecisionService } from "../variables/commit/page-variable-decision-service.js";

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
    title: "Variable governance contract",
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
    state: "committed",
    tokenIn: 0,
    tokenOut: 0,
    createdAt: now,
    updatedAt: now,
  });
}

async function seedPage(database: DatabaseConnection, input: {
  floorId: string;
  pageId: string;
  pageKind: "input" | "output";
  isActive?: boolean;
  now: number;
}): Promise<void> {
  await database.db.insert(messagePages).values({
    id: input.pageId,
    floorId: input.floorId,
    pageNo: 0,
    pageKind: input.pageKind,
    isActive: input.isActive ?? true,
    version: 1,
    checksum: null,
    createdAt: input.now,
    updatedAt: input.now,
  });
}

describe("Variable page governance closeout", () => {
  let database: DatabaseConnection;
  let stageService: PageVariableStageService;
  let promotionService: VariablePromotionService;
  let decisionService: PageVariableDecisionService;

  beforeEach(() => {
    database = createDatabase(":memory:");
    stageService = new PageVariableStageService(database.db);
    promotionService = new VariablePromotionService(database.db);
    decisionService = new PageVariableDecisionService(database.db);
  });

  afterEach(() => {
    database.close();
  });

  it("rejects non-output source pages with a normalized decision code", async () => {
    const sessionId = nanoid();
    const floorId = nanoid();
    const pageId = nanoid();
    const now = 1_736_530_000_000;

    await seedAccount(database, now);
    await seedSession(database, sessionId, now);
    await seedFloor(database, sessionId, floorId, now);
    await seedPage(database, { floorId, pageId, pageKind: "input", now });

    expect(decisionService.resolveForCommit({ floorId, pageId })).toEqual({
      status: "rejected",
      decisionCode: "source_page_not_output",
      decisionReason: "page_commit_gate_source_page_not_output",
    });
  });

  it("stores unified inspection fields on staged writes and promotion traces", async () => {
    const sessionId = nanoid();
    const floorId = nanoid();
    const pageId = nanoid();
    const now = 1_736_530_010_000;
    const committedAt = now + 100;

    await seedAccount(database, now);
    await seedSession(database, sessionId, now);
    await seedFloor(database, sessionId, floorId, now);
    await seedPage(database, { floorId, pageId, pageKind: "output", now });

    stageService.stageBufferedWrites({
      accountId: ACCOUNT_ID,
      sessionId,
      branchId: "main",
      floorId,
      pageId,
      committedAt,
      actorClientId: (() => {
        const actorClientId = "client-1";
        database.db.insert(clients).values({ id: actorClientId, accountId: ACCOUNT_ID, name: "test-client", kind: "custom", status: "active", isDefault: false, metadataJson: "{}", createdAt: now, updatedAt: now }).run();
        return actorClientId;
      })(),
      mutations: [
        {
          runId: "run-governance-1",
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
    });

    const result = promotionService.materializeAcceptedPage({
      accountId: ACCOUNT_ID,
      sessionId,
      branchId: "main",
      floorId,
      pageId,
      committedAt,
      actorClientId: "client-1",
      conflictPolicy: "replace",
    });

    expect(result.stageWrites[0]).toMatchObject({
      key: "mood",
      sourceKind: "tool",
      actorClientId: "client-1",
      decisionCode: "promotion_allowed",
      decisionReason: null,
    });
    expect(result.promotionTraces[0]).toMatchObject({
      key: "mood",
      sourceKind: "tool",
      actorClientId: "client-1",
      source: { toolName: "set_variable", providerId: "builtin", nodeId: "node-1" },
      evidence: expect.objectContaining({ runId: "run-governance-1", generationAttemptNo: 1 }),
      decisionCode: "promotion_allowed",
      decisionReason: null,
    });

    const [stagedRow] = await database.db.select().from(pageStagedVariableWrites).where(eq(pageStagedVariableWrites.pageId, pageId));
    expect(stagedRow).toMatchObject({
      sourceKind: "tool",
      actorClientId: "client-1",
      decisionCode: "promotion_allowed",
      linkedSessionStateMutationId: null,
    });

    const [traceRow] = await database.db.select().from(variablePromotionTraces).where(eq(variablePromotionTraces.pageId, pageId));
    expect(traceRow).toMatchObject({
      sourceKind: "tool",
      actorClientId: "client-1",
      decisionCode: "promotion_allowed",
      decisionReason: null,
      linkedSessionStateMutationId: null,
    });
    expect(JSON.parse(traceRow!.sourceJson)).toEqual({ toolName: "set_variable", providerId: "builtin", nodeId: "node-1" });
  });

  it("marks unaccepted writes with policy_forbidden decision codes and keeps them out of durable truth", async () => {
    const sessionId = nanoid();
    const floorId = nanoid();
    const pageId = nanoid();
    const now = 1_736_530_020_000;
    const committedAt = now + 100;

    await seedAccount(database, now);
    await seedSession(database, sessionId, now);
    await seedFloor(database, sessionId, floorId, now);
    await seedPage(database, { floorId, pageId, pageKind: "output", now });

    stageService.stageBufferedWrites({
      accountId: ACCOUNT_ID,
      sessionId,
      branchId: "main",
      floorId,
      pageId,
      committedAt,
      mutations: [
        {
          runId: "run-governance-2",
          generationAttemptNo: 1,
          scope: "page",
          scopeId: pageId,
          key: "threat",
          value: "high",
          intent: "promote_to_floor_on_accept",
          bufferedAt: now + 10,
        },
      ],
    });

    const result = promotionService.finalizePageWrites({
      accountId: ACCOUNT_ID,
      sessionId,
      branchId: "main",
      floorId,
      pageId,
      committedAt,
      pageDecision: {
        status: "rejected",
        decisionCode: "policy_forbidden",
        decisionReason: "page_rejected",
      },
    });

    expect(result.stageWrites[0]).toMatchObject({
      key: "threat",
      status: "rejected",
      decisionCode: "policy_forbidden",
      decisionReason: "page_rejected",
    });
    expect(await database.db.select().from(variables).where(and(
      eq(variables.scope, "page"),
      eq(variables.scopeId, pageId),
    ))).toEqual([]);
    expect(await database.db.select().from(variablePromotionTraces)).toEqual([]);
  });
});
