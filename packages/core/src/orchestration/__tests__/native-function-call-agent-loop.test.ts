import { describe, expect, it, vi } from 'vitest';

import { createEventBus } from '../../events/index.js';
import type { ToolCallAwaitingConfirmationEvent } from '../../events/index.js';
import type { ToolExecutor } from '../../tools/tool-executor.js';
import type {
  ToolCallResult,
  ToolDefinition,
  ToolExecutionContext,
  ToolPermissions,
} from '../../tools/types.js';
import { NativeFunctionCallAgentLoop } from '../native-function-call-agent-loop.js';
import {
  selectFinalAnswerText,
  type AgentLoopGenerate,
  type AgentLoopStepOutput,
  type AgentLoopStepRecord,
  type NormalizedToolCall,
  type ToolConfirmationDecider,
} from '../agent-loop.js';
import type {
  AssistantToolCallMessage,
  ToolResultModelMessage,
} from '../../llm/types.js';
import { isPlainTextModelMessage } from '../../llm/types.js';

// ── 测试工具 ──────────────────────────────────────────

function defineTool(
  name: string,
  sideEffectLevel: ToolDefinition['sideEffectLevel'],
): ToolDefinition {
  return {
    name,
    description: `${name} description`,
    parameters: { type: 'object', properties: {} },
    sideEffectLevel,
    allowedSlots: [],
    source: 'builtin',
  };
}

const TOOLS: ToolDefinition[] = [
  defineTool('graph_query', 'none'),
  defineTool('graph_create', 'sandbox'),
];

const TOOL_CONTEXT = {
  sessionId: 'sess_1',
  floorId: 'floor_1',
  callerSlot: 'narrator',
  variableContext: { sessionId: 'sess_1' },
} as unknown as ToolExecutionContext;

const PERMISSIONS: ToolPermissions = {
  enabled: true,
  maxStepsPerGeneration: 5,
};

/** 把脚本化的结构化 toolCalls 序列封装成单步生成回调。 */
function scriptedGenerate(
  steps: Array<{ visibleText?: string; toolCalls?: NormalizedToolCall[] }>,
): {
  generate: AgentLoopGenerate;
  calls: Array<{ stepIndex: number; messageCount: number }>;
} {
  const calls: Array<{ stepIndex: number; messageCount: number }> = [];
  const generate: AgentLoopGenerate = async ({ messages, stepIndex }) => {
    calls.push({ stepIndex, messageCount: messages.length });
    const script = steps[stepIndex - 1];
    if (!script) {
      throw new Error(`No scripted generation for step ${stepIndex}`);
    }
    const output: AgentLoopStepOutput = {
      visibleText: script.visibleText ?? '',
      rawText: script.visibleText ?? '',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      finishReason: script.toolCalls && script.toolCalls.length > 0 ? 'tool-calls' : 'stop',
      summaries: [],
      ...(script.toolCalls ? { toolCalls: script.toolCalls } : {}),
    };
    return output;
  };
  return { generate, calls };
}

function makeExecutor(result: ToolCallResult = { data: { ok: true } }): {
  executor: ToolExecutor;
  execute: ReturnType<typeof vi.fn>;
} {
  const execute = vi.fn(async () => result);
  const executor = { execute } as unknown as ToolExecutor;
  return { executor, execute };
}

const ALWAYS_AUTO: ToolConfirmationDecider = () => 'auto';

// ── 用例 ──────────────────────────────────────────────

