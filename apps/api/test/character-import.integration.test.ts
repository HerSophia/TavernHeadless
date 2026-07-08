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

// 方案 B：内嵌 character_book（v2 数组格式）会被抽取为独立世界书资产。
const CHARACTER_CARD_V2_WITH_BOOK = {
  spec: "chara_card_v2",
  spec_version: "2.0",
  data: {
    name: "Nova",
    description: "A guide through nebulae.",
    personality: "Warm and observant.",
    scenario: "Aboard a drifting observatory.",
    first_mes: "The nebula charts are ready when you are.",
    mes_example: "<START>\nNova: Ask me about the stars.",
    character_book: {
      name: "Nova Codex",
      entries: [
        {
          keys: ["nebula"],
          content: "A nebula is a vast cloud of gas and dust.",
          enabled: true,
          insertion_order: 10,
        },
        {
          keys: ["observatory"],
          content: "The observatory drifts along the cosmic tides.",
          enabled: true,
          insertion_order: 20,
        },
      ],
    },
  },
};

// 内嵌 character_book 存在但没有条目：应回退到旧行为（保留内嵌，不生成独立世界书）。
const CHARACTER_CARD_V2_WITH_EMPTY_BOOK = {
  spec: "chara_card_v2",
  spec_version: "2.0",
  data: {
    name: "Echo",
    description: "A voice among empty halls.",
    first_mes: "Hello?",
    character_book: {
      name: "Echo Codex",
      entries: [],
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
          // 超过 5MB payload 上限但仍在 8MB 路由 bodyLimit 以内，触发应用层 import_payload_too_large
          description: "x".repeat(5_100_000),
        },
      },
    });

    expect(res.statusCode).toBe(413);
    const body = res.json<{ error: { code: string } }>();
    expect(body.error.code).toBe("import_payload_too_large");
  });

  it("extracts an embedded character_book into an independent worldbook and binds it to the created session", async () => {
    const importRes = await app.inject({
      method: "POST",
      url: "/import/character",
      payload: { payload: CHARACTER_CARD_V2_WITH_BOOK },
    });

    expect(importRes.statusCode, importRes.body).toBe(201);
    const importBody = importRes.json<{
      data: {
        create_session: boolean;
        session: { id: string };
        worldbook?: {
          id: string;
          version_id: string;
          name: string;
          entry_count: number;
          source: string;
        };
      };
    }>();

    // 响应回显抽取出的世界书
    expect(importBody.data.worldbook).toBeDefined();
    const worldbook = importBody.data.worldbook!;
    expect(worldbook.name).toBe("Nova Codex");
    expect(worldbook.entry_count).toBe(2);
    expect(worldbook.source).toBe("character_book");
    expect(worldbook.id).toBeDefined();
    expect(worldbook.version_id).toBeDefined();

    // 世界书出现在独立世界书列表里
    const listRes = await app.inject({ method: "GET", url: "/worldbooks" });
    expect(listRes.statusCode).toBe(200);
    const listBody = listRes.json<{ data: Array<{ id: string; name: string }> }>();
    expect(listBody.data.map((item) => item.id)).toContain(worldbook.id);

    // 世界书条目被完整创建
    const detailRes = await app.inject({ method: "GET", url: `/worldbooks/${worldbook.id}` });
    expect(detailRes.statusCode).toBe(200);
    const detailBody = detailRes.json<{
      data: { name: string; data: { entries: Array<{ content: string }> } };
    }>();
    expect(detailBody.data.data.entries).toHaveLength(2);
    const contents = detailBody.data.data.entries.map((entry) => entry.content);
    expect(contents).toContain("A nebula is a vast cloud of gas and dust.");
    expect(contents).toContain("The observatory drifts along the cosmic tides.");

    // 会话被绑定到抽取出的世界书
    const sessionId = importBody.data.session.id;
    const sessionRes = await app.inject({ method: "GET", url: `/sessions/${sessionId}` });
    expect(sessionRes.statusCode).toBe(200);
    const sessionBody = sessionRes.json<{
      data: {
        worldbook_profile_id: string | null;
        worldbook_version_id: string | null;
        character_binding: { character_version_id: string } | null;
      };
    }>();
    expect(sessionBody.data.worldbook_profile_id).toBe(worldbook.id);
    expect(sessionBody.data.worldbook_version_id).toBe(worldbook.version_id);

    // 角色快照里的内嵌 characterBook 已被移除
    const characterVersionId = sessionBody.data.character_binding!.character_version_id;
    const [versionRow] = await database
      .select()
      .from(characterVersions)
      .where(eq(characterVersions.id, characterVersionId))
      .limit(1);
    expect(versionRow).toBeDefined();
    const snapshot = JSON.parse(versionRow?.dataJson ?? "{}") as { characterBook?: unknown };
    expect(snapshot.characterBook).toBeUndefined();
  });

  it("extracts an embedded character_book with create_session=false", async () => {
    const importRes = await app.inject({
      method: "POST",
      url: "/import/character",
      payload: {
        payload: CHARACTER_CARD_V2_WITH_BOOK,
        create_session: false,
      },
    });

    expect(importRes.statusCode, importRes.body).toBe(201);
    const importBody = importRes.json<{
      data: {
        create_session: boolean;
        character_id: string;
        character_version_id: string;
        session?: unknown;
        worldbook?: { id: string; name: string; entry_count: number; source: string };
      };
    }>();

    expect(importBody.data.create_session).toBe(false);
    expect(importBody.data.session).toBeUndefined();
    expect(importBody.data.worldbook).toBeDefined();
    expect(importBody.data.worldbook!.name).toBe("Nova Codex");
    expect(importBody.data.worldbook!.entry_count).toBe(2);
    expect(importBody.data.worldbook!.source).toBe("character_book");

    // 未建会话
    const sessionsRes = await app.inject({ method: "GET", url: "/sessions" });
    expect(sessionsRes.json<{ data: unknown[] }>().data).toHaveLength(0);

    // 世界书已作为独立资产创建
    const listRes = await app.inject({ method: "GET", url: "/worldbooks" });
    expect(listRes.json<{ data: Array<{ id: string }> }>().data.map((item) => item.id)).toContain(
      importBody.data.worldbook!.id,
    );

    // 角色快照里的内嵌 characterBook 已被移除
    const [versionRow] = await database
      .select()
      .from(characterVersions)
      .where(eq(characterVersions.id, importBody.data.character_version_id))
      .limit(1);
    const snapshot = JSON.parse(versionRow?.dataJson ?? "{}") as { characterBook?: unknown };
    expect(snapshot.characterBook).toBeUndefined();
  });

  it("keeps the character_book embedded when it has no entries (fallback)", async () => {
    const importRes = await app.inject({
      method: "POST",
      url: "/import/character",
      payload: {
        payload: CHARACTER_CARD_V2_WITH_EMPTY_BOOK,
        create_session: false,
      },
    });

    expect(importRes.statusCode, importRes.body).toBe(201);
    const importBody = importRes.json<{
      data: { character_version_id: string; worldbook?: unknown };
    }>();

    // 无条目时不生成独立世界书
    expect(importBody.data.worldbook).toBeUndefined();

    const listRes = await app.inject({ method: "GET", url: "/worldbooks" });
    expect(listRes.json<{ data: unknown[] }>().data).toHaveLength(0);

    // 内嵌 characterBook 被保留（回退旧行为）
    const [versionRow] = await database
      .select()
      .from(characterVersions)
      .where(eq(characterVersions.id, importBody.data.character_version_id))
      .limit(1);
    const snapshot = JSON.parse(versionRow?.dataJson ?? "{}") as { characterBook?: unknown };
    expect(snapshot.characterBook).toBeDefined();
  });
});
