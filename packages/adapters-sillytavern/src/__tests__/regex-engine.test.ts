import { describe, it, expect } from 'vitest';
import { applyRegexScripts, applyRegexScriptsWithTrace } from '../regex/regex-engine.js';
import type { RegexContext } from '../regex/regex-engine.js';
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
    markdownOnly: false,
    promptOnly: false,
    runOnEdit: false,
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

  describe('capture groups and match macros', () => {
    it('supports numbered capture groups', () => {
      const script = makeScript({
        findRegex: '/(\\w+) (\\w+)/g',
        replaceString: '$2 $1',
      });

      const result = applyRegexScripts('hello world', [script], REGEX_PLACEMENT.AI_OUTPUT);
      expect(result).toBe('world hello');
    });

    it('supports named capture groups', () => {
      const script = makeScript({
        findRegex: '/(?<first>\\w+) (?<second>\\w+)/g',
        replaceString: '$<second> $<first>',
      });

      const result = applyRegexScripts('hello world', [script], REGEX_PLACEMENT.AI_OUTPUT);
      expect(result).toBe('world hello');
    });

    it('supports {{match}} in replacement text', () => {
      const script = makeScript({
        findRegex: '/hello/g',
        replaceString: '**{{match}}**',
      });

      const result = applyRegexScripts('hello hello', [script], REGEX_PLACEMENT.AI_OUTPUT);
      expect(result).toBe('**hello** **hello**');
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
    it('applies trimStrings to inserted replacement tokens', () => {
      const script = makeScript({
        findRegex: '/(keep) (OOC)/g',
        replaceString: '$1 + $2',
        trimStrings: ['OOC'],
      });

      const result = applyRegexScripts('keep OOC and OOC stays', [script], REGEX_PLACEMENT.AI_OUTPUT);
      expect(result).toBe('keep +  and OOC stays');
    });

    it('does not trim unrelated text outside replacement tokens', () => {
      const script = makeScript({
        findRegex: '/value/g',
        replaceString: '[{{match}}]',
        trimStrings: ['value'],
      });

      const result = applyRegexScripts('prefix value suffix and value outside', [script], REGEX_PLACEMENT.AI_OUTPUT);
      expect(result).toBe('prefix [] suffix and [] outside');
    });
  });

  describe('placement filtering', () => {
    it('only applies scripts matching the placement', () => {
      const script = makeScript({
        findRegex: '/hello/g',
        replaceString: 'world',
        placement: [REGEX_PLACEMENT.USER_INPUT],
      });

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

  describe('channel filtering', () => {
    it('only applies promptOnly scripts in prompt channel', () => {
      const script = makeScript({
        findRegex: '/hello/g',
        replaceString: 'world',
        promptOnly: true,
      });

      expect(applyRegexScripts('hello', [script], REGEX_PLACEMENT.AI_OUTPUT)).toBe('hello');
      expect(applyRegexScripts('hello', [script], REGEX_PLACEMENT.AI_OUTPUT, { channel: 'prompt' })).toBe('world');
    });

    it('only applies markdownOnly scripts in display channel', () => {
      const script = makeScript({
        findRegex: '/hello/g',
        replaceString: 'world',
        markdownOnly: true,
      });

      expect(applyRegexScripts('hello', [script], REGEX_PLACEMENT.AI_OUTPUT)).toBe('hello');
      expect(applyRegexScripts('hello', [script], REGEX_PLACEMENT.AI_OUTPUT, { channel: 'display' })).toBe('world');
    });

    it('requires runOnEdit for edit channel', () => {
      const baseScript = makeScript({
        findRegex: '/hello/g',
        replaceString: 'world',
      });

      expect(applyRegexScripts('hello', [baseScript], REGEX_PLACEMENT.AI_OUTPUT, { channel: 'edit' })).toBe('hello');
      expect(applyRegexScripts(
        'hello',
        [{ ...baseScript, runOnEdit: true }],
        REGEX_PLACEMENT.AI_OUTPUT,
        { channel: 'edit' },
      )).toBe('world');
    });

    it('returns rule-level trace with matched and skipped reasons', () => {
      const durableRule = makeScript({
        id: 'durable',
        scriptName: 'Durable Input',
        findRegex: '/hello/g',
        replaceString: 'world',
        placement: [REGEX_PLACEMENT.USER_INPUT],
      });
      const promptOnlyRule = makeScript({
        id: 'prompt-only',
        scriptName: 'Prompt Only Input',
        findRegex: '/world/g',
        replaceString: 'prompt',
        placement: [REGEX_PLACEMENT.USER_INPUT],
        promptOnly: true,
      });

      expect(applyRegexScriptsWithTrace('hello world', [durableRule, promptOnlyRule], REGEX_PLACEMENT.USER_INPUT, { channel: 'prompt' })).toEqual({
        text: 'hello prompt',
        candidateRuleNames: ['Durable Input', 'Prompt Only Input'],
        matchedRuleNames: ['Prompt Only Input'],
        skippedRules: [{ ruleName: 'Durable Input', reason: 'channel_filtered' }],
      });
    });
  });

  describe('depth filtering', () => {
    it('skips scripts when depth is smaller than minDepth', () => {
      const script = makeScript({
        findRegex: '/hello/g',
        replaceString: 'world',
        minDepth: 2,
      });

      const context: RegexContext = { channel: 'persist', depth: 1 };
      expect(applyRegexScripts('hello', [script], REGEX_PLACEMENT.AI_OUTPUT, context)).toBe('hello');
    });

    it('applies scripts when depth is within range', () => {
      const script = makeScript({
        findRegex: '/hello/g',
        replaceString: 'world',
        minDepth: 1,
        maxDepth: 3,
      });

      const context: RegexContext = { channel: 'persist', depth: 2 };
      expect(applyRegexScripts('hello', [script], REGEX_PLACEMENT.AI_OUTPUT, context)).toBe('world');
    });

    it('skips scripts when depth is greater than maxDepth', () => {
      const script = makeScript({
        findRegex: '/hello/g',
        replaceString: 'world',
        maxDepth: 1,
      });

      const context: RegexContext = { channel: 'persist', depth: 2 };
      expect(applyRegexScripts('hello', [script], REGEX_PLACEMENT.AI_OUTPUT, context)).toBe('hello');
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

      const context: RegexContext = {
        substituteFindParams: (text: string) => text.replace('{{char}}', 'Alice'),
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

      const context: RegexContext = {
        substituteFindParams: (text: string) => text.replace('{{char}}', 'Alice (the great)'),
      };

      const result = applyRegexScripts('Alice (the great) is here', [script], REGEX_PLACEMENT.AI_OUTPUT, context);
      expect(result).toBe('NAME is here');
    });

    it('NONE mode does not substitute', () => {
      const script = makeScript({
        findRegex: '/{{char}}/g',
        replaceString: 'NAME',
        substituteRegex: SUBSTITUTE_REGEX.NONE,
      });

      const context: RegexContext = {
        substituteFindParams: (text: string) => text.replace('{{char}}', 'Alice'),
      };

      const result = applyRegexScripts('Alice is here', [script], REGEX_PLACEMENT.AI_OUTPUT, context);
      expect(result).toBe('Alice is here');
    });
  });

  describe('replacement macro substitution', () => {
    it('applies replacement macro substitution after capture processing', () => {
      const script = makeScript({
        findRegex: '/hello/g',
        replaceString: 'Hi {{user}}',
      });

      const context: RegexContext = {
        substituteReplaceParams: (text: string) => text.replace('{{user}}', 'Traveler'),
      };

      const result = applyRegexScripts('hello', [script], REGEX_PLACEMENT.AI_OUTPUT, context);
      expect(result).toBe('Hi Traveler');
    });

    it('applies replacement macro substitution to trim strings', () => {
      const script = makeScript({
        findRegex: '/(hero)/g',
        replaceString: '$1',
        trimStrings: ['{{trim}}'],
      });

      const context: RegexContext = {
        substituteReplaceParams: (text: string) => text.replace('{{trim}}', 'hero'),
      };

      const result = applyRegexScripts('hero', [script], REGEX_PLACEMENT.AI_OUTPUT, context);
      expect(result).toBe('');
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
      expect(applyRegexScripts('hello', [script], REGEX_PLACEMENT.AI_OUTPUT)).toBe('hello');
    });
  });
});
