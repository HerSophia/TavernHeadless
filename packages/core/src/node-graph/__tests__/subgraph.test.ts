import { describe, expect, it } from 'vitest';

import { compileNodeGraph } from '../compiler.js';
import { deriveSubgraphInterface, groupSwitchState } from '../subgraph.js';
import type { NodeGraphDocument } from '../types.js';

function doc(overrides: Partial<NodeGraphDocument>): NodeGraphDocument {
  return {
    schemaVersion: 2,
    graphId: 'g',
    name: 'g',
    mode: 'native_graph',
    policies: {},
    nodes: [],
    edges: [],
    ...overrides,
  };
}

const VALID_INTERFACE = {
  inputs: [{ name: 'q', type: 'text' }],
  outputs: [{ name: 'r', type: 'text' }],
};

describe('deriveSubgraphInterface', () => {
  it('reads boundary ports from group.input / group.output config', () => {
    const iface = deriveSubgraphInterface({
      nodes: [
        { id: 'in', type: 'group.input', typeVersion: '1', phase: 'pre_response', config: { portName: 'q', portType: 'text', required: true } },
        { id: 'out', type: 'group.output', typeVersion: '1', phase: 'response', config: { portName: 'r', portType: 'json' } },
        { id: 'noise', type: 'source.user_input', typeVersion: '1', phase: 'pre_response' },
      ],
    });
    expect(iface.inputs).toEqual([{ name: 'q', type: 'text', required: true }]);
    expect(iface.outputs).toEqual([{ name: 'r', type: 'json' }]);
  });

  it('reads multi-port group.input / group.output via config.ports (Blender-style)', () => {
    const iface = deriveSubgraphInterface({
      nodes: [
        { id: 'gi', type: 'group.input', typeVersion: '1', phase: 'pre_response', config: { ports: [{ name: 'a', type: 'text' }, { name: 'b', type: 'json' }] } },
        { id: 'go', type: 'group.output', typeVersion: '1', phase: 'commit', config: { ports: [{ name: 'r', type: 'text' }] } },
      ],
    });
    expect(iface.inputs).toEqual([{ name: 'a', type: 'text' }, { name: 'b', type: 'json' }]);
    expect(iface.outputs).toEqual([{ name: 'r', type: 'text' }]);
  });

  it('ignores boundary nodes with malformed config', () => {
    const iface = deriveSubgraphInterface({
      nodes: [
        { id: 'in', type: 'group.input', typeVersion: '1', phase: 'pre_response', config: { portType: 'text' } },
        { id: 'out', type: 'group.output', typeVersion: '1', phase: 'response', config: { portName: 'r', portType: 'not_a_type' } },
      ],
    });
    expect(iface.inputs).toEqual([]);
    expect(iface.outputs).toEqual([]);
  });
});

describe('groupSwitchState', () => {
  it('reports on when every member is enabled (or the group is empty)', () => {
    expect(groupSwitchState([])).toBe('on');
    expect(groupSwitchState([{ enabled: true }, {}])).toBe('on');
  });

  it('reports off when every member is disabled', () => {
    expect(groupSwitchState([{ enabled: false }, { enabled: false }])).toBe('off');
  });

  it('reports mixed when members diverge', () => {
    expect(groupSwitchState([{ enabled: false }, {}])).toBe('mixed');
  });
});

