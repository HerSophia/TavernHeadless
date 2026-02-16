import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app";

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
  },
};

describe("Character Import Route", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    ({ app } = await buildApp({ databasePath: ":memory:", logger: false }));
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
          floor_no: number;
          active_page: { messages: Array<{ role: string; content: string }> } | null;
        }>;
      };
    }>();

    expect(timelineBody.data.floors).toHaveLength(1);
    expect(timelineBody.data.floors[0]!.floor_no).toBe(0);
    expect(timelineBody.data.floors[0]!.active_page?.messages[0]!.role).toBe("assistant");
    expect(timelineBody.data.floors[0]!.active_page?.messages[0]!.content).toBe(
      "Welcome back. The stars kept your seat warm."
    );
  });

  it("supports create_session=false and only returns normalized data", async () => {
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
