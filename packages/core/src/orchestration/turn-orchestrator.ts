import { randomUUID } from 'node:crypto';

import type { FloorState } from '@tavern/shared';
import type { CoreEventBus } from '../events/index.js';
import type { FloorStateMachine } from '../floor/floor-state-machine.js';
import type { GenerationParams, InstanceSlot, ModelConfig, TokenUsage } from '../llm/types.js';
import type { GenerationPipeline } from '../generation/generation-pipeline.js';
import type { ChatMessage, TokenCounter } from '../prompt/types.js';
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
  coerceTextProtocolToolArgs,
} from '../tools/transport/index.js';
import type { ToolCallParseDiagnostic } from '../tools/transport/index.js';
import { TEXT_PROTOCOL_TOOL_CALL_CLOSE } from '../tools/transport/text-protocol/constants.js';
import {
  NativeToolBlockStreamBuffer,
  stripNativeToolBlocksPreservingTrailingMalformed,
  containsNativeToolBlock,
} from '../tools/transport/text-protocol/native-tool-block-stripper.js';
import { buildNativeToolNameMapping } from '../tools/transport/native-tool-name-mapping.js';
import { emitDebug, isDebugEnabled } from '../debug/index.js';
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
import { NativeFunctionCallAgentLoop } from './native-function-call-agent-loop.js';
import { projectAgentLoopMessagesToChat, selectFinalAnswerText } from './agent-loop.js';
import type { AgentLoopGenerate, AgentLoopStepRecord, NormalizedToolCall } from './agent-loop.js';

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

/**
 * native 路径历史协议归一化（仅作用于喂给模型的请求上下文）。
 *
 * 逐回合协议偏好允许切换，但历史会把上一回合的协议格式带进当前请求。若历史
 * assistant 文本里残留 text_protocol 时代的 <tool_call> / <tool_result> 文本范例（或模型
 * 自创的 <tool_response>），本回合切到 native 时模型会照着仿写文本格式，而 native 路径
 * 期待结构化调用、解析为空，导致工具往返文本泄漏。这里对历史 assistant 文本剥离工具
 * 往返文本块，消除「旧协议范例成了错误教具」的根因。
 *
 * 只作用于 input.messages 的投影副本，不改写已落库 transcript，保持 ChatMessage 纯文本契约
 * 与审计真相不变。标签匹配复用阶段 A 的剥离器，避免两套匹配规则。
 *
 * - 仅处理 assistant 历史；user / system 消息原样透传。
 * - 不含工具块的 assistant 文本原样透传（不做无谓改写）。
 * - 含工具块时剥离；若整条消息全是工具块、剥离后为空，则移除该消息，避免空 assistant 消息。
 */
