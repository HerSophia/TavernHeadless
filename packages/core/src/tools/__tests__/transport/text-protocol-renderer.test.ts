import { describe, expect, it } from 'vitest';

import type { ToolDefinition } from '../../types.js';
import { TextProtocolToolListRenderer } from '../../transport/index.js';

function makeTool(name: string, description: string): ToolDefinition {
  return {
    name,
    description,
    parameters: {
      type: 'object',
      properties: {
        value: { type: 'string' },
      },
      required: ['value'],
    },
    sideEffectLevel: 'none',
    allowedSlots: [],
    source: 'builtin',
  };
}

describe('TextProtocolToolListRenderer', () => {
  it('returns an empty block for an empty tool list', () => {
    const renderer = new TextProtocolToolListRenderer();

    expect(renderer.render({ tools: [] })).toEqual({
      content: '',
      renderedToolNames: [],
    });
  });

  it('renders a stable tool_list block', () => {
    const renderer = new TextProtocolToolListRenderer();
    const result = renderer.render({ tools: [makeTool('roll_dice', 'Roll a dice')] });

    expect(result.renderedToolNames).toEqual(['roll_dice']);
    expect(result.content).toContain('<tool_list>');
    expect(result.content).toContain('<tool name="roll_dice">');
    expect(result.content).toContain('"description": "Roll a dice"');
    expect(result.content.indexOf('"description"')).toBeLessThan(result.content.indexOf('"parameters"'));
    expect(result.content).toContain('</tool_list>');
  });

  it('preserves input order for multiple tools', () => {
    const renderer = new TextProtocolToolListRenderer();
    const result = renderer.render({
      tools: [
        makeTool('alpha', 'Alpha tool'),
        makeTool('beta', 'Beta tool'),
      ],
    });

    expect(result.renderedToolNames).toEqual(['alpha', 'beta']);
    expect(result.content.indexOf('name="alpha"')).toBeLessThan(result.content.indexOf('name="beta"'));
  });
});
