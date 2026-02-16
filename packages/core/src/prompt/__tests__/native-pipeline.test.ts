import { describe, expect, it } from 'vitest';
import { SimpleTokenCounter } from '../token-budget.js';
import {
  assembleNativePrompt,
  TemplateNode,
  WorldbookResolveNode,
  MemoryInjectNode,
  TokenBudgetNode,
  PackMessagesNode,
  NativePipelineError,
  type NativePipelineNode,
} from '../native-pipeline.js';

describe('assembleNativePrompt', () => {
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
    expect(chatSection?.messages.map((message) => message.content)).toEqual([
      'Hello Luna',
      'Hi Ari',
    ]);
    expect(chatSection?.messages.every((message) => message.prunable === true)).toBe(true);
    expect(ir.metadata.maxTokens).toBe(2048);
    expect(ir.metadata.reservedForReply).toBe(256);
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
    expect(afterSection?.messages[0]?.content).toBe('After lore: Excalibur');
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
      'memorySummary',
      'worldbookBefore',
      'chatHistory',
    ]);

    const memorySection = ir.sections.find((section) => section.name === 'memorySummary');
    expect(memorySection?.messages[0]?.role).toBe('system');
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
