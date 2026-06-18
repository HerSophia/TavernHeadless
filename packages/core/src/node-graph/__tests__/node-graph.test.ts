import { describe, expect, it } from 'vitest';

import { evaluateNodeGraphCondition } from '../condition.js';
import { compileNodeGraph } from '../compiler.js';
import { createDefaultNodeTypeRegistry, NodeTypeRegistry } from '../registry.js';
import type { NodeGraphDocument } from '../types.js';

function createValidGraph(overrides: Partial<NodeGraphDocument> = {}): NodeGraphDocument {
  return {
    schemaVersion: 1,
    graphId: 'graph_r5_mvp',
    name: 'R5 MVP',
    mode: 'native_graph',
    policies: {},
    permissions: {
      required: ['project.agent.run'],
    },
    nodes: [
      {
        id: 'input',
        type: 'source.chat_history',
        typeVersion: '1',
        phase: 'pre_response',
      },
      {
        id: 'agent',
        type: 'agent.director_plan',
        typeVersion: '1',
        phase: 'pre_response',
      },
      {
        id: 'messages',
        type: 'compose.final_messages',
        typeVersion: '1',
        phase: 'response',
      },
      {
        id: 'narrator',
        type: 'narration.narrator',
        typeVersion: '1',
        phase: 'response',
      },
      {
        id: 'commit',
        type: 'output.commit_gate',
        typeVersion: '1',
        phase: 'commit',
      },
    ],
    edges: [
      {
        id: 'e_input_agent',
        kind: 'data',
        from: { nodeId: 'input', port: 'messages' },
        to: { nodeId: 'agent', port: 'messages' },
      },
      {
        id: 'e_messages_narrator',
        kind: 'data',
        from: { nodeId: 'messages', port: 'messages' },
        to: { nodeId: 'narrator', port: 'messages' },
      },
      {
        id: 'e_narrator_commit',
        kind: 'data',
        from: { nodeId: 'narrator', port: 'text' },
        to: { nodeId: 'commit', port: 'text' },
      },
    ],
    ...overrides,
  };
}

