import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { DEFAULT_ADMIN_ACCOUNT_ID } from "../src/accounts/constants.js";
import { createDatabase, type DatabaseConnection } from "../src/db/client.js";
import { accounts, memoryEdges, memoryItems, runtimeJobs, runtimeScopeStates } from "../src/db/schema.js";
import { registerAuth } from "../src/plugins/auth.js";
import { registerMemoryJobRoutes } from "../src/routes/memory-jobs.js";
import { registerMemoryRoutes } from "../src/routes/memories.js";
import {
  MEMORY_RUNTIME_SCOPE_TYPE,
  buildMemoryRuntimeScopeKey,
  fromMemoryRuntimeJobType,
  parseMemoryRuntimeScopeKey,
  readMemoryRuntimeScopeMetadata,
  toMemoryRuntimeJobType,
} from "../src/services/memory-runtime-job-definitions.js";

async function seedDefaultAccount(database: DatabaseConnection, now: number): Promise<void> {
  await database.db.insert(accounts).values({
    id: DEFAULT_ADMIN_ACCOUNT_ID,
    name: DEFAULT_ADMIN_ACCOUNT_ID,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing().run();
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

function toRuntimeScopeState(scope: "global" | "chat" | "floor", scopeId: string, now: number, lastProcessedFloorNo: number | null, lastCompactionAt: number | null) {
  return {
    accountId: DEFAULT_ADMIN_ACCOUNT_ID,
    scopeType: MEMORY_RUNTIME_SCOPE_TYPE,
    scopeKey: buildMemoryRuntimeScopeKey(scope, scopeId),
    revision: 0,
    leaseOwner: null,
    leaseUntil: null,
    lastProcessedAt: now,
    lastSuccessJobId: null,
    metadataJson: JSON.stringify({
      lastProcessedFloorNo,
      lastCompactionAt,
    }),
    updatedAt: now,
  } as const;
}

describe("memory admin routes", () => {
  let app: FastifyInstance;
  let database: DatabaseConnection;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    database = createDatabase(":memory:");
    await registerAuth(app, { mode: "off" }, {
      db: database.db,
      accountMode: "single",
      defaultAccountId: DEFAULT_ADMIN_ACCOUNT_ID,
    });
  });

  afterEach(async () => {
    await app.close();
    database.close();
  });

  it("lists memory jobs and supports retry / cancel admin actions", async () => {
    const now = 1_735_710_000_000;
    await seedDefaultAccount(database, now);
    await registerMemoryJobRoutes(app, database, { enableBackgroundWorker: true });

    await database.db.insert(runtimeJobs).values([
      {
        id: "job-dead",
        jobType: toMemoryRuntimeJobType("maintenance"),
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scopeType: MEMORY_RUNTIME_SCOPE_TYPE,
        scopeKey: buildMemoryRuntimeScopeKey("chat", "session-1"),
        sessionId: null,
        floorId: null,
        pageId: null,
        status: "dead_letter",
        phase: null,
        payloadJson: JSON.stringify({ scope: "chat", scopeId: "session-1" }),
        stateJson: null,
        resultJson: null,
        attemptCount: 5,
        maxAttempts: 5,
        availableAt: now,
        startedAt: null,
        finishedAt: now,
        leaseOwner: null,
        leaseUntil: null,
        basedOnRevision: 3,
        dedupeKey: null,
        progressCurrent: 0,
        progressTotal: null,
        progressMessage: null,
        lastError: "boom",
        lastErrorCode: null,
        lastErrorClass: "Error",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "job-pending",
        jobType: toMemoryRuntimeJobType("rebuild_scope"),
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scopeType: MEMORY_RUNTIME_SCOPE_TYPE,
        scopeKey: buildMemoryRuntimeScopeKey("chat", "session-2"),
        sessionId: null,
        floorId: null,
        pageId: null,
        status: "pending",
        phase: null,
        payloadJson: JSON.stringify({ scope: "chat", scopeId: "session-2" }),
        stateJson: null,
        resultJson: null,
        attemptCount: 0,
        maxAttempts: 5,
        availableAt: now,
        startedAt: null,
        finishedAt: null,
        leaseOwner: null,
        leaseUntil: null,
        basedOnRevision: null,
        dedupeKey: null,
        progressCurrent: 0,
        progressTotal: null,
        progressMessage: null,
        lastError: null,
        lastErrorCode: null,
        lastErrorClass: null,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const listResponse = await app.inject({
      method: "GET",
      url: "/memory/jobs?status=dead_letter",
    });

    expect(listResponse.statusCode, listResponse.body).toBe(200);
    const listed = listResponse.json<{ data: Array<{ id: string; status: string }> }>();
    expect(listed.data).toEqual([
      expect.objectContaining({ id: "job-dead", status: "dead_letter" }),
    ]);

    const retryResponse = await app.inject({
      method: "POST",
      url: "/memory/jobs/job-dead/retry",
    });
    expect(retryResponse.statusCode, retryResponse.body).toBe(200);

    const cancelResponse = await app.inject({
      method: "POST",
      url: "/memory/jobs/job-pending/cancel",
    });
    expect(cancelResponse.statusCode, cancelResponse.body).toBe(200);

    const [retriedRow] = await database.db.select().from(runtimeJobs).where(eq(runtimeJobs.id, "job-dead"));
    const retried = toLegacyMemoryJob(retriedRow!);
    expect(retried).toMatchObject({
      status: "retry_waiting",
      attemptCount: 0,
      basedOnRevision: null,
      lastError: null,
      finishedAt: null,
    });

    const [cancelledRow] = await database.db.select().from(runtimeJobs).where(eq(runtimeJobs.id, "job-pending"));
    const cancelled = toLegacyMemoryJob(cancelledRow!);
    expect(cancelled).toMatchObject({
      status: "cancelled",
      leaseOwner: null,
      leaseUntil: null,
    });
  });

  it("supports summary_tier / lifecycle_status filters and the extended relation enum", async () => {
    const now = 1_735_710_010_000;
    await seedDefaultAccount(database, now);
    await registerMemoryRoutes(app, database);

    await database.db.insert(memoryItems).values([
      {
        id: "mem-micro-compacted",
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scope: "chat",
        scopeId: "session-1",
        type: "summary",
        summaryTier: "micro",
        contentJson: JSON.stringify("Compacted micro summary"),
        importance: 0.6,
        confidence: 1,
        status: "active",
        lifecycleStatus: "compacted",
        sourceJobId: "job-1",
        tokenCountEstimate: 12,
        lastUsedAt: now,
        coverageStartFloorNo: 1,
        coverageEndFloorNo: 2,
        derivedFromCount: null,
        sourceFloorId: null,
        sourceMessageId: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "mem-macro-active",
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scope: "chat",
        scopeId: "session-1",
        type: "summary",
        summaryTier: "macro",
        contentJson: JSON.stringify("Active macro summary"),
        importance: 0.8,
        confidence: 1,
        status: "active",
        lifecycleStatus: "active",
        sourceJobId: "job-2",
        tokenCountEstimate: 24,
        lastUsedAt: now,
        coverageStartFloorNo: 1,
        coverageEndFloorNo: 8,
        derivedFromCount: 4,
        sourceFloorId: null,
        sourceMessageId: null,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const listResponse = await app.inject({
      method: "GET",
      url: "/memories?summary_tier=micro&lifecycle_status=compacted",
    });

    expect(listResponse.statusCode, listResponse.body).toBe(200);
    const payload = listResponse.json<{ data: Array<{ id: string; summary_tier: string; lifecycle_status: string }> }>();
    expect(payload.data).toEqual([
      expect.objectContaining({
        id: "mem-micro-compacted",
        summary_tier: "micro",
        lifecycle_status: "compacted",
      }),
    ]);

    const edgeCreateResponse = await app.inject({
      method: "POST",
      url: "/memory-edges",
      payload: {
        from_id: "mem-macro-active",
        to_id: "mem-micro-compacted",
        relation: "derived_from",
      },
    });
    expect(edgeCreateResponse.statusCode, edgeCreateResponse.body).toBe(201);

    const [edge] = await database.db.select().from(memoryEdges).where(and(
      eq(memoryEdges.accountId, DEFAULT_ADMIN_ACCOUNT_ID),
      eq(memoryEdges.relation, "derived_from"),
    ));
    expect(edge).toBeDefined();
  });

  it("enqueues rebuild_scope and compact_macro jobs for memory scopes", async () => {
    const now = 1_735_710_020_000;
    const sessionId = nanoid();
    await seedDefaultAccount(database, now);
    await registerMemoryJobRoutes(app, database, { enableBackgroundWorker: true });

    await database.db.insert(memoryItems).values(
      Array.from({ length: 7 }, (_, index) => ({
        id: `scope-micro-${index + 1}`,
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scope: "chat" as const,
        scopeId: sessionId,
        type: "summary" as const,
        summaryTier: "micro" as const,
        contentJson: JSON.stringify(`Historical summary ${index + 1}`),
        importance: 0.6,
        confidence: 1,
        status: "active" as const,
        lifecycleStatus: "active" as const,
        sourceJobId: null,
        tokenCountEstimate: 40,
        lastUsedAt: null,
        coverageStartFloorNo: index + 1,
        coverageEndFloorNo: index + 1,
        derivedFromCount: null,
        sourceFloorId: null,
        sourceMessageId: null,
        createdAt: now - index,
        updatedAt: now - index,
      })),
    );

    await database.db.insert(runtimeScopeStates).values(toRuntimeScopeState("chat", sessionId, now, 7, null));

    const rebuildResponse = await app.inject({
      method: "POST",
      url: `/memory/scopes/chat/${sessionId}/rebuild`,
      payload: { force_compaction: true },
    });
    expect(rebuildResponse.statusCode, rebuildResponse.body).toBe(200);

    const compactResponse = await app.inject({
      method: "POST",
      url: `/memory/scopes/chat/${sessionId}/compact`,
      payload: { force: true },
    });
    expect(compactResponse.statusCode, compactResponse.body).toBe(200);
    const compactPayload = compactResponse.json<{
      data: { source_micro_ids: string[]; reason: string; job_id: string };
    }>();
    expect(compactPayload.data.source_micro_ids).toEqual(["scope-micro-1", "scope-micro-2", "scope-micro-3"]);
    expect(compactPayload.data.reason).toBe("forced");

    const rebuildJobs = await database.db.select().from(runtimeJobs).where(eq(runtimeJobs.jobType, toMemoryRuntimeJobType("rebuild_scope")));
    expect(rebuildJobs).toHaveLength(1);

    const compactJobs = await database.db.select().from(runtimeJobs).where(eq(runtimeJobs.jobType, toMemoryRuntimeJobType("compact_macro")));
    expect(compactJobs).toHaveLength(1);
    expect(JSON.parse(compactJobs[0]!.payloadJson)).toEqual(expect.objectContaining({
      force: true,
      scope: "chat",
      scopeId: sessionId,
      sourceMicroIds: ["scope-micro-1", "scope-micro-2", "scope-micro-3"],
    }));
  });

  it("keeps rebuild and compaction endpoints generic for floor scopes", async () => {
    const now = 1_735_710_030_000;
    const floorId = nanoid();
    await seedDefaultAccount(database, now);
    await registerMemoryJobRoutes(app, database, { enableBackgroundWorker: true });

    await database.db.insert(memoryItems).values(
      Array.from({ length: 7 }, (_, index) => ({
        id: `floor-micro-${index + 1}`,
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scope: "floor" as const,
        scopeId: floorId,
        type: "summary" as const,
        summaryTier: "micro" as const,
        contentJson: JSON.stringify(`Floor-scoped summary ${index + 1}`),
        importance: 0.6,
        confidence: 1,
        status: "active" as const,
        lifecycleStatus: "active" as const,
        sourceJobId: null,
        tokenCountEstimate: 30,
        lastUsedAt: null,
        coverageStartFloorNo: index + 1,
        coverageEndFloorNo: index + 1,
        derivedFromCount: null,
        sourceFloorId: floorId,
        sourceMessageId: null,
        createdAt: now - index,
        updatedAt: now - index,
      })),
    );

    await database.db.insert(runtimeScopeStates).values(toRuntimeScopeState("floor", floorId, now, 7, null));

    const rebuildResponse = await app.inject({
      method: "POST",
      url: `/memory/scopes/floor/${floorId}/rebuild`,
      payload: { force_compaction: true },
    });
    expect(rebuildResponse.statusCode, rebuildResponse.body).toBe(200);

    const compactResponse = await app.inject({
      method: "POST",
      url: `/memory/scopes/floor/${floorId}/compact`,
      payload: { force: true },
    });
    expect(compactResponse.statusCode, compactResponse.body).toBe(200);

    const [rebuildRow] = await database.db.select().from(runtimeJobs).where(eq(runtimeJobs.jobType, toMemoryRuntimeJobType("rebuild_scope")));
    const rebuildJob = toLegacyMemoryJob(rebuildRow!);
    expect(rebuildJob).toBeDefined();
    expect(JSON.parse(rebuildRow!.payloadJson)).toEqual(expect.objectContaining({
      scope: "floor",
      scopeId: floorId,
      forceCompaction: true,
    }));

    const [compactRow] = await database.db.select().from(runtimeJobs).where(eq(runtimeJobs.jobType, toMemoryRuntimeJobType("compact_macro")));
    const compactJob = toLegacyMemoryJob(compactRow!);
    expect(compactJob).toBeDefined();
    expect(compactJob).toMatchObject({
      scope: "floor",
      scopeId: floorId,
      status: "pending",
    });
    expect(JSON.parse(compactRow!.payloadJson)).toEqual(expect.objectContaining({
      scope: "floor",
      scopeId: floorId,
      sourceMicroIds: ["floor-micro-1", "floor-micro-2", "floor-micro-3"],
    }));
    expect(JSON.parse(compactRow!.payloadJson)).not.toHaveProperty("sessionId");
  });

  it("keeps rebuild and compaction endpoints generic for global scopes", async () => {
    const now = 1_735_710_040_000;
    await seedDefaultAccount(database, now);
    await registerMemoryJobRoutes(app, database, { enableBackgroundWorker: true });

    await database.db.insert(memoryItems).values(
      Array.from({ length: 7 }, (_, index) => ({
        id: `global-micro-${index + 1}`,
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scope: "global" as const,
        scopeId: DEFAULT_ADMIN_ACCOUNT_ID,
        type: "summary" as const,
        summaryTier: "micro" as const,
        contentJson: JSON.stringify(`Global summary ${index + 1}`),
        importance: 0.6,
        confidence: 1,
        status: "active" as const,
        lifecycleStatus: "active" as const,
        sourceJobId: null,
        tokenCountEstimate: 35,
        lastUsedAt: null,
        coverageStartFloorNo: 10 + index,
        coverageEndFloorNo: 10 + index,
        derivedFromCount: null,
        sourceFloorId: null,
        sourceMessageId: null,
        createdAt: now - index,
        updatedAt: now - index,
      })),
    );

    await database.db.insert(runtimeScopeStates).values(toRuntimeScopeState("global", DEFAULT_ADMIN_ACCOUNT_ID, now, 16, null));

    const rebuildResponse = await app.inject({
      method: "POST",
      url: `/memory/scopes/global/${DEFAULT_ADMIN_ACCOUNT_ID}/rebuild`,
      payload: { force_compaction: true },
    });
    expect(rebuildResponse.statusCode, rebuildResponse.body).toBe(200);

    const compactResponse = await app.inject({
      method: "POST",
      url: `/memory/scopes/global/${DEFAULT_ADMIN_ACCOUNT_ID}/compact`,
      payload: { force: true },
    });
    expect(compactResponse.statusCode, compactResponse.body).toBe(200);

    const [rebuildRow] = await database.db.select().from(runtimeJobs).where(eq(runtimeJobs.jobType, toMemoryRuntimeJobType("rebuild_scope")));
    expect(rebuildRow).toBeDefined();
    expect(JSON.parse(rebuildRow!.payloadJson)).toEqual(expect.objectContaining({
      scope: "global",
      scopeId: DEFAULT_ADMIN_ACCOUNT_ID,
      forceCompaction: true,
    }));

    const [compactRow] = await database.db.select().from(runtimeJobs).where(eq(runtimeJobs.jobType, toMemoryRuntimeJobType("compact_macro")));
    const compactJob = toLegacyMemoryJob(compactRow!);
    expect(compactJob).toBeDefined();
    expect(compactJob).toMatchObject({
      scope: "global",
      scopeId: DEFAULT_ADMIN_ACCOUNT_ID,
      status: "pending",
    });
    expect(JSON.parse(compactRow!.payloadJson)).toEqual(expect.objectContaining({
      scope: "global",
      scopeId: DEFAULT_ADMIN_ACCOUNT_ID,
      sourceMicroIds: ["global-micro-1", "global-micro-2", "global-micro-3"],
    }));
    expect(JSON.parse(compactRow!.payloadJson)).not.toHaveProperty("sessionId");
  });
});
