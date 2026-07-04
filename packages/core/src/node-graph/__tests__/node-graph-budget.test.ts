import { describe, expect, it } from 'vitest';

import {
  DEFAULT_NODE_GRAPH_RUNTIME_BUDGET,
  DEFAULT_NODE_GRAPH_SYNC_PREVIEW_BUDGET,
  countNodeGraphNestedAgentJobs,
  countNodeGraphTemporaryConversations,
  resolveNodeGraphBudget,
  summarizeNodeGraphBudgetUsage,
} from '../budget.js';
import { validateNodeGraph } from '../validator.js';
import type { NodeGraphDocument } from '../types.js';

function budgetGraph(overrides: Partial<NodeGraphDocument> = {}): NodeGraphDocument {
  return {
    schemaVersion: 2,
    graphId: 'g_budget',
    name: 'Budget graph',
    mode: 'native_graph',
    policies: { allowBackgroundJobs: true },
    permissions: { required: ['project.agent.run'] },
    nodes: [
      { id: 'comment', type: 'annotation.comment', typeVersion: '1', phase: 'pre_response' },
      {
        id: 'agent_bg',
        type: 'agent.call',
        typeVersion: '1',
        phase: 'pre_response',
        config: { medium: { kind: 'background_job', deliveryTarget: 'return_inline' } },
      },
      {
        id: 'agent_temp',
        type: 'agent.call',
        typeVersion: '1',
        phase: 'pre_response',
        config: { medium: { kind: 'temporary_conversation', deliveryTarget: 'return_inline' } },
      },
      { id: 'messages', type: 'compose.final_messages', typeVersion: '1', phase: 'response' },
    ],
    edges: [],
    ...overrides,
  };
}

describe('node graph budget helpers', () => {
  it('uses platform defaults when graph overrides are absent', () => {
    expect(resolveNodeGraphBudget(DEFAULT_NODE_GRAPH_RUNTIME_BUDGET)).toEqual(DEFAULT_NODE_GRAPH_RUNTIME_BUDGET);
    expect(resolveNodeGraphBudget(DEFAULT_NODE_GRAPH_SYNC_PREVIEW_BUDGET)).toEqual(DEFAULT_NODE_GRAPH_SYNC_PREVIEW_BUDGET);
  });

  it('allows graph overrides to tighten but not raise platform limits', () => {
    const resolved = resolveNodeGraphBudget(DEFAULT_NODE_GRAPH_RUNTIME_BUDGET, {
      maxNodesExecuted: 50,
      maxDepth: 999,
      maxFanOut: 1,
      maxNestedAgentJobs: 0,
      maxTemporaryConversations: 0,
      maxRuntimeDurationMs: 60_000,
    });

    expect(resolved.maxNodesExecuted).toBe(50);
    expect(resolved.maxDepth).toBe(DEFAULT_NODE_GRAPH_RUNTIME_BUDGET.maxDepth);
    expect(resolved.maxFanOut).toBe(1);
    expect(resolved.maxNestedAgentJobs).toBe(0);
    expect(resolved.maxTemporaryConversations).toBe(0);
    expect(resolved.maxRuntimeDurationMs).toBe(DEFAULT_NODE_GRAPH_RUNTIME_BUDGET.maxRuntimeDurationMs);
  });

  it('summarizes budget usage from runtime nodes and enabled agent calls', () => {
    const document = budgetGraph({
      nodes: [
        ...budgetGraph().nodes,
        {
          id: 'agent_disabled',
          type: 'agent.call',
          typeVersion: '1',
          phase: 'pre_response',
          enabled: false,
          config: { medium: { kind: 'background_job', deliveryTarget: 'return_inline' } },
        },
      ],
    });

    expect(countNodeGraphNestedAgentJobs(document)).toBe(1);
    expect(countNodeGraphTemporaryConversations(document)).toBe(1);

    expect(summarizeNodeGraphBudgetUsage(document, [['agent_bg', 'agent_temp'], ['messages']])).toEqual({
      runtimeNodeCount: 4,
      depth: 2,
      maxFanOut: 2,
      nestedAgentJobs: 1,
      temporaryConversations: 1,
    });
  });

  it('reports validator diagnostics for invalid budget values', () => {
    const result = validateNodeGraph(budgetGraph({
      budgets: {
        maxNodesExecuted: 0,
        maxDepth: 1.5,
        maxFanOut: Number.POSITIVE_INFINITY,
        maxNestedAgentJobs: -1,
        maxTemporaryConversations: 0,
        maxRuntimeDurationMs: 1000,
      },
    }));

    const budgetDiagnostics = result.diagnostics.filter((diagnostic) => diagnostic.code === 'node_graph_budget_invalid');
    expect(budgetDiagnostics).toHaveLength(4);
    expect(budgetDiagnostics.map((diagnostic) => diagnostic.path?.join('.'))).toEqual([
      'budgets.maxNodesExecuted',
      'budgets.maxDepth',
      'budgets.maxFanOut',
      'budgets.maxNestedAgentJobs',
    ]);
  });
});
