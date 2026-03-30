import { describe, expect, it, vi } from "vitest";

import { createPresetEntriesResource } from "../resources/preset-entries.js";
import { createWorldbookEntriesResource } from "../resources/worldbook-entries.js";
import { createTransportClient } from "../client/transport.js";

const baseUrl = "http://localhost:3000";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("sdk entry resources", () => {
  it("lists, creates, gets, updates, reorders, deletes, and batch updates preset entries", async () => {
    const entryPayload = {
      content: "System prompt",
      enabled: true,
      extra: { source: "test" },
      forbid_overrides: true,
      identifier: "entry-1",
      injection_depth: 2,
      injection_order: 3,
      injection_position: 1,
      injection_trigger: ["hero"],
      marker: false,
      name: "Core",
      role: "system",
      system_prompt: true,
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            default_character_id: 7,
            entries: [entryPayload],
            preset_id: "preset-1",
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: entryPayload }, 201))
      .mockResolvedValueOnce(jsonResponse({ data: entryPayload }))
      .mockResolvedValueOnce(jsonResponse({ data: { ...entryPayload, name: "Core 2" } }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            default_character_id: 7,
            entries: [{ ...entryPayload, injection_position: 9 }],
            preset_id: "preset-1",
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            deleted: true,
            identifier: "entry-1",
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            meta: {
              not_found: 1,
              total: 2,
              updated: 1,
            },
            results: [
              {
                action: "updated",
                data: { ...entryPayload, enabled: false },
                identifier: "entry-1",
                index: 0,
              },
              {
                action: "not_found",
                identifier: "missing",
                index: 1,
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            meta: {
              deleted: 1,
              not_found: 1,
              total: 2,
            },
            results: [
              { action: "deleted", identifier: "entry-1", index: 0 },
              { action: "not_found", identifier: "missing", index: 1 },
            ],
          },
        }),
      );

    const transport = createTransportClient({ baseUrl, fetchImpl });
    const presetEntries = createPresetEntriesResource(transport);

    await expect(
      presetEntries.list({
        enabled: true,
        marker: false,
        presetId: "preset-1",
      }),
    ).resolves.toEqual({
      defaultCharacterId: 7,
      entries: [
        {
          content: "System prompt",
          enabled: true,
          extra: { source: "test" },
          forbidOverrides: true,
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
      presetId: "preset-1",
    });

    await expect(
      presetEntries.create({
        content: "System prompt",
        expectedVersion: 3,
        extra: { source: "test" },
        forbidOverrides: true,
        identifier: "entry-1",
        injectionDepth: 2,
        injectionOrder: 3,
        injectionPosition: 1,
        injectionTrigger: ["hero"],
        name: "Core",
        presetId: "preset-1",
        role: "system",
        systemPrompt: true,
      }),
    ).resolves.toEqual({
      content: "System prompt",
      enabled: true,
      extra: { source: "test" },
      forbidOverrides: true,
      identifier: "entry-1",
      injectionDepth: 2,
      injectionOrder: 3,
      injectionPosition: 1,
      injectionTrigger: ["hero"],
      marker: false,
      name: "Core",
      role: "system",
      systemPrompt: true,
    });

    await expect(
      presetEntries.getDetail({
        identifier: "entry-1",
        presetId: "preset-1",
      }),
    ).resolves.toEqual({
      content: "System prompt",
      enabled: true,
      extra: { source: "test" },
      forbidOverrides: true,
      identifier: "entry-1",
      injectionDepth: 2,
      injectionOrder: 3,
      injectionPosition: 1,
      injectionTrigger: ["hero"],
      marker: false,
      name: "Core",
      role: "system",
      systemPrompt: true,
    });

    await expect(
      presetEntries.update({
        expectedVersion: 4,
        identifier: "entry-1",
        name: "Core 2",
        presetId: "preset-1",
      }),
    ).resolves.toEqual({
      content: "System prompt",
      enabled: true,
      extra: { source: "test" },
      forbidOverrides: true,
      identifier: "entry-1",
      injectionDepth: 2,
      injectionOrder: 3,
      injectionPosition: 1,
      injectionTrigger: ["hero"],
      marker: false,
      name: "Core 2",
      role: "system",
      systemPrompt: true,
    });

    await expect(
      presetEntries.reorder({
        expectedVersion: 8,
        identifiers: ["entry-1"],
        presetId: "preset-1",
      }),
    ).resolves.toEqual({
      defaultCharacterId: 7,
      entries: [
        {
          content: "System prompt",
          enabled: true,
          extra: { source: "test" },
          forbidOverrides: true,
          identifier: "entry-1",
          injectionDepth: 2,
          injectionOrder: 3,
          injectionPosition: 9,
          injectionTrigger: ["hero"],
          marker: false,
          name: "Core",
          role: "system",
          systemPrompt: true,
        },
      ],
      presetId: "preset-1",
    });

    await expect(
      presetEntries.remove({
        expectedVersion: 5,
        identifier: "entry-1",
        presetId: "preset-1",
      }),
    ).resolves.toEqual({
      deleted: true,
      identifier: "entry-1",
    });

    await expect(
      presetEntries.batchUpdate({
        expectedVersion: 6,
        fields: {
          enabled: false,
        },
        identifiers: ["entry-1", "missing"],
        presetId: "preset-1",
      }),
    ).resolves.toEqual({
      meta: {
        notFound: 1,
        total: 2,
        updated: 1,
      },
      results: [
        {
          action: "updated",
          data: {
            content: "System prompt",
            enabled: false,
            extra: { source: "test" },
            forbidOverrides: true,
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
          identifier: "entry-1",
          index: 0,
        },
        {
          action: "not_found",
          data: undefined,
          identifier: "missing",
          index: 1,
        },
      ],
    });

    await expect(
      presetEntries.batchDelete({
        expectedVersion: 7,
        identifiers: ["entry-1", "missing"],
        presetId: "preset-1",
      }),
    ).resolves.toEqual({
      meta: {
        deleted: 1,
        notFound: 1,
        total: 2,
      },
      results: [
        { action: "deleted", identifier: "entry-1", index: 0 },
        { action: "not_found", identifier: "missing", index: 1 },
      ],
    });

    const [listUrl] = fetchImpl.mock.calls[0]!;
    const [, createInit] = fetchImpl.mock.calls[1]!;
    const [removeUrl] = fetchImpl.mock.calls[5]!;
    const [, updateInit] = fetchImpl.mock.calls[3]!;
    const [, reorderInit] = fetchImpl.mock.calls[4]!;
    const [, batchUpdateInit] = fetchImpl.mock.calls[6]!;
    const [, batchDeleteInit] = fetchImpl.mock.calls[7]!;

    const listRequestUrl = new URL(listUrl as string);
    expect(listRequestUrl.pathname).toBe("/presets/preset-1/entries");
    const removeRequestUrl = new URL(removeUrl as string);
    expect(removeRequestUrl.searchParams.get("expected_version")).toBe("5");
    expect(listRequestUrl.searchParams.get("enabled")).toBe("true");
    expect(listRequestUrl.searchParams.get("marker")).toBe("false");

    expect(createInit?.body).toBe(JSON.stringify({
      content: "System prompt",
      expected_version: 3,
      extra: { source: "test" },
      forbid_overrides: true,
      identifier: "entry-1",
      injection_depth: 2,
      injection_order: 3,
      injection_position: 1,
      injection_trigger: ["hero"],
      name: "Core",
      role: "system",
      system_prompt: true,
    }));
    expect(updateInit?.body).toBe(JSON.stringify({
      expected_version: 4,
      name: "Core 2",
    }));
    expect(reorderInit?.body).toBe(JSON.stringify({
      expected_version: 8,
      identifiers: ["entry-1"],
    }));
    expect(batchUpdateInit?.body).toBe(JSON.stringify({
      expected_version: 6,
      fields: {
        enabled: false,
      },
      identifiers: ["entry-1", "missing"],
    }));
    expect(batchDeleteInit?.body).toBe(JSON.stringify({
      expected_version: 7,
      identifiers: ["entry-1", "missing"],
    }));
  });

  it("lists, creates, gets, updates, deletes, and batch mutates worldbook entries", async () => {
    const entryPayload = {
      case_sensitive: null,
      comment: "Kingdom basics",
      constant: false,
      content: "The kingdom is vast.",
      created_at: 100,
      depth: 4,
      disable: false,
      id: "entry-1",
      keys: ["kingdom"],
      keys_secondary: ["realm"],
      match_whole_words: null,
      order: 100,
      position: 0,
      role: 0,
      scan_depth: null,
      selective: true,
      selective_logic: 0,
      uid: 1,
      updated_at: 101,
      worldbook_id: "wb-1",
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: [entryPayload] }))
      .mockResolvedValueOnce(jsonResponse({ data: entryPayload }, 201))
      .mockResolvedValueOnce(jsonResponse({ data: entryPayload }))
      .mockResolvedValueOnce(jsonResponse({ data: { ...entryPayload, comment: "Changed" } }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: "entry-1", deleted: true } }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            meta: {
              not_found: 1,
              total: 2,
              updated: 1,
            },
            results: [
              {
                action: "updated",
                data: { ...entryPayload, disable: true },
                id: "entry-1",
                index: 0,
              },
              {
                action: "not_found",
                id: "missing",
                index: 1,
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            meta: {
              deleted: 1,
              not_found: 1,
              total: 2,
            },
            results: [
              { action: "deleted", id: "entry-1", index: 0 },
              { action: "not_found", id: "missing", index: 1 },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            meta: {
              not_found: 1,
              total: 2,
              updated: 1,
            },
            results: [
              {
                action: "updated",
                data: { ...entryPayload, order: 10 },
                id: "entry-1",
                index: 0,
              },
              {
                action: "not_found",
                id: "missing",
                index: 1,
              },
            ],
          },
        }),
      );

    const transport = createTransportClient({ baseUrl, fetchImpl });
    const worldbookEntries = createWorldbookEntriesResource(transport);

    await expect(
      worldbookEntries.list({
        constant: false,
        disable: false,
        limit: 20,
        offset: 1,
        position: 0,
        q: "kingdom",
        sortBy: "uid",
        sortOrder: "desc",
        worldbookId: "wb-1",
      }),
    ).resolves.toEqual([
      {
        caseSensitive: null,
        comment: "Kingdom basics",
        constant: false,
        content: "The kingdom is vast.",
        createdAt: 100,
        depth: 4,
        disable: false,
        id: "entry-1",
        keys: ["kingdom"],
        keysSecondary: ["realm"],
        matchWholeWords: null,
        order: 100,
        position: 0,
        role: 0,
        scanDepth: null,
        selective: true,
        selectiveLogic: 0,
        uid: 1,
        updatedAt: 101,
        worldbookId: "wb-1",
      },
    ]);

    await expect(
      worldbookEntries.create({
        comment: "Kingdom basics",
        expectedVersion: 2,
        content: "The kingdom is vast.",
        keys: ["kingdom"],
        keysSecondary: ["realm"],
        worldbookId: "wb-1",
      }),
    ).resolves.toEqual({
      caseSensitive: null,
      comment: "Kingdom basics",
      constant: false,
      content: "The kingdom is vast.",
      createdAt: 100,
      depth: 4,
      disable: false,
      id: "entry-1",
      keys: ["kingdom"],
      keysSecondary: ["realm"],
      matchWholeWords: null,
      order: 100,
      position: 0,
      role: 0,
      scanDepth: null,
      selective: true,
      selectiveLogic: 0,
      uid: 1,
      updatedAt: 101,
      worldbookId: "wb-1",
    });

    await expect(
      worldbookEntries.getDetail({
        entryId: "entry-1",
        worldbookId: "wb-1",
      }),
    ).resolves.toEqual({
      caseSensitive: null,
      comment: "Kingdom basics",
      constant: false,
      content: "The kingdom is vast.",
      createdAt: 100,
      depth: 4,
      disable: false,
      id: "entry-1",
      keys: ["kingdom"],
      keysSecondary: ["realm"],
      matchWholeWords: null,
      order: 100,
      position: 0,
      role: 0,
      scanDepth: null,
      selective: true,
      selectiveLogic: 0,
      uid: 1,
      updatedAt: 101,
      worldbookId: "wb-1",
    });

    await expect(
      worldbookEntries.update({
        comment: "Changed",
        expectedVersion: 3,
        entryId: "entry-1",
        worldbookId: "wb-1",
      }),
    ).resolves.toEqual({
      caseSensitive: null,
      comment: "Changed",
      constant: false,
      content: "The kingdom is vast.",
      createdAt: 100,
      depth: 4,
      disable: false,
      id: "entry-1",
      keys: ["kingdom"],
      keysSecondary: ["realm"],
      matchWholeWords: null,
      order: 100,
      position: 0,
      role: 0,
      scanDepth: null,
      selective: true,
      selectiveLogic: 0,
      uid: 1,
      updatedAt: 101,
      worldbookId: "wb-1",
    });

    await expect(
      worldbookEntries.remove({
        entryId: "entry-1",
        expectedVersion: 4,
        worldbookId: "wb-1",
      }),
    ).resolves.toEqual({
      deleted: true,
      id: "entry-1",
    });

    await expect(
      worldbookEntries.batchUpdate({
        expectedVersion: 5,
        fields: {
          disable: true,
        },
        ids: ["entry-1", "missing"],
        worldbookId: "wb-1",
      }),
    ).resolves.toEqual({
      meta: {
        notFound: 1,
        total: 2,
        updated: 1,
      },
      results: [
        {
          action: "updated",
          data: {
            caseSensitive: null,
            comment: "Kingdom basics",
            constant: false,
            content: "The kingdom is vast.",
            createdAt: 100,
            depth: 4,
            disable: true,
            id: "entry-1",
            keys: ["kingdom"],
            keysSecondary: ["realm"],
            matchWholeWords: null,
            order: 100,
            position: 0,
            role: 0,
            scanDepth: null,
            selective: true,
            selectiveLogic: 0,
            uid: 1,
            updatedAt: 101,
            worldbookId: "wb-1",
          },
          id: "entry-1",
          index: 0,
        },
        {
          action: "not_found",
          data: undefined,
          id: "missing",
          index: 1,
        },
      ],
    });

    await expect(
      worldbookEntries.batchDelete({
        expectedVersion: 6,
        ids: ["entry-1", "missing"],
        worldbookId: "wb-1",
      }),
    ).resolves.toEqual({
      meta: {
        deleted: 1,
        notFound: 1,
        total: 2,
      },
      results: [
        { action: "deleted", id: "entry-1", index: 0 },
        { action: "not_found", id: "missing", index: 1 },
      ],
    });

    await expect(
      worldbookEntries.batchReorder({
        expectedVersion: 7,
        items: [
          { id: "entry-1", order: 10 },
          { id: "missing", order: 20 },
        ],
        worldbookId: "wb-1",
      }),
    ).resolves.toEqual({
      meta: {
        notFound: 1,
        total: 2,
        updated: 1,
      },
      results: [
        {
          action: "updated",
          data: {
            caseSensitive: null,
            comment: "Kingdom basics",
            constant: false,
            content: "The kingdom is vast.",
            createdAt: 100,
            depth: 4,
            disable: false,
            id: "entry-1",
            keys: ["kingdom"],
            keysSecondary: ["realm"],
            matchWholeWords: null,
            order: 10,
            position: 0,
            role: 0,
            scanDepth: null,
            selective: true,
            selectiveLogic: 0,
            uid: 1,
            updatedAt: 101,
            worldbookId: "wb-1",
          },
          id: "entry-1",
          index: 0,
        },
        {
          action: "not_found",
          data: undefined,
          id: "missing",
          index: 1,
        },
      ],
    });

    const [listUrl] = fetchImpl.mock.calls[0]!;
    const [, createInit] = fetchImpl.mock.calls[1]!;
    const [removeUrl] = fetchImpl.mock.calls[4]!;
    const [, updateInit] = fetchImpl.mock.calls[3]!;
    const [, batchUpdateInit] = fetchImpl.mock.calls[5]!;
    const [, batchDeleteInit] = fetchImpl.mock.calls[6]!;
    const [, batchReorderInit] = fetchImpl.mock.calls[7]!;

    const listRequestUrl = new URL(listUrl as string);
    expect(listRequestUrl.pathname).toBe("/worldbooks/wb-1/entries");
    const removeRequestUrl = new URL(removeUrl as string);
    expect(removeRequestUrl.searchParams.get("expected_version")).toBe("4");
    expect(listRequestUrl.searchParams.get("disable")).toBe("false");
    expect(listRequestUrl.searchParams.get("constant")).toBe("false");
    expect(listRequestUrl.searchParams.get("position")).toBe("0");
    expect(listRequestUrl.searchParams.get("q")).toBe("kingdom");
    expect(listRequestUrl.searchParams.get("sort_by")).toBe("uid");
    expect(listRequestUrl.searchParams.get("sort_order")).toBe("desc");
    expect(listRequestUrl.searchParams.get("limit")).toBe("20");
    expect(listRequestUrl.searchParams.get("offset")).toBe("1");

    expect(createInit?.body).toBe(JSON.stringify({
      expected_version: 2,
      comment: "Kingdom basics",
      content: "The kingdom is vast.",
      keys: ["kingdom"],
      keys_secondary: ["realm"],
    }));
    expect(updateInit?.body).toBe(JSON.stringify({
      expected_version: 3,
      comment: "Changed",
    }));
    expect(batchUpdateInit?.body).toBe(JSON.stringify({
      expected_version: 5,
      fields: {
        disable: true,
      },
      ids: ["entry-1", "missing"],
    }));
    expect(batchDeleteInit?.body).toBe(JSON.stringify({
      expected_version: 6,
      ids: ["entry-1", "missing"],
    }));
    expect(batchReorderInit?.body).toBe(JSON.stringify({
      expected_version: 7,
      items: [
        { id: "entry-1", order: 10 },
        { id: "missing", order: 20 },
      ],
    }));
  });
});
