import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

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
import { VariablePromotionService } from "../variables/commit/variable-promotion-service.js";
import { PageVariableStageService } from "../variables/stage/page-variable-stage-service.js";

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
    title: "Promotion Test",
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

describe("VariablePromotionService", () => {
  let database: DatabaseConnection;
  let stageService: PageVariableStageService;
  let promotionService: VariablePromotionService;

  beforeEach(() => {
    database = createDatabase(":memory:");
    stageService = new PageVariableStageService(database.db);
    promotionService = new VariablePromotionService(database.db);
  });

  afterEach(() => {
    database.close();
  });

  it("materializes accepted page writes and records page -> floor promotions only for promoted intents", async () => {
    const sessionId = nanoid();
    const floorId = nanoid();
    const pageId = nanoid();
    const now = 1_735_700_200_000;
    const committedAt = now + 100;

    await seedAccount(database, now);
    await seedSession(database, sessionId, now);
    await seedFloor(database, sessionId, floorId, now);
    await seedInputPage(database, floorId, pageId, now);

    stageService.stageBufferedWrites({
      accountId: ACCOUNT_ID,
      sessionId,
      branchId: "main",
      floorId,
      pageId,
      committedAt,
      mutations: [
        {
          runId: "run-1",
          generationAttemptNo: 1,
          scope: "page",
          scopeId: pageId,
          key: "mood",
          value: "steady",
          intent: "promote_to_floor_on_accept",
          bufferedAt: now + 10,
        },
        {
          runId: "run-1",
          generationAttemptNo: 1,
          scope: "page",
          scopeId: pageId,
          key: "hp",
          value: 95,
          intent: "page_only",
          bufferedAt: now + 20,
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
      conflictPolicy: "replace",
    });

    expect(result).toMatchObject({
      pageId,
      floorId,
      sessionId,
      branchId: "main",
      policy: "replace",
      scannedCount: 2,
      promotedCount: 1,
      skippedCount: 0,
    });
    expect(result.pageVariables.map((item) => item.entry.key)).toEqual(["mood", "hp"]);
    expect(result.promotedVariables.map((item) => item.key)).toEqual(["mood"]);
    expect(result.promotionTraces).toHaveLength(1);
    expect(result.promotionTraces[0]).toMatchObject({
      pageId,
      floorId,
      stagedWriteId: expect.any(String),
      key: "mood",
      fromScope: "page",
      fromScopeId: pageId,
      toScope: "floor",
      toScopeId: floorId,
      conflictPolicy: "replace",
      value: "steady",
      createdAt: committedAt,
    });

    const pageRows = await database.db
      .select()
      .from(variables)
      .where(and(eq(variables.scope, "page"), eq(variables.scopeId, pageId)));
    expect(pageRows.map((row) => [row.key, JSON.parse(row.valueJson)])).toEqual([
      ["mood", "steady"],
      ["hp", 95],
    ]);

    const floorRows = await database.db
      .select()
      .from(variables)
      .where(and(eq(variables.scope, "floor"), eq(variables.scopeId, floorId)));
    expect(floorRows.map((row) => [row.key, JSON.parse(row.valueJson)])).toEqual([["mood", "steady"]]);

    const stagedRows = await database.db
      .select()
      .from(pageStagedVariableWrites)
      .where(eq(pageStagedVariableWrites.pageId, pageId));
    expect(stagedRows.map((row) => [row.key, row.status]).sort((left, right) => {
      return String(left[0]).localeCompare(String(right[0]));
    })).toEqual([
      ["hp", "accepted_page_only"],
      ["mood", "promoted"],
    ]);

    const traces = await database.db.select().from(variablePromotionTraces);
    expect(traces).toHaveLength(1);
  });

  it("keeps staged writes page-only when the floor target already exists and conflictPolicy is if_absent", async () => {
    const sessionId = nanoid();
    const floorId = nanoid();
    const pageId = nanoid();
    const now = 1_735_700_210_000;
    const committedAt = now + 100;

    await seedAccount(database, now);
    await seedSession(database, sessionId, now);
    await seedFloor(database, sessionId, floorId, now);
    await seedInputPage(database, floorId, pageId, now);
    await database.db.insert(variables).values({
      id: nanoid(),
      accountId: ACCOUNT_ID,
      scope: "floor",
      scopeId: floorId,
      key: "mood",
      valueJson: JSON.stringify("existing"),
      updatedAt: now,
    });

    stageService.stageBufferedWrites({
      accountId: ACCOUNT_ID,
      sessionId,
      branchId: "main",
      floorId,
      pageId,
      committedAt,
      mutations: [
        {
          runId: "run-2",
          generationAttemptNo: 1,
          scope: "page",
          scopeId: pageId,
          key: "mood",
          value: "new-value",
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
      conflictPolicy: "if_absent",
    });

    expect(result).toMatchObject({
      promotedCount: 0,
      skippedCount: 1,
      pageVariables: [
        expect.objectContaining({ entry: expect.objectContaining({ key: "mood", scope: "page", value: "new-value" }) }),
      ],
    });
    expect(result.stageWrites[0]).toMatchObject({
      key: "mood",
      status: "accepted_page_only",
      decisionReason: "promotion_skipped_if_absent",
    });
  });

  it.each([
    ["rejected", "page_rejected"],
    ["discarded", "page_not_accepted"],
    ["rerouted_to_session_state", "write_rerouted_to_session_state"],
  ] as const)(
    "marks %s staged writes without materializing durable variables",
    async (status, decisionReason) => {
      const sessionId = nanoid();
      const floorId = nanoid();
      const pageId = nanoid();
      const now = 1_735_700_220_000;
      const committedAt = now + 100;

      await seedAccount(database, now);
      await seedSession(database, sessionId, now);
      await seedFloor(database, sessionId, floorId, now);
      await seedInputPage(database, floorId, pageId, now);

      stageService.stageBufferedWrites({
        accountId: ACCOUNT_ID,
        sessionId,
        branchId: "main",
        floorId,
        pageId,
        committedAt,
        mutations: [
          {
            runId: "run-3",
            generationAttemptNo: 1,
            scope: "page",
            scopeId: pageId,
            key: "mood",
            value: "tense",
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
        pageDecision: { status },
      });

      expect(result).toMatchObject({
        scannedCount: 1,
        promotedCount: 0,
        skippedCount: 1,
        pageVariables: [],
        promotedVariables: [],
        promotionTraces: [],
        stageWrites: [expect.objectContaining({ key: "mood", status, decisionReason, resolvedAt: committedAt })],
      });

      const pageRows = await database.db.select().from(variables).where(and(eq(variables.scope, "page"), eq(variables.scopeId, pageId)));
      const floorRows = await database.db.select().from(variables).where(and(eq(variables.scope, "floor"), eq(variables.scopeId, floorId)));
      const traces = await database.db.select().from(variablePromotionTraces).where(eq(variablePromotionTraces.pageId, pageId));
      const [stagedRow] = await database.db.select().from(pageStagedVariableWrites).where(eq(pageStagedVariableWrites.pageId, pageId));

      expect(pageRows).toEqual([]);
      expect(floorRows).toEqual([]);
      expect(traces).toEqual([]);
      expect(stagedRow).toMatchObject({ key: "mood", status, decisionReason, resolvedAt: committedAt });
    },
  );
});
