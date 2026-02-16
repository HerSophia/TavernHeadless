import { describe, it, expect, beforeEach } from 'vitest';
import type { PromptIR, IRSection, TokenCounter } from '../types.js';
import { TokenBudget, SimpleTokenCounter } from '../token-budget.js';

// ─── Helpers ──────────────────────────────────────────

function makeIR(sections: IRSection[], maxTokens = 1000, reservedForReply = 200): PromptIR {
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

/** 固定计数器：每个字符 = 1 token（方便测试） */
class CharTokenCounter implements TokenCounter {
  readonly name = 'char';
  count(text: string): number {
    return text.length;
  }
}

// ─── Tests ────────────────────────────────────────────

describe('SimpleTokenCounter', () => {
  const counter = new SimpleTokenCounter();

  it('estimates tokens as ceil(chars / 4)', () => {
    expect(counter.count('')).toBe(0);
    expect(counter.count('a')).toBe(1);
    expect(counter.count('abcd')).toBe(1);
    expect(counter.count('abcde')).toBe(2);
    expect(counter.count('12345678')).toBe(2);
  });

  it('has name "simple"', () => {
    expect(counter.name).toBe('simple');
  });
});

describe('TokenBudget', () => {
  let budget: TokenBudget;

  // 使用 CharTokenCounter 方便精确控制
  beforeEach(() => {
    budget = new TokenBudget(new CharTokenCounter());
  });

  describe('estimate', () => {
    it('fills tokenCount for all messages', () => {
      const ir = makeIR([
        section('sys', [
          { role: 'system', content: 'hello' },       // 5 chars = 5 tokens
          { role: 'user', content: 'hi' },             // 2 chars = 2 tokens
        ]),
      ]);

      const estimated = budget.estimate(ir);

      expect(estimated.sections[0]!.messages[0]!.tokenCount).toBe(5);
      expect(estimated.sections[0]!.messages[1]!.tokenCount).toBe(2);
    });

    it('does not overwrite existing tokenCount', () => {
      const ir = makeIR([
        section('sys', [{ role: 'system', content: 'hello' }]),
      ]);
      ir.sections[0]!.messages[0]!.tokenCount = 99;

      const estimated = budget.estimate(ir);
      expect(estimated.sections[0]!.messages[0]!.tokenCount).toBe(99);
    });

    it('does not mutate original IR', () => {
      const ir = makeIR([
        section('sys', [{ role: 'system', content: 'test' }]),
      ]);

      budget.estimate(ir);
      expect(ir.sections[0]!.messages[0]!.tokenCount).toBeUndefined();
    });
  });

  describe('prune', () => {
    it('does not prune when within budget', () => {
      // Budget: 100 - 20 = 80 available
      // Messages: 5 + 3 = 8 tokens (well within budget)
      const ir = makeIR(
        [section('chat', [
          { role: 'user', content: 'hello' },   // 5
          { role: 'assistant', content: 'hey' }, // 3
        ])],
        100, 20
      );

      const result = budget.prune(ir);
      expect(result.prunedCount).toBe(0);
      expect(result.ir.sections[0]!.messages).toHaveLength(2);
    });

    it('prunes messages when exceeding budget', () => {
      // Budget: 20 - 5 = 15 available
      // Messages: 10 + 10 = 20 tokens → need to prune
      const ir = makeIR(
        [section('chat', [
          { role: 'user', content: '0123456789' },      // 10 tokens
          { role: 'assistant', content: 'abcdefghij' },  // 10 tokens
        ])],
        20, 5
      );

      const result = budget.prune(ir);
      expect(result.prunedCount).toBe(1);
      expect(result.ir.sections[0]!.messages).toHaveLength(1);
    });

    it('does not prune pinned sections', () => {
      // Budget: 10 - 0 = 10 available
      // Pinned section: 20 tokens (exceeds budget, but pinned)
      const ir = makeIR(
        [section('sys', [
          { role: 'system', content: '01234567890123456789' }, // 20 tokens
        ], { pinned: true })],
        10, 0
      );

      const result = budget.prune(ir);
      expect(result.prunedCount).toBe(0);
      expect(result.ir.sections[0]!.messages).toHaveLength(1);
    });

    it('does not prune messages with prunable=false', () => {
      // Budget: 15 - 0 = 15
      // Non-prunable: 10, Prunable: 10 → need to prune the prunable
      const ir = makeIR(
        [section('chat', [
          { role: 'system', content: '0123456789', prunable: false }, // 10 (fixed)
          { role: 'user', content: '0123456789' },                    // 10 (prunable)
        ])],
        15, 0
      );

      const result = budget.prune(ir);
      expect(result.prunedCount).toBe(1);
      // Only the non-prunable system message remains
      expect(result.ir.sections[0]!.messages).toHaveLength(1);
      expect(result.ir.sections[0]!.messages[0]!.role).toBe('system');
    });

    it('prunes higher priority number first', () => {
      // Budget: 15 - 0 = 15
      // Two prunable messages: priority 0 (keep) and priority 10 (prune first)
      const ir = makeIR(
        [section('chat', [
          { role: 'user', content: '0123456789', priority: 10 },     // 10, prune first
          { role: 'assistant', content: '0123456789', priority: 0 }, // 10, keep
        ])],
        15, 0
      );

      const result = budget.prune(ir);
      expect(result.prunedCount).toBe(1);
      expect(result.ir.sections[0]!.messages).toHaveLength(1);
      // The low priority (0) message is kept
      expect(result.ir.sections[0]!.messages[0]!.role).toBe('assistant');
    });

    it('prunes older messages first at same priority', () => {
      // Budget: 15 - 0 = 15
      // Three messages with same priority, older (earlier) ones pruned first
      const ir = makeIR(
        [section('chat', [
          { role: 'user', content: '0123456789' },      // 10, oldest → prune first
          { role: 'assistant', content: '01234' },       // 5, middle
          { role: 'user', content: '01234' },            // 5, newest → keep
        ])],
        15, 0
      );

      const result = budget.prune(ir);
      expect(result.prunedCount).toBe(1);
      expect(result.ir.sections[0]!.messages).toHaveLength(2);
      // The oldest (first) message was pruned
      expect(result.ir.sections[0]!.messages[0]!.content).toBe('01234');
    });

    it('handles zero available budget (prunes all prunable)', () => {
      const ir = makeIR(
        [
          section('sys', [
            { role: 'system', content: 'hello', prunable: false },
          ]),
          section('chat', [
            { role: 'user', content: 'msg1' },
            { role: 'assistant', content: 'msg2' },
          ]),
        ],
        5, 0  // budget = 5, fixed = 5 → 0 for prunable
      );

      const result = budget.prune(ir);
      expect(result.prunedCount).toBe(2);
      expect(result.ir.sections[1]!.messages).toHaveLength(0);
    });

    it('handles multiple sections mixed pinned/unpinned', () => {
      // Budget: 30 - 10 = 20
      // Pinned: 8 tokens (fixed)
      // Non-prunable: 0
      // Available for prunable: 20 - 8 = 12
      // Prunable messages: 5 + 5 + 5 = 15 → need to prune 1
      const ir = makeIR(
        [
          section('sys', [
            { role: 'system', content: '01234567' }, // 8
          ], { pinned: true, order: 0 }),
          section('chat', [
            { role: 'user', content: '01234' },      // 5
            { role: 'assistant', content: '01234' },  // 5
            { role: 'user', content: '01234' },       // 5
          ], { order: 1 }),
        ],
        30, 10
      );

      const result = budget.prune(ir);
      expect(result.prunedCount).toBe(1);
      // Pinned section untouched
      expect(result.ir.sections[0]!.messages).toHaveLength(1);
      // Chat section: 1 message pruned
      expect(result.ir.sections[1]!.messages).toHaveLength(2);
    });
  });
});
