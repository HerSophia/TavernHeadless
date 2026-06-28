import { describe, expect, it } from 'vitest';

import { compileNodeGraph } from '../compiler.js';
import { deriveSubgraphInterface } from '../subgraph.js';
import type { NodeGraphDocument } from '../types.js';
import {
  BUILTIN_ADVISOR_SUBGRAPH_VERSION,
  CONTINUITY_VERIFIER_SUBGRAPH_ID,
  DIRECTOR_ADVISOR_SUBGRAPH_ID,
  MEMORY_RETRIEVE_SUBGRAPH_ID,
  PLAYER_AGENCY_VERIFIER_SUBGRAPH_ID,
  buildContinuityVerifierSubgraph,
  buildDirectorAdvisorSubgraph,
  buildMemoryRetrieveSubgraph,
  buildPlayerAgencyVerifierSubgraph,
  listBuiltinAdvisorSubgraphs,
} from '../templates/builtin-advisor-subgraphs.js';

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
    expect(iface.inputs).toEqual([{ name: 'messages', type: 'messages' }]);
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

  it('verifier subgraphs: text/context -> result, no extra permission', () => {
    for (const doc of [buildContinuityVerifierSubgraph(), buildPlayerAgencyVerifierSubgraph()] as NodeGraphDocument[]) {
      const iface = deriveSubgraphInterface(doc);
      expect(iface.inputs).toEqual([
        { name: 'text', type: 'text' },
        { name: 'context', type: 'json' },
      ]);
      expect(iface.outputs).toEqual([{ name: 'result', type: 'verifier_result' }]);
      expect(doc.permissions?.required).toEqual([]);
    }
  });
});
