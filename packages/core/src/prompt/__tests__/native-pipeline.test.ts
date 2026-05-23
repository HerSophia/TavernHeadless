import { describe, expect, it } from 'vitest';
import { SimpleTokenCounter } from '../token-budget.js';
import {
  assembleNativePrompt,
  runNativePipeline,
  TemplateNode,
  ConditionNode,
  WorldbookResolveNode,
  TransformNode,
  MemoryInjectNode,
  TokenBudgetNode,
  PackMessagesNode,
  NativePipelineError,
  type NativePipelineNodeOutput,
  type NativePipelineNode,
} from '../native-pipeline.js';

function expectNodeOutput(
  output: NativePipelineNodeOutput | undefined,
  expected: Partial<NativePipelineNodeOutput>,
): void {
  expect(output).toBeDefined();
  expect(output).toMatchObject(expected);
}

describe('assembleNativePrompt', () => {
  it('records phase-aware node trace and outputs for the default pipeline run', () => {
    const state = runNativePipeline({
      systemPrompt: 'You are {{char}} helping {{user}}.',
      chatHistory: [{ role: 'user', content: 'Hello {{char}}' }],
      variables: { char: 'Luna', user: 'Ari' },
      memorySummary: '- Remembers the northern pass.',
      maxTokens: 2048,
      reservedForReply: 256,
      tokenCounter: new SimpleTokenCounter(),
    });

    expect(state.trace.map((entry) => `${entry.phase}:${entry.nodeName}`)).toEqual([
      'assemble:template',
      'assemble:worldbook_resolve',
      'pre_response:memory_inject',
      'materialize:token_budget',
      'materialize:pack_messages',
    ]);
    expectNodeOutput(state.outputs.template, { phase: 'assemble', producedSectionNames: ['nativeSystem', 'chatHistory'] });
    expectNodeOutput(state.outputs.memory_inject, { phase: 'pre_response', producedSectionNames: ['memory'] });
    expectNodeOutput(state.outputs.pack_messages, { phase: 'materialize', outputReady: true });
    expect(state.output?.sections.map((section) => section.name)).toEqual(['nativeSystem', 'memory', 'chatHistory']);
  });

  it('renders templates and keeps chat history as prunable messages', () => {
    const ir = assembleNativePrompt({
      systemPrompt: 'You are {{char}} helping {{user}}.',
      chatHistory: [
        { role: 'user', content: 'Hello {{char}}' },
        { role: 'assistant', content: 'Hi {{user}}' },
      ],
      variables: { char: 'Luna', user: 'Ari' },
      maxTokens: 2048,
      reservedForReply: 256,
      tokenCounter: new SimpleTokenCounter(),
    });

    const systemSection = ir.sections.find((section) => section.name === 'nativeSystem');
    const chatSection = ir.sections.find((section) => section.name === 'chatHistory');

    expect(systemSection?.messages[0]?.content).toBe('You are Luna helping Ari.');
    expect(systemSection?.pinned).toBe(true);
    expect(systemSection?.budgetGroup).toBe('section:nativeSystem');
    expect(systemSection?.messages[0]?.prunable).toBe(false);
    expect(chatSection?.messages.map((message) => message.content)).toEqual([
      'Hello Luna',
      'Hi Ari',
    ]);
    expect(chatSection?.messages.every((message) => message.prunable === true)).toBe(true);
    expect(ir.metadata.maxTokens).toBe(2048);
    expect(ir.metadata.reservedForReply).toBe(256);
  });

  it('renders non-string variable values through the template engine', () => {
    const ir = assembleNativePrompt({
      systemPrompt: 'State {{state}} / Alive {{alive}} / Turn {{turn}}',
      chatHistory: [
        { role: 'user', content: 'Inventory {{inventory}}' },
      ],
      variables: {
        state: { hp: 100, mp: 20 },
        alive: true,
        turn: 3,
        inventory: ['rope', 'torch'],
      },
      maxTokens: 2048,
      reservedForReply: 256,
    });

    const systemSection = ir.sections.find((section) => section.name === 'nativeSystem');
    const chatSection = ir.sections.find((section) => section.name === 'chatHistory');

    expect(systemSection?.messages[0]?.content).toBe(
      'State {"hp":100,"mp":20} / Alive true / Turn 3'
    );
    expect(chatSection?.messages[0]?.content).toBe(
      'Inventory ["rope","torch"]'
    );
  });

  it('places worldbook entries before and after chat history', () => {
    const ir = assembleNativePrompt({
      systemPrompt: 'System prompt',
      chatHistory: [{ role: 'user', content: 'The sword is here.' }],
      worldbookEntries: [
        { id: 'wb-1', content: 'Before lore: {{item}}', position: 'before' },
        { id: 'wb-2', content: 'After lore: {{item}}', position: 'after' },
      ],
      variables: { item: 'Excalibur' },
      maxTokens: 2048,
      reservedForReply: 256,
    });

    const orderedSections = [...ir.sections].sort((a, b) => a.order - b.order);
    expect(orderedSections.map((section) => section.name)).toEqual([
      'nativeSystem',
      'worldbookBefore',
      'chatHistory',
      'worldbookAfter',
    ]);

    const beforeSection = ir.sections.find((section) => section.name === 'worldbookBefore');
    const afterSection = ir.sections.find((section) => section.name === 'worldbookAfter');

    expect(beforeSection?.messages[0]?.content).toBe('Before lore: Excalibur');
    expect(beforeSection?.budgetGroup).toBe('worldbook');
    expect(ir.sections.find((section) => section.name === 'chatHistory')?.budgetGroup).toBe('history');
    expect(afterSection?.budgetGroup).toBe('worldbook');
    expect(afterSection?.messages[0]?.content).toBe('After lore: Excalibur');
  });

  it('keeps depth worldbook entries as dedicated sections', () => {
    const ir = assembleNativePrompt({
      systemPrompt: 'System prompt',
      chatHistory: [{ role: 'user', content: 'The sword is here.' }],
      worldbookEntries: [
        { id: 'wb-depth', content: 'Depth lore: {{item}}', position: 'depth', depth: 2, role: 'user' },
      ],
      variables: { item: 'Excalibur' },
      maxTokens: 2048,
      reservedForReply: 256,
    });

    const orderedSections = [...ir.sections].sort((a, b) => a.order - b.order);
    expect(orderedSections.map((section) => section.name)).toEqual([
      'nativeSystem',
      'chatHistory',
      'worldbookDepth:2',
    ]);

    const depthSection = ir.sections.find((section) => section.name === 'worldbookDepth:2');
    expect(depthSection?.messages[0]?.role).toBe('user');
    expect(depthSection?.budgetGroup).toBe('worldbook');
    expect(depthSection?.messages[0]?.content).toBe('Depth lore: Excalibur');
  });

  it('injects memory summary after system section in native pipeline', () => {
    const ir = assembleNativePrompt({
      systemPrompt: 'You are {{char}}.',
      chatHistory: [{ role: 'user', content: 'Hello' }],
      worldbookEntries: [{ id: 'wb-1', content: 'Lore block', position: 'before' }],
      variables: { char: 'Luna' },
      memorySummary: '- Luna remembers the ritual.',
      maxTokens: 2048,
      reservedForReply: 256,
    });

    const orderedSections = [...ir.sections].sort((a, b) => a.order - b.order);
    expect(orderedSections.map((section) => section.name)).toEqual([
      'nativeSystem',
      'memory',
      'worldbookBefore',
      'chatHistory',
    ]);

    const memorySection = ir.sections.find((section) => section.name === 'memory');
    expect(memorySection?.messages[0]?.role).toBe('system');
    expect(memorySection?.budgetGroup).toBe('memory');
    expect(memorySection?.pinned).toBe(false);
    expect(memorySection?.messages[0]?.prunable).toBe(false);
    expect(memorySection?.messages[0]?.source).toBe('memory');
    expect(memorySection?.messages[0]?.content).toContain('[Memory Summary]');
    expect(memorySection?.messages[0]?.content).toContain('Luna remembers the ritual.');
  });

  it('packs sections by order and removes empty messages', () => {
    const ir = assembleNativePrompt(
      {
        systemPrompt: 'Hello',
        chatHistory: [{ role: 'user', content: '  ' }],
        worldbookEntries: [
          { id: 'wb-empty', content: '   ', position: 'before' },
          { id: 'wb-2', content: 'Lore', position: 'after' },
        ],
        memorySummary: '   ',
        maxTokens: 100,
        reservedForReply: 10,
        tokenCounter: new SimpleTokenCounter(),
      },
      [
        new TemplateNode(),
        new WorldbookResolveNode(),
        new MemoryInjectNode(),
        new TokenBudgetNode(),
        new PackMessagesNode(),
      ]
    );

    expect(ir.sections.map((section) => section.name)).toEqual(['nativeSystem', 'worldbookAfter']);
    expect(ir.sections[0]?.order).toBeLessThan(ir.sections[1]?.order ?? 0);
    expect(ir.sections[0]?.messages[0]?.tokenCount).toBeDefined();
    expect(ir.sections[1]?.messages[0]?.tokenCount).toBeDefined();
    expect(ir.metadata.tokenizer).toBe('simple');
  });

  it('keeps downstream nodes aware of phase trace and outputs', () => {
    const inspectNode: NativePipelineNode = {
      name: 'inspect_artifacts',
      phase: 'materialize',
      run(state) {
        expect(state.trace.map((entry) => entry.nodeName)).toEqual(['template']);
        expectNodeOutput(state.outputs.template, {
          nodeName: 'template',
          phase: 'assemble',
          producedSectionNames: ['nativeSystem', 'chatHistory'],
        });
        return state;
      },
    };

    const state = runNativePipeline(
      {
        systemPrompt: 'Hello',
        chatHistory: [{ role: 'user', content: 'Hi' }],
        maxTokens: 100,
        reservedForReply: 10,
      },
      [new TemplateNode(), inspectNode, new PackMessagesNode()]
    );

    expect(state.output?.sections.map((section) => section.name)).toEqual(['nativeSystem', 'chatHistory']);
    expect(state.trace.at(-1)?.nodeName).toBe('pack_messages');
  });

  it('lets condition node publish its own phase while preserving nested branch outputs', () => {
    const branchA: NativePipelineNode = {
      name: 'branch_a',
      phase: 'pre_response',
      run(state) {
        return {
          ...state,
          sections: [...state.sections, { name: 'branchA', order: 1.5, pinned: true, budgetGroup: 'section:branchA', messages: [{ role: 'system', content: 'A', prunable: false }] }],
        };
      },
    };

    const state = runNativePipeline({ systemPrompt: 'Hello', chatHistory: [], variables: { mode: 'a' }, maxTokens: 100, reservedForReply: 10 }, [new TemplateNode(), new ConditionNode({ phase: 'pre_response', when: (input) => input.input.variables?.mode === 'a', thenNodes: [branchA] }), new PackMessagesNode()]);

    expectNodeOutput(state.outputs.branch_a, { phase: 'pre_response', producedSectionNames: ['branchA'] });
    expectNodeOutput(state.outputs.condition, { phase: 'pre_response', producedSectionNames: ['branchA'] });
    expect(state.trace.find((entry) => entry.nodeName === 'condition')?.phase).toBe('pre_response');
  });

  it('tracks executed nodes and exposes them to downstream nodes', () => {
    const inspectNode: NativePipelineNode = {
      name: 'inspect_artifacts',
      run(state) {
        expect(state.artifacts?.executedNodes).toEqual(['template']);
        return state;
      },
    };

    const ir = assembleNativePrompt(
      {
        systemPrompt: 'Hello',
        chatHistory: [{ role: 'user', content: 'Hi' }],
        maxTokens: 100,
        reservedForReply: 10,
      },
      [new TemplateNode(), inspectNode, new PackMessagesNode()]
    );

    expect(ir.sections.map((section) => section.name)).toEqual(['nativeSystem', 'chatHistory']);
  });

  it('supports condition branching (runs nested nodes and records executedNodes)', () => {
    const branchA: NativePipelineNode = {
      name: 'branch_a',
      phase: 'pre_response',
      run(state) {
        return {
          ...state,
          sections: [
            ...state.sections,
            {
              name: 'branchA',
              order: 1.5,
              pinned: true,
              messages: [
                {
                  role: 'system',
                  content: 'A',
                  prunable: false,
                },
              ],
            },
          ],
        };
      },
    };

    const branchB: NativePipelineNode = {
      name: 'branch_b',
      phase: 'pre_response',
      run(state) {
        return {
          ...state,
          sections: [
            ...state.sections,
            {
              name: 'branchB',
              order: 1.5,
              pinned: true,
              messages: [
                {
                  role: 'system',
                  content: 'B',
                  prunable: false,
                },
              ],
            },
          ],
        };
      },
    };

    const inspect: NativePipelineNode = {
      name: 'inspect',
      phase: 'materialize',
      run(state) {
        expect(state.artifacts?.executedNodes).toEqual(['template', 'branch_a', 'condition']);
        return state;
      },
    };

    const ir = assembleNativePrompt(
      {
        systemPrompt: 'Hello',
        chatHistory: [],
        variables: { mode: 'a' },
        maxTokens: 100,
        reservedForReply: 10,
      },
      [
        new TemplateNode(),
        new ConditionNode({
          when: (state) => state.input.variables?.mode === 'a',
          thenNodes: [branchA],
          elseNodes: [branchB],
        }),
        inspect,
        new PackMessagesNode(),
      ]
    );

    expect(ir.sections.map((section) => section.name)).toEqual(['nativeSystem', 'branchA']);
  });

  it('supports transform node regex replacements with role filtering', () => {
    const ir = assembleNativePrompt(
      {
        systemPrompt: 'System',
        chatHistory: [
          { role: 'user', content: 'foo' },
          { role: 'assistant', content: 'foo' },
        ],
        maxTokens: 100,
        reservedForReply: 10,
      },
      [
        new TemplateNode(),
        new TransformNode({
          rules: [
            {
              pattern: 'foo',
              replace: 'bar',
              roles: ['assistant'],
            },
          ],
        }),
        new PackMessagesNode(),
      ]
    );

    const chatSection = ir.sections.find((section) => section.name === 'chatHistory');
    expect(chatSection?.messages.map((message) => message.content)).toEqual(['foo', 'bar']);
  });

  it('wraps node errors as NativePipelineError with node and state summary', () => {
    const failingNode: NativePipelineNode = {
      name: 'explode',
      run() {
        throw new Error('boom');
      },
    };

    try {
      assembleNativePrompt(
        {
          systemPrompt: 'You are {{char}}.',
          chatHistory: [{ role: 'user', content: 'Hello' }],
          variables: { char: 'Luna' },
          maxTokens: 512,
          reservedForReply: 64,
        },
        [new TemplateNode(), failingNode]
      );
      expect.unreachable('should throw NativePipelineError');
    } catch (error) {
      expect(error).toBeInstanceOf(NativePipelineError);
      const pipelineError = error as NativePipelineError;
      expect(pipelineError.nodeName).toBe('explode');
      expect(pipelineError.message).toContain("node 'explode' failed");
      expect(pipelineError.inputSummary.chatHistoryCount).toBe(1);
      expect(pipelineError.inputSummary.maxTokens).toBe(512);
      expect(pipelineError.stateSummary.executedNodes).toEqual(['template']);
      expect(pipelineError.stateSummary.sectionNames).toEqual(['nativeSystem', 'chatHistory']);
    }
  });

  it('throws NativePipelineError when a node returns invalid state', () => {
    const invalidNode: NativePipelineNode = {
      name: 'invalid_state',
      run() {
        return null as unknown as never;
      },
    };

    expect(() => {
      assembleNativePrompt(
        {
          systemPrompt: 'Hello',
          chatHistory: [],
          maxTokens: 128,
          reservedForReply: 16,
        },
        [invalidNode]
      );
    }).toThrow(NativePipelineError);
  });
});
