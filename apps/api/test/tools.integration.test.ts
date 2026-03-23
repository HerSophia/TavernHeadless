import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app";

type ItemResponse<T> = { data: T };
type ListResponse<T> = {
  data: T[];
  meta: {
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
    sort_by: string;
    sort_order: "asc" | "desc";
  };
};
type ErrorResponse = {
  error: { code: string; message: string; details?: unknown };
};

interface ToolDefinitionData {
  id: string;
  name: string;
  description: string;
  parameters: unknown;
  side_effect_level: string;
  allowed_slots: unknown;
  source: string;
  source_id: string | null;
  enabled: boolean;
  handler_type: string;
  handler: unknown;
  created_at: number;
  updated_at: number;
}

interface BuiltinToolData {
  name: string;
  description: string;
  parameters: unknown;
  side_effect_level: string;
  allowed_slots: unknown;
  source: string;
}

interface CallRecordData {
  id: string;
  page_id: string;
  seq: number;
  caller_slot: string;
  tool_name: string;
  args: unknown;
  result: unknown;
  status: string;
  duration_ms: number;
  created_at: number;
}

// ── Helpers ─────────────────────────────────────────

async function createSession(app: FastifyInstance, payload: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: "POST",
    url: "/sessions",
    payload: { title: "Test Session", ...payload },
  });
  return res.json<ItemResponse<{ id: string }>>().data;
}

async function createDefinition(
  app: FastifyInstance,
  payload: Record<string, unknown> = {},
) {
  const res = await app.inject({
    method: "POST",
    url: "/tools/definitions",
    payload: {
      name: "test_tool",
      description: "A test tool",
      handler_type: "script",
      handler: { script: "return args" },
      ...payload,
    },
  });
  return res;
}

// ── Tests ──────────────────────────────────────────

