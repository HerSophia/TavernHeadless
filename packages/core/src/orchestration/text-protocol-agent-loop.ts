import type { CoreEventBus } from '../events/index.js';
import type { InstanceSlot, TokenUsage } from '../llm/types.js';
import type { ChatMessage } from '../prompt/types.js';
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolPermissions,
  ToolSideEffectLevel,
} from '../tools/types.js';
import type { ToolExecutor } from '../tools/tool-executor.js';
import {
  TextProtocolToolCallParser,
  TextProtocolToolResultFormatter,
} from '../tools/transport/index.js';
import type { ToolCallParseDiagnostic, ToolCallParseStats } from '../tools/transport/index.js';

// ── 确认决策 ──────────────────────────────────────────

/**
 * 单个工具的执行前确认决策。
 *
 * - `auto`：直接执行，结果喂回循环上下文，继续多轮。
 * - `confirm`：不执行，登记待确认并暂停，等待用户批准。
 */
export type GraphToolConfirmationDecision = 'auto' | 'confirm';

/** 确认决策回调的输入上下文。 */
export interface GraphToolConfirmationContext {
  toolName: string;
  args: Record<string, unknown>;
  callId: string;
  floorId: string;
  pageId?: string;
  /** 当前是第几个生成步（1-based）。 */
  stepIndex: number;
}

/**
 * 确认决策回调。
 *
 * 由 apps/api 注入，决策来源通常是 `GraphAssistantToolPolicyService.resolveEffective`。
 * core 不反向依赖该服务，只消费回调结果。
 */
export type GraphToolConfirmationDecider = (
  ctx: GraphToolConfirmationContext,
) => GraphToolConfirmationDecision | Promise<GraphToolConfirmationDecision>;

// ── 单步生成回调 ──────────────────────────────────────

/** 单步生成回调输入。 */
export interface AgentLoopStepInput {
  /** 当前累计的对话上下文（含此前轮次的 assistant 输出与工具结果）。 */
  messages: ChatMessage[];
  /** 当前是第几个生成步（1-based）。 */
  stepIndex: number;
}

/** 单步生成回调输出。 */
export interface AgentLoopStepOutput {
  /** 去除 `<tool_call>` 块后的可见文本（用于落库 / 展示）。 */
  visibleText: string;
  /** 原始模型输出文本（用于解析 `<tool_call>` 与回填上下文）。 */
  rawText: string;
  usage: TokenUsage;
  finishReason: string;
  summaries: string[];
}

/** 由上层（TurnOrchestrator）提供的单步生成实现。 */
export type AgentLoopGenerate = (
  input: AgentLoopStepInput,
) => Promise<AgentLoopStepOutput>;

// ── 循环结果 ──────────────────────────────────────────

/** 循环停止原因。 */
export type AgentLoopStopReason =
  | 'natural_stop'
  | 'awaiting_confirmation'
  | 'max_steps';

/** 暂停时登记的待确认工具调用信息。 */
export interface AgentLoopPendingConfirmation {
  callId: string;
  toolName: string;
  args: Record<string, unknown>;
  sideEffectLevel?: ToolSideEffectLevel;
}

/** 循环执行结果。 */
export interface AgentLoopResult {
  stopReason: AgentLoopStopReason;
  /** 跨步累计的可见文本（按步以空行连接）。 */
  visibleText: string;
  summaries: string[];
  totalUsage: TokenUsage;
  /** 实际执行的生成步数。 */
  steps: number;
  /** 累计的工具结果写回块（auto 工具执行后的 `<tool_result>` 文本）。 */
  toolResultWritebackText?: string;
  /** 暂停时的待确认调用（仅 stopReason='awaiting_confirmation'时存在）。 */
  pendingConfirmation?: AgentLoopPendingConfirmation;
  /**
   * 暂停 / 停止时的完整对话上下文，供 apps/api 持久化以支持续跑。
   *
   * 包含初始 messages、各步 assistant 原始输出、以及各步工具结果用户消息。
   */
  conversationMessages: ChatMessage[];
  /** 跨步聚合的解析统计。 */
  parsing: ToolCallParseStats & {
    diagnostics: ToolCallParseDiagnostic[];
  };
}