describe('NodeGraph core', () => {
  it('registers built-in node types and rejects duplicate registrations', () => {
    const registry = createDefaultNodeTypeRegistry();
    expect(registry.get('compose.final_messages', '1').previewPolicy).toBe('auto');

    const isolated = new NodeTypeRegistry();
    const entry = registry.get('source.user_input', '1');
    isolated.register(entry);
    expect(() => isolated.register(entry)).toThrow(/already registered/);
  });

  it('compiles a valid graph into topological levels', () => {
    const compiled = compileNodeGraph(createValidGraph());

    expect(compiled.isExecutable).toBe(true);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
    expect(compiled.topologicalLevels.map((level) => level.map((node) => node.id))).toEqual([
      ['input', 'messages'],
      ['agent', 'narrator'],
      ['commit'],
    ]);
  });

  it('reports missing node, unknown type, port mismatch, cycle and phase diagnostics', () => {
    const graph = createValidGraph({
      nodes: [
        { id: 'a', type: 'source.user_input', typeVersion: '1', phase: 'response' },
        { id: 'b', type: 'unknown.node', typeVersion: '1', phase: 'pre_response' },
      ],
      edges: [
        {
          id: 'missing',
          kind: 'data',
          from: { nodeId: 'a', port: 'text' },
          to: { nodeId: 'missing-node', port: 'messages' },
        },
        {
          id: 'mismatch',
          kind: 'data',
          from: { nodeId: 'a', port: 'text' },
          to: { nodeId: 'a', port: 'text' },
        },
        {
          id: 'cycle_a',
          kind: 'data',
          from: { nodeId: 'a', port: 'text' },
          to: { nodeId: 'b', port: 'messages' },
        },
        {
          id: 'cycle_b',
          kind: 'data',
          from: { nodeId: 'b', port: 'result' },
          to: { nodeId: 'a', port: 'messages' },
        },
      ],
    });

    const compiled = compileNodeGraph(graph);
    expect(compiled.isExecutable).toBe(false);
    expect(compiled.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining([
      'node_graph_phase_not_supported',
      'node_graph_unknown_node_type',
      'node_graph_edge_target_missing',
      'node_graph_input_port_missing',
      'node_graph_cycle_detected',
    ]));
  });

  it('reports missing permissions for privileged nodes', () => {
    const compiled = compileNodeGraph(createValidGraph({
      permissions: { required: [] },
    }));

    expect(compiled.isExecutable).toBe(false);
    expect(compiled.diagnostics.map((diagnostic) => diagnostic.code)).toContain('node_graph_permission_missing');
  });

  it('hardens required inputs, edge cardinality and unsupported control edges', () => {
    const registry = createDefaultNodeTypeRegistry();
    registry.register({
      type: 'test.required_input',
      typeVersion: '1',
      inputPorts: [{ name: 'value', type: 'text', required: true }],
      outputPorts: [{ name: 'text', type: 'text' }],
      supportedPhases: ['pre_response'],
      previewPolicy: 'auto',
      sideEffects: 'none',
    });

    const compiled = compileNodeGraph({
      schemaVersion: 1,
      graphId: 'graph_hardening',
      name: 'Hardening',
      mode: 'native_graph',
      policies: {},
      nodes: [
        { id: 'a', type: 'source.user_input', typeVersion: '1', phase: 'pre_response' },
        { id: 'b', type: 'source.user_input', typeVersion: '1', phase: 'pre_response' },
        { id: 'required', type: 'test.required_input', typeVersion: '1', phase: 'pre_response' },
      ],
      edges: [
        {
          id: 'e_a_required',
          kind: 'data',
          from: { nodeId: 'a', port: 'text' },
          to: { nodeId: 'required', port: 'value' },
        },
        {
          id: 'e_b_required',
          kind: 'data',
          from: { nodeId: 'b', port: 'text' },
          to: { nodeId: 'required', port: 'value' },
        },
        {
          id: 'e_control',
          kind: 'control',
          from: { nodeId: 'a', port: 'text' },
          to: { nodeId: 'required', port: 'value' },
        },
      ],
    }, { registry });

    expect(compiled.isExecutable).toBe(false);
    expect(compiled.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining([
      'node_graph_input_cardinality_violation',
      'node_graph_control_edge_unsupported',
    ]));

    const missingRequired = compileNodeGraph({
      ...createValidGraph({ graphId: 'graph_missing_required' }),
      permissions: { required: [] },
      nodes: [{ id: 'required', type: 'test.required_input', typeVersion: '1', phase: 'pre_response' }],
      edges: [],
    }, { registry });
    expect(missingRequired.diagnostics.map((diagnostic) => diagnostic.code)).toContain('node_graph_required_input_missing');

    const configSatisfied = compileNodeGraph({
      ...createValidGraph({ graphId: 'graph_config_required' }),
      permissions: { required: [] },
      nodes: [{
        id: 'required',
        type: 'test.required_input',
        typeVersion: '1',
        phase: 'pre_response',
        config: { value: 'from config' },
      }],
      edges: [],
    }, { registry });
    expect(configSatisfied.isExecutable).toBe(true);
  });

  it('requires explicit policies for persistent outputs and background agent jobs', () => {
    const outputGraph = createValidGraph({
      permissions: { required: ['project.derived_output.write'] },
      nodes: [
        { id: 'value', type: 'source.character', typeVersion: '1', phase: 'pre_response' },
        { id: 'write', type: 'output.derived_output', typeVersion: '1', phase: 'commit' },
      ],
      edges: [{
        id: 'e_value_write',
        kind: 'data',
        from: { nodeId: 'value', port: 'json' },
        to: { nodeId: 'write', port: 'value' },
      }],
    });
    expect(compileNodeGraph(outputGraph).diagnostics.map((diagnostic) => diagnostic.code))
      .toContain('node_graph_persistent_outputs_not_allowed');

    const allowedOutputGraph = compileNodeGraph({
      ...outputGraph,
      policies: { allowPersistentOutputs: true },
    });
    expect(allowedOutputGraph.isExecutable).toBe(true);

    const backgroundJobGraph = compileNodeGraph(createValidGraph({
      permissions: { required: ['project.agent.run'] },
      nodes: [{
        id: 'agent',
        type: 'agent.call',
        typeVersion: '1',
        phase: 'pre_response',
        config: { medium: { kind: 'background_job' } },
      }],
      edges: [],
    }));
    expect(backgroundJobGraph.diagnostics.map((diagnostic) => diagnostic.code))
      .toContain('node_graph_background_jobs_not_allowed');
  });

  it('validates group references and group port types', () => {
    const compiled = compileNodeGraph(createValidGraph({
      groups: [{
        id: 'group-1',
        name: 'Broken group',
        kind: 'subgraph',
        nodeIds: ['input', 'missing'],
        inputPorts: [{ name: 'bad', type: 'text' }],
      }],
    }));

    expect(compiled.diagnostics.map((diagnostic) => diagnostic.code)).toContain('node_graph_group_node_missing');
    expect(compiled.diagnostics.map((diagnostic) => diagnostic.code)).toContain('node_graph_subgraph_input_boundary_missing');
  });

  it('evaluates structured conditions without executing code', () => {
    const context = {
      state: {
        score: 4,
        tags: ['lore', 'style'],
        title: 'chapter one',
      },
    };

    expect(evaluateNodeGraphCondition({
      op: 'and',
      items: [
        { op: 'gte', left: { path: ['state', 'score'] }, right: 4 },
        { op: 'contains', value: { path: ['state', 'tags'] }, item: 'lore' },
        { op: 'not', item: { op: 'empty', value: { path: ['state', 'title'] } } },
      ],
    }, context)).toBe(true);
  });
});
