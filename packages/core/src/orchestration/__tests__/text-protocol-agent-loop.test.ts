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
import {
  TextProtocolAgentLoop,
  type AgentLoopGenerate,
  type AgentLoopStepOutput,
  type GraphToolConfirmationDecider,
} from '../text-protocol-agent-loop.js';

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

function toolCallBlock(callId: string, name: string, args: Record<string, unknown>): string {
  return `<tool_call id="${callId}" name="${name}">${JSON.stringify({ args })}</tool_call>`;
}

/** 把脚本化的 rawText 序列封装成单步生成回调。 */
function scriptedGenerate(steps: Array<{ visibleText?: string; rawText: string }>): {
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
      rawText: script.rawText,
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      finishReason: 'stop',
      summaries: [],
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

const ALWAYS_AUTO: GraphToolConfirmationDecider = () => 'auto';

// ── 用例 ──────────────────────────────────────────────

describe('TextProtocolAgentLoop', () => {
  it('多轮 auto：连续执行工具并在无 tool_call 时自然停止', async () => {
    const eventBus = createEventBus();
    const { executor, execute } = makeExecutor();
    const { generate, calls } = scriptedGenerate([
      { visibleText: '先查询。', rawText: `先查询。\n${toolCallBlock('c1', 'graph_query', { q: 'a' })}` },
      { visibleText: '再创建。', rawText: `再创建。\n${toolCallBlock('c2', 'graph_create', { node: 'n' })}` },
      { visibleText: '完成。', rawText: '完成。' },
    ]);

    const loop = new TextProtocolAgentLoop({ eventBus });
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
    expect(result.toolResultWritebackText).toBeDefined();
    expect(result.pendingConfirmation).toBeUndefined();
    // 第二步的上下文包含：初始 user + 第一步 assistant + 第一步工具结果 user
    expect(calls[1]?.messageCount).toBe(3);
    expect(result.parsing.acceptedCount).toBe(2);
  });

  it('遇到 confirm 工具：不执行、发 awaiting 事件并暂停', async () => {
    const eventBus = createEventBus();
    const { executor, execute } = makeExecutor();
    const awaiting: ToolCallAwaitingConfirmationEvent[] = [];
    eventBus.on('tool.call_awaiting_confirmation', (event) => {
      awaiting.push(event);
    });

    const { generate } = scriptedGenerate([
      { visibleText: '准备创建。', rawText: `准备创建。\n${toolCallBlock('c1', 'graph_create', { node: 'n' })}` },
    ]);

    const decide: GraphToolConfirmationDecider = ({ toolName }) =>
      toolName === 'graph_create' ? 'confirm' : 'auto';

    const loop = new TextProtocolAgentLoop({ eventBus });
    const result = await loop.run({
      floorId: 'floor_1',
      pageId: 'page_1',
      callerSlot: 'narrator',
      initialMessages: [{ role: 'user', content: '建节点' }],
      tools: TOOLS,
      toolContext: TOOL_CONTEXT,
      permissions: PERMISSIONS,
      toolExecutor: executor,
      generate,
      decideConfirmation: decide,
      maxSteps: 5,
    });

    expect(result.stopReason).toBe('awaiting_confirmation');
    expect(result.steps).toBe(1);
    expect(execute).not.toHaveBeenCalled();
    expect(result.pendingConfirmation).toEqual({
      callId: 'c1',
      toolName: 'graph_create',
      args: { node: 'n' },
      sideEffectLevel: 'sandbox',
    });
    expect(awaiting).toHaveLength(1);
    expect(awaiting[0]).toMatchObject({
      floorId: 'floor_1',
      pageId: 'page_1',
      callerSlot: 'narrator',
      callId: 'c1',
      toolName: 'graph_create',
      args: { node: 'n' },
      sideEffectLevel: 'sandbox',
    });
    // 暂停时已把 assistant 轮次回填进上下文（无 auto 结果用户消息）
    const lastMessage = result.conversationMessages.at(-1);
    expect(lastMessage?.role).toBe('assistant');
  });

  it('同一步 auto+confirm 混合：auto 先执行、遇 confirm 中止后续（决策 B）', async () => {
    const eventBus = createEventBus();
    const { executor, execute } = makeExecutor();
    const rawText = [
      '混合调用。',
      toolCallBlock('c1', 'graph_query', { q: 'a' }),
      toolCallBlock('c2', 'graph_create', { node: 'n' }),
      toolCallBlock('c3', 'graph_query', { q: 'b' }),
    ].join('\n');
    const { generate } = scriptedGenerate([{ visibleText: '混合调用。', rawText }]);

    const decide: GraphToolConfirmationDecider = ({ toolName }) =>
      toolName === 'graph_create' ? 'confirm' : 'auto';

    const loop = new TextProtocolAgentLoop({ eventBus });
    const result = await loop.run({
      floorId: 'floor_1',
      callerSlot: 'narrator',
      initialMessages: [{ role: 'user', content: '混合' }],
      tools: TOOLS,
      toolContext: TOOL_CONTEXT,
      permissions: PERMISSIONS,
      toolExecutor: executor,
      generate,
      decideConfirmation: decide,
      maxSteps: 5,
    });

    expect(result.stopReason).toBe('awaiting_confirmation');
    // 只有第一个 auto 工具被执行；confirm 后的 auto 工具被中止
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith('graph_query', { q: 'a' }, { ...TOOL_CONTEXT, generationStepNo: 1 }, PERMISSIONS);
    expect(result.pendingConfirmation?.toolName).toBe('graph_create');
    // 已执行的 auto 结果作为用户消息回填
    const lastMessage = result.conversationMessages.at(-1);
    expect(lastMessage?.role).toBe('user');
    expect(lastMessage?.content).toContain('graph_query');
  });

  it('达到 maxSteps 时按步数上限收尾', async () => {
    const eventBus = createEventBus();
    const { executor, execute } = makeExecutor();
    const { generate } = scriptedGenerate([
      { rawText: toolCallBlock('c1', 'graph_query', { q: 'a' }) },
      { rawText: toolCallBlock('c2', 'graph_query', { q: 'b' }) },
      { rawText: toolCallBlock('c3', 'graph_query', { q: 'c' }) },
    ]);

    const loop = new TextProtocolAgentLoop({ eventBus });
    const result = await loop.run({
      floorId: 'floor_1',
      callerSlot: 'narrator',
      initialMessages: [{ role: 'user', content: '反复查询' }],
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
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('批准后续跑：先执行已批准工具再续跑多轮直到自然停止', async () => {
    const eventBus= createEventBus();
    const { executor, execute } = makeExecutor({ data: { created: true } });
    // 续跑首步模型不再请求工具，直接自然停止。
    const { generate, calls } = scriptedGenerate([
      { visibleText: '已创建，继续。', rawText: '已创建，继续。' },
    ]);

    const loop = new TextProtocolAgentLoop({ eventBus });
    const result =await loop.run({
      floorId: 'floor_1',
      callerSlot: 'narrator',
      // 续跑上下文：暂停时的完整消息（此处简化为初始 user + 暂停 assistant）
      initialMessages: [
        { role: 'user', content: '建节点' },
        { role: 'assistant', content: '准备创建。' },
      ],
    tools: TOOLS,
      toolContext: TOOL_CONTEXT,
      permissions: PERMISSIONS,
      toolExecutor: executor,
      generate,
      decideConfirmation: ALWAYS_AUTO,
      resumeApprovedCall: { callId: 'c1', toolName: 'graph_create', args:{node: 'n' } },
      maxSteps: 5,
    });

    expect(result.stopReason).toBe('natural_stop');
    expect(result.steps).toBe(1);
    // 已批准工具在进入生成循环前先执行一次。
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith('graph_create', { node: 'n' }, TOOL_CONTEXT, PERMISSIONS);
    expect(result.toolResultWritebackText).toBeDefined();
    // 首步生成的上下文已包含：初始两条 + 已批准工具结果用户消息
    expect(calls[0]?.messageCount).toBe(3);
    expect(result.pendingConfirmation).toBeUndefined();
  });

  it('批准后续跑：执行已批准工具后再次遇 confirm 工具会再暂停', async () => {
    const eventBus = createEventBus();
    const { executor, execute } = makeExecutor();
    const { generate } = scriptedGenerate([
      { visibleText: '继续创建。', rawText: `继续创建。\n${toolCallBlock('c2', 'graph_create', { node: 'm' })}` },
    ]);
    const decide: GraphToolConfirmationDecider = ({ toolName }) =>
      toolName === 'graph_create' ? 'confirm' : 'auto';

    const loop = new TextProtocolAgentLoop({ eventBus });
    const result = await loop.run({
      floorId: 'floor_1',
      callerSlot: 'narrator',
      initialMessages: [{ role: 'user', content: '建多个节点' }],
      tools: TOOLS,
      toolContext: TOOL_CONTEXT,
      permissions: PERMISSIONS,
      toolExecutor: executor,
      generate,
      decideConfirmation: decide,
  resumeApprovedCall: { callId: 'c1', toolName: 'graph_create', args: { node: 'n' } },
      maxSteps: 5,
    });

    expect(result.stopReason).toBe('awaiting_confirmation');
    // 已批准工具执行一次；续跑步里的新 confirm 工具不执行。
   expect(execute).toHaveBeenCalledTimes(1);
    expect(result.pendingConfirmation).toMatchObject({ callId: 'c2', toolName: 'graph_create', args: { node: 'm' } });
  });

  it('totalUsage 跨步累计', async () => {
    const eventBus = createEventBus();
    const { executor } = makeExecutor();
    const { generate } = scriptedGenerate([
      { rawText: toolCallBlock('c1', 'graph_query', { q: 'a' }) },
      { rawText: '完成。' },
    ]);

    const loop = new TextProtocolAgentLoop({ eventBus });
    const result = await loop.run({
      floorId: 'floor_1',
      callerSlot: 'narrator',
      initialMessages: [{ role: 'user', content: 'q' }],
      tools: TOOLS,
      toolContext: TOOL_CONTEXT,
      permissions: PERMISSIONS,
      toolExecutor: executor,
      generate,
      decideConfirmation: ALWAYS_AUTO,
      maxSteps: 5,
    });

      expect(result.totalUsage).toEqual({ promptTokens: 2, completionTokens: 2, totalTokens: 4 });
  });

  it('执行前对带引号的布尔 / 数组串参数做类型容错', async () => {
    const eventBus = createEventBus();
    const { executor, execute } = makeExecutor();
    const coercibleTool: ToolDefinition = {
      name: 'graph_query',
      description: 'graph_query description',
      parameters: {
        type: 'object',
        properties: {
          recursive: { type: 'boolean' },
          tags: { type: 'array', items: { type: 'string' } },
        },
      },
      sideEffectLevel: 'none',
      allowedSlots: [],
      source: 'builtin',
    };
    const { generate } = scriptedGenerate([
      {
        rawText: toolCallBlock('c1', 'graph_query', {
          recursive: 'true',
          tags: '["a", "b"]',
        }),
      },
      { rawText: '完成。' },
    ]);

    const loop = new TextProtocolAgentLoop({ eventBus });
    const result = await loop.run({
   floorId: 'floor_1',
      callerSlot: 'narrator',
   initialMessages: [{ role: 'user', content: '查' }],
      tools: [coercibleTool],
      toolContext: TOOL_CONTEXT,
      permissions: PERMISSIONS,
      toolExecutor: executor,
      generate,
      decideConfirmation: ALWAYS_AUTO,
      maxSteps: 5,
    });

    expect(result.stopReason).toBe('natural_stop');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(
      'graph_query',
      { recursive: true, tags: ['a', 'b'] },
      { ...TOOL_CONTEXT, generationStepNo: 1 },
      PERMISSIONS,
    );
  });

  it('格式错误不再误判 natural_stop，而是回填反馈并续跑', async () => {
    const eventBus = createEventBus();
    const { executor, execute } = makeExecutor();
    const { generate, calls } = scriptedGenerate([
      //第一步：body 不是合法 JSON，解析产生诊断但无有效调用。
      { rawText: '<tool_call id="c1" name="graph_query">oops</tool_call>' },
      // 第二步：模型按反馈纠正，输出合法调用。
      { rawText: toolCallBlock('c2', 'graph_query', { q: 'a' })},
      { rawText: '完成。' },
    ]);

    const loop = new TextProtocolAgentLoop({ eventBus });
    const result = await loop.run({
      floorId: 'floor_1',
      callerSlot: 'narrator',
      initialMessages: [{ role: 'user', content: '建节点' }],
      tools: TOOLS,
      toolContext: TOOL_CONTEXT,
      permissions: PERMISSIONS,
      toolExecutor: executor,
      generate,
      decideConfirmation: ALWAYS_AUTO,
      maxSteps: 5,
    });

    expect(result.stopReason).toBe('natural_stop');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith('graph_query', { q: 'a' }, { ...TOOL_CONTEXT, generationStepNo: 2 }, PERMISSIONS);
    // 第二步生成时上下文：初始 user+ 第一步 assistant 原始输出 + 反馈 user = 3
    expect(calls[1]?.messageCount).toBe(3);
    const feedback = result.conversationMessages.find(
      (message) => message.role === 'user' && message.content.includes('could not be parsed'),
    );
    expect(feedback).toBeDefined();
  });

  it('连续无效步达上限后以 invalid_format_stop 收敛停止', async () => {
    const eventBus = createEventBus();
    const { executor, execute } = makeExecutor();
    const { generate } = scriptedGenerate([
      { rawText: '<tool_call id="c1" name="graph_query">oops</tool_call>' },
      { rawText: '<tool_call id="c2" name="graph_query">still bad</tool_call>' },
      { rawText: '<tool_call id="c3" name="graph_query">again</tool_call>' },
    ]);

 const loop = new TextProtocolAgentLoop({ eventBus });
    const result = await loop.run({
      floorId: 'floor_1',
      callerSlot: 'narrator',
      initialMessages: [{ role: 'user', content: '建节点' }],
      tools: TOOLS,
      toolContext: TOOL_CONTEXT,
      permissions: PERMISSIONS,
      toolExecutor: executor,
      generate,
      decideConfirmation: ALWAYS_AUTO,
    maxSteps: 5,
    });

    expect(result.stopReason).toBe('invalid_format_stop');
    expect(result.steps).toBe(2);
    expect(execute).not.toHaveBeenCalled();
  });
});
