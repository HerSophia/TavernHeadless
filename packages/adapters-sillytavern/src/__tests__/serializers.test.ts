import { describe, it, expect } from 'vitest';
import { snapshotToCharacterCardV3, snapshotToStCharacterCard } from '../serializers/character-serializer.js';
import { scriptsToStRegexArray } from '../serializers/regex-serializer.js';
import type { STRegexScript } from '../types/regex.js';
import { SUBSTITUTE_REGEX } from '../types/regex.js';

// ── snapshotToStCharacterCard ──────────────────────────

describe('snapshotToStCharacterCard', () => {
  it('完整 snapshot → 正确映射 richer 字段', () => {
    const result = snapshotToStCharacterCard({
      name: 'Alice',
      description: 'A curious girl',
      personality: 'Adventurous',
      scenario: 'Wonderland',
      exampleDialogue: '<START>\nAlice: Hello!',
      primaryGreeting: 'Welcome to Wonderland!',
      alternateGreetings: ['Alt 1', ' Alt 2 '],
      systemPrompt: 'Stay in character.',
      postHistoryInstructions: 'End with a question.',
      creatorNotes: 'Creator note.',
      tags: ['heroine', ' curious '],
      creator: 'Lewis',
      characterVersion: '2.0',
      extensions: { source_app: 'test' },
      characterBook: { entries: [] },
    });

    expect(result.data.name).toBe('Alice');
    expect(result.data.description).toBe('A curious girl');
    expect(result.data.personality).toBe('Adventurous');
    expect(result.data.scenario).toBe('Wonderland');
    expect(result.data.first_mes).toBe('Welcome to Wonderland!');
    expect(result.data.mes_example).toBe('<START>\nAlice: Hello!');
    expect(result.data.alternate_greetings).toEqual(['Alt 1', 'Alt 2']);
    expect(result.data.system_prompt).toBe('Stay in character.');
    expect(result.data.post_history_instructions).toBe('End with a question.');
    expect(result.data.creator_notes).toBe('Creator note.');
    expect(result.data.tags).toEqual(['heroine', 'curious']);
    expect(result.data.creator).toBe('Lewis');
    expect(result.data.character_version).toBe('2.0');
    expect(result.data.extensions).toEqual({ source_app: 'test' });
    expect(result.data.character_book).toEqual({ entries: [] });
  });

  it('兼容 legacy greeting 字段作为 first_mes 回退来源', () => {
    const result = snapshotToStCharacterCard({
      name: 'Legacy',
      greeting: 'Legacy greeting',
    });

    expect(result.data.first_mes).toBe('Legacy greeting');
    expect(result.data.alternate_greetings).toEqual([]);
  });

  it('最小 snapshot（只有 name）→ 可选字段补安全默认值', () => {
    const result = snapshotToStCharacterCard({ name: 'Bob' });

    expect(result.data.name).toBe('Bob');
    expect(result.data.description).toBe('');
    expect(result.data.personality).toBe('');
    expect(result.data.scenario).toBe('');
    expect(result.data.first_mes).toBe('');
    expect(result.data.mes_example).toBe('');
    expect(result.data.creator_notes).toBe('');
    expect(result.data.system_prompt).toBe('');
    expect(result.data.post_history_instructions).toBe('');
    expect(result.data.alternate_greetings).toEqual([]);
    expect(result.data.tags).toEqual([]);
    expect(result.data.creator).toBe('');
    expect(result.data.character_version).toBe('');
    expect(result.data.extensions).toEqual({});
    expect(result.data.character_book).toBeUndefined();
  });

  it('V2 envelope 结构正确', () => {
    const result = snapshotToStCharacterCard({ name: 'Test' });

    expect(result.spec).toBe('chara_card_v2');
    expect(result.spec_version).toBe('2.0');
    expect(result.data).toBeDefined();
    expect(typeof result.data).toBe('object');
  });

  it('可导出 Character Card V3 结构', () => {
    const result = snapshotToCharacterCardV3({
      name: 'Alice',
      description: 'A curious girl',
      personality: 'Adventurous',
      scenario: 'Wonderland',
      exampleDialogue: '<START>\nAlice: Hello!',
      primaryGreeting: 'Welcome to Wonderland!',
      alternateGreetings: ['Alt 1'],
      groupOnlyGreetings: ['Group Alt'],
      systemPrompt: 'Stay in character.',
      postHistoryInstructions: 'End with a question.',
      creatorNotes: 'Creator note.',
      tags: ['heroine'],
      creator: 'Lewis',
      characterVersion: '3.0',
      nickname: 'Ali',
      source: ['https://example.com/card'],
      creationDate: 1710000000,
      modificationDate: 1710001234,
      assets: [{ type: 'icon', uri: 'https://example.com/icon.png', name: 'main', ext: 'png' }],
      extensions: { source_app: 'test' },
      characterBook: { entries: [] },
    });

    expect(result.spec).toBe('chara_card_v3');
    expect(result.spec_version).toBe('3.0');
    expect(result.data.first_mes).toBe('Welcome to Wonderland!');
    expect(result.data.alternate_greetings).toEqual(['Alt 1']);
    expect(result.data.group_only_greetings).toEqual(['Group Alt']);
    expect(result.data.character_book).toEqual({ entries: [] });
    expect(result.data.assets).toEqual([{ type: 'icon', uri: 'https://example.com/icon.png', name: 'main', ext: 'png' }]);
    expect(result.data.nickname).toBe('Ali');
  });
});

