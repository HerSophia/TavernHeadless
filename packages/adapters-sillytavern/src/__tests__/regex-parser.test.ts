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

  it('filters markdownOnly scripts', () => {
    const json = [
      {
        id: 'r1',
        findRegex: '/test/g',
        placement: [2],
        markdownOnly: true,
      },
      {
        id: 'r2',
        findRegex: '/test2/g',
        placement: [2],
        markdownOnly: false,
      },
    ];

    const result = parseRegexScripts(json);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('r2');
  });

  it('removes MD_DISPLAY(0) and SLASH_COMMAND(3) from placement', () => {
    const json = [
      {
        id: 'r1',
        findRegex: '/test/g',
        placement: [0, 1, 2, 3, 5],
      },
    ];

    const result = parseRegexScripts(json);
    expect(result[0]!.placement).toEqual([1, 2, 5]);
  });

  it('filters scripts with no valid placement after cleaning', () => {
    const json = [
      {
        id: 'r1',
        findRegex: '/test/g',
        placement: [0, 3], // only MD_DISPLAY and SLASH_COMMAND
      },
    ];

    const result = parseRegexScripts(json);
    expect(result).toHaveLength(0);
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
    expect(result[0]!.substituteRegex).toBe(0);
    expect(result[0]!.minDepth).toBe(0);
    expect(result[0]!.maxDepth).toBe(0);
  });

  it('parses empty array', () => {
    expect(parseRegexScripts([])).toEqual([]);
  });

  it('throws on invalid input', () => {
    expect(() => parseRegexScripts('not an array')).toThrow();
    expect(() => parseRegexScripts({ notArray: true })).toThrow();
  });
});
