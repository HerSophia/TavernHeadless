import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type DatabaseConnection } from "../src/db/client.js";
import { registerFloorRoutes } from "../src/routes/floors.js";
import { accounts, floorResultSnapshots, floors, messagePages, messages, sessions } from "../src/db/schema.js";

const DEFAULT_ACCOUNT_ID = "default-admin";

describe("GET /floors/:id/result", () => {
  let app: FastifyInstance;
  let database: DatabaseConnection;

  beforeEach(async () => {
    database = createDatabase(":memory:");
    app = Fastify({ logger: false });
    await registerFloorRoutes(app, database);

    const now = 1_735_689_720_000;
    await database.db
      .insert(accounts)
      .values({
        id: DEFAULT_ACCOUNT_ID,
        name: "Default Admin",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .run();
  });

  afterEach(async () => {
    await app.close();
    database.close();
  });

  it("returns committed floor result snapshot", async () => {
    const now = 1_735_689_720_000;
    await database.db.insert(sessions).values({
      id: "session-1",
      title: "Session",
      status: "active",
      accountId: DEFAULT_ACCOUNT_ID,
      createdAt: now,
      updatedAt: now,
    });
    await database.db.insert(floors).values({
      id: "floor-1",
      sessionId: "session-1",
      floorNo: 1,
      branchId: "main",
      parentFloorId: null,
      state: "committed",
      tokenIn: 12,
      tokenOut: 34,
      createdAt: now,
      updatedAt: now + 100,
    });
    await database.db.insert(messagePages).values({
      id: "page-1",
      floorId: "floor-1",
      pageNo: 1,
      pageKind: "output",
      isActive: true,
      version: 1,
      checksum: null,
      createdAt: now,
      updatedAt: now,
    });
    await database.db.insert(messages).values({
      id: "msg-1",
      pageId: "page-1",
      seq: 0,
      role: "assistant",
      content: "Committed reply",
      contentFormat: "text",
      tokenCount: 2,
      isHidden: false,
      source: "narrator",
      createdAt: now,
    });
    await database.db.insert(floorResultSnapshots).values({
      floorId: "floor-1",
      outputPageId: "page-1",
      assistantMessageId: "msg-1",
      generatedText: "Committed reply",
      summariesJson: JSON.stringify(["sum-1"]),
      usageJson: JSON.stringify({ promptTokens: 12, completionTokens: 34, totalTokens: 46 }),
      verifierJson: JSON.stringify({ status: "passed", issues: [] }),
      committedAt: now + 200,
      updatedAt: now + 200,
    });

    const response = await app.inject({
      method: "GET",
      url: "/floors/floor-1/result",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        floor_id: "floor-1",
        output_page_id: "page-1",
        assistant_message_id: "msg-1",
        generated_text: "Committed reply",
        summaries: ["sum-1"],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 34,
          total_tokens: 46,
        },
        verifier: {
          status: "passed",
          suggestion: null,
          issues: [],
        },
        committed_at: now + 200,
      },
    });
  });

  it("returns 409 when the floor is not committed", async () => {
    const now = 1_735_689_720_000;
    await database.db.insert(sessions).values({
      id: "session-2",
      title: "Session",
      status: "active",
      accountId: DEFAULT_ACCOUNT_ID,
      createdAt: now,
      updatedAt: now,
    });
    await database.db.insert(floors).values({
      id: "floor-2",
      sessionId: "session-2",
      floorNo: 1,
      branchId: "main",
      parentFloorId: null,
      state: "generating",
      tokenIn: 0,
      tokenOut: 0,
      createdAt: now,
      updatedAt: now,
    });

    const response = await app.inject({
      method: "GET",
      url: "/floors/floor-2/result",
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: {
        code: "invalid_state",
        message: "Floor 'floor-2' is not committed",
      },
    });
  });
});
