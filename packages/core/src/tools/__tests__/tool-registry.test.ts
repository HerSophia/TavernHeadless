import { describe, it, expect, vi } from 'vitest';
import { ToolRegistry } from '../tool-registry.js';
import type {
  ToolDefinition,
  ToolProvider,
  ToolPermissions,
  ToolCallResult,
  ToolExecutionContext,
} from '../types.js';
import type { InstanceSlot } from '../../llm/types.js';

// ── Helpers ─────────────────────────────────────────

function makeTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name: 'test_tool',
    description: 'A test tool',
    parameters: { type: 'object', properties: {} },
    sideEffectLevel: 'none',
    allowedSlots: [],
    source: 'builtin',
    ...overrides,
  };
}

function makeProvider(
  id: string,
  tools: ToolDefinition[],
): ToolProvider {
  return {
    id,
    type: 'builtin',
    listTools: vi.fn(async () => tools),
    executeTool: vi.fn(async () => ({ data: 'ok' })),
  };
}

function makePermissions(overrides: Partial<ToolPermissions> = {}): ToolPermissions {
  return {
    enabled: true,
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────

describe('ToolRegistry', () => {
  describe('register / unregister', () => {
    it('注册和取消注册 provider', () => {
      const registry = new ToolRegistry();
      const provider = makeProvider('p1', []);

      registry.register(provider);
      expect(registry.getProvider('p1')).toBe(provider);
      expect(registry.getAllProviders()).toHaveLength(1);

      const removed = registry.unregister('p1');
      expect(removed).toBe(true);
      expect(registry.getProvider('p1')).toBeUndefined();
      expect(registry.getAllProviders()).toHaveLength(0);
    });

    it('重复注册同一 ID 抛错', () => {
      const registry = new ToolRegistry();
      const p1 = makeProvider('p1', []);
      registry.register(p1);

      expect(() => registry.register(p1)).toThrow("ToolProvider 'p1' is already registered");
    });

    it('取消不存在的 provider 返回 false', () => {
      const registry = new ToolRegistry();
      expect(registry.unregister('nonexistent')).toBe(false);
    });
  });

  describe('listAll', () => {
    it('汇总多个 provider 的工具', async () => {
      const registry = new ToolRegistry();
      const t1 = makeTool({ name: 'tool_a' });
      const t2 = makeTool({ name: 'tool_b' });
      const t3 = makeTool({ name: 'tool_c' });

      registry.register(makeProvider('p1', [t1, t2]));
      registry.register(makeProvider('p2', [t3]));

      const all = await registry.listAll();
      expect(all).toHaveLength(3);
      expect(all.map((t) => t.name)).toEqual(['tool_a', 'tool_b', 'tool_c']);
    });

    it('无 provider 时返回空数组', async () => {
      const registry = new ToolRegistry();
      expect(await registry.listAll()).toEqual([]);
    });
  });

  describe('listForSlot', () => {
    it('总开关关闭时返回空数组', async () => {
      const registry = new ToolRegistry();
      registry.register(makeProvider('p1', [makeTool()]));

      const result = await registry.listForSlot('narrator', makePermissions({ enabled: false }));
      expect(result).toEqual([]);
    });

    it('工具自身 allowedSlots 过滤', async () => {
      const registry = new ToolRegistry();
      const tool = makeTool({ name: 'director_only', allowedSlots: ['director'] });
      registry.register(makeProvider('p1', [tool]));

      // narrator 不在 allowedSlots 中
      const forNarrator = await registry.listForSlot('narrator', makePermissions());
      expect(forNarrator).toHaveLength(0);

      // director 在 allowedSlots 中
      const forDirector = await registry.listForSlot('director', makePermissions());
      expect(forDirector).toHaveLength(1);
    });

    it('allowedSlots 为空数组表示全部槽位可用', async () => {
      const registry = new ToolRegistry();
      registry.register(makeProvider('p1', [makeTool({ allowedSlots: [] })]));

      for (const slot of ['narrator', 'director', 'verifier', 'memory'] as InstanceSlot[]) {
        const result = await registry.listForSlot(slot, makePermissions());
        expect(result).toHaveLength(1);
      }
    });

    it('slotAllowList 白名单过滤', async () => {
      const registry = new ToolRegistry();
      const t1 = makeTool({ name: 'allowed_tool' });
      const t2 = makeTool({ name: 'not_allowed_tool' });
      registry.register(makeProvider('p1', [t1, t2]));

      const perms = makePermissions({
        slotAllowList: { narrator: ['allowed_tool'] },
      });

      const result = await registry.listForSlot('narrator', perms);
      expect(result.length).toBe(1);
      expect(result[0]!.name).toBe('allowed_tool');
    });

    it('slotDenyList 黑名单过滤', async () => {
      const registry = new ToolRegistry();
      const t1 = makeTool({ name: 'good_tool' });
      const t2 = makeTool({ name: 'bad_tool' });
      registry.register(makeProvider('p1', [t1, t2]));

      const perms = makePermissions({
        slotDenyList: { narrator: ['bad_tool'] },
      });

      const result = await registry.listForSlot('narrator', perms);
      expect(result.length).toBe(1);
      expect(result[0]!.name).toBe('good_tool');
    });

    it('irreversible 工具在 allowIrreversible=false 时被过滤', async () => {
      const registry = new ToolRegistry();
      const safe = makeTool({ name: 'safe', sideEffectLevel: 'none' });
      const dangerous = makeTool({ name: 'dangerous', sideEffectLevel: 'irreversible' });
      registry.register(makeProvider('p1', [safe, dangerous]));

      // 默认 allowIrreversible 未设置（falsy），应过滤
      const result1 = await registry.listForSlot('narrator', makePermissions());
      expect(result1).toHaveLength(1);
      expect(result1[0]!.name).toBe('safe');

      // 显式允许
      const result2 = await registry.listForSlot(
        'narrator',
        makePermissions({ allowIrreversible: true }),
      );
      expect(result2).toHaveLength(2);
    });

    it('多重过滤条件组合', async () => {
      const registry = new ToolRegistry();
      const t1 = makeTool({ name: 'a', allowedSlots: ['narrator', 'director'] });
      const t2 = makeTool({ name: 'b', allowedSlots: ['narrator'] });
      const t3 = makeTool({ name: 'c', allowedSlots: ['director'] });
      registry.register(makeProvider('p1', [t1, t2, t3]));

      // narrator + 白名单只允许 a
      const perms = makePermissions({
        slotAllowList: { narrator: ['a', 'b'] },
        slotDenyList: { narrator: ['b'] },
      });

      const result = await registry.listForSlot('narrator', perms);
      expect(result).toHaveLength(1);
      expect(result[0]!.name).toBe('a');
    });
  });

  describe('getTool', () => {
    it('按名称查找工具', async () => {
      const registry = new ToolRegistry();
      const tool = makeTool({ name: 'my_tool', description: 'My tool' });
      registry.register(makeProvider('p1', [tool]));

      const found = await registry.getTool('my_tool');
      expect(found).not.toBeNull();
      expect(found!.name).toBe('my_tool');
      expect(found!.description).toBe('My tool');
    });

    it('工具不存在时返回 null', async () => {
      const registry = new ToolRegistry();
      registry.register(makeProvider('p1', [makeTool({ name: 'other' })]));

      const found = await registry.getTool('nonexistent');
      expect(found).toBeNull();
    });
  });

  describe('findProviderForTool', () => {
    it('查找包含指定工具的 provider', async () => {
      const registry = new ToolRegistry();
      const p1 = makeProvider('p1', [makeTool({ name: 'tool_a' })]);
      const p2 = makeProvider('p2', [makeTool({ name: 'tool_b' })]);
      registry.register(p1);
      registry.register(p2);

      const found = await registry.findProviderForTool('tool_b');
      expect(found).toBe(p2);
    });

    it('工具不存在时返回 null', async () => {
      const registry = new ToolRegistry();
      registry.register(makeProvider('p1', [makeTool({ name: 'x' })]));

      const found = await registry.findProviderForTool('y');
      expect(found).toBeNull();
    });
  });
});
