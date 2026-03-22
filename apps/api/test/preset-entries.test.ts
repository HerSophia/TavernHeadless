/**
 * Preset Entry Routes Tests
 *
 * 测试预设提示词条目 CRUD + 批量操作。
 * 使用真实 DB（:memory:）。
 */

import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app";

// ── Test data ─────────────────────────────────────────

const PRESET_WITH_ENTRIES = {
  prompts: [
    {
      identifier: "main",
      name: "Main Prompt",
      role: "system",
      content: "You are a helpful assistant.",
      system_prompt: true,
      marker: false,
      injection_position: 0,
      enabled: true,
    },
    {
      identifier: "nsfw",
      name: "NSFW Prompt",
      role: "system",
      content: "NSFW content allowed.",
      system_prompt: false,
      marker: false,
      injection_position: 1,
      enabled: true,
      custom_field: "preserved_value",
    },
    {
      identifier: "chatHistory",
      name: "Chat History",
      role: "system",
      content: "",
      system_prompt: false,
      marker: true,
      injection_position: 0,
      enabled: true,
    },
  ],
  prompt_order: [
    {
      character_id: 100000,
      order: [
        { identifier: "main", enabled: true },
        { identifier: "nsfw", enabled: false },
        { identifier: "chatHistory", enabled: true },
      ],
    },
  ],
  temperature: 0.8,
};

const PRESET_WITH_MULTI_CONTEXT = {
  prompts: [
    { identifier: "main", name: "Main", role: "system", content: "Main prompt.", enabled: true },
    { identifier: "jailbreak", name: "JB", role: "system", content: "JB prompt.", enabled: true },
  ],
  prompt_order: [
    {
      character_id: 100000,
      order: [
        { identifier: "main", enabled: true },
        { identifier: "jailbreak", enabled: true },
      ],
      xiaobai_ext: "custom_context_data",
    },
    {
      character_id: 200000,
      order: [
        { identifier: "jailbreak", enabled: false },
        { identifier: "main", enabled: true },
      ],
    },
  ],
  temperature: 0.9,
};

// ── Helpers ───────────────────────────────────────────

let app: FastifyInstance;

async function importPreset(data: Record<string, unknown>, name = "Test Preset"): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/import/preset",
    payload: { name, data },
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { data: { id: string } }).data.id;
}

beforeEach(async () => {
  ({ app } = await buildApp({ databasePath: ":memory:", logger: false }));
});

afterEach(async () => {
  await app.close();
});

// ── Tests ─────────────────────────────────────────────

