import { describe, expect, it } from 'vitest';

import { compileNodeGraph } from '../compiler.js';
import {
  classifyNodeGraphCheckpointReuse,
  isNodeFloorCheckpointEligible,
} from '../checkpoint.js';
import {
  computeNodeGraphControlSignal,
  resolveNodeGraphControlActivation,
  type NodeGraphControlSignal,
} from '../control.js';
import {
  evaluateNodeGraphCondition,
  evaluateNodeGraphConditionWithTrace,
  validateNodeGraphConditionExpr,
  type NodeGraphConditionExpr,
} from '../condition.js';
import {
  detectNodeGraphSchemaMigration,
  migrateNodeGraphDocumentToV2,
} from '../migration.js';
import type { NodeGraphDocument, NodeGraphEdge } from '../types.js';

function v2ControlGraph(overrides: Partial<NodeGraphDocument> = {}): NodeGraphDocument {
  return {
    schemaVersion: 2,
    graphId: 'graph_v2_control',
    name: 'V2 Control',
    mode: 'native_graph',
    policies: {},
    permissions: { required: [] },
    nodes: [
      { id: 'history', type: 'source.chat_history', typeVersion: '1', phase: 'pre_response' },
      {
        id: 'cond',
        type: 'control.condition',
        typeVersion: '1',
        phase: 'pre_response',
        config: { condition: { op: 'exists', value: { source: 'runtime', path: ['intent'] } } },
      },
      { id: 'branch', type: 'control.branch', typeVersion: '1', phase: 'pre_response' },
      { id: 'messages', type: 'compose.final_messages', typeVersion: '1', phase: 'response' },
      { id: 'narrator', type: 'narration.narrator', typeVersion: '1', phase: 'response' },
      { id: 'commit', type: 'output.commit_gate', typeVersion: '1', phase: 'commit' },
    ],
    edges: [
      { id: 'e_history_messages', kind: 'data', from: { nodeId: 'history', port: 'messages' }, to: { nodeId: 'messages', port: 'messages' } },
      { id: 'e_cond_branch', kind: 'data', from: { nodeId: 'cond', port: 'result' }, to: { nodeId: 'branch', port: 'condition' } },
      { id: 'e_messages_narrator', kind: 'data', from: { nodeId: 'messages', port: 'messages' }, to: { nodeId: 'narrator', port: 'messages' } },
      { id: 'e_branch_narrator', kind: 'control', from: { nodeId: 'branch', port: 'true' }, to: { nodeId: 'narrator', port: 'messages' } },
      { id: 'e_narrator_commit', kind: 'data', from: { nodeId: 'narrator', port: 'text' }, to: { nodeId: 'commit', port: 'text' } },
    ],
    ...overrides,
  };
}

