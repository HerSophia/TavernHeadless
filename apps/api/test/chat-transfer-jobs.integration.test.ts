import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildApp } from "../src/app";
import { createDatabase, type DatabaseConnection } from "../src/db/client.js";
import { sessions as sessionTable } from "../src/db/schema.js";
import { ChatTransferWorker } from "../src/services/chat-transfer-worker.js";

describe("chat transfer jobs integration", () => {
  let app: FastifyInstance;
  let tempDir: string;
  let databasePath: string;
  let artifactDir: string;
  let workerConnection: DatabaseConnection | undefined;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "tavern-chat-transfer-integration-"));
    databasePath = join(tempDir, "api.db");
    artifactDir = join(tempDir, "artifacts");
    ({ app } = await buildApp({
      databasePath,
      logger: false,
      chatTransferArtifactDir: artifactDir,
      chatExportSyncMaxMessages: 1,
    }));
  });

  afterEach(async () => {
    if (workerConnection) {
      workerConnection.close();
      workerConnection = undefined;
    }
    await app.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("enqueues import jobs and lets the worker publish the session", async () => {
    const enqueueRes = await app.inject({
      method: "POST",
      url: "/import/chat/jobs",
      payload: {
        data: [
          JSON.stringify({ chat_metadata: { imported_from: "integration" }, user_name: "Traveler", character_name: "Guide" }),
          JSON.stringify({ name: "Traveler", is_user: true, mes: "Hello" }),
          JSON.stringify({ name: "Guide", is_user: false, mes: "Welcome" }),
        ].join("\n"),
        title: "Async Import Session",
      },
    });

    expect(enqueueRes.statusCode, enqueueRes.body).toBe(202);
    const enqueueBody = enqueueRes.json<{ data: { job_id: string } }>();
    const jobId = enqueueBody.data.job_id;

    workerConnection = createDatabase(databasePath);
    expect(await workerConnection.db.select().from(sessionTable)).toHaveLength(0);

    const worker = new ChatTransferWorker(workerConnection.db, {
      artifactDir,
      workerId: "integration-worker-import",
      pollIntervalMs: 60_000,
    });
    await expect(worker.processOneDueJob()).resolves.toBe(true);

    const detailRes = await app.inject({ method: "GET", url: `/chat-transfer-jobs/${jobId}` });
    expect(detailRes.statusCode, detailRes.body).toBe(200);
    const detailBody = detailRes.json<{
      data: {
        status: string;
        result_session_id: string | null;
        result: { title: string };
      };
    }>();
    expect(detailBody.data.status).toBe("succeeded");
    expect(detailBody.data.result.title).toBe("Async Import Session");

    const sessionId = detailBody.data.result_session_id!;
    const sessionRes = await app.inject({ method: "GET", url: `/sessions/${sessionId}` });
    expect(sessionRes.statusCode, sessionRes.body).toBe(200);
    expect(sessionRes.json<{ data: { title: string | null } }>().data.title).toBe("Async Import Session");
  });

  it("routes large synchronous exports to async jobs and serves the artifact after the worker completes", async () => {
    const importRes = await app.inject({
      method: "POST",
      url: "/import/chat",
      payload: {
        data: [
          JSON.stringify({ chat_metadata: {}, user_name: "Traveler", character_name: "Guide" }),
          JSON.stringify({ name: "Traveler", is_user: true, mes: "Hello" }),
          JSON.stringify({ name: "Guide", is_user: false, mes: "Welcome" }),
        ].join("\n"),
      },
    });

    expect(importRes.statusCode, importRes.body).toBe(201);
    const sessionId = importRes.json<{ data: { session_id: string } }>().data.session_id;

    const syncExportRes = await app.inject({
      method: "GET",
      url: `/export/chat/${sessionId}?format=st_jsonl`,
    });
    expect(syncExportRes.statusCode, syncExportRes.body).toBe(409);
    expect(syncExportRes.json<{ error: { code: string } }>().error.code).toBe("export_requires_async");

    const createJobRes = await app.inject({
      method: "POST",
      url: `/export/chat/${sessionId}/jobs`,
      payload: { format: "st_jsonl", include_variables: false, include_memories: false },
    });
    expect(createJobRes.statusCode, createJobRes.body).toBe(202);
    const jobId = createJobRes.json<{ data: { job_id: string } }>().data.job_id;

    workerConnection = createDatabase(databasePath);
    const worker = new ChatTransferWorker(workerConnection.db, {
      artifactDir,
      workerId: "integration-worker-export",
      pollIntervalMs: 60_000,
    });
    await expect(worker.processOneDueJob()).resolves.toBe(true);

    const fileRes = await app.inject({ method: "GET", url: `/chat-transfer-jobs/${jobId}/file` });
    expect(fileRes.statusCode, fileRes.body).toBe(200);
    expect(fileRes.headers["content-type"]).toContain("application/x-ndjson");
    const [headerLine] = fileRes.body.trim().split("\n");
    const header = JSON.parse(headerLine!) as { character_name: string };
    expect(header.character_name).toBe("Guide");
  });
}
);

