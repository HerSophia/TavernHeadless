import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildApp } from "../src/app";
import { createDatabase, type DatabaseConnection } from "../src/db/client.js";
import { sessions as sessionTable } from "../src/db/schema.js";
import { ChatTransferWorker } from "../src/services/chat-transfer-worker.js";

const CHARACTER_CARD_V2 = {
  spec: "chara_card_v2",
  spec_version: "2.0",
  data: {
    name: "Lyra",
    description: "A precise chronicle keeper.",
    personality: "Calm and thoughtful.",
    scenario: "An observatory wrapped in mist.",
    first_mes: "The record is ready whenever you are.",
    mes_example: "<START>\nLyra: We can annotate this thread together.",
  },
};

function makeMinimalThChatFile() {
  return {
    spec: "tavern_headless_chat",
    spec_version: "1.0.0",
    exported_at: 1700000005000,
    export_source: "test-suite",
    data: {
      title: "Queued Bound Import",
      status: "active",
      created_at: 1700000000000,
      updated_at: 1700000004000,
      character_snapshot: { name: "Archived Snapshot", greeting: "Archived greeting" },
      user_snapshot: { name: "Traveler" },
      character_sync_policy: "manual",
      floors: [
        {
          floor_no: 0,
          branch_id: "main",
          parent_floor_id_ref: null,
          state: "committed",
          token_in: 0,
          token_out: 4,
          metadata: null,
          created_at: 1700000000000,
          updated_at: 1700000000001,
          _original_id: "floor_001",
          pages: [
            {
              page_no: 0,
              page_kind: "output",
              is_active: true,
              version: 1,
              checksum: "chk-001",
              created_at: 1700000000000,
              updated_at: 1700000000001,
              _original_id: "page_001",
              messages: [{ seq: 0, role: "assistant", content: "Hello from queue", content_format: "text", token_count: 4, is_hidden: false, source: "archive", created_at: 1700000000000, _original_id: "msg_001" }],
            },
          ],
        },
      ],
    },
  };
}

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

  async function createCharacter(): Promise<string> {
    const response = await app.inject({
      method: "POST",
      url: "/import/character",
      payload: { payload: CHARACTER_CARD_V2, create_session: false },
    });

    expect(response.statusCode, response.body).toBe(201);
    return response.json<{ data: { character_id: string } }>().data.character_id;
  }

  async function getCharacterRevision(characterId: string): Promise<number> {
    const response = await app.inject({
      method: "GET",
      url: `/characters/${characterId}`,
    });

    expect(response.statusCode, response.body).toBe(200);
    return response.json<{ data: { revision: number } }>().data.revision;
  }

  async function appendCharacterVersion(characterId: string, input: { name: string; greeting: string }): Promise<string> {
    const response = await app.inject({
      method: "POST",
      url: `/characters/${characterId}/versions`,
      payload: {
        snapshot: {
          name: input.name,
          description: `${input.name} description`,
          personality: `${input.name} personality`,
          scenario: `${input.name} scenario`,
          primaryGreeting: input.greeting,
        },
        expected_revision: await getCharacterRevision(characterId),
      },
    });

    expect(response.statusCode, response.body).toBe(201);
    return response.json<{ data: { id: string } }>().data.id;
  }

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

  it("keeps async .thchat imports aligned with bound character version and snapshot semantics", async () => {
    const characterId = await createCharacter();
    const latestVersionId = await appendCharacterVersion(characterId, {
      name: "Queued Bound Archivist",
      greeting: "Queued latest greeting",
    });

    const enqueueRes = await app.inject({
      method: "POST",
      url: "/import/chat/jobs",
      payload: {
        data: JSON.stringify(makeMinimalThChatFile()),
        character_id: characterId,
      },
    });

    expect(enqueueRes.statusCode, enqueueRes.body).toBe(202);
    const jobId = enqueueRes.json<{ data: { job_id: string } }>().data.job_id;

    workerConnection = createDatabase(databasePath);
    const worker = new ChatTransferWorker(workerConnection.db, {
      artifactDir,
      workerId: "integration-worker-import-bound-thchat",
      pollIntervalMs: 60_000,
    });
    await expect(worker.processOneDueJob()).resolves.toBe(true);

    const detailRes = await app.inject({ method: "GET", url: `/chat-transfer-jobs/${jobId}` });
    expect(detailRes.statusCode, detailRes.body).toBe(200);
    const detailBody = detailRes.json<{ data: { result_session_id: string | null } }>();
    const sessionId = detailBody.data.result_session_id!;

    const sessionRes = await app.inject({ method: "GET", url: `/sessions/${sessionId}` });
    expect(sessionRes.statusCode, sessionRes.body).toBe(200);
    expect(sessionRes.json<{
      data: {
        character_binding: {
          character_id: string;
          character_version_id: string | null;
          sync_policy: string;
          snapshot_summary: { name: string } | null;
        } | null;
      };
    }>().data.character_binding).toEqual(expect.objectContaining({
      character_id: characterId,
      character_version_id: latestVersionId,
      sync_policy: "pin",
      snapshot_summary: expect.objectContaining({ name: "Queued Bound Archivist" }),
    }));
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

