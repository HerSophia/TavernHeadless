import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app";
import { createDatabase, type DatabaseConnection } from "../src/db/client";
import { characters, worldbookEntries, worldbooks } from "../src/db/schema";
import { registerExportRoutes } from "../src/routes/exports";
import { registerDevelopmentTestAuth } from "./helpers/register-test-auth";

const MINIMAL_PRESET = {
  prompts: [
    {
      identifier: "main",
      name: "Main Prompt",
      role: "system",
      content: "You are a helpful assistant.",
    },
  ],
  prompt_order: [
    {
      character_id: 100000,
      order: [{ identifier: "main", enabled: true }],
    },
  ],
  temperature: 0.8,
  openai_max_context: 8000,
  openai_max_tokens: 500,
};

type ErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};

type ItemResponse<T> = { data: T };

describe("Export route extra branches", () => {
  describe("integration flows", () => {
    let app: FastifyInstance;

    beforeEach(async () => {
      ({ app } = await buildApp({ databasePath: ":memory:", logger: false }));
    });

    afterEach(async () => {
      await app.close();
    });

    it("uses export.thchat when the session title is null and validates export chat query", async () => {
      const sessionRes = await app.inject({
        method: "POST",
        url: "/sessions",
        payload: {},
      });
      expect(sessionRes.statusCode, sessionRes.body).toBe(201);
      const sessionId = sessionRes.json<ItemResponse<{ id: string }>>().data.id;

      const exportRes = await app.inject({
        method: "GET",
        url: `/export/chat/${sessionId}`,
      });
      expect(exportRes.statusCode).toBe(200);
      expect(exportRes.headers["content-disposition"]).toContain('filename="export.thchat"');
      expect(exportRes.json<{ data: { title: string | null } }>().data.title).toBeNull();

      const invalidQueryRes = await app.inject({
        method: "GET",
        url: `/export/chat/${sessionId}?format=invalid`,
      });
      expect(invalidQueryRes.statusCode).toBe(400);
      expect(invalidQueryRes.json<ErrorResponse>().error.code).toBe("validation_error");
    });

    it("uses export.json when the sanitized preset filename is empty", async () => {
      const importRes = await app.inject({
        method: "POST",
        url: "/import/preset",
        payload: {
          name: "   ",
          data: MINIMAL_PRESET,
        },
      });
      expect(importRes.statusCode, importRes.body).toBe(201);
      const presetId = importRes.json<ItemResponse<{ id: string }>>().data.id;

      const exportRes = await app.inject({
        method: "GET",
        url: `/export/preset/${presetId}`,
      });
      expect(exportRes.statusCode).toBe(200);
      expect(exportRes.headers["content-disposition"]).toContain('filename="export.json"');
    });

    it("returns validation_error for an empty character version_id query", async () => {
      const importRes = await app.inject({
        method: "POST",
        url: "/import/character",
        payload: {
          payload: {
            spec: "chara_card_v2",
            spec_version: "2.0",
            data: {
              name: "Luna",
            },
          },
          create_session: false,
        },
      });
      expect(importRes.statusCode).toBe(201);
      const characterId = importRes.json<ItemResponse<{ character_id: string }>>().data.character_id;

      const res = await app.inject({
        method: "GET",
        url: `/export/character/${characterId}?version_id=`,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json<ErrorResponse>().error.code).toBe("validation_error");
    });
  });

  describe("route-only seeded branches", () => {
    let app: FastifyInstance;
    let connection: DatabaseConnection;

    beforeEach(async () => {
      connection = createDatabase(":memory:");
      app = Fastify({ logger: false });
      await registerDevelopmentTestAuth(app, connection.db);
      await registerExportRoutes(app, connection);
      await app.ready();
    });

    afterEach(async () => {
      await app.close();
      connection.close();
    });

    it("exports a worldbook when stored global settings are not an object", async () => {
      const now = Date.now();
      await connection.db.insert(worldbooks).values({
        id: "wb-route-only",
        name: "Route Only World",
        source: "sillytavern",
        accountId: "default-admin",
        dataJson: JSON.stringify(42),
        createdAt: now,
        updatedAt: now,
      });
      await connection.db.insert(worldbookEntries).values({
        id: "wb-entry-1",
        worldbookId: "wb-route-only",
        uid: 0,
        comment: "",
        content: "Stored entry",
        keysJson: JSON.stringify(["dragon"]),
        keysSecondaryJson: JSON.stringify([]),
        selective: true,
        selectiveLogic: 0,
        constant: false,
        position: 0,
        order: 100,
        depth: 4,
        role: 0,
        disable: false,
        scanDepth: null,
        caseSensitive: null,
        matchWholeWords: null,
        createdAt: now,
        updatedAt: now,
      });

      const res = await app.inject({
        method: "GET",
        url: "/export/worldbook/wb-route-only",
      });

      expect(res.statusCode, res.body).toBe(200);
      const body = res.json<{
        name: string;
        entries: Record<string, { content: string }>;
        scanDepth?: number;
      }>();
      expect(body.name).toBe("Route Only World");
      expect(body.entries["0"]?.content).toBe("Stored entry");
      expect(body.scanDepth).toBeUndefined();
    });

    it("returns character_version_not_found when a character has no versions", async () => {
      const now = Date.now();
      await connection.db.insert(characters).values({
        id: "char-without-version",
        name: "Unversioned Character",
        source: "sillytavern",
        accountId: "default-admin",
        status: "active",
        deletedAt: null,
        revision: 0,
        latestVersionNo: 0,
        createdAt: now,
        updatedAt: now,
      });

      const res = await app.inject({
        method: "GET",
        url: "/export/character/char-without-version",
      });

      expect(res.statusCode, res.body).toBe(404);
      expect(res.json<ErrorResponse>().error.code).toBe("character_version_not_found");
    });
  });
});