describe('group.node validation', () => {
  it('accepts a group.node with ref + interface and validates edges against the interface', () => {
    const compiled = compileNodeGraph(
      doc({
        nodes: [
          { id: 'up', type: 'source.user_input', typeVersion: '1', phase: 'pre_response' },
          {
            id: 'g',
            type: 'group.node',
            typeVersion: '1',
            phase: 'pre_response',
            config: { ref: { graphId: 'sub-1' }, interface: VALID_INTERFACE },
          },
          { id: 'down', type: 'select.worldbook_match', typeVersion: '1', phase: 'pre_response' },
        ],
        edges: [
          { id: 'e_up_g', from: { nodeId: 'up', port: 'text' }, to: { nodeId: 'g', port: 'q' } },
          { id: 'e_g_down', from: { nodeId: 'g', port: 'r' }, to: { nodeId: 'down', port: 'query' } },
        ],
      }),
    );
    expect(compiled.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(compiled.isExecutable).toBe(true);
  });

  it('flags edges that reference ports not in the interface', () => {
    const compiled = compileNodeGraph(
      doc({
        nodes: [
          { id: 'up', type: 'source.user_input', typeVersion: '1', phase: 'pre_response' },
          { id: 'g', type: 'group.node', typeVersion: '1', phase: 'pre_response', config: { ref: { graphId: 's' }, interface: VALID_INTERFACE } },
        ],
        edges: [{ id: 'e', from: { nodeId: 'up', port: 'text' }, to: { nodeId: 'g', port: 'nope' } }],
      }),
    );
    expect(compiled.diagnostics.map((d) => d.code)).toContain('node_graph_input_port_missing');
  });

  it('flags interface port type mismatches', () => {
    const compiled = compileNodeGraph(
      doc({
        nodes: [
          { id: 'up', type: 'source.user_input', typeVersion: '1', phase: 'pre_response' },
          {
            id: 'g',
            type: 'group.node',
            typeVersion: '1',
            phase: 'pre_response',
            config: { ref: { graphId: 's' }, interface: { inputs: [{ name: 'q', type: 'messages' }], outputs: [] } },
          },
        ],
        edges: [{ id: 'e', from: { nodeId: 'up', port: 'text' }, to: { nodeId: 'g', port: 'q' } }],
      }),
    );
    expect(compiled.diagnostics.map((d) => d.code)).toContain('node_graph_port_type_mismatch');
  });

  it('reports a missing subgraph ref', () => {
    const compiled = compileNodeGraph(
      doc({
        nodes: [{ id: 'g', type: 'group.node', typeVersion: '1', phase: 'pre_response', config: { interface: VALID_INTERFACE } }],
      }),
    );
    expect(compiled.diagnostics.map((d) => d.code)).toContain('node_graph_group_node_ref_missing');
    expect(compiled.isExecutable).toBe(false);
  });

  it('reports a missing interface cache', () => {
    const compiled = compileNodeGraph(
      doc({
        nodes: [{ id: 'g', type: 'group.node', typeVersion: '1', phase: 'pre_response', config: { ref: { graphId: 's' } } }],
      }),
    );
    expect(compiled.diagnostics.map((d) => d.code)).toContain('node_graph_group_node_interface_missing');
  });

  it('reports a malformed interface cache', () => {
    const compiled = compileNodeGraph(
      doc({
        nodes: [
          {
            id: 'g',
            type: 'group.node',
            typeVersion: '1',
            phase: 'pre_response',
            config: { ref: { graphId: 's' }, interface: { inputs: 'nope', outputs: [] } },
          },
        ],
      }),
    );
    expect(compiled.diagnostics.map((d) => d.code)).toContain('node_graph_group_node_interface_invalid');
  });

  it('enforces single-input cardinality on interface ports', () => {
    const compiled = compileNodeGraph(
      doc({
        nodes: [
          { id: 'up1', type: 'source.user_input', typeVersion: '1', phase: 'pre_response' },
          { id: 'up2', type: 'source.user_input', typeVersion: '1', phase: 'pre_response' },
          { id: 'g', type: 'group.node', typeVersion: '1', phase: 'pre_response', config: { ref: { graphId: 's' }, interface: VALID_INTERFACE } },
        ],
        edges: [
          { id: 'e1', from: { nodeId: 'up1', port: 'text' }, to: { nodeId: 'g', port: 'q' } },
          { id: 'e2', from: { nodeId: 'up2', port: 'text' }, to: { nodeId: 'g', port: 'q' } },
        ],
      }),
    );
    expect(compiled.diagnostics.map((d) => d.code)).toContain('node_graph_input_cardinality_violation');
  });
});
