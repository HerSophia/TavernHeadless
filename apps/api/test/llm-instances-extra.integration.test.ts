/**
 * llm-instances.ts extra branch coverage.
 *
 * Targets:
 *   - sendServiceError branches: invalid_params, missing_session_id (already covered)
 *   - delete with session scope
 *   - PUT with preset_id
 *   - toApiParams returning null for empty params
 */

import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app";

type ConfigResponse = { data: { id: string; scope: string; scope_id: string; instance_slot: string; preset_id: string | null; enabled: boolean; params: Record<string, unknown> | null } };
type DeleteResponse = { data: { instance_slot: string; scope: string; deleted: boolean } };

describe("LLM Instances extra branch coverage", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    ({ app} = await buildApp({ databasePath: ":memory:", logger: false }));
  });

  afterEach(async () => {
   if (app) await app.close();
  });

  it("upserts with preset_id", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/llm-instances/narrator",
      payload: { scope: "global", enabled: true, preset_id: "preset-abc" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<ConfigResponse>().data.preset_id).toBe("preset-abc");
  });

  it("deletes session-scoped config with session_id", async () => {
    await app.inject({
     method: "PUT",
      url: "/llm-instances/director",
      payload: { scope: "session", session_id: "s1", enabled: true },
    });

    const res = await app.inject({
      method: "DELETE",
      url: "/llm-instances/director?scope=session&session_id=s1",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<DeleteResponse>().data.scope).toBe("session");
  });

  it("upserts with empty params results in null params", async () => {
    const res = await app.inject({
 method: "PUT",
      url: "/llm-instances/narrator",
      payload: { scope: "global", enabled: true, params: {} },
    });
    expect(res.statusCode).toBe(200);
    // empty object should compact to null
    expect(res.json<ConfigResponse>().data.params).toBeNull();
  });

  it("upserts wildcard * slot", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/llm-instances/*",
      payload: { scope: "global", enabled: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<ConfigResponse>().data.instance_slot).toBe("*");
  });
});
