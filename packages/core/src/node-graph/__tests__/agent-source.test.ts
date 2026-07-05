import { describe, expect, it } from 'vitest';

import {
  readNodeGraphPresetRef,
  readNodeGraphSubgraphRef,
  resolveNodeGraphAgentSource,
} from '../agent-source.js';
import { validateNodeGraph } from '../validator.js';
import type { NodeGraphDocument } from '../types.js';

/**
 * NG2-7：Agent 承载节点「执行来源二选一」的 core 契约用例。
 *
 * 覆盖（设计 §3.2 / §3.3 / §4.1）：
 * - resolveNodeGraphAgentSource 推断表全分支（缺省 + 无 ref / presetRef / subgraphRef；显式 source；非法枚举）。
 * - readNodeGraphPresetRef / readNodeGraphSubgraphRef 结构合法/非法与 versionId 归一。
 * - validator：来源冲突（双 ref、source 与 ref 矛盾）、source 非法枚举、source=subgraph 缺 ref、
 *   subgraphRef 结构非法各产出对应诊断码。
 * - 零回归：既有 narrator 形态（native/compat 模板图、导入图、有 presetRef）全部 isValid。
 */

function narratorNode(config: unknown) {
  return { config } as const;
}

function narratorGraph(narratorConfig: unknown): NodeGraphDocument {
  return {
    schemaVersion: 2,
    graphId: 'g_agent_source',
    name: 'Agent Source Graph',
    mode: 'native_graph',
    policies: {},
    permissions: { required: [] },
    nodes: [
      { id: 'compose', type: 'compose.final_messages', typeVersion: '1', phase: 'response' },
      {
        id: 'narrator',
        type: 'narration.narrator',
        typeVersion: '1',
        phase: 'response',
        config: narratorConfig,
      },
      { id: 'userInput', type: 'source.user_input', typeVersion: '1', phase: 'pre_response' },
      { id: 'commit', type: 'output.commit_gate', typeVersion: '1', phase: 'commit' },
    ],
    edges: [
      { id: 'e_compose_narrator', kind: 'data', from: { nodeId: 'compose', port: 'messages' }, to: { nodeId: 'narrator', port: 'messages' } },
      { id: 'e_userInput_narrator', kind: 'data', from: { nodeId: 'userInput', port: 'text' }, to: { nodeId: 'narrator', port: 'user_input' } },
      { id: 'e_narrator_commit', kind: 'data', from: { nodeId: 'narrator', port: 'text' }, to: { nodeId: 'commit', port: 'text' } },
    ],
  } as unknown as NodeGraphDocument;
}

function narratorDiagnostics(narratorConfig: unknown, code: string) {
  return validateNodeGraph(narratorGraph(narratorConfig)).diagnostics.filter(
    (diagnostic) => diagnostic.code === code,
  );
}

describe('resolveNodeGraphAgentSource inference table (design §3.2)', () => {
  it('defaults to preset when source is absent and there are no refs', () => {
    expect(resolveNodeGraphAgentSource(narratorNode(undefined))).toBe('preset');
    expect(resolveNodeGraphAgentSource(narratorNode({}))).toBe('preset');
    expect(resolveNodeGraphAgentSource(narratorNode({ presetName: 'x', sampling: {}, outputRegex: [] }))).toBe('preset');
  });

  it('infers preset when source is absent but presetRef is present', () => {
    expect(resolveNodeGraphAgentSource(narratorNode({ presetRef: { presetId: 'preset_x' } }))).toBe('preset');
    expect(resolveNodeGraphAgentSource(narratorNode({ presetRef: { presetId: 'preset_x', presetVersionId: 'pv_1' } }))).toBe('preset');
  });

  it('infers subgraph when source is absent but a structurally valid subgraphRef is present', () => {
    expect(resolveNodeGraphAgentSource(narratorNode({ subgraphRef: { graphId: 'g_1' } }))).toBe('subgraph');
    expect(resolveNodeGraphAgentSource(narratorNode({ subgraphRef: { graphId: 'g_1', versionId: 'v_1' } }))).toBe('subgraph');
  });

  it('returns the explicit source when it is a valid enum value', () => {
    expect(resolveNodeGraphAgentSource(narratorNode({ source: 'preset' }))).toBe('preset');
    expect(resolveNodeGraphAgentSource(narratorNode({ source: 'subgraph', subgraphRef: { graphId: 'g_1' } }))).toBe('subgraph');
    // Explicit preset with a structurally invalid subgraphRef still resolves to preset (conflict handled by validator).
    expect(resolveNodeGraphAgentSource(narratorNode({ source: 'preset', presetRef: { presetId: 'preset_x' } }))).toBe('preset');
  });

  it('returns null when source is an invalid enum value', () => {
    expect(resolveNodeGraphAgentSource(narratorNode({ source: 'both' }))).toBeNull();
    expect(resolveNodeGraphAgentSource(narratorNode({ source: 42 }))).toBeNull();
    expect(resolveNodeGraphAgentSource(narratorNode({ source: '' }))).toBeNull();
  });
});

