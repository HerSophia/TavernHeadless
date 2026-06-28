import { describe, expect, it } from 'vitest';

import { compileNodeGraph } from '../compiler.js';
import { validateNodeGraph } from '../validator.js';
import {
  NATIVE_PROMPT_FLOOR_TEMPLATE_ID,
  NATIVE_PROMPT_FLOOR_TEMPLATE_VERSION,
  buildNativePromptFloorStructure,
  buildNativePromptFloorTemplate,
} from '../templates/native-prompt-floor.js';

describe('DG11 native prompt floor template', () => {
  it('builds a forkable, non-system v2 document', () => {
    const doc = buildNativePromptFloorTemplate();
    expect(doc.schemaVersion).toBe(2);
    expect(doc.graphId).toBe(NATIVE_PROMPT_FLOOR_TEMPLATE_ID);
    expect(doc.mode).toBe('native_graph');
    // 模板不是系统图：不进入 system graph 严格校验，可被普通保存 / fork。
    expect(doc.metadata?.systemGraph).toBe(false);
    expect(doc.metadata?.template).toBe('native_prompt_floor');
    expect(doc.metadata?.templateVersion).toBe(NATIVE_PROMPT_FLOOR_TEMPLATE_VERSION);
  });

  it('compiles to an executable graph with no error diagnostics', () => {
    const compiled = compileNodeGraph(buildNativePromptFloorTemplate());
    expect(compiled.isExecutable).toBe(true);
    expect(compiled.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
  });

  it('keeps Narrator / CommitGate / compose unique (single-canon boundary)', () => {
    const result = validateNodeGraph(buildNativePromptFloorTemplate());
    expect(result.isValid).toBe(true);
    const nodes = [...result.nodesById.values()];
    expect(nodes.filter((n) => n.type === 'narration.narrator')).toHaveLength(1);
    expect(nodes.filter((n) => n.type === 'output.commit_gate')).toHaveLength(1);
    expect(nodes.filter((n) => n.type === 'compose.final_messages')).toHaveLength(1);
  });

  it('returns a fresh structure object on every call (no shared mutable reference)', () => {
    const a = buildNativePromptFloorStructure();
    const b = buildNativePromptFloorStructure();
    expect(a).not.toBe(b);
    expect(a.nodes).not.toBe(b.nodes);
    a.nodes.push({ id: 'x', type: 'source.persona', typeVersion: '1', phase: 'pre_response' });
    expect(b.nodes).toHaveLength(7);
  });

  it('the template structure equals the shared floor structure (single source of truth)', () => {
    const structure = buildNativePromptFloorStructure();
    const template = buildNativePromptFloorTemplate();
    expect(template.nodes).toEqual(structure.nodes);
    expect(template.edges).toEqual(structure.edges);
    expect(template.permissions).toEqual(structure.permissions);
    expect(template.policies).toEqual(structure.policies);
  });
});
