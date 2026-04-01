import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ToolExecutionContext } from '@tavern/core';
import { McpToolProvider } from '../mcp-tool-provider.js';
import { McpConnectionManager } from '../mcp-connection-manager.js';
import type { McpServerConfig, McpConnectionState } from '../types.js';
import { ToolRuntimePolicy } from '../../services/tool-runtime-policy.js';

// ── Mock McpConnection ────────────────────────────

function createMockConnection(overrides: {
  state?: McpConnectionState;
  tools?: Array<{ name: string; description: string }>;
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
        parameters: { type: 'object' as const, properties: {}, required: [] },
        sideEffectLevel: 'irreversible' as const,
        allowedSlots: [],
        source: 'mcp' as const,
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
          deferredMcpTools: ['mcp-1/github_create_issue'],
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
