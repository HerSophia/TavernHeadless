import type { CoreEventBus } from '../events/index.js';
import type {
  LLMMessage,
  ModelTextPart,
  ModelToolCallPart,
  ModelToolResultOutput,
  ModelToolResultPart,
} from '../llm/types.js';
import type { ToolCallResult, ToolDefinition } from '../tools/types.js';
import type { ToolCallParseDiagnostic, ToolCallParseStats } from '../tools/transport/index.js';
import { runAgentLoop } from './agent-loop.js';
import type {
  AgentLoopExecutedCall,
  AgentLoopRunInput,
  AgentLoopResult,
  AgentLoopStepOutput,
  AgentLoopTransport,
  NormalizedToolCall,
} from './agent-loop.js';

/**
 * 把工具执行结果转成结构化 tool-result 输出。
 *
 * 成功用 json 输出，失败用 error-text，让模型在续跑时看到错误并自行处理。
 */
function toToolResultOutput(result: ToolCallResult): ModelToolResultOutput {
  if (result.error) {
    return { type: 'error-text', value: result.error };
  }
  return { type: 'json', value: result.data ?? null };
}

function buildToolResultPart(call: NormalizedToolCall, result: ToolCallResult): ModelToolResultPart {
  return {
    type: 'tool-result',
    toolCallId: call.callId,
   toolName: call.toolName,
    output: toToolResultOutput(result),
  };
}

function buildToolCallPart(call: NormalizedToolCall, args: Record<string, unknown>): ModelToolCallPart {
  return {
    type: 'tool-call',
    toolCallId: call.callId,
    toolName: call.toolName,
    input: args,
  };
}

// ── native function call 传输适配 ─────────────────────

/**
 * native function calling 传输适配。
 *
 * 与传输强绑定的三处行为：
 * - 解析：直接读模型返回的结构化 toolCalls（schema-only 工具，SDK 不自动执行）。
 * - 回填：assistant(tool-call parts) + tool(tool-result parts) 结构化消息。
 * - 参数：SDK 已给出结构化对象，无需还原。
 *
 * 不向 transcript 写回工具结果（不实现 formatWritebackBlock），结构化消息仅用于
 * 循环内部续跑。
 */
export class NativeFunctionCallTransport implements AgentLoopTransport {
  parseCalls(
    output: AgentLoopStepOutput,
    allowedToolNames: Set<string>,
  ): {
    calls: NormalizedToolCall[];
    diagnostics: ToolCallParseDiagnostic[];
    stats: ToolCallParseStats;
  } {
    const rawCalls = output.toolCalls ?? [];
    const calls = rawCalls.filter((call) => allowedToolNames.has(call.toolName));
    const rejectedCount = rawCalls.length - calls.length;
    return {
      calls,
      diagnostics: [],
      stats: {
        blockCount: rawCalls.length,
        acceptedCount: calls.length,
        rejectedCount,
      },
    };
  }

  coerceArgs(call: NormalizedToolCall, _tool: ToolDefinition | undefined): Record<string, unknown> {
    // SDK 已按工具 schema 给出结构化参数对象，无需再还原。
    return call.args;
  }

  buildStepMessages(args: {
    output: AgentLoopStepOutput;
    executed: AgentLoopExecutedCall[];
    stepBlocks: string[];
    paused: boolean;
  }): LLMMessage[] {
    // 仅为已执行的 auto 调用构造 assistant(tool-call) + tool(result)，保证每个 tool-call
    // 都有匹配的 tool-result（SDK 要求）。遇到 confirm 暂停的调用不在此回填，
    // 待批准后由 buildResumeMessages 重建其往返对。
    if (args.executed.length === 0) {
      return [];
    }

    const assistantParts: Array<ModelTextPart | ModelToolCallPart> = [];
    const visible = args.output.visibleText.trim();
    if (visible.length > 0) {
      assistantParts.push({ type: 'text', text: args.output.visibleText });
    }
    for (const item of args.executed) {
      assistantParts.push(buildToolCallPart(item.call, item.coercedArgs));
    }

    const toolParts: ModelToolResultPart[] = args.executed.map((item) =>
      buildToolResultPart(item.call, item.result),
    );

    return [
      { role: 'assistant', content: assistantParts },
      { role: 'tool', content: toolParts },
    ];
  }

  buildInvalidFormatFeedback(): undefined {
    // native 不产生解析诊断，无需纠正反馈。
    return undefined;
  }

  buildResumeMessages(
    call: NormalizedToolCall,
    coercedArgs: Record<string, unknown>,
    result: ToolCallResult,
  ): LLMMessage[] {
    // 续跑：重建已批准调用的 assistant(tool-call) + tool(result) 往返对。
    return [
      { role: 'assistant', content: [buildToolCallPart(call, coercedArgs)] },
      { role: 'tool', content: [buildToolResultPart(call, result)] },
    ];
  }
}

// ── NativeFunctionCallAgentLoop ───────────────────────

/**
 * native function calling 多轮 agent 循环。
 *
 * 复用场景无关的循环骨架（确认闸、暂停 / 续跑、maxSteps、事件、结果聚合），
 * 只替换与传输强绑定的解析与回填。模型用原生协议返回 toolCalls，仓库自驱动执行。
 */
export class NativeFunctionCallAgentLoop {
  private readonly eventBus: CoreEventBus;
  private readonly transport: NativeFunctionCallTransport;

  constructor(deps: { eventBus: CoreEventBus }) {
    this.eventBus = deps.eventBus;
    this.transport = new NativeFunctionCallTransport();
  }

  run(input: AgentLoopRunInput): Promise<AgentLoopResult> {
    return runAgentLoop(input, this.transport, this.eventBus);
  }
}
