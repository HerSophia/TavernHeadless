import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app";
import type { AppDb } from "../src/db/client";
import { characterVersions } from "../src/db/schema";

const CHARACTER_CARD_V2 = {
  spec: "chara_card_v2",
  spec_version: "2.0",
  data: {
    name: "Luna",
    description: "A curious moon archivist.",
    personality: "Soft-spoken and precise.",
    scenario: "An observatory above a sea of clouds.",
    first_mes: "Welcome back. The stars kept your seat warm.",
    mes_example: "<START>\nLuna: I catalog memories by starlight.",
    alternate_greetings: [
      "The archive lamps are already lit.",
      "The charts waited for you.",
    ],
    system_prompt: "Stay in character as a moon archivist.",
    post_history_instructions: "End replies with a soft invitation.",
    creator_notes: "Imported from integration test.",
    tags: ["moon", "archive"],
    creator: "Test Suite",
    character_version: "2.1",
    extensions: {
      source_app: "vitest",
    },
  },
};

describe("Character Import Route", () => {
  let app: FastifyInstance;
  let database: AppDb;

  beforeEach(async () => {
    ({ app, database } = await buildApp({ databasePath: ":memory:", logger: false }));
  });

  afterEach(async () => {
    await app.close();
  });

  it("creates a session by default and binds imported character snapshot", async () => {
    const importRes = await app.inject({
      method: "POST",
      url: "/import/character",
      payload: { payload: CHARACTER_CARD_V2 },
    });

    expect(importRes.statusCode, importRes.body).toBe(201);
    const importBody = importRes.json<{
      data: {
        create_session: boolean;
        session: { id: string };
      };
    }>();

    expect(importBody.data.create_session).toBe(true);
    expect(importBody.data.session.id).toBeDefined();

    const sessionId = importBody.data.session.id;
    const sessionRes = await app.inject({ method: "GET", url: `/sessions/${sessionId}` });
    expect(sessionRes.statusCode).toBe(200);

    const sessionBody = sessionRes.json<{
      data: {
        character_binding: {
          character_id: string;
          character_version_id: string;
          sync_policy: "pin" | "manual" | "force";
          snapshot_summary: {
            name: string;
            has_greeting: boolean;
          };
        } | null;
      };
    }>();

    expect(sessionBody.data.character_binding).not.toBeNull();
    expect(sessionBody.data.character_binding?.snapshot_summary.name).toBe("Luna");
    expect(sessionBody.data.character_binding?.snapshot_summary.has_greeting).toBe(true);
    expect(sessionBody.data.character_binding?.sync_policy).toBe("pin");

    const timelineRes = await app.inject({ method: "GET", url: `/sessions/${sessionId}/timeline` });
    expect(timelineRes.statusCode).toBe(200);

    const timelineBody = timelineRes.json<{
      data: {
        floors: Array<{
          id: string;
          floor_no: number;
          page_count: number;
          active_page: { messages: Array<{ role: string; content: string }> } | null;
        }>;
      };
    }>();

    expect(timelineBody.data.floors).toHaveLength(1);
    expect(timelineBody.data.floors[0]!.floor_no).toBe(0);
    expect(timelineBody.data.floors[0]!.page_count).toBe(3);
    expect(timelineBody.data.floors[0]!.active_page?.messages[0]!.role).toBe("assistant");
    expect(timelineBody.data.floors[0]!.active_page?.messages[0]!.content).toBe(
      "Welcome back. The stars kept your seat warm."
    );

    const floorId = timelineBody.data.floors[0]!.id;
    const pagesRes = await app.inject({ method: "GET", url: `/pages?floor_id=${floorId}&limit=10&offset=0` });
    expect(pagesRes.statusCode, pagesRes.body).toBe(200);
    const pagesBody = pagesRes.json<{
      data: Array<{ id: string; is_active: boolean; page_no: number; version: number }>;
    }>();
    expect(pagesBody.data).toHaveLength(3);
    expect(pagesBody.data.filter((page) => page.is_active)).toHaveLength(1);

    const alternatePage = pagesBody.data.find((page) => page.version === 2);
    expect(alternatePage).toBeDefined();

    const activateRes = await app.inject({
      method: "PATCH",
      url: `/pages/${alternatePage!.id}/activate`,
    });
    expect(activateRes.statusCode, activateRes.body).toBe(200);

    const timelineAfterActivateRes = await app.inject({ method: "GET", url: `/sessions/${sessionId}/timeline` });
    expect(timelineAfterActivateRes.statusCode).toBe(200);
    const timelineAfterActivateBody = timelineAfterActivateRes.json<{
      data: { floors: Array<{ active_page: { messages: Array<{ content: string }> } | null }> };
    }>();
    expect(timelineAfterActivateBody.data.floors[0]!.active_page?.messages[0]!.content).toBe(
      "The archive lamps are already lit."
    );
  });

  it("supports create_session=false and keeps richer V2 fields for export", async () => {
    const importRes = await app.inject({
      method: "POST",
      url: "/import/character",
      payload: {
        payload: CHARACTER_CARD_V2,
        create_session: false,
      },
    });

    expect(importRes.statusCode, importRes.body).toBe(201);
    const importBody = importRes.json<{
      data: {
        create_session: boolean;
        character: { first_mes: string; mes_example: string };
        character_id: string;
        character_version_id: string;
        session?: unknown;
      };
    }>();

    expect(importBody.data.create_session).toBe(false);
    expect(importBody.data.character.first_mes).toBe(
      "Welcome back. The stars kept your seat warm."
    );
    expect(importBody.data.character.mes_example).toContain("Luna:");
    expect(importBody.data.session).toBeUndefined();
    expect(importBody.data.character_id).toBeDefined();
    expect(importBody.data.character_version_id).toBeDefined();

    const exportRes = await app.inject({
      method: "GET",
      url: `/export/character/${importBody.data.character_id}`,
    });

    expect(exportRes.statusCode, exportRes.body).toBe(200);
    const exportBody = exportRes.json<{
      data: {
        first_mes: string;
        alternate_greetings: string[];
        system_prompt: string;
        post_history_instructions: string;
        creator_notes: string;
        tags: string[];
        creator: string;
        character_version: string;
        extensions: Record<string, unknown>;
      };
    }>();

    expect(exportBody.data.first_mes).toBe("Welcome back. The stars kept your seat warm.");
    expect(exportBody.data.alternate_greetings).toEqual([
      "The archive lamps are already lit.",
      "The charts waited for you.",
    ]);
    expect(exportBody.data.system_prompt).toBe("Stay in character as a moon archivist.");
    expect(exportBody.data.post_history_instructions).toBe("End replies with a soft invitation.");
    expect(exportBody.data.creator_notes).toBe("Imported from integration test.");
    expect(exportBody.data.tags).toEqual(["moon", "archive"]);
    expect(exportBody.data.creator).toBe("Test Suite");
    expect(exportBody.data.character_version).toBe("2.1");
    expect(exportBody.data.extensions).toEqual({ source_app: "vitest" });

    const [versionRow] = await database
      .select()
      .from(characterVersions)
      .where(eq(characterVersions.id, importBody.data.character_version_id))
      .limit(1);

    expect(versionRow).toBeDefined();
    expect(versionRow?.sourceArtifactFormat).toBe("v2");
    expect(versionRow?.sourceArtifactDigest).toBe(
      createHash("sha256").update(JSON.stringify(CHARACTER_CARD_V2)).digest("hex"),
    );
    expect(JSON.parse(versionRow?.sourceArtifactJson ?? "null")).toEqual(CHARACTER_CARD_V2);
    expect(versionRow?.dataJson).not.toBe(versionRow?.sourceArtifactJson);

    const sessionsRes = await app.inject({ method: "GET", url: "/sessions" });
    const sessionsBody = sessionsRes.json<{ data: unknown[] }>();
    expect(sessionsBody.data).toHaveLength(0);
  });

  it("returns 400 for invalid character payload", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/import/character",
      payload: {
        payload: {
          spec: "chara_card_v2",
          data: {
            description: "Missing name",
          },
        },
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: { code: string } }>();
    expect(body.error.code).toBe("import_parse_error");
  });

  it("returns 413 for oversized payload", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/import/character",
      payload: {
        payload: {
          name: "BigCard",
          description: "x".repeat(210_000),
        },
      },
    });

    expect(res.statusCode).toBe(413);
    const body = res.json<{ error: { code: string } }>();
    expect(body.error.code).toBe("import_payload_too_large");
  });
});
