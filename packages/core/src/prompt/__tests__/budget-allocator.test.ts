import { describe, expect, it } from 'vitest';

import { allocatePromptBudget, buildPromptBudgetTrimReasons } from '../budget-allocator.js';

describe('allocatePromptBudget', () => {
  it('prioritizes higher-prune-order groups when minTokens exceed the remaining budget', () => {
    const result = allocatePromptBudget({
      availableTokens: 6,
      estimatedByGroup: {
        history: 10,
        worldbook: 10,
      },
      groupPolicies: [
        { group: 'history', minTokens: 4 },
        { group: 'worldbook', minTokens: 4 },
      ],
    });

    expect(result.allocatedByGroup).toEqual({
      history: 4,
      worldbook: 2,
    });
  });

  it('respects targetTokens before expanding toward hard caps', () => {
    const result = allocatePromptBudget({
      availableTokens: 10,
      estimatedByGroup: {
        examples: 10,
        'section:sys': 10,
      },
      groupPolicies: [
        { group: 'examples', targetTokens: 8, weight: 1, pruneOrder: 0 },
        { group: 'section:sys', targetTokens: 2, weight: 1, pruneOrder: 0 },
      ],
    });

    expect(result.allocatedByGroup).toEqual({
      examples: 8,
      'section:sys': 2,
    });
  });

  it('uses weight to distribute remaining tokens within the same protection class', () => {
    const result = allocatePromptBudget({
      availableTokens: 6,
      estimatedByGroup: {
        examples: 10,
        history: 10,
      },
      groupPolicies: [
        { group: 'examples', weight: 1, pruneOrder: 0 },
        { group: 'history', weight: 5, pruneOrder: 0 },
      ],
    });

    expect(result.allocatedByGroup).toEqual({
      examples: 1,
      history: 5,
    });
  });

  it('uses default protection ordering to break equal-weight ties between memory and worldbook', () => {
    const result = allocatePromptBudget({
      availableTokens: 1,
      estimatedByGroup: {
        memory: 10,
        worldbook: 10,
      },
    });

    expect(result.allocatedByGroup).toEqual({
      memory: 1,
      worldbook: 0,
    });
  });

  it('prefers section fallback groups over examples when default remainders tie', () => {
    const result = allocatePromptBudget({
      availableTokens: 1,
      estimatedByGroup: {
        'section:sys': 10,
        examples: 10,
      },
    });

    expect(result.allocatedByGroup).toEqual({
      'section:sys': 1,
      examples: 0,
    });
  });
});

describe('buildPromptBudgetTrimReasons', () => {
  it('uses budget_exceeded when retention falls below estimate without a hard cap', () => {
    const allocation = allocatePromptBudget({
      availableTokens: 6,
      estimatedByGroup: {
        examples: 10,
        history: 10,
      },
      groupPolicies: [
        { group: 'examples', weight: 1, pruneOrder: 0 },
        { group: 'history', weight: 5, pruneOrder: 0 },
      ],
    });

    expect(buildPromptBudgetTrimReasons({
      availableTokens: 6,
      groupResults: allocation.groupResults,
      retainedByGroup: allocation.allocatedByGroup,
    })).toEqual([
      {
        group: 'examples',
        reason: 'budget_exceeded',
        detail: "Budget allocator retained 1 of 10 estimated tokens in group 'examples' within 6 available prunable tokens.",
        prunedTokenCount: 9,
      },
      {
        group: 'history',
        reason: 'budget_exceeded',
        detail: "Budget allocator retained 5 of 10 estimated tokens in group 'history' within 6 available prunable tokens.",
        prunedTokenCount: 5,
      },
    ]);
  });
});
