import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app";

describe("LLM Profile Routes", () => {
  let app: FastifyInstance;
  let originalAllowPrivateBaseUrl: string | undefined;
  let originalMasterKey: string | undefined;

  beforeEach(async () => {
    originalAllowPrivateBaseUrl = process.env.ALLOW_PRIVATE_BASE_URL;
    originalMasterKey = process.env.APP_SECRETS_MASTER_KEY;
    delete process.env.ALLOW_PRIVATE_BASE_URL;
    process.env.APP_SECRETS_MASTER_KEY = "test-master-key";
    ({ app } = await buildApp({ databasePath: ":memory:", logger: false }));
  });

  afterEach(async () => {
    if (originalAllowPrivateBaseUrl === undefined) {
      delete process.env.ALLOW_PRIVATE_BASE_URL;
    } else {
      process.env.ALLOW_PRIVATE_BASE_URL = originalAllowPrivateBaseUrl;
    }

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

  it("gets and updates a profile and covers get/patch error branches", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/llm-profiles",
      payload: {
        preset_name: "Patchable Profile",
        provider: "openai",
        model_id: "gpt-4o-mini",
        base_url: "https://api.openai.com/v1",
        api_key_name: "patchable-key",
        api_key: "sk-test-patchable",
      },
    });
    expect(createRes.statusCode).toBe(201);
    const profileId = (createRes.json() as { data: { id: string } }).data.id;

    const getRes = await app.inject({
      method: "GET",
      url: `/llm-profiles/${profileId}`,
    });
    expect(getRes.statusCode).toBe(200);
    expect((getRes.json() as { data: { id: string; preset_name: string } }).data).toMatchObject({
      id: profileId,
      preset_name: "Patchable Profile",
    });

    const patchRes = await app.inject({
      method: "PATCH",
      url: `/llm-profiles/${profileId}`,
      payload: {
        preset_name: "Patched Profile",
        model_id: "gpt-4o",
        base_url: null,
        api_key_name: null,
      },
    });
    expect(patchRes.statusCode).toBe(200);
    expect((patchRes.json() as { data: { preset_name: string; model_id: string; base_url: string | null; api_key_name: string | null } }).data).toMatchObject({
      preset_name: "Patched Profile",
      model_id: "gpt-4o",
      base_url: null,
      api_key_name: null,
    });

    const emptyPatchRes = await app.inject({
      method: "PATCH",
      url: `/llm-profiles/${profileId}`,
      payload: {},
    });
    expect(emptyPatchRes.statusCode).toBe(400);
    expect((emptyPatchRes.json() as { error: { code: string } }).error.code).toBe("validation_error");

    const missingGetRes = await app.inject({ method: "GET", url: "/llm-profiles/missing-profile" });
    expect(missingGetRes.statusCode).toBe(404);
    expect((missingGetRes.json() as { error: { code: string } }).error.code).toBe("profile_not_found");

    const missingPatchRes = await app.inject({
      method: "PATCH",
      url: "/llm-profiles/missing-profile",
      payload: { preset_name: "Missing" },
    });
    expect(missingPatchRes.statusCode).toBe(404);
    expect((missingPatchRes.json() as { error: { code: string } }).error.code).toBe("profile_not_found");
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

  it("unbinds an existing binding by scope and slot", async () => {
    const sessionRes = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { title: "Profile Unbind Session" },
    });
    expect(sessionRes.statusCode).toBe(201);
    const sessionId = (sessionRes.json() as { data: { id: string } }).data.id;

    const createRes = await app.inject({
      method: "POST",
      url: "/llm-profiles",
      payload: {
        preset_name: "Unbindable Profile",
        provider: "openai",
        model_id: "gpt-4o-mini",
        api_key: "sk-test-unbind",
      },
    });
    expect(createRes.statusCode).toBe(201);
    const profileId = (createRes.json() as { data: { id: string } }).data.id;

    const activateRes = await app.inject({
      method: "POST",
      url: `/llm-profiles/${profileId}/activate`,
      payload: {
        scope: "session",
        session_id: sessionId,
        instance_slot: "director",
      },
    });
    expect(activateRes.statusCode).toBe(200);

    const unbindRes = await app.inject({
      method: "DELETE",
      url: `/llm-profiles/bindings/director?scope=session&session_id=${sessionId}`,
    });
    expect(unbindRes.statusCode).toBe(200);
    expect((unbindRes.json() as {
      data: { scope: string; scope_id: string; instance_slot: string; unbound: boolean };
    }).data).toEqual({
      scope: "session",
      scope_id: sessionId,
      instance_slot: "director",
      unbound: true,
    });

    const deleteRes = await app.inject({
      method: "DELETE",
      url: `/llm-profiles/${profileId}`,
    });
    expect(deleteRes.statusCode).toBe(200);
  });

  it("cleans session-scoped bindings during session deletion so profile deletion is no longer blocked", async () => {
    const sessionRes = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { title: "Profile Binding Cleanup Session" },
    });
    expect(sessionRes.statusCode).toBe(201);
    const sessionId = (sessionRes.json() as { data: { id: string } }).data.id;

    const createRes = await app.inject({
      method: "POST",
      url: "/llm-profiles",
      payload: {
        preset_name: "Cleanup Profile",
        provider: "openai",
        model_id: "gpt-4o-mini",
        api_key: "sk-test-cleanup",
      },
    });
    expect(createRes.statusCode).toBe(201);
    const profileId = (createRes.json() as { data: { id: string } }).data.id;

    const activateRes = await app.inject({
      method: "POST",
      url: `/llm-profiles/${profileId}/activate`,
      payload: {
        scope: "session",
        session_id: sessionId,
        instance_slot: "narrator",
      },
    });
    expect(activateRes.statusCode).toBe(200);

    const deleteSessionRes = await app.inject({
      method: "DELETE",
      url: `/sessions/${sessionId}`,
    });
    expect(deleteSessionRes.statusCode).toBe(200);

    const deleteProfileRes = await app.inject({
      method: "DELETE",
      url: `/llm-profiles/${profileId}`,
    });
    expect(deleteProfileRes.statusCode).toBe(200);
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
          reasoning_effort: "low",
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
        reasoning_effort: "low",
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
        reasoning_effort: "low",
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

  it("deletes a profile and supports status filters with include_deleted", async () => {
    const deletableRes = await app.inject({
      method: "POST",
      url: "/llm-profiles",
      payload: {
        preset_name: "Deleted Profile",
        provider: "openai",
        model_id: "gpt-4o-mini",
        api_key: "sk-test-deleted",
      },
    });
    expect(deletableRes.statusCode).toBe(201);
    const deletedProfileId = (deletableRes.json() as { data: { id: string } }).data.id;

    const deleteRes = await app.inject({
      method: "DELETE",
      url: `/llm-profiles/${deletedProfileId}`,
    });
    expect(deleteRes.statusCode).toBe(200);
    expect((deleteRes.json() as { data: { id: string; deleted: boolean } }).data).toEqual({
      id: deletedProfileId,
      deleted: true,
    });

    const disabledRes = await app.inject({
      method: "POST",
      url: "/llm-profiles",
      payload: {
        preset_name: "Disabled Profile",
        provider: "openai",
        model_id: "gpt-4o-mini",
        api_key: "sk-test-disabled",
      },
    });
    expect(disabledRes.statusCode).toBe(201);
    const disabledProfileId = (disabledRes.json() as { data: { id: string } }).data.id;

    const disablePatchRes = await app.inject({
      method: "PATCH",
      url: `/llm-profiles/${disabledProfileId}`,
      payload: { status: "disabled" },
    });
    expect(disablePatchRes.statusCode).toBe(200);

    const defaultListRes = await app.inject({ method: "GET", url: "/llm-profiles" });
    expect(defaultListRes.statusCode).toBe(200);
    const defaultList = (defaultListRes.json() as { data: Array<{ id: string }> }).data;
    expect(defaultList.some((profile) => profile.id === deletedProfileId)).toBe(false);
    expect(defaultList.some((profile) => profile.id === disabledProfileId)).toBe(true);

    const disabledListRes = await app.inject({ method: "GET", url: "/llm-profiles?status=disabled" });
    expect(disabledListRes.statusCode).toBe(200);
    const disabledList = (disabledListRes.json() as { data: Array<{ id: string; status: string }> }).data;
    expect(disabledList).toHaveLength(1);
    expect(disabledList[0]).toMatchObject({ id: disabledProfileId, status: "disabled" });

    const includeDeletedRes = await app.inject({ method: "GET", url: "/llm-profiles?include_deleted=true" });
    expect(includeDeletedRes.statusCode).toBe(200);
    const includeDeleted = (includeDeletedRes.json() as { data: Array<{ id: string }> }).data;
    expect(includeDeleted.some((profile) => profile.id === deletedProfileId)).toBe(true);
    expect(includeDeleted.some((profile) => profile.id === disabledProfileId)).toBe(true);

    const deletedListRes = await app.inject({
      method: "GET",
      url: "/llm-profiles?include_deleted=true&status=deleted",
    });
    expect(deletedListRes.statusCode).toBe(200);
    const deletedList = (deletedListRes.json() as { data: Array<{ id: string; status: string }> }).data;
    expect(deletedList).toHaveLength(1);
    expect(deletedList[0]).toMatchObject({ id: deletedProfileId, status: "deleted" });
  });

  it("requires session_id for session activation and returns 404 for missing profile", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/llm-profiles",
      payload: {
        preset_name: "Session Activation Profile",
        provider: "openai",
        model_id: "gpt-4o-mini",
        api_key: "sk-test-session-activate",
      },
    });
    expect(createRes.statusCode).toBe(201);
    const profileId = (createRes.json() as { data: { id: string } }).data.id;

    const missingSessionIdRes = await app.inject({
      method: "POST",
      url: `/llm-profiles/${profileId}/activate`,
      payload: { scope: "session", instance_slot: "narrator" },
    });
    expect(missingSessionIdRes.statusCode).toBe(400);
    expect((missingSessionIdRes.json() as { error: { code: string } }).error.code).toBe("validation_error");

    const missingSessionRes = await app.inject({
      method: "POST",
      url: `/llm-profiles/${profileId}/activate`,
      payload: { scope: "session", session_id: "missing-session", instance_slot: "narrator" },
    });
    expect(missingSessionRes.statusCode).toBe(404);
    expect((missingSessionRes.json() as { error: { code: string } }).error.code).toBe("session_scope_not_found");

    const missingProfileRes = await app.inject({
      method: "POST",
      url: "/llm-profiles/missing-profile/activate",
      payload: { scope: "global" },
    });
    expect(missingProfileRes.statusCode).toBe(404);
    expect((missingProfileRes.json() as { error: { code: string } }).error.code).toBe("profile_not_found");
  });

  it("prefers session profile over global profile in runtime resolution", async () => {
    const globalProfileRes = await app.inject({
      method: "POST",
      url: "/llm-profiles",
      payload: {
        preset_name: "Global Runtime Profile",
        provider: "openai",
        model_id: "gpt-4o-mini",
        api_key: "sk-test-runtime-global",
      },
    });
    expect(globalProfileRes.statusCode).toBe(201);
    const globalProfileId = (globalProfileRes.json() as { data: { id: string } }).data.id;

    const sessionRes = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { title: "Runtime Override Session" },
    });
    expect(sessionRes.statusCode).toBe(201);
    const sessionId = (sessionRes.json() as { data: { id: string } }).data.id;

    const sessionProfileRes = await app.inject({
      method: "POST",
      url: "/llm-profiles",
      payload: {
        preset_name: "Session Runtime Profile",
        provider: "openai",
        model_id: "gpt-4o",
        api_key: "sk-test-runtime-session",
      },
    });
    expect(sessionProfileRes.statusCode).toBe(201);
    const sessionProfileId = (sessionProfileRes.json() as { data: { id: string } }).data.id;

    const globalActivateRes = await app.inject({
      method: "POST",
      url: `/llm-profiles/${globalProfileId}/activate`,
      payload: { scope: "global", instance_slot: "narrator" },
    });
    expect(globalActivateRes.statusCode).toBe(200);

    const sessionActivateRes = await app.inject({
      method: "POST",
      url: `/llm-profiles/${sessionProfileId}/activate`,
      payload: { scope: "session", session_id: sessionId, instance_slot: "narrator" },
    });
    expect(sessionActivateRes.statusCode).toBe(200);

    const runtimeSessionRes = await app.inject({
      method: "GET",
      url: `/llm-profiles/runtime?session_id=${sessionId}`,
    });
    expect(runtimeSessionRes.statusCode).toBe(200);
    const sessionNarrator = (runtimeSessionRes.json() as {
      data: { slots: Array<{ slot: string; source: string; profile_id: string | null; model_id: string }> };
    }).data.slots.find((slot) => slot.slot === "narrator");
    expect(sessionNarrator).toMatchObject({
      source: "session_profile",
      profile_id: sessionProfileId,
      model_id: "gpt-4o",
    });

    const runtimeFallbackRes = await app.inject({
      method: "GET",
      url: "/llm-profiles/runtime?session_id=sess-other",
    });
    expect(runtimeFallbackRes.statusCode).toBe(200);
    const fallbackNarrator = (runtimeFallbackRes.json() as {
      data: { slots: Array<{ slot: string; source: string; profile_id: string | null; model_id: string }> };
    }).data.slots.find((slot) => slot.slot === "narrator");
    expect(fallbackNarrator).toMatchObject({
      source: "global_profile",
      profile_id: globalProfileId,
      model_id: "gpt-4o-mini",
    });
  });

  it("isolates profiles by account in multi-account mode", async () => {
    await app.close();
    ({ app } = await buildApp({
      databasePath: ":memory:",
      logger: false,
      accountMode: "multi",
      auth: { mode: "jwt", jwtSecret: "test-secret" },
    }));

    const rootToken = app.jwt.sign({ sub: "root", role: "user", account_id: "default-admin" });
    const tokenA = app.jwt.sign({ sub: "user-a", role: "admin", account_id: "acc-a" });
    const tokenB = app.jwt.sign({ sub: "user-b", role: "admin", account_id: "acc-b" });

    const accountARes = await app.inject({
      method: "POST",
      url: "/accounts",
      headers: { authorization: `Bearer ${rootToken}` },
      payload: {
        id: "acc-a",
        name: "Account A",
      },
    });
    expect(accountARes.statusCode).toBe(201);

    const accountBRes = await app.inject({
      method: "POST",
      url: "/accounts",
      headers: { authorization: `Bearer ${rootToken}` },
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
        reasoning_effort: "low",
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

    const [, requestInit] = fetchMock.mock.calls[0]!;
    const requestBody = JSON.parse(String(requestInit?.body));
    expect(requestBody).toEqual(expect.objectContaining({ reasoning_effort: "low" }));

    vi.unstubAllGlobals();
  });

  it("falls back to stream probe for stream-only openai-compatible providers", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "stream required" } }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          [
            'data: {"choices":[{"delta":{"content":"Hi"}}]}',
            "",
            'data: {"choices":[{"delta":{"content":" there!"}}]}',
            "",
            "data: [DONE]",
            "",
          ].join("\n"),
          {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          },
        ),
      );

    vi.stubGlobal("fetch", fetchMock);

    const res = await app.inject({
      method: "POST",
      url: "/llm-profiles/models/test",
      payload: {
        provider: "openai-compatible",
        model_id: "stream-only-model",
        api_key: "sk-test-probe",
        base_url: "https://proxy.example/v1",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json() as { data: { request_text: string; response_text: string } }).toEqual({
      data: {
        request_text: "Hello",
        response_text: "Hi there!",
      },
    });

    const firstBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(firstBody.stream).toBeUndefined();
    expect(secondBody.stream).toBe(true);

    vi.unstubAllGlobals();
  });

  it("falls back to responses probe for responses-only openai providers", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "chat unavailable" } }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "chat stream unavailable" } }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            output: [
              {
                content: [{ type: "output_text", text: "Hi there!" }],
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
        model_id: "gpt-5.4",
        api_key: "sk-test-probe",
        base_url: "https://proxy.example/v1",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json() as { data: { request_text: string; response_text: string } }).toEqual({
      data: {
        request_text: "Hello",
        response_text: "Hi there!",
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "https://proxy.example/v1/chat/completions",
      "https://proxy.example/v1/chat/completions",
      "https://proxy.example/v1/responses",
    ]);

    const firstBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    const thirdBody = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));
    expect(firstBody.stream).toBeUndefined();
    expect(secondBody.stream).toBe(true);
    expect(thirdBody.stream).toBeUndefined();
    expect(thirdBody.input).toEqual([
      {
        role: "user",
        content: [{ type: "input_text", text: "Hello" }],
      },
    ]);

    vi.unstubAllGlobals();
  });

  it("falls back to streamed responses probe when responses API requires stream", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "chat unavailable" } }), { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "chat stream unavailable" } }), { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "stream required" } }), { status: 400 }))
      .mockResolvedValueOnce(
        new Response(
          [
            "event: response.output_text.delta",
            'data: {"type":"response.output_text.delta","delta":"Hi"}',
            "",
            "event: response.output_text.delta",
            'data: {"type":"response.output_text.delta","delta":" there!"}',
            "",
            'data: {"type":"response.completed"}',
            "",
          ].join("\n"),
          {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          },
        ),
      );

    vi.stubGlobal("fetch", fetchMock);

    const res = await app.inject({
      method: "POST",
      url: "/llm-profiles/models/test",
      payload: {
        provider: "openai",
        model_id: "gpt-5.4",
        api_key: "sk-test-probe",
        base_url: "https://proxy.example/v1",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json() as { data: { request_text: string; response_text: string } }).toEqual({
      data: {
        request_text: "Hello",
        response_text: "Hi there!",
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "https://proxy.example/v1/chat/completions",
      "https://proxy.example/v1/chat/completions",
      "https://proxy.example/v1/responses",
      "https://proxy.example/v1/responses",
    ]);

    const thirdBody = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));
    const fourthBody = JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body));
    expect(thirdBody.stream).toBeUndefined();
    expect(fourthBody.stream).toBe(true);

    vi.unstubAllGlobals();
  });

  it("returns upstream model test error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 }));
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
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.json() as { error: { code: string } }).toEqual(
      expect.objectContaining({ error: expect.objectContaining({ code: "model_test_failed" }) }),
    );

    vi.unstubAllGlobals();
  });

  // ── SSRF 防护测试 ──────────────────────────────────────

  it("blocks discover with private base_url when allow_private_network is not set", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/llm-profiles/models/discover",
      payload: {
        provider: "openai-compatible",
        api_key: "sk-test",
        base_url: "http://127.0.0.1:11434",
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual(
      expect.objectContaining({ error: expect.objectContaining({ code: "ssrf_blocked" }) }),
    );
  });

  it("blocks test with private base_url when allow_private_network is not set", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/llm-profiles/models/test",
      payload: {
        provider: "openai-compatible",
        api_key: "sk-test",
        model_id: "llama3",
        base_url: "http://192.168.1.100:8080",
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual(
      expect.objectContaining({ error: expect.objectContaining({ code: "ssrf_blocked" }) }),
    );
  });

  it("blocks create with private base_url when ALLOW_PRIVATE_BASE_URL is not true", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/llm-profiles",
      payload: {
        preset_name: "Private Create Blocked",
        provider: "openai-compatible",
        model_id: "llama3",
        base_url: "http://127.0.0.1:11434",
        api_key: "sk-test",
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual(
      expect.objectContaining({ error: expect.objectContaining({ code: "ssrf_blocked" }) }),
    );
  });

  it("blocks patch with private base_url when ALLOW_PRIVATE_BASE_URL is not true", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/llm-profiles",
      payload: {
        preset_name: "Private Patch Blocked",
        provider: "openai-compatible",
        model_id: "llama3",
        api_key: "sk-test",
      },
    });
    expect(createRes.statusCode).toBe(201);
    const profileId = (createRes.json() as { data: { id: string } }).data.id;

    const res = await app.inject({
      method: "PATCH",
      url: `/llm-profiles/${profileId}`,
      payload: {
        base_url: "http://192.168.1.100:8080",
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual(
      expect.objectContaining({ error: expect.objectContaining({ code: "ssrf_blocked" }) }),
    );
  });

  it("allows create and patch with private base_url when ALLOW_PRIVATE_BASE_URL is true", async () => {
    process.env.ALLOW_PRIVATE_BASE_URL = "true";

    const createRes = await app.inject({
      method: "POST",
      url: "/llm-profiles",
      payload: {
        preset_name: "Private Base URL Allowed",
        provider: "openai-compatible",
        model_id: "llama3",
        base_url: "http://127.0.0.1:11434",
        api_key: "sk-test",
      },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json() as { data: { id: string; base_url: string | null } };
    expect(created.data.base_url).toBe("http://127.0.0.1:11434");
    const profileId = created.data.id;

    const patchRes = await app.inject({
      method: "PATCH",
      url: `/llm-profiles/${profileId}`,
      payload: { base_url: "http://192.168.1.100:8080" },
    });
    expect(patchRes.statusCode).toBe(200);
    expect((patchRes.json() as { data: { base_url: string | null } }).data.base_url).toBe("http://192.168.1.100:8080");
  });

  it("allows discover with private base_url when allow_private_network is true", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ data: [{ id: "llama3" }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    const res = await app.inject({
      method: "POST",
      url: "/llm-profiles/models/discover",
      payload: {
        provider: "openai-compatible",
        api_key: "sk-test",
        base_url: "http://127.0.0.1:11434",
        allow_private_network: true,
      },
    });

    // Should NOT be blocked by SSRF guard (request proceeds to fetch)
    expect(res.statusCode).not.toBe(400);
    expect(fetchMock).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("allows test with private base_url when allow_private_network is true", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ choices: [{ message: { content: "Hello!" } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    const res = await app.inject({
      method: "POST",
      url: "/llm-profiles/models/test",
      payload: {
        provider: "openai-compatible",
        api_key: "sk-test",
        model_id: "llama3",
        base_url: "http://192.168.1.100:8080",
        allow_private_network: true,
      },
    });

    // Should NOT be blocked by SSRF guard
    expect(res.statusCode).not.toBe(400);
    expect(fetchMock).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("still rejects non-http protocol even with allow_private_network", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/llm-profiles/models/discover",
      payload: {
        provider: "openai-compatible",
        api_key: "sk-test",
        base_url: "ftp://127.0.0.1",
        allow_private_network: true,
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual(
      expect.objectContaining({ error: expect.objectContaining({ code: "ssrf_blocked" }) }),
    );
  });

});
