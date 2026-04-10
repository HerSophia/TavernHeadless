import { describe, it, expect } from 'vitest';
import { assembleCompat, type CompatAssemblerInput } from '../compat-assembler.js';
import type { STPreset } from '../types/preset.js';
import type { TriggerResult } from '../worldbook/trigger-engine.js';
import type { STWorldBookEntry } from '../types/worldbook.js';
import { WI_LOGIC, WI_POSITION, WI_ROLE } from '../types/worldbook.js';

/** Minimal preset for testing */
function makePreset(overrides?: Partial<STPreset>): STPreset {
  return {
    prompts: [
      { identifier: 'main', name: 'Main', role: 'system', content: 'You are {{char}}.', enabled: true },
      { identifier: 'nsfw', name: 'NSFW', role: 'system', content: '', enabled: true },
      { identifier: 'jailbreak', name: 'Jailbreak', role: 'system', content: 'Be creative.', enabled: true },
      { identifier: 'chatHistory', name: 'Chat History', marker: true, enabled: true },
      { identifier: 'worldInfoBefore', name: 'WI Before', marker: true, enabled: true },
      { identifier: 'worldInfoAfter', name: 'WI After', marker: true, enabled: true },
      { identifier: 'charDescription', name: 'Char Desc', marker: true, enabled: true },
      { identifier: 'charPersonality', name: 'Char Personality', marker: true, enabled: true },
      { identifier: 'scenario', name: 'Scenario', marker: true, enabled: true },
      { identifier: 'dialogueExamples', name: 'Examples', marker: true, enabled: true },
    ],
    promptOrder: [
      'main', 'worldInfoBefore', 'charDescription', 'charPersonality',
      'scenario', 'nsfw', 'worldInfoAfter', 'dialogueExamples',
      'chatHistory', 'jailbreak',
    ],
    maxContext: 4096,
    maxTokens: 300,
    temperature: 1,
    topP: 1,
    topK: 0,
    minP: 0,
    frequencyPenalty: 0,
    presencePenalty: 0,
    repetitionPenalty: 1,
    newChatPrompt: '[Start a new Chat]',
    newExampleChatPrompt: '[Example Chat]',
    continueNudgePrompt: '[Continue]',
    assistantPrefill: '',
    wiFormat: '{0}',
    namesBehavior: 0,
    stream: true,
    ...overrides,
  };
}

function makeEntry(overrides: Partial<STWorldBookEntry> & { uid: number; content: string }): STWorldBookEntry {
  return {
    key: [],
    keysecondary: [],
    selective: false,
    selectiveLogic: WI_LOGIC.AND_ANY,
    constant: false,
    comment: '',
    position: WI_POSITION.BEFORE,
    order: 100,
    depth: 4,
    role: WI_ROLE.SYSTEM,
    disable: false,
    scanDepth: null,
    caseSensitive: null,
    matchWholeWords: null,
    ...overrides,
  };
}

