import { describe, expect, it } from 'vitest';

import { compileNodeGraph } from '../compiler.js';
import { deriveSubgraphInterface } from '../subgraph.js';
import type { NodeGraphDocument } from '../types.js';
import {
 BUILTIN_ADVISOR_SUBGRAPH_IDS,
  BUILTIN_ADVISOR_SUBGRAPH_VERSION,
  CONTINUITY_VERIFIER_SUBGRAPH_ID,
  DIRECTOR_ADVISOR_SUBGRAPH_ID,
  MEMORY_RETRIEVE_SUBGRAPH_ID,
  NATIVE_PROMPT_FLOOR_SUBGRAPH_REF_TEMPLATE_ID,
  PLAYER_AGENCY_VERIFIER_SUBGRAPH_ID,
  buildContinuityVerifierSubgraph,
  buildDirectorAdvisorSubgraph,
  buildMemoryRetrieveSubgraph,
  buildNativePromptFloorTemplateWithAdvisorRefs,
  buildPlayerAgencyVerifierSubgraph,
  getBuiltinAdvisorSubgraphById,
  isBuiltinAdvisorSubgraphId,
listBuiltinAdvisorSubgraphs,
} from '../templates/builtin-advisor-subgraphs.js';
import { readGroupNodeRef } from '../subgraph.js';

const FORBIDDEN_CANON_TYPES = ['narration.narrator', 'output.commit_gate'];