describe('NodeGraph v2 schema and control validation', () => {
  it('compiles a v2 graph with control edges and control nodes', () => {
    const compiled = compileNodeGraph(v2ControlGraph());
    expect(compiled.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(compiled.isExecutable).toBe(true);
  });

  it('treats edges with missing kind as data edges in v2', () => {
    const graph = v2ControlGraph();
    graph.edges = graph.edges.map((edge): NodeGraphEdge =>
      edge.id === 'e_history_messages' ? { ...edge, kind: undefined } : edge,
    );
    const compiled = compileNodeGraph(graph);
    expect(compiled.isExecutable).toBe(true);
  });

  it('still rejects control edges and control nodes in v1', () => {
    const v1 = v2ControlGraph({ schemaVersion: 1 });
    const compiled = compileNodeGraph(v1);
    const codes = compiled.diagnostics.map((d) => d.code);
    expect(codes).toContain('node_graph_control_edge_unsupported');
    expect(codes).toContain('node_graph_control_node_unsupported');
    expect(compiled.isExecutable).toBe(false);
  });

  it('rejects a control edge that does not originate from a control port', () => {
    const graph = v2ControlGraph();
    graph.edges.push({
      id: 'e_bad_control',
      kind: 'control',
      from: { nodeId: 'history', port: 'messages' },
      to: { nodeId: 'commit', port: 'text' },
    });
    const compiled = compileNodeGraph(graph);
    expect(compiled.diagnostics.map((d) => d.code)).toContain('node_graph_control_edge_invalid_source');
  });

  it('requires a condition for condition nodes and a condition source for branch/gate', () => {
    const graph = v2ControlGraph();
    graph.nodes = graph.nodes.map((node) =>
      node.id === 'cond' ? { ...node, config: {} } : node,
    );
    const compiled = compileNodeGraph(graph);
    expect(compiled.diagnostics.map((d) => d.code)).toContain('node_graph_control_condition_missing');
  });

  it('rejects node_output references that are not upstream ancestors', () => {
    const graph = v2ControlGraph();
    graph.nodes = graph.nodes.map((node) =>
      node.id === 'cond'
        ? { ...node, config: { condition: { op: 'exists', value: { source: 'node_output', path: ['commit', 'decision'] } } } }
        : node,
    );
    const compiled = compileNodeGraph(graph);
    expect(compiled.diagnostics.map((d) => d.code)).toContain('node_graph_condition_node_output_not_upstream');
  });

  it('rejects over-complex conditions', () => {
    const deep: NodeGraphConditionExpr = {
      op: 'not',
      item: { op: 'not', item: { op: 'not', item: { op: 'not', item: { op: 'not', item: { op: 'not', item: { op: 'exists', value: { path: ['x'] } } } } } } },
    };
    const issues = validateNodeGraphConditionExpr(deep, { maxDepth: 3 });
    expect(issues.map((i) => i.code)).toContain('condition_too_deep');

    const wide: NodeGraphConditionExpr = {
      op: 'and',
      items: Array.from({ length: 20 }, () => ({ op: 'exists', value: { path: ['x'] } } as NodeGraphConditionExpr)),
    };
    expect(validateNodeGraphConditionExpr(wide, { maxItems: 16 }).map((i) => i.code)).toContain('condition_too_many_items');
  });

  it('validates system graph requirements', () => {
    const broken = v2ControlGraph({ metadata: { systemGraph: true } });
    broken.nodes = broken.nodes.filter((node) => node.type !== 'narration.narrator' && node.type !== 'output.commit_gate');
    broken.edges = broken.edges.filter((edge) => edge.to.nodeId !== 'narrator' && edge.from.nodeId !== 'narrator' && edge.to.nodeId !== 'commit');
    const codes = compileNodeGraph(broken).diagnostics.map((d) => d.code);
    expect(codes).toContain('node_graph_system_graph_narrator_required');
    expect(codes).toContain('node_graph_system_graph_commit_gate_required');
  });
});

describe('NodeGraph v2 condition evaluation', () => {
  it('reads values by controlled source', () => {
    const context = {
      variable: { score: 7 },
      session_state: { mood: 'calm' },
      node_output: { cond: { result: true } },
      runtime: { intent: 'normal' },
    };
    expect(evaluateNodeGraphCondition({
      op: 'and',
      items: [
        { op: 'gte', left: { source: 'variable', path: ['score'] }, right: 5 },
        { op: 'eq', left: { source: 'session_state', path: ['mood'] }, right: 'calm' },
        { op: 'eq', left: { source: 'node_output', path: ['cond', 'result'] }, right: true },
        { op: 'exists', value: { source: 'runtime', path: ['intent'] } },
      ],
    }, context)).toBe(true);
  });

  it('produces a per-node evaluation trace', () => {
    const { result, trace } = evaluateNodeGraphConditionWithTrace({
      op: 'or',
      items: [
        { op: 'eq', left: { source: 'variable', path: ['a'] }, right: 1 },
        { op: 'eq', left: { source: 'variable', path: ['b'] }, right: 2 },
      ],
    }, { variable: { a: 0, b: 2 } });
    expect(result).toBe(true);
    expect(trace.some((entry) => entry.op === 'or' && entry.result === true)).toBe(true);
  });
});

describe('NodeGraph v2 control activation', () => {
  it('routes branch true/false and gate open signals', () => {
    expect(computeNodeGraphControlSignal('control.branch', true)).toEqual({ activePorts: ['true'] });
    expect(computeNodeGraphControlSignal('control.branch', false)).toEqual({ activePorts: ['false'] });
    expect(computeNodeGraphControlSignal('control.gate', true)).toEqual({ activePorts: ['open'] });
    expect(computeNodeGraphControlSignal('control.gate', false)).toEqual({ activePorts: [] });
  });

  it('activates a node only when an incoming control edge fires', () => {
    const edge: NodeGraphEdge = { id: 'e1', kind: 'control', from: { nodeId: 'branch', port: 'true' }, to: { nodeId: 'n', port: 'x' } };
    const signals = new Map<string, NodeGraphControlSignal>([['branch', { activePorts: ['true'] }]]);
    const active = resolveNodeGraphControlActivation({
      incomingControlEdges: [edge],
      signalsByNodeId: signals,
      skippedNodeIds: new Set(),
      onSkipByNodeId: new Map(),
    });
    expect(active).toMatchObject({ gated: true, active: true });

    const inactive = resolveNodeGraphControlActivation({
      incomingControlEdges: [edge],
      signalsByNodeId: new Map([['branch', { activePorts: ['false'] }]]),
      skippedNodeIds: new Set(),
      onSkipByNodeId: new Map([['branch', 'use_default']]),
    });
    expect(inactive).toMatchObject({ gated: true, active: false, onSkip: 'use_default' });
  });

  it('treats nodes without control edges as always active', () => {
    expect(resolveNodeGraphControlActivation({
      incomingControlEdges: [],
      signalsByNodeId: new Map(),
      skippedNodeIds: new Set(),
      onSkipByNodeId: new Map(),
    })).toMatchObject({ gated: false, active: true });
  });
});

describe('NodeGraph v2 checkpoint eligibility and reuse', () => {
  it('only allows floor checkpoint for opt-in pre-response nodes', () => {
    expect(isNodeFloorCheckpointEligible({ phase: 'pre_response', scope: 'floor_stable' })).toBe(true);
    expect(isNodeFloorCheckpointEligible({ phase: 'pre_response', retryPolicy: 'reuse_if_inputs_same' })).toBe(true);
    expect(isNodeFloorCheckpointEligible({ phase: 'pre_response' })).toBe(false);
    expect(isNodeFloorCheckpointEligible({ phase: 'response', scope: 'floor_stable' })).toBe(false);
    expect(isNodeFloorCheckpointEligible({ phase: 'pre_response', scope: 'pre_response_stochastic' })).toBe(false);
    expect(isNodeFloorCheckpointEligible({ phase: 'pre_response', scope: 'floor_stable', checkpointPolicy: 'rerun_on_regen' })).toBe(false);
  });

  it('reuses only when input and config hashes match', () => {
    expect(classifyNodeGraphCheckpointReuse({
      eligible: true,
      checkpoint: { inputHash: 'i', configHash: 'c' },
      currentInputHash: 'i',
      currentConfigHash: 'c',
    })).toEqual({ decision: 'reuse', reason: 'input_hash_match' });

    expect(classifyNodeGraphCheckpointReuse({
      eligible: true,
      checkpoint: { inputHash: 'i', configHash: 'c' },
      currentInputHash: 'i2',
      currentConfigHash: 'c',
    })).toEqual({ decision: 'miss', reason: 'input_hash_changed' });

    expect(classifyNodeGraphCheckpointReuse({
      eligible: true,
      checkpoint: null,
      currentInputHash: 'i',
      currentConfigHash: 'c',
    })).toEqual({ decision: 'miss', reason: 'no_checkpoint' });

    expect(classifyNodeGraphCheckpointReuse({
      eligible: false,
      currentInputHash: 'i',
      currentConfigHash: 'c',
    })).toEqual({ decision: 'miss', reason: 'not_eligible' });
  });
});

describe('NodeGraph v1 -> v2 migration', () => {
  it('upgrades schemaVersion and fills edge kind defaults', () => {
    const v1: NodeGraphDocument = {
      schemaVersion: 1,
      graphId: 'graph_v1',
      name: 'V1',
      mode: 'native_graph',
      policies: {},
      nodes: [{ id: 'a', type: 'source.user_input', typeVersion: '1', phase: 'pre_response' }],
      edges: [{ id: 'e', from: { nodeId: 'a', port: 'text' }, to: { nodeId: 'a', port: 'text' } } as NodeGraphEdge],
    };
    const { document, changed } = migrateNodeGraphDocumentToV2(v1);
    expect(changed).toBe(true);
    expect(document.schemaVersion).toBe(2);
    expect(document.edges[0]?.kind).toBe('data');

    const again = migrateNodeGraphDocumentToV2(document);
    expect(again.changed).toBe(false);
  });

  it('emits a MIGRATION_AVAILABLE diagnostic for sub-v2 documents', () => {
    expect(detectNodeGraphSchemaMigration({ schemaVersion: 1 })[0]?.code).toBe('MIGRATION_AVAILABLE');
    expect(detectNodeGraphSchemaMigration({ schemaVersion: 2 })).toEqual([]);
  });
});
