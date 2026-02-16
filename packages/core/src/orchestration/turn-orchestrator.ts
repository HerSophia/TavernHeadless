import type { FloorState } from '@tavern/shared';
import type { CoreEventBus } from '../events/index.js';
import type { FloorStateMachine } from '../floor/floor-state-machine.js';
import type { InstanceSlot, ModelConfig } from '../llm/types.js';
import type { GenerationPipeline } from '../generation/generation-pipeline.js';
import type { GenerationOutput } from '../generation/types.js';
import type { TokenUsage } from '../llm/types.js';
import type { MemoryStore } from '../memory/memory-store.js';
import type { MemoryConsolidator } from '../memory/memory-consolidator.js';
import type { ConsolidationResult } from '../memory/memory-consolidator.js';
import type { MemoryInjectionResult } from '../memory/types.js';
import type { Director } from './director.js';
import type { DirectorResult } from './director.js';
import type { Verifier } from './verifier.js';
import type { VerifierResult } from './verifier.js';
import type {
  TurnConfig,
  TurnInput,
  TurnOutput,
} from './types.js';

// ── 错误类 ────────────────────────────────────────────

export class TurnError extends Error {
  constructor(
    message: string,
    public readonly phase: TurnPhase,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'TurnError';
  }
}

export type TurnPhase =
  | 'transition'
  | 'director'
  | 'memory_retrieval'
  | 'generation'
  | 'verifier'
  | 'memory_consolidation'
  | 'commit';

// ── 依赖注入 ──────────────────────────────────────────

export interface TurnOrchestratorDeps {
  floorStateMachine: FloorStateMachine;
  generationPipeline: GenerationPipeline;
  memoryStore: MemoryStore;
  memoryConsolidator: MemoryConsolidator;
  director: Director;
  verifier: Verifier;
  eventBus: CoreEventBus;
}

// ── 工具函数 ──────────────────────────────────────────

function safeToken(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return 0;
  }

  return Math.trunc(value);
}

function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    promptTokens: safeToken(a.promptTokens) + safeToken(b.promptTokens),
    completionTokens:
      safeToken(a.completionTokens) + safeToken(b.completionTokens),
    totalTokens: safeToken(a.totalTokens) + safeToken(b.totalTokens),
  };
}

function zeroUsage(): TokenUsage {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}

function resolveConfig(config?: TurnConfig): Required<TurnConfig> {
  return {
    enableDirector: config?.enableDirector ?? false,
    enableVerifier: config?.enableVerifier ?? false,
    enableMemoryConsolidation: config?.enableMemoryConsolidation ?? false,
    verifierFailStrategy: config?.verifierFailStrategy ?? 'warn',
    maxRetries: config?.maxRetries ?? 1,
  };
}

/**
 * 解析指定槽位的有效 ModelConfig。
 * 优先级：modelOverrides[slot] > model（旧字段，兼容为 narrator）> undefined
 */
function resolveSlotModel(
  input: TurnInput,
  slot: InstanceSlot,
): ModelConfig | undefined {
  const fromOverrides = input.modelOverrides?.[slot];
  if (fromOverrides) return fromOverrides;
  // 向后兼容：旧 model 字段视为 narrator 的覆盖
  if (slot === 'narrator') return input.model;
  return undefined;
}

// ── TurnOrchestrator ──────────────────────────────────

/**
 * 完整回合编排器
 *
 * 串联一次完整回合的全部步骤：
 *
 * 1. draft → generating（状态转移）
 * 2. Director（可选）：分析局势，给出指令
 * 3. Memory 检索：按预算选取相关记忆
 * 4. Narrator 生成：调用 GenerationPipeline
 * 5. Verifier（可选）：检查生成内容一致性
 * 6. Memory 整理（可选）：整理/新增/更新/废弃事实
 * 7. generating → committed（状态转移）
 *
 * 任何步骤失败都会将楼层标记为 failed。
 */
export class TurnOrchestrator {
  private readonly deps: TurnOrchestratorDeps;

  constructor(deps: TurnOrchestratorDeps) {
    this.deps = deps;
  }