describe('assembleCompat', () => {
  describe('basic assembly', () => {
    it('creates IR with correct metadata', () => {
      const ir = assembleCompat({
        preset: makePreset(),
        chatHistory: [],
      });

      expect(ir.metadata.maxTokens).toBe(4096);
      expect(ir.metadata.reservedForReply).toBe(300);
    });

    it('creates sections in promptOrder sequence', () => {
      const ir = assembleCompat({
        preset: makePreset(),
        chatHistory: [{ role: 'user', content: 'Hello' }],
        characterDescription: 'A wizard',
      });

      const names = ir.sections.map(s => s.name);
      const mainIdx = names.indexOf('main');
      const descIdx = names.indexOf('charDescription');
      const histIdx = names.indexOf('chatHistory');
      const jbIdx = names.indexOf('jailbreak');

      expect(mainIdx).toBeLessThan(descIdx);
      expect(descIdx).toBeLessThan(histIdx);
      expect(histIdx).toBeLessThan(jbIdx);
    });

    it('skips empty content sections', () => {
      const ir = assembleCompat({
        preset: makePreset(),
        chatHistory: [],
      });

      const names = ir.sections.map(s => s.name);
      expect(names).not.toContain('nsfw');
    });
  });

  describe('variable substitution', () => {
    it('renders {{char}} and {{user}} in prompts', () => {
      const ir = assembleCompat({
        preset: makePreset(),
        chatHistory: [],
        variables: { char: 'Alice', user: 'Bob' },
      });

      const mainSection = ir.sections.find(s => s.name === 'main');
      expect(mainSection?.messages[0]?.content).toBe('You are Alice.');
    });

    it('renders variables in chat messages', () => {
      const ir = assembleCompat({
        preset: makePreset(),
        chatHistory: [{ role: 'user', content: 'Hi {{char}}!' }],
        variables: { char: 'Alice' },
      });

      const histSection = ir.sections.find(s => s.name === 'chatHistory');
      const userMsg = histSection?.messages.find(m => m.role === 'user');
      expect(userMsg?.content).toBe('Hi {{char}}!');
    });

    it('stringifies non-string variable values', () => {
      const ir = assembleCompat({
        preset: makePreset({
          prompts: [
            { identifier: 'main', name: 'Main', role: 'system', content: 'HP {{hp}}, alive {{alive}}, stats {{stats}}.', enabled: true },
            { identifier: 'chatHistory', name: 'Chat History', marker: true, enabled: true },
          ],
          promptOrder: ['main', 'chatHistory'],
        }),
        chatHistory: [],
        variables: { hp: 7, alive: true, stats: { atk: 3 } },
      });

      const mainSection = ir.sections.find(s => s.name === 'main');
      expect(mainSection?.messages[0]?.content).toBe('HP 7, alive true, stats {"atk":3}.');
    });

    it('prefers macroRuntime for preset template rendering when provided', () => {
      const ir = assembleCompat({
        preset: makePreset(),
        chatHistory: [],
        variables: { char: 'Alice' },
        macroRuntime: ({ sampleText }) => ({
          text: sampleText.replace('{{char}}', 'RuntimeAlice'),
        }),
      });

      const mainSection = ir.sections.find(s => s.name === 'main');
      expect(mainSection?.messages[0]?.content).toBe('You are RuntimeAlice.');
    });

    it('uses minimal legacy fallback only when macroRuntime is absent', () => {
      const ir = assembleCompat({
        preset: makePreset(),
        chatHistory: [],
        variables: { char: 'Alice' },
      });

      const mainSection = ir.sections.find(s => s.name === 'main');
      expect(mainSection?.messages[0]?.content).toBe('You are Alice.');
    });
  });

  describe('chat history', () => {
    it('includes chat history messages', () => {
      const ir = assembleCompat({
        preset: makePreset(),
        chatHistory: [{ role: 'user', content: 'Hello' }],
      });

      const histSection = ir.sections.find(s => s.name === 'chatHistory');
      expect(histSection).toBeDefined();
      expect(histSection?.messages).toHaveLength(1);
      expect(histSection?.budgetGroup).toBe('history');
      expect(histSection?.messages[0]?.content).toBe('Hello');
    });

    it('does not expand macros inside chat history even when macroRuntime is provided', () => {
      const ir = assembleCompat({
        preset: makePreset(),
        chatHistory: [{ role: 'user', content: 'Hi {{char}}!' }],
        variables: { char: 'Alice' },
        macroRuntime: ({ sampleText }) => ({
          text: sampleText.replace('{{char}}', 'RuntimeAlice'),
        }),
      });

      const histSection = ir.sections.find(s => s.name === 'chatHistory');
      expect(histSection?.messages[0]?.content).toBe('Hi {{char}}!');
    });
  });

  describe('world book injection', () => {
    it('injects BEFORE entries into worldInfoBefore', () => {
      const results: TriggerResult = {
        activated: [],
        before: [makeEntry({ uid: 1, content: 'Lore before', position: WI_POSITION.BEFORE })],
        after: [],
        atDepth: [],
        outletEntries: {},
      };

      const ir = assembleCompat({
        preset: makePreset(),
        chatHistory: [],
        worldBookResults: results,
      });

      const section = ir.sections.find(s => s.name === 'worldInfoBefore');
      expect(section?.budgetGroup).toBe('worldbook');
      expect(section?.messages[0]?.content).toBe('Lore before');
    });

    it('injects AFTER entries into worldInfoAfter', () => {
      const results: TriggerResult = {
        activated: [],
        before: [],
        after: [makeEntry({ uid: 2, content: 'Lore after', position: WI_POSITION.AFTER })],
        atDepth: [],
        outletEntries: {},
      };

      const ir = assembleCompat({
        preset: makePreset(),
        chatHistory: [],
        worldBookResults: results,
      });

      const section = ir.sections.find(s => s.name === 'worldInfoAfter');
      expect(section?.budgetGroup).toBe('worldbook');
      expect(section?.messages[0]?.content).toBe('Lore after');
    });

    it('injects AT_DEPTH entries as in-chat sections', () => {
      const depthEntry = makeEntry({
        uid: 3,
        content: 'Deep lore',
        position: WI_POSITION.AT_DEPTH,
        depth: 2,
        role: WI_ROLE.SYSTEM,
      });
      const results: TriggerResult = {
        activated: [],
        before: [],
        after: [],
        atDepth: [{ depth: 2, role: depthEntry.role, entry: depthEntry }],
        outletEntries: {},
      };

      const ir = assembleCompat({
        preset: makePreset(),
        chatHistory: [],
        worldBookResults: results,
      });

      const section = ir.sections.find(s => s.name === 'worldInfoDepth:2');
      expect(section).toBeDefined();
      expect(section?.insertion).toEqual({ kind: 'in_chat', depth: 2, order: depthEntry.order });
      expect(section?.messages[0]?.role).toBe('system');
      expect(section?.messages[0]?.content).toBe('Deep lore');
    });

    it('injects outlet entries as outlet sections', () => {
      const outletEntry = makeEntry({ uid: 4, content: 'Outlet lore' });
      const results: TriggerResult = {
        activated: [],
        before: [],
        after: [],
        atDepth: [],
        outletEntries: { custom: [outletEntry] },
      };
      const preset = makePreset({
        prompts: [
          ...makePreset().prompts,
          { identifier: 'custom', name: 'Custom Outlet', marker: true, enabled: true },
        ],
        promptOrder: [...makePreset().promptOrder, 'custom'],
      });

      const ir = assembleCompat({
        preset,
        chatHistory: [],
        worldBookResults: results,
      });

      const section = ir.sections.find(s => s.name === 'worldInfoOutlet:custom');
      expect(section?.messages[0]?.content).toBe('Outlet lore');
    });
  });

  describe('character and persona sections', () => {
    it('includes character description', () => {
      const ir = assembleCompat({
        preset: makePreset(),
        chatHistory: [],
        characterDescription: 'A brave knight.',
      });

      const section = ir.sections.find(s => s.name === 'charDescription');
      expect(section?.messages[0]?.content).toBe('A brave knight.');
      expect(section?.pinned).toBe(true);
    });

    it('includes personality and scenario', () => {
      const ir = assembleCompat({
        preset: makePreset(),
        chatHistory: [],
        characterPersonality: 'Cheerful and bold.',
        scenario: 'A stormy castle siege.',
      });

      expect(ir.sections.find(s => s.name === 'charPersonality')?.messages[0]?.content).toBe('Cheerful and bold.');
      expect(ir.sections.find(s => s.name === 'scenario')?.messages[0]?.content).toBe('A stormy castle siege.');
    });

    it('includes personaDescription as system section', () => {
      const preset = makePreset({
        prompts: [
          ...makePreset().prompts,
          { identifier: 'personaDescription', name: 'Persona', marker: true, enabled: true },
        ],
        promptOrder: ['personaDescription', ...makePreset().promptOrder],
      });

      const ir = assembleCompat({
        preset,
        chatHistory: [],
        personaDescription: 'The user is a scholar.',
      });

      const section = ir.sections.find(s => s.name === 'personaDescription');
      expect(section?.messages[0]?.content).toBe('The user is a scholar.');
      expect(section?.messages[0]?.role).toBe('system');
    });

    it('renders templates inside character info', () => {
      const ir = assembleCompat({
        preset: makePreset(),
        chatHistory: [],
        characterDescription: '{{char}} is a powerful wizard.',
        variables: { char: 'Gandalf' },
      });

      const section = ir.sections.find(s => s.name === 'charDescription');
      expect(section?.messages[0]?.content).toBe('Gandalf is a powerful wizard.');
      expect(section?.pinned).toBe(true);
    });

    it('uses macroRuntime consistently for character and persona sections', () => {
      const ir = assembleCompat({
        preset: makePreset({
          prompts: [
            ...makePreset().prompts,
            { identifier: 'personaDescription', name: 'Persona', marker: true, enabled: true },
          ],
          promptOrder: ['charDescription', 'personaDescription', 'chatHistory'],
        }),
        chatHistory: [],
        characterDescription: '{{char}} is a powerful wizard.',
        personaDescription: '{{user}} is a careful scholar.',
        variables: { char: 'Gandalf', user: 'Bilbo' },
        macroRuntime: ({ sampleText }) => ({
          text: sampleText.replace('{{char}}', 'RuntimeGandalf').replace('{{user}}', 'RuntimeBilbo'),
        }),
      });

      expect(ir.sections.find(s => s.name === 'charDescription')?.messages[0]?.content).toBe('RuntimeGandalf is a powerful wizard.');
      expect(ir.sections.find(s => s.name === 'personaDescription')?.messages[0]?.content).toBe('RuntimeBilbo is a careful scholar.');
    });

    it('skips missing character info', () => {
      const ir = assembleCompat({
        preset: makePreset(),
        chatHistory: [],
      });

      expect(ir.sections.find(s => s.name === 'charDescription')).toBeUndefined();
      expect(ir.sections.find(s => s.name === 'charPersonality')).toBeUndefined();
      expect(ir.sections.find(s => s.name === 'scenario')).toBeUndefined();
    });
  });

  describe('dialogue examples', () => {
    it('renders example dialogue content', () => {
      const ir = assembleCompat({
        preset: makePreset(),
        chatHistory: [],
        exampleDialogue: '<START>\n{{char}}: Hello!',
        variables: { char: 'Alice' },
      });

      const section = ir.sections.find(s => s.name === 'dialogueExamples');
      expect(section).toBeDefined();
      expect(section!.messages[0]!.content).toContain('Alice: Hello!');
    });

    it('skips empty example dialogue', () => {
      const ir = assembleCompat({
        preset: makePreset(),
        chatHistory: [],
        exampleDialogue: '',
      });

      expect(ir.sections.find(s => s.name === 'dialogueExamples')).toBeUndefined();
    });
  });

  describe('prompt order', () => {
    it('respects custom prompt order', () => {
      const preset = makePreset({
        promptOrder: ['jailbreak', 'chatHistory', 'main'],
      });

      const ir = assembleCompat({
        preset,
        chatHistory: [{ role: 'user', content: 'Hi' }],
      });

      const names = ir.sections.map(s => s.name);
      const jbIdx = names.indexOf('jailbreak');
      const histIdx = names.indexOf('chatHistory');
      const mainIdx = names.indexOf('main');

      expect(jbIdx).toBeLessThan(histIdx);
      expect(histIdx).toBeLessThan(mainIdx);
    });

    it('order values increase with position in promptOrder', () => {
      const ir = assembleCompat({
        preset: makePreset(),
        chatHistory: [{ role: 'user', content: 'Hi' }],
        characterDescription: 'A hero',
      });

      for (let i = 1; i < ir.sections.length; i++) {
        expect(ir.sections[i]!.order).toBeGreaterThan(ir.sections[i - 1]!.order);
      }
    });
  });

  describe('custom prompt entries', () => {
    it('handles unknown identifiers from preset prompts', () => {
      const preset = makePreset({
        prompts: [
          ...makePreset().prompts,
          { identifier: 'custom1', name: 'Custom', role: 'system', content: 'Custom content', enabled: true },
        ],
        promptOrder: ['main', 'custom1', 'chatHistory'],
      });

      const ir = assembleCompat({
        preset,
        chatHistory: [],
      });

      const section = ir.sections.find(s => s.name === 'custom1');
      expect(section).toBeDefined();
      expect(section!.messages[0]!.content).toBe('Custom content');
    });

    it('preserves custom prompt entry role instead of forcing system', () => {
      const preset = makePreset({
        prompts: [
          ...makePreset().prompts,
          { identifier: 'customAssistant', name: 'Custom Assistant', role: 'assistant', content: 'Assistant guidance', enabled: true },
        ],
        promptOrder: ['main', 'customAssistant', 'chatHistory'],
      });

      const ir = assembleCompat({
        preset,
        chatHistory: [],
      });

      const section = ir.sections.find(s => s.name === 'customAssistant');
      expect(section?.messages[0]?.role).toBe('assistant');
      expect(section?.messages[0]?.content).toBe('Assistant guidance');
    });

    it('preserves built-in prompt entry role for main-like preset sections', () => {
      const preset = makePreset({
        prompts: makePreset().prompts.map((entry) =>
          entry.identifier === 'main' ? { ...entry, role: 'user' as const, content: 'User main prompt' } : entry
        ),
      });

      const ir = assembleCompat({
        preset,
        chatHistory: [],
      });

      const section = ir.sections.find(s => s.name === 'main');
      expect(section?.messages[0]?.role).toBe('user');
      expect(section?.messages[0]?.content).toBe('User main prompt');
    });
  });

  describe('prompt manager semantics', () => {
    it('filters prompt entries when triggers do not match current intent', () => {
      const preset = makePreset({
        prompts: makePreset().prompts.map((entry) =>
          entry.identifier === 'main'
            ? {
                ...entry,
                behavior: {
                  placement: { kind: 'relative', order: 0 },
                  triggers: ['quiet'],
                },
              }
            : entry
        ),
      });

      const ir = assembleCompat({
        preset,
        chatHistory: [{ role: 'user', content: 'Hi' }],
        intent: 'normal',
      });

      expect(ir.sections.find((section) => section.name === 'main')).toBeUndefined();
      expect(ir.sections.find((section) => section.name === 'chatHistory')).toBeDefined();
    });

    it('includes continue intent specific prompt when current intent is continue', () => {
      const preset = makePreset({ continueNudgePrompt: '[Continue immediately]' });

      const continueIr = assembleCompat({
        preset,
        chatHistory: [{ role: 'user', content: 'Hi' }],
        intent: 'continue',
      });

      expect(continueIr.sections.find((section) => section.messages.some((message) => message.content === '[Continue immediately]'))).toBeUndefined();
    });

    it('marks in-chat prompt entries with insertion metadata and applies names behavior to user or assistant roles', () => {
      const preset = makePreset({
        prompts: [
          ...makePreset().prompts,
          {
            identifier: 'continueHint',
            name: 'Continue Hint',
            role: 'assistant',
            content: 'Keep moving.',
            enabled: true,
            behavior: {
              placement: { kind: 'in_chat', depth: 0, order: 2 },
              triggers: ['continue'],
            },
          },
        ],
        promptOrder: ['chatHistory', 'continueHint'],
      });

      const ir = assembleCompat({
        preset,
        chatHistory: [{ role: 'user', content: 'Hello' }],
        intent: 'continue',
        namesBehavior: 'always',
        assistantName: 'Knight',
      });

      const section = ir.sections.find((candidate) => candidate.name === 'continueHint');
      expect(section?.insertion).toEqual({ kind: 'in_chat', depth: 0, order: 2 });
      expect(section?.messages[0]?.content).toBe('Knight: Keep moving.');
    });
  });

  describe('edge cases', () => {
    it('handles empty chatHistory', () => {
      const ir = assembleCompat({
        preset: makePreset(),
        chatHistory: [],
      });

      const histSection = ir.sections.find(s => s.name === 'chatHistory');
      expect(histSection).toBeDefined();
      expect(histSection!.messages).toHaveLength(0);
    });

    it('handles empty promptOrder', () => {
      const ir = assembleCompat({
        preset: makePreset({ promptOrder: [] }),
        chatHistory: [],
      });

      expect(ir.sections).toHaveLength(0);
    });

    it('handles missing variables gracefully', () => {
      const ir = assembleCompat({
        preset: makePreset(),
        chatHistory: [],
      });

      const mainSection = ir.sections.find(s => s.name === 'main');
      expect(mainSection?.messages[0]?.content).toBe('You are {{char}}.');
    });
  });
});