describe('readNodeGraphPresetRef structure reading', () => {
  it('reads a structurally valid presetRef and normalizes versionId', () => {
    expect(readNodeGraphPresetRef(narratorNode({ presetRef: { presetId: 'preset_x', presetVersionId: 'pv_1' } })))
      .toEqual({ presetId: 'preset_x', presetVersionId: 'pv_1' });
    expect(readNodeGraphPresetRef(narratorNode({ presetRef: { presetId: 'preset_x' } })))
      .toEqual({ presetId: 'preset_x', presetVersionId: null });
    expect(readNodeGraphPresetRef(narratorNode({ presetRef: { presetId: 'preset_x', presetVersionId: null } })))
      .toEqual({ presetId: 'preset_x', presetVersionId: null });
    // Empty version string normalizes to null.
    expect(readNodeGraphPresetRef(narratorNode({ presetRef: { presetId: 'preset_x', presetVersionId: '' } })))
      .toEqual({ presetId: 'preset_x', presetVersionId: null });
  });

  it('returns null for a missing or structurally invalid presetRef', () => {
    expect(readNodeGraphPresetRef(narratorNode(undefined))).toBeNull();
    expect(readNodeGraphPresetRef(narratorNode({}))).toBeNull();
    expect(readNodeGraphPresetRef(narratorNode({ presetRef: 'preset_x' }))).toBeNull();
    expect(readNodeGraphPresetRef(narratorNode({ presetRef: {} }))).toBeNull();
    expect(readNodeGraphPresetRef(narratorNode({ presetRef: { presetId: '' } }))).toBeNull();
    expect(readNodeGraphPresetRef(narratorNode({ presetRef: { presetId: 42 } }))).toBeNull();
    expect(readNodeGraphPresetRef(narratorNode({ presetRef: { presetId: 'preset_x', presetVersionId: 7 } }))).toBeNull();
  });
});

describe('readNodeGraphSubgraphRef structure reading', () => {
  it('reads a structurally valid subgraphRef and normalizes versionId', () => {
    expect(readNodeGraphSubgraphRef(narratorNode({ subgraphRef: { graphId: 'g_1', versionId: 'v_1' } })))
      .toEqual({ graphId: 'g_1', versionId: 'v_1' });
    expect(readNodeGraphSubgraphRef(narratorNode({ subgraphRef: { graphId: 'g_1' } })))
      .toEqual({ graphId: 'g_1', versionId: null });
    expect(readNodeGraphSubgraphRef(narratorNode({ subgraphRef: { graphId: 'g_1', versionId: null } })))
      .toEqual({ graphId: 'g_1', versionId: null });
    // Empty version string normalizes to null.
    expect(readNodeGraphSubgraphRef(narratorNode({ subgraphRef: { graphId: 'g_1', versionId: '' } })))
      .toEqual({ graphId: 'g_1', versionId: null });
  });

  it('returns null for a missing or structurally invalid subgraphRef', () => {
    expect(readNodeGraphSubgraphRef(narratorNode(undefined))).toBeNull();
    expect(readNodeGraphSubgraphRef(narratorNode({}))).toBeNull();
    expect(readNodeGraphSubgraphRef(narratorNode({ subgraphRef: 'g_1' }))).toBeNull();
    expect(readNodeGraphSubgraphRef(narratorNode({ subgraphRef: {} }))).toBeNull();
    expect(readNodeGraphSubgraphRef(narratorNode({ subgraphRef: { graphId: '' } }))).toBeNull();
    expect(readNodeGraphSubgraphRef(narratorNode({ subgraphRef: { graphId: 42 } }))).toBeNull();
    expect(readNodeGraphSubgraphRef(narratorNode({ subgraphRef: { graphId: 'g_1', versionId: 7 } }))).toBeNull();
  });
});