describe("Preset Entry Routes", () => {

  // ── List ─────────────────────────────────────────

  describe("GET /presets/:preset_id/entries", () => {
    it("should list all entries sorted by default context order", async () => {
      const presetId = await importPreset(PRESET_WITH_ENTRIES);
      const res = await app.inject({ method: "GET", url: `/presets/${presetId}/entries` });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: { preset_id: string; default_character_id: number; entries: Array<{ identifier: string; enabled: boolean }> } };
      expect(body.data.preset_id).toBe(presetId);
      expect(body.data.default_character_id).toBe(100000);
      expect(body.data.entries).toHaveLength(3);
      expect(body.data.entries.map((e) => e.identifier)).toEqual(["main", "nsfw", "chatHistory"]);
      // nsfw should be disabled per prompt_order
      expect(body.data.entries[1]!.enabled).toBe(false);
    });

    it("should return 404 for non-existent preset", async () => {
      const res = await app.inject({ method: "GET", url: "/presets/nonexistent/entries" });
      expect(res.statusCode).toBe(404);
    });

    it("should filter by enabled", async () => {
      const presetId = await importPreset(PRESET_WITH_ENTRIES);
      const res = await app.inject({ method: "GET", url: `/presets/${presetId}/entries?enabled=true` });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: { entries: Array<{ identifier: string }> } };
      // nsfw is disabled, so only main and chatHistory
      expect(body.data.entries.map((e) => e.identifier)).toEqual(["main", "chatHistory"]);
    });

    it("should filter by marker", async () => {
      const presetId = await importPreset(PRESET_WITH_ENTRIES);
      const res = await app.inject({ method: "GET", url: `/presets/${presetId}/entries?marker=true` });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: { entries: Array<{ identifier: string }> } };
      expect(body.data.entries.map((e) => e.identifier)).toEqual(["chatHistory"]);
    });
  });

  // ── Create ───────────────────────────────────────

  describe("POST /presets/:preset_id/entries", () => {
    it("should create a new entry and return 201", async () => {
      const presetId = await importPreset(PRESET_WITH_ENTRIES);
      const res = await app.inject({
        method: "POST",
        url: `/presets/${presetId}/entries`,
        payload: {
          identifier: "custom_prompt",
          name: "Custom",
          role: "user",
          content: "Hello world",
          enabled: true,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json() as { data: { identifier: string; name: string; role: string; content: string } };
      expect(body.data.identifier).toBe("custom_prompt");
      expect(body.data.name).toBe("Custom");
      expect(body.data.role).toBe("user");
      expect(body.data.content).toBe("Hello world");

      // Verify it appears in the list
      const listRes = await app.inject({ method: "GET", url: `/presets/${presetId}/entries` });
      const listBody = listRes.json() as { data: { entries: Array<{ identifier: string }> } };
      expect(listBody.data.entries.map((e) => e.identifier)).toContain("custom_prompt");
    });

    it("should return 409 for duplicate identifier", async () => {
      const presetId = await importPreset(PRESET_WITH_ENTRIES);
      const res = await app.inject({
        method: "POST",
        url: `/presets/${presetId}/entries`,
        payload: { identifier: "main", content: "Duplicate" },
      });
      expect(res.statusCode).toBe(409);
    });

    it("should return 400 for invalid identifier format", async () => {
      const presetId = await importPreset(PRESET_WITH_ENTRIES);
      const res = await app.inject({
        method: "POST",
        url: `/presets/${presetId}/entries`,
        payload: { identifier: "invalid/chars", content: "Test" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("should preserve extra fields", async () => {
      const presetId = await importPreset(PRESET_WITH_ENTRIES);
      const res = await app.inject({
        method: "POST",
        url: `/presets/${presetId}/entries`,
        payload: {
          identifier: "with_extra",
          content: "Test",
          extra: { my_custom: "value", nested: { a: 1 } },
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json() as { data: { extra: Record<string, unknown> } };
      expect(body.data.extra).toEqual({ my_custom: "value", nested: { a: 1 } });
    });
  });

  // ── Get ──────────────────────────────────────────

  describe("GET /presets/:preset_id/entries/:identifier", () => {
    it("should return a single entry", async () => {
      const presetId = await importPreset(PRESET_WITH_ENTRIES);
      const res = await app.inject({ method: "GET", url: `/presets/${presetId}/entries/main` });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: { identifier: string; content: string } };
      expect(body.data.identifier).toBe("main");
      expect(body.data.content).toBe("You are a helpful assistant.");
    });

    it("should return 404 for non-existent entry", async () => {
      const presetId = await importPreset(PRESET_WITH_ENTRIES);
      const res = await app.inject({ method: "GET", url: `/presets/${presetId}/entries/nonexistent` });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── Update ──────────────────────────────────────

  describe("PATCH /presets/:preset_id/entries/:identifier", () => {
    it("should update content", async () => {
      const presetId = await importPreset(PRESET_WITH_ENTRIES);
      const res = await app.inject({
        method: "PATCH",
        url: `/presets/${presetId}/entries/main`,
        payload: { content: "Updated content." },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: { content: string } };
      expect(body.data.content).toBe("Updated content.");
    });

    it("should update enabled and sync prompt_order", async () => {
      const presetId = await importPreset(PRESET_WITH_ENTRIES);
      // main is enabled=true, disable it
      const res = await app.inject({
        method: "PATCH",
        url: `/presets/${presetId}/entries/main`,
        payload: { enabled: false },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: { enabled: boolean } };
      expect(body.data.enabled).toBe(false);

      // Verify via list
      const listRes = await app.inject({ method: "GET", url: `/presets/${presetId}/entries` });
      const listBody = listRes.json() as { data: { entries: Array<{ identifier: string; enabled: boolean }> } };
      const mainEntry = listBody.data.entries.find((e) => e.identifier === "main");
      expect(mainEntry?.enabled).toBe(false);
    });

    it("should return 400 for empty body", async () => {
      const presetId = await importPreset(PRESET_WITH_ENTRIES);
      const res = await app.inject({
        method: "PATCH",
        url: `/presets/${presetId}/entries/main`,
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it("should return 404 for non-existent entry", async () => {
      const presetId = await importPreset(PRESET_WITH_ENTRIES);
      const res = await app.inject({
        method: "PATCH",
        url: `/presets/${presetId}/entries/nonexistent`,
        payload: { content: "test" },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── Delete ──────────────────────────────────────

  describe("DELETE /presets/:preset_id/entries/:identifier", () => {
    it("should delete an entry", async () => {
      const presetId = await importPreset(PRESET_WITH_ENTRIES);
      const res = await app.inject({
        method: "DELETE",
        url: `/presets/${presetId}/entries/nsfw`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: { identifier: string; deleted: boolean } };
      expect(body.data.identifier).toBe("nsfw");
      expect(body.data.deleted).toBe(true);

      // Verify removal
      const listRes = await app.inject({ method: "GET", url: `/presets/${presetId}/entries` });
      const listBody = listRes.json() as { data: { entries: Array<{ identifier: string }> } };
      expect(listBody.data.entries.map((e) => e.identifier)).not.toContain("nsfw");
      expect(listBody.data.entries).toHaveLength(2);
    });

    it("should return 404 for non-existent entry", async () => {
      const presetId = await importPreset(PRESET_WITH_ENTRIES);
      const res = await app.inject({
        method: "DELETE",
        url: `/presets/${presetId}/entries/nonexistent`,
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── Reorder ─────────────────────────────────────

  describe("PUT /presets/:preset_id/entries/reorder", () => {
    it("should reorder entries", async () => {
      const presetId = await importPreset(PRESET_WITH_ENTRIES);
      const res = await app.inject({
        method: "PUT",
        url: `/presets/${presetId}/entries/reorder`,
        payload: { identifiers: ["chatHistory", "nsfw", "main"] },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: { entries: Array<{ identifier: string }> } };
      expect(body.data.entries.map((e) => e.identifier)).toEqual(["chatHistory", "nsfw", "main"]);
    });

    it("should append unlisted entries at the end", async () => {
      const presetId = await importPreset(PRESET_WITH_ENTRIES);
      const res = await app.inject({
        method: "PUT",
        url: `/presets/${presetId}/entries/reorder`,
        payload: { identifiers: ["chatHistory"] },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: { entries: Array<{ identifier: string }> } };
      // chatHistory first, then main and nsfw in their original order
      expect(body.data.entries[0]!.identifier).toBe("chatHistory");
      expect(body.data.entries).toHaveLength(3);
    });
  });

  // ── Batch Update ────────────────────────────────

  describe("PATCH /presets/:preset_id/entries/batch/update", () => {
    it("should batch update enabled for multiple entries", async () => {
      const presetId = await importPreset(PRESET_WITH_ENTRIES);
      const res = await app.inject({
        method: "PATCH",
        url: `/presets/${presetId}/entries/batch/update`,
        payload: {
          identifiers: ["main", "nsfw"],
          fields: { enabled: false },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: { results: Array<{ identifier: string; action: string }>; meta: { updated: number } } };
      expect(body.data.meta.updated).toBe(2);
      expect(body.data.results[0]!.action).toBe("updated");
      expect(body.data.results[1]!.action).toBe("updated");
    });

    it("should report not_found for missing entries", async () => {
      const presetId = await importPreset(PRESET_WITH_ENTRIES);
      const res = await app.inject({
        method: "PATCH",
        url: `/presets/${presetId}/entries/batch/update`,
        payload: {
          identifiers: ["main", "nonexistent"],
          fields: { enabled: false },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: { meta: { updated: number; not_found: number } } };
      expect(body.data.meta.updated).toBe(1);
      expect(body.data.meta.not_found).toBe(1);
    });
  });

  // ── Batch Delete ────────────────────────────────

  describe("POST /presets/:preset_id/entries/batch/delete", () => {
    it("should batch delete multiple entries", async () => {
      const presetId = await importPreset(PRESET_WITH_ENTRIES);
      const res = await app.inject({
        method: "POST",
        url: `/presets/${presetId}/entries/batch/delete`,
        payload: { identifiers: ["main", "nsfw"] },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: { meta: { deleted: number } } };
      expect(body.data.meta.deleted).toBe(2);

      // Verify only chatHistory remains
      const listRes = await app.inject({ method: "GET", url: `/presets/${presetId}/entries` });
      const listBody = listRes.json() as { data: { entries: Array<{ identifier: string }> } };
      expect(listBody.data.entries).toHaveLength(1);
      expect(listBody.data.entries[0]!.identifier).toBe("chatHistory");
    });

    it("should report not_found for missing entries", async () => {
      const presetId = await importPreset(PRESET_WITH_ENTRIES);
      const res = await app.inject({
        method: "POST",
        url: `/presets/${presetId}/entries/batch/delete`,
        payload: { identifiers: ["main", "nonexistent"] },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: { meta: { deleted: number; not_found: number } } };
      expect(body.data.meta.deleted).toBe(1);
      expect(body.data.meta.not_found).toBe(1);
    });
  });

  // ── Round-trip Compatibility ────────────────────

  describe("Round-trip compatibility", () => {
    it("should preserve extra fields on unmodified entries", async () => {
      const presetId = await importPreset(PRESET_WITH_ENTRIES);

      // nsfw has custom_field: "preserved_value"
      // Modify main, then check nsfw's extra is preserved
      await app.inject({
        method: "PATCH",
        url: `/presets/${presetId}/entries/main`,
        payload: { content: "Changed" },
      });

      // Read raw preset
      const rawRes = await app.inject({ method: "GET", url: `/presets/${presetId}` });
      expect(rawRes.statusCode).toBe(200);
      const rawBody = rawRes.json() as { data: { data: { prompts: Array<{ identifier: string; custom_field?: string }> } } };
      const nsfwPrompt = rawBody.data.data.prompts.find((p) => p.identifier === "nsfw");
      expect(nsfwPrompt?.custom_field).toBe("preserved_value");
    });

    it("should remove deleted entry from all prompt_order contexts", async () => {
      const presetId = await importPreset(PRESET_WITH_MULTI_CONTEXT);

      // Delete jailbreak
      const delRes = await app.inject({
        method: "DELETE",
        url: `/presets/${presetId}/entries/jailbreak`,
      });
      expect(delRes.statusCode).toBe(200);

      // Read raw preset and check all contexts
      const rawRes = await app.inject({ method: "GET", url: `/presets/${presetId}` });
      const rawBody = rawRes.json() as { data: { data: { prompt_order: Array<{ character_id: number; order: Array<{ identifier: string }>; xiaobai_ext?: string }> } } };
      const contexts = rawBody.data.data.prompt_order;

      // jailbreak should be gone from all contexts
      for (const ctx of contexts) {
        const ids = ctx.order.map((o) => o.identifier);
        expect(ids).not.toContain("jailbreak");
      }

      // Other context's extra field should be preserved
      const defaultCtx = contexts.find((c) => c.character_id === 100000);
      expect(defaultCtx?.xiaobai_ext).toBe("custom_context_data");

      // character_id 200000 context should still exist
      const otherCtx = contexts.find((c) => c.character_id === 200000);
      expect(otherCtx).toBeDefined();
    });

    it("should preserve top-level preset fields after entry modifications", async () => {
      const presetId = await importPreset(PRESET_WITH_ENTRIES);

      // Do several modifications
      await app.inject({
        method: "POST",
        url: `/presets/${presetId}/entries`,
        payload: { identifier: "new_entry", content: "New" },
      });
      await app.inject({
        method: "DELETE",
        url: `/presets/${presetId}/entries/nsfw`,
      });

      // Check top-level field preserved
      const rawRes = await app.inject({ method: "GET", url: `/presets/${presetId}` });
      const rawBody = rawRes.json() as { data: { data: { temperature: number } } };
      expect(rawBody.data.data.temperature).toBe(0.8);
    });
  });
});
