/**
 * Import Routes Tests
 *
 * 测试 SillyTavern 资源导入 + 导入资源 CRUD。
 * 使用真实 DB（:memory:）+ 真实 adapters-sillytavern 解析器。
 */

import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app";

// ── 最小有效酒馆数据 ──────────────────────────────────

/** 最小有效预设 JSON（所有字段都有默认值） */
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

const LEGACY_COMPACT_PRESET = {
  prompts: [
    {
      identifier: "main",
      name: "Main Prompt",
      role: "system",
      content: "Legacy format prompt",
      enabled: false
    }
  ],
  promptOrder: ["main"],
  maxContext: 6000,
  maxTokens: 400,
  topP: 0.92
};

const MULTI_CONTEXT_PRESET = {
  prompts: [
    { identifier: "a", name: "A", role: "system", content: "A" },
    { identifier: "b", name: "B", role: "system", content: "B" },
    { identifier: "c", name: "C", role: "system", content: "C" },
    { identifier: "d", name: "D", role: "system", content: "D" }
  ],
  prompt_order: [
    {
      character_id: 100000,
      order: [
        { identifier: "a", enabled: true },
        { identifier: "b", enabled: true }
      ]
    },
    {
      character_id: 200123,
      order: [
        { identifier: "c", enabled: true },
        { identifier: "d", enabled: false },
        { identifier: "a", enabled: true },
        { identifier: "b", enabled: true }
      ]
    }
  ],
  temperature: 0.8,
  openai_max_context: 5000,
  openai_max_tokens: 400
};

/** 最小有效世界书 JSON */
const MINIMAL_WORLDBOOK = {
  name: "Test World",
  entries: {
    "0": {
      uid: 0,
      key: ["dragon"],
      content: "Dragons are powerful creatures.",
      position: 0,
      constant: false,
      selective: false,
    },
  },
};

/** 最小有效正则脚本 JSON 数组 */
const MINIMAL_REGEX_SCRIPTS = [
  {
    id: "regex-1",
    scriptName: "Test Regex",
    findRegex: "hello",
    replaceString: "world",
    placement: [1, 2], // USER_INPUT + AI_OUTPUT
    disabled: false,
  },
];

// ── 辅助类型 ──────────────────────────────────────────

interface ImportResponse {
  data: {
    id: string;
    name: string;
    source: string;
    script_count?: number;
  };
}

interface ListResponse {
  data: Array<{
    id: string;
    name: string;
    source: string;
    created_at: number;
    version: number;
    updated_at: number;
  }>;
}

interface DetailResponse {
  data: {
    id: string;
    name: string;
    source: string;
    data: unknown;
    created_at: number;
    version: number;
    updated_at: number;
  };
}

interface PresetEditorResponse {
  data: {
    id: string;
    name: string;
    source: string;
    created_at: number;
    version: number;
    updated_at: number;
    editor: {
      format: "legacy-compact" | "st-raw";
      default_character_id: number;
      entries: Array<{
        identifier: string;
        name: string;
        role: "assistant" | "system" | "user";
        content: string;
        enabled: boolean;
      }>;
      order_contexts: Array<{
        character_id: number;
        order: Array<{ identifier: string; enabled: boolean }>;
      }>;
      top_level: Record<string, unknown>;
    };
  };
}

interface PresetUpdateResponse {
  data: {
    id: string;
    name: string;
    version: number;
  };
}

// ── Tests ─────────────────────────────────────────────