describe('SG11 built-in advisor subgraphs', () => {
  it('lists all four advisor subgraphs with stable ids', () => {
    const all = listBuiltinAdvisorSubgraphs();
    expect(all.map((g) => g.graphId)).toEqual([
      DIRECTOR_ADVISOR_SUBGRAPH_ID,
      CONTINUITY_VERIFIER_SUBGRAPH_ID,
      PLAYER_AGENCY_VERIFIER_SUBGRAPH_ID,
      MEMORY_RETRIEVE_SUBGRAPH_ID,
    ]);
  });

  for (const build of [
    buildDirectorAdvisorSubgraph,
    buildContinuityVerifierSubgraph,
    buildPlayerAgencyVerifierSubgraph,
    buildMemoryRetrieveSubgraph,
  ]) {
    const doc = build();
    describe(doc.graphId, () => {
      it('is marked as a built-in subgraph (v2)', () => {
        expect(doc.schemaVersion).toBe(2);
        expect(doc.metadata?.subgraph).toBe(true);
        expect(typeof doc.metadata?.builtin).toBe('string');
        expect(doc.metadata?.builtinVersion).toBe(BUILTIN_ADVISOR_SUBGRAPH_VERSION);
      });

      it('compiles to an executable graph with no error diagnostics', () => {
        const compiled = compileNodeGraph(doc);
        expect(compiled.isExecutable).toBe(true);
        expect(compiled.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
      });

      it('exposes a non-empty boundary interface (group.input / group.output)', () => {
        const iface = deriveSubgraphInterface(doc);
        expect(iface.inputs.length).toBeGreaterThan(0);
        expect(iface.outputs.length).toBeGreaterThan(0);
      });

      it('is advisory only: never writes canon (no narrator / commit_gate / persistent output)', () => {
        for (const node of doc.nodes) {
          expect(FORBIDDEN_CANON_TYPES).not.toContain(node.type);
          expect(node.type.startsWith('output.')).toBe(false);
        }
      });
    });
  }

  it('director subgraph: messages -> brief, requires project.agent.run', () => {
    const doc = buildDirectorAdvisorSubgraph();
    const iface = deriveSubgraphInterface(doc);
    expect(iface.inputs).toEqual([
      { name: 'messages', type: 'messages' },
      { name: 'user_input', type: 'text' },
    ]);
    expect(iface.outputs).toEqual([{ name: 'brief', type: 'agent_brief' }]);
    expect(doc.permissions?.required).toEqual(['project.agent.run']);
  });

  it('memory subgraph: query -> selection, requires project.memory.read', () => {
    const doc = buildMemoryRetrieveSubgraph();
    const iface = deriveSubgraphInterface(doc);
    expect(iface.inputs).toEqual([{ name: 'query', type: 'text' }]);
    expect(iface.outputs).toEqual([{ name: 'selection', type: 'memory_selection' }]);
    expect(doc.permissions?.required).toEqual(['project.memory.read']);
  });

  it('verifier subgraphs: text/context -> result, no extra permission', () =>{
    for (const doc of [buildContinuityVerifierSubgraph(), buildPlayerAgencyVerifierSubgraph()] as NodeGraphDocument[]) {
      const iface = deriveSubgraphInterface(doc);
      if (doc.graphId === PLAYER_AGENCY_VERIFIER_SUBGRAPH_ID) {
        expect(iface.inputs).toEqual([
          { name: 'text', type: 'text' },
          { name: 'context', type: 'json' },
          { name: 'user_input', type: 'text' },
        ]);
      } else {
        expect(iface.inputs).toEqual([
          { name: 'text', type: 'text' },
          { name: 'context', type: 'json' },
        ]);
      }
      expect(iface.outputs).toEqual([{ name: 'result', type: 'verifier_result' }]);
      expect(doc.permissions?.required).toEqual([]);
    }
  });
});

describe('SG11-3 built-in subgraph reference resolution', () => {
  it('recognizes only the four system.subgraph.* ids as built-in', () => {
    expect(BUILTIN_ADVISOR_SUBGRAPH_IDS).toEqual([
      DIRECTOR_ADVISOR_SUBGRAPH_ID,
      CONTINUITY_VERIFIER_SUBGRAPH_ID,
      PLAYER_AGENCY_VERIFIER_SUBGRAPH_ID,
      MEMORY_RETRIEVE_SUBGRAPH_ID,
    ]);
    for (const id of BUILTIN_ADVISOR_SUBGRAPH_IDS) {
      expect(isBuiltinAdvisorSubgraphId(id)).toBe(true);
    }
    expect(isBuiltinAdvisorSubgraphId('some.user.graph')).toBe(false);
    expect(isBuiltinAdvisorSubgraphId('system.native_prompt')).toBe(false);
  });

  it('resolves each built-in id back to its definition; unknown id returns null', () => {
    for (const id of BUILTIN_ADVISOR_SUBGRAPH_IDS) {
      const resolved = getBuiltinAdvisorSubgraphById(id);
      expect(resolved?.graphId).toBe(id);
      expect(resolved?.metadata?.subgraph).toBe(true);
    }
    expect(getBuiltinAdvisorSubgraphById('not.a.builtin')).toBeNull();
  });
});

describe('SG11-3 referenced default floor template', () => {
  const template = buildNativePromptFloorTemplateWithAdvisorRefs();

  it('is a forkable v2 template (not a system graph)', () => {
    expect(template.schemaVersion).toBe(2);
    expect(template.graphId).toBe(NATIVE_PROMPT_FLOOR_SUBGRAPH_REF_TEMPLATE_ID);
    expect(template.metadata?.systemGraph).toBe(false);
  });

  it('replaces director / verify single nodes with group.node references to built-in subgraphs', () => {
    const director = template.nodes.find((node) => node.id === 'director');
    const verify = template.nodes.find((node) => node.id === 'verify');
    expect(director?.type).toBe('group.node');
    expect(verify?.type).toBe('group.node');
    expect(readGroupNodeRef(director!)?.graphId).toBe(DIRECTOR_ADVISOR_SUBGRAPH_ID);
    expect(readGroupNodeRef(verify!)?.graphId).toBe(CONTINUITY_VERIFIER_SUBGRAPH_ID);
  });

  it('keeps the canon backbone (narrator / commit_gate) as single nodes', () => {
    expect(template.nodes.some((node) => node.type === 'narration.narrator')).toBe(true);
    expect(template.nodes.some((node) => node.type === 'output.commit_gate')).toBe(true);
  });

  it('rolls up the director permission into the parent manifest', () => {
    expect(template.permissions?.required).toContain('project.agent.run');
  });

  it('compiles to an executable graph with no error diagnostics', () => {
    const compiled = compileNodeGraph(template);
    expect(compiled.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    expect(compiled.isExecutable).toBe(true);
  });
});
