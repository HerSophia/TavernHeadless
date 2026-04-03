import { describe, expect, it, vi } from "vitest";

import { createTransportClient } from "../client/transport.js";
import { createExportsResource } from "../resources/exports.js";
import { createMcpResource } from "../resources/mcp.js";
import { createToolsResource } from "../resources/tools.js";

const baseUrl = "http://localhost:3000";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("sdk integration and operations resources", () => {
  it("returns the raw chat export response and preserves query parameters", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('{"data":{"title":"Demo"}}', {
        headers: {
          "content-disposition": 'attachment; filename="Demo.thchat"',
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      }),
    );

    const transport = createTransportClient({ baseUrl, fetchImpl });
    const exportsResource = createExportsResource(transport);

    const response = await exportsResource.chat({
      accountId: "acc-1",
      format: "st_jsonl",
      includeMemories: false,
      includeVariables: false,
      sessionId: "session 1",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="Demo.thchat"');
    expect(await response.text()).toBe('{"data":{"title":"Demo"}}');

    const [url, init] = fetchImpl.mock.calls[0]!;
    const headers = init?.headers as Headers;

    expect(String(url)).toBe(
      "http://localhost:3000/export/chat/session%201?format=st_jsonl&include_memories=false&include_variables=false",
    );
    expect(init?.method).toBe("GET");
    expect(headers.get("x-account-id")).toBe("acc-1");
    expect(headers.get("content-type")).toBeNull();
  });

  it("creates async chat export jobs and preserves request fields", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          data: {
            job_id: "ctj-export-1",
            status: "pending",
            job_kind: "export_chat",
            format: "st_jsonl",
            requested_session_id: "session-1",
          },
        },
        202,
      ),
    );

    const transport = createTransportClient({ baseUrl, fetchImpl });
    const exportsResource = createExportsResource(transport);

    await expect(
      exportsResource.chatJob({
        accountId: "acc-1",
        format: "st_jsonl",
        includeMemories: false,
        includeVariables: false,
        sessionId: "session 1",
      }),
    ).resolves.toEqual({
      format: "st_jsonl",
      jobId: "ctj-export-1",
      jobKind: "export_chat",
      requestedSessionId: "session-1",
      status: "pending",
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("http://localhost:3000/export/chat/session%201/jobs");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({
      format: "st_jsonl",
      include_memories: false,
      include_variables: false,
    }));
  });

  it("returns raw responses for preset, worldbook, regex, and character exports", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response('{"name":"Preset A"}', {
          headers: {
            "content-disposition": 'attachment; filename="Preset A.json"',
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response('{"name":"Worldbook A"}', {
          headers: {
            "content-disposition": 'attachment; filename="Worldbook A.json"',
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response('[{"scriptName":"safe"}]', {
          headers: {
            "content-disposition": 'attachment; filename="Regex A.json"',
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response("missing", {
          headers: {
            "content-type": "text/plain",
          },
          status: 404,
        }),
      );

    const transport = createTransportClient({ baseUrl, fetchImpl });
    const exportsResource = createExportsResource(transport);

    const presetResponse = await exportsResource.preset({ presetId: "preset 1" });
    expect(presetResponse.status).toBe(200);
    expect(await presetResponse.text()).toBe('{"name":"Preset A"}');

    const worldbookResponse = await exportsResource.worldbook({ worldbookId: "worldbook 1" });
    expect(worldbookResponse.status).toBe(200);
    expect(await worldbookResponse.text()).toBe('{"name":"Worldbook A"}');

    const regexResponse = await exportsResource.regex({ profileId: "regex 1" });
    expect(regexResponse.status).toBe(200);
    expect(await regexResponse.text()).toBe('[{"scriptName":"safe"}]');

    const characterResponse = await exportsResource.character({
      characterId: "character 1",
      versionId: "version 2",
    });
    expect(characterResponse.status).toBe(404);
    expect(await characterResponse.text()).toBe("missing");

    expect(String(fetchImpl.mock.calls[0]![0])).toBe("http://localhost:3000/export/preset/preset%201");
    expect(String(fetchImpl.mock.calls[1]![0])).toBe("http://localhost:3000/export/worldbook/worldbook%201");
    expect(String(fetchImpl.mock.calls[2]![0])).toBe("http://localhost:3000/export/regex/regex%201");
    expect(String(fetchImpl.mock.calls[3]![0])).toBe(
      "http://localhost:3000/export/character/character%201?version_id=version+2",
    );
  });

  it("lists and manages tool definitions and call records", async () => {
    const builtinPayload = {
      allowed_slots: ["narrator", "director"],
      description: "Builtin search tool",
      name: "search_web",
      parameters: { type: "object", properties: { q: { type: "string" } } },
      side_effect_level: "none",
      source: "builtin",
    };
    const definitionPayload = {
      allowed_slots: ["narrator"],
      created_at: 100,
      description: "Custom tool",
      enabled: true,
      handler: { code: "return 1;" },
      handler_type: "script",
      id: "tool-1",
      name: "lookup_notes",
      parameters: { type: "object", properties: { id: { type: "string" } } },
      side_effect_level: "sandbox",
      source: "custom",
      source_id: null,
      updated_at: 101,
    };
    const callRecordPayload = {
      args: { id: "note-1" },
      caller_slot: "narrator",
      created_at: 300,
      duration_ms: 22,
      id: "call-1",
      page_id: "page-1",
      result: { ok: true },
      seq: 1,
      status: "queued",
      tool_name: "lookup_notes",
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [null, builtinPayload] }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [null, definitionPayload],
            meta: {
              has_more: false,
              limit: 10,
              offset: 2,
              sort_by: "name",
              sort_order: "asc",
              total: 1,
            },
          }),
          {
            headers: { "content-type": "application/json" },
            status: 200,
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: definitionPayload }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: definitionPayload }), {
          headers: { "content-type": "application/json" },
          status: 201,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { ...definitionPayload, name: "lookup_archive", updated_at: 102 } }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: "tool-1", deleted: true } }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { ...definitionPayload, enabled: false, updated_at: 103 } }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [null, callRecordPayload],
            meta: {
              has_more: false,
              limit: 5,
              offset: 1,
              sort_by: "seq",
              sort_order: "desc",
              total: 1,
            },
          }),
          {
            headers: { "content-type": "application/json" },
            status: 200,
          },
        ),
      );

    const transport = createTransportClient({ baseUrl, fetchImpl });
    const tools = createToolsResource(transport);

    await expect(tools.listBuiltin({ accountId: "acc-1" })).resolves.toEqual([
      {
        allowedSlots: ["narrator", "director"],
        description: "Builtin search tool",
        name: "search_web",
        parameters: { type: "object", properties: { q: { type: "string" } } },
        sideEffectLevel: "none",
        source: "builtin",
      },
    ]);

    await expect(
      tools.listDefinitions({
        accountId: "acc-1",
        enabled: true,
        limit: 10,
        offset: 2,
        sortBy: "name",
        sortOrder: "asc",
        source: "custom",
        sourceId: "source-1",
      }),
    ).resolves.toEqual({
      definitions: [
        {
          allowedSlots: ["narrator"],
          createdAt: 100,
          description: "Custom tool",
          enabled: true,
          handler: { code: "return 1;" },
          handlerType: "script",
          id: "tool-1",
          name: "lookup_notes",
          parameters: { type: "object", properties: { id: { type: "string" } } },
          sideEffectLevel: "sandbox",
          source: "custom",
          sourceId: null,
          updatedAt: 101,
        },
      ],
      meta: {
        hasMore: false,
        limit: 10,
        offset: 2,
        sortBy: "name",
        sortOrder: "asc",
        total: 1,
      },
    });

    await expect(tools.getDefinition({ accountId: "acc-1", definitionId: "tool-1" })).resolves.toEqual({
      allowedSlots: ["narrator"],
      createdAt: 100,
      description: "Custom tool",
      enabled: true,
      handler: { code: "return 1;" },
      handlerType: "script",
      id: "tool-1",
      name: "lookup_notes",
      parameters: { type: "object", properties: { id: { type: "string" } } },
      sideEffectLevel: "sandbox",
      source: "custom",
      sourceId: null,
      updatedAt: 101,
    });

    await expect(
      tools.createDefinition({
        accountId: "acc-1",
        allowedSlots: ["narrator"],
        description: "Custom tool",
        enabled: true,
        handler: { code: "return 1;" },
        handlerType: "script",
        name: "lookup_notes",
        parameters: { type: "object", properties: { id: { type: "string" } } },
        sideEffectLevel: "sandbox",
        source: "custom",
      }),
    ).resolves.toEqual({
      allowedSlots: ["narrator"],
      createdAt: 100,
      description: "Custom tool",
      enabled: true,
      handler: { code: "return 1;" },
      handlerType: "script",
      id: "tool-1",
      name: "lookup_notes",
      parameters: { type: "object", properties: { id: { type: "string" } } },
      sideEffectLevel: "sandbox",
      source: "custom",
      sourceId: null,
      updatedAt: 101,
    });

    await expect(
      tools.updateDefinition({
        accountId: "acc-1",
        definitionId: "tool-1",
        name: "lookup_archive",
      }),
    ).resolves.toEqual({
      allowedSlots: ["narrator"],
      createdAt: 100,
      description: "Custom tool",
      enabled: true,
      handler: { code: "return 1;" },
      handlerType: "script",
      id: "tool-1",
      name: "lookup_archive",
      parameters: { type: "object", properties: { id: { type: "string" } } },
      sideEffectLevel: "sandbox",
      source: "custom",
      sourceId: null,
      updatedAt: 102,
    });

    await expect(tools.removeDefinition({ accountId: "acc-1", definitionId: "tool-1" })).resolves.toBe(true);

    await expect(
      tools.toggleDefinition({
        accountId: "acc-1",
        definitionId: "tool-1",
        enabled: false,
      }),
    ).resolves.toEqual({
      allowedSlots: ["narrator"],
      createdAt: 100,
      description: "Custom tool",
      enabled: false,
      handler: { code: "return 1;" },
      handlerType: "script",
      id: "tool-1",
      name: "lookup_notes",
      parameters: { type: "object", properties: { id: { type: "string" } } },
      sideEffectLevel: "sandbox",
      source: "custom",
      sourceId: null,
      updatedAt: 103,
    });

    await expect(
      tools.listCallRecords({
        accountId: "acc-1",
        callerSlot: "narrator",
        limit: 5,
        offset: 1,
        pageId: "page-1",
        sortBy: "seq",
        sortOrder: "desc",
        status: "queued",
      }),
    ).resolves.toEqual({
      meta: {
        hasMore: false,
        limit: 5,
        offset: 1,
        sortBy: "seq",
        sortOrder: "desc",
        total: 1,
      },
      records: [
        {
          args: { id: "note-1" },
          callerSlot: "narrator",
          createdAt: 300,
          durationMs: 22,
          id: "call-1",
          pageId: "page-1",
          result: { ok: true },
          seq: 1,
          status: "queued",
          toolName: "lookup_notes",
        },
      ],
    });

    expect(String(fetchImpl.mock.calls[0]![0])).toBe("http://localhost:3000/tools/builtin");
    expect(String(fetchImpl.mock.calls[1]![0])).toBe(
      "http://localhost:3000/tools/definitions?enabled=true&limit=10&offset=2&sort_by=name&sort_order=asc&source=custom&source_id=source-1",
    );
    expect(String(fetchImpl.mock.calls[2]![0])).toBe("http://localhost:3000/tools/definitions/tool-1");
    expect(String(fetchImpl.mock.calls[7]![0])).toBe(
      "http://localhost:3000/tools/call-records?caller_slot=narrator&limit=5&offset=1&page_id=page-1&sort_by=seq&sort_order=desc&status=queued",
    );

    const [, createInit] = fetchImpl.mock.calls[3]!;
    const [, updateInit] = fetchImpl.mock.calls[4]!;
    const [, toggleInit] = fetchImpl.mock.calls[6]!;
    const createHeaders = createInit?.headers as Headers;

    expect(createHeaders.get("x-account-id")).toBe("acc-1");
    expect(createInit?.body).toBe(
      JSON.stringify({
        allowed_slots: ["narrator"],
        description: "Custom tool",
        enabled: true,
        handler: { code: "return 1;" },
        handler_type: "script",
        name: "lookup_notes",
        parameters: { type: "object", properties: { id: { type: "string" } } },
        side_effect_level: "sandbox",
        source: "custom",
      }),
    );
    expect(updateInit?.body).toBe(JSON.stringify({ name: "lookup_archive" }));
    expect(toggleInit?.body).toBe(JSON.stringify({ enabled: false }));
  });

  it("lists tool executions from the primary execution audit routes", async () => {
    const executionPayload = {
      id: "exec-1",
      run_id: "run-1",
      floor_id: "floor-1",
      page_id: null,
      caller_slot: "narrator",
      provider_id: "builtin",
      provider_type: "builtin",
      tool_name: "set_variable",
      args: { key: "mood" },
      result: { ok: true },
      status: "success",
      lifecycle_state: "finished",
      commit_outcome: "committed",
      side_effect_level: "sandbox",
      error_message: null,
      delivery_mode: "inline",
      duration_ms: 7,
      started_at: 400,
      finished_at: 407,
      attempt_no: 1,
      runtime_job_id: null,
      replay_parent_execution_id: null,
      created_at: 400,
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        data: [executionPayload],
        meta: { has_more: false, limit: 10, offset: 0, sort_by: "started_at", sort_order: "desc", total: 1 },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: [{ ...executionPayload, id: "exec-2", provider_id: "mcp:demo", provider_type: "mcp", status: "uncertain", commit_outcome: "discarded" }],
        meta: { has_more: false, limit: 5, offset: 1, sort_by: "started_at", sort_order: "desc", total: 1 },
      }));
    const transport = createTransportClient({ baseUrl, fetchImpl });
    const tools = createToolsResource(transport);

    await expect(tools.listExecutions({ accountId: "acc-1", floorId: "floor-1", sortBy: "started_at", sortOrder: "desc" })).resolves.toEqual({
      meta: { hasMore: false, limit: 10, offset: 0, sortBy: "started_at", sortOrder: "desc", total: 1 },
      records: [{
        args: { key: "mood" },
        attemptNo: 1,
        callerSlot: "narrator",
        commitOutcome: "committed",
        createdAt: 400,
        durationMs: 7,
        errorMessage: null,
        finishedAt: 407,
        floorId: "floor-1",
        id: "exec-1",
        deliveryMode: "inline",
        lifecycleState: "finished",
        pageId: null,
        providerId: "builtin",
        providerType: "builtin",
        replayParentExecutionId: null,
        result: { ok: true },
        runId: "run-1",
        sideEffectLevel: "sandbox",
        startedAt: 400,
        status: "success",
        runtimeJobId: null,
        toolName: "set_variable",
      }],
    });

    await expect(tools.listExecutions({ accountId: "acc-1", sessionId: "session-1", status: "uncertain", sortBy: "started_at", sortOrder: "desc", limit: 5, offset: 1 })).resolves.toMatchObject({ records: [expect.objectContaining({ id: "exec-2", providerType: "mcp", status: "uncertain" })] });
    expect(String(fetchImpl.mock.calls[0]![0])).toBe("http://localhost:3000/floors/floor-1/tool-executions?sort_by=started_at&sort_order=desc");
    expect(String(fetchImpl.mock.calls[1]![0])).toBe("http://localhost:3000/tool-executions?limit=5&offset=1&session_id=session-1&sort_by=started_at&sort_order=desc&status=uncertain");
  });

  it("lists and manages mcp servers, statuses, tools, and tests", async () => {
    const serverPayload = {
      call_timeout_ms: 60000,
      connect_timeout_ms: 30000,
      created_at: 100,
      default_side_effect_level: "irreversible",
      enabled: true,
      http: null,
      id: "mcp-1",
      name: "Filesystem",
      stdio: {
        args: ["server.js"],
        command: "node",
        cwd: "/srv/mcp",
        env_masked: { NODE_ENV: "prod****tion" },
      },
      tool_prefix: "fs",
      tool_refresh_interval_ms: 300000,
      transport: "stdio",
      updated_at: 101,
    };
    const statusPayload = {
      connected_at: 200,
      error: null,
      last_timeout_at: null,
      reconnect_required: false,
      server_id: "mcp-1",
      server_name: "Filesystem",
      state: "connected",
      tool_count: 3,
      tools_refreshed_at: 201,
      transport: "stdio",
    };
    const disconnectedStatusPayload = {
      connected_at: null,
      error: null,
      last_timeout_at: null,
      reconnect_required: false,
      server_id: "mcp-1",
      server_name: "Filesystem",
      state: "disconnected",
      tool_count: 0,
      tools_refreshed_at: null,
      transport: "stdio",
    };
    const toolPayload = {
      description: "Read a file",
      name: "fs_read",
      parameters: { type: "object", properties: { path: { type: "string" } } },
      side_effect_level: "none",
      source: "mcp",
    };
    const testPayload = {
      duration_ms: 88,
      error: null,
      success: true,
      tool_count: 3,
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [null, serverPayload],
            meta: {
              has_more: false,
              limit: 20,
              offset: 1,
              sort_by: "name",
              sort_order: "asc",
              total: 1,
            },
          }),
          {
            headers: { "content-type": "application/json" },
            status: 200,
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: serverPayload }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: serverPayload }), {
          headers: { "content-type": "application/json" },
          status: 201,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { ...serverPayload, name: "Filesystem V2", updated_at: 102 } }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { deleted: true } }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { ...serverPayload, enabled: false, updated_at: 103 } }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: statusPayload }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [statusPayload] }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: statusPayload }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: disconnectedStatusPayload }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [null, toolPayload] }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: testPayload }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      );

    const transport = createTransportClient({ baseUrl, fetchImpl });
    const mcp = createMcpResource(transport);

    await expect(
      mcp.listServers({
        accountId: "acc-1",
        enabled: true,
        limit: 20,
        offset: 1,
        sortBy: "name",
        sortOrder: "asc",
      }),
    ).resolves.toEqual({
      meta: {
        hasMore: false,
        limit: 20,
        offset: 1,
        sortBy: "name",
        sortOrder: "asc",
        total: 1,
      },
      servers: [
        {
          callTimeoutMs: 60000,
          connectTimeoutMs: 30000,
          createdAt: 100,
          defaultSideEffectLevel: "irreversible",
          enabled: true,
          http: null,
          id: "mcp-1",
          name: "Filesystem",
          stdio: {
            args: ["server.js"],
            command: "node",
            cwd: "/srv/mcp",
            envMasked: { NODE_ENV: "prod****tion" },
          },
          toolPrefix: "fs",
          toolRefreshIntervalMs: 300000,
          transport: "stdio",
          updatedAt: 101,
        },
      ],
    });

    await expect(mcp.getServer({ accountId: "acc-1", serverId: "mcp-1" })).resolves.toEqual({
      callTimeoutMs: 60000,
      connectTimeoutMs: 30000,
      createdAt: 100,
      defaultSideEffectLevel: "irreversible",
      enabled: true,
      http: null,
      id: "mcp-1",
      name: "Filesystem",
      stdio: {
        args: ["server.js"],
        command: "node",
        cwd: "/srv/mcp",
        envMasked: { NODE_ENV: "prod****tion" },
      },
      toolPrefix: "fs",
      toolRefreshIntervalMs: 300000,
      transport: "stdio",
      updatedAt: 101,
    });

    await expect(
      mcp.createServer({
        accountId: "acc-1",
        name: "Filesystem",
        stdio: {
          args: ["server.js"],
          command: "node",
          cwd: "/srv/mcp",
          env: { NODE_ENV: "production" },
        },
        toolPrefix: "fs",
        transport: "stdio",
      }),
    ).resolves.toEqual({
      callTimeoutMs: 60000,
      connectTimeoutMs: 30000,
      createdAt: 100,
      defaultSideEffectLevel: "irreversible",
      enabled: true,
      http: null,
      id: "mcp-1",
      name: "Filesystem",
      stdio: {
        args: ["server.js"],
        command: "node",
        cwd: "/srv/mcp",
        envMasked: { NODE_ENV: "prod****tion" },
      },
      toolPrefix: "fs",
      toolRefreshIntervalMs: 300000,
      transport: "stdio",
      updatedAt: 101,
    });

    await expect(
      mcp.updateServer({
        accountId: "acc-1",
        name: "Filesystem V2",
        serverId: "mcp-1",
      }),
    ).resolves.toEqual({
      callTimeoutMs: 60000,
      connectTimeoutMs: 30000,
      createdAt: 100,
      defaultSideEffectLevel: "irreversible",
      enabled: true,
      http: null,
      id: "mcp-1",
      name: "Filesystem V2",
      stdio: {
        args: ["server.js"],
        command: "node",
        cwd: "/srv/mcp",
        envMasked: { NODE_ENV: "prod****tion" },
      },
      toolPrefix: "fs",
      toolRefreshIntervalMs: 300000,
      transport: "stdio",
      updatedAt: 102,
    });

    await expect(mcp.removeServer({ accountId: "acc-1", serverId: "mcp-1" })).resolves.toBe(true);

    await expect(
      mcp.toggleServer({
        accountId: "acc-1",
        enabled: false,
        serverId: "mcp-1",
      }),
    ).resolves.toEqual({
      callTimeoutMs: 60000,
      connectTimeoutMs: 30000,
      createdAt: 100,
      defaultSideEffectLevel: "irreversible",
      enabled: false,
      http: null,
      id: "mcp-1",
      name: "Filesystem",
      stdio: {
        args: ["server.js"],
        command: "node",
        cwd: "/srv/mcp",
        envMasked: { NODE_ENV: "prod****tion" },
      },
      toolPrefix: "fs",
      toolRefreshIntervalMs: 300000,
      transport: "stdio",
      updatedAt: 103,
    });

    await expect(mcp.getServerStatus({ accountId: "acc-1", serverId: "mcp-1" })).resolves.toEqual({
      connectedAt: 200,
      error: null,
      lastTimeoutAt: null,
      reconnectRequired: false,
      serverId: "mcp-1",
      serverName: "Filesystem",
      state: "connected",
      toolCount: 3,
      toolsRefreshedAt: 201,
      transport: "stdio",
    });

    await expect(mcp.listStatuses({ accountId: "acc-1" })).resolves.toEqual([
      {
        connectedAt: 200,
        error: null,
        lastTimeoutAt: null,
        reconnectRequired: false,
        serverId: "mcp-1",
        serverName: "Filesystem",
        state: "connected",
        toolCount: 3,
        toolsRefreshedAt: 201,
        transport: "stdio",
      },
    ]);

    await expect(mcp.connectServer({ accountId: "acc-1", serverId: "mcp-1" })).resolves.toEqual({
      connectedAt: 200,
      error: null,
      lastTimeoutAt: null,
      reconnectRequired: false,
      serverId: "mcp-1",
      serverName: "Filesystem",
      state: "connected",
      toolCount: 3,
      toolsRefreshedAt: 201,
      transport: "stdio",
    });

    await expect(mcp.disconnectServer({ accountId: "acc-1", serverId: "mcp-1" })).resolves.toEqual({
      connectedAt: null,
      error: null,
      lastTimeoutAt: null,
      reconnectRequired: false,
      serverId: "mcp-1",
      serverName: "Filesystem",
      state: "disconnected",
      toolCount: 0,
      toolsRefreshedAt: null,
      transport: "stdio",
    });

    await expect(mcp.listServerTools({ accountId: "acc-1", serverId: "mcp-1" })).resolves.toEqual([
      {
        description: "Read a file",
        name: "fs_read",
        parameters: { type: "object", properties: { path: { type: "string" } } },
        sideEffectLevel: "none",
        source: "mcp",
      },
    ]);

    await expect(mcp.testServer({ accountId: "acc-1", serverId: "mcp-1" })).resolves.toEqual({
      durationMs: 88,
      error: null,
      success: true,
      toolCount: 3,
    });

    expect(String(fetchImpl.mock.calls[0]![0])).toBe(
      "http://localhost:3000/mcp/servers?enabled=true&limit=20&offset=1&sort_by=name&sort_order=asc",
    );
    expect(String(fetchImpl.mock.calls[1]![0])).toBe("http://localhost:3000/mcp/servers/mcp-1");
    expect(String(fetchImpl.mock.calls[6]![0])).toBe("http://localhost:3000/mcp/servers/mcp-1/status");
    expect(String(fetchImpl.mock.calls[7]![0])).toBe("http://localhost:3000/mcp/statuses");
    expect(String(fetchImpl.mock.calls[8]![0])).toBe("http://localhost:3000/mcp/servers/mcp-1/connect");
    expect(String(fetchImpl.mock.calls[9]![0])).toBe("http://localhost:3000/mcp/servers/mcp-1/disconnect");
    expect(String(fetchImpl.mock.calls[10]![0])).toBe("http://localhost:3000/mcp/servers/mcp-1/tools");
    expect(String(fetchImpl.mock.calls[11]![0])).toBe("http://localhost:3000/mcp/servers/mcp-1/test");

    const [, createInit] = fetchImpl.mock.calls[2]!;
    const [, updateInit] = fetchImpl.mock.calls[3]!;
    const [, toggleInit] = fetchImpl.mock.calls[5]!;
    const createHeaders = createInit?.headers as Headers;

    expect(createHeaders.get("x-account-id")).toBe("acc-1");
    expect(createInit?.body).toBe(
      JSON.stringify({
        name: "Filesystem",
        stdio: {
          args: ["server.js"],
          command: "node",
          cwd: "/srv/mcp",
          env: { NODE_ENV: "production" },
        },
        tool_prefix: "fs",
        transport: "stdio",
      }),
    );
    expect(updateInit?.body).toBe(JSON.stringify({ name: "Filesystem V2" }));
    expect(toggleInit?.body).toBe(JSON.stringify({ enabled: false }));
  });

  it("maps reconnect-required MCP status metadata", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          connected_at: null,
          error: "Tool call timeout after 30000ms; execution outcome is uncertain; reconnect required",
          last_timeout_at: 987654,
          reconnect_required: true,
          server_id: "mcp-9",
          server_name: "Timeout Server",
          state: "reconnect_required",
          tool_count: 0,
          tools_refreshed_at: null,
          transport: "http",
        },
      }),
    );
    const transport = createTransportClient({ baseUrl, fetchImpl });
    const mcp = createMcpResource(transport);

    await expect(mcp.getServerStatus({ serverId: "mcp-9" })).resolves.toEqual({
      connectedAt: null, error: "Tool call timeout after 30000ms; execution outcome is uncertain; reconnect required", lastTimeoutAt: 987654, reconnectRequired: true, serverId: "mcp-9", serverName: "Timeout Server", state: "reconnect_required", toolCount: 0, toolsRefreshedAt: null, transport: "http",
    });
  });
});
