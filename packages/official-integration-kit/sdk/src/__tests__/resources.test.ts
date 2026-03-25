import { describe, expect, it, vi } from "vitest";

import { createTavernClient } from "../index.js";

const baseUrl = "http://localhost:3000";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("sdk resources", () => {
  it("imports preset with normalized result and request body", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          id: "preset-1",
          name: "Preset A",
          source: "sillytavern",
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    const result = await client.imports.preset({
      accountId: "acc-1",
      data: { temperature: 0.8 },
      name: "Preset A",
    });

    expect(result).toEqual({
      id: "preset-1",
      name: "Preset A",
      source: "sillytavern",
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("http://localhost:3000/import/preset");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Headers).get("x-account-id")).toBe("acc-1");
    expect(init?.body).toBe(JSON.stringify({
      data: { temperature: 0.8 },
      name: "Preset A",
    }));
  });

  it("maps preset editor payload to camelCase document", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          created_at: 100,
          editor: {
            default_character_id: 1,
            entries: [
              {
                content: "System prompt",
                enabled: true,
                extra: { source: "test" },
                identifier: "entry-1",
                injection_depth: 2,
                injection_order: 3,
                injection_position: 1,
                injection_trigger: ["hero"],
                marker: false,
                name: "Core",
                role: "system",
                system_prompt: true,
              },
            ],
            format: "st-raw",
            order_contexts: [
              {
                character_id: 7,
                extra: { pinned: true },
                order: [{ enabled: true, identifier: "entry-1" }],
              },
            ],
            top_level: { temperature: 0.7 },
          },
          id: "preset-1",
          name: "Preset A",
          source: "sillytavern",
          updated_at: 101,
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    const result = await client.presets.getEditor({
      accountId: "acc-1",
      presetId: "preset-1",
    });

    expect(result).toEqual({
      createdAt: 100,
      editor: {
        defaultCharacterId: 1,
        entries: [
          {
            content: "System prompt",
            enabled: true,
            extra: { source: "test" },
            forbidOverrides: undefined,
            identifier: "entry-1",
            injectionDepth: 2,
            injectionOrder: 3,
            injectionPosition: 1,
            injectionTrigger: ["hero"],
            marker: false,
            name: "Core",
            role: "system",
            systemPrompt: true,
          },
        ],
        format: "st-raw",
        orderContexts: [
          {
            characterId: 7,
            extra: { pinned: true },
            order: [{ enabled: true, identifier: "entry-1" }],
          },
        ],
        topLevel: { temperature: 0.7 },
      },
      id: "preset-1",
      name: "Preset A",
      source: "sillytavern",
      updatedAt: 101,
    });
  });

  it("updates worldbook and returns normalized list item", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          created_at: 11,
          id: "wb-1",
          name: "Worldbook A",
          source: "sillytavern",
          updated_at: 22,
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    const result = await client.worldbooks.update({
      accountId: "acc-1",
      data: { entries: [] },
      expectedUpdatedAt: 20,
      name: "Worldbook A",
      worldbookId: "wb-1",
    });

    expect(result).toEqual({
      createdAt: 11,
      id: "wb-1",
      name: "Worldbook A",
      source: "sillytavern",
      updatedAt: 22,
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("http://localhost:3000/worldbooks/wb-1");
    expect(init?.method).toBe("PUT");
    expect(init?.body).toBe(JSON.stringify({
      data: { entries: [] },
      expected_updated_at: 20,
      name: "Worldbook A",
    }));
  });

  it("maps character detail and latest version", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          created_at: 10,
          deleted_at: null,
          id: "char-1",
          latest_version: {
            character_id: "char-1",
            content_hash: "hash-1",
            created_at: 12,
            id: "ver-1",
            snapshot: { name: "Seraphina" },
            version_no: 2,
          },
          latest_version_no: 2,
          name: "Seraphina",
          source: "sillytavern",
          status: "active",
          updated_at: 13,
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    const result = await client.characters.getDetail({
      accountId: "acc-1",
      characterId: "char-1",
    });

    expect(result).toEqual({
      createdAt: 10,
      deletedAt: null,
      id: "char-1",
      latestVersion: {
        characterId: "char-1",
        contentHash: "hash-1",
        createdAt: 12,
        id: "ver-1",
        snapshot: { name: "Seraphina" },
        versionNo: 2,
      },
      latestVersionNo: 2,
      name: "Seraphina",
      source: "sillytavern",
      status: "active",
      updatedAt: 13,
    });
  });

  it("maps llm profile runtime slots and keeps session query", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          slots: [
            {
              model_id: "gpt-4o",
              params: { temperature: 0.8 },
              preset_name: "Default",
              profile_id: "profile-1",
              provider: "openai",
              scope: "global",
              slot: "narrator",
              source: "global_profile",
            },
          ],
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    const result = await client.llmProfiles.runtime({
      accountId: "acc-1",
      sessionId: "session-1",
    });

    expect(result).toEqual([
      {
        modelId: "gpt-4o",
        params: { temperature: 0.8 },
        presetName: "Default",
        profileId: "profile-1",
        provider: "openai",
        scope: "global",
        slot: "narrator",
        source: "global_profile",
      },
    ]);

    const [url] = fetchImpl.mock.calls[0]!;
    const requestUrl = new URL(url as string);
    expect(requestUrl.pathname).toBe("/llm-profiles/runtime");
    expect(requestUrl.searchParams.get("session_id")).toBe("session-1");
  });

  it("upserts llm instance config with normalized response", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          created_at: 1,
          enabled: true,
          id: "cfg-1",
          instance_slot: "memory",
          params: { top_p: 0.9 },
          preset_id: "preset-1",
          scope: "session",
          scope_id: "session-1",
          updated_at: 2,
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    const result = await client.llmInstances.upsert({
      accountId: "acc-1",
      enabled: true,
      params: { top_p: 0.9 },
      presetId: "preset-1",
      scope: "session",
      sessionId: "session-1",
      slot: "memory",
    });

    expect(result).toEqual({
      createdAt: 1,
      enabled: true,
      id: "cfg-1",
      instanceSlot: "memory",
      params: { top_p: 0.9 },
      presetId: "preset-1",
      scope: "session",
      scopeId: "session-1",
      updatedAt: 2,
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("http://localhost:3000/llm-instances/memory");
    expect(init?.method).toBe("PUT");
    expect(init?.body).toBe(JSON.stringify({
      enabled: true,
      params: { top_p: 0.9 },
      preset_id: "preset-1",
      scope: "session",
      session_id: "session-1",
    }));
  });

  it("lists users with default query and normalized rows", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [
          {
            created_at: 5,
            id: "user-1",
            name: "Alice",
            status: "active",
            updated_at: 6,
          },
        ],
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    const result = await client.users.list({ accountId: "acc-1" });

    expect(result).toEqual([
      {
        createdAt: 5,
        id: "user-1",
        name: "Alice",
        status: "active",
        updatedAt: 6,
      },
    ]);

    const [url] = fetchImpl.mock.calls[0]!;
    const requestUrl = new URL(url as string);
    expect(requestUrl.pathname).toBe("/users");
    expect(requestUrl.searchParams.get("limit")).toBe("100");
    expect(requestUrl.searchParams.get("offset")).toBe("0");
    expect(requestUrl.searchParams.get("sort_by")).toBe("updated_at");
    expect(requestUrl.searchParams.get("sort_order")).toBe("desc");
  });
});