describe("Tool Routes", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    ({ app } = await buildApp({ databasePath: ":memory:", logger: false }));
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  // ── Builtin Tools ──────────────────────────────────

  it("GET /tools/builtin returns built-in tool list", async () => {
    const res = await app.inject({ method: "GET", url: "/tools/builtin" });

    expect(res.statusCode).toBe(200);
    const body = res.json<ItemResponse<BuiltinToolData[]>>();
    expect(body.data.length).toBeGreaterThanOrEqual(7);

    const names = body.data.map((t) => t.name);
    expect(names).toContain("roll_dice");
    expect(names).toContain("get_variable");
    expect(names).toContain("get_time");

    const dice = body.data.find((t) => t.name === "roll_dice");
    expect(dice?.source).toBe("builtin");
    expect(dice?.side_effect_level).toBe("none");
  });

  // ── Definitions CRUD ──────────────────────────────

  it("creates, reads, updates, and deletes a tool definition", async () => {
    // Create
    const createRes = await createDefinition(app, {
      name: "search_inventory",
      description: "Search inventory",
      parameters: { type: "object", properties: { query: { type: "string" } } },
      side_effect_level: "none",
      allowed_slots: ["narrator"],
      source: "preset",
      handler_type: "script",
      handler: { script: "return args.query" },
    });

    expect(createRes.statusCode).toBe(201);
    const created = createRes.json<ItemResponse<ToolDefinitionData>>().data;
    expect(created.name).toBe("search_inventory");
    expect(created.enabled).toBe(true);
    expect(created.source).toBe("preset");
    expect(created.handler_type).toBe("script");

    // Read single
    const getRes = await app.inject({ method: "GET", url: `/tools/definitions/${created.id}` });
    expect(getRes.statusCode).toBe(200);
    const fetched = getRes.json<ItemResponse<ToolDefinitionData>>().data;
    expect(fetched.id).toBe(created.id);
    expect(fetched.name).toBe("search_inventory");

    // Update
    const patchRes = await app.inject({
      method: "PATCH",
      url: `/tools/definitions/${created.id}`,
      payload: { description: "Updated desc", side_effect_level: "sandbox" },
    });
    expect(patchRes.statusCode).toBe(200);
    const updated = patchRes.json<ItemResponse<ToolDefinitionData>>().data;
    expect(updated.description).toBe("Updated desc");
    expect(updated.side_effect_level).toBe("sandbox");

    // Delete
    const delRes = await app.inject({ method: "DELETE", url: `/tools/definitions/${created.id}` });
    expect(delRes.statusCode).toBe(200);
    expect(delRes.json<ItemResponse<{ id: string; deleted: boolean }>>().data.deleted).toBe(true);

    // Confirm deleted
    const gone = await app.inject({ method: "GET", url: `/tools/definitions/${created.id}` });
    expect(gone.statusCode).toBe(404);
  });

  it("lists definitions with pagination and filtering", async () => {
    await createDefinition(app, { name: "tool_a", source: "preset" });
    await createDefinition(app, { name: "tool_b", source: "custom" });
    await createDefinition(app, { name: "tool_c", source: "preset" });

    // List all
    const allRes = await app.inject({ method: "GET", url: "/tools/definitions" });
    expect(allRes.statusCode).toBe(200);
    const all = allRes.json<ListResponse<ToolDefinitionData>>();
    expect(all.meta.total).toBe(3);

    // Filter by source
    const presetRes = await app.inject({
      method: "GET",
      url: "/tools/definitions?source=preset",
    });
    expect(presetRes.statusCode).toBe(200);
    const presets = presetRes.json<ListResponse<ToolDefinitionData>>();
    expect(presets.meta.total).toBe(2);
    for (const d of presets.data) {
      expect(d.source).toBe("preset");
    }

    // Pagination
    const page1 = await app.inject({
      method: "GET",
      url: "/tools/definitions?limit=2&offset=0",
    });
    expect(page1.json<ListResponse<ToolDefinitionData>>().data.length).toBe(2);
    expect(page1.json<ListResponse<ToolDefinitionData>>().meta.has_more).toBe(true);
  });

  it("toggles a tool definition enabled/disabled", async () => {
    const createRes = await createDefinition(app, { name: "toggle_tool" });
    const created = createRes.json<ItemResponse<ToolDefinitionData>>().data;
    expect(created.enabled).toBe(true);

    // Disable
    const toggleOff = await app.inject({
      method: "PATCH",
      url: `/tools/definitions/${created.id}/toggle`,
      payload: { enabled: false },
    });
    expect(toggleOff.statusCode).toBe(200);
    expect(toggleOff.json<ItemResponse<ToolDefinitionData>>().data.enabled).toBe(false);

    // Re-enable
    const toggleOn = await app.inject({
      method: "PATCH",
      url: `/tools/definitions/${created.id}/toggle`,
      payload: { enabled: true },
    });
    expect(toggleOn.statusCode).toBe(200);
    expect(toggleOn.json<ItemResponse<ToolDefinitionData>>().data.enabled).toBe(true);
  });

  it("returns 404 when definition not found", async () => {
    const res = await app.inject({ method: "GET", url: "/tools/definitions/nonexistent" });
    expect(res.statusCode).toBe(404);

    const delRes = await app.inject({ method: "DELETE", url: "/tools/definitions/nonexistent" });
    expect(delRes.statusCode).toBe(404);

    const toggleRes = await app.inject({
      method: "PATCH",
      url: "/tools/definitions/nonexistent/toggle",
      payload: { enabled: true },
    });
    expect(toggleRes.statusCode).toBe(404);
  });

  // ── Session Tool Permissions ──────────────────────

  it("GET /sessions/:id/tool-permissions returns empty object by default", async () => {
    const session = await createSession(app);
    const res = await app.inject({ method: "GET", url: `/sessions/${session.id}/tool-permissions` });
    expect(res.statusCode).toBe(200);
    expect(res.json<ItemResponse<Record<string, unknown>>>().data).toEqual({});
  });

  it("PUT /sessions/:id/tool-permissions replaces permissions", async () => {
    const session = await createSession(app);

    const permissions = {
      enabled: true,
      max_calls_per_turn: 10,
      allow_irreversible: false,
      slot_allow_list: { narrator: ["roll_dice", "get_variable"] },
    };

    const putRes = await app.inject({
      method: "PUT",
      url: `/sessions/${session.id}/tool-permissions`,
      payload: permissions,
    });
    expect(putRes.statusCode).toBe(200);
    const putData = putRes.json<ItemResponse<Record<string, unknown>>>().data;
    expect(putData.enabled).toBe(true);
    expect(putData.max_calls_per_turn).toBe(10);
    expect(putData.slot_allow_list).toEqual({ narrator: ["roll_dice", "get_variable"] });

    // Verify persisted
    const getRes = await app.inject({ method: "GET", url: `/sessions/${session.id}/tool-permissions` });
    expect(getRes.json<ItemResponse<Record<string, unknown>>>().data).toEqual(permissions);
  });

  it("PATCH /sessions/:id/tool-permissions merges permissions", async () => {
    const session = await createSession(app);

    // Set initial
    await app.inject({
      method: "PUT",
      url: `/sessions/${session.id}/tool-permissions`,
      payload: {
        enabled: true,
        max_calls_per_turn: 5,
        slot_allow_list: { narrator: ["roll_dice"] },
      },
    });

    // Patch: add verifier slot, change max_calls_per_turn
    const patchRes = await app.inject({
      method: "PATCH",
      url: `/sessions/${session.id}/tool-permissions`,
      payload: {
        max_calls_per_turn: 20,
        slot_allow_list: { verifier: ["get_variable"] },
      },
    });
    expect(patchRes.statusCode).toBe(200);
    const merged = patchRes.json<ItemResponse<Record<string, unknown>>>().data;
    expect(merged.enabled).toBe(true); // unchanged
    expect(merged.max_calls_per_turn).toBe(20); // updated
    // slot_allow_list should be merged: both narrator and verifier
    expect((merged.slot_allow_list as Record<string, string[]>).narrator).toEqual(["roll_dice"]);
    expect((merged.slot_allow_list as Record<string, string[]>).verifier).toEqual(["get_variable"]);
  });

  it("returns 404 for permissions of non-existent session", async () => {
    const res = await app.inject({ method: "GET", url: "/sessions/nonexistent/tool-permissions" });
    expect(res.statusCode).toBe(404);

    const putRes = await app.inject({
      method: "PUT",
      url: "/sessions/nonexistent/tool-permissions",
      payload: { enabled: true },
    });
    expect(putRes.statusCode).toBe(404);
  });

  // ── Validation Errors ─────────────────────────────

  it("returns 400 for call-records without page_id or floor_id", async () => {
    const res = await app.inject({ method: "GET", url: "/tools/call-records" });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when creating definition without name", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/tools/definitions",
      payload: { description: "No name" },
    });
    expect(res.statusCode).toBe(400);
  });
});
