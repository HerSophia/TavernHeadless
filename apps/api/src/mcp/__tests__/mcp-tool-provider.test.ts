import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ToolDefinition, ToolExecutionContext } from '@tavern/core';
import { McpToolProvider } from '../mcp-tool-provider.js';
import { McpConnectionManager } from '../mcp-connection-manager.js';
import type { McpServerConfig, McpConnectionState } from '../types.js';
import { ToolRuntimePolicy } from '../../services/tool-runtime-policy.js';
import { InMemoryMcpToolCatalogSnapshotStore } from '../mcp-tool-catalog-snapshot-store.js';

// ── Mock McpConnection ────────────────────────────

function createMockConnection(overrides: {
  state?: McpConnectionState;
  tools?: Array<Partial<ToolDefinition> & Pick<ToolDefinition, 'name' | 'description'>>;
  callResult?: { data?: unknown; error?: string };
} = {}) {
  const { state = 'connected', tools = [], callResult = { data: 'ok' } } = overrides;

  return {
    config: {} as McpServerConfig,
    state,
    toolCount: tools.length,
    connectedAt: Date.now(),
    toolsRefreshedAt: Date.now(),
    error: state === 'error' ? 'test error' : undefined,
    getTools: vi.fn().mockReturnValue(
      tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters ?? { type: 'object' as const, properties: {}, required: [] },
        sideEffectLevel: t.sideEffectLevel ?? 'irreversible',
        allowedSlots: t.allowedSlots ?? [],
        source: t.source ?? 'mcp',
        asyncCapability: t.asyncCapability,
        defaultDeliveryMode: t.defaultDeliveryMode,
        resultVisibility: t.resultVisibility,
      })),
    ),
    callTool: vi.fn().mockResolvedValue(callResult),
    connect: vi.fn(),
    disconnect: vi.fn(),
    refreshTools: vi.fn(),
  };
}