/** 循环执行输入。 */
export interface AgentLoopRunInput {
  floorId: string;
  pageId?: string;
  callerSlot: InstanceSlot;
  /** 初始对话上下文（已拼装好的 messages）。 */
  initialMessages: ChatMessage[];
  /** 本轮对图助手可见的工具（auto 与 confirm 都暴露）。 */
  tools: ToolDefinition[];
  toolContext: ToolExecutionContext;
  permissions: ToolPermissions;
  toolExecutor: ToolExecutor;
  /** 单步生成实现。 */
  generate: AgentLoopGenerate;
  /** 确认决策回调。 */
  decideConfirmation: GraphToolConfirmationDecider;
  /**
   * 批准后续跑：在进入生成循环前先执行这个已批准的（原为 confirm 的）工具调用，
   * 把结果回填进上下文，再从该上下文繼续多轮生成。
   *
   * 仅由 apps/api 的「批准后续跑」路径传入；首次生成不传。
   */
  resumeApprovedCall?: {
    callId: string;
    toolName: string;
    args: Record<string, unknown>;
  };
  /** 最大生成步数（复用 maxStepsPerGeneration 语义）。 */
  maxSteps: number;
  abortSignal?: AbortSignal;
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
    completionTokens: safeToken(a.completionTokens) + safeToken(b.completionTokens),
    totalTokens: safeToken(a.totalTokens) + safeToken(b.totalTokens),
  };
}

function zeroUsage(): TokenUsage {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}

// ── TextProtocolAgentLoop ─────────────────────────────

/**
 * 文本协议图助手多轮 agent 循环。
 *
 * 本循环只为图助手（`purpose=graph-assistant`）的 text_protocol 路径服务，
 * 由 TurnOrchestrator 在该路径上显式驱动；主链与其他会话的 text_protocol 仍走单轮逻辑，
 * 行为不受影响。
 *
 * 循环形态：
 * 1. 调模型生成一轮文本。
 * 2. 解析其中的 `<tool_call>` 块。
 * 3. 无 tool_call：agent 自然停止（natural_stop），交还控制权。
 * 4. 有 tool_call：逐个查 auto/confirm。
 *    - auto：执行、把工具结果回填进上下文，继续循环。
 *    - confirm：不执行，发 `tool.call_awaiting_confirmation` 事件并暂停（awaiting_confirmation）。
 * 5. 达到maxSteps 时收尾（max_steps）。
 *
 * 依赖方向：core 不依赖 apps/api 与图助手策略服务；auto/confirm 决策以回调注入。
 */
export class TextProtocolAgentLoop {
  private readonly eventBus: CoreEventBus;
  private readonly parser: TextProtocolToolCallParser;
  private readonly formatter: TextProtocolToolResultFormatter;

  constructor(deps: {
    eventBus: CoreEventBus;
    parser?: TextProtocolToolCallParser;
    formatter?: TextProtocolToolResultFormatter;
  }) {
    this.eventBus = deps.eventBus;
    this.parser = deps.parser ?? new TextProtocolToolCallParser();
    this.formatter = deps.formatter ?? new TextProtocolToolResultFormatter();
  }

