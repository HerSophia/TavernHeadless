import { describe, expect, it } from 'vitest';

import { TextProtocolToolCallParser } from '../../transport/index.js';

describe('TextProtocolToolCallParser', () => {
  it('parses accepted tool_call blocks and strips them from visible text', () => {
    const parser = new TextProtocolToolCallParser();
    const text = [
      'Before',
      '<tool_call id="call-1" name="roll_dice">',
      '{"args":{"sides":6}}',
      '</tool_call>',
      'After',
    ].join('\n');

    const result = parser.parse({
      modelOutputText: text,
      allowedToolNames: new Set(['roll_dice']),
    });

    expect(result.calls).toEqual([{ callId: 'call-1', toolName: 'roll_dice', args: { sides: 6 } }]);
    expect(result.diagnostics).toEqual([]);
    expect(result.stats).toEqual({ blockCount: 1, acceptedCount: 1, rejectedCount: 0 });
    expect(parser.stripToolCallBlocks(text)).not.toContain('<tool_call');
    expect(parser.stripToolCallBlocks(text)).toContain('Before');
    expect(parser.stripToolCallBlocks(text)).toContain('After');
  });

  it('assigns auto ids when id is missing', () => {
    const parser = new TextProtocolToolCallParser();
    const result = parser.parse({
      modelOutputText: '<tool_call name="get_variable">{"args":{"name":"hp"}}</tool_call>',
      allowedToolNames: new Set(['get_variable']),
    });

    expect(result.calls).toEqual([{ callId: 'auto_call_1', toolName: 'get_variable', args: { name: 'hp' } }]);
  });

  it('reports tool_not_registered, json_parse_failed, missing_args_field, duplicate_call_id, and malformed_block diagnostics', () => {
    const parser = new TextProtocolToolCallParser();
    const text = [
      '<tool_call id="dup" name="unknown_tool">{"args":{}}</tool_call>',
      '<tool_call id="dup" name="roll_dice">{"args":{"sides":6}}</tool_call>',
      '<tool_call id="bad-json" name="roll_dice">not-json</tool_call>',
      '<tool_call id="missing-args" name="roll_dice">{"value":1}</tool_call>',
      '<tool_call id="outer" name="roll_dice"><tool_call name="inner">{"args":{}}</tool_call></tool_call>',
    ].join('\n');

    const result = parser.parse({
      modelOutputText: text,
      allowedToolNames: new Set(['roll_dice']),
    });

    expect(result.calls).toEqual([]);
    expect(result.stats.blockCount).toBe(5);
    expect(result.stats.acceptedCount).toBe(0);
    expect(result.stats.rejectedCount).toBe(5);
    expect(result.diagnostics.map((item) => item.reason)).toEqual([
      'tool_not_registered',
      'duplicate_call_id',
      'json_parse_failed',
      'missing_args_field',
      'malformed_block',
    ]);
  });
});
