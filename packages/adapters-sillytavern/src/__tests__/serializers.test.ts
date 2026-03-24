import { describe, it, expect } from 'vitest';
import { snapshotToStCharacterCard } from '../serializers/character-serializer.js';
import { scriptsToStRegexArray } from '../serializers/regex-serializer.js';
import type { STRegexScript } from '../types/regex.js';
import { SUBSTITUTE_REGEX } from '../types/regex.js';

// ── snapshotToStCharacterCard ──────────────────────────

describe('snapshotToStCharacterCard', () => {
  it('完整 snapshot → 正确映射所有字段', () => {
    const result = snapshotToStCharacterCard({
      name: 'Alice',
      description: 'A curious girl',
      personality: 'Adventurous',
      scenario: 'Wonderland',
      exampleDialogue: '<START>\nAlice: Hello!',
      greeting: 'Welcome to Wonderland!',
    });

    expect(result.data.name).toBe('Alice');
    expect(result.data.description).toBe('A curious girl');
    expect(result.data.personality).toBe('Adventurous');
    expect(result.data.scenario).toBe('Wonderland');
    expect(result.data.first_mes).toBe('Welcome to Wonderland!');
    expect(result.data.mes_example).toBe('<START>\nAlice: Hello!');
  });

  it('最小 snapshot（只有 name）→ 可选字段补空字符串', () => {
    const result = snapshotToStCharacterCard({ name: 'Bob' });

    expect(result.data.name).toBe('Bob');
    expect(result.data.description).toBe('');
    expect(result.data.personality).toBe('');
    expect(result.data.scenario).toBe('');
    expect(result.data.first_mes).toBe('');
    expect(result.data.mes_example).toBe('');
  });

  it('V2 envelope 结构正确', () => {
    const result = snapshotToStCharacterCard({ name: 'Test' });

    expect(result.spec).toBe('chara_card_v2');
    expect(result.spec_version).toBe('2.0');
    expect(result.data).toBeDefined();
    expect(typeof result.data).toBe('object');
  });

  it('固定补空字段全部存在且为空值', () => {
    const result = snapshotToStCharacterCard({ name: 'Test' });

    expect(result.data.creator_notes).toBe('');
    expect(result.data.system_prompt).toBe('');
    expect(result.data.post_history_instructions).toBe('');
    expect(result.data.alternate_greetings).toEqual([]);
    expect(result.data.tags).toEqual([]);
    expect(result.data.creator).toBe('');
    expect(result.data.character_version).toBe('');
    expect(result.data.extensions).toEqual({});
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
    substituteRegex: SUBSTITUTE_REGEX.NONE,
    minDepth: 0,
    maxDepth: 0,
    ...overrides,
  };
}

describe('scriptsToStRegexArray', () => {
  it('补回 3 个丢弃字段', () => {
    const result = scriptsToStRegexArray([makeScript()]);

    const first = result[0]!;
    expect(result).toHaveLength(1);
    expect(first.markdownOnly).toBe(false);
    expect(first.promptOnly).toBe(false);
    expect(first.runOnEdit).toBe(false);
  });

  it('保留原有字段不变', () => {
    const input = makeScript({
      id: 'abc-123',
      scriptName: 'My Regex',
      findRegex: '/foo/g',
      replaceString: 'bar',
      placement: [1, 2, 5],
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
    expect(first!.placement).toEqual([1, 2, 5]);
    expect(first!.disabled).toBe(true);
    expect(first!.substituteRegex).toBe(SUBSTITUTE_REGEX.ESCAPED);
    expect(first!.minDepth).toBe(1);
    expect(first!.maxDepth).toBe(10);
  });

  it('空数组 → 空数组', () => {
    const result = scriptsToStRegexArray([]);
    expect(result).toEqual([]);
  });

  it('多脚本数组每个都补了字段', () => {
    const scripts = [
      makeScript({ id: 'a' }),
      makeScript({ id: 'b' }),
      makeScript({ id: 'c' }),
    ];
    const result = scriptsToStRegexArray(scripts);

    expect(result).toHaveLength(3);
    for (const s of result) {
      expect(s.markdownOnly).toBe(false);
      expect(s.promptOnly).toBe(false);
      expect(s.runOnEdit).toBe(false);
    }
    expect(result[0]!.id).toBe('a');
    expect(result[1]!.id).toBe('b');
    expect(result[2]!.id).toBe('c');
  });
});
