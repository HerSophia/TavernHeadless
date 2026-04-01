import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createEventBus } from '../../events/event-bus.js';
import type { CoreEventBus } from '../../events/event-bus.js';
import type { ToolExecutionRepository } from '../../ports/tool-execution-repository.js';
import { ToolExecutor } from '../tool-executor.js';
import { ToolRegistry } from '../tool-registry.js';
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolPermissions,
  ToolProvider,
} from '../types.js';

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

function makeProvider(args: {
  tools: ToolDefinition[];
  executeFn?: ToolProvider['executeTool'];
  id?: string;
}): ToolProvider {
  return {
    id: args.id ?? 'test-provider',
    type: 'builtin',
    listTools: vi.fn(async () => args.tools),
    executeTool: args.executeFn ?? vi.fn(async () => ({ data: 'result_data' })),
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
    it('executes a tool and collects a real success record', async () => {
      const tool = makeTool({ name: 'my_tool' });
      registry.register(makeProvider({ tools: [tool] }));

      const result = await executor.execute(
        'my_tool',
        { key: 'val' },
        makeContext(),
        makePermissions(),
      );

      expect(result.data).toBe('result_data');
      expect(result.error).toBeUndefined();
      expect(executor.getTurnCallCount()).toBe(1);

      const records = executor.getExecutionRecords();
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        floorId: 'floor-1',
        pageId: 'page-1',
        callerSlot: 'narrator',
        providerId: 'test-provider',
        toolName: 'my_tool',
        status: 'success',
      });
      expect(JSON.parse(records[0]!.argsJson)).toEqual({ key: 'val' });
      expect(JSON.parse(records[0]!.resultJson)).toBe('result_data');
      expect(records[0]!.durationMs).toBeGreaterThanOrEqual(0);
      expect(records[0]!.runId).toBeTruthy();
    });

    it('opens and finishes execution journal entries through ToolExecutionRepository', async () => {
      const tool = makeTool({ name: 'my_tool', sideEffectLevel: 'sandbox' });
      registry.register(makeProvider({ tools: [tool] }));

      const repository: ToolExecutionRepository = {
        insertMany: vi.fn(async () => undefined),
        open: vi.fn(async () => undefined),
        finish: vi.fn(async () => undefined),
        markRunCommitOutcome: vi.fn(async () => 0),
        findByFloorId: vi.fn(async () => []),
        findByRunId: vi.fn(async () => []),
      };
      const journalingExecutor = new ToolExecutor(registry, eventBus, repository, 'run-fixed');

      const result = await journalingExecutor.execute(
        'my_tool',
        { key: 'val' },
        makeContext(),
        makePermissions(),
      );

      expect(result.data).toBe('result_data');
      expect(repository.open).toHaveBeenCalledOnce();

      const opened = (repository.open as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(opened).toMatchObject({
        runId: 'run-fixed',
        toolName: 'my_tool',
        providerType: 'builtin',
        sideEffectLevel: 'sandbox',
        attemptNo: 1,
      });
      expect(repository.finish).toHaveBeenCalledWith(
        opened.id,
        expect.objectContaining({
          status: 'success',
          finishedAt: expect.any(Number),
        }),
      );
      expect(journalingExecutor.getExecutionRecords()[0]).toMatchObject({
        runId: 'run-fixed',
        providerType: 'builtin',
        lifecycleState: 'finished',
        commitOutcome: 'pending',
        sideEffectLevel: 'sandbox',
        attemptNo: 1,
      });
    });

    it('returns a deferred receipt and buffers pending async jobs for approved irreversible tools', async () => {
      const repository: ToolExecutionRepository = {
        insertMany: vi.fn(async () => undefined),
        open: vi.fn(async () => undefined),
        finish: vi.fn(async () => undefined),
        markRunCommitOutcome: vi.fn(async () => 0),
        findByFloorId: vi.fn(async () => []),
        findByRunId: vi.fn(async () => []),
      };
      const deferredTool = makeTool({
        name: 'deferred_tool',
        sideEffectLevel: 'irreversible',
        asyncCapability: 'deferred_ok',
        defaultDeliveryMode: 'async_job',
        resultVisibility: 'deferred_receipt',
      });
      const executeFn = vi.fn(async () => ({ data: 'should-not-run-inline' }));
      registry.register(makeProvider({ tools: [deferredTool], executeFn }));
      const deferredExecutor = new ToolExecutor(registry, eventBus, repository, 'run-deferred');

      const result = await deferredExecutor.execute(
        'deferred_tool',
        { target: 'world' },
        makeContext({
          accountId: 'account-1',
          variableContext: {
            accountId: 'account-1',
            sessionId: 'sess-1',
            floorId: 'floor-1',
            pageId: 'page-1',
          },
        }),
        makePermissions({ allowIrreversible: true }),
      );

      expect(executeFn).not.toHaveBeenCalled();
      expect(result.executionStatus).toBe('queued');
      expect(result.data).toMatchObject({
        accepted: true,
        delivery_mode: 'async_job',
        execution_id: expect.any(String),
        job_id: expect.any(String),
        status: 'queued',
      });
      expect(repository.open).toHaveBeenCalledOnce();
      expect(repository.open).toHaveBeenCalledWith(expect.objectContaining({
        runId: 'run-deferred',
        toolName: 'deferred_tool',
        status: 'queued',
        deliveryMode: 'async_job',
      }));
      expect(repository.finish).not.toHaveBeenCalled();

      const [record] = deferredExecutor.getExecutionRecords();
      expect(record).toMatchObject({
        runId: 'run-deferred',
        toolName: 'deferred_tool',
        status: 'queued',
        lifecycleState: 'opened',
        commitOutcome: 'pending',
        deliveryMode: 'async_job',
      });

      const [pendingJob] = deferredExecutor.getPendingToolJobs();
      expect(pendingJob).toMatchObject({
        runId: 'run-deferred',
        executionId: record!.id,
        jobId: expect.any(String),
        envelope: expect.objectContaining({
          providerId: 'test-provider',
          providerType: 'builtin',
          toolName: 'deferred_tool',
          deliveryMode: 'async_job',
          resultVisibility: 'deferred_receipt',
        }),
      });
    });

    it('keeps pageId undefined when the context has no real page binding', async () => {
      const tool = makeTool({ name: 'my_tool' });
      registry.register(makeProvider({ tools: [tool] }));

      await executor.execute(
        'my_tool',
        { key: 'val' },
        makeContext({
          pageId: undefined,
          variableContext: { sessionId: 'sess-1', floorId: 'floor-1' },
        }),
        makePermissions(),
      );

      const records = executor.getExecutionRecords();
      expect(records).toHaveLength(1);
      expect(records[0]!.pageId).toBeUndefined();
    });

    it('returns denied when the global switch is disabled and records it', async () => {
      const tool = makeTool({ name: 'my_tool' });
      registry.register(makeProvider({ tools: [tool] }));

      const result = await executor.execute(
        'my_tool',
        {},
        makeContext(),
        makePermissions({ enabled: false }),
      );

      expect(result.denied).toBe('disabled');
      expect(result.error).toBe('Tool call denied: disabled');

      const [record] = executor.getExecutionRecords();
      expect(record).toMatchObject({
        providerId: 'unknown',
        toolName: 'my_tool',
        status: 'denied',
        errorMessage: 'Tool call denied: disabled',
      });
      expect(JSON.parse(record!.resultJson)).toEqual({ denied: 'disabled' });
      expect(executor.getTurnCallCount()).toBe(0);
    });

    it('returns denied when the tool is not found', async () => {
      registry.register(makeProvider({ tools: [] }));

      const result = await executor.execute(
        'nonexistent',
        {},
        makeContext(),
        makePermissions(),
      );

      expect(result.denied).toBe('tool_not_found');
      expect(executor.getExecutionRecords()[0]).toMatchObject({
        providerId: 'unknown',
        toolName: 'nonexistent',
        status: 'denied',
      });
    });

    it('returns denied when slot is not allowed', async () => {
      const tool = makeTool({ name: 'dir_tool', allowedSlots: ['director'] });
      registry.register(makeProvider({ tools: [tool] }));

      const result = await executor.execute(
        'dir_tool',
        {},
        makeContext({ callerSlot: 'narrator' }),
        makePermissions(),
      );

      expect(result.denied).toBe('slot_not_allowed');
      expect(executor.getExecutionRecords()[0]).toMatchObject({
        providerId: 'test-provider',
        toolName: 'dir_tool',
        status: 'denied',
      });
    });

    it('returns denied when a tool is not in the allow list', async () => {
      const tool = makeTool({ name: 'my_tool' });
      registry.register(makeProvider({ tools: [tool] }));

      const result = await executor.execute(
        'my_tool',
        {},
        makeContext({ callerSlot: 'narrator' }),
        makePermissions({ slotAllowList: { narrator: ['other_tool'] } }),
      );

      expect(result.denied).toBe('not_in_allow_list');
    });

    it('returns denied when a tool is in the deny list', async () => {
      const tool = makeTool({ name: 'my_tool' });
      registry.register(makeProvider({ tools: [tool] }));

      const result = await executor.execute(
        'my_tool',
        {},
        makeContext({ callerSlot: 'narrator' }),
        makePermissions({ slotDenyList: { narrator: ['my_tool'] } }),
      );

      expect(result.denied).toBe('deny_listed');
    });

    it('returns denied when maxCallsPerTurn is exceeded', async () => {
      const tool = makeTool({ name: 'my_tool' });
      registry.register(makeProvider({ tools: [tool] }));

      const permissions = makePermissions({ maxCallsPerTurn: 2 });
      const context = makeContext();

      await executor.execute('my_tool', {}, context, permissions);
      await executor.execute('my_tool', {}, context, permissions);
      const result = await executor.execute('my_tool', {}, context, permissions);

      expect(result.denied).toBe('max_calls_exceeded');
      expect(executor.getExecutionRecords()).toHaveLength(3);
      expect(executor.getExecutionRecords()[2]!.status).toBe('denied');
    });

    it('reserves maxCallsPerTurn atomically across overlapping async executions', async () => {
      const tool = makeTool({ name: 'my_tool' });
      let releaseExecution: (() => void) | undefined;
      let providerStarted = false;

      const executeFn = vi.fn(async () => {
        providerStarted = true;
        await new Promise<void>((resolve) => {
          releaseExecution = resolve;
        });
        return { data: 'result_data' };
      });

      registry.register(makeProvider({ tools: [tool], executeFn }));

      const permissions = makePermissions({ maxCallsPerTurn: 1 });
      const context = makeContext();

      const firstPromise = executor.execute('my_tool', { request: 1 }, context, permissions);
      for (let i = 0; i < 10 && !providerStarted; i += 1) {
        await Promise.resolve();
      }

      const secondResult = await executor.execute('my_tool', { request: 2 }, context, permissions);
      expect(secondResult.denied).toBe('max_calls_exceeded');
      expect(executeFn).toHaveBeenCalledTimes(1);

      releaseExecution?.();
      await expect(firstPromise).resolves.toEqual({ data: 'result_data' });

      expect(executor.getTurnCallCount()).toBe(1);
      expect(executor.getExecutionRecords().map((record) => record.status).sort()).toEqual(['denied', 'success']);
      expect(executor.getExecutionRecords().find((record) => record.status === 'denied')).toMatchObject({
        errorMessage: 'Tool call denied: max_calls_exceeded',
      });
    });

    it('returns denied for irreversible tools when allowIrreversible=false', async () => {
      const tool = makeTool({ name: 'danger', sideEffectLevel: 'irreversible' });
      registry.register(makeProvider({ tools: [tool] }));

      const result = await executor.execute(
        'danger',
        {},
        makeContext(),
        makePermissions({ allowIrreversible: false }),
      );

      expect(result.denied).toBe('irreversible_blocked');
    });

    it('allows irreversible tools when allowIrreversible=true', async () => {
      const tool = makeTool({ name: 'danger', sideEffectLevel: 'irreversible' });
      registry.register(makeProvider({ tools: [tool] }));

      const result = await executor.execute(
        'danger',
        {},
        makeContext(),
        makePermissions({ allowIrreversible: true }),
      );

      expect(result.data).toBe('result_data');
      expect(result.denied).toBeUndefined();
    });

    it('treats provider returned error payload as an error record', async () => {
      const tool = makeTool({ name: 'failing' });
      registry.register(
        makeProvider({
          tools: [tool],
          executeFn: async () => ({ error: 'execution failed' }),
        }),
      );

      const result = await executor.execute(
        'failing',
        {},
        makeContext(),
        makePermissions(),
      );

      expect(result.error).toBe('execution failed');
      expect(executor.getTurnCallCount()).toBe(1);
      expect(executor.getExecutionRecords()[0]).toMatchObject({
        providerId: 'test-provider',
        toolName: 'failing',
        status: 'error',
        errorMessage: 'execution failed',
      });
      expect(JSON.parse(executor.getExecutionRecords()[0]!.resultJson)).toEqual({ error: 'execution failed' });
    });

    it('classifies uncertain timeout payloads into the execution journal', async () => {
      const tool = makeTool({ name: 'failing' });
      registry.register(
        makeProvider({
          tools: [tool],
          executeFn: async () => ({
            error: 'Tool call timeout after 50ms; execution outcome is uncertain; reconnect required before the next call',
          }),
        }),
      );

      const result = await executor.execute('failing', {}, makeContext(), makePermissions());

      expect(result.error).toContain('execution outcome is uncertain');
      expect(executor.getExecutionRecords()[0]).toMatchObject({
        toolName: 'failing',
        status: 'uncertain',
        lifecycleState: 'finished',
      });
    });

    it('records thrown provider errors as error records', async () => {
      const tool = makeTool({ name: 'failing' });
      registry.register(
        makeProvider({
          tools: [tool],
          executeFn: async () => {
            throw new Error('boom');
          },
        }),
      );

      const result = await executor.execute(
        'failing',
        {},
        makeContext(),
        makePermissions(),
      );

      expect(result.error).toBe('boom');
      expect(executor.getTurnCallCount()).toBe(1);
      expect(executor.getExecutionRecords()[0]).toMatchObject({
        providerId: 'test-provider',
        toolName: 'failing',
        status: 'error',
        errorMessage: 'boom',
      });
    });

    it('resetTurnCounter clears count and collected records', async () => {
      const tool = makeTool({ name: 'my_tool' });
      registry.register(makeProvider({ tools: [tool] }));

      await executor.execute('my_tool', {}, makeContext(), makePermissions());
      const runIdBeforeReset = executor.getExecutionRecords()[0]!.runId;

      executor.resetTurnCounter();

      expect(executor.getTurnCallCount()).toBe(0);
      expect(executor.getExecutionRecords()).toEqual([]);

      await executor.execute('my_tool', {}, makeContext(), makePermissions());
      expect(executor.getExecutionRecords()[0]!.runId).not.toBe(runIdBeforeReset);
    });
  });

  describe('events', () => {
    it('emits started and completed on success', async () => {
      const tool = makeTool({ name: 'my_tool' });
      registry.register(makeProvider({ tools: [tool] }));

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

    it('emits started and failed when the provider returns an error payload', async () => {
      const tool = makeTool({ name: 'fail_tool' });
      registry.register(
        makeProvider({
          tools: [tool],
          executeFn: async () => ({ error: 'boom' }),
        }),
      );

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

    it('emits denied and does not emit started when permission check blocks the call', async () => {
      const tool = makeTool({ name: 'blocked', allowedSlots: ['director'] });
      registry.register(makeProvider({ tools: [tool] }));

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
    it('converts ToolDefinition into the Vercel AI SDK compatible shape', () => {
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
      registry.register(makeProvider({ tools: [tool] }));

      const llmTools = executor.buildLLMTools(
        [tool],
        makeContext(),
        makePermissions(),
      );

      expect(Object.keys(llmTools)).toEqual(['dice']);
      expect(llmTools.dice!.description).toBe('Roll a dice');
      expect(llmTools.dice!.parameters).toEqual(tool.parameters);
      expect(typeof llmTools.dice!.execute).toBe('function');
    });

    it('delegates execute back into ToolExecutor.execute', async () => {
      const tool = makeTool({ name: 'dice' });
      registry.register(makeProvider({ tools: [tool] }));

      const llmTools = executor.buildLLMTools(
        [tool],
        makeContext(),
        makePermissions(),
      );

      const result = await llmTools.dice!.execute({ sides: 6 });
      expect(result).toBe('result_data');
      expect(executor.getTurnCallCount()).toBe(1);
      expect(executor.getExecutionRecords()).toHaveLength(1);
    });

    it('returns an error object to the model when the tool fails', async () => {
      const tool = makeTool({ name: 'broken' });
      registry.register(
        makeProvider({
          tools: [tool],
          executeFn: async () => ({ error: 'broken tool' }),
        }),
      );

      const llmTools = executor.buildLLMTools(
        [tool],
        makeContext(),
        makePermissions(),
      );

      const result = await llmTools.broken!.execute({});
      expect(result).toEqual({ error: 'broken tool' });
    });
  });
});