// ── scriptsToStRegexArray ──────────────────────────────

function makeScript(overrides?: Partial<STRegexScript>): STRegexScript {
  return {
    id: 'script-1',
    scriptName: 'Test Script',
    findRegex: '/hello/gi',
    replaceString: 'world',
    trimStrings: [],
    placement: [1, 2],
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

describe('scriptsToStRegexArray', () => {
  it('保留兼容字段原值', () => {
    const result = scriptsToStRegexArray([
      makeScript({
        markdownOnly: true,
        promptOnly: true,
        runOnEdit: true,
      }),
    ]);

    const first = result[0]!;
    expect(result).toHaveLength(1);
    expect(first.markdownOnly).toBe(true);
    expect(first.promptOnly).toBe(true);
    expect(first.runOnEdit).toBe(true);
  });

  it('保留原有字段不变', () => {
    const input = makeScript({
      id: 'abc-123',
      scriptName: 'My Regex',
      findRegex: '/foo/g',
      replaceString: 'bar',
      placement: [0, 1, 2, 3, 5, 6],
      disabled: true,
      substituteRegex: SUBSTITUTE_REGEX.ESCAPED,
      minDepth: 1,
      maxDepth: 10,
    });
    const [first] = scriptsToStRegexArray([input]);

    expect(first).toBeDefined();
    expect(first!.id).toBe('abc-123');
    expect(first!.scriptName).toBe('My Regex');
    expect(first!.findRegex).toBe('/foo/g');
    expect(first!.replaceString).toBe('bar');
    expect(first!.placement).toEqual([0, 1, 2, 3, 5, 6]);
    expect(first!.disabled).toBe(true);
    expect(first!.substituteRegex).toBe(SUBSTITUTE_REGEX.ESCAPED);
    expect(first!.minDepth).toBe(1);
    expect(first!.maxDepth).toBe(10);
  });

  it('对历史旧数据缺失的兼容字段使用安全默认值', () => {
    const legacyScript = {
      id: 'legacy-1',
      scriptName: 'Legacy Script',
      findRegex: '/test/g',
      replaceString: '',
      trimStrings: [],
      placement: [2],
      disabled: false,
      substituteRegex: SUBSTITUTE_REGEX.NONE,
      minDepth: 0,
      maxDepth: 0,
    } as unknown as STRegexScript;

    const [first] = scriptsToStRegexArray([legacyScript]);

    expect(first).toBeDefined();
    expect(first!.markdownOnly).toBe(false);
    expect(first!.promptOnly).toBe(false);
    expect(first!.runOnEdit).toBe(false);
  });

  it('空数组 → 空数组', () => {
    const result = scriptsToStRegexArray([]);
    expect(result).toEqual([]);
  });

  it('多脚本数组每个都保留了兼容字段', () => {
    const scripts = [
      makeScript({ id: 'a', promptOnly: true }),
      makeScript({ id: 'b', markdownOnly: true }),
      makeScript({ id: 'c', runOnEdit: true }),
    ];
    const result = scriptsToStRegexArray(scripts);

    expect(result).toHaveLength(3);
    expect(result[0]!.id).toBe('a');
    expect(result[0]!.promptOnly).toBe(true);
    expect(result[1]!.id).toBe('b');
    expect(result[1]!.markdownOnly).toBe(true);
    expect(result[2]!.id).toBe('c');
    expect(result[2]!.runOnEdit).toBe(true);
  });
});
