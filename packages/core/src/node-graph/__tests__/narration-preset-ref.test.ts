import { describe, expect, it } from 'vitest';

import { validateNodeGraph } from '../validator.js';
import type { NodeGraphDocument } from '../types.js';

/**
 * LI11-3（3b）：`narration.narrator` 节点 `config.presetRef` 的结构校验用例。
 *
 * 验证点（设计 §6.2）：
 * - presetRef 缺省（未声明）合法——配方回退 `session.presetId`。
 *- presetRef 结构有效（presetId 非空字符串，presetVersionId 字符串或 null）合法。
 * - presetRef 非对象 / presetId 缺失或非字符串 / presetVersionId 类型非法 → 结构错误阻断。
 * - 引用有效性（preset 是否存在）不在 core 校验，由后端解析时阻断。
 */

function narratorGraph(narratorConfig: unknown): NodeGraphDocument {
  return {
    schemaVersion: 2,
    graphId: 'g_preset_ref',
    name: 'Preset Ref Graph',
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
      { id: 'e_narrator_commit', kind: 'data', from: { nodeId: 'narrator',port: 'text' }, to: {nodeId: 'commit', port: 'text' } },
    ],
  } as unknown as NodeGraphDocument;
}

function presetRefDiagnostics(narratorConfig: unknown) {
  return validateNodeGraph(narratorGraph(narratorConfig)).diagnostics.filter(
    (diagnostic) => diagnostic.code ==='node_graph_narrator_preset_ref_invalid',
  );
}

describe('narration.narrator config.presetRef structure validation', () => {
  it('accepts an absent presetRef (recipe falls back to session preset)', () => {
  expect(presetRefDiagnostics(undefined)).toHaveLength(0);
    expect(presetRefDiagnostics({})).toHaveLength(0);
  });

  it('accepts astructurally valid presetRef', () => {
    expect(presetRefDiagnostics({ presetRef: { presetId: 'preset_x', presetVersionId: 'pv_1' }})).toHaveLength(0);
    expect(presetRefDiagnostics({ presetRef: { presetId: 'preset_x', presetVersionId: null } })).toHaveLength(0);
    expect(presetRefDiagnostics({ presetRef: { presetId: 'preset_x' } })).toHaveLength(0);
  });

  it('rejects a presetRef that is not an object', () => {
    expect(presetRefDiagnostics({ presetRef: 'preset_x' }).length).toBeGreaterThan(0);
    expect(presetRefDiagnostics({ presetRef: 123 }).length).toBeGreaterThan(0);
  });

  it('rejects a presetRef with a missing or non-string presetId', () => {
    expect(presetRefDiagnostics({ presetRef: {} }).length).toBeGreaterThan(0);
    expect(presetRefDiagnostics({ presetRef: { presetVersionId: 'pv_1' } }).length).toBeGreaterThan(0);
    expect(presetRefDiagnostics({ presetRef: { presetId: '' } }).length).toBeGreaterThan(0);
    expect(presetRefDiagnostics({ presetRef: { presetId: 42 } }).length).toBeGreaterThan(0);
  });

  it('rejects a presetRef whose presetVersionId is neither string nor null', () => {
    expect(
      presetRefDiagnostics({ presetRef: { presetId: 'preset_x', presetVersionId: 7 } }).length,
    ).toBeGreaterThan(0);
  });

  it('keeps the graph otherwise valid when presetRef is well-formed', () => {
    const result = validateNodeGraph(
      narratorGraph({ presetRef: { presetId: 'preset_x', presetVersionId: null } }),
    );
    expect(result.isValid).toBe(true);
  });

  it('marks the graph invalid when presetRef is malformed', () => {
    const result = validateNodeGraph(narratorGraph({ presetRef: { presetId: '' } }));
    expect(result.isValid).toBe(false);
  });
});
