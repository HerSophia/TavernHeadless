import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app";
import { createDatabase } from "../src/db/client";
import { floors } from "../src/db/schema";

describe("Users and session user binding", () => {
  let app: FastifyInstance;
  let tempDir: string;
  let databasePath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "tavern-users-"));
    databasePath = join(tempDir, "api.db");
    ({ app } = await buildApp({ databasePath, logger: false }));
  });

  afterEach(async () => {
    await app.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("supports users CRUD lifecycle", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/users",
      payload: {
        snapshot: {
          name: "Alice",
          description: "A careful witness"
        }
      }
    });
    expect(createRes.statusCode, createRes.body).toBe(201);

    const created = createRes.json<{ data: { id: string } }>().data;

    const listRes = await app.inject({
      method: "GET",
      url: "/users"
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json<{ data: Array<{ id: string; name: string }> }>().data).toEqual([
      expect.objectContaining({ id: created.id, name: "Alice" })
    ]);

    const patchRes = await app.inject({
      method: "PATCH",
      url: `/users/${created.id}`,
      payload: {
        snapshot: {
          name: "Alice Prime",
          description: "Updated"
        },
        status: "disabled"
      }
    });
    expect(patchRes.statusCode, patchRes.body).toBe(200);

    const getRes = await app.inject({
      method: "GET",
      url: `/users/${created.id}`
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json<{ data: { name: string; status: string } }>().data).toEqual(
      expect.objectContaining({ name: "Alice Prime", status: "disabled" })
    );

    const deleteRes = await app.inject({
      method: "DELETE",
      url: `/users/${created.id}`
    });
    expect(deleteRes.statusCode).toBe(200);

    const getAfterDelete = await app.inject({
      method: "GET",
      url: `/users/${created.id}`
    });
    expect(getAfterDelete.statusCode).toBe(404);

    const listAfterDelete = await app.inject({
      method: "GET",
      url: "/users"
    });
    expect(listAfterDelete.statusCode).toBe(200);
    expect(listAfterDelete.json<{ data: unknown[] }>().data).toHaveLength(0);
  });

  it("replaces floor user metadata when session user binding changes", async () => {
    const userARes = await app.inject({
      method: "POST",
      url: "/users",
      payload: { snapshot: { name: "Alice", description: "First" } }
    });
    const userBRes = await app.inject({
      method: "POST",
      url: "/users",
      payload: { snapshot: { name: "Bob", description: "Second" } }
    });
    expect(userARes.statusCode).toBe(201);
    expect(userBRes.statusCode).toBe(201);

    const userAId = userARes.json<{ data: { id: string } }>().data.id;
    const userBId = userBRes.json<{ data: { id: string } }>().data.id;

    const createSessionRes = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: {
        title: "Bound Session",
        user_id: userAId
      }
    });
    expect(createSessionRes.statusCode, createSessionRes.body).toBe(201);

    const sessionId = createSessionRes.json<{ data: { id: string } }>().data.id;

    const floorMainRes = await app.inject({
      method: "POST",
      url: "/floors",
      payload: {
        session_id: sessionId,
        floor_no: 0,
        branch_id: "main",
        state: "committed"
      }
    });
    const floorAltRes = await app.inject({
      method: "POST",
      url: "/floors",
      payload: {
        session_id: sessionId,
        floor_no: 0,
        branch_id: "alt",
        state: "committed"
      }
    });
    expect(floorMainRes.statusCode).toBe(201);
    expect(floorAltRes.statusCode).toBe(201);

    const replaceRes = await app.inject({
      method: "PATCH",
      url: `/sessions/${sessionId}`,
      payload: {
        user_id: userBId
      }
    });
    expect(replaceRes.statusCode, replaceRes.body).toBe(200);
    const replacedSession = replaceRes.json<{
      data: {
        user_binding: {
          user_id: string | null;
          snapshot_summary: { name: string } | null;
        } | null;
      };
    }>();
    expect(replacedSession.data.user_binding?.user_id).toBe(userBId);
    expect(replacedSession.data.user_binding?.snapshot_summary?.name).toBe("Bob");

    const db = createDatabase(databasePath);
    try {
      const floorRows = await db.db
        .select({ id: floors.id, metadataJson: floors.metadataJson })
        .from(floors)
        .where(eq(floors.sessionId, sessionId));

      expect(floorRows.length).toBeGreaterThanOrEqual(2);
      for (const row of floorRows) {
        const metadata = row.metadataJson ? JSON.parse(row.metadataJson) : null;
        expect(metadata?.user_binding?.user_id).toBe(userBId);
        expect(metadata?.user_binding?.snapshot_summary?.name).toBe("Bob");
      }
    } finally {
      db.close();
    }
  });
});
