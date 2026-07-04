import { describe, expect, it } from 'vitest';

import { createDefaultNodeTypeRegistry, NODE_GRAPH_BUILTIN_NODE_TYPES } from '../registry.js';
import {
  describeNodeTypeKnowledge,
  getNodeTypeCategoryLabel,
  listNodeTypeKnowledge,
} from '../node-type-knowledge.js';

const COMPLEX_NODE_TYPES = [
  'agent.call',
  'control.condition',
  'control.branch',
  'control.gate',
  'compose.template_render',
  'compose.text_to_block',
  'narration.narrator',
  'group.node',
  'output.commit_gate',
] as const;

describe('NodeGraph node type knowledge', () => {
  it('gives every built-in node a category, title, summary, usage, and port descriptions', () => {
    for (const entry of NODE_GRAPH_BUILTIN_NODE_TYPES) {
      expect(entry.title, entry.type).toBeTruthy();
      expect(entry.description, entry.type).toBeTruthy();
      expect(entry.knowledge?.category, entry.type).toBeTruthy();
      expect(entry.knowledge?.summary, entry.type).toBeTruthy();
      expect(entry.knowledge?.usage, entry.type).toBeTruthy();
      for (const port of [...entry.inputPorts, ...entry.outputPorts]) {
        expect(port.description, `${entry.type}.${port.name}`).toBeTruthy();
      }
    }
  });

  it('adds config knowledge and examples for the first complex node set', () => {
    const registry = createDefaultNodeTypeRegistry();
    for (const type of COMPLEX_NODE_TYPES) {
      const detail = describeNodeTypeKnowledge(type, '1', registry);
      expect(detail?.config?.mode, type).toBe('object');
      expect(detail?.config?.fields?.length, type).toBeGreaterThan(0);
      expect(detail?.examples?.length, type).toBeGreaterThan(0);
    }
  });

  it('returns a stable list view with concise summary fields', () => {
    const list = listNodeTypeKnowledge(createDefaultNodeTypeRegistry());
    expect(list.length).toBe(NODE_GRAPH_BUILTIN_NODE_TYPES.length);
    expect(list.map((item) => item.type)).toEqual([...list.map((item) => item.type)].sort());
    const userInput = list.find((item) => item.type === 'source.user_input');
    expect(userInput).toMatchObject({
      type: 'source.user_input',
      typeVersion: '1',
      category: 'source',
      summary: expect.stringContaining('user input'),
      outputPortNames: ['text'],
      sideEffects: 'none',
    });
  });

  it('describes a node type by version and keeps unknown nodes explicit', () => {
    const registry = createDefaultNodeTypeRegistry();
    const detail = describeNodeTypeKnowledge('agent.call', undefined, registry);
    expect(detail).toMatchObject({
      type: 'agent.call',
      category: 'agent',
      permissionsRequired: ['project.agent.run'],
      sideEffects: 'llm',
    });
    expect(detail?.config?.fields?.map((field) => field.path)).toContain('medium.kind');
    expect(describeNodeTypeKnowledge('missing.node', '1', registry)).toBeUndefined();
  });

  it('exposes category labels for browser and tooling callers', () => {
    expect(getNodeTypeCategoryLabel('control')).toBe('Control');
    expect(getNodeTypeCategoryLabel('annotation')).toBe('Annotation');
  });
});
