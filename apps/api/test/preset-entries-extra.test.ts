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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app";
import * as retryModule from "../src/lib/retry";

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

async function importPreset(
  data: Record<string, unknown>,
  name = "Test",
  targetApp: FastifyInstance = app,
  headers?: Record<string, string>,
) {
  const res = await targetApp.inject({
    method: "POST",
    url: "/import/preset",
    ...(headers ? { headers } : {}),
    payload: { name, data },
  });
  expect(res.statusCode, res.body).toBe(201);
  return (res.json() as { data: { id: string } }).data.id;
}

async function getPresetEditor(presetId: string, targetApp: FastifyInstance = app, headers?: Record<string, string>) {
  const res = await targetApp.inject({
    method: "GET",
    url: `/presets/${presetId}/editor`,
    ...(headers ? { headers } : {}),
  });
  expect(res.statusCode).toBe(200);
  return res.json() as {
    data: {
      name: string;
      version: number;
      editor: {
        entries: Array<Record<string, unknown>>;
        order_contexts: Array<Record<string, unknown>>;
        top_level: Record<string, unknown>;
        default_character_id: number;
      };
    };
  };
}

async function bumpPresetVersion(presetId: string, targetApp: FastifyInstance = app, headers?: Record<string, string>) {
  const editor = await getPresetEditor(presetId, targetApp, headers);
  const res = await targetApp.inject({
    method: "PUT",
    url: `/presets/${presetId}`,
    ...(headers ? { headers } : {}),
    payload: { name: `${editor.data.name} bumped`, expected_version: editor.data.version, editor: editor.data.editor },
  });
  expect(res.statusCode, res.body).toBe(200);
  return editor.data.version;
}

beforeEach(async () => {
  ({ app } = await buildApp({ databasePath: ":memory:", logger: false }));
});

afterEach(async () => {
  await app.close();
  vi.restoreAllMocks();
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

  describe("expected_version conflicts", () => {
    const staleCases = [
      (presetId: string, staleVersion: number) => ({ method: "POST" as const, url: `/presets/${presetId}/entries`, payload: { expected_version: staleVersion, identifier: "stale_create", content: "new" } }),
      (presetId: string, staleVersion: number) => ({ method: "PATCH" as const, url: `/presets/${presetId}/entries/main`, payload: { expected_version: staleVersion, content: "stale patch" } }),
      (presetId: string, staleVersion: number) => ({ method: "DELETE" as const, url: `/presets/${presetId}/entries/main?expected_version=${staleVersion}` }),
      (presetId: string, staleVersion: number) => ({ method: "PUT" as const, url: `/presets/${presetId}/entries/reorder`, payload: { expected_version: staleVersion, identifiers: ["main"] } }),
      (presetId: string, staleVersion: number) => ({ method: "PATCH" as const, url: `/presets/${presetId}/entries/batch/update`, payload: { expected_version: staleVersion, identifiers: ["main"], fields: { content: "bulk stale" } } }),
      (presetId: string, staleVersion: number) => ({ method: "POST" as const, url: `/presets/${presetId}/entries/batch/delete`, payload: { expected_version: staleVersion, identifiers: ["main"] } }),
    ];

    it.each(staleCases)("returns 409 preset_conflict for stale entry write baseline", async (buildRequest) => {
      const presetId = await importPreset(PRESET_DATA);
      const staleVersion = await bumpPresetVersion(presetId);

      const res = await app.inject(buildRequest(presetId, staleVersion));
      expect(res.statusCode).toBe(409);
      expect((res.json() as { error: { code: string } }).error.code).toBe("preset_conflict");
    });
  });

  it("maps resource_busy on preset entry writes", async () => {
    const presetId = await importPreset(PRESET_DATA);
    vi.spyOn(retryModule, "executeWithSqliteBusyRetry").mockRejectedValueOnce(new retryModule.ResourceBusyError("database is locked"));

    const res = await app.inject({
      method: "PATCH",
      url: `/presets/${presetId}/entries/main`,
      payload: { content: "busy update" },
    });

    expect(res.statusCode).toBe(503);
    expect((res.json() as { error: { code: string } }).error.code).toBe("resource_busy");
  });

  describe("account isolation", () => {
    let multiApp: FastifyInstance;
    let tokenA: string;
    let tokenB: string;

    beforeEach(async () => {
      ({ app: multiApp } = await buildApp({
        databasePath: ":memory:",
        logger: false,
        auth: { mode: "jwt", jwtSecret: "test-secret" },
        accountMode: "multi",
      }));

      const rootToken = multiApp.jwt.sign({ sub: "root", account_id: "default-admin", role: "user" });
      tokenA = multiApp.jwt.sign({ sub: "u-a", account_id: "acc-a", role: "admin" });
      tokenB = multiApp.jwt.sign({ sub: "u-b", account_id: "acc-b", role: "admin" });

      await multiApp.inject({ method: "POST", url: "/accounts", headers: { authorization: `Bearer ${rootToken}` }, payload: { id: "acc-a", name: "Account A" } });
      await multiApp.inject({ method: "POST", url: "/accounts", headers: { authorization: `Bearer ${rootToken}` }, payload: { id: "acc-b", name: "Account B" } });
    });

    afterEach(async () => {
      if (multiApp) await multiApp.close();
    });

    it("account B cannot read or mutate account A preset entries", async () => {
      const headersA = { authorization: `Bearer ${tokenA}` };
      const headersB = { authorization: `Bearer ${tokenB}` };
      const presetId = await importPreset(PRESET_DATA, "Isolated Preset", multiApp, headersA);

      const ownerRes = await multiApp.inject({ method: "GET", url: `/presets/${presetId}/entries`, headers: headersA });
      expect(ownerRes.statusCode).toBe(200);

      const listB = await multiApp.inject({ method: "GET", url: `/presets/${presetId}/entries`, headers: headersB });
      expect(listB.statusCode).toBe(404);

      const patchB = await multiApp.inject({ method: "PATCH", url: `/presets/${presetId}/entries/main`, headers: headersB, payload: { content: "forbidden" } });
      expect(patchB.statusCode).toBe(404);
    });
  });
});