function makeConfig(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: 'test-mcp',
    name: 'Test MCP',
    transport: 'stdio',
    enabled: true,
    connectTimeoutMs: 30000,
    callTimeoutMs: 60000,
    toolRefreshIntervalMs: 300000,
    defaultSideEffectLevel: 'irreversible',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeContext(): ToolExecutionContext {
  return {
    sessionId: 'sess-1',
    floorId: 'floor-1',
    pageId: 'page-1',
    callerSlot: 'narrator',
    variableContext: {
      sessionId: 'sess-1',
      floorId: 'floor-1',
      pageId: 'page-1',
    },
  };
}

describe('McpToolProvider', () => {
  let manager: McpConnectionManager;

  beforeEach(() => {
    manager = new McpConnectionManager();
  });

  describe('listTools', () => {
    it('连接可用时返回工具列表', async () => {
      const config = makeConfig();
      const mockConn = createMockConnection({
        tools: [
          { name: 'get_data', description: 'Get data' },
          { name: 'set_data', description: 'Set data' },
        ],
      });

      // mock getConnection
      vi.spyOn(manager, 'getConnection').mockResolvedValue(mockConn as any);

      const provider = new McpToolProvider(config, manager);
      const tools = await provider.listTools();

      expect(tools).toHaveLength(2);
      expect(tools[0]!.name).toBe('get_data');
      expect(tools[0]!.source).toBe('mcp');
    });

    it('连接不可用时返回空数组', async () => {
      const config = makeConfig();
      const mockConn = createMockConnection({ state: 'error' });

      vi.spyOn(manager, 'getConnection').mockResolvedValue(mockConn as any);

      const provider = new McpToolProvider(config, manager);
      const tools = await provider.listTools();

      expect(tools).toHaveLength(0);
    });

    it('getConnection 返回 null 时返回空数组', async () => {
      const config = makeConfig();
      vi.spyOn(manager, 'getConnection').mockResolvedValue(null);

      const provider = new McpToolProvider(config, manager);
      const tools = await provider.listTools();

      expect(tools).toHaveLength(0);
    });

    it('getConnection 抛异常时返回空数组', async () => {
      const config = makeConfig();
      vi.spyOn(manager, 'getConnection').mockRejectedValue(new Error('fail'));

      const provider = new McpToolProvider(config, manager);
      const tools = await provider.listTools();

      expect(tools).toHaveLength(0);
    });

    it('按 runtime policy 为显式允许的 MCP 工具标注 deferred async metadata', async () => {
      const config = makeConfig({ id: 'mcp-1' });
      const mockConn = createMockConnection({
        tools: [
          { name: 'github_create_issue', description: 'Create an issue' },
        ],
      });

      vi.spyOn(manager, 'getConnection').mockResolvedValue(mockConn as any);

      const provider = new McpToolProvider(config, manager, {
        toolRuntimePolicy: new ToolRuntimePolicy({
          enableDeferredIrreversibleTools: true,
          deferredToolAllowlist: ['mcp-1/github_create_issue'],
        }),
      });
      const [tool] = await provider.listTools();

      expect(tool).toMatchObject({
        asyncCapability: 'deferred_ok',
        defaultDeliveryMode: 'async_job',
        resultVisibility: 'deferred_receipt',
      });
      expect(tool?.description).toContain('acceptance receipt');
    });

    it('applies local metadata overrides and keeps explicit basis details', async () => {
      const config = makeConfig({
        defaultSideEffectLevel: 'none',
        metadataOverrides: [{
          toolName: 'get_data',
          sideEffectLevel: 'sandbox',
          allowedSlots: ['narrator'],
          parameterSchema: {
            type: 'object',
            properties: {
              query: { type: 'string' },
            },
            required: ['query'],
          },
          replaySafety: 'never_auto_replay',
        }],
      });
      const mockConn = createMockConnection({
        tools: [{ name: 'get_data', description: 'Get data', sideEffectLevel: 'none' }],
      });

      vi.spyOn(manager, 'getConnection').mockResolvedValue(mockConn as any);

      const provider = new McpToolProvider(config, manager);
      const catalog = await provider.listToolsWithMetadata();

      expect(catalog.tools).toEqual([
        expect.objectContaining({
          tool: expect.objectContaining({
            name: 'get_data',
            sideEffectLevel: 'sandbox',
            allowedSlots: ['narrator'],
            parameters: expect.objectContaining({
              required: ['query'],
            }),
          }),
          sideEffectLevelBasis: 'account_override',
          allowedSlotsBasis: 'account_override',
          parameterSchemaBasis: 'account_override',
          replaySafety: 'never_auto_replay',
          replaySafetyBasis: 'account_override',
          metadataBasisDetail: {
            sideEffectLevel: { basis: 'account_override', scope: 'tool' },
            allowedSlots: { basis: 'account_override', scope: 'tool' },
            parameterSchema: { basis: 'account_override', scope: 'local' },
            replaySafety: { basis: 'account_override', scope: 'local' },
          },
        }),
      ]);
    });

    it('live listing returns live metadata and refreshes the snapshot store', async () => {
      const config = makeConfig();
      const snapshotStore = new InMemoryMcpToolCatalogSnapshotStore();
      const mockConn = createMockConnection({
        tools: [{ name: 'get_data', description: 'Get data' }],
      });

      vi.spyOn(manager, 'getConnection').mockResolvedValue(mockConn as any);

      const provider = new McpToolProvider(config, manager, { snapshotStore });
      const catalog = await provider.listToolsWithMetadata();
      const snapshot = await snapshotStore.get(provider.id);

      expect(catalog.source).toBe('live');
      expect(catalog.tools.map((entry) => entry.tool.name)).toEqual(['get_data']);
      expect(snapshot?.providerKey).toBe(provider.id);
      expect(snapshot?.tools.map((entry) => entry.tool.name)).toEqual(['get_data']);
    });

    it('falls back to cached tools when live listing fails', async () => {
      const config = makeConfig();
      const snapshotStore = new InMemoryMcpToolCatalogSnapshotStore();
      const liveConnection = createMockConnection({
        tools: [{ name: 'get_data', description: 'Get data' }],
      });

      vi.spyOn(manager, 'getConnection')
        .mockResolvedValueOnce(liveConnection as any)
        .mockRejectedValueOnce(new Error('boom'));

      const provider = new McpToolProvider(config, manager, { snapshotStore });
      const liveCatalog = await provider.listToolsWithMetadata();
      const cachedCatalog = await provider.listToolsWithMetadata();

      expect(liveCatalog.source).toBe('live');
      expect(cachedCatalog.source).toBe('cached');
      expect(cachedCatalog.tools.map((entry) => entry.tool.name)).toEqual(['get_data']);
    });

    it('returns unavailable catalog when live listing fails and there is no snapshot', async () => {
      const config = makeConfig();
      const snapshotStore = new InMemoryMcpToolCatalogSnapshotStore();

      vi.spyOn(manager, 'getConnection').mockRejectedValue(new Error('boom'));

      const provider = new McpToolProvider(config, manager, { snapshotStore });
      const catalog = await provider.listToolsWithMetadata();

      expect(catalog.source).toBe('unavailable');
      expect(catalog.tools).toEqual([]);
    });
  });

  describe('executeTool', () => {
    it('正常调用工具并返回结果', async () => {
      const config = makeConfig();
      const mockConn = createMockConnection({ callResult: { data: { count: 42 } } });

      vi.spyOn(manager, 'getConnection').mockResolvedValue(mockConn as any);

      const provider = new McpToolProvider(config, manager);
      const result = await provider.executeTool('some_tool', { q: 'test' }, makeContext());

      expect(result.data).toEqual({ count: 42 });
      expect(result.error).toBeUndefined();
      expect(mockConn.callTool).toHaveBeenCalledWith('some_tool', { q: 'test' });
    });

    it('带 toolPrefix 时去除前缀后调用', async () => {
      const config = makeConfig({ toolPrefix: 'gh_' });
      const mockConn = createMockConnection();

      vi.spyOn(manager, 'getConnection').mockResolvedValue(mockConn as any);

      const provider = new McpToolProvider(config, manager);
      await provider.executeTool('gh_list_repos', {}, makeContext());

      // 应该用去除前缀后的名称调用
      expect(mockConn.callTool).toHaveBeenCalledWith('list_repos', {});
    });

    it('工具名不匹配前缀时原样传递', async () => {
      const config = makeConfig({ toolPrefix: 'gh_' });
      const mockConn = createMockConnection();

      vi.spyOn(manager, 'getConnection').mockResolvedValue(mockConn as any);

      const provider = new McpToolProvider(config, manager);
      await provider.executeTool('other_tool', {}, makeContext());

      expect(mockConn.callTool).toHaveBeenCalledWith('other_tool', {});
    });

    it('MCP 服务器返回错误时转为 error', async () => {
      const config = makeConfig();
      const mockConn = createMockConnection({ callResult: { error: 'tool failed' } });

      vi.spyOn(manager, 'getConnection').mockResolvedValue(mockConn as any);

      const provider = new McpToolProvider(config, manager);
      const result = await provider.executeTool('tool', {}, makeContext());

      expect(result.error).toBe('tool failed');
      expect(result.data).toBeUndefined();
    });

    it('连接不可用时返回 error', async () => {
      const config = makeConfig();
      vi.spyOn(manager, 'getConnection').mockResolvedValue(null);

      const provider = new McpToolProvider(config, manager);
      const result = await provider.executeTool('tool', {}, makeContext());

      expect(result.error).toContain('not connected');
    });

    it('异常时返回 error 而不抛出', async () => {
      const config = makeConfig();
      vi.spyOn(manager, 'getConnection').mockRejectedValue(new Error('boom'));

      const provider = new McpToolProvider(config, manager);
      const result = await provider.executeTool('tool', {}, makeContext());

      expect(result.error).toBe('boom');
    });

    it('连接不可用时附带结构化 executionReasonCode', async () => {
      const config = makeConfig();
      vi.spyOn(manager, 'getConnection').mockResolvedValue(null);

      const provider = new McpToolProvider(config, manager);
      const result = await provider.executeTool('tool', {}, makeContext());

      expect(result.executionStatus).toBe('error');
      expect(result.executionReasonCode).toBe('mcp_not_connected');
    });

    it('底层显式 executionStatus 优先透传，不被字符串推断覆盖', async () => {
      const config = makeConfig();
      const mockConn = createMockConnection();
      mockConn.callTool = vi.fn().mockResolvedValue({
        error: 'local timeout reported as uncertain',
        executionStatus: 'uncertain',
        executionReasonCode: 'mcp_call_timeout_uncertain',
        reconnectRequired: true,
        providerMessage: 'local timeout while awaiting MCP response',
      });

      vi.spyOn(manager, 'getConnection').mockResolvedValue(mockConn as any);

      const provider = new McpToolProvider(config, manager);
      const result = await provider.executeTool('slow', {}, makeContext());

      expect(result.executionStatus).toBe('uncertain');
      expect(result.executionReasonCode).toBe('mcp_call_timeout_uncertain');
      expect(result.reconnectRequired).toBe(true);
      expect(result.providerMessage).toBe('local timeout while awaiting MCP response');
    });

    it('provider 执行异常时返回 mcp_provider_error 原因码', async () => {
      const config = makeConfig();
      vi.spyOn(manager, 'getConnection').mockRejectedValue(new Error('boom'));

      const provider = new McpToolProvider(config, manager);
      const result = await provider.executeTool('tool', {}, makeContext());

      expect(result.error).toBe('boom');
      expect(result.executionReasonCode).toBe('mcp_provider_error');
    });
  });

  describe('id and type', () => {
    it('id 格式为 mcp:{serverId}', () => {
      const config = makeConfig({ id: 'my-server' });
      const provider = new McpToolProvider(config, manager);

      expect(provider.id).toBe('mcp:my-server');
      expect(provider.type).toBe('mcp');
    });
  });
});
