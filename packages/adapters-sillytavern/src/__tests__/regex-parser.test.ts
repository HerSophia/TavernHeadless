import { describe, it, expect } from 'vitest';
import { parseRegexScripts } from '../parsers/regex-parser.js';

describe('parseRegexScripts', () => {
  it('parses valid regex scripts', () => {
    const json = [
      {
        id: 'r1',
        scriptName: 'Remove OOC',
        findRegex: '/\\(OOC:.*?\\)/gi',
        replaceString: '',
        trimStrings: [],
        placement: [2], // AI_OUTPUT
        disabled: false,
        substituteRegex: 0,
        minDepth: 0,
        maxDepth: 0,
      },
    ];

    const result = parseRegexScripts(json);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('r1');
    expect(result[0]!.scriptName).toBe('Remove OOC');
    expect(result[0]!.placement).toEqual([2]);
  });

  it('preserves markdownOnly scripts for compatibility', () => {
    const json = [
      {
        id: 'r1',
        findRegex: '/test/g',
        placement: [2],
        markdownOnly: true,
      },
    ];

    const result = parseRegexScripts(json);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('r1');
    expect(result[0]!.markdownOnly).toBe(true);
  });

  it('preserves placement values including MD_DISPLAY, SLASH_COMMAND and REASONING', () => {
    const json = [
      {
        id: 'r1',
        findRegex: '/test/g',
        placement: [0, 1, 2, 3, 5, 6],
      },
    ];

    const result = parseRegexScripts(json);
    expect(result[0]!.placement).toEqual([0, 1, 2, 3, 5, 6]);
  });

  it('preserves scripts with currently unsupported placements', () => {
    const json = [
      {
        id: 'r1',
        findRegex: '/test/g',
        placement: [0, 3],
      },
    ];

    const result = parseRegexScripts(json);
    expect(result).toHaveLength(1);
    expect(result[0]!.placement).toEqual([0, 3]);
  });

  it('fills default values for missing fields', () => {
    const json = [
      {
        findRegex: '/hello/g',
        placement: [1],
      },
    ];

    const result = parseRegexScripts(json);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('');
    expect(result[0]!.scriptName).toBe('');
    expect(result[0]!.replaceString).toBe('');
    expect(result[0]!.trimStrings).toEqual([]);
    expect(result[0]!.disabled).toBe(false);
    expect(result[0]!.markdownOnly).toBe(false);
    expect(result[0]!.promptOnly).toBe(false);
    expect(result[0]!.runOnEdit).toBe(false);
    expect(result[0]!.substituteRegex).toBe(0);
    expect(result[0]!.minDepth).toBe(0);
    expect(result[0]!.maxDepth).toBe(0);
  });

  it('preserves promptOnly and runOnEdit flags', () => {
    const json = [
      {
        id: 'r1',
        findRegex: '/hello/g',
        placement: [1, 6],
        promptOnly: true,
        runOnEdit: true,
      },
    ];

    const [script] = parseRegexScripts(json);
    expect(script).toBeDefined();
    expect(script!.promptOnly).toBe(true);
    expect(script!.runOnEdit).toBe(true);
  });

  it('parses empty array', () => {
    expect(parseRegexScripts([])).toEqual([]);
  });

  it('throws on invalid input', () => {
    expect(() => parseRegexScripts('not an array')).toThrow();
    expect(() => parseRegexScripts({ notArray: true })).toThrow();
  });
});
