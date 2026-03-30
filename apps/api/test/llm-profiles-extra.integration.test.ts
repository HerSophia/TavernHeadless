/**
 * llm-profiles.ts extra branch coverage.
 *
 * Targets:
 *   - sendServiceError: profile_inactive, secret_unavailable
 *   - activate inactive profile -> 409
 *   - delete missing profile -> 404
 *   - patch deleted profile -> 409
 *   - rename conflict on patch
 */

import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app";

describe("LLM Profiles extra branch coverage", () => {
  let app: FastifyInstance;
  let originalMasterKey: string | undefined;

  beforeEach(async () => {
    originalMasterKey = process.env.APP_SECRETS_MASTER_KEY;
    process.env.APP_SECRETS_MASTER_KEY = "test-master-key";
    ({ app } = await buildApp({ databasePath: ":memory:", logger: false }));
  });

  afterEach(async () => {
    if (originalMasterKey === undefined) {
      delete process.env.APP_SECRETS_MASTER_KEY;
    } else {
      process.env.APP_SECRETS_MASTER_KEY = originalMasterKey;
    }
    vi.unstubAllGlobals();
    if (app) await app.close();
  });

  async function createProfile(name: string) {
    const res = await app.inject({
      method: "POST",
      url: "/llm-profiles",
      payload: {
        preset_name: name,
        provider: "openai",
        model_id: "gpt-4o-mini",
        api_key: `sk-${name}`,
      },
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { data: { id: string } }).data.id;
  }

  it("returns 404 when deleting missing profile", async () => {
    const res = await app.inject({method: "DELETE", url: "/llm-profiles/missing" });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe("profile_not_found");
  });

  it("returns 409 when activating inactiveprofile", async () => {
    const id = await createProfile("InactiveProfile");
    //Disable the profile first
    await app.inject({
      method: "PATCH",
      url: `/llm-profiles/${id}`,
      payload: { status: "disabled" },
   });

    const res = await app.inject({
      method: "POST",
      url: `/llm-profiles/${id}/activate`,
      payload: { scope: "global" },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as{ error: { code: string } }).error.code).toBe("profile_inactive");
  });

  it("returns 409 when patching a deleted profile", async () =>{
    const id = await createProfile("WillDelete");
    await app.inject({ method: "DELETE", url: `/llm-profiles/${id}` });

    const res = await app.inject({
      method: "PATCH",
      url: `/llm-profiles/${id}`,
      payload: { preset_name: "Revived" },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe("profile_inactive");
  });

  it("returns 409 when rename conflicts with another profile", async () => {
    await createProfile("ProfileA");
    const idB = await createProfile("ProfileB");

    const res = await app.inject({
      method: "PATCH",
      url: `/llm-profiles/${idB}`,
      payload: { preset_name: "ProfileA" },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe("profile_conflict");
  });

  it("creates profile without master key -> 503 secret_unavailable", async () => {
    await app.close();
    delete process.env.APP_SECRETS_MASTER_KEY;
    ({ app } = await buildApp({ databasePath: ":memory:", logger: false }));

    const res = await app.inject({
      method: "POST",
      url: "/llm-profiles",
      payload: {
        preset_name: "NoKey",
        provider: "openai",
        model_id: "gpt-4o-mini",
        api_key: "sk-test",
      },
    });
    expect(res.statusCode).toBe(503);
    expect((res.json() as { error: { code: string } }).error.code).toBe("secret_unavailable");
  });

  it("returns 404 when unbinding a missing binding", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/llm-profiles/bindings/narrator?scope=global",
    });

    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe("binding_not_found");
  });

  it("returns 404 when unbinding a session scope for a missing session", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/llm-profiles/bindings/narrator?scope=session&session_id=missing-session",
    });

    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe("session_scope_not_found");
  });
});