  /**
   * 执行一次完整回合。
   *
   * @param input - 回合输入
   * @returns 回合输出（包含生成结果、各组件结果、token 统计）
   * @throws {TurnError} 回合执行中的错误（楼层已标记为 failed）
   */
  async executeTurn(input: TurnInput): Promise<TurnOutput> {
    const cfg = resolveConfig(input.config);
    let totalUsage = zeroUsage();
    let directorResult: DirectorResult | undefined;
    let verifierResult: VerifierResult | undefined;
    let memoryInjection: MemoryInjectionResult | undefined;
    let consolidationResult: ConsolidationResult | undefined;
    let generation: GenerationOutput | undefined;

    try {
      // ── 1. draft → generating ──
      await this.transitionOrFail(input.floorId, 'generating');

      // ── 2. Director（可选） ──
      if (cfg.enableDirector && input.directorInput) {
        directorResult = await this.runDirector(input);
        totalUsage = addUsage(totalUsage, directorResult.usage);
      }

      // ── 3. Memory 检索 ──
      if (input.memoryOptions) {
        memoryInjection = await this.runMemoryRetrieval(input);
      }

      // ── 4 & 5. 生成 + Verifier（含重试逻辑） ──
      const genResult = await this.runGenerationWithVerifier(input, cfg);
      generation = genResult.generation;
      verifierResult = genResult.verifierResult;
      totalUsage = addUsage(totalUsage, generation.usage);
      if (verifierResult) {
        totalUsage = addUsage(totalUsage, verifierResult.usage);
      }

      // ── 6. Memory 整理（可选） ──
      if (cfg.enableMemoryConsolidation && input.consolidationContext) {
        consolidationResult = await this.runConsolidation(input, generation);
        totalUsage = addUsage(totalUsage, consolidationResult.usage);
      }

      // ── 7. generating → committed ──
      await this.transitionOrFail(input.floorId, 'committed');

      return {
        floorId: input.floorId,
        generatedText: generation.text,
        rawText: generation.rawText,
        summaries: generation.summaries,
        directorResult,
        verifierResult,
        memoryInjection,
        consolidationResult,
        totalUsage,
        finalState: 'committed',
      };
    } catch (error) {
      // 尝试将楼层标记为 failed
      await this.tryMarkFailed(input.floorId, error);

      if (error instanceof TurnError) throw error;

      throw new TurnError(
        `Turn failed: ${error instanceof Error ? error.message : String(error)}`,
        'generation',
        error,
      );
    }
  }

  // ── 内部步骤 ────────────────────────────────────────