describe('NativeFunctionCallAgentLoop', () => {
  it('多轮 auto：连续执行结构化工具调用并在无 toolCall 时自然停止', async () => {
  const eventBus = createEventBus();
    const { executor, execute } = makeExecutor();
    const { generate, calls } = scriptedGenerate([
      { visibleText: '先查询。', toolCalls: [{ callId: 'c1', toolName: 'graph_query', args: { q: 'a' } }] },
      { visibleText: '再创建。', toolCalls: [{ callId: 'c2', toolName: 'graph_create', args: { node: 'n' } }] },
      { visibleText: '完成。' },
    ]);

    const loop = new NativeFunctionCallAgentLoop({ eventBus });
    const result = await loop.run({
      floorId: 'floor_1',
      callerSlot: 'narrator',
      initialMessages: [{ role: 'user', content: '帮我建个节点' }],
      tools: TOOLS,
      toolContext: TOOL_CONTEXT,
      permissions: PERMISSIONS,
      toolExecutor: executor,
      generate,
      decideConfirmation: ALWAYS_AUTO,
      maxSteps: 5,
    });

    expect(result.stopReason).toBe('natural_stop');
    expect(result.steps).toBe(3);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenNthCalledWith(1, 'graph_query', { q: 'a' }, { ...TOOL_CONTEXT, generationStepNo: 1 }, PERMISSIONS);
    expect(execute).toHaveBeenNthCalledWith(2, 'graph_create', { node: 'n' }, { ...TOOL_CONTEXT, generationStepNo: 2 }, PERMISSIONS);
    expect(result.visibleText).toBe('先查询。\n\n再创建。\n\n完成。');
    // native 不向 transcript 写回工具结果
    expect(result.toolResultWritebackText).toBeUndefined();
    expect(result.pendingConfirmation).toBeUndefined();
    // 第二步上下文：初始 user+ 第一步 assistant(tool-call) + 第一步 tool(result)
    expect(calls[1]?.messageCount).toBe(3);
    expect(result.parsing.acceptedCount).toBe(2);
  });

  it('结构化回填：assistant 带 tool-call、tool 带 tool-result', async () => {
    const eventBus = createEventBus();
    const { executor } = makeExecutor({ data: { id: 'node_1' } });
    const { generate } = scriptedGenerate([
      { visibleText: '创建。', toolCalls: [{ callId: 'c1', toolName: 'graph_create', args: { node: 'n' } }] },
      { visibleText: '完成。' },
    ]);

    const loop = new NativeFunctionCallAgentLoop({ eventBus });
    const result = await loop.run({
      floorId: 'floor_1',
      callerSlot: 'narrator',
      initialMessages: [{ role: 'user', content: '建一个' }],
      tools: TOOLS,
      toolContext:TOOL_CONTEXT,
      permissions: PERMISSIONS,
      toolExecutor: executor,
      generate,
      decideConfirmation: ALWAYS_AUTO,
      maxSteps: 5,
    });

    const structured = result.conversationMessages.filter((m) => !isPlainTextModelMessage(m));
    const assistant = structured.find((m) => m.role === 'assistant') as AssistantToolCallMessage | undefined;
    const tool = structured.find((m) => m.role === 'tool') as ToolResultModelMessage | undefined;

    expect(assistant).toBeDefined();
    expect(assistant?.content.some((p) => p.type === 'tool-call' && p.toolCallId === 'c1')).toBe(true);
    expect(tool).toBeDefined();
    expect(tool?.content[0]).toMatchObject({
      type: 'tool-result',
      toolCallId: 'c1',
      toolName: 'graph_create',
      output: { type: 'json', value: { id: 'node_1' } },
    });
  });

  it('遇到 confirm 工具：不执行、发 awaiting 事件并暂停', async () => {
    const eventBus = createEventBus();
    const { executor, execute } = makeExecutor();
    const awaiting: ToolCallAwaitingConfirmationEvent[] = [];
    eventBus.on('tool.call_awaiting_confirmation', (event) => {
      awaiting.push(event);
    });

    const { generate } = scriptedGenerate([
      { visibleText: '准备创建。', toolCalls: [{ callId: 'c1', toolName:'graph_create', args: { node: 'n' } }] },
    ]);

    const decide: ToolConfirmationDecider = (ctx) =>
      ctx.toolName === 'graph_create' ? 'confirm' : 'auto';

    const loop = new NativeFunctionCallAgentLoop({ eventBus });
    const result = await loop.run({
      floorId: 'floor_1',
      callerSlot: 'narrator',
      initialMessages: [{ role: 'user', content: '建一个' }],
      tools: TOOLS,
      toolContext: TOOL_CONTEXT,
      permissions: PERMISSIONS,
      toolExecutor: executor,
      generate,
      decideConfirmation: decide,
      maxSteps: 5,
    });

    expect(result.stopReason).toBe('awaiting_confirmation');
    expect(execute).not.toHaveBeenCalled();
    expect(awaiting).toHaveLength(1);
    expect(awaiting[0]?.toolName).toBe('graph_create');
    expect(result.pendingConfirmation).toMatchObject({
      callId: 'c1',
      toolName: 'graph_create',
      sideEffectLevel: 'sandbox',
    });
  });

  it('批准后续跑：先执行已批准工具再进入循环', async () => {
   const eventBus = createEventBus();
 const { executor,execute } = makeExecutor({ data: { ok: true } });
    const { generate } = scriptedGenerate([
      { visibleText: '已建好，继续。' },
    ]);

    const loop = new NativeFunctionCallAgentLoop({ eventBus });
    const result = await loop.run({
      floorId: 'floor_1',
      callerSlot: 'narrator',
      initialMessages: [{ role: 'user', content: '继续' }],
      tools: TOOLS,
      toolContext: TOOL_CONTEXT,
      permissions: PERMISSIONS,
      toolExecutor: executor,
      generate,
      decideConfirmation: ALWAYS_AUTO,
      resumeApprovedCall: { callId: 'c1', toolName: 'graph_create', args: { node: 'n' } },
      maxSteps: 5,
    });

    expect(execute).toHaveBeenCalledWith('graph_create', { node: 'n' }, TOOL_CONTEXT, PERMISSIONS);
    expect(result.stopReason).toBe('natural_stop');
    // 续跑回填了已批准调用的 assistant(tool-call) + tool(result)
    const structured = result.conversationMessages.filter((m) => !isPlainTextModelMessage(m));
    expect(structured.some((m) => m.role === 'assistant')).toBe(true);
    expect(structured.some((m) => m.role === 'tool')).toBe(true);
  });

  it('达到 maxSteps 时以 max_steps 收尾', async () => {
    const eventBus = createEventBus();
    const { executor } = makeExecutor();
    const { generate } = scriptedGenerate([
      { visibleText: '1', toolCalls: [{ callId: 'c1', toolName: 'graph_query', args: {} }] },
      { visibleText: '2', toolCalls: [{ callId: 'c2', toolName: 'graph_query', args: {} }] },
    ]);

    const loop = new NativeFunctionCallAgentLoop({ eventBus });
    const result= await loop.run({
      floorId: 'floor_1',
   callerSlot: 'narrator',
      initialMessages: [{ role: 'user', content:'go' }],
      tools: TOOLS,
  toolContext: TOOL_CONTEXT,
      permissions: PERMISSIONS,
toolExecutor: executor,
      generate,
      decideConfirmation: ALWAYS_AUTO,
      maxSteps: 2,
    });

    expect(result.stopReason).toBe('max_steps');
    expect(result.steps).toBe(2);
  });

  it('未在工具列表中的调用被拒绝计数，不执行', async () => {
    const eventBus = createEventBus();
    const { executor, execute } = makeExecutor();
    const { generate } = scriptedGenerate([
    { visibleText: '调用未知工具。', toolCalls: [{ callId: 'c1', toolName: 'unknown_tool', args: {} }] },
      { visibleText: '停止。' },
    ]);

    const loop = new NativeFunctionCallAgentLoop({ eventBus });
    const result = await loop.run({
      floorId: 'floor_1',
      callerSlot: 'narrator',
      initialMessages: [{ role: 'user', content: 'go' }],
      tools: TOOLS,
   toolContext: TOOL_CONTEXT,
      permissions: PERMISSIONS,
      toolExecutor: executor,
      generate,
      decideConfirmation: ALWAYS_AUTO,
      maxSteps: 5,
    });

    // 未注册工具被过滤：本步无有效调用 → 自然停止；不执行。
    expect(execute).not.toHaveBeenCalled();
    expect(result.stopReason).toBe('natural_stop');
    expect(result.parsing.rejectedCount).toBe(1);
  });

  it('工具执行失败：tool-result 以 error-text 回填，循环继续', async () => {
    const eventBus = createEventBus();
    const { executor, execute } = makeExecutor({ error: 'boom' });
    const { generate } = scriptedGenerate([
      { visibleText: '尝试创建。', toolCalls: [{ callId: 'c1', toolName: 'graph_create', args: { node: 'n' } }] },
      { visibleText: '收到错误，停止。' },
    ]);

    const loop = new NativeFunctionCallAgentLoop({ eventBus });
    const result = await loop.run({
      floorId: 'floor_1',
      callerSlot: 'narrator',
      initialMessages: [{ role: 'user', content: '建一个' }],
      tools: TOOLS,
      toolContext: TOOL_CONTEXT,
      permissions: PERMISSIONS,
      toolExecutor: executor,
      generate,
      decideConfirmation: ALWAYS_AUTO,
      maxSteps: 5,
    });

    // 失败不中断循环：本步执行一次，错误作为 error-text 回填，模型看到后第二步自然停止。
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.stopReason).toBe('natural_stop');
    expect(result.steps).toBe(2);
    const structured = result.conversationMessages.filter((m) => !isPlainTextModelMessage(m));
    const tool = structured.find((m) => m.role === 'tool') as ToolResultModelMessage | undefined;
    expect(tool?.content[0]).toMatchObject({
      type: 'tool-result',
      toolCallId: 'c1',
      toolName: 'graph_create',
      output: { type: 'error-text', value: 'boom' },
    });
    expect(result.visibleText).toContain('收到错误，停止。');
    // native 不向 transcript 写回工具结果（包括错误）。
    expect(result.toolResultWritebackText).toBeUndefined();
  });

  it('stepRecords 按步保留可见文本与是否触发工具（中间叙述 + 末步结论）', async () => {
    const eventBus = createEventBus();
    const { executor } = makeExecutor();
    // 还原实测场景：第1、3步边叙述边调用工具，末步只有结论。
    const { generate } = scriptedGenerate([
      { visibleText: '我来先找到这张图。', toolCalls: [{ callId: 'c1', toolName: 'graph_query', args: {} }] },
      { visibleText: '', toolCalls: [{ callId: 'c2', toolName: 'graph_query', args: {} }] },
      { visibleText: '这张图很大，需要确认节点语义。', toolCalls: [{ callId: 'c3', toolName: 'graph_query', args: {} }] },
      { visibleText: '我已经读完了，结论是主体框架忠实。' },
    ]);

    const loop = new NativeFunctionCallAgentLoop({ eventBus });
    const result = await loop.run({
      floorId: 'floor_1',
      callerSlot: 'narrator',
      initialMessages: [{ role: 'user', content: '分析这张图' }],
      tools: TOOLS,
      toolContext: TOOL_CONTEXT,
      permissions: PERMISSIONS,
      toolExecutor: executor,
      generate,
      decideConfirmation: ALWAYS_AUTO,
      maxSteps: 5,
    });

    expect(result.stepRecords).toHaveLength(4);
    expect(result.stepRecords.map((r) => r.hasToolCalls)).toEqual([true, true, true, false]);
    expect(result.stepRecords.map((r) => r.visibleText)).toEqual([
      '我来先找到这张图。',
      '',
      '这张图很大，需要确认节点语义。',
      '我已经读完了，结论是主体框架忠实。',
    ]);
 // selectFinalAnswerText 取末步结论，而非多段拼接。
    expect(selectFinalAnswerText(result.stepRecords)).toBe('我已经读完了，结论是主体框架忠实。');
  });
});