  async run(input: AgentLoopRunInput): Promise<AgentLoopResult> {
    const allowedToolNames = new Set(input.tools.map((tool) => tool.name));
    const toolsByName = new Map(input.tools.map((tool) => [tool.name, tool] as const));

    const messages: ChatMessage[] = [...input.initialMessages];
    const visibleParts: string[] = [];
    const summaries: string[] = [];
    const writebackBlocks: string[] = [];
    const aggregatedDiagnostics: ToolCallParseDiagnostic[] = [];
    let aggregatedBlockCount = 0;
    let aggregatedAcceptedCount = 0;
    let aggregatedRejectedCount = 0;
    let totalUsage = zeroUsage();
    let steps = 0;
    let stopReason: AgentLoopStopReason | undefined;
    let pendingConfirmation: AgentLoopPendingConfirmation | undefined;

    const maxSteps = Math.max(1, Math.trunc(input.maxSteps));

    // 批准后续跑：先执行已批准的工具调用，把结果作为用户消息回填，再进入生成循环。
    // 这一步不计入生成步数（它是工具执行而非模型生成）。
    if (input.resumeApprovedCall) {
      const approved = input.resumeApprovedCall;
      const result = await input.toolExecutor.execute(
        approved.toolName,
        approved.args,
        input.toolContext,
        input.permissions,
      );
      const block = this.formatter.format({
        callId: approved.callId,
        toolName: approved.toolName,
        result,
      }).content;
      writebackBlocks.push(block);
      messages.push({ role: 'user', content: block });
    }

    while (steps < maxSteps) {
      if (input.abortSignal?.aborted) {
        break;
      }

      steps += 1;
      const generation = await input.generate({
        messages: [...messages],
        stepIndex: steps,
      });

      totalUsage = addUsage(totalUsage, generation.usage);
      if (generation.summaries.length > 0) {
        summaries.push(...generation.summaries);
      }
      const visible = generation.visibleText.trim();
      if (visible.length > 0) {
        visibleParts.push(visible);
      }

      const parseOutput = this.parser.parse({
        modelOutputText: generation.rawText,
        allowedToolNames,
      });
      aggregatedBlockCount += parseOutput.stats.blockCount;
      aggregatedAcceptedCount += parseOutput.stats.acceptedCount;
      aggregatedRejectedCount += parseOutput.stats.rejectedCount;
      if (parseOutput.diagnostics.length > 0) {
        aggregatedDiagnostics.push(...parseOutput.diagnostics);
      }

      if (parseOutput.calls.length === 0) {
        stopReason = 'natural_stop';
        break;
      }

      // assistant 轮次：原始输出（含 tool_call 块）回填进上下文
      messages.push({ role: 'assistant', content: generation.rawText });

      const stepResultBlocks: string[] = [];
      let paused = false;

      for (const call of parseOutput.calls) {
        const decision = await input.decideConfirmation({
          toolName: call.toolName,
          args: call.args,
          callId: call.callId,
          floorId: input.floorId,
          pageId: input.pageId,
          stepIndex: steps,
        });

        if (decision === 'confirm') {
          const sideEffectLevel = toolsByName.get(call.toolName)?.sideEffectLevel;
          pendingConfirmation = {
            callId: call.callId,
            toolName: call.toolName,
            args: call.args,
            ...(sideEffectLevel ? { sideEffectLevel } : {}),
          };

          await this.eventBus.emit('tool.call_awaiting_confirmation', {
            floorId: input.floorId,
            ...(input.pageId ? { pageId: input.pageId } : {}),
            callerSlot: input.callerSlot,
            callId: call.callId,
            ...(sideEffectLevel ? { sideEffectLevel } : {}),
            toolName: call.toolName,
            args: call.args,
          });

          paused = true;
          break;
        }

        // auto：执行并把结果回填
        const result = await input.toolExecutor.execute(
          call.toolName,
          call.args,
          input.toolContext,
          input.permissions,
        );
        const block = this.formatter.format({
          callId: call.callId,
          toolName: call.toolName,
          result,
        }).content;
        stepResultBlocks.push(block);
        writebackBlocks.push(block);
      }

      // 已执行的 auto 工具结果作为用户消息回填，供续跑模型查看
      if (stepResultBlocks.length > 0) {
        messages.push({ role: 'user', content: stepResultBlocks.join('\n\n') });
      }

      if (paused) {
        stopReason = 'awaiting_confirmation';
        break;
      }

      // 继续循环：下一步模型可看到本步工具结果
    }

    if (!stopReason) {
      stopReason = 'max_steps';
    }

    return {
      stopReason,
      visibleText: visibleParts.join('\n\n'),
      summaries,
      totalUsage,
      steps,
      ...(writebackBlocks.length > 0
        ? { toolResultWritebackText: writebackBlocks.join('\n\n') }
        : {}),
      ...(pendingConfirmation ? { pendingConfirmation } : {}),
      conversationMessages: messages,
      parsing: {
        blockCount: aggregatedBlockCount,
        acceptedCount: aggregatedAcceptedCount,
        rejectedCount: aggregatedRejectedCount,
        diagnostics: aggregatedDiagnostics,
      },
    };
  }
}
