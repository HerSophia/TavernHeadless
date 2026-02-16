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
  opts?: { pinned?: boolean; order?: number }
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
  });
});
