import type { CoreEventBus } from '../events/index.js';
import type { LLMMessage } from '../llm/types.js';
import type { ToolCallResult, ToolDefinition } from '../tools/types.js';
import {
  TextProtocolToolCallParser,
  TextProtocolToolResultFormatter,
  coerceTextProtocolToolArgs,
  buildTextProtocolToolCallFeedback,
} from '../tools/transport/index.js';
import type { ToolCallParseDiagnostic, ToolCallParseStats } from '../tools/transport/index.js';
import {
  runAgentLoop,
} from './agent-loop.js';
import type {
  AgentLoopExecutedCall,
  AgentLoopRunInput,
  AgentLoopResult,
  AgentLoopStepOutput,
  AgentLoopTransport,
  NormalizedToolCall,
  ToolConfirmationContext,
  ToolConfirmationDecider,
  ToolConfirmationDecision,
} from './agent-loop.js';

// ── 向后兼容的类型再导出 ──────────────────────────────
//
// 循环骨架已抽到场景无关的 agent-loop.ts。下面这些 `Graph*` 别名只为兼容既有引用
// （apps/api、core 的 index 与 orchestration/types）。新代码应直接用 agent-loop.ts
// 的场景无关命名（ToolConfirmation*）。

/** @deprecated 使用 agent-loop.ts 的 {@link ToolConfirmationDecision}。 */
export type GraphToolConfirmationDecision = ToolConfirmationDecision;
/** @deprecated 使用 agent-loop.ts 的 {@link ToolConfirmationContext}。 */
export type GraphToolConfirmationContext = ToolConfirmationContext;
/** @deprecated 使用 agent-loop.ts 的 {@link ToolConfirmationDecider}。 */
export type GraphToolConfirmationDecider = ToolConfirmationDecider;

export type {
  AgentLoopStepInput,
  AgentLoopStepOutput,
  AgentLoopGenerate,
  AgentLoopStopReason,
  AgentLoopPendingConfirmation,
  AgentLoopResult,
  AgentLoopRunInput,
  AgentLoopPriorRoundtrip,
  AgentLoopPriorRoundtripCall,
  ToolConfirmationDecision,
  ToolConfirmationContext,
  ToolConfirmationDecider,
  NormalizedToolCall,
} from './agent-loop.js';

// ── 文本协议传输适配 ──────────────────────────────────

/**
 * 文本协议传输适配。
 *
 * 与传输强绑定的三处行为：
 * - 解析：从模型原文解析 `<tool_call>` 块。
 * - 回填：工具结果以 `<tool_result>` 文本作为 role=user 消息回填。
 * - 参数还原：把字符串化 JSON 按工具 schema 还原顶层类型。
 */
export class TextProtocolTransport implements AgentLoopTransport {
  constructor(
    private readonly parser: TextProtocolToolCallParser,
    private readonly formatter: TextProtocolToolResultFormatter,
  ) {}

  parseCalls(
    output: AgentLoopStepOutput,
allowedToolNames: Set<string>,
  ): {
    calls: NormalizedToolCall[];
    diagnostics: ToolCallParseDiagnostic[];
    stats: ToolCallParseStats;
  } {
    const parseOutput = this.parser.parse({
      modelOutputText: output.rawText,
      allowedToolNames,
    });
    return {
      calls: parseOutput.calls.map((call) => ({
        callId: call.callId,
        toolName: call.toolName,
        args: call.args,
      })),
      diagnostics: parseOutput.diagnostics,
      stats: parseOutput.stats,
    };
  }

  coerceArgs(call: NormalizedToolCall, tool: ToolDefinition | undefined): Record<string, unknown> {
    // text_protocol 下模型只能输出字符串化 JSON，按工具 schema 还原顶层参数类型，
    // 避免带引号的布尔/数字/数组导致执行失败。确认与执行均使用还原后的参数。
    return coerceTextProtocolToolArgs(call.args, tool?.parameters);
  }

  buildStepMessages(args: {
    output: AgentLoopStepOutput;
    executed: AgentLoopExecutedCall[];
    stepBlocks: string[];
    paused: boolean;
  }): LLMMessage[] {
    // assistant 轮次：原始输出（含 tool_call 块）回填进上下文。
 const messages: LLMMessage[] = [{ role: 'assistant', content: args.output.rawText }];
    // 已执行的 auto 工具结果作为用户消息回填，供续跑模型查看。
    if (args.stepBlocks.length > 0) {
      messages.push({ role: 'user', content: args.stepBlocks.join('\n\n') });
    }
    return messages;
  }

  buildInvalidFormatFeedback(
    output: AgentLoopStepOutput,
    diagnostics: ToolCallParseDiagnostic[],
  ): LLMMessage[] {
    // 回填：assistant 原始输出 + 面向模型的格式纠正反馈，供下一步参考。
    return [
      {role: 'assistant', content: output.rawText },
      { role: 'user', content: buildTextProtocolToolCallFeedback(diagnostics) },
    ];
  }

  buildResumeMessages(
    call: NormalizedToolCall,
    _coercedArgs: Record<string, unknown>,
    result: ToolCallResult,
  ): LLMMessage[] {
    return [{ role: 'user', content: this.formatBlock(call, result) }];
  }

  formatWritebackBlock(call: NormalizedToolCall, result: ToolCallResult): string {
    return this.formatBlock(call, result);
  }

  private formatBlock(call: NormalizedToolCall, result: ToolCallResult): string {
    return this.formatter.format({
      callId:call.callId,
      toolName: call.toolName,
      result,
    }).content;
  }
}

// ── TextProtocolAgentLoop ─────────────────────────────

/**
 * 文本协议多轮 agent 循环。
 *
 * 仅为 text_protocol 路径服务，由 TurnOrchestrator 在该路径上显式驱动。
 *循环骨架（确认闸、暂停 / 续跑、maxSteps 计数、事件、结果聚合）已抽到场景无关的
 * `agent-loop.ts`，本类只提供文本协议传输适配，行为与重构前一致。
 */
export class TextProtocolAgentLoop {
  private readonly eventBus: CoreEventBus;
  private readonly transport: TextProtocolTransport;

  constructor(deps: {
eventBus: CoreEventBus;
    parser?: TextProtocolToolCallParser;
    formatter?: TextProtocolToolResultFormatter;
  }) {
    this.eventBus = deps.eventBus;
    this.transport = new TextProtocolTransport(
      deps.parser ?? new TextProtocolToolCallParser(),
      deps.formatter ?? new TextProtocolToolResultFormatter(),
    );
  }

  run(input: AgentLoopRunInput): Promise<AgentLoopResult> {
    return runAgentLoop(input, this.transport, this.eventBus);
  }
}
