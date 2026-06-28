import type { FloorState } from '@tavern/shared';
import type { CoreEventBus } from '../events/index.js';
import type { FloorStateMachine } from '../floor/floor-state-machine.js';
import type { GenerationParams, InstanceSlot, ModelConfig, TokenUsage } from '../llm/types.js';
import type { GenerationPipeline } from '../generation/generation-pipeline.js';
import type { TokenCounter } from '../prompt/types.js';
import type { GenerationOutput } from '../generation/types.js';
import type { MemoryStore } from '../memory/memory-store.js';
import type { MemoryConsolidator } from '../memory/memory-consolidator.js';
import type { ConsolidationResult } from '../memory/memory-consolidator.js';
import type { MemoryInjectionResult } from '../memory/types.js';
import type {
  ExecutedToolCallRecord,
  ToolDefinition,
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
import {
  TextProtocolToolCallParser,
  TextProtocolToolResultFormatter,
} from '../tools/transport/index.js';
import type { ToolCallParseDiagnostic } from '../tools/transport/index.js';
import { TEXT_PROTOCOL_TOOL_CALL_CLOSE } from '../tools/transport/text-protocol/constants.js';
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
import { TextProtocolAgentLoop } from './text-protocol-agent-loop.js';
import type { AgentLoopGenerate } from './text-protocol-agent-loop.js';

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
  tokenCounter?: TokenCounter;
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

function countToolResultWritebackTokens(blocks: string[], tokenCounter?: TokenCounter): number {
  return blocks.reduce((sum, block) => sum + (tokenCounter?.count(block) ?? block.length), 0);
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

const TEXT_PROTOCOL_TOOL_CALL_START = '<tool_call';
const TEXT_PROTOCOL_TOOL_RESULT_BUDGET_GROUP = 'tool_result';

function findTextProtocolToolCallStart(text: string, startIndex = 0): number {
  let cursor = startIndex;
  while (cursor < text.length) {
    const candidate = text.indexOf(TEXT_PROTOCOL_TOOL_CALL_START, cursor);
    if (candidate === -1) {
      return -1;
    }

    const after = text[candidate + TEXT_PROTOCOL_TOOL_CALL_START.length];
    if (after === undefined || after === '>' || /\s/.test(after)) {
      return candidate;
    }

    cursor = candidate + TEXT_PROTOCOL_TOOL_CALL_START.length;
  }

  return -1;
}

function longestToolCallStartPrefixSuffix(text: string): number {
  const maxLength = Math.min(text.length, TEXT_PROTOCOL_TOOL_CALL_START.length - 1);
  for (let length = maxLength; length > 0; length -= 1) {
    if (text.endsWith(TEXT_PROTOCOL_TOOL_CALL_START.slice(0, length))) {
      return length;
    }
  }

  return 0;
}

function findCompleteTextProtocolToolCallBlockEnd(text: string): number | undefined {
  const openEnd = text.indexOf('>');
  if (openEnd === -1) {
    return undefined;
  }

  let depth = 1;
  let cursor = openEnd + 1;
  while (cursor < text.length) {
    const nextStart = findTextProtocolToolCallStart(text, cursor);
    const nextClose = text.indexOf(TEXT_PROTOCOL_TOOL_CALL_CLOSE, cursor);
    if (nextClose === -1) {
      return undefined;
    }

    if (nextStart !== -1 && nextStart < nextClose) {
      depth += 1;
      cursor = nextStart + TEXT_PROTOCOL_TOOL_CALL_START.length;
      continue;
    }

    depth -= 1;
    cursor = nextClose + TEXT_PROTOCOL_TOOL_CALL_CLOSE.length;
    if (depth === 0) {
      return cursor;
    }
  }

  return undefined;
}

class TextProtocolStreamOutputBuffer {
  private visibleBuffer = '';
  private toolCallBuffer = '';
  private insideToolCall = false;

  process(chunk: string): string {
    let output = '';

    if (this.insideToolCall) {
      this.toolCallBuffer += chunk;
    } else {
      this.visibleBuffer += chunk;
    }

    while (true) {
      if (this.insideToolCall) {
        const end = findCompleteTextProtocolToolCallBlockEnd(this.toolCallBuffer);
        if (end === undefined) {
          break;
        }

        const remainder = this.toolCallBuffer.slice(end);
        this.toolCallBuffer = '';
        this.insideToolCall = false;
        if (remainder.length > 0) {
          this.visibleBuffer += remainder;
          continue;
        }
        break;
      }

      const start = findTextProtocolToolCallStart(this.visibleBuffer);
      if (start === -1) {
        const overlap = longestToolCallStartPrefixSuffix(this.visibleBuffer);
        const safeLength = this.visibleBuffer.length - overlap;
        if (safeLength <= 0) {
          break;
        }

        output += this.visibleBuffer.slice(0, safeLength);
        this.visibleBuffer = this.visibleBuffer.slice(safeLength);
        break;
      }

      output += this.visibleBuffer.slice(0, start);
      this.toolCallBuffer = this.visibleBuffer.slice(start);
      this.visibleBuffer = '';
      this.insideToolCall = true;
    }

    return output;
  }

  finalize(): string {
    const trailingText = this.insideToolCall
      ? `${this.visibleBuffer}${this.toolCallBuffer}`
      : this.visibleBuffer;

    this.visibleBuffer = '';
    this.toolCallBuffer = '';
    this.insideToolCall = false;

    return trailingText;
  }
}

function stripTextProtocolToolCallBlocksPreservingTrailingMalformed(text: string): string {
  const buffer = new TextProtocolStreamOutputBuffer();
  return `${buffer.process(text)}${buffer.finalize()}`.trim();
}

function groupToolCallDiagnosticsByReason(
  diagnostics: ToolCallParseDiagnostic[],
): Record<string, number> {
  const byReason: Record<string, number> = {};
  for (const diagnostic of diagnostics) {
    byReason[diagnostic.reason] = (byReason[diagnostic.reason] ?? 0) + 1;
  }
  return byReason;
}

interface ToolTransportGenerationResult {
  generation: GenerationOutput;
  toolResultWritebackText?: TurnExecutionResult['toolResultWritebackText'];
  toolTransport?: TurnExecutionResult['toolTransport'];
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
    let narratorTools: ToolDefinition[] | undefined;
    let narratorToolContext: ToolExecutionContext | undefined;
    let directorResult: DirectorResult | undefined;
    let verifierResult: VerifierResult | undefined;
    let memoryInjection: MemoryInjectionResult | undefined;
    let consolidationResult: ConsolidationResult | undefined;
    let generation: GenerationOutput | undefined;
    let toolResultWritebackText: TurnExecutionResult['toolResultWritebackText'];
    let toolTransport: TurnExecutionResult['toolTransport'] = input.toolTransport;
    let agentLoopStopReason: TurnExecutionResult['agentLoopStopReason'];
    let agentLoopSteps: TurnExecutionResult['agentLoopSteps'];
    let pendingToolConfirmation: TurnExecutionResult['pendingToolConfirmation'];

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

          narratorTools = await input.toolRegistry.listForSlot(
            'narrator',
            input.toolPermissions,
          );
          narratorToolContext = this.buildToolContext(input, 'narrator');
          if (
            narratorTools.length > 0
            && input.toolTransport?.selection.transport !== 'text_protocol'
            && input.toolTransport?.selection.transport !== 'none'
          ) {
            narratorLLMTools = toolExecutor.buildLLMTools(
              narratorTools,
              narratorToolContext,
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
      const useGraphAssistantAgentLoop =
        cfg.enableTools
        && input.graphAssistantAgentLoop !== undefined
        && input.toolTransport?.selection.transport === 'text_protocol'
        && toolExecutor !== undefined
        && narratorToolContext !== undefined
        && input.toolPermissions !== undefined;

      if (useGraphAssistantAgentLoop) {
        //图助手 text_protocol 多轮 agent 循环（主链与其他会话不走此路径）
        const loopResult = await this.runTextProtocolAgentLoop({
          input,
          toolExecutor: toolExecutor!,
          narratorTools: narratorTools ?? [],
          narratorToolContext: narratorToolContext!,
        });
        generation = loopResult.generation;
        toolResultWritebackText = loopResult.toolResultWritebackText;
        toolTransport = loopResult.toolTransport ?? toolTransport;
        agentLoopStopReason = loopResult.agentLoopStopReason;
        agentLoopSteps = loopResult.agentLoopSteps;
        pendingToolConfirmation = loopResult.pendingToolConfirmation;
        totalUsage = addUsage(totalUsage, generation.usage);
      } else {
        const genResult = await this.runGenerationWithVerifier(
          input,
          cfg,
          narratorLLMTools,
          toolExecutor,
          narratorTools,
          narratorToolContext,
        );
        generation = genResult.generation;
        verifierResult = genResult.verifierResult;
        toolResultWritebackText = genResult.toolResultWritebackText;
        toolTransport = genResult.toolTransport ?? toolTransport;
        totalUsage = addUsage(totalUsage, generation.usage);
        if (verifierResult) {
          totalUsage = addUsage(totalUsage, verifierResult.usage);
        }
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
      const pendingToolJobs = toolExecutor?.getPendingToolJobs();

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
        ...(toolResultWritebackText ? { toolResultWritebackText } : {}),
        ...(toolTransport ? { toolTransport } : {}),
        ...(toolExecutionRecords && toolExecutionRecords.length > 0
          ? { toolExecutionRecords }
          : {}),
        ...(bufferedVariableMutations && bufferedVariableMutations.length > 0
          ? { bufferedVariableMutations }
          : {}),
        ...(pendingToolJobs && pendingToolJobs.length > 0
          ? { pendingToolJobs }
            : {}),
          ...(agentLoopStopReason ? { agentLoopStopReason } : {}),
          ...(agentLoopSteps !== undefined ? { agentLoopSteps } : {}),
          ...(pendingToolConfirmation ? { pendingToolConfirmation } : {}),
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

  private async notifyRunPhaseChange(
    input: TurnInput,
    phase: 'input_recorded' | 'semantic_resolved' | 'prechecked' | 'prompt_assembled' | 'page_generating' | 'candidate_generated' | 'verifier_checked' | 'transaction_prepared' | 'transaction_committed' | 'post_commit_scheduled',
    attemptNo?: number,
  ): Promise<void> {
    try {
      await input.runObserver?.onPhaseChange?.({ phase, attemptNo });
    } catch {
      // best-effort observer hook
    }
  }

  private async notifyPendingOutputUpdate(
    input: TurnInput,
    payload: {
      text: string;
      state: 'draft' | 'streaming' | 'generated' | 'failed';
      attemptNo: number;
      force?: boolean;
      error?: string;
    },
  ): Promise<void> {
    try {
      await input.runObserver?.onPendingOutputUpdate?.(payload);
    } catch {
      // best-effort observer hook
    }
  }

  private async notifyVerifierResult(
    input: TurnInput,
    payload: {
      status: 'pending' | 'passed' | 'warned' | 'blocked' | 'skipped';
      suggestion?: string;
      issues?: Array<{ description: string; severity: 'warning' | 'error' }>;
    },
  ): Promise<void> {
    try {
      await input.runObserver?.onVerifierResult?.(payload);
    } catch {
      // best-effort observer hook
    }
  }

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
      const providedScopeContext = input.memoryOptions?.scopeContext;
      const resolvedAccountId = input.accountId
        ?? input.memoryOptions?.accountId
        ?? providedScopeContext?.accountId;
      const memoryOptions = input.memoryOptions
        ? {
            ...input.memoryOptions,
            accountId: resolvedAccountId,
            scopeContext: {
              ...(resolvedAccountId ? { accountId: resolvedAccountId } : {}),
              sessionId: providedScopeContext?.sessionId ?? input.sessionId,
              ...(providedScopeContext?.floorId ?? input.floorId
                ? { floorId: providedScopeContext?.floorId ?? input.floorId }
                : {}),
            },
          }
        : undefined;
      return await this.deps.memoryStore.prepareInjection(input.sessionId, memoryOptions!);
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
    attemptNo = 1,
    narratorLLMTools?: Record<string, LLMToolEntry>,
    toolExecutor?: ToolExecutor,
    narratorTools?: ToolDefinition[],
    narratorToolContext?: ToolExecutionContext,
  ): Promise<ToolTransportGenerationResult> {
    try {
      await this.notifyRunPhaseChange(input, 'page_generating', attemptNo);
      await this.notifyPendingOutputUpdate(input, { text: '', state: 'draft', attemptNo, force: true });

      // 发出 generation.started 事件
      await this.deps.eventBus.emit('generation.started', {
        floorId: input.floorId,
      });

      let accumulatedLength = 0;
      let accumulatedText = '';
      const textProtocolStreamBuffer = input.toolTransport?.selection.transport === 'text_protocol'
        ? new TextProtocolStreamOutputBuffer()
        : undefined;
      const emitChunk = (chunk: string) => {
        if (chunk.length === 0) {
          return;
        }

        accumulatedLength += chunk.length;
        accumulatedText += chunk;
        void this.deps.eventBus.emit('generation.chunk', {
          floorId: input.floorId,
          chunk,
          accumulatedLength,
        });
        void this.notifyPendingOutputUpdate(input, { text: accumulatedText, state: 'streaming', attemptNo });
        input.onChunk?.(chunk);
      };
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
          ...(input.toolTransport?.toolChoiceApplied === true ? { toolChoice: 'auto' as const } : {}),
          ...(narratorLLMTools ? { maxSteps: input.toolPermissions?.maxStepsPerGeneration ?? 5 } : {}),
        },
        {
          onChunk: (chunk) => {
            const visibleChunk = textProtocolStreamBuffer
              ? textProtocolStreamBuffer.process(chunk)
              : chunk;
            emitChunk(visibleChunk);
          },
        },
      );
      const trailingBufferedChunk = textProtocolStreamBuffer?.finalize();
      if (trailingBufferedChunk) {
        emitChunk(trailingBufferedChunk);
      }

      const finalResult = await this.applyToolTransportToGeneration({
        input,
        generation: result,
        toolExecutor,
        narratorTools,
        narratorToolContext,
      });

      // 发出 generation.completed 事件
      await this.deps.eventBus.emit('generation.completed', {
        floorId: input.floorId,
        text: finalResult.generation.text,
        usage: finalResult.generation.usage,
        finishReason: finalResult.generation.finishReason,
        summaries: finalResult.generation.summaries,
      });

      await this.notifyPendingOutputUpdate(input, {
        text: finalResult.generation.text,
        state: 'generated',
        attemptNo,
        force: true,
      });

      return finalResult;
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));

      // 发出 generation.failed 事件
      await this.deps.eventBus.emit('generation.failed', {
        floorId: input.floorId,
        error: normalizedError,
      });

      await this.notifyPendingOutputUpdate(input, { text: '', state: 'failed', attemptNo, force: true, error: normalizedError.message });

      throw new TurnError(
        `Generation failed: ${normalizedError.message}`,
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
    narratorTools?: ToolDefinition[],
    narratorToolContext?: ToolExecutionContext,
  ): Promise<{
    generation: GenerationOutput;
    verifierResult?: VerifierResult;
    toolResultWritebackText?: TurnExecutionResult['toolResultWritebackText'];
    toolTransport?: TurnExecutionResult['toolTransport'];
  }> {
    const maxAttempts = cfg.enableVerifier && cfg.verifierFailStrategy === 'retry'
      ? 1 + cfg.maxRetries
      : 1;

    let lastGeneration: GenerationOutput | undefined;
    let lastVerifierResult: VerifierResult | undefined;
    let lastGenerationAttemptNo: number | undefined;
    let lastToolResultWritebackText: TurnExecutionResult['toolResultWritebackText'];
    let lastToolTransport: TurnExecutionResult['toolTransport'] = input.toolTransport;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      lastGenerationAttemptNo = toolExecutor?.beginGenerationAttempt();
      const runAttemptNo = attempt + 1;
      const attemptExecutionStart = toolExecutor?.getExecutionRecordCount() ?? 0;
      const generationResult = await this.runGeneration(
        input,
        runAttemptNo,
        narratorLLMTools,
        toolExecutor,
        narratorTools,
        narratorToolContext,
      );
      lastGeneration = generationResult.generation;
      lastToolResultWritebackText = generationResult.toolResultWritebackText;
      lastToolTransport = generationResult.toolTransport ?? lastToolTransport;
      await this.notifyRunPhaseChange(input, 'candidate_generated', runAttemptNo);

      if (!cfg.enableVerifier || !input.verifierInput) {
        await this.notifyVerifierResult(input, { status: 'skipped' });
        await this.notifyRunPhaseChange(input, 'verifier_checked', runAttemptNo);
        return {
          generation: lastGeneration,
          ...(lastToolResultWritebackText ? { toolResultWritebackText: lastToolResultWritebackText } : {}),
          ...(lastToolTransport ? { toolTransport: lastToolTransport } : {}),
        };
      }

      lastVerifierResult = await this.runVerifier(input, lastGeneration.text);
      await this.notifyVerifierResult(input, {
        status: lastVerifierResult.output.passed
          ? 'passed'
          : cfg.verifierFailStrategy === 'warn'
            ? 'warned'
            : 'blocked',
        suggestion: lastVerifierResult.output.suggestion,
        issues: lastVerifierResult.output.issues,
      });
      await this.notifyRunPhaseChange(input, 'verifier_checked', runAttemptNo);

      if (lastVerifierResult.output.passed) {
        return {
          generation: lastGeneration,
          verifierResult: lastVerifierResult,
          ...(lastToolResultWritebackText ? { toolResultWritebackText: lastToolResultWritebackText } : {}),
          ...(lastToolTransport ? { toolTransport: lastToolTransport } : {}),
        };
      }

      // Verifier 不通过
      if (cfg.verifierFailStrategy === 'warn') {
        // warn: 继续，不阻断
        return {
          generation: lastGeneration,
          verifierResult: lastVerifierResult,
          ...(lastToolResultWritebackText ? { toolResultWritebackText: lastToolResultWritebackText } : {}),
          ...(lastToolTransport ? { toolTransport: lastToolTransport } : {}),
        };
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

    return {
      generation: lastGeneration!,
      verifierResult: lastVerifierResult,
      ...(lastToolResultWritebackText ? { toolResultWritebackText: lastToolResultWritebackText } : {}),
      ...(lastToolTransport ? { toolTransport: lastToolTransport } : {}),
    };
  }

  private async applyToolTransportToGeneration(args: {
    input: TurnInput;
    generation: GenerationOutput;
    toolExecutor?: ToolExecutor;
    narratorTools?: ToolDefinition[];
    narratorToolContext?: ToolExecutionContext;
  }): Promise<ToolTransportGenerationResult> {
    const baseTransport = args.input.toolTransport;
    if (!baseTransport || baseTransport.selection.transport !== 'text_protocol') {
      return {
        generation: args.generation,
        ...(baseTransport ? { toolTransport: baseTransport } : {}),
      };
    }

    const parser = new TextProtocolToolCallParser();
    const parseOutput = parser.parse({
      modelOutputText: args.generation.rawText,
      allowedToolNames: new Set((args.narratorTools ?? []).map((tool) => tool.name)),
    });

    const strippedText = stripTextProtocolToolCallBlocksPreservingTrailingMalformed(args.generation.text);
    const formatter = new TextProtocolToolResultFormatter();
    const writebackBlocks: string[] = [];

    if (args.toolExecutor && args.narratorToolContext && args.input.toolPermissions) {
      for (const call of parseOutput.calls) {
        const result = await args.toolExecutor.execute(
          call.toolName,
          call.args,
          args.narratorToolContext,
          args.input.toolPermissions,
        );
        writebackBlocks.push(
          formatter.format({
            callId: call.callId,
            toolName: call.toolName,
            result,
          }).content,
        );
      }
    }

    return {
      generation: {
        ...args.generation,
        text: strippedText,
      },
      ...(writebackBlocks.length > 0
        ? { toolResultWritebackText: writebackBlocks.join('\n\n') }
        : {}),
      toolTransport: {
        ...baseTransport,
        parsing: {
          ...parseOutput.stats,
          diagnostics: parseOutput.diagnostics,
          diagnosticsByReason: groupToolCallDiagnosticsByReason(parseOutput.diagnostics),
        },
        toolResult: {
          writtenBack: writebackBlocks.length > 0,
          blockCount: writebackBlocks.length,
          tokenCount: countToolResultWritebackTokens(writebackBlocks, this.deps.tokenCounter),
          budgetGroup: TEXT_PROTOCOL_TOOL_RESULT_BUDGET_GROUP,
        },
      },
    };
  }
  /**
   * 图助手 text_protocol 多轮 agent 循环驱动。
   *
   * 只在 `input.graphAssistantAgentLoop` 存在且 transport 为 text_protocol 时由 executeTurn 调用；
   * 主链与其他会话仍走单轮 `runGenerationWithVerifier` + `applyToolTransportToGeneration`。
   */
  private async runTextProtocolAgentLoop(args: {
    input: TurnInput;
    toolExecutor: ToolExecutor;
    narratorTools: ToolDefinition[];
    narratorToolContext: ToolExecutionContext;
  }): Promise<{
    generation: GenerationOutput;
    toolResultWritebackText?: TurnExecutionResult['toolResultWritebackText'];
    toolTransport?: TurnExecutionResult['toolTransport'];
    agentLoopStopReason: TurnExecutionResult['agentLoopStopReason'];
    agentLoopSteps: number;
    pendingToolConfirmation?: TurnExecutionResult['pendingToolConfirmation'];
  }> {
    const { input } = args;
    const loopConfig = input.graphAssistantAgentLoop!;
    const baseTransport = input.toolTransport;
    const maxSteps = input.toolPermissions?.maxStepsPerGeneration ?? 5;

    let lastFinishReason = 'stop';

    const generate: AgentLoopGenerate = async ({ messages, stepIndex }) => {
      await this.notifyRunPhaseChange(input, 'page_generating', stepIndex);
      await this.notifyPendingOutputUpdate(input, { text: '', state: 'draft', attemptNo: stepIndex, force: true });

      await this.deps.eventBus.emit('generation.started', {
        floorId: input.floorId,
      });

      let accumulatedLength = 0;
      let accumulatedText = '';
      const streamBuffer = new TextProtocolStreamOutputBuffer();
      const emitChunk = (chunk: string) => {
        if (chunk.length === 0) {
          return;
        }
        accumulatedLength += chunk.length;
        accumulatedText += chunk;
        void this.deps.eventBus.emit('generation.chunk', {
          floorId: input.floorId,
          chunk,
          accumulatedLength,
        });
        void this.notifyPendingOutputUpdate(input, { text: accumulatedText, state: 'streaming', attemptNo: stepIndex });
        input.onChunk?.(chunk);
      };

      const result = await this.deps.generationPipeline.run(
        {
          messages,
          params: resolveSlotGenerationParams(input, 'narrator') ?? input.generationParams,
          preProcess: input.preProcess,
          postProcess: input.postProcess,
          model: resolveSlotModel(input, 'narrator'),
          abortSignal: input.abortSignal,
          summaryOptions: input.summaryOptions,
        },
        {
          onChunk: (chunk) => {
            emitChunk(streamBuffer.process(chunk));
          },
        },
      );
      const trailing = streamBuffer.finalize();
      if (trailing) {
        emitChunk(trailing);
      }

      lastFinishReason = result.finishReason;

      const visibleText = stripTextProtocolToolCallBlocksPreservingTrailingMalformed(result.text);

      await this.deps.eventBus.emit('generation.completed', {
        floorId: input.floorId,
        text: visibleText,
        usage: result.usage,
        finishReason: result.finishReason,
        summaries: result.summaries,
      });

      return {
        visibleText,
        rawText: result.rawText,
        usage: result.usage,
        finishReason: result.finishReason,
        summaries: result.summaries,
      };
    };

    const loop = new TextProtocolAgentLoop({ eventBus: this.deps.eventBus });
    const loopResult = await loop.run({
      floorId: input.floorId,
      ...(input.pageId ? { pageId: input.pageId } : {}),
      callerSlot: 'narrator',
      initialMessages: input.messages,
      tools: args.narratorTools,
      toolContext: args.narratorToolContext,
      permissions: input.toolPermissions!,
      toolExecutor: args.toolExecutor,
      generate,
      decideConfirmation: loopConfig.decideConfirmation,
      ...(loopConfig.resumeApprovedCall ? { resumeApprovedCall: loopConfig.resumeApprovedCall } : {}),
      maxSteps,
      ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
    });

    const finishReason =
      loopResult.stopReason === 'awaiting_confirmation'
        ? 'awaiting_tool_confirmation'
        : lastFinishReason;

    const generation: GenerationOutput = {
      text: loopResult.visibleText,
      rawText: loopResult.visibleText,
      summaries: loopResult.summaries,
      usage: loopResult.totalUsage,
      finishReason,
    };

    await this.notifyPendingOutputUpdate(input, {
      text: generation.text,
      state: 'generated',
      attemptNo: loopResult.steps,
      force: true,
    });

    const writeback = loopResult.toolResultWritebackText;
    const writebackBlockCount = writeback ? writeback.split('\n\n').filter((block) => block.length > 0).length : 0;

    const toolTransport: TurnExecutionResult['toolTransport'] = baseTransport
      ? {
          ...baseTransport,
          parsing: {
            blockCount: loopResult.parsing.blockCount,
            acceptedCount: loopResult.parsing.acceptedCount,
            rejectedCount: loopResult.parsing.rejectedCount,
            diagnostics: loopResult.parsing.diagnostics,
            diagnosticsByReason: groupToolCallDiagnosticsByReason(loopResult.parsing.diagnostics),
          },
          toolResult: {
            writtenBack: writeback !== undefined,
            blockCount: writebackBlockCount,
            tokenCount: writeback ? (this.deps.tokenCounter?.count(writeback) ?? writeback.length) : 0,
            budgetGroup: TEXT_PROTOCOL_TOOL_RESULT_BUDGET_GROUP,
          },
        }
      : undefined;

    return {
      generation,
      ...(writeback ? { toolResultWritebackText: writeback } : {}),
      ...(toolTransport ? { toolTransport } : {}),
      agentLoopStopReason: loopResult.stopReason,
      agentLoopSteps: loopResult.steps,
      ...(loopResult.pendingConfirmation
        ? {
            pendingToolConfirmation: {
              callId: loopResult.pendingConfirmation.callId,
              toolName: loopResult.pendingConfirmation.toolName,
              args: loopResult.pendingConfirmation.args,
              ...(loopResult.pendingConfirmation.sideEffectLevel
                ? { sideEffectLevel: loopResult.pendingConfirmation.sideEffectLevel }
                : {}),
              conversationMessages: loopResult.conversationMessages,
            },
          }
        : {}),
    };
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
            sessionId: input.sessionId,
            scope: 'chat',
            scopeId: input.sessionId,
            floorId: input.floorId,
            rawText: result.degraded.rawText,
            sourceJobId: undefined,
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
          sessionId: input.sessionId,
          scope: 'chat',
          scopeId: input.sessionId,
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
      branchId: input.branchId,
      floorId: input.floorId,
      pageId: input.pageId,
      callerSlot: slot,
      variableContext: {
        sessionId: input.sessionId,
        accountId: input.accountId,
        branchId: input.branchId,
        floorId: input.floorId,
        pageId: input.pageId,
      },
      abortSignal: input.abortSignal,
    };
  }
}
