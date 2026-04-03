import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app";
import { createDatabase, type DatabaseConnection } from "../src/db/client";
import { presets } from "../src/db/schema";
import { registerImportRoutes } from "../src/routes/imports";
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

const MINIMAL_EDITOR = {
  default_character_id: 100000,
  entries: [
    {
      identifier: "main",
      name: "Main Prompt",
      role: "system" as const,
      content: "You are a helpful assistant.",
      system_prompt: false,
      marker: false,
      injection_position: 0,
      enabled: true,
      extra: {},
    },
  ],
  order_contexts: [
    {
      character_id: 100000,
      order: [{ identifier: "main", enabled: true }],
      extra: {},
    },
  ],
  top_level: {},
};

const BARE_CHARACTER_CARD_V2 = {
  spec: "chara_card_v2",
  spec_version: "2.0",
  data: {
    name: "Bare",
  },
};

type ErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};

type ItemResponse<T> = { data: T };

type SessionResponse = {
  data: {
    id: string;
    character_binding: {
      snapshot_summary: {
        name: string;
        has_greeting: boolean;
      };
    } | null;
  };
};

type TimelineResponse = {
  data: {
    floors: Array<{
      id: string;
      page_count: number;
      active_page: {
        id: string;
        messages: Array<{ content: string }>;
      } | null;
    }>;
  };
};

type PresetEditorResponse = {
  data: {
    updated_at: number;
    editor: typeof MINIMAL_EDITOR;
  };
};

