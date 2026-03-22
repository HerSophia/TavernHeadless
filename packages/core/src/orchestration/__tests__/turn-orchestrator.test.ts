import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TurnOrchestrator, TurnError } from '../turn-orchestrator.js';
import type { TurnOrchestratorDeps } from '../turn-orchestrator.js';
import type { TurnInput } from '../types.js';
import type { GenerationOutput } from '../../generation/types.js';
import type { DirectorResult } from '../director.js';
import type { VerifierResult } from '../verifier.js';
import type { ConsolidationResult } from '../../memory/memory-consolidator.js';
import type { MemoryInjectionResult } from '../../memory/types.js';

// ── MemoryItem 工厂 ──────────────────────────────────

import type { MemoryItem } from '../../memory/types.js';

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
    expect(result.finalState).toBe('committed');
    expect(result.directorResult).toBeUndefined();
    expect(result.verifierResult).toBeUndefined();
    expect(result.consolidationResult).toBeUndefined();
    expect(result.memoryInjection).toBeUndefined();

    // 状态转移：draft → generating → committed
    expect(deps.floorStateMachine.transition).toHaveBeenCalledTimes(2);
    expect(deps.floorStateMachine.transition).toHaveBeenNthCalledWith(1, 'floor-1', 'generating');
    expect(deps.floorStateMachine.transition).toHaveBeenNthCalledWith(2, 'floor-1', 'committed');
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
    expect(result.finalState).toBe('committed');

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
    const transitionCalls = (deps.floorStateMachine.transition as any).mock.calls;
    const failedCalls = transitionCalls.filter((c: any[]) => c[1] === 'failed');
    expect(failedCalls.length).toBeGreaterThan(0);
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

    expect(result.finalState).toBe('committed');
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

    expect(result.finalState).toBe('committed');
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
    expect(result.finalState).toBe('committed');
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