describe('validator carrier-source mutual exclusion (design §3.3)', () => {
  it('flags a conflict when both presetRef and subgraphRef are present', () => {
    expect(
      narratorDiagnostics(
        { presetRef: { presetId: 'preset_x' }, subgraphRef: { graphId: 'g_1' } },
        'node_graph_agent_source_conflict',
      ),
    ).toHaveLength(1);
    expect(
      validateNodeGraph(
        narratorGraph({ presetRef: { presetId: 'preset_x' }, subgraphRef: { graphId: 'g_1' } }),
      ).isValid,
    ).toBe(false);
  });

  it("flags a conflict when source 'preset' carries a subgraphRef", () => {
    expect(
      narratorDiagnostics(
        { source: 'preset', subgraphRef: { graphId: 'g_1' } },
        'node_graph_agent_source_conflict',
      ),
    ).toHaveLength(1);
  });

  it("flags a conflict when source 'subgraph' carries a presetRef", () => {
    expect(
      narratorDiagnostics(
        { source: 'subgraph', presetRef: { presetId: 'preset_x' } },
        'node_graph_agent_source_conflict',
      ),
    ).toHaveLength(1);
  });

  it('flags an invalid source enum value', () => {
    expect(narratorDiagnostics({ source: 'both' }, 'node_graph_agent_source_invalid')).toHaveLength(1);
    expect(narratorDiagnostics({ source: 42 }, 'node_graph_agent_source_invalid')).toHaveLength(1);
  });

  it("flags a missing subgraphRef when source is 'subgraph'", () => {
    expect(
      narratorDiagnostics({ source: 'subgraph' }, 'node_graph_agent_subgraph_ref_missing'),
    ).toHaveLength(1);
  });

  it('flags a structurally invalid subgraphRef', () => {
    expect(narratorDiagnostics({ subgraphRef: 'g_1' }, 'node_graph_narrator_subgraph_ref_invalid')).toHaveLength(1);
    expect(narratorDiagnostics({ subgraphRef: { graphId: '' } }, 'node_graph_narrator_subgraph_ref_invalid')).toHaveLength(1);
    expect(narratorDiagnostics({ subgraphRef: { graphId: 'g_1', versionId: 7 } }, 'node_graph_narrator_subgraph_ref_invalid')).toHaveLength(1);
  });

  it('accepts a valid explicit subgraph carrier', () => {
    const result = validateNodeGraph(narratorGraph({ source: 'subgraph', subgraphRef: { graphId: 'g_1', versionId: 'v_1' } }));
    expect(result.diagnostics.filter((diagnostic) => diagnostic.nodeId === 'narrator')).toHaveLength(0);
    expect(result.isValid).toBe(true);
  });

  it('attaches nodeId to every carrier-source diagnostic', () => {
    const diagnostics = validateNodeGraph(
      narratorGraph({ source: 'subgraph', presetRef: { presetId: 'preset_x' } }),
    ).diagnostics.filter((diagnostic) => diagnostic.code.startsWith('node_graph_agent_'));
    expect(diagnostics.length).toBeGreaterThan(0);
    for (const diagnostic of diagnostics) {
      expect(diagnostic.nodeId).toBe('narrator');
    }
  });
});

describe('validator zero-regression for existing narrator forms', () => {
  it('accepts an absent config / empty config (native & compat template graphs)', () => {
    expect(validateNodeGraph(narratorGraph(undefined)).isValid).toBe(true);
    expect(validateNodeGraph(narratorGraph({})).isValid).toBe(true);
  });

  it('accepts an imported-graph narrator with presetName / sampling / outputRegex and no ref', () => {
    const result = validateNodeGraph(
      narratorGraph({ presetName: 'My Preset', sampling: { temperature: 0.7 }, outputRegex: ['/foo/g'] }),
    );
    expect(result.isValid).toBe(true);
  });

  it('accepts a narrator with a structurally valid presetRef (source omitted)', () => {
    expect(validateNodeGraph(narratorGraph({ presetRef: { presetId: 'preset_x', presetVersionId: 'pv_1' } })).isValid).toBe(true);
    expect(validateNodeGraph(narratorGraph({ presetRef: { presetId: 'preset_x', presetVersionId: null } })).isValid).toBe(true);
    expect(validateNodeGraph(narratorGraph({ presetRef: { presetId: 'preset_x' } })).isValid).toBe(true);
  });

  it("accepts an explicit source 'preset' with a presetRef and no subgraphRef", () => {
    expect(validateNodeGraph(narratorGraph({ source: 'preset', presetRef: { presetId: 'preset_x' } })).isValid).toBe(true);
  });
});
