import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";

import { DEFAULT_ADMIN_ACCOUNT_ID } from "../src/accounts/constants.js";
import { createDatabase, type DatabaseConnection } from "../src/db/client.js";
import { accounts, runtimeJobs, sessions } from "../src/db/schema.js";
import { LocalChatTransferArtifactStore } from "../src/services/chat-transfer-artifacts.js";
import { registerAuth } from "../src/plugins/auth.js";
import { registerChatTransferJobRoutes } from "../src/routes/chat-transfer-jobs.js";

async function seedDefaultAccount(database: DatabaseConnection, now: number): Promise<void> {
  await database.db.insert(accounts).values({
    id: DEFAULT_ADMIN_ACCOUNT_ID,
    name: DEFAULT_ADMIN_ACCOUNT_ID,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing().run();
}

describe("chat transfer job routes", () => {
  let app: FastifyInstance;
  let database: DatabaseConnection;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "tavern-chat-transfer-routes-"));
    app = Fastify({ logger: false });
    database = createDatabase(":memory:");
    await registerAuth(app, { mode: "off" }, {
      db: database.db,
      accountMode: "single",
      defaultAccountId: DEFAULT_ADMIN_ACCOUNT_ID,
    });
    await registerChatTransferJobRoutes(app, database, { artifactDir: tempDir });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    database.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("lists jobs and supports retry / cancel actions", async () => {
    const now = 1_735_910_000_000;
    await seedDefaultAccount(database, now);
    await database.db.insert(sessions).values({
      id: "session-1",
      title: "Session 1",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      status: "active",
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing().run();

    await database.db.insert(runtimeJobs).values([
      {
        id: "job-dead",
        jobType: "chat_transfer.import_chat",
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scopeType: "chat_transfer",
        scopeKey: "job:job-dead",
        sessionId: null,
        floorId: null,
        pageId: null,
        status: "dead_letter",
        phase: "parsing",
        payloadJson: JSON.stringify({ inputArtifactPath: "job-dead/input.txt", inputBytes: 12 }),
        stateJson: JSON.stringify({ format: null }),
        resultJson: null,
        attemptCount: 5,
        maxAttempts: 5,
        availableAt: now,
        startedAt: null,
        finishedAt: now,
        leaseOwner: null,
        leaseUntil: null,
        basedOnRevision: null,
        dedupeKey: null,
        progressCurrent: 1,
        progressTotal: 4,
        progressMessage: "failed",
        lastError: "boom",
        lastErrorCode: null,
        lastErrorClass: "Error",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "job-pending",
        jobType: "chat_transfer.export_chat",
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scopeType: "chat_transfer",
        scopeKey: "session:session-1",
        sessionId: "session-1",
        floorId: null,
        pageId: null,
        status: "pending",
        phase: "queued",
        payloadJson: JSON.stringify({ sessionId: "session-1", format: "thchat", includeVariables: true, includeMemories: true }),
        stateJson: JSON.stringify({ format: "thchat" }),
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
        progressTotal: 4,
        progressMessage: "queued",
        lastError: null,
        lastErrorCode: null,
        lastErrorClass: null,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const listRes = await app.inject({ method: "GET", url: "/chat-transfer-jobs?status=dead_letter" });
    expect(listRes.statusCode, listRes.body).toBe(200);
    expect(listRes.json<{ data: Array<{ id: string; status: string }> }>().data).toEqual([
      expect.objectContaining({ id: "job-dead", status: "dead_letter" }),
    ]);

    const retryRes = await app.inject({ method: "POST", url: "/chat-transfer-jobs/job-dead/retry" });
    expect(retryRes.statusCode, retryRes.body).toBe(200);

    const cancelRes = await app.inject({ method: "POST", url: "/chat-transfer-jobs/job-pending/cancel" });
    expect(cancelRes.statusCode, cancelRes.body).toBe(200);

    const [retried] = await database.db.select().from(runtimeJobs).where(eq(runtimeJobs.id, "job-dead"));
    expect(retried).toMatchObject({
      status: "retry_waiting",
      phase: "queued",
      progressCurrent: 0,
      lastError: null,
    });

    const [cancelled] = await database.db.select().from(runtimeJobs).where(eq(runtimeJobs.id, "job-pending"));
    expect(cancelled).toMatchObject({
      status: "cancelled",
      leaseOwner: null,
      leaseUntil: null,
    });
  });

  it("downloads export artifacts and reports expired files", async () => {
    const now = Date.now();
    await seedDefaultAccount(database, now);
    await database.db.insert(sessions).values([
      {
        id: "session-1",
        title: "Session 1",
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        status: "active",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "session-2",
        title: "Session 2",
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        status: "active",
        createdAt: now,
        updatedAt: now,
      },
    ]).onConflictDoNothing().run();

    const artifactStore = new LocalChatTransferArtifactStore(tempDir);
    const outputPath = artifactStore.buildJobArtifactPath("job-export", "output.jsonl");
    await artifactStore.writeText(outputPath, JSON.stringify({ hello: "world" }));

    await database.db.insert(runtimeJobs).values([
      {
        id: "job-export",
        jobType: "chat_transfer.export_chat",
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scopeType: "chat_transfer",
        scopeKey: "session:session-1",
        sessionId: "session-1",
        floorId: null,
        pageId: null,
        status: "succeeded",
        phase: "completed",
        payloadJson: JSON.stringify({ sessionId: "session-1", format: "st_jsonl", includeVariables: false, includeMemories: false }),
        stateJson: JSON.stringify({
          format: "st_jsonl",
          outputArtifactPath: outputPath,
          outputExpiresAt: now + 60_000,
          resultSessionId: "session-1",
        }),
        resultJson: JSON.stringify({ fileName: "archive.jsonl", contentType: "application/x-ndjson; charset=utf-8", sessionId: "session-1", format: "st_jsonl", messageCount: 1, byteLength: 17 }),
        attemptCount: 1,
        maxAttempts: 5,
        availableAt: now,
        startedAt: now,
        finishedAt: now,
        leaseOwner: null,
        leaseUntil: null,
        basedOnRevision: null,
        dedupeKey: null,
        progressCurrent: 4,
        progressTotal: 4,
        progressMessage: "completed",
        lastError: null,
        lastErrorCode: null,
        lastErrorClass: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "job-expired",
        jobType: "chat_transfer.export_chat",
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scopeType: "chat_transfer",
        scopeKey: "session:session-2",
        sessionId: "session-2",
        floorId: null,
        pageId: null,
        status: "succeeded",
        phase: "completed",
        payloadJson: JSON.stringify({ sessionId: "session-2", format: "thchat", includeVariables: true, includeMemories: true }),
        stateJson: JSON.stringify({
          format: "thchat",
          outputArtifactPath: outputPath,
          outputExpiresAt: now - 1,
          resultSessionId: "session-2",
        }),
        resultJson: JSON.stringify({ fileName: "expired.thchat", contentType: "application/json; charset=utf-8", sessionId: "session-2", format: "thchat", messageCount: 1, byteLength: 12 }),
        attemptCount: 1,
        maxAttempts: 5,
        availableAt: now,
        startedAt: now,
        finishedAt: now,
        leaseOwner: null,
        leaseUntil: null,
        basedOnRevision: null,
        dedupeKey: null,
        progressCurrent: 4,
        progressTotal: 4,
        progressMessage: "completed",
        lastError: null,
        lastErrorCode: null,
        lastErrorClass: null,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const fileRes = await app.inject({ method: "GET", url: "/chat-transfer-jobs/job-export/file" });
    expect(fileRes.statusCode, fileRes.body).toBe(200);
    expect(fileRes.headers["content-disposition"]).toContain('filename="archive.jsonl"');
    expect(fileRes.headers["content-type"]).toContain("application/x-ndjson");
    expect(fileRes.body).toBe(JSON.stringify({ hello: "world" }));

    const expiredRes = await app.inject({ method: "GET", url: "/chat-transfer-jobs/job-expired/file" });
    expect(expiredRes.statusCode).toBe(410);
    expect(expiredRes.json<{ error: { code: string } }>().error.code).toBe("artifact_expired");
  });
});
