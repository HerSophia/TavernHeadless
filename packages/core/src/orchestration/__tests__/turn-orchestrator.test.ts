import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TurnOrchestrator, TurnError } from '../turn-orchestrator.js';
import type { TurnOrchestratorDeps } from '../turn-orchestrator.js';
import type { TurnInput } from '../types.js';
import type { GenerationOutput } from '../../generation/types.js';
import type { ToolDefinition, ToolProvider, ToolPermissions } from '../../tools/types.js';
import { ToolRegistry } from '../../tools/tool-registry.js';
import type { InstanceSlot } from '../../llm/types.js';
import type { DirectorResult } from '../director.js';
import type { VerifierResult } from '../verifier.js';
import type { ConsolidationResult } from '../../memory/memory-consolidator.js';
import type { MemoryInjectionResult } from '../../memory/types.js';

// ── MemoryItem 工厂 ──────────────────────────────────

import type { MemoryItem } from '../../memory/types.js';
import { InvalidStateTransitionError } from '../../errors.js';

function makeMemoryItem(content: string, overrides: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id: `mem-${content.replace(/\s/g, '-').toLowerCase()}`,
    scope: 'chat',
    scopeId: 'session-1',
    type: 'fact',
    content,
    importance: 0.5,
    confidence: 1.0,
    status: 'active',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

// ── Mock 工厂 ─────────────────────────────────────────

function makeGenOutput(overrides: Partial<GenerationOutput> = {}): GenerationOutput {
  return {
    text: 'Generated text',
    rawText: 'Generated text',
    summaries: [],
    usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    finishReason: 'stop',
    ...overrides,
  };
}

function makeDirectorResult(overrides: Partial<DirectorResult> = {}): DirectorResult {
  return {
    output: {
      directive: 'Focus on emotion',
      tone: 'melancholic',
      focusElements: ['character feelings'],
    },
    usage: { promptTokens: 30, completionTokens: 20, totalTokens: 50 },
    ...overrides,
  };
}

function makeVerifierResult(passed: boolean, overrides: Partial<VerifierResult> = {}): VerifierResult {
  return {
    output: {
      passed,
      issues: passed ? [] : [{ description: 'Inconsistency found', severity: 'error' }],
      suggestion: passed ? undefined : 'Please fix the inconsistency',
    },
    usage: { promptTokens: 40, completionTokens: 30, totalTokens: 70 },
    ...overrides,
  };
}

function makeConsolidationResult(overrides: Partial<ConsolidationResult> = {}): ConsolidationResult {
  return {
    output: {
      turnSummary: 'Summary of the turn',
      factsAdd: [],
      factsUpdate: [],
      factsDeprecate: [],
    },
    usage: { promptTokens: 50, completionTokens: 40, totalTokens: 90 },
    ...overrides,
  };
}

function makeMemoryInjection(): MemoryInjectionResult {
  return {
    items: [],
    formattedText: '[Memory]\n- (fact) Some fact',
    tokenCount: 10,
  };
}

function makeDeps(overrides: Partial<TurnOrchestratorDeps> = {}): TurnOrchestratorDeps {
  return {
    floorStateMachine: {
      canTransition: vi.fn().mockReturnValue(true),
      transition: vi.fn().mockResolvedValue({
        id: 'floor-1',
        sessionId: 'session-1',
        floorNo: 1,
        branchId: 'main',
        parentFloorId: null,
        state: 'generating',
        tokenIn: 0,
        tokenOut: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
      fail: vi.fn().mockResolvedValue({
        id: 'floor-1',
        sessionId: 'session-1',
        floorNo: 1,
        branchId: 'main',
        parentFloorId: null,
        state: 'failed',
        tokenIn: 0,
        tokenOut: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    } as any,
    generationPipeline: {
      run: vi.fn().mockResolvedValue(makeGenOutput()),
    } as any,
    memoryStore: {
      prepareInjection: vi.fn().mockResolvedValue(makeMemoryInjection()),
      ingestSummaries: vi.fn().mockResolvedValue([]),
      applyConsolidation: vi.fn().mockResolvedValue(undefined),
    } as any,
    memoryConsolidator: {
      consolidate: vi.fn().mockResolvedValue(makeConsolidationResult()),
    } as any,
    director: {
      direct: vi.fn().mockResolvedValue(makeDirectorResult()),
    } as any,
    verifier: {
      verify: vi.fn().mockResolvedValue(makeVerifierResult(true)),
    } as any,
    eventBus: {
      emit: vi.fn().mockResolvedValue(undefined),
    } as any,
    ...overrides,
  };
}

function makeInput(overrides: Partial<TurnInput> = {}): TurnInput {
  return {
    sessionId: 'session-1',
    floorId: 'floor-1',
    messages: [
      { role: 'system', content: 'You are a narrator.' },
      { role: 'user', content: 'Hello!' },
    ],
    generationParams: { temperature: 0.7, maxOutputTokens: 500 },
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────

describe('TurnOrchestrator', () => {
  let deps: TurnOrchestratorDeps;
  let orchestrator: TurnOrchestrator;

  beforeEach(() => {
    deps = makeDeps();
    orchestrator = new TurnOrchestrator(deps);
  });

  // ── 最简路径 ────────────────────────────────────────

  it('executes minimal turn (narrator only)', async () => {
    const result = await orchestrator.executeTurn(makeInput());

    expect(result.floorId).toBe('floor-1');
    expect(result.generatedText).toBe('Generated text');
    expect(result.rawText).toBe('Generated text');
    expect(result.finalState).toBe('generating');
    expect(result.directorResult).toBeUndefined();
    expect(result.verifierResult).toBeUndefined();
    expect(result.consolidationResult).toBeUndefined();
    expect(result.memoryInjection).toBeUndefined();

    // 状态转移：draft → generating
    expect(deps.floorStateMachine.transition).toHaveBeenCalledTimes(1);
    expect(deps.floorStateMachine.transition).toHaveBeenNthCalledWith(1, 'floor-1', 'generating');
  });

  it('emits generation events', async () => {
    await orchestrator.executeTurn(makeInput());

    const emitCalls = (deps.eventBus.emit as any).mock.calls;
    const eventNames = emitCalls.map((c: any[]) => c[0]);

    expect(eventNames).toContain('generation.started');
    expect(eventNames).toContain('generation.completed');
  });

  it('accumulates token usage', async () => {
    const result = await orchestrator.executeTurn(makeInput());

    expect(result.totalUsage.promptTokens).toBe(100);
    expect(result.totalUsage.completionTokens).toBe(50);
    expect(result.totalUsage.totalTokens).toBe(150);
  });

  // ── 完整路径 ────────────────────────────────────────

  it('executes full turn with all components', async () => {
    const input = makeInput({
      config: {
        enableDirector: true,
        enableVerifier: true,
        enableMemoryConsolidation: true,
      },
      directorInput: {
        recentContext: 'Recent events...',
        activeFacts: [makeMemoryItem('Fact 1')],
      },
      verifierInput: {
        characterRules: 'Must stay in character',
        activeFacts: [makeMemoryItem('Fact 1')],
      },
      memoryOptions: {
        maxTokens: 200,
      },
      consolidationContext: {
        currentFloorContent: 'Current content...',
        recentSummaries: ['Summary 1'],
        existingFacts: [],
      },
    });

    const result = await orchestrator.executeTurn(input);

    expect(result.directorResult).toBeDefined();
    expect(result.verifierResult).toBeDefined();
    expect(result.memoryInjection).toBeDefined();
    expect(result.consolidationResult).toBeDefined();
    expect(result.finalState).toBe('generating');

    // Token usage = generation (150) + director (50) + verifier (70) + consolidation (90)
    expect(result.totalUsage.totalTokens).toBe(150 + 50 + 70 + 90);
  });

  it('propagates slot generation params overrides to each component', async () => {
    const input = makeInput({
      config: {
        enableDirector: true,
        enableVerifier: true,
        enableMemoryConsolidation: true,
      },
      directorInput: {
        recentContext: 'Recent events...',
        activeFacts: [makeMemoryItem('Fact 1')],
      },
      verifierInput: {
        characterRules: 'Must stay in character',
        activeFacts: [makeMemoryItem('Fact 1')],
      },
      consolidationContext: {
        currentFloorContent: 'Current content...',
        recentSummaries: ['Summary 1'],
        existingFacts: [],
      },
      generationParamsOverrides: {
        narrator: { temperature: 0.95, topP: 0.88 },
        director: { temperature: 0.15, maxOutputTokens: 120 },
        verifier: { temperature: 0.25, maxOutputTokens: 80 },
        memory: { temperature: 0.35, maxOutputTokens: 160 },
      },
    });

    await orchestrator.executeTurn(input);

    expect(deps.generationPipeline.run).toHaveBeenCalledWith(
      expect.objectContaining({ params: expect.objectContaining({ temperature: 0.95, topP: 0.88 }) }),
      expect.anything(),
    );
    expect(deps.director.direct).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ temperature: 0.15, maxOutputTokens: 120 }), undefined);
    expect(deps.verifier.verify).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ temperature: 0.25, maxOutputTokens: 80 }), undefined);
    expect((deps.memoryConsolidator.consolidate as any).mock.calls[0][0].params).toEqual(expect.objectContaining({ temperature: 0.35, maxOutputTokens: 160 }));
  });

  // ── Director ────────────────────────────────────────

  it('calls director when enabled', async () => {
    const directorInput = { recentContext: 'Events', activeFacts: [makeMemoryItem('Fact')] };
    const input = makeInput({
      config: { enableDirector: true },
      directorInput,
    });

    const result = await orchestrator.executeTurn(input);

    expect(deps.director.direct).toHaveBeenCalledWith(directorInput, undefined, undefined);
    expect(result.directorResult).toBeDefined();
    expect(result.directorResult!.output.directive).toBe('Focus on emotion');
  });

  it('fails turn when director fails', async () => {
    deps = makeDeps({
      director: { direct: vi.fn().mockRejectedValue(new Error('Director LLM timeout')) } as any,
    });
    orchestrator = new TurnOrchestrator(deps);

    const input = makeInput({
      config: { enableDirector: true },
      directorInput: { recentContext: 'Events', activeFacts: [] },
    });

    await expect(orchestrator.executeTurn(input)).rejects.toThrow(TurnError);
    await expect(orchestrator.executeTurn(input)).rejects.toThrow('Director failed');

    // Should try to mark floor as failed
    expect(deps.floorStateMachine.fail).toHaveBeenCalled();
  });

  // ── Memory Retrieval ────────────────────────────────

  it('retrieves memory when options provided', async () => {
    const input = makeInput({
      memoryOptions: { maxTokens: 200, minImportance: 0.3 },
    });

    const result = await orchestrator.executeTurn(input);

    expect(deps.memoryStore.prepareInjection).toHaveBeenCalledWith('session-1', {
      maxTokens: 200,
      minImportance: 0.3,
    });
    expect(result.memoryInjection).toBeDefined();
  });

  // ── Verifier: warn strategy ─────────────────────────

  it('warns but continues when verifier fails with warn strategy', async () => {
    deps = makeDeps({
      verifier: { verify: vi.fn().mockResolvedValue(makeVerifierResult(false)) } as any,
    });
    orchestrator = new TurnOrchestrator(deps);

    const input = makeInput({
      config: { enableVerifier: true, verifierFailStrategy: 'warn' },
      verifierInput: { characterRules: 'Rules', activeFacts: [] },
    });

    const result = await orchestrator.executeTurn(input);

    expect(result.finalState).toBe('generating');
    expect(result.verifierResult).toBeDefined();
    expect(result.verifierResult!.output.passed).toBe(false);
  });

  // ── Verifier: block strategy ────────────────────────

  it('blocks turn when verifier fails with block strategy', async () => {
    deps = makeDeps({
      verifier: { verify: vi.fn().mockResolvedValue(makeVerifierResult(false)) } as any,
    });
    orchestrator = new TurnOrchestrator(deps);

    const input = makeInput({
      config: { enableVerifier: true, verifierFailStrategy: 'block' },
      verifierInput: { characterRules: 'Rules', activeFacts: [] },
    });

    await expect(orchestrator.executeTurn(input)).rejects.toThrow(TurnError);
    await expect(orchestrator.executeTurn(input)).rejects.toThrow('Verifier blocked');
  });

  // ── Verifier: retry strategy ────────────────────────

  it('retries and succeeds when verifier passes on second attempt', async () => {
    const verifyMock = vi.fn()
      .mockResolvedValueOnce(makeVerifierResult(false))
      .mockResolvedValueOnce(makeVerifierResult(true));

    deps = makeDeps({
      verifier: { verify: verifyMock } as any,
    });
    orchestrator = new TurnOrchestrator(deps);

    const input = makeInput({
      config: { enableVerifier: true, verifierFailStrategy: 'retry', maxRetries: 1 },
      verifierInput: { characterRules: 'Rules', activeFacts: [] },
    });

    const result = await orchestrator.executeTurn(input);

    expect(result.finalState).toBe('generating');
    expect(verifyMock).toHaveBeenCalledTimes(2);
    expect(deps.generationPipeline.run).toHaveBeenCalledTimes(2);
    expect(result.verifierResult!.output.passed).toBe(true);
  });

  it('fails after exhausting retries', async () => {
    deps = makeDeps({
      verifier: { verify: vi.fn().mockResolvedValue(makeVerifierResult(false)) } as any,
    });
    orchestrator = new TurnOrchestrator(deps);

    const input = makeInput({
      config: { enableVerifier: true, verifierFailStrategy: 'retry', maxRetries: 2 },
      verifierInput: { characterRules: 'Rules', activeFacts: [] },
    });

    await expect(orchestrator.executeTurn(input)).rejects.toThrow(TurnError);
    await expect(orchestrator.executeTurn(input)).rejects.toThrow(/after \d+ attempts/);

    // 1 initial + 2 retries = 3 attempts
    // But since we're calling executeTurn twice (one for toThrow, one for message check),
    // check the first call's generation count
  });

  // ── Memory Consolidation ────────────────────────────

  it('runs consolidation when enabled with context', async () => {
    const consolidationContext = {
      currentFloorContent: 'Floor content...',
      recentSummaries: ['Summary'],
      existingFacts: [],
    };

    const input = makeInput({
      config: { enableMemoryConsolidation: true },
      consolidationContext,
    });

    const result = await orchestrator.executeTurn(input);

    expect(deps.memoryConsolidator.consolidate).toHaveBeenCalledTimes(1);
    expect(result.consolidationResult).toBeDefined();
    expect(result.consolidationResult!.output.turnSummary).toBe('Summary of the turn');
  });

  it('merges generation summaries into consolidation', async () => {
    deps = makeDeps({
      generationPipeline: {
        run: vi.fn().mockResolvedValue(makeGenOutput({ summaries: ['New summary'] })),
      } as any,
    });
    orchestrator = new TurnOrchestrator(deps);

    const input = makeInput({
      config: { enableMemoryConsolidation: true },
      consolidationContext: {
        currentFloorContent: 'Content',
        recentSummaries: ['Old summary'],
        existingFacts: [],
      },
    });

    await orchestrator.executeTurn(input);

    const consolidateCall = (deps.memoryConsolidator.consolidate as any).mock.calls[0][0];
    expect(consolidateCall.recentSummaries).toEqual(['Old summary', 'New summary']);
  });

  it('emits memory.consolidation_json_parse_failed when consolidation degrades on JSON parsing', async () => {
    deps = makeDeps({
      memoryConsolidator: {
        consolidate: vi.fn().mockResolvedValue({
          output: {
            turnSummary: 'raw fallback summary',
            factsAdd: [],
            factsUpdate: [],
            factsDeprecate: [],
          },
          usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
          degraded: {
            reason: 'json_parse_failed',
            rawText: 'not-json',
            error: new Error('Unexpected token n in JSON at position 0'),
          },
        }),
      } as any,
    });
    orchestrator = new TurnOrchestrator(deps);

    await orchestrator.executeTurn(makeInput({
      config: { enableMemoryConsolidation: true },
      consolidationContext: { currentFloorContent: 'Content', recentSummaries: [], existingFacts: [] },
    }));

    expect(deps.eventBus.emit).toHaveBeenCalledWith('memory.consolidation_json_parse_failed', expect.objectContaining({
      floorId: 'floor-1',
      rawText: 'not-json',
      error: expect.any(Error),
    }));
  });

  // ── 错误处理 ────────────────────────────────────────

  it('marks floor as failed on generation error', async () => {
    deps = makeDeps({
      generationPipeline: {
        run: vi.fn().mockRejectedValue(new Error('LLM timeout')),
      } as any,
    });
    orchestrator = new TurnOrchestrator(deps);

    await expect(orchestrator.executeTurn(makeInput())).rejects.toThrow(TurnError);

    // Should emit generation.failed event
    const emitCalls = (deps.eventBus.emit as any).mock.calls;
    const failedEvents = emitCalls.filter((c: any[]) => c[0] === 'generation.failed');
    expect(failedEvents.length).toBeGreaterThan(0);
  });

  it('does not mask the original generation error when fail compensation cannot overwrite a committed floor', async () => {
    deps = makeDeps({
      generationPipeline: {
        run: vi.fn().mockRejectedValue(new Error('LLM timeout')),
      } as any,
      floorStateMachine: {
        transition: vi.fn().mockResolvedValue(undefined),
        canTransition: vi.fn().mockReturnValue(true),
        fail: vi.fn().mockRejectedValue(new InvalidStateTransitionError('committed', 'failed')),
      } as any,
    });
    orchestrator = new TurnOrchestrator(deps);

    await expect(orchestrator.executeTurn(makeInput())).rejects.toMatchObject({
      name: 'TurnError',
      phase: 'generation',
      message: 'Generation failed: LLM timeout',
    });

    expect(deps.floorStateMachine.fail).toHaveBeenCalledWith('floor-1', expect.any(Error));
  });

  it('marks floor as failed on state transition error', async () => {
    deps = makeDeps({
      floorStateMachine: {
        transition: vi.fn().mockRejectedValue(new Error('Invalid transition')),
        canTransition: vi.fn(),
      } as any,
    });
    orchestrator = new TurnOrchestrator(deps);

    await expect(orchestrator.executeTurn(makeInput())).rejects.toThrow(TurnError);
    await expect(orchestrator.executeTurn(makeInput())).rejects.toThrow('State transition');
  });

  it('includes phase info in TurnError', async () => {
    deps = makeDeps({
      generationPipeline: {
        run: vi.fn().mockRejectedValue(new Error('LLM error')),
      } as any,
    });
    orchestrator = new TurnOrchestrator(deps);

    try {
      await orchestrator.executeTurn(makeInput());
      expect.unreachable('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(TurnError);
      expect((error as TurnError).phase).toBe('generation');
    }
  });

  it('forwards chunk callback', async () => {
    // Make generationPipeline.run invoke the onChunk callback
    deps = makeDeps({
      generationPipeline: {
        run: vi.fn().mockImplementation(async (_input: any, callbacks: any) => {
          callbacks?.onChunk?.('Hello ');
          callbacks?.onChunk?.('World');
          return makeGenOutput();
        }),
      } as any,
    });
    orchestrator = new TurnOrchestrator(deps);

    const chunks: string[] = [];
    await orchestrator.executeTurn(makeInput({
      onChunk: (chunk) => chunks.push(chunk),
    }));

    expect(chunks).toEqual(['Hello ', 'World']);
  });

  it('skips director when not enabled even if input provided', async () => {
    const input = makeInput({
      config: { enableDirector: false },
      directorInput: { recentContext: 'Events', activeFacts: [] },
    });

    const result = await orchestrator.executeTurn(input);

    expect(deps.director.direct).not.toHaveBeenCalled();
    expect(result.directorResult).toBeUndefined();
  });

  it('skips consolidation when no context provided even if enabled', async () => {
    const input = makeInput({
      config: { enableMemoryConsolidation: true },
      // no consolidationContext
    });

    const result = await orchestrator.executeTurn(input);

    expect(deps.memoryConsolidator.consolidate).not.toHaveBeenCalled();
    expect(result.consolidationResult).toBeUndefined();
  });

  it('consolidation failure degrades gracefully without failing the turn', async () => {
    deps = makeDeps({
      memoryConsolidator: {
        consolidate: vi.fn().mockRejectedValue(new Error('Consolidation error')),
      } as any,
    });
    orchestrator = new TurnOrchestrator(deps);

    const input = makeInput({
      config: { enableMemoryConsolidation: true },
      consolidationContext: {
        currentFloorContent: 'Content',
        recentSummaries: [],
        existingFacts: [],
      },
    });

    const result = await orchestrator.executeTurn(input);

    // Turn should succeed with consolidationResult undefined
    expect(result.finalState).toBe('generating');
    expect(result.consolidationResult).toBeUndefined();

    // memory.consolidation_failed event should have been emitted
    const emitCalls = (deps.eventBus.emit as any).mock.calls;
    const failedEvents = emitCalls.filter((c: any[]) => c[0] === 'memory.consolidation_failed');
    expect(failedEvents).toHaveLength(1);
    expect(failedEvents[0][1]).toEqual(
      expect.objectContaining({
        floorId: input.floorId,
        error: expect.any(Error),
      }),
    );
  });
});


// ── Tool Integration Tests ────────────────────────────

describe('TurnOrchestrator — Tool Integration', () => {
  // 工具测试专用工厂
  function makeTestToolProvider(): ToolProvider {
    const tools: ToolDefinition[] = [
      {
        name: 'roll_dice',
        description: 'Roll a dice',
        parameters: { type: 'object', properties: { sides: { type: 'number' } }, required: ['sides'] },
        sideEffectLevel: 'none',
        allowedSlots: [],
        source: 'builtin',
      },
      {
        name: 'get_variable',
        description: 'Get a variable',
        parameters: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
        sideEffectLevel: 'none',
        allowedSlots: [],
        source: 'builtin',
      },
    ];

    return {
      id: 'test-builtin',
      type: 'builtin',
      listTools: vi.fn().mockResolvedValue(tools),
      executeTool: vi.fn().mockResolvedValue({ data: { result: 42 } }),
    };
  }

  function makeToolPermissions(overrides: Partial<ToolPermissions> = {}): ToolPermissions {
    return {
      enabled: true,
      maxCallsPerTurn: 10,
      maxStepsPerGeneration: 3,
      ...overrides,
    };
  }

  let deps: TurnOrchestratorDeps;
  let orchestrator: TurnOrchestrator;

  beforeEach(() => {
    deps = makeDeps();
    orchestrator = new TurnOrchestrator(deps);
  });

  it('passes tools to generation pipeline when enableTools is true (inline mode)', async () => {
    const registry = new ToolRegistry();
    registry.register(makeTestToolProvider());

    const input = makeInput({
      config: { enableTools: true, toolMode: 'inline' },
      toolRegistry: registry,
      toolPermissions: makeToolPermissions(),
    });

    await orchestrator.executeTurn(input);

    // generationPipeline.run 应该收到 tools 和 maxSteps
    const runCall = (deps.generationPipeline.run as any).mock.calls[0][0];
    expect(runCall.tools).toBeDefined();
    expect(typeof runCall.tools).toBe('object');
    expect(runCall.tools['roll_dice']).toBeDefined();
    expect(runCall.tools['get_variable']).toBeDefined();
    expect(runCall.maxSteps).toBe(3);
  });

  it('does not pass tools when enableTools is false', async () => {
    const registry = new ToolRegistry();
    registry.register(makeTestToolProvider());

    const input = makeInput({
      config: { enableTools: false },
      toolRegistry: registry,
      toolPermissions: makeToolPermissions(),
    });

    await orchestrator.executeTurn(input);

    const runCall = (deps.generationPipeline.run as any).mock.calls[0][0];
    expect(runCall.tools).toBeUndefined();
    expect(runCall.maxSteps).toBeUndefined();
  });

  it('does not pass tools when toolRegistry is not provided', async () => {
    const input = makeInput({
      config: { enableTools: true },
      // no toolRegistry
      toolPermissions: makeToolPermissions(),
    });

    await orchestrator.executeTurn(input);

    const runCall = (deps.generationPipeline.run as any).mock.calls[0][0];
    expect(runCall.tools).toBeUndefined();
  });

  it('does not pass tools when toolPermissions is not provided', async () => {
    const registry = new ToolRegistry();
    registry.register(makeTestToolProvider());

    const input = makeInput({
      config: { enableTools: true },
      toolRegistry: registry,
      // no toolPermissions
    });

    await orchestrator.executeTurn(input);

    const runCall = (deps.generationPipeline.run as any).mock.calls[0][0];
    expect(runCall.tools).toBeUndefined();
  });

  it('does not pass tools in standalone mode', async () => {
    const registry = new ToolRegistry();
    registry.register(makeTestToolProvider());

    const input = makeInput({
      config: { enableTools: true, toolMode: 'standalone' },
      toolRegistry: registry,
      toolPermissions: makeToolPermissions(),
    });

    await orchestrator.executeTurn(input);

    const runCall = (deps.generationPipeline.run as any).mock.calls[0][0];
    expect(runCall.tools).toBeUndefined();
  });

  it('collects real toolExecutionRecords from ToolExecutor', async () => {
    deps = makeDeps({
      generationPipeline: {
        run: vi.fn(async (runInput) => {
          await runInput.tools?.roll_dice?.execute({ sides: 20 });
          await runInput.tools?.get_variable?.execute({ key: 'hp' });
          return makeGenOutput();
        }),
      } as any,
    });
    orchestrator = new TurnOrchestrator(deps);

    const registry = new ToolRegistry();
    registry.register(makeTestToolProvider());

    const input = makeInput({
      config: { enableTools: true, toolMode: 'inline' },
      toolRegistry: registry,
      toolPermissions: makeToolPermissions(),
      pageId: 'input-page-1',
    });

    const result = await orchestrator.executeTurn(input);

    expect(result.toolExecutionRecords).toBeDefined();
    expect(result.toolExecutionRecords).toHaveLength(2);
    expect(result.toolExecutionRecords![0]).toMatchObject({
      floorId: 'floor-1',
      pageId: 'input-page-1',
      callerSlot: 'narrator',
      providerId: 'test-builtin',
      toolName: 'roll_dice',
      status: 'success',
    });
    expect(result.toolExecutionRecords![1]).toMatchObject({
      toolName: 'get_variable',
      status: 'success',
    });
    expect(JSON.parse(result.toolExecutionRecords![0]!.argsJson)).toEqual({ sides: 20 });
    expect(JSON.parse(result.toolExecutionRecords![0]!.resultJson)).toEqual({ result: 42 });
  });

  it('passes accountId into tool execution variableContext', async () => {
    const provider = makeTestToolProvider();

    deps = makeDeps({
      generationPipeline: {
        run: vi.fn(async (runInput) => {
          await runInput.tools?.get_variable?.execute({ key: 'hp' });
          return makeGenOutput();
        }),
      } as any,
    });
    orchestrator = new TurnOrchestrator(deps);

    const registry = new ToolRegistry();
    registry.register(provider);

    await orchestrator.executeTurn(makeInput({
      accountId: 'account-1',
      config: { enableTools: true, toolMode: 'inline' },
      toolRegistry: registry,
      toolPermissions: makeToolPermissions(),
    }));

    const executeCalls = (provider.executeTool as any).mock.calls;
    expect(executeCalls).toHaveLength(1);

    const context = executeCalls[0][2];
    expect(context.accountId).toBe('account-1');
    expect(context.variableContext.accountId).toBe('account-1');
    expect(context.variableContext.sessionId).toBe('session-1');
    expect(context.variableContext.floorId).toBe('floor-1');
  });

  it('does not use floorId as a fake pageId when no real pageId is provided', async () => {
    deps = makeDeps({
      generationPipeline: {
        run: vi.fn(async (runInput) => {
          await runInput.tools?.roll_dice?.execute({ sides: 20 });
          return makeGenOutput();
        }),
      } as any,
    });
    orchestrator = new TurnOrchestrator(deps);

    const registry = new ToolRegistry();
    registry.register(makeTestToolProvider());

    const input = makeInput({
      config: { enableTools: true, toolMode: 'inline' },
      toolRegistry: registry,
      toolPermissions: makeToolPermissions(),
    });

    const result = await orchestrator.executeTurn(input);

    expect(result.toolExecutionRecords).toBeDefined();
    expect(result.toolExecutionRecords).toHaveLength(1);
    expect(result.toolExecutionRecords![0]!.pageId).toBeUndefined();
  });

  it('respects permissions: disabled tools = no tools passed', async () => {
    const registry = new ToolRegistry();
    registry.register(makeTestToolProvider());

    const input = makeInput({
      config: { enableTools: true, toolMode: 'inline' },
      toolRegistry: registry,
      toolPermissions: makeToolPermissions({ enabled: false }),
    });

    await orchestrator.executeTurn(input);

    const runCall = (deps.generationPipeline.run as any).mock.calls[0][0];
    // listForSlot returns [] when permissions.enabled is false
    expect(runCall.tools).toBeUndefined();
  });

  it('wraps tool setup errors in TurnError with tool_setup phase', async () => {
    const badProvider: ToolProvider = {
      id: 'bad-provider',
      type: 'builtin',
      listTools: vi.fn().mockRejectedValue(new Error('Provider init failed')),
      executeTool: vi.fn(),
    };

    const registry = new ToolRegistry();
    registry.register(badProvider);

    const input = makeInput({
      config: { enableTools: true, toolMode: 'inline' },
      toolRegistry: registry,
      toolPermissions: makeToolPermissions(),
    });

    try {
      await orchestrator.executeTurn(input);
      expect.unreachable('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(TurnError);
      expect((error as TurnError).phase).toBe('tool_setup');
      expect((error as TurnError).message).toContain('Tool setup failed');
    }
  });

  it('uses maxStepsPerGeneration from permissions', async () => {
    const registry = new ToolRegistry();
    registry.register(makeTestToolProvider());

    const input = makeInput({
      config: { enableTools: true, toolMode: 'inline' },
      toolRegistry: registry,
      toolPermissions: makeToolPermissions({ maxStepsPerGeneration: 8 }),
    });

    await orchestrator.executeTurn(input);

    const runCall = (deps.generationPipeline.run as any).mock.calls[0][0];
    expect(runCall.maxSteps).toBe(8);
  });

  it('defaults maxSteps to 5 when maxStepsPerGeneration is not set', async () => {
    const registry = new ToolRegistry();
    registry.register(makeTestToolProvider());

    const input = makeInput({
      config: { enableTools: true, toolMode: 'inline' },
      toolRegistry: registry,
      toolPermissions: {
        enabled: true,
        // maxStepsPerGeneration not set
      },
    });

    await orchestrator.executeTurn(input);

    const runCall = (deps.generationPipeline.run as any).mock.calls[0][0];
    expect(runCall.maxSteps).toBe(5);
  });
});
