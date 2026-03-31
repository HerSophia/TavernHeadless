import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { accounts, runtimeJobs, sessions } from "../../db/schema.js";
import { LocalChatTransferArtifactStore } from "../chat-transfer-artifacts.js";
import { ChatTransferJobScheduler } from "../chat-transfer-job-scheduler.js";
import { ChatTransferWorker } from "../chat-transfer-worker.js";
import * as retryModule from "../../lib/retry.js";
import * as publisherModule from "../chat-import-publisher.js";

const DEFAULT_ACCOUNT_ID = "default-admin";

async function seedDefaultAccount(database: DatabaseConnection, now: number): Promise<void> {
  await database.db.insert(accounts).values({
    id: DEFAULT_ACCOUNT_ID,
    name: DEFAULT_ACCOUNT_ID,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing().run();
}

describe("ChatTransferWorker", () => {
  let database: DatabaseConnection;
  let tempDir: string;

  beforeEach(async () => {
    database = createDatabase(":memory:");
    tempDir = await mkdtemp(join(tmpdir(), "tavern-chat-transfer-worker-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    database.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("processes import_chat jobs and only makes the session visible after completion", async () => {
    const now = 1_735_900_000_000;
    await seedDefaultAccount(database, now);

    const scheduler = new ChatTransferJobScheduler();
    const artifactStore = new LocalChatTransferArtifactStore(tempDir);
    const jobId = scheduler.createJobId("import_chat");
    const inputArtifactPath = artifactStore.buildJobArtifactPath(jobId, "input.txt");
    await artifactStore.writeText(inputArtifactPath, [
      JSON.stringify({ chat_metadata: { imported_from: "test" }, user_name: "Traveler", character_name: "Guide" }),
      JSON.stringify({ name: "Traveler", is_user: true, mes: "Hello" }),
      JSON.stringify({ name: "Guide", is_user: false, mes: "Welcome" }),
    ].join("\n"));

    database.db.transaction((tx) => {
      scheduler.enqueueImportChat(tx, {
        accountId: DEFAULT_ACCOUNT_ID,
        title: "Imported By Worker",
        characterId: null,
        characterVersionId: null,
        characterSnapshotJson: null,
        inputArtifactPath,
        inputBytes: 128,
        createdAt: now,
        jobId,
      });
    });

    expect(await database.db.select().from(sessions)).toHaveLength(0);

    const worker = new ChatTransferWorker(database.db, {
      artifactDir: tempDir,
      workerId: "worker-1",
      pollIntervalMs: 60_000,
    });

    await expect(worker.processOneDueJob()).resolves.toBe(true);

    const [job] = await database.db.select().from(runtimeJobs).where(eq(runtimeJobs.id, jobId));
    expect(job).toMatchObject({
      id: jobId,
      status: "succeeded",
      phase: "completed",
    });
    expect(JSON.parse(job!.resultJson ?? "null")).toEqual(expect.objectContaining({
      sessionId: expect.any(String),
    }));
    expect(JSON.parse(job!.stateJson ?? "null")).toEqual(expect.objectContaining({
      normalizedArtifactPath: expect.any(String),
      resultSessionId: expect.any(String),
    }));

    const sessionRows = await database.db.select().from(sessions).where(eq(sessions.accountId, DEFAULT_ACCOUNT_ID));
    expect(sessionRows).toHaveLength(1);
    expect(sessionRows[0]?.title).toBe("Imported By Worker");
  });

  it("moves malformed import jobs to dead_letter", async () => {
    const now = 1_735_900_010_000;
    await seedDefaultAccount(database, now);

    const scheduler = new ChatTransferJobScheduler();
    const artifactStore = new LocalChatTransferArtifactStore(tempDir);
    const jobId = scheduler.createJobId("import_chat");
    const inputArtifactPath = artifactStore.buildJobArtifactPath(jobId, "input.txt");
    await artifactStore.writeText(inputArtifactPath, JSON.stringify({ spec: "tavern_headless_chat" }));

    database.db.transaction((tx) => {
      scheduler.enqueueImportChat(tx, {
        accountId: DEFAULT_ACCOUNT_ID,
        title: "Broken",
        inputArtifactPath,
        inputBytes: 32,
        createdAt: now,
        jobId,
      });
    });

    const worker = new ChatTransferWorker(database.db, {
      artifactDir: tempDir,
      workerId: "worker-2",
      pollIntervalMs: 60_000,
    });

    await expect(worker.processOneDueJob()).resolves.toBe(true);

    const [job] = await database.db.select().from(runtimeJobs).where(eq(runtimeJobs.id, jobId));
    expect(job).toMatchObject({
      id: jobId,
      status: "dead_letter",
      lastError: expect.stringContaining("Invalid .thchat file"),
    });
  });

  it("retries import jobs when publish hits ResourceBusyError", async () => {
    const now = 1_735_900_020_000;
    await seedDefaultAccount(database, now);

    const scheduler = new ChatTransferJobScheduler();
    const artifactStore = new LocalChatTransferArtifactStore(tempDir);
    const jobId = scheduler.createJobId("import_chat");
    const inputArtifactPath = artifactStore.buildJobArtifactPath(jobId, "input.txt");
    await artifactStore.writeText(inputArtifactPath, [
      JSON.stringify({ chat_metadata: {}, user_name: "Traveler", character_name: "Guide" }),
      JSON.stringify({ name: "Traveler", is_user: true, mes: "Hello" }),
      JSON.stringify({ name: "Guide", is_user: false, mes: "Welcome" }),
    ].join("\n"));

    database.db.transaction((tx) => {
      scheduler.enqueueImportChat(tx, {
        accountId: DEFAULT_ACCOUNT_ID,
        inputArtifactPath,
        inputBytes: 128,
        createdAt: now,
        jobId,
      });
    });

    vi.spyOn(publisherModule, "publishChatImportManifestInTransaction").mockImplementationOnce(() => {
      throw new retryModule.ResourceBusyError("database is locked");
    });

    const worker = new ChatTransferWorker(database.db, {
      artifactDir: tempDir,
      workerId: "worker-3",
      pollIntervalMs: 60_000,
      retryBaseDelayMs: 50,
    });

    await expect(worker.processOneDueJob()).resolves.toBe(true);

    const [job] = await database.db.select().from(runtimeJobs).where(eq(runtimeJobs.id, jobId));
    expect(job).toMatchObject({
      id: jobId,
      status: "retry_waiting",
      lastError: "database is locked",
      finishedAt: null,
    });
  });
});
