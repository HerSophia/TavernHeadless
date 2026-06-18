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

  it('rejects tool_call blocks that miss a call id or tool name', () => {
    const parser = new TextProtocolToolCallParser();
    const text = [
      '<tool_call name="get_variable">{"args":{"name":"hp"}}</tool_call>',
      '<tool_call id="missing-name">{"args":{"name":"hp"}}</tool_call>',
    ].join('\n');

    const result = parser.parse({
      modelOutputText: text,
      allowedToolNames: new Set(['get_variable']),
    });

    expect(result.calls).toEqual([]);
    expect(result.stats).toEqual({ blockCount: 2, acceptedCount: 0, rejectedCount: 2 });
    expect(result.diagnostics.map((item) => item.reason)).toEqual([
      'missing_call_id',
      'missing_tool_name',
    ]);
  });

  it('reports tool_not_registered, json_parse_failed, missing_args_field, and malformed_block diagnostics', () => {
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

    expect(result.calls).toEqual([{ callId: 'dup', toolName: 'roll_dice', args: { sides: 6 } }]);
    expect(result.stats.blockCount).toBe(5);
    expect(result.stats.acceptedCount).toBe(1);
    expect(result.stats.rejectedCount).toBe(4);
    expect(result.diagnostics.map((item) => item.reason)).toEqual([
      'tool_not_registered',
      'json_parse_failed',
      'missing_args_field',
      'malformed_block',
    ]);
  });

  it('reports duplicate ids after the first accepted call id', () => {
    const parser = new TextProtocolToolCallParser();
    const text = [
      '<tool_call id="dup" name="roll_dice">{"args":{"sides":6}}</tool_call>',
      '<tool_call id="dup" name="roll_dice">{"args":{"sides":8}}</tool_call>',
    ].join('\n');

    const result = parser.parse({
      modelOutputText: text,
      allowedToolNames: new Set(['roll_dice']),
    });

    expect(result.calls).toEqual([{ callId: 'dup', toolName: 'roll_dice', args: { sides: 6 } }]);
    expect(result.diagnostics.map((item) => item.reason)).toEqual(['duplicate_call_id']);
  });

  it('only counts accepted calls when checking duplicate ids', () => {
    const parser = new TextProtocolToolCallParser();
    const text = [
      '<tool_call id="dup" name="unknown_tool">{"args":{}}</tool_call>',
      '<tool_call id="dup" name="roll_dice">{"args":{"sides":6}}</tool_call>',
    ].join('\n');

    const result = parser.parse({
      modelOutputText: text,
      allowedToolNames: new Set(['roll_dice']),
    });

    expect(result.calls).toEqual([{ callId: 'dup', toolName: 'roll_dice', args: { sides: 6 } }]);
    expect(result.diagnostics.map((item) => item.reason)).toEqual(['tool_not_registered']);
  });

  it('rejects unknown tools before parsing their JSON payload', () => {
    const parser = new TextProtocolToolCallParser();
    const result = parser.parse({
      modelOutputText: '<tool_call id="unknown" name="unknown_tool">not-json</tool_call>',
      allowedToolNames: new Set(['roll_dice']),
    });

    expect(result.calls).toEqual([]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        callId: 'unknown',
        toolName: 'unknown_tool',
        reason: 'tool_not_registered',
      }),
    ]);
  });

  it('rejects malformed attributes and invalid tool names before execution', () => {
    const parser = new TextProtocolToolCallParser();
    const text = [
      '<tool_call ID="bad" name="roll_dice">{"args":{"sides":6}}</tool_call>',
      '<tool_call id="bad-name" name="../roll_dice">{"args":{"sides":6}}</tool_call>',
      '<tool_call id="duplicate" id="again" name="roll_dice">{"args":{"sides":6}}</tool_call>',
    ].join('\n');

    const result = parser.parse({
      modelOutputText: text,
      allowedToolNames: new Set(['roll_dice']),
    });

    expect(result.calls).toEqual([]);
    expect(result.diagnostics.map((item) => item.reason)).toEqual([
      'malformed_attributes',
      'invalid_tool_name',
      'malformed_attributes',
    ]);
  });

  it('does not recognize near-match or case-variant tool_call tags', () => {
    const parser = new TextProtocolToolCallParser();
    const text = [
      '<Tool_Call id="upper" name="roll_dice">{"args":{"sides":6}}</Tool_Call>',
      '<tool-call id="dash" name="roll_dice">{"args":{"sides":6}}</tool-call>',
      '<tool_callx id="suffix" name="roll_dice">{"args":{"sides":6}}</tool_callx>',
    ].join('\n');

    const result = parser.parse({
      modelOutputText: text,
      allowedToolNames: new Set(['roll_dice']),
    });

    expect(result.stats).toEqual({ blockCount: 0, acceptedCount: 0, rejectedCount: 0 });
    expect(result.calls).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    expect(parser.stripToolCallBlocks(text)).toContain('<Tool_Call');
    expect(parser.stripToolCallBlocks(text)).toContain('<tool-call');
    expect(parser.stripToolCallBlocks(text)).toContain('<tool_callx');
  });
});
