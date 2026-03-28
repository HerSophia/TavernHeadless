import type { FloorState } from '@tavern/shared';
import type { CoreEventBus } from '../events/index.js';
import type { FloorStateMachine } from '../floor/floor-state-machine.js';
import type { GenerationParams, InstanceSlot, ModelConfig, TokenUsage } from '../llm/types.js';
import type { GenerationPipeline } from '../generation/generation-pipeline.js';
import type { GenerationOutput } from '../generation/types.js';
import type { MemoryStore } from '../memory/memory-store.js';
import type { MemoryConsolidator } from '../memory/memory-consolidator.js';
import type { ConsolidationResult } from '../memory/memory-consolidator.js';
import type { MemoryInjectionResult } from '../memory/types.js';
import type {
  ExecutedToolCallRecord,
  ToolExecutionContext,
  ToolExecutionLifecycleState,
  ToolExecutionProviderType,
  ToolExecutionStatus,
  ToolReplaySafety,
  ToolSideEffectLevel,
} from '../tools/types.js';
import {
  evaluateExecutedToolCallReplaySafety,
  isAutoReplaySafe,
} from '../tools/replay-safety.js';
import type { ToolRegistry } from '../tools/tool-registry.js';
import type { LLMToolEntry } from '../tools/tool-executor.js';
import { ToolExecutor } from '../tools/tool-executor.js';
import type { Director } from './director.js';
import type { DirectorResult } from './director.js';
import type { Verifier } from './verifier.js';
import type { ToolExecutionRepository } from '../ports/tool-execution-repository.js';
import type { VerifierResult } from './verifier.js';
import type {
  TurnConfig,
  TurnExecutionResult,
  TurnInput,
  ToolMode,
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

export class UnsupportedToolModeError extends Error {
  constructor(public readonly toolMode: Exclude<ToolMode, 'inline'>) {
    super(`Tool mode '${toolMode}' is not supported. Only 'inline' is currently supported.`);
    this.name = 'UnsupportedToolModeError';
  }
}

export interface ToolReplayBlockedExecution {
  executionId: string;
  toolName: string;
  providerId: string;
  providerType?: ToolExecutionProviderType;
  sideEffectLevel?: ToolSideEffectLevel;
  status: ToolExecutionStatus;
  lifecycleState?: ToolExecutionLifecycleState;
  replaySafety: ToolReplaySafety;
  reason: string;
}

export class ToolReplayBlockedError extends Error {
  constructor(
    public readonly blockingExecutions: ToolReplayBlockedExecution[],
    message?: string,
  ) {
    super(
      message
      ?? `Tool replay blocked: ${blockingExecutions
        .map((execution) => `${execution.toolName} (${execution.replaySafety})`)
        .join(', ')}`,
    );
    this.name = 'ToolReplayBlockedError';
  }
}

export type TurnPhase =
  | 'transition'
  | 'director'
  | 'tool_setup'
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
  toolExecutionRepository?: ToolExecutionRepository;
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

function toReplayBlockedExecution(record: ExecutedToolCallRecord): ToolReplayBlockedExecution | null {
  const evaluation = evaluateExecutedToolCallReplaySafety(record);
  if (isAutoReplaySafe(evaluation.replaySafety)) {
    return null;
  }

  return {
    executionId: record.id,
    toolName: record.toolName,
    providerId: record.providerId,
    providerType: record.providerType,
    sideEffectLevel: record.sideEffectLevel,
    status: record.status,
    lifecycleState: record.lifecycleState,
    replaySafety: evaluation.replaySafety,
    reason: evaluation.reason,
  };
}

function resolveConfig(config?: TurnConfig): Required<TurnConfig> {
  return {
    enableDirector: config?.enableDirector ?? false,
    enableVerifier: config?.enableVerifier ?? false,
    enableMemoryConsolidation: config?.enableMemoryConsolidation ?? false,
    verifierFailStrategy: config?.verifierFailStrategy ?? 'warn',
    maxRetries: config?.maxRetries ?? 1,
    enableTools: config?.enableTools ?? false,
    toolMode: config?.toolMode ?? 'inline',
  };
}

function assertSupportedToolMode(config: Required<TurnConfig>): void {
  if (config.enableTools && config.toolMode !== 'inline') {
    throw new UnsupportedToolModeError(config.toolMode as Exclude<ToolMode, 'inline'>);
  }
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

/**
 * 解析指定槽位的 GenerationParams 覆盖。
 * - narrator: 在全局 generationParams 的基础上应用 narrator 覆盖
 * - 其他槽位: 仅使用对应槽位覆盖（无则 undefined）
 */
function resolveSlotGenerationParams(
  input: TurnInput,
  slot: InstanceSlot,
): GenerationParams | undefined {
  const fromOverrides = input.generationParamsOverrides?.[slot];
  if (slot === 'narrator') {
    if (!fromOverrides) return input.generationParams;
    return { ...input.generationParams, ...fromOverrides };
  }
  return fromOverrides;
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
 * 7. 返回生成阶段结果（floor 保持 generating）
 *
 * 任何步骤失败都会将楼层标记为 failed。最终 committed 由上层提交服务负责。
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
  async executeTurn(input: TurnInput): Promise<TurnExecutionResult> {
    const cfg = resolveConfig(input.config);
    assertSupportedToolMode(cfg);
    let totalUsage = zeroUsage();
    let toolExecutor: ToolExecutor | undefined;
    let narratorLLMTools: Record<string, LLMToolEntry> | undefined;
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

      // ── 2b. 构建工具（可选） ──
      if (cfg.enableTools && input.toolRegistry && input.toolPermissions) {
        try {
          toolExecutor = new ToolExecutor(
            input.toolRegistry,
            this.deps.eventBus,
            this.deps.toolExecutionRepository,
            input.toolExecutionRunId,
          );
          toolExecutor.resetTurnCounter(input.toolExecutionRunId);

          const narratorTools = await input.toolRegistry.listForSlot(
            'narrator',
            input.toolPermissions,
          );
          if (narratorTools.length > 0) {
            const toolContext = this.buildToolContext(input, 'narrator');
            narratorLLMTools = toolExecutor.buildLLMTools(
              narratorTools,
              toolContext,
              input.toolPermissions,
            );
          }
        } catch (error) {
          throw new TurnError(
            `Tool setup failed: ${error instanceof Error ? error.message : String(error)}`,
            'tool_setup',
            error,
          );
        }
      }

      // ── 3. Memory 检索 ──
      if (input.memoryOptions) {
        memoryInjection = await this.runMemoryRetrieval(input);
      }

      // ── 4 & 5. 生成 + Verifier（含重试逻辑 + 工具注入） ──
      const genResult = await this.runGenerationWithVerifier(input, cfg, narratorLLMTools, toolExecutor);
      generation = genResult.generation;
      verifierResult = genResult.verifierResult;
      totalUsage = addUsage(totalUsage, generation.usage);
      if (verifierResult) {
        totalUsage = addUsage(totalUsage, verifierResult.usage);
      }

      // ── 6. Memory 整理（可选） ──
      if (cfg.enableMemoryConsolidation && input.consolidationContext) {
        consolidationResult = await this.runConsolidation(input, generation);
        if (consolidationResult) {
          totalUsage = addUsage(totalUsage, consolidationResult.usage);
        }
      }

      const toolExecutionRecords = toolExecutor?.getExecutionRecords();
      const bufferedVariableMutations = toolExecutor?.getBufferedVariableMutations();

      return {
        floorId: input.floorId,
        finalState: 'generating',
        generatedText: generation.text,
        rawText: generation.rawText,
        summaries: generation.summaries,
        directorResult,
        verifierResult,
        memoryInjection,
        consolidationResult,
        totalUsage,
        ...(toolExecutionRecords && toolExecutionRecords.length > 0
          ? { toolExecutionRecords }
          : {}),
        ...(bufferedVariableMutations && bufferedVariableMutations.length > 0
          ? { bufferedVariableMutations }
          : {}),
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
        resolveSlotGenerationParams(input, 'director'),
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
    narratorLLMTools?: Record<string, LLMToolEntry>,
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
          params: resolveSlotGenerationParams(input, 'narrator') ?? input.generationParams,
          preProcess: input.preProcess,
          postProcess: input.postProcess,
          model: resolveSlotModel(input, 'narrator'),
          abortSignal: input.abortSignal,
          summaryOptions: input.summaryOptions,
          ...(narratorLLMTools ? { tools: narratorLLMTools } : {}),
          ...(narratorLLMTools ? { maxSteps: input.toolPermissions?.maxStepsPerGeneration ?? 5 } : {}),
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
        resolveSlotGenerationParams(input, 'verifier'),
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
    narratorLLMTools?: Record<string, LLMToolEntry>,
    toolExecutor?: ToolExecutor,
  ): Promise<{ generation: GenerationOutput; verifierResult?: VerifierResult }> {
    const maxAttempts = cfg.enableVerifier && cfg.verifierFailStrategy === 'retry'
      ? 1 + cfg.maxRetries
      : 1;

    let lastGeneration: GenerationOutput | undefined;
    let lastVerifierResult: VerifierResult | undefined;
    let lastGenerationAttemptNo: number | undefined;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      lastGenerationAttemptNo = toolExecutor?.beginGenerationAttempt();
      const attemptExecutionStart = toolExecutor?.getExecutionRecordCount() ?? 0;
      lastGeneration = await this.runGeneration(input, narratorLLMTools);

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
        if (lastGenerationAttemptNo !== undefined) {
          toolExecutor?.discardGenerationAttempt(lastGenerationAttemptNo);
        }
        throw new TurnError(
          `Verifier blocked: ${lastVerifierResult.output.suggestion ?? 'Verification failed'}`,
          'verifier',
        );
      }

      const blockingExecutions = toolExecutor
        ? toolExecutor
          .getExecutionRecordsSince(attemptExecutionStart)
          .map((record) => toReplayBlockedExecution(record))
          .filter((record): record is ToolReplayBlockedExecution => record !== null)
        : [];

      if (blockingExecutions.length > 0) {
        if (lastGenerationAttemptNo !== undefined) {
          toolExecutor?.discardGenerationAttempt(lastGenerationAttemptNo);
        }

        const replayBlockedMessage = `Verifier retry blocked because replaying tool executions would be unsafe: ${blockingExecutions
          .map((execution) => `${execution.toolName} (${execution.replaySafety})`)
          .join(', ')}`;

        throw new TurnError(
          replayBlockedMessage,
          'verifier',
          new ToolReplayBlockedError(blockingExecutions, replayBlockedMessage),
        );
      }

      if (lastGenerationAttemptNo !== undefined) {
        toolExecutor?.discardGenerationAttempt(lastGenerationAttemptNo);
      }

      // retry: 继续循环
    }

    // 重试耗尽
    if (cfg.verifierFailStrategy === 'retry') {
      if (lastGenerationAttemptNo !== undefined) {
        toolExecutor?.discardGenerationAttempt(lastGenerationAttemptNo);
      }

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
  ): Promise<ConsolidationResult | undefined> {
    try {
      const result = await this.deps.memoryConsolidator.consolidate({
        currentFloorContent: input.consolidationContext!.currentFloorContent,
        recentSummaries: [
          ...input.consolidationContext!.recentSummaries,
          ...generation.summaries,
        ],
        existingFacts: input.consolidationContext!.existingFacts,
        scope: 'chat',
        scopeId: input.sessionId,
        sourceFloorId: input.floorId,
        params: resolveSlotGenerationParams(input, 'memory'),
        model: resolveSlotModel(input, 'memory'),
      });

      if (result.degraded?.reason === 'json_parse_failed') {
        try {
          await this.deps.eventBus.emit('memory.consolidation_json_parse_failed', {
            floorId: input.floorId,
            rawText: result.degraded.rawText,
            error: result.degraded.error,
          });
        } catch {
          // fire-and-forget
        }
      }

      return result;
    } catch (error) {
      // Memory 整理失败不应阻断回合，降级处理
      // 发出事件供外部监控，但不抛出异常
      try {
        await this.deps.eventBus.emit('memory.consolidation_failed', {
          floorId: input.floorId,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      } catch {
        // fire-and-forget
      }
      return undefined;
    }
  }

  private async tryMarkFailed(floorId: string, error: unknown): Promise<void> {
    const normalizedError = error instanceof Error ? error : new Error(String(error));

    try {
      await this.deps.floorStateMachine.fail(floorId, normalizedError);
    } catch {
      // 如果标记失败也失败了（比如已经是 committed），忽略
    }
  }

  /**
   * 构建工具执行上下文。
   *
   * 工具记录以 floor 为主归属。
   * 当上层已经持有真实 pageId（例如 input page）时，可一并透传。
   */
  private buildToolContext(
    input: TurnInput,
    slot: InstanceSlot,
  ): ToolExecutionContext {
    return {
      sessionId: input.sessionId,
      accountId: input.accountId,
      floorId: input.floorId,
      pageId: input.pageId,
      callerSlot: slot,
      variableContext: {
        sessionId: input.sessionId,
        accountId: input.accountId,
        floorId: input.floorId,
        pageId: input.pageId,
      },
      abortSignal: input.abortSignal,
    };
  }
}
