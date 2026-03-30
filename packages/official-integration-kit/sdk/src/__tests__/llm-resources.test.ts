import { describe, expect, it, vi } from "vitest";

import { createTavernClient } from "../index.js";

const baseUrl = "http://localhost:3000";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("sdk llm resources", () => {
  it("activates a profile with snake_case request fields and reads boolean results", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          activated: false,
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(
      client.llmProfiles.activate({
        accountId: "acc-1",
        params: { temperature: 0.7 },
        profileId: "profile-1",
        scope: "session",
        sessionId: "session-1",
        slot: "narrator",
      }),
    ).resolves.toBe(false);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("http://localhost:3000/llm-profiles/profile-1/activate");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({
      instance_slot: "narrator",
      params: { temperature: 0.7 },
      scope: "session",
      session_id: "session-1",
    }));
  });

  it("unbinds a profile with query-string scope fields and reads boolean results", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          unbound: true,
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(
      client.llmProfiles.unbind({
        accountId: "acc-1",
        scope: "session",
        sessionId: "session-1",
        slot: "director",
      }),
    ).resolves.toBe(true);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("http://localhost:3000/llm-profiles/bindings/director?scope=session&session_id=session-1");
    expect(init?.method).toBe("DELETE");
  });

  it("creates llm profiles with normalized fields", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          api_key_masked: "sk-***",
          api_key_name: "OPENAI_API_KEY",
          base_url: "https://api.openai.com",
          created_at: 1,
          id: "profile-1",
          last_used_at: 2,
          model_id: "gpt-4o",
          preset_name: "Default",
          provider: "openai",
          status: "active",
          updated_at: 3,
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    const result = await client.llmProfiles.create({
      accountId: "acc-1",
      apiKey: "secret",
      apiKeyName: "OPENAI_API_KEY",
      baseUrl: "https://api.openai.com",
      modelId: "gpt-4o",
      presetName: "Default",
      provider: "openai",
    });

    expect(result).toEqual({
      apiKeyMasked: "sk-***",
      apiKeyName: "OPENAI_API_KEY",
      baseUrl: "https://api.openai.com",
      createdAt: 1,
      id: "profile-1",
      lastUsedAt: 2,
      modelId: "gpt-4o",
      presetName: "Default",
      provider: "openai",
      status: "active",
      updatedAt: 3,
    });

    const [, init] = fetchImpl.mock.calls[0]!;
    expect(init?.body).toBe(JSON.stringify({
      api_key: "secret",
      api_key_name: "OPENAI_API_KEY",
      base_url: "https://api.openai.com",
      model_id: "gpt-4o",
      preset_name: "Default",
      provider: "openai",
    }));
  });

  it("deletes llm profiles using the boolean deleted flag", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          deleted: true,
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.llmProfiles.delete({ profileId: "profile-1" })).resolves.toBe(true);
  });

  it("filters malformed discovered models", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [
          null,
          { id: "gpt-4o", label: "GPT-4o" },
          { id: "missing-label" },
          { label: "missing-id" },
        ],
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(
      client.llmProfiles.discoverModels({
        apiKey: "secret",
        provider: "openai",
      }),
    ).resolves.toEqual([
      { id: "gpt-4o", label: "GPT-4o" },
    ]);
  });

  it("lists llm profiles and filters malformed rows", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [
          null,
          {
            api_key_masked: "sk-***",
            api_key_name: null,
            base_url: null,
            created_at: 0,
            id: "profile-1",
            last_used_at: null,
            model_id: "gpt-4o",
            preset_name: "Default",
            provider: "openai",
            status: "disabled",
            updated_at: 0,
          },
        ],
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.llmProfiles.list()).resolves.toEqual([
      {
        apiKeyMasked: "sk-***",
        apiKeyName: null,
        baseUrl: null,
        createdAt: 0,
        id: "profile-1",
        lastUsedAt: null,
        modelId: "gpt-4o",
        presetName: "Default",
        provider: "openai",
        status: "disabled",
        updatedAt: 0,
      },
    ]);
  });

  it("lists runtime slots without a session query and applies mapper fallbacks", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          slots: [
            null,
            {
              model_id: "gpt-4o",
              params: "bad",
              provider: "openai",
            },
          ],
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    const result = await client.llmProfiles.runtime();

    expect(result).toEqual([
      {
        modelId: "gpt-4o",
        params: null,
        presetName: null,
        profileId: null,
        provider: "openai",
        scope: null,
        slot: "*",
        source: "env",
      },
    ]);

    const [url] = fetchImpl.mock.calls[0]!;
    const requestUrl = new URL(url as string);
    expect(requestUrl.pathname).toBe("/llm-profiles/runtime");
    expect(requestUrl.search).toBe("");
  });

  it("trims llm model test payloads before returning them", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          request_text: "  ping  ",
          response_text: "  pong  ",
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(
      client.llmProfiles.testModel({
        apiKey: "secret",
        modelId: "gpt-4o",
        provider: "openai",
      }),
    ).resolves.toEqual({
      requestText: "ping",
      responseText: "pong",
    });
  });

  it("throws when llm model test payload becomes empty after trimming", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          request_text: "   ",
          response_text: "pong",
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(
      client.llmProfiles.testModel({
        apiKey: "secret",
        modelId: "gpt-4o",
        provider: "openai",
      }),
    ).rejects.toThrow("Failed to test model");
  });

  it("updates llm profiles with partial snake_case fields", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          api_key_masked: "sk-***",
          api_key_name: null,
          base_url: null,
          created_at: 10,
          id: "profile-1",
          last_used_at: null,
          model_id: "gpt-4.1",
          preset_name: "Creative",
          provider: "openai",
          status: "active",
          updated_at: 11,
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    const result = await client.llmProfiles.update({
      modelId: "gpt-4.1",
      presetName: "Creative",
      profileId: "profile-1",
      status: "active",
    });

    expect(result).toEqual({
      apiKeyMasked: "sk-***",
      apiKeyName: null,
      baseUrl: null,
      createdAt: 10,
      id: "profile-1",
      lastUsedAt: null,
      modelId: "gpt-4.1",
      presetName: "Creative",
      provider: "openai",
      status: "active",
      updatedAt: 11,
    });

    const [, init] = fetchImpl.mock.calls[0]!;
    expect(init?.body).toBe(JSON.stringify({
      model_id: "gpt-4.1",
      preset_name: "Creative",
      status: "active",
    }));
  });

  it("lists llm instance configs with mapper fallbacks", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [
          null,
          {
            enabled: true,
            id: "cfg-1",
            instance_slot: "memory",
            params: "bad",
            preset_id: null,
            scope_id: "global",
          },
        ],
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.llmInstances.list()).resolves.toEqual([
      {
        createdAt: 0,
        enabled: true,
        id: "cfg-1",
        instanceSlot: "memory",
        params: null,
        presetId: null,
        scope: "global",
        scopeId: "global",
        updatedAt: 0,
      },
    ]);
  });

  it("lists llm instance configs by slot with query parameters", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: [] }));
    const client = createTavernClient({ baseUrl, fetchImpl });

    await client.llmInstances.listBySlot({
      scope: "session",
      sessionId: "session-1",
      slot: "memory",
    });

    const [url] = fetchImpl.mock.calls[0]!;
    const requestUrl = new URL(url as string);

    expect(requestUrl.pathname).toBe("/llm-instances/memory");
    expect(requestUrl.searchParams.get("scope")).toBe("session");
    expect(requestUrl.searchParams.get("session_id")).toBe("session-1");
  });

  it("lists resolved llm slots with session query and fallback values", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          slots: [
            null,
            {
              config_id: null,
              enabled: false,
              params: "bad",
              preset_id: null,
              scope: null,
              slot: "director",
            },
          ],
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    const result = await client.llmInstances.listResolved({ sessionId: "session-1" });

    expect(result).toEqual([
      {
        configId: null,
        enabled: false,
        params: null,
        presetId: null,
        scope: null,
        slot: "director",
        source: "default",
      },
    ]);

    const [url] = fetchImpl.mock.calls[0]!;
    const requestUrl = new URL(url as string);
    expect(requestUrl.pathname).toBe("/llm-instances/resolved");
    expect(requestUrl.searchParams.get("session_id")).toBe("session-1");
  });

  it("returns boolean results when deleting llm instance configs", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            deleted: true,
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            deleted: false,
          },
        }),
      );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.llmInstances.remove({ slot: "memory" })).resolves.toBe(true);
    await expect(
      client.llmInstances.remove({
        scope: "session",
        sessionId: "session-1",
        slot: "memory",
      }),
    ).resolves.toBe(false);

    const [firstUrl] = fetchImpl.mock.calls[0]!;
    const [secondUrl] = fetchImpl.mock.calls[1]!;
    expect(new URL(firstUrl as string).search).toBe("");
    expect(new URL(secondUrl as string).searchParams.get("scope")).toBe("session");
  });

  it("throws when llm instance upsert returns no usable data payload", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: null }));
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(
      client.llmInstances.upsert({
        slot: "memory",
      }),
    ).rejects.toThrow("Failed to upsert instance config");
  });
});
