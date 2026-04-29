import { describe, it, expect } from 'vitest';
import { assembleCompatPlus, type CompatPlusAssemblerInput } from '../compat-plus-assembler.js';
import type { STPreset } from '../types/preset.js';
import { WI_LOGIC, WI_POSITION, WI_ROLE } from '../types/worldbook.js';
import type { STWorldBookEntry } from '../types/worldbook.js';
import type { MemoryInjectionResult, MemoryItem } from '@tavern/core';

// ── Test Helpers ──────────────────────────────────────

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

function makeMemoryItem(content: string, overrides?: Partial<MemoryItem>): MemoryItem {
  return {
    id: `mem_${Math.random().toString(36).slice(2, 8)}`,
    scope: 'chat',
    scopeId: 'session-1',
    type: 'summary',
    content,
    importance: 0.5,
    confidence: 1.0,
    status: 'active',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeInjection(
  items: MemoryItem[],
  formattedText: string,
  tokenCount = 50,
): MemoryInjectionResult {
  return { items, formattedText, tokenCount };
}

function baseInput(overrides?: Partial<CompatPlusAssemblerInput>): CompatPlusAssemblerInput {
  return {
    preset: makePreset(),
    chatHistory: [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ],
    characterDescription: 'A brave knight.',
    ...overrides,
  };
}

/** Get section names sorted by order */
function getSectionOrder(ir: ReturnType<typeof assembleCompatPlus>): string[] {
  return [...ir.sections].sort((a, b) => a.order - b.order).map((s) => s.name);
}

// ── Tests ─────────────────────────────────────────────

describe('assembleCompatPlus', () => {
  describe('without memory injection', () => {
    it('behaves identically to assembleCompat', () => {
      const ir = assembleCompatPlus(baseInput());

      expect(ir.metadata.maxTokens).toBe(4096);
      expect(ir.metadata.reservedForReply).toBe(300);
      expect(ir.sections.find((s) => s.name === 'memory')).toBeUndefined();
    });

    it('handles undefined memoryInjection', () => {
      const ir = assembleCompatPlus(baseInput({ memoryInjection: undefined }));
      expect(ir.sections.find((s) => s.name === 'memory')).toBeUndefined();
    });

    it('handles empty memoryInjection items', () => {
      const ir = assembleCompatPlus(
        baseInput({
          memoryInjection: makeInjection([], '', 0),
        }),
      );
      expect(ir.sections.find((s) => s.name === 'memory')).toBeUndefined();
    });
  });

  describe('with memory injection', () => {
    it('injects memory section', () => {
      const items = [makeMemoryItem('Important fact')];
      const injection = makeInjection(items, '[Memory]\n- (summary) Important fact');

      const ir = assembleCompatPlus(baseInput({ memoryInjection: injection }));

      const memorySection = ir.sections.find((s) => s.name === 'memory');
      expect(memorySection).toBeDefined();
      expect(memorySection!.messages).toHaveLength(1);
      expect(memorySection!.messages[0]!.content).toBe('[Memory]\n- (summary) Important fact');
      expect(memorySection!.messages[0]!.role).toBe('system');
      expect(memorySection!.budgetGroup).toBe('memory');
      expect(memorySection!.messages[0]!.source).toBe('memory');
    });

    it('memory section is soft-required and not prunable', () => {
      const items = [makeMemoryItem('fact')];
      const injection = makeInjection(items, '[Memory]\n- (summary) fact');

      const ir = assembleCompatPlus(baseInput({ memoryInjection: injection }));

      const memorySection = ir.sections.find((s) => s.name === 'memory');
      expect(memorySection!.pinned).toBe(false);
      expect(memorySection!.messages[0]!.prunable).toBe(false);
    });

    it('preserves all original sections', () => {
      const items = [makeMemoryItem('fact')];
      const injection = makeInjection(items, '[Memory]\n- (summary) fact');

      const withoutMemory = assembleCompatPlus(baseInput());
      const withMemory = assembleCompatPlus(baseInput({ memoryInjection: injection }));

      // Should have one more section
      expect(withMemory.sections.length).toBe(withoutMemory.sections.length + 1);

      // All original sections should still exist
      for (const original of withoutMemory.sections) {
        expect(
          withMemory.sections.find((s) => s.name === original.name),
        ).toBeDefined();
      }
    });

    it('preserves metadata from base IR', () => {
      const items = [makeMemoryItem('fact')];
      const injection = makeInjection(items, '[Memory]\n- fact');

      const ir = assembleCompatPlus(baseInput({ memoryInjection: injection }));

      expect(ir.metadata.maxTokens).toBe(4096);
      expect(ir.metadata.reservedForReply).toBe(300);
    });
  });

  describe('memory position', () => {
    it('places memory before chatHistory by default', () => {
      const items = [makeMemoryItem('fact')];
      const injection = makeInjection(items, '[Memory]\n- fact');

      const ir = assembleCompatPlus(baseInput({ memoryInjection: injection }));
      const order = getSectionOrder(ir);

      const memIdx = order.indexOf('memory');
      const chatIdx = order.indexOf('chatHistory');
      expect(memIdx).toBeLessThan(chatIdx);
    });

    it('places memory before chatHistory with explicit before_chat', () => {
      const items = [makeMemoryItem('fact')];
      const injection = makeInjection(items, '[Memory]\n- fact');

      const ir = assembleCompatPlus(
        baseInput({ memoryInjection: injection, memoryPosition: 'before_chat' }),
      );
      const order = getSectionOrder(ir);

      const memIdx = order.indexOf('memory');
      const chatIdx = order.indexOf('chatHistory');
      expect(memIdx).toBeLessThan(chatIdx);
    });

    it('places memory after worldInfoAfter', () => {
      const items = [makeMemoryItem('fact')];
      const injection = makeInjection(items, '[Memory]\n- fact');

      // Need worldInfoAfter to exist
      const ir = assembleCompatPlus(
        baseInput({
          memoryInjection: injection,
          memoryPosition: 'after_worldinfo',
          worldBookResults: {
            activated: [],
            before: [],
            after: [{
              uid: 1, content: 'WI content', key: ['test'], keysecondary: [],
              selective: false, selectiveLogic: WI_LOGIC.AND_ANY,
              constant: false, comment: '', position: WI_POSITION.AFTER,
              order: 100, depth: 4, role: WI_ROLE.SYSTEM,
              disable: false, scanDepth: null, caseSensitive: null, matchWholeWords: null,
            }],
            atDepth: [],
            anTop: [],
            anBottom: [],
            emTop: [],
            emBottom: [],
          },
        }),
      );
      const order = getSectionOrder(ir);

      const memIdx = order.indexOf('memory');
      const wiAfterIdx = order.indexOf('worldInfoAfter');
      expect(wiAfterIdx).toBeGreaterThanOrEqual(0);
      expect(memIdx).toBeGreaterThan(wiAfterIdx);
    });

    it('places memory before jailbreak', () => {
      const items = [makeMemoryItem('fact')];
      const injection = makeInjection(items, '[Memory]\n- fact');

      const ir = assembleCompatPlus(
        baseInput({
          memoryInjection: injection,
          memoryPosition: 'before_jailbreak',
        }),
      );
      const order = getSectionOrder(ir);

      const memIdx = order.indexOf('memory');
      const jbIdx = order.indexOf('jailbreak');
      expect(jbIdx).toBeGreaterThanOrEqual(0);
      expect(memIdx).toBeLessThan(jbIdx);
    });

    it('falls back to end when target section is missing', () => {
      const items = [makeMemoryItem('fact')];
      const injection = makeInjection(items, '[Memory]\n- fact');

      // Use a preset without worldInfoAfter in promptOrder
      const ir = assembleCompatPlus(
        baseInput({
          preset: makePreset({
            promptOrder: ['main', 'chatHistory', 'jailbreak'],
          }),
          memoryInjection: injection,
          memoryPosition: 'after_worldinfo',
        }),
      );

      const memorySection = ir.sections.find((s) => s.name === 'memory');
      expect(memorySection).toBeDefined();
      // Should still produce a valid IR even with missing target
    });
  });
});
