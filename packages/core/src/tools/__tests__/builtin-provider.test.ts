import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BuiltinToolProvider } from '../builtin-provider.js';
import type { ToolExecutionContext } from '../types.js';
import type { VariableStore } from '../../variables/variable-store.js';
import type { MemoryStore } from '../../memory/memory-store.js';

// ── Mock 工具 ─────────────────────────────────────────

function makeContext(overrides?: Partial<ToolExecutionContext>): ToolExecutionContext {
  return {
    sessionId: 'session-1',
    floorId: 'floor-1',
    pageId: 'page-1',
    callerSlot: 'narrator',
    variableContext: {
      sessionId: 'session-1',
      floorId: 'floor-1',
      pageId: 'page-1',
      globalScopeId: 'global',
    },
    ...overrides,
  };
}

function makeMockVariableStore(): VariableStore {
  return {
    get: vi.fn(async () => undefined),
    set: vi.fn(async (_key: string, _value: unknown) => ({
      id: 'v-1',
      scope: 'page' as const,
      scopeId: 'page-1',
      key: _key,
      value: _value,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })),
  } as any;
}

function makeMockMemoryStore(): MemoryStore {
  return {
    query: vi.fn(async () => [
      {
        id: 'm-1',
        type: 'fact',
        content: 'The hero has 50 HP',
        importance: 0.8,
        scope: 'chat',
        scopeId: 'session-1',
        confidence: 0.9,
        status: 'active',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]),
  } as any;
}

// ── Tests ──────────────────────────────────────────

describe('BuiltinToolProvider', () => {
  describe('listTools', () => {
    it('返回 7 个内置工具', async () => {
      const provider = new BuiltinToolProvider();
      const tools = await provider.listTools();

      expect(tools).toHaveLength(7);
      const names = tools.map((t) => t.name);
      expect(names).toContain('get_variable');
      expect(names).toContain('set_variable');
      expect(names).toContain('roll_dice');
      expect(names).toContain('random_choice');
      expect(names).toContain('get_time');
      expect(names).toContain('query_memory');
      expect(names).toContain('get_character_info');
    });

    it('所有工具的 source 都是 builtin', async () => {
      const provider = new BuiltinToolProvider();
      const tools = await provider.listTools();
      for (const tool of tools) {
        expect(tool.source).toBe('builtin');
      }
    });

    it('所有工具的 allowedSlots 为空数组（所有槽位可用）', async () => {
      const provider = new BuiltinToolProvider();
      const tools = await provider.listTools();
      for (const tool of tools) {
        expect(tool.allowedSlots).toEqual([]);
      }
    });
  });

  describe('roll_dice', () => {
    it('默认掷一个六面骰', async () => {
      const provider = new BuiltinToolProvider();
      const result = await provider.executeTool('roll_dice', {}, makeContext());

      expect(result.data).toBeDefined();
      const data = result.data as any;
      expect(data.sides).toBe(6);
      expect(data.count).toBe(1);
      expect(data.results).toHaveLength(1);
      expect(data.results[0]).toBeGreaterThanOrEqual(1);
      expect(data.results[0]).toBeLessThanOrEqual(6);
      expect(data.total).toBe(data.results[0]);
    });

    it('指定面数和数量', async () => {
      const provider = new BuiltinToolProvider();
      const result = await provider.executeTool('roll_dice', { sides: 20, count: 3 }, makeContext());

      const data = result.data as any;
      expect(data.sides).toBe(20);
      expect(data.count).toBe(3);
      expect(data.results).toHaveLength(3);
      for (const r of data.results) {
        expect(r).toBeGreaterThanOrEqual(1);
        expect(r).toBeLessThanOrEqual(20);
      }
      expect(data.total).toBe(data.results.reduce((a: number, b: number) => a + b, 0));
    });

    it('count 上限 100', async () => {
      const provider = new BuiltinToolProvider();
      const result = await provider.executeTool('roll_dice', { sides: 6, count: 200 }, makeContext());

      const data = result.data as any;
      expect(data.count).toBe(100);
      expect(data.results).toHaveLength(100);
    });
  });

  describe('random_choice', () => {
    it('从选项中随机选一个', async () => {
      const provider = new BuiltinToolProvider();
      const options = ['sword', 'shield', 'potion'];
      const result = await provider.executeTool('random_choice', { options }, makeContext());

      const data = result.data as any;
      expect(options).toContain(data.chosen);
      expect(data.index).toBeGreaterThanOrEqual(0);
      expect(data.index).toBeLessThan(3);
    });

    it('空数组返回错误', async () => {
      const provider = new BuiltinToolProvider();
      const result = await provider.executeTool('random_choice', { options: [] }, makeContext());

      expect(result.error).toBeDefined();
      expect(result.error).toContain('non-empty');
    });

    it('非数组返回错误', async () => {
      const provider = new BuiltinToolProvider();
      const result = await provider.executeTool('random_choice', { options: 'not_array' }, makeContext());

      expect(result.error).toBeDefined();
    });
  });

  describe('get_time', () => {
    it('返回时间信息', async () => {
      const provider = new BuiltinToolProvider();
      const result = await provider.executeTool('get_time', {}, makeContext());

      const data = result.data as any;
      expect(data.iso).toBeDefined();
      expect(data.unix).toBeTypeOf('number');
      expect(data.readable).toBeTypeOf('string');
    });
  });

  describe('get_variable', () => {
    it('调用 variableStore.get', async () => {
      const vs = makeMockVariableStore();
      (vs.get as any).mockResolvedValue('test_value');

      const provider = new BuiltinToolProvider({ variableStore: vs });
      const result = await provider.executeTool('get_variable', { key: 'hp' }, makeContext());

      expect(result.data).toEqual({ key: 'hp', value: 'test_value' });
      expect(vs.get).toHaveBeenCalledWith('hp', expect.any(Object));
    });

    it('变量不存在时返回 null', async () => {
      const vs = makeMockVariableStore();
      const provider = new BuiltinToolProvider({ variableStore: vs });
      const result = await provider.executeTool('get_variable', { key: 'missing' }, makeContext());

      const data = result.data as any;
      expect(data.value).toBeNull();
    });

    it('未提供 VariableStore 时返回错误', async () => {
      const provider = new BuiltinToolProvider();
      const result = await provider.executeTool('get_variable', { key: 'hp' }, makeContext());

      expect(result.error).toContain('VariableStore not available');
    });

    it('缺少 key 参数返回错误', async () => {
      const vs = makeMockVariableStore();
      const provider = new BuiltinToolProvider({ variableStore: vs });
      const result = await provider.executeTool('get_variable', { key: '' }, makeContext());

      expect(result.error).toContain('Missing required parameter');
    });
  });

  describe('set_variable', () => {
    it('调用 variableStore.set', async () => {
      const vs = makeMockVariableStore();
      const provider = new BuiltinToolProvider({ variableStore: vs });
      const result = await provider.executeTool('set_variable', { key: 'hp', value: '100' }, makeContext());

      const data = result.data as any;
      expect(data.key).toBe('hp');
      expect(data.value).toBe('100');
      expect(vs.set).toHaveBeenCalledWith('hp', '100', expect.any(Object));
    });

    it('未提供 VariableStore 时返回错误', async () => {
      const provider = new BuiltinToolProvider();
      const result = await provider.executeTool('set_variable', { key: 'hp', value: '1' }, makeContext());

      expect(result.error).toContain('VariableStore not available');
    });
  });

  describe('query_memory', () => {
    it('调用 memoryStore.query 并返回结果', async () => {
      const ms = makeMockMemoryStore();
      const provider = new BuiltinToolProvider({ memoryStore: ms });
      const result = await provider.executeTool('query_memory', { limit: 5 }, makeContext());

      const data = result.data as any;
      expect(data.count).toBe(1);
      expect(data.items).toHaveLength(1);
      expect(data.items[0].content).toBe('The hero has 50 HP');
      expect(ms.query).toHaveBeenCalledWith(expect.objectContaining({ limit: 5 }));
    });

    it('未提供 MemoryStore 时返回错误', async () => {
      const provider = new BuiltinToolProvider();
      const result = await provider.executeTool('query_memory', {}, makeContext());

      expect(result.error).toContain('MemoryStore not available');
    });

    it('limit 最大 50', async () => {
      const ms = makeMockMemoryStore();
      const provider = new BuiltinToolProvider({ memoryStore: ms });
      await provider.executeTool('query_memory', { limit: 200 }, makeContext());

      expect(ms.query).toHaveBeenCalledWith(expect.objectContaining({ limit: 50 }));
    });
  });

  describe('get_character_info', () => {
    it('返回 session 信息', async () => {
      const provider = new BuiltinToolProvider();
      const result = await provider.executeTool('get_character_info', {}, makeContext());

      const data = result.data as any;
      expect(data.sessionId).toBe('session-1');
    });

    it('指定 field 返回对应字段', async () => {
      const provider = new BuiltinToolProvider();
      const result = await provider.executeTool('get_character_info', { field: 'sessionId' }, makeContext());

      const data = result.data as any;
      expect(data.sessionId).toBe('session-1');
    });
  });

  describe('executeTool - unknown tool', () => {
    it('未知工具抛出错误', async () => {
      const provider = new BuiltinToolProvider();

      await expect(
        provider.executeTool('non_existent', {}, makeContext()),
      ).rejects.toThrow('Unknown builtin tool');
    });
  });
});
