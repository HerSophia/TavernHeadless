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
        projectId: "proj-1",
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
      project_id: "proj-1",
      prompt_mode: "native",
      regex_profile_id: "regex-1",
      status: "active",
      title: "Contract Session",
      user_id: "user-1",
      user_snapshot: { name: "Alice", persona: "Traveler" },
      worldbook_profile_id: "wb-1",
    }));
  });

  it("maps Session State namespace discovery with the current public contract fields", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [
          {
            namespace: "game_state",
            owner_kind: "built_in",
            slots: [
              {
                slot: "scene",
                exposure_lifecycle: "public_stable",
                visibility_mode: "fork_on_branch",
                default_write_mode: "commit_bound",
                default_replay_safety: "safe",
                schema_version: 1,
                size_budget_bytes: 262144,
                capabilities: {
                  client_readable: true,
                  client_writable: false,
                  allowed_write_modes: [],
                  supports_snapshot: true,
                  supports_diff: true,
                },
              },
            ],
          },
          {
            namespace: "quest_flags",
            owner_kind: "custom",
            logical_owner_type: "plugin",
            logical_owner_id: "quest-plugin",
            default_slot_template: {
              default_visibility_mode: "fork_on_branch",
              default_write_mode: "direct",
              default_replay_safety: "safe",
              client_writable: true,
              allowed_write_modes: ["direct", "commit_bound"],
              supports_snapshot: true,
              supports_diff: true,
              replay_policy_source: "system_default",
            },
            slots: [
              {
                slot: "companion",
                exposure_lifecycle: "public_stable",
                visibility_mode: "fork_on_branch",
                default_write_mode: "direct",
                default_replay_safety: "safe",
                schema_version: 1,
                size_budget_bytes: 1048576,
                capabilities: {
                  client_readable: true,
                  client_writable: true,
                  allowed_write_modes: ["direct", "commit_bound"],
                  supports_snapshot: true,
                  supports_diff: true,
                },
              },
            ],
          },
        ],
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(
      client.sessionState.listNamespaces({
        accountId: "acc-1",
        sessionId: "session-1",
      }),
    ).resolves.toEqual([
      {
        namespace: "game_state",
        ownerKind: "built_in",
        slots: [
          {
            slot: "scene",
            exposureLifecycle: "public_stable",
            visibilityMode: "fork_on_branch",
            defaultWriteMode: "commit_bound",
            defaultReplaySafety: "safe",
            schemaVersion: 1,
            sizeBudgetBytes: 262144,
            capabilities: {
              clientReadable: true,
              clientWritable: false,
              allowedWriteModes: [],
              supportsSnapshot: true,
              supportsDiff: true,
            },
          },
        ],
      },
      {
        namespace: "quest_flags",
        ownerKind: "custom",
        logicalOwnerType: "plugin",
        logicalOwnerId: "quest-plugin",
        defaultSlotTemplate: {
          defaultVisibilityMode: "fork_on_branch",
          defaultWriteMode: "direct",
          defaultReplaySafety: "safe",
          clientWritable: true,
          allowedWriteModes: ["direct", "commit_bound"],
          supportsSnapshot: true,
          supportsDiff: true,
          replayPolicySource: "system_default",
        },
        slots: [
          expect.objectContaining({
            slot: "companion",
            sizeBudgetBytes: 1048576,
            capabilities: expect.objectContaining({ allowedWriteModes: ["direct", "commit_bound"] }),
          }),
        ],
      },
    ]);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("http://localhost:3000/sessions/session-1/state/namespaces");
    expect((init?.headers as Headers).get("x-account-id")).toBe("acc-1");
  });

  it("sends turn-embedded sessionStateWrites with the public union shape", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          branch_id: "main",
          final_state: "committed",
          floor_id: "floor-2",
          floor_no: 2,
          generated_text: "Hello",
          summaries: ["summary-1"],
          total_usage: {
            completion_tokens: 5,
            prompt_tokens: 10,
            total_tokens: 15,
          },
        },
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(
      client.sessions.respond({
        sessionId: "session-1",
        message: "hello",
        sessionStateWrites: [
          { namespace: "quest_flags", slot: "companion", value: { mood: "ally" } },
          { namespace: "quest_flags", slot: "expired_hint", delete: true },
        ],
      }),
    ).resolves.toMatchObject({
      branchId: "main",
      finalState: "committed",
      floorId: "floor-2",
      floorNo: 2,
      generatedText: "Hello",
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("http://localhost:3000/sessions/session-1/respond");
    expect(init?.body).toBe(JSON.stringify({
      message: "hello",
      session_state_writes: [
        { namespace: "quest_flags", slot: "companion", value: { mood: "ally" } },
        { namespace: "quest_flags", slot: "expired_hint", delete: true },
      ],
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
