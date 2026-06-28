import { describe, expect, it } from 'vitest';

import { compileNodeGraph } from '../compiler.js';
import { validateNodeGraph } from '../validator.js';
import {
  COMPAT_PROMPT_FLOOR_TEMPLATE_ID,
  COMPAT_PROMPT_FLOOR_TEMPLATE_VERSION,
  buildCompatPromptFloorStructure,
  buildCompatPromptFloorTemplate,
} from '../templates/compat-prompt-floor.js';

describe('CG11 compat prompt floor template', () => {
  it('builds a forkable, non-system v2 document', () => {
    const doc = buildCompatPromptFloorTemplate();
    expect(doc.schemaVersion).toBe(2);
    expect(doc.graphId).toBe(COMPAT_PROMPT_FLOOR_TEMPLATE_ID);
    expect(doc.mode).toBe('native_graph');
    expect(doc.metadata?.systemGraph).toBe(false);
    expect(doc.metadata?.template).toBe('compat_prompt_floor');
    expect(doc.metadata?.templateVersion).toBe(COMPAT_PROMPT_FLOOR_TEMPLATE_VERSION);
  });

  it('compiles to an executable graph with no error diagnostics', () => {
    const compiled = compileNodeGraph(buildCompatPromptFloorTemplate());
    expect(compiled.isExecutable).toBe(true);
    expect(compiled.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
  });

  it('keeps Narrator / CommitGate / compose unique (single-canon boundary)', () => {
    const result = validateNodeGraph(buildCompatPromptFloorTemplate());
    expect(result.isValid).toBe(true);
    const nodes = [...result.nodesById.values()];
    expect(nodes.filter((n) => n.type === 'narration.narrator')).toHaveLength(1);
    expect(nodes.filter((n) => n.type === 'output.commit_gate')).toHaveLength(1);
    expect(nodes.filter((n) => n.type === 'compose.final_messages')).toHaveLength(1);
  });

  it('is zero-agentic: no agent.* or verify.* decision nodes, no agent permission', () => {
    const structure = buildCompatPromptFloorStructure();
    expect(structure.nodes.some((n) => n.type.startsWith('agent.'))).toBe(false);
    expect(structure.nodes.some((n) => n.type.startsWith('verify.'))).toBe(false);
    expect(structure.permissions.required ?? []).not.toContain('project.agent.run');
  });

  it('the template structure equals the shared compat floor structure (single source of truth)', () => {
    const structure = buildCompatPromptFloorStructure();
    const template = buildCompatPromptFloorTemplate();
    expect(template.nodes).toEqual(structure.nodes);
    expect(template.edges).toEqual(structure.edges);
    expect(template.permissions).toEqual(structure.permissions);
    expect(template.policies).toEqual(structure.policies);
  });
});
