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
      // main should come before charDescription, which comes before chatHistory
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
        // nsfw has empty content → should be skipped
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
      // First message is newChatPrompt, second is the user message
      const userMsg = histSection?.messages.find(m => m.role === 'user');
      expect(userMsg?.content).toBe('Hi Alice!');
    });
  });

  describe('chat history', () => {
    it('includes newChatPrompt before messages', () => {
      const ir = assembleCompat({
        preset: makePreset(),
        chatHistory: [{ role: 'user', content: 'Hello' }],
      });

      const histSection = ir.sections.find(s => s.name === 'chatHistory')!;
      expect(histSection.messages[0]?.content).toBe('[Start a new Chat]');
      expect(histSection.messages[0]?.role).toBe('system');
      expect(histSection.messages[1]?.content).toBe('Hello');
    });

    it('marks chat messages as prunable', () => {
      const ir = assembleCompat({
        preset: makePreset(),
        chatHistory: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi!' },
        ],
      });

      const histSection = ir.sections.find(s => s.name === 'chatHistory')!;
      const chatMessages = histSection.messages.filter(m => m.source?.startsWith('chat:'));
      expect(chatMessages).toHaveLength(2);
      expect(chatMessages.every(m => m.prunable === true)).toBe(true);
    });

    it('assigns priority = index for pruning', () => {
      const ir = assembleCompat({
        preset: makePreset(),
        chatHistory: [
          { role: 'user', content: 'First' },
          { role: 'assistant', content: 'Second' },
          { role: 'user', content: 'Third' },
        ],
      });

      const histSection = ir.sections.find(s => s.name === 'chatHistory')!;
      const chatMessages = histSection.messages.filter(m => m.source?.startsWith('chat:'));
      expect(chatMessages[0]?.priority).toBe(0);
      expect(chatMessages[1]?.priority).toBe(1);
      expect(chatMessages[2]?.priority).toBe(2);
    });

    it('chatHistory section is not pinned', () => {
      const ir = assembleCompat({
        preset: makePreset(),
        chatHistory: [{ role: 'user', content: 'Hi' }],
      });

      const histSection = ir.sections.find(s => s.name === 'chatHistory')!;
      expect(histSection.pinned).toBe(false);
    });
  });

  describe('world book integration', () => {
    it('injects before entries into worldInfoBefore', () => {
      const worldBookResults: TriggerResult = {
        activated: [makeEntry({ uid: 1, content: 'Lore A' })],
        before: [makeEntry({ uid: 1, content: 'Lore A' })],
        after: [],
        atDepth: [],
      };

      const ir = assembleCompat({
        preset: makePreset(),
        chatHistory: [],
        worldBookResults,
      });

      const wiSection = ir.sections.find(s => s.name === 'worldInfoBefore');
      expect(wiSection).toBeDefined();
      expect(wiSection!.messages).toHaveLength(1);
      expect(wiSection!.messages[0]!.content).toBe('Lore A');
      expect(wiSection!.pinned).toBe(true);
    });

    it('injects after entries into worldInfoAfter', () => {
      const worldBookResults: TriggerResult = {
        activated: [makeEntry({ uid: 2, content: 'Lore B' })],
        before: [],
        after: [makeEntry({ uid: 2, content: 'Lore B' })],
        atDepth: [],
      };

      const ir = assembleCompat({
        preset: makePreset(),
        chatHistory: [],
        worldBookResults,
      });

      const wiSection = ir.sections.find(s => s.name === 'worldInfoAfter');
      expect(wiSection).toBeDefined();
      expect(wiSection!.messages[0]!.content).toBe('Lore B');
    });

    it('applies wiFormat to world book entries', () => {
      const worldBookResults: TriggerResult = {
        activated: [makeEntry({ uid: 1, content: 'Lore A' })],
        before: [makeEntry({ uid: 1, content: 'Lore A' })],
        after: [],
        atDepth: [],
      };

      const ir = assembleCompat({
        preset: makePreset({ wiFormat: '[Lore: {0}]' }),
        chatHistory: [],
        worldBookResults,
      });

      const wiSection = ir.sections.find(s => s.name === 'worldInfoBefore')!;
      expect(wiSection.messages[0]!.content).toBe('[Lore: Lore A]');
    });

    it('creates atDepth sections', () => {
      const entry = makeEntry({ uid: 3, content: 'Deep lore', position: WI_POSITION.AT_DEPTH, depth: 2, role: WI_ROLE.USER });
      const worldBookResults: TriggerResult = {
        activated: [entry],
        before: [],
        after: [],
        atDepth: [{ entry, depth: 2, role: WI_ROLE.USER }],
      };

      const ir = assembleCompat({
        preset: makePreset(),
        chatHistory: [],
        worldBookResults,
      });

      const depthSection = ir.sections.find(s => s.name === 'worldInfoDepth:2');
      expect(depthSection).toBeDefined();
      expect(depthSection!.messages[0]!.role).toBe('user');
      expect(depthSection!.messages[0]!.content).toBe('Deep lore');
      expect(depthSection!.pinned).toBe(true);
    });

    it('handles no world book results', () => {
      const ir = assembleCompat({
        preset: makePreset(),
        chatHistory: [],
      });

      expect(ir.sections.find(s => s.name === 'worldInfoBefore')).toBeUndefined();
      expect(ir.sections.find(s => s.name === 'worldInfoAfter')).toBeUndefined();
    });
  });

  describe('character info sections', () => {
    it('includes characterDescription', () => {
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
    it('prepends newExampleChatPrompt', () => {
      const ir = assembleCompat({
        preset: makePreset(),
        chatHistory: [],
        exampleDialogue: '<START>\n{{char}}: Hello!',
        variables: { char: 'Alice' },
      });

      const section = ir.sections.find(s => s.name === 'dialogueExamples');
      expect(section).toBeDefined();
      expect(section!.messages[0]!.content).toContain('[Example Chat]');
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
  });

  describe('edge cases', () => {
    it('handles empty chatHistory', () => {
      const ir = assembleCompat({
        preset: makePreset(),
        chatHistory: [],
      });

      const histSection = ir.sections.find(s => s.name === 'chatHistory');
      expect(histSection).toBeDefined();
      // Only newChatPrompt
      expect(histSection!.messages).toHaveLength(1);
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
        // no variables provided, {{char}} stays as-is
      });

      const mainSection = ir.sections.find(s => s.name === 'main');
      expect(mainSection?.messages[0]?.content).toBe('You are {{char}}.');
    });
  });
});
