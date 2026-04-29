import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app";

describe("Prompt runtime preview integration", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    ({ app } = await buildApp({
      databasePath: ":memory:",
      logger: false,
      enableWebSocket: false,
      orchestration: {
        providers: [
          {
            id: "default-openai",
            type: "openai-compatible",
            apiKey: "sk-default",
          },
        ],
        defaultModel: {
          providerId: "default-openai",
          modelId: "gpt-4o-mini",
        },
      },
    }));
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns 409 for raw CRUD source floors without branch-local snapshots", async () => {
    const sessionRes = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: {
        title: "preview raw CRUD floor",
        character_snapshot: { name: "Knight", primaryGreeting: "Hello there." },
      },
    });
    expect(sessionRes.statusCode, sessionRes.body).toBe(201);
    const sessionId = sessionRes.json<{ data: { id: string } }>().data.id;

    const floorRes = await app.inject({
      method: "POST",
      url: "/floors",
      payload: {
        session_id: sessionId,
        floor_no: 1,
        branch_id: "main",
        state: "committed",
      },
    });
    expect(floorRes.statusCode, floorRes.body).toBe(201);
    const floorId = floorRes.json<{ data: { id: string } }>().data.id;

    const previewRes = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/prompt-runtime/preview`,
      payload: {
        text: "{{getvar::branch-key}}",
        branch_id: "alt-preview",
        source_floor_id: floorId,
      },
    });

    expect(previewRes.statusCode, previewRes.body).toBe(409);
    expect(previewRes.json<{ error: { code: string; message: string } }>()).toEqual({
      error: {
        code: "branch_local_snapshot_missing",
        message: `Source floor '${floorId}' in branch 'main' does not have a branch local snapshot`,
      },
    });
  });
});
