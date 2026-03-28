import { rmSync } from "node:fs";

import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";

import { DEFAULT_ADMIN_ACCOUNT_ID } from "../src/accounts/constants";
import { buildApp } from "../src/app";
import { createDatabase, type DatabaseConnection } from "../src/db/client";
import { floors, sessions, toolExecutionRecords } from "../src/db/schema";

type ListResponse = {
  data: Array<Record<string, unknown>>;
  meta: { total: number; limit: number; offset: number };
};

describe("Tool execution journal routes", () => {
  let app: FastifyInstance;
  let seedConnection: DatabaseConnection;
  let databasePath: string;

  beforeEach(async () => {
    databasePath = `data/test-tool-executions-${nanoid()}.db`;
    await buildApp({ databasePath, logger: false }).then((result) => {
      app = result.app;
    });
    seedConnection = createDatabase(databasePath);
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
    if (seedConnection) {
      seedConnection.close();
    }
    if (databasePath) {
      rmSync(databasePath, { force: true });
    }
  });

  async function seedExecutionRows() {
    const now = Date.now();
    const sessionId = nanoid();
    const floorId = nanoid();
    const otherFloorId = nanoid();

    await seedConnection.db.insert(sessions).values({
      id: sessionId,
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      title: "Execution Journal Test",
      status: "active",
      characterSyncPolicy: "pin",
      createdAt: now,
      updatedAt: now,
    });

    await seedConnection.db.insert(floors).values([
      {
        id: floorId,
        sessionId,
        floorNo: 1,
        branchId: "main",
        parentFloorId: null,
        state: "committed",
        tokenIn: 0,
        tokenOut: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: otherFloorId,
        sessionId,
        floorNo: 2,
        branchId: "main",
        parentFloorId: floorId,
        state: "failed",
        tokenIn: 0,
        tokenOut: 0,
        createdAt: now + 1,
        updatedAt: now + 1,
      },
    ]);

    await seedConnection.db.insert(toolExecutionRecords).values([
      {
        id: "exec-1",
        runId: "run-1",
        floorId,
        pageId: null,
        callerSlot: "narrator",
        providerId: "builtin",
        providerType: "builtin",
        toolName: "roll_dice",
        argsJson: JSON.stringify({ sides: 20 }),
        resultJson: JSON.stringify({ total: 12 }),
        status: "success",
        lifecycleState: "finished",
        commitOutcome: "committed",
        sideEffectLevel: "none",
        errorMessage: null,
        durationMs: 5,
        startedAt: now,
        finishedAt: now + 5,
        attemptNo: 1,
        replayParentExecutionId: null,
        createdAt: now,
      },
      {
        id: "exec-2",
        runId: "run-1",
        floorId,
        pageId: null,
        callerSlot: "narrator",
        providerId: "mcp:github",
        providerType: "mcp",
        toolName: "github_list_repos",
        argsJson: JSON.stringify({ owner: "test" }),
        resultJson: JSON.stringify({ error: true }),
        status: "uncertain",
        lifecycleState: "finished",
        commitOutcome: "discarded",
        sideEffectLevel: "irreversible",
        errorMessage: "Tool call timeout after 50ms; execution outcome is uncertain; reconnect required before the next call",
        durationMs: 50,
        startedAt: now + 10,
        finishedAt: now + 60,
        attemptNo: 2,
        replayParentExecutionId: null,
        createdAt: now + 10,
      },
      {
        id: "exec-3",
        runId: "run-2",
        floorId: otherFloorId,
        pageId: null,
        callerSlot: "verifier",
        providerId: "builtin",
        providerType: "builtin",
        toolName: "lookup_memory",
        argsJson: JSON.stringify({ key: "mood" }),
        resultJson: JSON.stringify({ error: "blocked" }),
        status: "blocked",
        lifecycleState: "finished",
        commitOutcome: "discarded",
        sideEffectLevel: "none",
        errorMessage: "Tool execution blocked before provider start: verifier rejected the turn",
        durationMs: 0,
        startedAt: now + 20,
        finishedAt: now + 20,
        attemptNo: 1,
        replayParentExecutionId: null,
        createdAt: now + 20,
      },
    ]);

    return { sessionId, floorId, otherFloorId };
  }

  it("returns 400 without session_id, floor_id, or run_id", async () => {
    const res = await app.inject({ method: "GET", url: "/tool-executions" });
    expect(res.statusCode).toBe(400);
  });

  it("returns execution journal rows filtered by session_id and status", async () => {
    const { sessionId } = await seedExecutionRows();

    const res = await app.inject({
      method: "GET",
      url: `/tool-executions?session_id=${sessionId}&status=uncertain&commit_outcome=discarded`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<ListResponse>();
    expect(body.meta.total).toBe(1);
    expect(body.data).toEqual([
      expect.objectContaining({
        id: "exec-2",
        run_id: "run-1",
        provider_type: "mcp",
        status: "uncertain",
        lifecycle_state: "finished",
        commit_outcome: "discarded",
        side_effect_level: "irreversible",
      }),
    ]);
  });

  it("returns floor-scoped execution journal rows from /floors/:id/tool-executions", async () => {
    const { floorId } = await seedExecutionRows();

    const res = await app.inject({
      method: "GET",
      url: `/floors/${floorId}/tool-executions?sort_by=started_at&sort_order=desc`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<ListResponse>();
    expect(body.meta.total).toBe(2);
    expect(body.data.map((row) => row.id)).toEqual(["exec-2", "exec-1"]);
    expect(body.data[0]).toEqual(
      expect.objectContaining({
        id: "exec-2",
        provider_id: "mcp:github",
        attempt_no: 2,
      }),
    );
  });
});
