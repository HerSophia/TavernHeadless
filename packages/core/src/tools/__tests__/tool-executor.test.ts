import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolExecutor } from '../tool-executor.js';
import { ToolRegistry } from '../tool-registry.js';
import type {
  ToolDefinition,
  ToolProvider,
  ToolPermissions,
  ToolExecutionContext,
} from '../types.js';
import { createEventBus } from '../../events/event-bus.js';
import type { CoreEventBus } from '../../events/event-bus.js';

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

function makeProvider(tools: ToolDefinition[], executeFn?: ToolProvider['executeTool']): ToolProvider {
  return {
    id: 'test-provider',
    type: 'builtin',
    listTools: vi.fn(async () => tools),
    executeTool: executeFn ?? vi.fn(async () => ({ data: 'result_data' })),
  };
}

function makeContext(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    sessionId: 'sess-1',
    floorId: 'floor-1',
    pageId: 'page-1',
    callerSlot: 'narrator',
    variableContext: { sessionId: 'sess-1', floorId: 'floor-1', pageId: 'page-1' },
    ...overrides,
  };
}

function makePermissions(overrides: Partial<ToolPermissions> = {}): ToolPermissions {
  return {
    enabled: true,
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────

describe('ToolExecutor', () => {
  let registry: ToolRegistry;
  let eventBus: CoreEventBus;
  let executor: ToolExecutor;

  beforeEach(() => {
    registry = new ToolRegistry();
    eventBus = createEventBus();
    executor = new ToolExecutor(registry, eventBus);
  });

  describe('execute', () => {
    it('正常执行工具并返回结果', async () => {
      const tool = makeTool({ name: 'my_tool' });
      registry.register(makeProvider([tool]));

      const result = await executor.execute(
        'my_tool',
        { key: 'val' },
        makeContext(),
        makePermissions(),
      );

      expect(result.data).toBe('result_data');
      expect(result.error).toBeUndefined();
      expect(executor.getTurnCallCount()).toBe(1);
    });

    it('总开关关闭时拒绝', async () => {
      const tool = makeTool({ name: 'my_tool' });
      registry.register(makeProvider([tool]));

      const result = await executor.execute(
        'my_tool',
        {},
        makeContext(),
        makePermissions({ enabled: false }),
      );

      expect(result.denied).toBe('disabled');
      expect(result.error).toContain('denied');
    });

    it('工具不存在时拒绝', async () => {
      registry.register(makeProvider([]));

      const result = await executor.execute(
        'nonexistent',
        {},
        makeContext(),
        makePermissions(),
      );

      expect(result.denied).toBe('tool_not_found');
    });

    it('槽位不在 allowedSlots 中时拒绝', async () => {
      const tool = makeTool({ name: 'dir_tool', allowedSlots: ['director'] });
      registry.register(makeProvider([tool]));

      const result = await executor.execute(
        'dir_tool',
        {},
        makeContext({ callerSlot: 'narrator' }),
        makePermissions(),
      );

      expect(result.denied).toBe('slot_not_allowed');
    });

    it('不在白名单中时拒绝', async () => {
      const tool = makeTool({ name: 'my_tool' });
      registry.register(makeProvider([tool]));

      const result = await executor.execute(
        'my_tool',
        {},
        makeContext({ callerSlot: 'narrator' }),
        makePermissions({ slotAllowList: { narrator: ['other_tool'] } }),
      );

      expect(result.denied).toBe('not_in_allow_list');
    });

    it('在黑名单中时拒绝', async () => {
      const tool = makeTool({ name: 'my_tool' });
      registry.register(makeProvider([tool]));

      const result = await executor.execute(
        'my_tool',
        {},
        makeContext({ callerSlot: 'narrator' }),
        makePermissions({ slotDenyList: { narrator: ['my_tool'] } }),
      );

      expect(result.denied).toBe('deny_listed');
    });

    it('超过 maxCallsPerTurn 时拒绝', async () => {
      const tool = makeTool({ name: 'my_tool' });
      registry.register(makeProvider([tool]));

      const perms = makePermissions({ maxCallsPerTurn: 2 });
      const ctx = makeContext();

      // 前两次成功
      await executor.execute('my_tool', {}, ctx, perms);
      await executor.execute('my_tool', {}, ctx, perms);

      // 第三次被拒绝
      const result = await executor.execute('my_tool', {}, ctx, perms);
      expect(result.denied).toBe('max_calls_exceeded');
    });

    it('irreversible 工具在 allowIrreversible=false 时拒绝', async () => {
      const tool = makeTool({ name: 'danger', sideEffectLevel: 'irreversible' });
      registry.register(makeProvider([tool]));

      const result = await executor.execute(
        'danger',
        {},
        makeContext(),
        makePermissions({ allowIrreversible: false }),
      );

      expect(result.denied).toBe('irreversible_blocked');
    });

    it('irreversible 工具在 allowIrreversible=true 时允许', async () => {
      const tool = makeTool({ name: 'danger', sideEffectLevel: 'irreversible' });
      registry.register(makeProvider([tool]));

      const result = await executor.execute(
        'danger',
        {},
        makeContext(),
        makePermissions({ allowIrreversible: true }),
      );

      expect(result.data).toBe('result_data');
      expect(result.denied).toBeUndefined();
    });

    it('provider 执行报错时返回 error', async () => {
      const tool = makeTool({ name: 'failing' });
      const provider = makeProvider([tool], async () => {
        throw new Error('execution failed');
      });
      registry.register(provider);

      const result = await executor.execute(
        'failing',
        {},
        makeContext(),
        makePermissions(),
      );

      expect(result.error).toBe('execution failed');
    });

    it('resetTurnCounter 重置计数器', async () => {
      const tool = makeTool({ name: 'my_tool' });
      registry.register(makeProvider([tool]));

      const perms = makePermissions({ maxCallsPerTurn: 1 });
      await executor.execute('my_tool', {}, makeContext(), perms);
      expect(executor.getTurnCallCount()).toBe(1);

      executor.resetTurnCounter();
      expect(executor.getTurnCallCount()).toBe(0);

      // 重置后可以再次调用
      const result = await executor.execute('my_tool', {}, makeContext(), perms);
      expect(result.data).toBe('result_data');
    });
  });

  describe('事件发射', () => {
    it('成功执行时发射 started 和 completed', async () => {
      const tool = makeTool({ name: 'my_tool' });
      registry.register(makeProvider([tool]));

      const started = vi.fn();
      const completed = vi.fn();
      eventBus.on('tool.call_started', started);
      eventBus.on('tool.call_completed', completed);

      await executor.execute('my_tool', { a: 1 }, makeContext(), makePermissions());

      expect(started).toHaveBeenCalledOnce();
      expect(started).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: 'my_tool',
          args: { a: 1 },
          callerSlot: 'narrator',
        }),
      );

      expect(completed).toHaveBeenCalledOnce();
      expect(completed).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: 'my_tool',
          result: 'result_data',
        }),
      );
    });

    it('执行失败时发射 started 和 failed', async () => {
      const tool = makeTool({ name: 'fail_tool' });
      const provider = makeProvider([tool], async () => {
        throw new Error('boom');
      });
      registry.register(provider);

      const started = vi.fn();
      const failed = vi.fn();
      eventBus.on('tool.call_started', started);
      eventBus.on('tool.call_failed', failed);

      await executor.execute('fail_tool', {}, makeContext(), makePermissions());

      expect(started).toHaveBeenCalledOnce();
      expect(failed).toHaveBeenCalledOnce();
      expect(failed).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: 'fail_tool',
          error: expect.any(Error),
        }),
      );
    });

    it('权限拒绝时发射 denied，不发射 started', async () => {
      const tool = makeTool({ name: 'blocked', allowedSlots: ['director'] });
      registry.register(makeProvider([tool]));

      const started = vi.fn();
      const denied = vi.fn();
      eventBus.on('tool.call_started', started);
      eventBus.on('tool.call_denied', denied);

      await executor.execute(
        'blocked',
        {},
        makeContext({ callerSlot: 'narrator' }),
        makePermissions(),
      );

      expect(started).not.toHaveBeenCalled();
      expect(denied).toHaveBeenCalledOnce();
      expect(denied).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: 'blocked',
          reason: 'slot_not_allowed',
        }),
      );
    });
  });

  describe('buildLLMTools', () => {
    it('将 ToolDefinition 转为 Vercel AI SDK 格式', () => {
      const tool = makeTool({
        name: 'dice',
        description: 'Roll a dice',
        parameters: {
          type: 'object',
          properties: {
            sides: { type: 'number', description: 'Number of sides' },
          },
          required: ['sides'],
        },
      });
      registry.register(makeProvider([tool]));

      const llmTools = executor.buildLLMTools(
        [tool],
        makeContext(),
        makePermissions(),
      );

      expect(Object.keys(llmTools)).toEqual(['dice']);
      expect(llmTools['dice']!.description).toBe('Roll a dice');
      expect(llmTools['dice']!.parameters).toEqual(tool.parameters);
      expect(typeof llmTools['dice']!.execute).toBe('function');
    });

    it('execute 函数内部调用 ToolExecutor.execute', async () => {
      const tool = makeTool({ name: 'dice' });
      registry.register(makeProvider([tool]));

      const llmTools = executor.buildLLMTools(
        [tool],
        makeContext(),
        makePermissions(),
      );

      const result = await llmTools['dice']!.execute({ sides: 6 });
      expect(result).toBe('result_data');
      expect(executor.getTurnCallCount()).toBe(1);
    });

    it('execute 函数在工具报错时返回错误对象', async () => {
      const tool = makeTool({ name: 'broken' });
      const provider = makeProvider([tool], async () => {
        throw new Error('broken tool');
      });
      registry.register(provider);

      const llmTools = executor.buildLLMTools(
        [tool],
        makeContext(),
        makePermissions(),
      );

      const result = await llmTools['broken']!.execute({});
      expect(result).toEqual({ error: 'broken tool' });
    });
  });
});
