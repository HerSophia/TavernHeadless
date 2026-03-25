/**
 * preset-entries.ts branch coverage expansion.
 *
 * Targets:
 *   - preset-not-found 404 on create/get-single/update/delete/reorder/batch-update/batch-delete
 *   - optional fields: injection_depth, injection_order, forbid_overrides, injection_trigger
 *   - extra merge on update
 *   - preset_validation_error is harder to trigger through the public API
 *     because parsePreset is very lenient. We cover what is reachable.
 */

import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app";

let app: FastifyInstance;

const PRESET_DATA = {
prompts: [
    {
      identifier:"main",
      name: "Main",
      role: "system",
      content: "You are helpful.",
      enabled: true,
    },
  ],
  prompt_order: [
    { character_id: 100000, order: [{ identifier: "main", enabled: true }] },
  ],
};

async function importPreset(data: Record<string, unknown>, name = "Test") {
  const res = await app.inject({
    method: "POST",
    url: "/import/preset",
    payload: { name, data },
  });
  expect(res.statusCode, res.body).toBe(201);
  return (res.json() as { data: { id: string } }).data.id;
}

beforeEach(async () => {
  ({ app } = await buildApp({ databasePath: ":memory:", logger: false }));
});

afterEach(async () => {
  await app.close();
});

describe("Preset entries extra branch coverage", () => {
  const FAKE = "nonexistent-preset-id";

  // ── preset-not-found 404 on every endpoint ───────────────

  it("POST /presets/:id/entries returns 404 for missing preset", async () => {
   const res = await app.inject({
      method: "POST",
      url: `/presets/${FAKE}/entries`,
      payload: { identifier: "x", content: "y" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /presets/:id/entries/:identifier returns 404 for missing preset", async () => {
    const res = await app.inject({ method: "GET", url: `/presets/${FAKE}/entries/main` });
    expect(res.statusCode).toBe(404);
  });

  it("PATCH /presets/:id/entries/:identifier returns 404 for missing preset", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/presets/${FAKE}/entries/main`,
 payload: { content:"x" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("DELETE /presets/:id/entries/:identifier returns 404 for missing preset", async () => {
    const res = await app.inject({ method: "DELETE", url: `/presets/${FAKE}/entries/main` });
    expect(res.statusCode).toBe(404);
  });

  it("PUT /presets/:id/entries/reorder returns 404 for missing preset", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/presets/${FAKE}/entries/reorder`,
      payload: { identifiers: ["main"] },
    });
    expect(res.statusCode).toBe(404);
  });

it("PATCH /presets/:id/entries/batch/update returns 404 for missing preset", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/presets/${FAKE}/entries/batch/update`,
      payload: { identifiers: ["main"],fields: { content: "x" } },
    });
    expect(res.statusCode).toBe(404);
  });

  it("POST /presets/:id/entries/batch/delete returns 404 for missing preset", async () => {
    const res = await app.inject({
  method: "POST",
      url: `/presets/${FAKE}/entries/batch/delete`,
      payload: { identifiers: ["main"] },
    });
    expect(res.statusCode).toBe(404);
  });

  // ── Optional fields on create ───────────────────────

  it("creates entry with injection_depth, injection_order, forbid_overrides, injection_trigger", async () => {
    const presetId = await importPreset(PRESET_DATA);
    const res= await app.inject({
      method: "POST",
      url:`/presets/${presetId}/entries`,
      payload: {
    identifier: "deep_inject",
        content: "Deep injected",
        injection_depth: 3,
        injection_order: 5,
        forbid_overrides: true,
        injection_trigger: ["keyword_a", "keyword_b"],
      },
    });
    expect(res.statusCode).toBe(201);
    const entry = (res.json() as { data: Record<string, unknown> }).data;
    expect(entry.injection_depth).toBe(3);
    expect(entry.injection_order).toBe(5);
    expect(entry.forbid_overrides).toBe(true);
    expect(entry.injection_trigger).toEqual(["keyword_a", "keyword_b"]);
  });

  // ── Update with all optional fields + extra merge ─────────

  it("updates entry with all optional fields and extra merge", async () => {
    const presetId = await importPreset(PRESET_DATA);

    // create a base entry with extra
    await app.inject({
      method: "POST",
      url: `/presets/${presetId}/entries`,
      payload: {
        identifier: "patchable",
        content: "original",
        extra: { old_field: "old" },
      },
    });

    const patchRes = await app.inject({
      method: "PATCH",
      url: `/presets/${presetId}/entries/patchable`,
      payload: {
        name: "Patched",
        role: "user",
        content: "updated",
        system_prompt: true,
        marker: true,
        injection_position: 2,
        injection_depth: 4,
        injection_order: 7,
        forbid_overrides: false,
        injection_trigger: ["t1"],
        enabled: false,
        extra: { new_field: "new" },
      },
    });
    expect(patchRes.statusCode).toBe(200);
    const patched = (patchRes.json() as {data: Record<string, unknown> }).data;
 expect(patched.name).toBe("Patched");
    expect(patched.role).toBe("user");
    expect(patched.content).toBe("updated");
    expect(patched.injection_depth).toBe(4);
    expect(patched.injection_order).toBe(7);
    expect(patched.forbid_overrides).toBe(false);
    expect(patched.injection_trigger).toEqual(["t1"]);
    expect(patched.enabled).toBe(false);
    // extra merge: new_field should be present
    expect((patched.extra as Record<string, unknown>)?.new_field).toBe("new");
  });

  // ── Batch update with multiplefield types ─────────────

  it("batch update with injection_depth and extra", async () => {
    const presetId = await importPreset(PRESET_DATA);
    await app.inject({
      method: "POST",
      url: `/presets/${presetId}/entries`,
      payload: { identifier: "batch_a", content: "a" },
    });
    await app.inject({
      method: "POST",
      url: `/presets/${presetId}/entries`,
      payload: { identifier: "batch_b", content: "b" },
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/presets/${presetId}/entries/batch/update`,
      payload: {
        identifiers: ["batch_a", "batch_b"],
        fields: {
          injection_depth: 2,
          extra: { bulk: true },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = (res.json() as { data: { meta: { updated: number } } });
expect(body.data.meta.updated).toBe(2);
  });
});
