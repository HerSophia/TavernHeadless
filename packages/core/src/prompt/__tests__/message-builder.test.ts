import { describe, it, expect } from 'vitest';
import type { PromptIR, IRSection, TokenCounter } from '../types.js';
import { MessageBuilder } from '../message-builder.js';

// ─── Helpers ──────────────────────────────────────────

class CharTokenCounter implements TokenCounter {
  readonly name = 'char';
  count(text: string): number {
    return text.length;
  }
}

function makeIR(
  sections: IRSection[],
  maxTokens = 1000,
  reservedForReply = 200
): PromptIR {
  return {
    sections,
    metadata: { maxTokens, reservedForReply },
  };
}

function section(
  name: string,
  messages: { role: 'system' | 'user' | 'assistant'; content: string; prunable?: boolean; priority?: number }[],
  opts?: { pinned?: boolean; order?: number; budgetGroup?: string }
): IRSection {
  return {
    name,
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
      prunable: m.prunable,
      priority: m.priority,
    })),
    pinned: opts?.pinned,
    budgetGroup: opts?.budgetGroup,
    order: opts?.order ?? 0,
  };
}

// ─── Tests ────────────────────────────────────────────

describe('MessageBuilder', () => {
  describe('assemble', () => {
    it('assembles single section into messages', () => {
      const builder = new MessageBuilder(new CharTokenCounter());
      const ir = makeIR([
        section('chat', [
          { role: 'user', content: 'hello' },
          { role: 'assistant', content: 'hi' },
        ], { order: 0 }),
      ]);

      const result = builder.assemble(ir);

      expect(result.messages).toEqual([
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
      ]);
      expect(result.prunedCount).toBe(0);
    });

    it('sorts sections by order', () => {
      const builder = new MessageBuilder(new CharTokenCounter());
      const ir = makeIR([
        section('chat', [
          { role: 'user', content: 'user msg' },
        ], { order: 2 }),
        section('sys', [
          { role: 'system', content: 'system prompt' },
        ], { order: 0 }),
        section('jail', [
          { role: 'system', content: 'jailbreak' },
        ], { order: 1 }),
      ]);

      const result = builder.assemble(ir);

      expect(result.messages[0]!.content).toBe('system prompt');
      expect(result.messages[1]!.content).toBe('jailbreak');
      expect(result.messages[2]!.content).toBe('user msg');
    });

    it('skips empty sections', () => {
      const builder = new MessageBuilder(new CharTokenCounter());
      const ir = makeIR([
        section('empty', [], { order: 0 }),
        section('chat', [
          { role: 'user', content: 'hello' },
        ], { order: 1 }),
      ]);

      const result = builder.assemble(ir);

      expect(result.messages).toHaveLength(1);
      // Empty section should not appear in bySection
      expect(result.tokenUsage.bySection['empty']).toBeUndefined();
    });

    it('calculates token usage per section', () => {
      const builder = new MessageBuilder(new CharTokenCounter());
      const ir = makeIR([
        section('sys', [
          { role: 'system', content: 'hello' }, // 5
        ], { order: 0 }),
        section('chat', [
          { role: 'user', content: 'hi' },       // 2
          { role: 'assistant', content: 'hey' },  // 3
        ], { order: 1 }),
      ], 1000, 200);

      const result = builder.assemble(ir);

      expect(result.tokenUsage.total).toBe(10);
      expect(result.tokenUsage.bySection['sys']).toBe(5);
      expect(result.tokenUsage.bySection['chat']).toBe(5);
      expect(result.tokenUsage.availableForReply).toBe(990);
    });

    it('calculates token usage per budget group and falls back for untagged sections', () => {
      const builder = new MessageBuilder(new CharTokenCounter());
      const ir = makeIR([
        section('sys', [
          { role: 'system', content: 'hello' },
        ], { order: 0 }),
        section('worldbookBefore', [
          { role: 'system', content: 'lore' },
        ], { order: 1, budgetGroup: 'worldbook' }),
        section('chatHistory', [
          { role: 'user', content: 'hey' },
        ], { order: 2, budgetGroup: 'history' }),
      ]);

      const result = builder.assemble(ir);

      expect(result.tokenUsage.byGroup).toEqual({ 'section:sys': 5, worldbook: 4, history: 3 });
      expect(result.tokenUsage.prunedByGroup).toEqual({});
    });

    it('inserts in-chat sections into chat history by depth and order', () => {
      const builder = new MessageBuilder(new CharTokenCounter());
      const ir = makeIR([
        {
          name: 'chatHistory',
          order: 0,
          pinned: false,
          semantic: 'chat_history',
          messages: [
            { role: 'system', content: '[Start]', prunable: false },
            { role: 'user', content: 'First', prunable: true, priority: 0 },
            { role: 'assistant', content: 'Second', prunable: true, priority: 1 },
          ],
        },
        {
          name: 'assistantInsert',
          order: 1,
          pinned: true,
          insertion: { kind: 'in_chat', depth: 1, order: 2 },
          messages: [{ role: 'assistant', content: 'Inserted assistant', prunable: false }],
        },
        {
          name: 'userInsert',
          order: 2,
          pinned: true,
          insertion: { kind: 'in_chat', depth: 1, order: 1 },
          messages: [{ role: 'user', content: 'Inserted user', prunable: false }],
        },
      ]);

      const result = builder.assemble(ir);

      expect(result.messages).toEqual([
        { role: 'system', content: '[Start]' },
        { role: 'user', content: 'First' },
        { role: 'user', content: 'Inserted user' },
        { role: 'assistant', content: 'Inserted assistant' },
        { role: 'assistant', content: 'Second' },
      ]);
      expect(result.tokenUsage.bySection['chatHistory']).toBe('[Start]'.length + 'First'.length + 'Second'.length);
      expect(result.tokenUsage.bySection['userInsert']).toBe('Inserted user'.length);
      expect(result.tokenUsage.bySection['assistantInsert']).toBe('Inserted assistant'.length);
    });

    it('handles empty IR', () => {
      const builder = new MessageBuilder(new CharTokenCounter());
      const ir = makeIR([], 1000, 200);

      const result = builder.assemble(ir);

      expect(result.messages).toHaveLength(0);
      expect(result.tokenUsage.total).toBe(0);
      expect(result.tokenUsage.availableForReply).toBe(1000);
    });
  });

  describe('assemble with mergeAdjacentSameRole', () => {
    it('merges adjacent same-role messages', () => {
      const builder = new MessageBuilder(new CharTokenCounter(), {
        mergeAdjacentSameRole: true,
      });
      const ir = makeIR([
        section('sys', [
          { role: 'system', content: 'line 1' },
          { role: 'system', content: 'line 2' },
        ], { order: 0 }),
        section('chat', [
          { role: 'user', content: 'hello' },
        ], { order: 1 }),
      ]);

      const result = builder.assemble(ir);

      expect(result.messages).toHaveLength(2);
      expect(result.messages[0]).toEqual({
        role: 'system',
        content: 'line 1\n\nline 2',
      });
      expect(result.messages[1]).toEqual({
        role: 'user',
        content: 'hello',
      });
    });

    it('merges across section boundaries when same role', () => {
      const builder = new MessageBuilder(new CharTokenCounter(), {
        mergeAdjacentSameRole: true,
      });
      const ir = makeIR([
        section('sys', [
          { role: 'system', content: 'part A' },
        ], { order: 0 }),
        section('worldbook', [
          { role: 'system', content: 'part B' },
        ], { order: 1 }),
        section('chat', [
          { role: 'user', content: 'hello' },
        ], { order: 2 }),
      ]);

      const result = builder.assemble(ir);

      expect(result.messages).toHaveLength(2);
      expect(result.messages[0]!.content).toBe('part A\n\npart B');
    });

    it('does not merge different roles', () => {
      const builder = new MessageBuilder(new CharTokenCounter(), {
        mergeAdjacentSameRole: true,
      });
      const ir = makeIR([
        section('chat', [
          { role: 'user', content: 'q' },
          { role: 'assistant', content: 'a' },
          { role: 'user', content: 'q2' },
        ], { order: 0 }),
      ]);

      const result = builder.assemble(ir);
      expect(result.messages).toHaveLength(3);
    });
  });

  describe('build (full pipeline)', () => {
    it('estimates, prunes, and assembles', () => {
      const builder = new MessageBuilder(new CharTokenCounter());

      // Budget: 20 - 5 = 15 available
      // Pinned sys: 6 tokens (fixed)
      // Available for prunable: 15 - 6 = 9
      // Chat messages: 5 + 5 = 10 → need to prune 1
      const ir = makeIR(
        [
          section('sys', [
            { role: 'system', content: 'system' }, // 6
          ], { pinned: true, order: 0 }),
          section('chat', [
            { role: 'user', content: 'hello' },     // 5
            { role: 'assistant', content: 'world' }, // 5
          ], { order: 1 }),
        ],
        20, 5
      );

      const result = builder.build(ir);

      expect(result.prunedCount).toBe(1);
      // sys (pinned) + 1 remaining chat message
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0]!.content).toBe('system');
    });

    it('full pipeline with no pruning needed', () => {
      const builder = new MessageBuilder(new CharTokenCounter());
      const ir = makeIR(
        [
          section('sys', [
            { role: 'system', content: 'hi' },
          ], { pinned: true, order: 0 }),
          section('chat', [
            { role: 'user', content: 'hey' },
          ], { order: 1 }),
        ],
        1000, 100
      );

      const result = builder.build(ir);

      expect(result.prunedCount).toBe(0);
      expect(result.messages).toHaveLength(2);
    });

    it('builds pruned token usage by budget group', () => {
      const builder = new MessageBuilder(new CharTokenCounter());
      const ir = makeIR(
        [
          section('memory', [
            { role: 'system', content: '0123456789', prunable: false },
          ], { pinned: true, order: 0, budgetGroup: 'memory' }),
          section('chatHistory', [
            { role: 'user', content: '0123456789', priority: 10 },
            { role: 'assistant', content: '0123456789', priority: 0 },
          ], { order: 1, budgetGroup: 'history' }),
        ],
        25,
        0
      );

      const result = builder.build(ir);

      expect(result.prunedCount).toBe(1);
      expect(result.tokenUsage.byGroup).toEqual({ memory: 10, history: 10 });
      expect(result.tokenUsage.prunedByGroup).toEqual({ history: 10 });
      expect(result.messages).toHaveLength(2);
    });

    it('surfaces allocator trim reasons when build receives explicit group policies', () => {
      const builder = new MessageBuilder(new CharTokenCounter());
      const ir = makeIR(
        [
          section('examples', [
            { role: 'system', content: '12345', priority: 1 },
            { role: 'system', content: '67890', priority: 0 },
          ], { order: 0, budgetGroup: 'examples' }),
          section('chatHistory', [
            { role: 'user', content: 'abcde', priority: 1 },
            { role: 'assistant', content: 'fghij', priority: 0 },
          ], { order: 1, budgetGroup: 'history' }),
        ],
        18,
        0,
      );

      const result = builder.build(ir, {
        groupPolicies: [{ group: 'examples', maxTokens: 5 }],
      });

      expect(result.tokenUsage.byGroup).toEqual({ examples: 5, history: 10 });
      expect(result.tokenUsage.prunedByGroup).toEqual({ examples: 5 });
      expect(result.tokenUsage.allocator?.estimatedByGroup).toEqual({ examples: 10, history: 10 });
      expect(result.tokenUsage.allocator?.allocatedByGroup).toEqual({ examples: 5, history: 10 });
      expect(result.tokenUsage.allocator?.trimReasons[0]?.reason).toBe('group_limit_exceeded');
    });

    it('surfaces target-based allocator details when build receives explicit group policies', () => {
      const builder = new MessageBuilder(new CharTokenCounter());
      const ir = makeIR(
        [
          section(
            'examples',
            Array.from({ length: 6 }, (_, index) => ({
              role: 'system' as const,
              content: String.fromCharCode(97 + index),
              priority: 5 - index,
            })),
            { order: 0, budgetGroup: 'examples' },
          ),
          section(
            'sys',
            Array.from({ length: 6 }, (_, index) => ({
              role: 'system' as const,
              content: String.fromCharCode(107 + index),
              priority: 5 - index,
            })),
            { order: 1, budgetGroup: 'section:sys' },
          ),
        ],
        6,
        0,
      );

      const result = builder.build(ir, {
        groupPolicies: [
          { group: 'examples', targetTokens: 4, weight: 1, pruneOrder: 0 },
          { group: 'section:sys', targetTokens: 2, weight: 1, pruneOrder: 0 },
        ],
      });

      expect(result.tokenUsage.byGroup).toEqual({ examples: 4, 'section:sys': 2 });
      expect(result.tokenUsage.prunedByGroup).toEqual({ examples: 2, 'section:sys': 4 });
      expect(result.tokenUsage.allocator?.estimatedByGroup).toEqual({ examples: 6, 'section:sys': 6 });
      expect(result.tokenUsage.allocator?.allocatedByGroup).toEqual({ examples: 4, 'section:sys': 2 });
    });
  });
});
