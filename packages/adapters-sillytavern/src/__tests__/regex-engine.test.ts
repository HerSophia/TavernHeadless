import { describe, it, expect } from 'vitest';
import { applyRegexScripts } from '../regex/regex-engine.js';
import type { STRegexScript } from '../types/regex.js';
import { REGEX_PLACEMENT, SUBSTITUTE_REGEX } from '../types/regex.js';

/** Helper to create a minimal regex script */
function makeScript(overrides: Partial<STRegexScript> & { findRegex: string }): STRegexScript {
  return {
    id: 'test',
    scriptName: 'Test Script',
    replaceString: '',
    trimStrings: [],
    placement: [REGEX_PLACEMENT.AI_OUTPUT],
    disabled: false,
    substituteRegex: SUBSTITUTE_REGEX.NONE,
    minDepth: 0,
    maxDepth: 0,
    ...overrides,
  };
}

describe('applyRegexScripts', () => {
  describe('basic replacement', () => {
    it('replaces matched text', () => {
      const script = makeScript({
        findRegex: '/hello/gi',
        replaceString: 'world',
      });

      const result = applyRegexScripts('Hello there, hello!', [script], REGEX_PLACEMENT.AI_OUTPUT);
      expect(result).toBe('world there, world!');
    });

    it('handles no match gracefully', () => {
      const script = makeScript({
        findRegex: '/xyz/g',
        replaceString: 'abc',
      });

      const result = applyRegexScripts('hello world', [script], REGEX_PLACEMENT.AI_OUTPUT);
      expect(result).toBe('hello world');
    });

    it('removes matched text when replaceString is empty', () => {
      const script = makeScript({
        findRegex: '/\\(OOC:.*?\\)/gi',
        replaceString: '',
      });

      const result = applyRegexScripts('Text (OOC: out of character) more text', [script], REGEX_PLACEMENT.AI_OUTPUT);
      expect(result).toBe('Text  more text');
    });
  });

  describe('capture groups', () => {
    it('supports $1 capture group', () => {
      const script = makeScript({
        findRegex: '/(\\w+) (\\w+)/g',
        replaceString: '$2 $1',
      });

      const result = applyRegexScripts('hello world', [script], REGEX_PLACEMENT.AI_OUTPUT);
      expect(result).toBe('world hello');
    });
  });

  describe('plain string regex', () => {
    it('treats non-slash string as global regex', () => {
      const script = makeScript({
        findRegex: 'hello',
        replaceString: 'hi',
      });

      const result = applyRegexScripts('hello hello', [script], REGEX_PLACEMENT.AI_OUTPUT);
      expect(result).toBe('hi hi');
    });
  });

  describe('trimStrings', () => {
    it('removes trim strings from result', () => {
      const script = makeScript({
        findRegex: '/$/g', // match end (effectively a no-op replace)
        replaceString: '',
        trimStrings: ['OOC'],
      });

      const result = applyRegexScripts('This is OOC text with OOC', [script], REGEX_PLACEMENT.AI_OUTPUT);
      expect(result).toBe('This is  text with ');
    });
  });

  describe('placement filtering', () => {
    it('only applies scripts matching the placement', () => {
      const script = makeScript({
        findRegex: '/hello/g',
        replaceString: 'world',
        placement: [REGEX_PLACEMENT.USER_INPUT],
      });

      // Apply with AI_OUTPUT → should not match
      const result = applyRegexScripts('hello', [script], REGEX_PLACEMENT.AI_OUTPUT);
      expect(result).toBe('hello');
    });

    it('applies script when placement matches', () => {
      const script = makeScript({
        findRegex: '/hello/g',
        replaceString: 'world',
        placement: [REGEX_PLACEMENT.USER_INPUT, REGEX_PLACEMENT.AI_OUTPUT],
      });

      const result = applyRegexScripts('hello', [script], REGEX_PLACEMENT.AI_OUTPUT);
      expect(result).toBe('world');
    });
  });

  describe('disabled filtering', () => {
    it('skips disabled scripts', () => {
      const script = makeScript({
        findRegex: '/hello/g',
        replaceString: 'world',
        disabled: true,
      });

      const result = applyRegexScripts('hello', [script], REGEX_PLACEMENT.AI_OUTPUT);
      expect(result).toBe('hello');
    });
  });

  describe('chain execution', () => {
    it('applies multiple scripts in order', () => {
      const scripts = [
        makeScript({ findRegex: '/a/g', replaceString: 'b' }),
        makeScript({ findRegex: '/b/g', replaceString: 'c' }),
      ];

      const result = applyRegexScripts('aaa', scripts, REGEX_PLACEMENT.AI_OUTPUT);
      // First: aaa → bbb, then: bbb → ccc
      expect(result).toBe('ccc');
    });
  });

  describe('substituteRegex', () => {
    it('RAW mode substitutes macros in findRegex', () => {
      const script = makeScript({
        findRegex: '/{{char}}/g',
        replaceString: 'NAME',
        substituteRegex: SUBSTITUTE_REGEX.RAW,
      });

      const context = {
        substituteParams: (text: string) => text.replace('{{char}}', 'Alice'),
      };

      const result = applyRegexScripts('Alice is here', [script], REGEX_PLACEMENT.AI_OUTPUT, context);
      expect(result).toBe('NAME is here');
    });

    it('ESCAPED mode escapes substituted values', () => {
      const script = makeScript({
        findRegex: '/{{char}}/g',
        replaceString: 'NAME',
        substituteRegex: SUBSTITUTE_REGEX.ESCAPED,
      });

      const context = {
        substituteParams: (text: string) => text.replace('{{char}}', 'Alice (the great)'),
      };

      // "Alice (the great)" with escaped parens should match literal
      const result = applyRegexScripts('Alice (the great) is here', [script], REGEX_PLACEMENT.AI_OUTPUT, context);
      expect(result).toBe('NAME is here');
    });

    it('NONE mode does not substitute', () => {
      const script = makeScript({
        findRegex: '/{{char}}/g',
        replaceString: 'NAME',
        substituteRegex: SUBSTITUTE_REGEX.NONE,
      });

      const context = {
        substituteParams: (text: string) => text.replace('{{char}}', 'Alice'),
      };

      // Should try to match literal "{{char}}" which is not in text
      const result = applyRegexScripts('Alice is here', [script], REGEX_PLACEMENT.AI_OUTPUT, context);
      expect(result).toBe('Alice is here');
    });
  });

  describe('edge cases', () => {
    it('handles empty text', () => {
      const script = makeScript({ findRegex: '/hello/g', replaceString: 'world' });
      expect(applyRegexScripts('', [script], REGEX_PLACEMENT.AI_OUTPUT)).toBe('');
    });

    it('handles empty scripts array', () => {
      expect(applyRegexScripts('hello', [], REGEX_PLACEMENT.AI_OUTPUT)).toBe('hello');
    });

    it('handles invalid regex gracefully', () => {
      const script = makeScript({ findRegex: '/[invalid/g' });
      // Should skip the invalid regex and return original text
      expect(applyRegexScripts('hello', [script], REGEX_PLACEMENT.AI_OUTPUT)).toBe('hello');
    });
  });
});