  private async transitionOrFail(
    floorId: string,
    target: FloorState,
  ): Promise<void> {
    try {
      await this.deps.floorStateMachine.transition(floorId, target);
    } catch (error) {
      throw new TurnError(
        `State transition to '${target}' failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        target === 'committed' ? 'commit' : 'transition',
        error,
      );
    }
  }

  private async runDirector(input: TurnInput): Promise<DirectorResult> {
    try {
      return await this.deps.director.direct(
        input.directorInput!,
        undefined,
        resolveSlotModel(input, 'director'),
      );
    } catch (error) {
      throw new TurnError(
        `Director failed: ${error instanceof Error ? error.message : String(error)}`,
        'director',
        error,
      );
    }
  }

  private async runMemoryRetrieval(
    input: TurnInput,
  ): Promise<MemoryInjectionResult> {
    try {
      return await this.deps.memoryStore.prepareInjection(
        input.sessionId,
        input.memoryOptions!,
      );
    } catch (error) {
      throw new TurnError(
        `Memory retrieval failed: ${error instanceof Error ? error.message : String(error)}`,
        'memory_retrieval',
        error,
      );
    }
  }

  private async runGeneration(
    input: TurnInput,
  ): Promise<GenerationOutput> {
    try {
      // 发出 generation.started 事件
      await this.deps.eventBus.emit('generation.started', {
        floorId: input.floorId,
      });

      let accumulatedLength = 0;
      const result = await this.deps.generationPipeline.run(
        {
          messages: input.messages,
          params: input.generationParams,
          preProcess: input.preProcess,
          postProcess: input.postProcess,
          model: resolveSlotModel(input, 'narrator'),
          abortSignal: input.abortSignal,
          summaryOptions: input.summaryOptions,
        },
        {
          onChunk: (chunk) => {
            accumulatedLength += chunk.length;
            // 转发到 EventBus（fire-and-forget）
            void this.deps.eventBus.emit('generation.chunk', {
              floorId: input.floorId,
              chunk,
              accumulatedLength,
            });
            // 转发到调用方回调
            input.onChunk?.(chunk);
          },
        },
      );

      // 发出 generation.completed 事件
      await this.deps.eventBus.emit('generation.completed', {
        floorId: input.floorId,
        text: result.text,
        usage: result.usage,
        finishReason: result.finishReason,
        summaries: result.summaries,
      });

      return result;
    } catch (error) {
      // 发出 generation.failed 事件
      await this.deps.eventBus.emit('generation.failed', {
        floorId: input.floorId,
        error: error instanceof Error ? error : new Error(String(error)),
      });

      throw new TurnError(
        `Generation failed: ${error instanceof Error ? error.message : String(error)}`,
        'generation',
        error,
      );
    }
  }

  private async runVerifier(
    input: TurnInput,
    generatedText: string,
  ): Promise<VerifierResult> {
    try {
      return await this.deps.verifier.verify(
        {
          ...input.verifierInput!,
          generatedText,
        },
        undefined,
        resolveSlotModel(input, 'verifier'),
      );
    } catch (error) {
      throw new TurnError(
        `Verifier failed: ${error instanceof Error ? error.message : String(error)}`,
        'verifier',
        error,
      );
    }
  }

  /**
   * 执行生成 + Verifier（含重试逻辑）。
   *
   * retry 策略下，如果 Verifier 报告 issues，会重新执行生成 + 验证，
   * 最多 maxRetries 次。
   */
  private async runGenerationWithVerifier(
    input: TurnInput,
    cfg: Required<TurnConfig>,
  ): Promise<{ generation: GenerationOutput; verifierResult?: VerifierResult }> {
    const maxAttempts = cfg.enableVerifier && cfg.verifierFailStrategy === 'retry'
      ? 1 + cfg.maxRetries
      : 1;

    let lastGeneration: GenerationOutput | undefined;
    let lastVerifierResult: VerifierResult | undefined;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      lastGeneration = await this.runGeneration(input);

      if (!cfg.enableVerifier || !input.verifierInput) {
        return { generation: lastGeneration };
      }

      lastVerifierResult = await this.runVerifier(input, lastGeneration.text);

      if (lastVerifierResult.output.passed) {
        return { generation: lastGeneration, verifierResult: lastVerifierResult };
      }

      // Verifier 不通过
      if (cfg.verifierFailStrategy === 'warn') {
        // warn: 继续，不阻断
        return { generation: lastGeneration, verifierResult: lastVerifierResult };
      }

      if (cfg.verifierFailStrategy === 'block') {
        throw new TurnError(
          `Verifier blocked: ${lastVerifierResult.output.suggestion ?? 'Verification failed'}`,
          'verifier',
        );
      }

      // retry: 继续循环
    }

    // 重试耗尽
    if (cfg.verifierFailStrategy === 'retry') {
      throw new TurnError(
        `Verifier failed after ${maxAttempts} attempts: ${
          lastVerifierResult?.output.suggestion ?? 'Verification failed'
        }`,
        'verifier',
      );
    }

    return { generation: lastGeneration!, verifierResult: lastVerifierResult };
  }

  private async runConsolidation(
    input: TurnInput,
    generation: GenerationOutput,
  ): Promise<ConsolidationResult> {
    try {
      return await this.deps.memoryConsolidator.consolidate({
        currentFloorContent: input.consolidationContext!.currentFloorContent,
        recentSummaries: [
          ...input.consolidationContext!.recentSummaries,
          ...generation.summaries,
        ],
        existingFacts: input.consolidationContext!.existingFacts,
        scope: 'chat',
        scopeId: input.sessionId,
        sourceFloorId: input.floorId,
        model: resolveSlotModel(input, 'memory'),
      });
    } catch (error) {
      // Memory 整理失败不应阻断回合，降级处理
      // 但仍要记录错误
      throw new TurnError(
        `Memory consolidation failed: ${error instanceof Error ? error.message : String(error)}`,
        'memory_consolidation',
        error,
      );
    }
  }

  private async tryMarkFailed(floorId: string, error: unknown): Promise<void> {
    try {
      await this.deps.floorStateMachine.transition(floorId, 'failed');
    } catch {
      // 如果标记失败也失败了（比如已经是 committed），忽略
    }

    try {
      // 尝试获取楼层信息发事件
      await this.deps.eventBus.emit('floor.failed', {
        floor: { id: floorId } as any,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    } catch {
      // fire-and-forget
    }
  }
}