describe("Import route extra branches", () => {
  describe("integration flows", () => {
    let app: FastifyInstance;

    beforeEach(async () => {
      ({ app } = await buildApp({ databasePath: ":memory:", logger: false }));
    });

    afterEach(async () => {
      await app.close();
    });

    it("returns validation_error for missing required import payloads", async () => {
      const presetRes = await app.inject({
        method: "POST",
        url: "/import/preset",
        payload: {},
      });
      expect(presetRes.statusCode).toBe(400);
      expect(presetRes.json<ErrorResponse>().error.code).toBe("validation_error");

      const worldbookRes = await app.inject({
        method: "POST",
        url: "/import/worldbook",
        payload: {},
      });
      expect(worldbookRes.statusCode).toBe(400);
      expect(worldbookRes.json<ErrorResponse>().error.code).toBe("validation_error");

      const characterRes = await app.inject({
        method: "POST",
        url: "/import/character",
        payload: { create_session: false },
      });
      expect(characterRes.statusCode).toBe(400);
      expect(characterRes.json<ErrorResponse>().error.code).toBe("validation_error");

      const chatRes = await app.inject({
        method: "POST",
        url: "/import/chat",
        payload: { data: "" },
      });
      expect(chatRes.statusCode).toBe(400);
      expect(chatRes.json<ErrorResponse>().error.code).toBe("validation_error");
    });

    it("imports a character without greeting and does not create greeting floors", async () => {
      const importRes = await app.inject({
        method: "POST",
        url: "/import/character",
        payload: {
          payload: BARE_CHARACTER_CARD_V2,
        },
      });

      expect(importRes.statusCode, importRes.body).toBe(201);
      const sessionId = importRes.json<ItemResponse<{ session: { id: string } }>>().data.session.id;

      const sessionRes = await app.inject({ method: "GET", url: `/sessions/${sessionId}` });
      expect(sessionRes.statusCode).toBe(200);
      const sessionBody = sessionRes.json<SessionResponse>();
      expect(sessionBody.data.character_binding?.snapshot_summary.name).toBe("Bare");
      expect(sessionBody.data.character_binding?.snapshot_summary.has_greeting).toBe(false);

      const timelineRes = await app.inject({ method: "GET", url: `/sessions/${sessionId}/timeline` });
      expect(timelineRes.statusCode).toBe(200);
      expect(timelineRes.json<TimelineResponse>().data.floors).toHaveLength(0);
    });

    it("imports jsonl chat using header name fallback and default swipe selection", async () => {
      const content = [
        JSON.stringify({ name: "Narrator Archive" }),
        JSON.stringify({ name: "System", is_user: false, is_system: true, mes: "System note" }),
        JSON.stringify({ name: "Guide", is_user: false, mes: "Reply A", swipes: ["Reply A", "Reply B"] }),
      ].join("\n");

      const importRes = await app.inject({
        method: "POST",
        url: "/import/chat",
        payload: { data: content },
      });

      expect(importRes.statusCode, importRes.body).toBe(201);
      const importBody = importRes.json<ItemResponse<{
        session_id: string;
        title: string;
        floor_count: number;
        message_count: number;
        swipe_count: number;
      }>>();
      expect(importBody.data.title).toBe("Narrator Archive");
      expect(importBody.data.floor_count).toBe(1);
      expect(importBody.data.message_count).toBe(3);
      expect(importBody.data.swipe_count).toBe(2);

      const timelineRes = await app.inject({ method: "GET", url: `/sessions/${importBody.data.session_id}/timeline` });
      expect(timelineRes.statusCode).toBe(200);
      const timelineBody = timelineRes.json<TimelineResponse>();
      expect(timelineBody.data.floors).toHaveLength(1);
      expect(timelineBody.data.floors[0]!.page_count).toBe(3);
      expect(timelineBody.data.floors[0]!.active_page?.messages[0]!.content).toBe("Reply A");
    });

    it("imports jsonl chat with the final Imported Chat title fallback", async () => {
      const content = [
        JSON.stringify({ user_name: "Traveler" }),
        JSON.stringify({ name: "Traveler", is_user: true, mes: "Hello" }),
      ].join("\n");

      const importRes = await app.inject({
        method: "POST",
        url: "/import/chat",
        payload: { data: content },
      });

      expect(importRes.statusCode, importRes.body).toBe(201);
      expect(importRes.json<ItemResponse<{ title: string }>>().data.title).toBe("Imported Chat");
    });

    it("covers preset editor missing and validation branches", async () => {
      const importRes = await app.inject({
        method: "POST",
        url: "/import/preset",
        payload: {
          name: "Preset For Extra Branches",
          data: MINIMAL_PRESET,
        },
      });
      expect(importRes.statusCode).toBe(201);
      const presetId = importRes.json<ItemResponse<{ id: string }>>().data.id;

      const missingEditorRes = await app.inject({
        method: "GET",
        url: "/presets/missing-preset/editor",
      });
      expect(missingEditorRes.statusCode).toBe(404);
      expect(missingEditorRes.json<ErrorResponse>().error.code).toBe("preset_not_found");

      const missingPutRes = await app.inject({
        method: "PUT",
        url: "/presets/missing-preset",
        payload: {
          name: "Missing Preset",
          editor: MINIMAL_EDITOR,
        },
      });
      expect(missingPutRes.statusCode).toBe(404);
      expect(missingPutRes.json<ErrorResponse>().error.code).toBe("preset_not_found");

      const editorRes = await app.inject({
        method: "GET",
        url: `/presets/${presetId}/editor`,
      });
      expect(editorRes.statusCode).toBe(200);
      const editorBody = editorRes.json<PresetEditorResponse>();

      const duplicatePutRes = await app.inject({
        method: "PUT",
        url: `/presets/${presetId}`,
        payload: {
          name: "Duplicate Preset",
          expected_updated_at: editorBody.data.updated_at,
          editor: {
            ...editorBody.data.editor,
            entries: [
              editorBody.data.editor.entries[0]!,
              {
                ...editorBody.data.editor.entries[0]!,
                content: "Duplicated prompt entry",
              },
            ],
          },
        },
      });
      expect(duplicatePutRes.statusCode).toBe(400);
      expect(duplicatePutRes.json<ErrorResponse>().error.code).toBe("preset_validation_error");
    });

    it("covers worldbook fallback name and update error branches", async () => {
      const importRes = await app.inject({
        method: "POST",
        url: "/import/worldbook",
        payload: {
          data: {
            name: "",
            entries: [{}],
          },
        },
      });

      expect(importRes.statusCode, importRes.body).toBe(201);
      const importBody = importRes.json<ItemResponse<{ id: string; name: string }>>();
      const worldbookId = importBody.data.id;
      expect(importBody.data.name).toBe("Unnamed Worldbook");

      const detailRes = await app.inject({
        method: "GET",
        url: `/worldbooks/${worldbookId}`,
      });
      expect(detailRes.statusCode).toBe(200);
      const detailBody = detailRes.json<ItemResponse<{
        data: {
          entries: Array<Record<string, unknown>>;
        };
      }>>();
      const entry = detailBody.data.data.entries[0]!;
      expect(entry).toMatchObject({
        uid: 0,
        key: [],
        keysecondary: [],
        selective: true,
        selectiveLogic: 0,
        constant: false,
        content: "",
        comment: "",
        position: 0,
        order: 100,
        depth: 4,
        role: 0,
        disable: false,
        excludeRecursion: false,
        preventRecursion: false,
        delayUntilRecursion: null,
        outletName: "",
      });

      const invalidPutRes = await app.inject({
        method: "PUT",
        url: `/worldbooks/${worldbookId}`,
        payload: {
          name: "Broken Worldbook",
          data: {
            entries: "not-valid",
          },
        },
      });
      expect(invalidPutRes.statusCode).toBe(400);
      expect(invalidPutRes.json<ErrorResponse>().error.code).toBe("worldbook_validation_error");

      const missingPutRes = await app.inject({
        method: "PUT",
        url: "/worldbooks/missing-worldbook",
        payload: {
          name: "Missing Worldbook",
          data: {
            entries: [],
          },
        },
      });
      expect(missingPutRes.statusCode).toBe(404);
      expect(missingPutRes.json<ErrorResponse>().error.code).toBe("worldbook_not_found");
    });
  });

  describe("route-only seeded branches", () => {
    let app: FastifyInstance;
    let connection: DatabaseConnection;

    beforeEach(async () => {
      connection = createDatabase(":memory:");
      app = Fastify({ logger: false });
      await registerDevelopmentTestAuth(app, connection.db);
      await registerImportRoutes(app, connection);
      await app.ready();
    });

    afterEach(async () => {
      await app.close();
      connection.close();
    });

    it("returns 422 when a stored preset cannot be projected to the editor document", async () => {
      const now = Date.now();
      await connection.db.insert(presets).values({
        id: "broken-preset",
        name: "Broken Preset",
        source: "sillytavern",
        accountId: "default-admin",
        dataJson: JSON.stringify(5),
        createdAt: now,
        updatedAt: now,
      });

      const res = await app.inject({
        method: "GET",
        url: "/presets/broken-preset/editor",
      });

      expect(res.statusCode, res.body).toBe(422);
      expect(res.json<ErrorResponse>().error.code).toBe("preset_unsupported_shape");
    });
  });
});
