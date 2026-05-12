import { describe, expect, it, vi } from "vitest";

import { createTavernClient } from "../index.js";

const baseUrl = "http://localhost:3000";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("sdk remaining resources", () => {
  it("imports characters with backend-aligned create_session default and optional title", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          character: {
            name: "Luna",
          },
          create_session: true,
          session: {
            character_binding: {
              character_id: "char-1",
              character_version_id: "charver-1",
              snapshot_summary: {
                has_greeting: true,
                name: "Luna",
              },
              sync_policy: "pin",
            },
            created_at: 1,
            id: "session-1",
            metadata: null,
            model_name: null,
            model_params: null,
            model_provider: null,
            preset_id: null,
            prompt_mode: null,
            regex_profile_id: null,
            status: "active",
            title: "Luna",
            updated_at: 2,
            user_binding: null,
            worldbook_profile_id: null,
          },
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(
      client.imports.character({
        accountId: "acc-1",
        payload: { spec: "card" },
      }),
    ).resolves.toEqual({
      character: { name: "Luna" },
      characterId: "char-1",
      characterVersionId: "charver-1",
      createSession: true,
      name: "Luna",
      session: {
        characterBinding: {
          characterId: "char-1",
          characterVersionId: "charver-1",
          snapshotSummary: {
            hasGreeting: true,
            name: "Luna",
          },
          syncPolicy: "pin",
        },
        createdAt: 1,
        id: "session-1",
        metadata: null,
        modelName: null,
        modelParams: null,
        modelProvider: null,
        presetId: null,
        promptMode: null,
        regexProfileId: null,
        status: "active",
        title: "Luna",
        updatedAt: 2,
        userBinding: null,
        worldbookProfileId: null,
      },
      source: "sillytavern",
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("http://localhost:3000/import/character");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({
      create_session: true,
      payload: { spec: "card" },
    }));
  });

  it("throws when character import payload cannot resolve a character id", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          character: { name: "Missing Id" },
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(
      client.imports.character({
        payload: { spec: "card" },
      }),
    ).rejects.toThrow("Character import returned an invalid payload");

    const [, init] = fetchImpl.mock.calls[0]!;
    expect(init?.body).toBe(JSON.stringify({
      create_session: true,
      payload: { spec: "card" },
    }));
  });

  it("falls back to provided names and sources for imported worldbooks", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          id: "wb-1",
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(
      client.imports.worldbook({
        data: { entries: [] },
        name: "Worldbook Fallback",
      }),
    ).resolves.toEqual({
      id: "wb-1",
      name: "Worldbook Fallback",
      source: "sillytavern",
    });
  });

  it("throws when preset import payload misses an id", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          name: "Preset without id",
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(
      client.imports.preset({
        data: { temperature: 0.7 },
        name: "Preset Fallback",
      }),
    ).rejects.toThrow("Preset import returned an invalid payload");
  });

  it("reads preset details and falls back to an empty data object", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          created_at: 1,
          id: "preset-1",
          name: "Preset A",
          source: "sillytavern",
          version: 3,
          updated_at: 2,
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.presets.getDetail({ presetId: "preset-1" })).resolves.toEqual({
      createdAt: 1,
      data: {},
      id: "preset-1",
      name: "Preset A",
      source: "sillytavern",
      version: 3,
      updatedAt: 2,
    });
  });

  it("throws when preset detail payload is missing", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: null }));
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.presets.getDetail({ presetId: "preset-1" })).rejects.toThrow("Preset detail payload is missing");
  });

  it("maps preset editor fallbacks for format extras and triggers", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          created_at: 1,
          editor: {
            default_character_id: 0,
            entries: [
              {
                content: "System",
                enabled: 0,
                extra: null,
                forbid_overrides: "bad",
                identifier: "entry-1",
                injection_position: 1,
                injection_trigger: "bad",
                marker: 1,
                name: "Entry",
                role: "system",
                system_prompt: 1,
              },
            ],
            order_contexts: [
              {
                character_id: 7,
                extra: null,
                order: [{ enabled: 1, identifier: "entry-1" }],
              },
            ],
          },
          id: "preset-1",
          name: "Preset A",
          source: "sillytavern",
          version: 3,
          updated_at: 2,
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.presets.getEditor({ presetId: "preset-1" })).resolves.toEqual({
      createdAt: 1,
      editor: {
        defaultCharacterId: 0,
        entries: [
          {
            content: "System",
            enabled: false,
            extra: {},
            forbidOverrides: undefined,
            identifier: "entry-1",
            injectionDepth: undefined,
            injectionOrder: undefined,
            injectionPosition: 1,
            injectionTrigger: undefined,
            marker: true,
            name: "Entry",
            role: "system",
            systemPrompt: true,
          },
        ],
        format: "st-raw",
        orderContexts: [
          {
            characterId: 7,
            extra: {},
            order: [{ enabled: true, identifier: "entry-1" }],
          },
        ],
        topLevel: {},
      },
      id: "preset-1",
      name: "Preset A",
      source: "sillytavern",
      version: 3,
      updatedAt: 2,
    });
  });

  it("lists presets filters null entries and deletes preset resources", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            null,
            {
              created_at: 1,
              id: "preset-1",
              name: "Preset A",
              source: "sillytavern",
              version: 3,
              updated_at: 2,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: {} }));
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.presets.list()).resolves.toEqual([
      {
        createdAt: 1,
        id: "preset-1",
        name: "Preset A",
        source: "sillytavern",
        version: 3,
        updatedAt: 2,
      },
    ]);

    await expect(client.presets.remove({ expectedVersion: 3, presetId: "preset-1" })).resolves.toBeUndefined();

    const [removeUrl, removeInit] = fetchImpl.mock.calls[1]!;
    expect(removeUrl).toBe("http://localhost:3000/presets/preset-1?expected_version=3");
    expect(removeInit?.method).toBe("DELETE");
  });


  it("lists and gets preset versions", async () => {
    const versionPayload = {
      id: "preset-ver-1",
      asset_id: "preset-1",
      kind: "preset",
      version_no: 1,
      parent_version_id: null,
      content_hash: "sha256:preset-v1",
      snapshot: { prompts: [] },
      created_by_operation_id: null,
      created_at: 123,
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: [versionPayload] }))
      .mockResolvedValueOnce(jsonResponse({ data: versionPayload }));
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.presets.listVersions({ presetId: "preset-1" })).resolves.toEqual([
      {
        assetId: "preset-1",
        contentHash: "sha256:preset-v1",
        createdAt: 123,
        createdByOperationId: null,
        id: "preset-ver-1",
        kind: "preset",
        parentVersionId: null,
        snapshot: { prompts: [] },
        versionNo: 1,
      },
    ]);

    await expect(client.presets.getVersion({ presetId: "preset-1", versionId: "preset-ver-1" })).resolves.toMatchObject({
      id: "preset-ver-1",
      versionNo: 1,
    });

    expect(fetchImpl.mock.calls[0]?.[0]).toBe("http://localhost:3000/presets/preset-1/versions");
    expect(fetchImpl.mock.calls[1]?.[0]).toBe("http://localhost:3000/presets/preset-1/versions/preset-ver-1");
  });

  it("compares and rolls back preset versions", async () => {
    const comparePayload = {
      asset_id: "preset-1",
      kind: "preset",
      left_version_id: "preset-ver-1",
      right_version_id: "preset-ver-2",
      diff: {
        mode: "summary",
        total_changes: 1,
        truncated: false,
        changes: [{ path: "temperature", change_type: "changed", redacted: false }],
      },
    };
    const rollbackPayload = {
      id: "preset-1",
      name: "Preset A",
      source: "test",
      created_at: 1,
      updated_at: 2,
      version: 3,
      version_id: "preset-ver-3",
      content_hash: "sha256:preset-v3",
      rolled_back_from_version_id: "preset-ver-1",
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: comparePayload }))
      .mockResolvedValueOnce(jsonResponse({ data: rollbackPayload }));
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.presets.compareVersions({
      leftVersionId: "preset-ver-1",
      mode: "summary",
      presetId: "preset-1",
      rightVersionId: "preset-ver-2",
    })).resolves.toMatchObject({
      assetId: "preset-1",
      diff: { totalChanges: 1 },
    });

    await expect(client.presets.rollbackVersion({
      expectedVersion: 2,
      presetId: "preset-1",
      versionId: "preset-ver-1",
    })).resolves.toMatchObject({
      rolledBackFromVersionId: "preset-ver-1",
      version: 3,
      versionId: "preset-ver-3",
    });

    expect(fetchImpl.mock.calls[0]?.[0]).toBe("http://localhost:3000/presets/preset-1/versions/compare");
    expect(fetchImpl.mock.calls[1]?.[0]).toBe("http://localhost:3000/presets/preset-1/versions/preset-ver-1/rollback");
  });


  it("creates and lists VC tags", async () => {
    const tagPayload = {
      id: "tag-1",
      account_id: "acc-1",
      name: "checkpoint",
      target_type: "floor",
      target_id: "floor-1",
      session_id: "session-1",
      metadata: { note: "keep" },
      created_by_operation_id: "op-1",
      created_at: 123,
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: tagPayload }))
      .mockResolvedValueOnce(jsonResponse({
        data: [tagPayload],
        meta: { total: 1, limit: 50, offset: 0, has_more: false, sort_by: "created_at", sort_order: "desc" },
      }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: "tag-1", deleted: true } }));
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.vcTags.create({
      name: "checkpoint",
      targetId: "floor-1",
      targetType: "floor",
      metadata: { note: "keep" },
    })).resolves.toMatchObject({ id: "tag-1", sessionId: "session-1" });

    await expect(client.vcTags.list({ targetType: "floor", targetId: "floor-1" })).resolves.toMatchObject({
      data: [{ id: "tag-1", name: "checkpoint" }],
      meta: { total: 1 },
    });

    await expect(client.vcTags.remove({ tagId: "tag-1" })).resolves.toBe(true);

    expect(fetchImpl.mock.calls[0]?.[0]).toBe("http://localhost:3000/vc-tags");
    expect(fetchImpl.mock.calls[1]?.[0]).toBe("http://localhost:3000/vc-tags?limit=50&offset=0&sort_order=desc&target_id=floor-1&target_type=floor");
    expect(fetchImpl.mock.calls[2]?.[0]).toBe("http://localhost:3000/vc-tags/tag-1");
  });


  it("updates presets with compacted bodies and throws on invalid responses", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            created_at: 10,
            id: "preset-1",
            name: "Preset Updated",
            source: "sillytavern",
            version: 4,
            updated_at: 11,
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: null }));
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(
      client.presets.update({
        editor: {
          default_character_id: 0,
          entries: [],
          order_contexts: [],
          top_level: {},
        },
        expectedVersion: 4,
        name: "Preset Updated",
        presetId: "preset-1",
      }),
    ).resolves.toEqual({
      createdAt: 10,
      id: "preset-1",
      name: "Preset Updated",
      source: "sillytavern",
      version: 4,
      updatedAt: 11,
    });

    const [, init] = fetchImpl.mock.calls[0]!;
    expect(init?.body).toBe(JSON.stringify({
      editor: {
        default_character_id: 0,
        entries: [],
        order_contexts: [],
        top_level: {},
      },
      expected_version: 4,
      name: "Preset Updated",
    }));

    await expect(
      client.presets.update({
        editor: {
          default_character_id: 0,
          entries: [],
          order_contexts: [],
          top_level: {},
        },
        expectedVersion: 4,
        name: "Preset Updated",
        presetId: "preset-1",
      }),
    ).rejects.toThrow("Preset update returned an invalid payload");
  });

  it("reads worldbook details and falls back to an empty data object", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          created_at: 1,
          id: "wb-1",
          name: "Worldbook A",
          source: "sillytavern",
          version: 2,
          updated_at: 2,
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.worldbooks.getDetail({ worldbookId: "wb-1" })).resolves.toEqual({
      createdAt: 1,
      data: {},
      id: "wb-1",
      name: "Worldbook A",
      source: "sillytavern",
      version: 2,
      updatedAt: 2,
    });
  });

  it("lists and deletes worldbooks and throws on invalid update payloads", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            null,
            {
              created_at: 1,
              id: "wb-1",
              name: "Worldbook A",
              source: "sillytavern",
              version: 2,
              updated_at: 2,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: {} }))
      .mockResolvedValueOnce(jsonResponse({ data: null }));
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.worldbooks.list()).resolves.toEqual([
      {
        createdAt: 1,
        id: "wb-1",
        name: "Worldbook A",
        source: "sillytavern",
        version: 2,
        updatedAt: 2,
      },
    ]);
    await expect(client.worldbooks.remove({ expectedVersion: 2, worldbookId: "wb-1" })).resolves.toBeUndefined();

    const [removeUrl, removeInit] = fetchImpl.mock.calls[1]!;
    expect(removeUrl).toBe("http://localhost:3000/worldbooks/wb-1?expected_version=2");
    expect(removeInit?.method).toBe("DELETE");

    await expect(
      client.worldbooks.update({
        data: { entries: [] },
        name: "Worldbook A",
        worldbookId: "wb-1",
      }),
    ).rejects.toThrow("Worldbook update returned an invalid payload");
  });

  it("throws when worldbook detail payload is missing", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: null }));
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.worldbooks.getDetail({ worldbookId: "wb-1" })).rejects.toThrow(
      "Worldbook detail payload is missing",
    );
  });

  it("creates character versions and throws on invalid create payloads", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            character_id: "char-1",
            content_hash: "hash-1",
            created_at: 0,
            id: "ver-1",
            snapshot: { name: "Hero" },
            revision: 2,
            version_no: 1,
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: null }));
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(
      client.characters.createVersion({
        characterId: "char-1",
        expectedRevision: 4,
        snapshot: { name: "Hero" },
      }),
    ).resolves.toEqual({
      characterId: "char-1",
      contentHash: "hash-1",
      createdAt: 0,
      id: "ver-1",
      snapshot: { name: "Hero" },
      versionNo: 1,
      revision: 2,
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("http://localhost:3000/characters/char-1/versions");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({
      expected_revision: 4,
      snapshot: { name: "Hero" },
    }));

    await expect(
      client.characters.createVersion({
        characterId: "char-1",
        snapshot: { name: "Hero" },
      }),
    ).rejects.toThrow("Character update returned an invalid payload");
  });

  it("reads character detail fallbacks when latest_version is invalid", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          created_at: "bad",
          deleted_at: "bad",
          id: "char-1",
          latest_version: "bad",
          latest_version_no: "bad",
          name: "Hero",
          revision: "bad",
          source: "sillytavern",
          status: "active",
          updated_at: "bad",
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.characters.getDetail({ characterId: "char-1" })).resolves.toEqual({
      createdAt: 0,
      deletedAt: null,
      id: "char-1",
      latestVersion: null,
      latestVersionNo: null,
      name: "Hero",
      revision: 0,
      source: "sillytavern",
      status: "active",
      updatedAt: 0,
    });
  });

  it("throws when character detail payload is missing", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: null }));
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.characters.getDetail({ characterId: "char-1" })).rejects.toThrow(
      "Character detail payload is missing",
    );
  });

  it("lists characters with custom queries and filters null entries", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [
          null,
          {
            created_at: 1,
            id: "char-1",
            latest_version_no: 4,
            name: "Hero",
            revision: 5,
            source: "sillytavern",
            status: "deleted",
            updated_at: 2,
          },
        ],
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(
      client.characters.list({
        limit: 20,
        offset: 5,
        sortBy: "created_at",
        sortOrder: "asc",
        status: "deleted",
      }),
    ).resolves.toEqual([
      {
        createdAt: 1,
        id: "char-1",
        latestVersionNo: 4,
        name: "Hero",
        revision: 5,
        source: "sillytavern",
        status: "deleted",
        updatedAt: 2,
      },
    ]);

    const [url] = fetchImpl.mock.calls[0]!;
    const requestUrl = new URL(url as string);
    expect(requestUrl.pathname).toBe("/characters");
    expect(requestUrl.searchParams.get("limit")).toBe("20");
    expect(requestUrl.searchParams.get("offset")).toBe("5");
    expect(requestUrl.searchParams.get("sort_by")).toBe("created_at");
    expect(requestUrl.searchParams.get("sort_order")).toBe("asc");
    expect(requestUrl.searchParams.get("status")).toBe("deleted");
  });

  it("deletes and restores characters with the expected methods and payloads", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: {} }))
      .mockResolvedValueOnce(jsonResponse({ data: {} }));
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.characters.remove({ characterId: "char-1", expectedRevision: 7 })).resolves.toBeUndefined();
    await expect(client.characters.restore({ characterId: "char-1", expectedRevision: 8 })).resolves.toBeUndefined();

    const [removeUrl, removeInit] = fetchImpl.mock.calls[0]!;
    const [restoreUrl, restoreInit] = fetchImpl.mock.calls[1]!;
    expect(removeUrl).toBe("http://localhost:3000/characters/char-1");
    expect(removeInit?.method).toBe("DELETE");
    expect(removeInit?.body).toBe(JSON.stringify({ expected_revision: 7 }));
    expect(restoreUrl).toBe("http://localhost:3000/characters/char-1/restore");
    expect(restoreInit?.method).toBe("POST");
    expect(restoreInit?.body).toBe(JSON.stringify({ expected_revision: 8 }));
  });

  it("creates users and throws when the create payload is invalid", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            created_at: 1,
            id: "user-1",
            name: "Alice",
            revision: 0,
            status: "active",
            updated_at: 2,
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: null }));
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(
      client.users.create({
        snapshot: { name: "Alice" },
      }),
    ).resolves.toEqual({
      createdAt: 1,
      id: "user-1",
      name: "Alice",
      revision: 0,
      status: "active",
      updatedAt: 2,
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("http://localhost:3000/users");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({
      snapshot: { name: "Alice" },
    }));

    await expect(
      client.users.create({
        snapshot: { name: "Alice" },
      }),
    ).rejects.toThrow("User create returned an invalid payload");
  });

  it("lists users with custom queries and filters null entries", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [
          null,
          {
            created_at: 3,
            id: "user-2",
            name: "Bob",
            revision: 0,
            status: "archived",
            updated_at: 4,
          },
        ],
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(
      client.users.list({
        limit: 10,
        offset: 2,
        sortBy: "created_at",
        sortOrder: "asc",
      }),
    ).resolves.toEqual([
      {
        createdAt: 3,
        id: "user-2",
        name: "Bob",
        revision: 0,
        status: "archived",
        updatedAt: 4,
      },
    ]);

    const [url] = fetchImpl.mock.calls[0]!;
    const requestUrl = new URL(url as string);
    expect(requestUrl.pathname).toBe("/users");
    expect(requestUrl.searchParams.get("limit")).toBe("10");
    expect(requestUrl.searchParams.get("offset")).toBe("2");
    expect(requestUrl.searchParams.get("sort_by")).toBe("created_at");
    expect(requestUrl.searchParams.get("sort_order")).toBe("asc");
  });
});