describe("Import Routes", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    ({ app } = await buildApp({ databasePath: ":memory:", logger: false }));
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  // ══════════════════════════════════════════════════════
  // Preset
  // ══════════════════════════════════════════════════════

  describe("Preset import & CRUD", () => {
    it("POST /import/preset should import a valid preset", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/import/preset",
        payload: {
          name: "My Preset",
          data: MINIMAL_PRESET,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json() as ImportResponse;
      expect(body.data.id).toBeDefined();
      expect(body.data.name).toBe("My Preset");
      expect(body.data.source).toBe("sillytavern");
    });

    it("POST /import/preset should return 400 for invalid data", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/import/preset",
        payload: {
          name: "Bad Preset",
          data: {
            // prompts 必须是数组，这里用无效类型
            prompts: "not-an-array",
          },
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json() as { error: { code: string } };
      expect(body.error.code).toBe("import_parse_error");
    });

    it("POST /import/preset should use default name when not provided", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/import/preset",
        payload: {
          data: MINIMAL_PRESET,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json() as ImportResponse;
      expect(body.data.name).toBe("Unnamed Preset");
    });

    it("GET /presets should list imported presets", async () => {
      // 导入两个
      await app.inject({
        method: "POST",
        url: "/import/preset",
        payload: { name: "Preset A", data: MINIMAL_PRESET },
      });
      await app.inject({
        method: "POST",
        url: "/import/preset",
        payload: { name: "Preset B", data: MINIMAL_PRESET },
      });

      const res = await app.inject({ method: "GET", url: "/presets" });
      expect(res.statusCode).toBe(200);

      const body = res.json() as ListResponse;
      expect(body.data.length).toBe(2);
      expect(body.data.map((r) => r.name).sort()).toEqual(["Preset A", "Preset B"]);
    });

    it("GET /presets/:id should return preset details with raw data", async () => {
      const importRes = await app.inject({
        method: "POST",
        url: "/import/preset",
        payload: { name: "Detail Preset", data: MINIMAL_PRESET },
      });
      const presetId = (importRes.json() as ImportResponse).data.id;

      const res = await app.inject({ method: "GET", url: `/presets/${presetId}` });
      expect(res.statusCode).toBe(200);

      const body = res.json() as DetailResponse;
      expect(body.data.id).toBe(presetId);
      expect(body.data.name).toBe("Detail Preset");
      expect(body.data.source).toBe("sillytavern");
      const raw = body.data.data as Record<string, unknown>;
      expect(raw.temperature).toBe(0.8);
      expect(raw.openai_max_context).toBe(8000);
      expect(Array.isArray(raw.prompt_order)).toBe(true);
    });

    it("GET /presets/:id/editor should return editor projection", async () => {
      const importRes = await app.inject({
        method: "POST",
        url: "/import/preset",
        payload: { name: "Editor Preset", data: MINIMAL_PRESET }
      });
      const presetId = (importRes.json() as ImportResponse).data.id;

      const res = await app.inject({ method: "GET", url: `/presets/${presetId}/editor` });
      expect(res.statusCode).toBe(200);

      const body = res.json() as PresetEditorResponse;
      expect(body.data.id).toBe(presetId);
      expect(body.data.editor.format).toBe("st-raw");
      expect(body.data.editor.default_character_id).toBe(100000);
      expect(body.data.editor.entries.map((entry) => entry.identifier)).toEqual(["main"]);
      expect(body.data.editor.order_contexts[0]?.order[0]?.enabled).toBe(true);
    });

    it("GET /presets/:id/editor should project legacy compact preset", async () => {
      const importRes = await app.inject({
        method: "POST",
        url: "/import/preset",
        payload: { name: "Legacy Preset", data: LEGACY_COMPACT_PRESET }
      });
      const presetId = (importRes.json() as ImportResponse).data.id;

      const res = await app.inject({ method: "GET", url: `/presets/${presetId}/editor` });
      expect(res.statusCode).toBe(200);
      const body = res.json() as PresetEditorResponse;
      expect(body.data.editor.format).toBe("legacy-compact");
      expect(body.data.editor.entries[0]?.identifier).toBe("main");
      expect(body.data.editor.entries[0]?.enabled).toBe(true);
      expect(body.data.editor.top_level.openai_max_context).toBe(6000);

      const detailRes = await app.inject({ method: "GET", url: `/presets/${presetId}` });
      expect(detailRes.statusCode).toBe(200);
      const detailBody = detailRes.json() as DetailResponse;
      const raw = detailBody.data.data as Record<string, unknown>;
      expect(raw.maxContext).toBe(6000);
    });

    it("GET /presets/:id/editor should prefer richest prompt_order context", async () => {
      const importRes = await app.inject({
        method: "POST",
        url: "/import/preset",
        payload: { name: "Multi Context", data: MULTI_CONTEXT_PRESET }
      });
      const presetId = (importRes.json() as ImportResponse).data.id;

      const res = await app.inject({ method: "GET", url: `/presets/${presetId}/editor` });
      expect(res.statusCode).toBe(200);

      const body = res.json() as PresetEditorResponse;
      expect(body.data.editor.default_character_id).toBe(200123);
      expect(body.data.editor.entries.map((entry) => entry.identifier).slice(0, 4)).toEqual(["c", "d", "a", "b"]);

      const dEntry = body.data.editor.entries.find((entry) => entry.identifier === "d");
      expect(dEntry?.enabled).toBe(false);
    });

    it("PUT /presets/:id should update preset in place", async () => {
      const importRes = await app.inject({
        method: "POST",
        url: "/import/preset",
        payload: { name: "Update Source", data: MINIMAL_PRESET }
      });
      const imported = importRes.json() as ImportResponse;
      const presetId = imported.data.id;

      const editorRes = await app.inject({ method: "GET", url: `/presets/${presetId}/editor` });
      const editorBody = editorRes.json() as PresetEditorResponse;
      const editorDocument = editorBody.data.editor;

      const updatedEntries = editorDocument.entries.map((entry) =>
        entry.identifier === "main"
          ? {
              ...entry,
              content: "You are an updated assistant.",
              enabled: false
            }
          : entry
      );

      const putRes = await app.inject({
        method: "PUT",
        url: `/presets/${presetId}`,
        payload: {
          name: "Updated Preset",
          expected_version: editorBody.data.version,
          editor: {
            ...editorDocument,
            entries: updatedEntries
          }
        }
      });
      expect(putRes.statusCode).toBe(200);
      const putBody = putRes.json() as PresetUpdateResponse;
      expect(putBody.data.id).toBe(presetId);
      expect(putBody.data.name).toBe("Updated Preset");
      expect(putBody.data.version).toBe(editorBody.data.version + 1);

      const detailRes = await app.inject({ method: "GET", url: `/presets/${presetId}` });
      expect(detailRes.statusCode).toBe(200);
      const detailBody = detailRes.json() as DetailResponse;
      const updatedRaw = detailBody.data.data as Record<string, unknown>;
      expect(updatedRaw.prompts).toBeDefined();
      expect((updatedRaw.prompts as Array<Record<string, unknown>>)[0]?.content).toBe("You are an updated assistant.");

      const updatedEditorRes = await app.inject({ method: "GET", url: `/presets/${presetId}/editor` });
      expect(updatedEditorRes.statusCode).toBe(200);
      const updatedEditorBody = updatedEditorRes.json() as PresetEditorResponse;
      expect(updatedEditorBody.data.editor.entries[0]?.enabled).toBe(false);
    });

    it("PUT /presets/:id should return 409 when expected_updated_at mismatches", async () => {
      const importRes = await app.inject({
        method: "POST",
        url: "/import/preset",
        payload: { name: "Conflict Preset", data: MINIMAL_PRESET }
      });
      const presetId = (importRes.json() as ImportResponse).data.id;

      const putRes = await app.inject({
        method: "PUT",
        url: `/presets/${presetId}`,
        payload: {
          name: "Conflict Preset",
          editor: {
            default_character_id: 100000,
            entries: [],
            order_contexts: [],
            top_level: {}
          },
          expected_updated_at: 1
        }
      });

      expect(putRes.statusCode).toBe(409);
    });

    it("GET /presets/:id should return 404 for non-existent preset", async () => {
      const res = await app.inject({ method: "GET", url: "/presets/non-existent" });
      expect(res.statusCode).toBe(404);
    });

    it("DELETE /presets/:id should delete a preset", async () => {
      const importRes = await app.inject({
        method: "POST",
        url: "/import/preset",
        payload: { name: "To Delete", data: MINIMAL_PRESET },
      });
      const presetId = (importRes.json() as ImportResponse).data.id;

      const delRes = await app.inject({ method: "DELETE", url: `/presets/${presetId}` });
      expect(delRes.statusCode).toBe(204);

      // 确认已删除
      const getRes = await app.inject({ method: "GET", url: `/presets/${presetId}` });
      expect(getRes.statusCode).toBe(404);
    });
  });

  // ══════════════════════════════════════════════════════
  // Worldbook
  // ══════════════════════════════════════════════════════

  describe("Worldbook import & CRUD", () => {
    it("POST /import/worldbook should import a valid worldbook", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/import/worldbook",
        payload: {
          name: "My World",
          data: MINIMAL_WORLDBOOK,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json() as ImportResponse;
      expect(body.data.id).toBeDefined();
      expect(body.data.name).toBe("My World");
      expect(body.data.source).toBe("sillytavern");
    });

    it("POST /import/worldbook should use worldbook name when custom name not provided", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/import/worldbook",
        payload: {
          data: MINIMAL_WORLDBOOK,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json() as ImportResponse;
      expect(body.data.name).toBe("Test World");
    });

    it("POST /import/worldbook should return 400 for invalid data", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/import/worldbook",
        payload: {
          name: "Bad WB",
          data: {
            entries: "not-valid",
          },
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json() as { error: { code: string } };
      expect(body.error.code).toBe("import_parse_error");
    });

    it("GET /worldbooks should list imported worldbooks", async () => {
      await app.inject({
        method: "POST",
        url: "/import/worldbook",
        payload: { name: "World A", data: MINIMAL_WORLDBOOK },
      });

      const res = await app.inject({ method: "GET", url: "/worldbooks" });
      expect(res.statusCode).toBe(200);

      const body = res.json() as ListResponse;
      expect(body.data.length).toBe(1);
      expect(body.data[0]!.name).toBe("World A");
    });

    it("GET /worldbooks/:id should return worldbook details", async () => {
      const importRes = await app.inject({
        method: "POST",
        url: "/import/worldbook",
        payload: { name: "Detail WB", data: MINIMAL_WORLDBOOK },
      });
      const wbId = (importRes.json() as ImportResponse).data.id;

      const res = await app.inject({ method: "GET", url: `/worldbooks/${wbId}` });
      expect(res.statusCode).toBe(200);

      const body = res.json() as DetailResponse;
      expect(body.data.name).toBe("Detail WB");
      const parsed = body.data.data as Record<string, unknown>;
      expect(parsed.entries).toBeDefined();
      expect(Array.isArray(parsed.entries)).toBe(true);
    });

    it("PUT /worldbooks/:id should update worldbook in place", async () => {
      const importRes = await app.inject({
        method: "POST",
        url: "/import/worldbook",
        payload: { name: "Update WB", data: MINIMAL_WORLDBOOK }
      });
      const wbId = (importRes.json() as ImportResponse).data.id;

      const detailRes = await app.inject({ method: "GET", url: `/worldbooks/${wbId}` });
      expect(detailRes.statusCode).toBe(200);
      const detailBody = detailRes.json() as DetailResponse;
      const worldbookData = detailBody.data.data as Record<string, unknown>;

      const entries = Array.isArray(worldbookData.entries) ? worldbookData.entries : [];
      const firstEntry = entries[0] as Record<string, unknown> | undefined;
      expect(firstEntry).toBeDefined();
      const updatedEntry = {
        ...(firstEntry as Record<string, unknown>),
        content: "Updated worldbook content"
      };

      const putRes = await app.inject({
        method: "PUT",
        url: `/worldbooks/${wbId}`,
        payload: {
          name: "Updated WB",
          expected_version: detailBody.data.version,
          data: {
            ...worldbookData,
            entries: [updatedEntry, ...entries.slice(1)]
          }
        }
      });
      expect(putRes.statusCode).toBe(200);
      expect((putRes.json() as { data: { version: number } }).data.version).toBe(detailBody.data.version + 1);

      const updatedRes = await app.inject({ method: "GET", url: `/worldbooks/${wbId}` });
      expect(updatedRes.statusCode).toBe(200);
      const updatedBody = updatedRes.json() as DetailResponse;
      expect(updatedBody.data.name).toBe("Updated WB");
      const updatedData = updatedBody.data.data as Record<string, unknown>;
      const updatedEntries = Array.isArray(updatedData.entries) ? updatedData.entries : [];
      expect((updatedEntries[0] as Record<string, unknown> | undefined)?.content).toBe("Updated worldbook content");
    });

    it("PUT /worldbooks/:id should return 409 when expected_updated_at mismatches", async () => {
      const importRes = await app.inject({
        method: "POST",
        url: "/import/worldbook",
        payload: { name: "Conflict WB", data: MINIMAL_WORLDBOOK }
      });
      const wbId = (importRes.json() as ImportResponse).data.id;

      const putRes = await app.inject({
        method: "PUT",
        url: `/worldbooks/${wbId}`,
        payload: {
          name: "Conflict WB",
          data: MINIMAL_WORLDBOOK,
          expected_updated_at: 1
        }
      });
      expect(putRes.statusCode).toBe(409);
    });

    it("DELETE /worldbooks/:id should delete a worldbook", async () => {
      const importRes = await app.inject({
        method: "POST",
        url: "/import/worldbook",
        payload: { name: "To Delete WB", data: MINIMAL_WORLDBOOK },
      });
      const wbId = (importRes.json() as ImportResponse).data.id;

      const delRes = await app.inject({ method: "DELETE", url: `/worldbooks/${wbId}` });
      expect(delRes.statusCode).toBe(204);

      const getRes = await app.inject({ method: "GET", url: `/worldbooks/${wbId}` });
      expect(getRes.statusCode).toBe(404);
    });
  });

  // ══════════════════════════════════════════════════════
  // Regex Profile
  // ══════════════════════════════════════════════════════

  describe("Regex import & CRUD", () => {
    it("POST /import/regex should import valid regex scripts", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/import/regex",
        payload: {
          name: "My Regex Profile",
          data: MINIMAL_REGEX_SCRIPTS,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json() as ImportResponse;
      expect(body.data.id).toBeDefined();
      expect(body.data.name).toBe("My Regex Profile");
      expect(body.data.source).toBe("sillytavern");
      expect(body.data.script_count).toBe(1);
    });

    it("POST /import/regex should return 400 when name is missing", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/import/regex",
        payload: {
          data: MINIMAL_REGEX_SCRIPTS,
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it("POST /import/regex should return 400 for invalid data", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/import/regex",
        payload: {
          name: "Bad Regex",
          data: [
            {
              // findRegex is required
              replaceString: "test",
            },
          ],
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json() as { error: { code: string } };
      expect(body.error.code).toBe("import_parse_error");
    });

    it("GET /regex-profiles should list imported profiles", async () => {
      await app.inject({
        method: "POST",
        url: "/import/regex",
        payload: { name: "Profile A", data: MINIMAL_REGEX_SCRIPTS },
      });

      const res = await app.inject({ method: "GET", url: "/regex-profiles" });
      expect(res.statusCode).toBe(200);

      const body = res.json() as ListResponse;
      expect(body.data.length).toBe(1);
      expect(body.data[0]!.name).toBe("Profile A");
    });

    it("GET /regex-profiles/:id should return profile details", async () => {
      const importRes = await app.inject({
        method: "POST",
        url: "/import/regex",
        payload: { name: "Detail Profile", data: MINIMAL_REGEX_SCRIPTS },
      });
      const profileId = (importRes.json() as ImportResponse).data.id;

      const res = await app.inject({ method: "GET", url: `/regex-profiles/${profileId}` });
      expect(res.statusCode).toBe(200);

      const body = res.json() as DetailResponse;
      expect(body.data.name).toBe("Detail Profile");
      const parsed = body.data.data as unknown[];
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(1);
    });

    it("DELETE /regex-profiles/:id should delete a profile", async () => {
      const importRes = await app.inject({
        method: "POST",
        url: "/import/regex",
        payload: { name: "To Delete", data: MINIMAL_REGEX_SCRIPTS },
      });
      const profileId = (importRes.json() as ImportResponse).data.id;

      const delRes = await app.inject({ method: "DELETE", url: `/regex-profiles/${profileId}` });
      expect(delRes.statusCode).toBe(204);

      const getRes = await app.inject({ method: "GET", url: `/regex-profiles/${profileId}` });
      expect(getRes.statusCode).toBe(404);
    });
  });
});
