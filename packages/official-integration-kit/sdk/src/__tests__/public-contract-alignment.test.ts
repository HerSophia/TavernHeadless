import { describe, expect, it, vi } from "vitest";

import { createTavernClient } from "../index.js";

const baseUrl = "http://localhost:3000";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("sdk public contract alignment", () => {
  it("creates sessions with the expanded public write contract", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          data: {
            character_binding: {
              character_id: "char-1",
              character_version_id: "charver-2",
              snapshot_summary: {
                has_greeting: true,
                name: "Hero",
              },
              sync_policy: "manual",
            },
            created_at: 10,
            id: "session-1",
            metadata: { source: "sdk-test" },
            model_name: "gpt-4o-mini",
            model_params: { temperature: 0.7 },
            model_provider: "openai",
            preset_id: "preset-1",
            prompt_mode: "native",
            regex_profile_id: "regex-1",
            status: "active",
            title: "Contract Session",
            updated_at: 11,
            user_binding: {
              snapshot_summary: {
                name: "Alice",
              },
              user_id: "user-1",
            },
            worldbook_profile_id: "wb-1",
          },
        },
        201,
      ),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(
      client.sessions.create({
        accountId: "acc-1",
        characterId: "char-1",
        characterSnapshot: { name: "Hero", first_mes: "Hello" },
        characterSyncPolicy: "manual",
        characterVersionId: "charver-2",
        metadata: { source: "sdk-test" },
        modelName: "gpt-4o-mini",
        modelParams: { temperature: 0.7 },
        modelProvider: "openai",
        presetId: "preset-1",
        promptMode: "native",
        regexProfileId: "regex-1",
        status: "active",
        title: "Contract Session",
        userId: "user-1",
        userSnapshot: { name: "Alice", persona: "Traveler" },
        worldbookProfileId: "wb-1",
      }),
    ).resolves.toEqual({
      characterBinding: {
        characterId: "char-1",
        characterVersionId: "charver-2",
        snapshotSummary: {
          hasGreeting: true,
          name: "Hero",
        },
        syncPolicy: "manual",
      },
      createdAt: 10,
      id: "session-1",
      metadata: { source: "sdk-test" },
      modelName: "gpt-4o-mini",
      modelParams: { temperature: 0.7 },
      modelProvider: "openai",
      presetId: "preset-1",
      promptMode: "native",
      regexProfileId: "regex-1",
      status: "active",
      title: "Contract Session",
      updatedAt: 11,
      userBinding: {
        snapshotSummary: {
          name: "Alice",
        },
        userId: "user-1",
      },
      worldbookProfileId: "wb-1",
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("http://localhost:3000/sessions");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({
      character_id: "char-1",
      character_snapshot: { name: "Hero", first_mes: "Hello" },
      character_sync_policy: "manual",
      character_version_id: "charver-2",
      metadata: { source: "sdk-test" },
      model_name: "gpt-4o-mini",
      model_params: { temperature: 0.7 },
      model_provider: "openai",
      preset_id: "preset-1",
      prompt_mode: "native",
      regex_profile_id: "regex-1",
      status: "active",
      title: "Contract Session",
      user_id: "user-1",
      user_snapshot: { name: "Alice", persona: "Traveler" },
      worldbook_profile_id: "wb-1",
    }));
  });

  it("maps thchat import results with extended counters", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          data: {
            floor_count: 2,
            format: "thchat",
            import_source: "thchat",
            memory_edge_count: 3,
            memory_item_count: 5,
            message_count: 8,
            page_count: 4,
            session_id: "session-1",
            skipped_lines: 0,
            title: "Imported ThChat",
            variable_count: 6,
          },
        },
        201,
      ),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(
      client.imports.chat({
        data: "{\"spec\":\"tavern_headless_chat\"}",
        title: "Imported ThChat",
      }),
    ).resolves.toEqual({
      floorCount: 2,
      format: "thchat",
      importSource: "thchat",
      memoryEdgeCount: 3,
      memoryItemCount: 5,
      messageCount: 8,
      pageCount: 4,
      sessionId: "session-1",
      skippedLines: 0,
      title: "Imported ThChat",
      variableCount: 6,
    });
  });

  it("omits list query defaults when callers do not provide them", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse({ data: [] }));
    const client = createTavernClient({ baseUrl, fetchImpl });

    await client.characters.list();
    await client.messages.list();
    await client.pages.list();
    await client.variables.list();
    await client.sessions.list();

    expect(String(fetchImpl.mock.calls[0]![0])).toBe("http://localhost:3000/characters");
    expect(String(fetchImpl.mock.calls[1]![0])).toBe("http://localhost:3000/messages");
    expect(String(fetchImpl.mock.calls[2]![0])).toBe("http://localhost:3000/pages");
    expect(String(fetchImpl.mock.calls[3]![0])).toBe("http://localhost:3000/variables");
    expect(String(fetchImpl.mock.calls[4]![0])).toBe("http://localhost:3000/sessions");
  });

  it("validates tool query preconditions before issuing requests", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.tools.listCallRecords({ accountId: "acc-1" } as never)).rejects.toThrow(
      "tools.listCallRecords requires pageId or floorId",
    );
    await expect(client.tools.listExecutions({ accountId: "acc-1" } as never)).rejects.toThrow(
      "tools.listExecutions requires sessionId, floorId, or runId",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