describe('selectFinalAnswerText', () => {
  function rec(stepIndex: number,visibleText: string, hasToolCalls: boolean): AgentLoopStepRecord {
    return { stepIndex, visibleText, hasToolCalls, createdAt: stepIndex };
  }

  it('末步有结论：取末步可见文本', () => {
    expect(selectFinalAnswerText([rec(1, '叙述', true), rec(2, '结论', false)])).toBe('结论');
  });

  it('末步为空、前有未触发工具的结论步：取该结论步', () => {
    expect(
      selectFinalAnswerText([rec(1, '叙述', true), rec(2, '结论', false), rec(3, '', false)]),
    ).toBe('结论');
  });

  it('每步都触发工具（无纯结论步）：回退到最后一条非空可见文本', () => {
    expect(selectFinalAnswerText([rec(1, '叙述一', true),rec(2, '叙述二', true)])).toBe('叙述二');
  });

  it('全部为空：返回空串', () => {
    expect(selectFinalAnswerText([rec(1, '', true), rec(2, '', false)])).toBe('');
  });

  it('空序列：返回空串', () => {
    expect(selectFinalAnswerText([])).toBe('');
  });
});

describe('NativeFunctionCallAgentLoop priorRoundtrips（step 重试前缀重启）', () => {
  it('给定前 2 步工具往返：从第 3 步生成，stepIndex 基线与 stepRecords 连续', async () => {
    const eventBus = createEventBus();
    const { executor, execute } = makeExecutor();
    // 前两步是已完成的工具往返（预置），generate 只应被第 3 步调用一次。
    const { generate, calls } = scriptedGenerate([
      { visibleText: '占位（不应被调用）' },
      { visibleText: '占位（不应被调用）' },
      { visibleText: '完成。' },
    ]);

    const loop = new NativeFunctionCallAgentLoop({ eventBus });
    const result = await loop.run({
      floorId: 'floor_1',
      callerSlot: 'narrator',
      initialMessages: [{ role: 'user', content: '分析这张图' }],
      tools: TOOLS,
      toolContext: TOOL_CONTEXT,
      permissions: PERMISSIONS,
      toolExecutor: executor,
      generate,
      decideConfirmation: ALWAYS_AUTO,
      priorRoundtrips: [
        {
          stepIndex: 1,
          visibleText: '先查询。',
          calls: [
            { callId: 'p1', toolName: 'graph_query', args: { q: 'a' }, result: { data: { ok: true } } },
          ],
        },
        {
          stepIndex: 2,
          visibleText: '再查询。',
          calls: [
            { callId: 'p2', toolName: 'graph_query', args: { q: 'b' }, result: { data: { ok: true } } },
          ],
        },
      ],
      maxSteps: 5,
    });

    // 前缀往返不重新执行工具（结果已预置），第 3 步无 toolCall 自然停止。
    expect(execute).not.toHaveBeenCalled();
    expect(result.stopReason).toBe('natural_stop');
    expect(result.steps).toBe(3);

    // generate 只被调用一次，且是第 3 步；其上下文应含初始 user + 两步前缀往返（各 assistant+tool）。
    expect(calls).toHaveLength(1);
    expect(calls[0]?.stepIndex).toBe(3);
   expect(calls[0]?.messageCount).toBe(5);

    // stepRecords 连续重新编号 1..3，前两步标记触发工具，末步为结论步。
    expect(result.stepRecords.map((r) => r.stepIndex)).toEqual([1, 2, 3]);
    expect(result.stepRecords.map((r) => r.hasToolCalls)).toEqual([true, true, false]);
    expect(result.visibleText).toBe('先查询。\n\n再查询。\n\n完成。');

    // 上下文里重建了前缀往返的结构化 tool-call / tool-result。
    const structured = result.conversationMessages.filter((m) => !isPlainTextModelMessage(m));
    const toolCallIds = structured
      .filter((m): m is AssistantToolCallMessage => m.role === 'assistant')
      .flatMap((m) => m.content)
      .filter((p) => p.type === 'tool-call')
      .map((p) => (p as { toolCallId: string }).toolCallId);
    expect(toolCallIds).toContain('p1');
    expect(toolCallIds).toContain('p2');

    expect(selectFinalAnswerText(result.stepRecords)).toBe('完成。');
  });

  it('priorRoundtrips 为空：行为与首次生成一致（回归）', async () => {
    const eventBus = createEventBus();
    const { executor } = makeExecutor();
    const { generate, calls } = scriptedGenerate([{ visibleText: '直接回答。' }]);

    const loop = new NativeFunctionCallAgentLoop({ eventBus });
    const result = await loop.run({
      floorId: 'floor_1',
      callerSlot: 'narrator',
      initialMessages: [{ role: 'user', content: '你好' }],
      tools: TOOLS,
      toolContext: TOOL_CONTEXT,
      permissions: PERMISSIONS,
      toolExecutor: executor,
      generate,
      decideConfirmation: ALWAYS_AUTO,
      priorRoundtrips: [],
      maxSteps: 5,
    });

    expect(result.stopReason).toBe('natural_stop');
    expect(result.steps).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.stepIndex).toBe(1);
    expect(calls[0]?.messageCount).toBe(1);
    expect(result.stepRecords.map((r) => r.stepIndex)).toEqual([1]);
    expect(result.visibleText).toBe('直接回答。');
  });

  it('priorRoundtrips 与 resumeApprovedCall 互斥：同时传入抛错', async () => {
    const eventBus = createEventBus();
    const { executor } = makeExecutor();
    const { generate } = scriptedGenerate([{ visibleText: '完成。' }]);

    const loop = new NativeFunctionCallAgentLoop({ eventBus });
    await expect(
      loop.run({
        floorId: 'floor_1',
        callerSlot: 'narrator',
        initialMessages: [{ role: 'user', content: 'go' }],
        tools: TOOLS,
        toolContext: TOOL_CONTEXT,
        permissions: PERMISSIONS,
        toolExecutor: executor,
        generate,
        decideConfirmation: ALWAYS_AUTO,
        resumeApprovedCall: { callId: 'c1', toolName: 'graph_create', args: { node: 'n' } },
        priorRoundtrips: [
          {
            stepIndex: 1,
            visibleText: '查询。',
            calls: [
              { callId: 'p1', toolName: 'graph_query', args: {}, result: { data: { ok: true } } },
            ],
          },
        ],
        maxSteps: 5,
      }),
    ).rejects.toThrow(/priorRoundtrips/);
  });
});

