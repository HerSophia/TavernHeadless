import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app";

describe("LLM Profile Routes", () => {
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

    if (app) {
      await app.close();
    }
  });

  it("creates and lists profiles without exposing plain api key", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/llm-profiles",
      payload: {
        preset_name: "Main OpenAI",
        provider: "openai",
        model_id: "gpt-4o-mini",
        base_url: "https://api.openai.com/v1",
        api_key_name: "main-prod",
        api_key: "sk-test-1234567890",
      },
    });

    expect(createRes.statusCode).toBe(201);
    const created = createRes.json() as { data: { id: string; api_key_masked: string; api_key?: string } };
    expect(created.data.id).toBeTruthy();
    expect(created.data.api_key_masked).toContain("****");
    expect(created.data.api_key).toBeUndefined();

    const listRes = await app.inject({ method: "GET", url: "/llm-profiles" });
    expect(listRes.statusCode).toBe(200);

    const listBody = listRes.json() as { data: Array<{ id: string; preset_name: string; api_key_masked: string }> };
    expect(listBody.data).toHaveLength(1);
    expect(listBody.data[0]?.id).toBe(created.data.id);
    expect(listBody.data[0]?.preset_name).toBe("Main OpenAI");
    expect(listBody.data[0]?.api_key_masked).toContain("****");
  });

  it("returns 409 when profile name is duplicated", async () => {
    await app.inject({
      method: "POST",
      url: "/llm-profiles",
      payload: {
        preset_name: "Duplicate Name",
        provider: "openai",
        model_id: "gpt-4o-mini",
        api_key: "sk-test-aaa",
      },
    });

    const duplicateRes = await app.inject({
      method: "POST",
      url: "/llm-profiles",
      payload: {
        preset_name: "Duplicate Name",
        provider: "openai",
        model_id: "gpt-4o",
        api_key: "sk-test-bbb",
      },
    });

    expect(duplicateRes.statusCode).toBe(409);
    const body = duplicateRes.json() as { error: { code: string } };
    expect(body.error.code).toBe("profile_conflict");
  });

  it("prevents deleting an active-bound profile", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/llm-profiles",
      payload: {
        preset_name: "Bound Profile",
        provider: "openai",
        model_id: "gpt-4o-mini",
        api_key: "sk-test-bound",
      },
    });

    const created = createRes.json() as { data: { id: string } };

    const activateRes = await app.inject({
      method: "POST",
      url: `/llm-profiles/${created.data.id}/activate`,
      payload: {
        scope: "global",
      },
    });
    expect(activateRes.statusCode).toBe(200);

    const deleteRes = await app.inject({
      method: "DELETE",
      url: `/llm-profiles/${created.data.id}`,
    });
    expect(deleteRes.statusCode).toBe(409);

    const body = deleteRes.json() as { error: { code: string } };
    expect(body.error.code).toBe("profile_in_use");
  });

  it("activates profile with params and exposes effective params in runtime", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/llm-profiles",
      payload: {
        preset_name: "Runtime Param Profile",
        provider: "openai",
        model_id: "gpt-4o-mini",
        api_key: "sk-test-runtime-params",
      },
    });
    expect(createRes.statusCode).toBe(201);

    const profileId = (createRes.json() as { data: { id: string } }).data.id;

    const activateRes = await app.inject({
      method: "POST",
      url: `/llm-profiles/${profileId}/activate`,
      payload: {
        scope: "global",
        instance_slot: "narrator",
        params: {
          max_context_tokens: 12000,
          max_output_tokens: 900,
          temperature: 0.65,
          top_p: 0.9,
          stream: true,
          timeout_ms: 90000,
        },
      },
    });
    expect(activateRes.statusCode).toBe(200);
    expect((activateRes.json() as { data: { params: Record<string, unknown> | null } }).data.params).toEqual(
      expect.objectContaining({
        max_context_tokens: 12000,
        max_output_tokens: 900,
        temperature: 0.65,
        top_p: 0.9,
        stream: true,
        timeout_ms: 90000,
      }),
    );

    const runtimeRes = await app.inject({
      method: "GET",
      url: "/llm-profiles/runtime",
    });
    expect(runtimeRes.statusCode).toBe(200);

    const runtimeBody = runtimeRes.json() as {
      data: {
        slots: Array<{ slot: string; source: string; profile_id: string | null; params: Record<string, unknown> | null }>;
      };
    };

    const narrator = runtimeBody.data.slots.find((slot) => slot.slot === "narrator");
    expect(narrator).toBeDefined();
    expect(narrator?.source).toBe("global_profile");
    expect(narrator?.profile_id).toBe(profileId);
    expect(narrator?.params).toEqual(
      expect.objectContaining({
        max_context_tokens: 12000,
        max_output_tokens: 900,
        temperature: 0.65,
        top_p: 0.9,
        stream: true,
        timeout_ms: 90000,
      }),
    );
  });

  it("rejects invalid activate params", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/llm-profiles",
      payload: {
        preset_name: "Invalid Param Profile",
        provider: "openai",
        model_id: "gpt-4o-mini",
        api_key: "sk-test-invalid-params",
      },
    });
    expect(createRes.statusCode).toBe(201);

    const profileId = (createRes.json() as { data: { id: string } }).data.id;
    const activateRes = await app.inject({
      method: "POST",
      url: `/llm-profiles/${profileId}/activate`,
      payload: {
        scope: "global",
        params: {
          temperature: 9,
        },
      },
    });

    expect(activateRes.statusCode).toBe(400);
    expect((activateRes.json() as { error: { code: string } }).error.code).toBe("validation_error");
  });

  it("isolates profiles by account in multi-account mode", async () => {
    await app.close();
    ({ app } = await buildApp({
      databasePath: ":memory:",
      logger: false,
      accountMode: "multi",
      auth: { mode: "jwt", jwtSecret: "test-secret" },
    }));

    const tokenA = app.jwt.sign({ sub: "user-a", role: "admin", account_id: "acc-a" });
    const tokenB = app.jwt.sign({ sub: "user-b", role: "admin", account_id: "acc-b" });

    const accountARes = await app.inject({
      method: "POST",
      url: "/accounts",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        id: "acc-a",
        name: "Account A",
      },
    });
    expect(accountARes.statusCode).toBe(201);

    const accountBRes = await app.inject({
      method: "POST",
      url: "/accounts",
      headers: { authorization: `Bearer ${tokenB}` },
      payload: {
        id: "acc-b",
        name: "Account B",
      },
    });
    expect(accountBRes.statusCode).toBe(201);

    const createRes = await app.inject({
      method: "POST",
      url: "/llm-profiles",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        preset_name: "Scoped Profile",
        provider: "openai",
        model_id: "gpt-4o-mini",
        api_key: "sk-test-scope",
      },
    });
    expect(createRes.statusCode).toBe(201);

    const listA = await app.inject({ method: "GET", url: "/llm-profiles", headers: { authorization: `Bearer ${tokenA}` } });
    const listB = await app.inject({ method: "GET", url: "/llm-profiles", headers: { authorization: `Bearer ${tokenB}` } });

    expect((listA.json() as { data: unknown[] }).data).toHaveLength(1);
    expect((listB.json() as { data: unknown[] }).data).toHaveLength(0);
  });

  it("discovers models through provider API", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { id: "gpt-4o-mini" },
            { id: "gpt-4o" },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    vi.stubGlobal("fetch", fetchMock);

    const res = await app.inject({
      method: "POST",
      url: "/llm-profiles/models/discover",
      payload: {
        provider: "openai",
        api_key: "sk-test-discovery",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ id: string; label: string }> };
    expect(body.data.map((item) => item.id)).toEqual(["gpt-4o", "gpt-4o-mini"]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/models",
      expect.objectContaining({ method: "GET" }),
    );

    vi.unstubAllGlobals();
  });

  it("returns upstream discovery error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await app.inject({
      method: "POST",
      url: "/llm-profiles/models/discover",
      payload: {
        provider: "openai",
        api_key: "sk-test-discovery",
      },
    });

    expect(res.statusCode).toBe(502);
    expect(res.json() as { error: { code: string } }).toEqual(
      expect.objectContaining({ error: expect.objectContaining({ code: "model_discovery_failed" }) }),
    );

    vi.unstubAllGlobals();
  });

  it("tests model with hello probe", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "Hi there!",
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    vi.stubGlobal("fetch", fetchMock);

    const res = await app.inject({
      method: "POST",
      url: "/llm-profiles/models/test",
      payload: {
        provider: "openai",
        model_id: "gpt-4o-mini",
        api_key: "sk-test-probe",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json() as { data: { request_text: string; response_text: string } }).toEqual({
      data: {
        request_text: "Hello",
        response_text: "Hi there!",
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );

    vi.unstubAllGlobals();
  });

  it("returns upstream model test error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("bad gateway", { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await app.inject({
      method: "POST",
      url: "/llm-profiles/models/test",
      payload: {
        provider: "openai",
        model_id: "gpt-4o-mini",
        api_key: "sk-test-probe",
      },
    });

    expect(res.statusCode).toBe(502);
    expect(res.json() as { error: { code: string } }).toEqual(
      expect.objectContaining({ error: expect.objectContaining({ code: "model_test_failed" }) }),
    );

    vi.unstubAllGlobals();
  });
});