function normalizeNativeHistoryToolBlocks(messages: ChatMessage[]): ChatMessage[] {
  const normalized: ChatMessage[] = [];
  for (const message of messages) {
    if (message.role !== 'assistant' || !containsNativeToolBlock(message.content)) {
      normalized.push(message);
      continue;
    }

    const stripped = stripNativeToolBlocksPreservingTrailingMalformed(message.content);
    if (stripped.length === 0) {
      continue;
    }

    normalized.push({ ...message, content: stripped });
  }

  return normalized;
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
    let agentStepRecords: TurnExecutionResult['agentStepRecords'];
    let pendingToolConfirmation: TurnExecutionResult['pendingToolConfirmation'];

    try {
      // ── 1. draft → generating ──
      // 使用幂等推进：上层（如临时对话）可能为抢占同一个共享 draft 楼层、
      // 防止并发请求互相覆盖，已提前把楼层推进到 generating。
      // 这种情况下此处不应再次转换，否则会触发非法的 generating → generating。
      await this.ensureGeneratingOrFail(input.floorId);

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
          // native 图助手走自驱动循环（schema-only 工具，不让 SDK 自动执行），
          // 因此此处不构造带 execute 的 LLM 工具；主链与其他会话的 native 仍由 SDK 自动执行。
          const nativeGraphAssistantLoop =
            input.graphAssistantAgentLoop !== undefined
            && input.toolTransport?.selection.transport === 'native_function_call';
          if (
            narratorTools.length > 0
            && input.toolTransport?.selection.transport !== 'text_protocol'
            && input.toolTransport?.selection.transport !== 'none'
            && !nativeGraphAssistantLoop
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
      const agentLoopTransport = input.toolTransport?.selection.transport;
const useGraphAssistantAgentLoop =
        cfg.enableTools
        && input.graphAssistantAgentLoop !== undefined
        && (agentLoopTransport === 'text_protocol' || agentLoopTransport === 'native_function_call')
        && toolExecutor !== undefined
        && narratorToolContext !== undefined
        && input.toolPermissions !== undefined;

      // 调试：记录图助手 agent loop 路径选择，确认实际走 native 还是 text_protocol，或回退普通生成。
      if (isDebugEnabled('native-tool')) {
        emitDebug('native-tool', 'info', 'loop-route', {
          floorId: input.floorId,
          agentLoopTransport,
          enableTools: cfg.enableTools,
          hasGraphAssistantAgentLoop: input.graphAssistantAgentLoop !== undefined,
          hasToolExecutor: toolExecutor !== undefined,
          hasNarratorToolContext: narratorToolContext !== undefined,
          hasToolPermissions: input.toolPermissions !== undefined,
          useGraphAssistantAgentLoop,
        });
}

      if (useGraphAssistantAgentLoop) {
        // 图助手多轮 agent 循环（主链与其他会话不走此路径），按 transport 选适配。
        const loopResult =
        agentLoopTransport === 'native_function_call'
            ? await this.runNativeFunctionCallAgentLoop({
                input,
                toolExecutor: toolExecutor!,
                narratorTools: narratorTools ?? [],
                narratorToolContext: narratorToolContext!,
              })
            : await this.runTextProtocolAgentLoop({
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
        // 仅 native 分支产出 agentStepRecords；text_protocol 返回 undefined。
        agentStepRecords = loopResult.agentStepRecords;
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
        ...(generation.reasoningText ? { reasoningText: generation.reasoningText } : {}),
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
          ...(agentStepRecords && agentStepRecords.length > 0 ? { agentStepRecords } : {}),
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

  private async notifyReasoningUpdate(
    input: TurnInput,
    payload: {
      delta: string;
      text: string;
      attemptNo: number;
    },
  ): Promise<void> {
    try {
      await input.runObserver?.onReasoningUpdate?.(payload);
    } catch {
      // best-effort observer hook
    }
  }

  private async notifyStepNarration(
    input: TurnInput,
    payload: {
      stepIndex: number;
      text: string;
      createdAt: number;
    },
  ): Promise<void> {
    try {
      await input.runObserver?.onStepNarration?.(payload);
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

  /**
   * 幂等地把楼层推进到 generating。
   *
   * 若上层已先行把楼层推进到 generating（例如临时对话为抢占共享 draft 楼层、
   * 防止并发互相覆盖而提前 promote），这里不再重复转换，避免非法的
   * generating → generating。其余非法状态仍会照常抛错。
   */
  private async ensureGeneratingOrFail(floorId: string): Promise<void> {
    try {
      await this.deps.floorStateMachine.ensureGenerating(floorId);
    } catch (error) {
      throw new TurnError(
        `State transition to 'generating' failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        'transition',
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
        sessionId: input.sessionId,
        floorId: input.floorId,
      });

      let accumulatedLength = 0;
      let accumulatedText = '';
      let accumulatedReasoning = '';
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
          sessionId: input.sessionId,
          floorId: input.floorId,
          chunk,
          accumulatedLength,
        });
        void this.notifyPendingOutputUpdate(input, { text: accumulatedText, state: 'streaming', attemptNo });
        input.onChunk?.(chunk);
      };
      const emitReasoning = (delta: string) => {
        if (delta.length === 0) {
          return;
        }
        accumulatedReasoning += delta;
        void this.notifyReasoningUpdate(input, { delta, text: accumulatedReasoning, attemptNo });
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
          onReasoning: emitReasoning,
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
        sessionId: input.sessionId,
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
        sessionId: input.sessionId,
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
      const toolsByName = new Map(
        (args.narratorTools ?? []).map((tool) => [tool.name, tool] as const),
      );
      for (const call of parseOutput.calls) {
        // text_protocol 下模型只能输出字符串化 JSON，按工具 schema 还原顶层参数类型，
        // 避免带引号的布尔/数字/数组导致执行失败。native 路径不经过这里。
        const coercedArgs = coerceTextProtocolToolArgs(
          call.args,
          toolsByName.get(call.toolName)?.parameters,
        );
        const result = await args.toolExecutor.execute(
          call.toolName,
          coercedArgs,
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
    /** text_protocol 路径不产出按步记录（与 native 联合类型对齐）。 */
    agentStepRecords?: AgentLoopStepRecord[];
  }> {
    const { input } = args;
    const loopConfig = input.graphAssistantAgentLoop!;
    const baseTransport = input.toolTransport;
    const maxSteps = input.toolPermissions?.maxStepsPerGeneration ?? 5;
    // 回合尝试号在整个多步循环内保持不变，避免用循环步号污染 attemptNo 导致 commit 误判 stale。
    const runAttemptNo = input.runAttemptNo ?? 1;

    let lastFinishReason = 'stop';
    let accumulatedReasoning = '';

    const generate: AgentLoopGenerate = async ({ messages, stepIndex }) => {
      await this.notifyRunPhaseChange(input, 'page_generating', runAttemptNo);
      await this.notifyPendingOutputUpdate(input, { text: '', state: 'draft', attemptNo: runAttemptNo, force: true });

      await this.deps.eventBus.emit('generation.started', {
        sessionId: input.sessionId,
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
          sessionId: input.sessionId,
          floorId: input.floorId,
          chunk,
          accumulatedLength,
        });
        void this.notifyPendingOutputUpdate(input, { text: accumulatedText, state: 'streaming', attemptNo: runAttemptNo });
        input.onChunk?.(chunk);
      };
          const emitReasoning = (delta: string) => {
        if (delta.length === 0) {
          return;
        }
        accumulatedReasoning += delta;
        void this.notifyReasoningUpdate(input, { delta, text: accumulatedReasoning, attemptNo: runAttemptNo });
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
          onReasoning: emitReasoning,
        },
      );
      const trailing = streamBuffer.finalize();
      if (trailing) {
        emitChunk(trailing);
      }

      lastFinishReason = result.finishReason;

      const visibleText = stripTextProtocolToolCallBlocksPreservingTrailingMalformed(result.text);

      // 调试：记录 text_protocol 每步原文与剥离结果，判断模型是否在正文虚构工具往返。
      if (isDebugEnabled('native-tool')) {
        emitDebug('native-tool', 'info', 'text-protocol-step', {
          floorId: input.floorId,
          stepIndex,
          finishReason: result.finishReason,
          rawTextLength: result.text.length,
          rawTextPreview: result.text.slice(0, 800),
          visibleTextLength: visibleText.length,
          hasToolCallTag: result.text.includes('<tool_call'),
          hasToolResponseTag: result.text.includes('<tool_response'),
          hasToolResultTag: result.text.includes('<tool_result'),
        });
      }

      await this.deps.eventBus.emit('generation.completed', {
        sessionId: input.sessionId,
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

    // 调试：记录 text_protocol loop 终态，stopReason=natural_stop 表示工具从未执行。
    if (isDebugEnabled('native-tool')) {
      emitDebug('native-tool', 'info', 'text-protocol-loop-result', {
        floorId: input.floorId,
        stopReason: loopResult.stopReason,
           steps: loopResult.steps,
        blockCount: loopResult.parsing.blockCount,
        acceptedCount: loopResult.parsing.acceptedCount,
        rejectedCount: loopResult.parsing.rejectedCount,
        visibleTextLength: loopResult.visibleText.length,
        hasWriteback: loopResult.toolResultWritebackText !== undefined,
      });
    }

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
      ...(accumulatedReasoning ? { reasoningText: accumulatedReasoning } : {}),
    };

    await this.notifyPendingOutputUpdate(input, {
      text: generation.text,
      state: 'generated',
      attemptNo: runAttemptNo,
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
              conversationMessages: projectAgentLoopMessagesToChat(loopResult.conversationMessages),
            },
          }
        : {}),
    };
  }

  /**
   * 图助手 native function calling 多轮 agent 循环驱动。
   *
   * 只在 `input.graphAssistantAgentLoop` 存在且 transport 为 native_function_call 时由 executeTurn 调用。
   * 模型用原生协议返回结构化 toolCalls（schema-only 工具，SDK 不自动执行），
   * 仓库自驱动决策、执行、结构化回填、续跑。
   */
  private async runNativeFunctionCallAgentLoop(args: {
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
    /** 按步结构化记录（为阶段二旁路落库中间叙述备料）。 */
    agentStepRecords: AgentLoopStepRecord[];
  }> {
    const { input } = args;
    const loopConfig = input.graphAssistantAgentLoop!;
    const baseTransport = input.toolTransport;
    const maxSteps = input.toolPermissions?.maxStepsPerGeneration ?? 5;
    //回合尝试号在整个多步循环内保持不变，避免用循环步号污染 attemptNo 导致 commit 误判 stale。
    const runAttemptNo = input.runAttemptNo ?? 1;

    // schema-only 工具：不带 execute，让 SDK 只返回 toolCalls 不自动执行。
    // native 工具名清洗：provider（如 OpenAI）的 function name 只允许 [a-zA-Z0-9_-]，
   // NodeGraph 等带点号的工具名原样导出会被拒绝（400）。这里用清洗后的 schema名导出，
    // 模型按清洗名调用后在下方 generate 闭包里还原回原始名，下游执行与 transcript 不受影响。
    const toolNameMapping = buildNativeToolNameMapping(args.narratorTools.map((tool) => tool.name));
    const schemaTools = args.toolExecutor.buildLLMToolSchemas(args.narratorTools, toolNameMapping);

    // preProcess（正则 USER_INPUT 前处理）只作用于初始纯文本消息，在进循环前应用一次；
    // 循环内续跑的结构化工具消息不再走 preProcess。
    // 历史协议归一化：先 preProcess（正则 USER_INPUT 前处理），再剥离历史 assistant 文本里的
    // 工具往返文本块，避免旧协议文本范例误导本回合 native 协议遵循。仅作用请求上下文，不改 transcript。
    const preProcessedMessages = input.preProcess
      ? input.preProcess(input.messages)
      : input.messages;
    const initialMessages = normalizeNativeHistoryToolBlocks(preProcessedMessages);

    if (isDebugEnabled('native-tool')) {
      emitDebug('native-tool', 'info', 'loop-enter', {
        floorId: input.floorId,
        baseTransport: baseTransport ?? '(none)',
        maxSteps,
        schemaToolCount: Object.keys(schemaTools).length,
        schemaToolNames: Object.keys(schemaTools),
        initialMessageCount: initialMessages.length,
      });
    }

    let lastFinishReason = 'stop';
    let accumulatedReasoning = '';

    const generate: AgentLoopGenerate = async ({ messages, stepIndex }) => {
      await this.notifyRunPhaseChange(input, 'page_generating', runAttemptNo);
      await this.notifyPendingOutputUpdate(input, { text: '', state: 'draft', attemptNo: runAttemptNo, force:true });

      await this.deps.eventBus.emit('generation.started', {
        sessionId: input.sessionId,
        floorId: input.floorId,
      });

      let accumulatedLength = 0;
      let accumulatedText = '';
      // native 路径的输出侧防御性剥离：模型出格式把工具往返写成文本块时，
      // 流式与终值两侧对称剥掉，避免泄漏进可见输出。剥离器是兜底而非主防线。
      const streamBuffer = new NativeToolBlockStreamBuffer();
      const emitChunk = (chunk: string) => {
        if (chunk.length === 0) {
          return;
        }
        accumulatedLength += chunk.length;
        accumulatedText+= chunk;
        void this.deps.eventBus.emit('generation.chunk', {
          sessionId: input.sessionId,
          floorId: input.floorId,
          chunk,
          accumulatedLength,
        });
        void this.notifyPendingOutputUpdate(input, { text: accumulatedText, state: 'streaming', attemptNo: runAttemptNo });
        input.onChunk?.(chunk);
      };
      const emitReasoning = (delta: string) => {
        if (delta.length === 0) {
          return;
        }
        accumulatedReasoning += delta;
        void this.notifyReasoningUpdate(input, { delta, text: accumulatedReasoning, attemptNo: runAttemptNo });
      };

      let result: Awaited<ReturnType<typeof this.deps.generationPipeline.run>>;
try {
        result = await this.deps.generationPipeline.run(
          {
            messages,
            params: resolveSlotGenerationParams(input, 'narrator') ?? input.generationParams,
            postProcess: input.postProcess,
            model: resolveSlotModel(input, 'narrator'),
            abortSignal: input.abortSignal,
            summaryOptions: input.summaryOptions,
            tools: schemaTools,
            // 单步：SDK 只产出本步 toolCalls（工具无 execute，不会自动多步续跑）。
            maxSteps: 1,
            toolChoice: 'auto',
          },
          {
            onChunk: (chunk) => {
              emitChunk(streamBuffer.process(chunk));
            },
            onReasoning: emitReasoning,
          },
        );
      } catch (error) {
        // 捕获 provider 原始报文（如 400 Bad Request 的具体原因），便于定位 native 工具 schema 问题。
        if (isDebugEnabled('native-tool')) {
          emitDebug('native-tool', 'warn', 'llm-error', {
            stepIndex,
            message: error instanceof Error ? error.message : String(error),
            name: error instanceof Error ? error.name : undefined,
            cause: error instanceof Error && error.cause !== undefined ? String(error.cause) : undefined,
            schemaToolNames: Object.keys(schemaTools),
          });
        }
        throw error;
      }
      const trailing = streamBuffer.finalize();
      if (trailing) {
        emitChunk(trailing);
      }

      lastFinishReason = result.finishReason;

      if (isDebugEnabled('native-tool')) {
        emitDebug('native-tool', 'info', 'llm-raw', {
          stepIndex,
          finishReason: result.finishReason,
          rawToolCallCount: (result.toolCalls ?? []).length,
          rawToolCallNames: (result.toolCalls ?? []).map((c) => c.toolName),
          rawTextLength: result.text.length,
          rawTextPreview: result.text.slice(0, 300),
          reasoningLength: accumulatedReasoning.length,
        });
          }

      const visibleText = stripNativeToolBlocksPreservingTrailingMalformed(result.text);

           const toolCalls: NormalizedToolCall[] = (result.toolCalls ?? []).map((call) => ({
        callId: call.callId ?? randomUUID(),
        // 还原 native 清洗名为原始工具名，使下游 allowedToolNames 匹配与执行查找一致。
        toolName: toolNameMapping.toOriginalName(call.toolName),
        args: call.args ?? {},
      }));

      if (isDebugEnabled('native-tool')) {
        emitDebug('native-tool', 'info', 'post-strip', {
          stepIndex,
          visibleTextLength: visibleText.length,
          visibleTextPreview: visibleText.slice(0, 200),
          normalizedToolCallCount: toolCalls.length,
          bodyHasLeakedToolBlocks: containsNativeToolBlock(result.text),
        });
      }

      // 中间叙述实时旁路：仅当本步触发了工具调用且有可见文本时，把这段叙述作为独立事件
      // 即时下发（判定口径与落库 extractStepNarrations 一致）。末步纯结论步不触发，
      // 它走正文 streaming 通道与最终 message 正文。
      const stepNarrationText = visibleText.trim();
      if (toolCalls.length > 0 && stepNarrationText.length > 0) {
        await this.notifyStepNarration(input, {
          stepIndex,
          text: stepNarrationText,
          createdAt: Date.now(),
        });
      }

      await this.deps.eventBus.emit('generation.completed', {
        sessionId: input.sessionId,
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
        toolCalls,
      };
    };

    const loop = new NativeFunctionCallAgentLoop({ eventBus: this.deps.eventBus });
    const loopResult = await loop.run({
      floorId: input.floorId,
      ...(input.pageId ? { pageId: input.pageId } : {}),
      callerSlot: 'narrator',
      initialMessages,
      tools: args.narratorTools,
      toolContext: args.narratorToolContext,
      permissions: input.toolPermissions!,
      toolExecutor: args.toolExecutor,
      generate,
      decideConfirmation: loopConfig.decideConfirmation,
      ...(loopConfig.resumeApprovedCall ? { resumeApprovedCall: loopConfig.resumeApprovedCall } : {}),
      // step 重试：透传前缀工具往返，loop 在生成前重建前 N-1 步上下文、从第 N 步重启生成。
      ...(input.priorRoundtrips && input.priorRoundtrips.length > 0
        ? { priorRoundtrips: input.priorRoundtrips }
        : {}),
      maxSteps,
      ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
    });

    const finishReason =
      loopResult.stopReason === 'awaiting_confirmation'
        ? 'awaiting_tool_confirmation'
        : lastFinishReason;

    if (isDebugEnabled('native-tool')) {
      emitDebug('native-tool', 'info', 'loop-result', {
        stopReason: loopResult.stopReason,
        steps: loopResult.steps,
        visibleTextLength: loopResult.visibleText.length,
        parsing: {
          blockCount: loopResult.parsing.blockCount,
          acceptedCount: loopResult.parsing.acceptedCount,
          rejectedCount: loopResult.parsing.rejectedCount,
        },
        diagnostics: loopResult.parsing.diagnostics.length,
        finalVisibleTextPreview: loopResult.visibleText.slice(0, 200),
      });
    }

    // native 多步循环下，message 正文只取「最终结论步」，不再拼接多步中间叙述（否则
    // 中间叙述会与结论拼成一段、语义错位，且污染未来楼层 prompt）。中间叙述走阶段二旁路。
    const finalAnswerText = selectFinalAnswerText(loopResult.stepRecords);
    const generation: GenerationOutput = {
      text: finalAnswerText,
      rawText: finalAnswerText,
      summaries: loopResult.summaries,
      usage: loopResult.totalUsage,
      finishReason,
      ...(accumulatedReasoning ? { reasoningText: accumulatedReasoning } : {}),
    };

    await this.notifyPendingOutputUpdate(input, {
      text: generation.text,
      state: 'generated',
      attemptNo: runAttemptNo,
      force: true,
    });

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
          // native不向 transcript 写回工具结果（结构化消息仅用于循环内部续跑）。
          toolResult: {
            writtenBack: false,
            blockCount: 0,
            tokenCount: 0,
            budgetGroup: TEXT_PROTOCOL_TOOL_RESULT_BUDGET_GROUP,
          },
        }
      : undefined;

    return {
      generation,
      ...(toolTransport ? { toolTransport } : {}),
      agentLoopStopReason: loopResult.stopReason,
      agentLoopSteps: loopResult.steps,
      agentStepRecords: loopResult.stepRecords,
      ...(loopResult.pendingConfirmation
        ? {
            pendingToolConfirmation: {
              callId: loopResult.pendingConfirmation.callId,
              toolName: loopResult.pendingConfirmation.toolName,
              args: loopResult.pendingConfirmation.args,
              ...(loopResult.pendingConfirmation.sideEffectLevel
                ? { sideEffectLevel: loopResult.pendingConfirmation.sideEffectLevel }
            : {}),
           conversationMessages: projectAgentLoopMessagesToChat(loopResult.conversationMessages),
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
