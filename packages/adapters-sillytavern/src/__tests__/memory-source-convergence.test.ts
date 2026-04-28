import { describe, it, expect } from 'vitest';
import { assembleNativePrompt, PROMPT_MEMORY_MESSAGE_SOURCE, PROMPT_MEMORY_SECTION_NAME } from '@tavern/core';
import type { IRMessage, IRSection } from '@tavern/core';
import { assembleCompatPlus, type CompatPlusAssemblerInput } from '../compat-plus-assembler.js';
import type { STPreset } from '../types/preset.js';
import type { MemoryItem } from '@tavern/core';

/**
 * Phase 3.1 —— compat_plus / native 两条装配路径的 memory 归因一致性测试。
 *
 * 目的是让下游 runtimeTrace / explain 在识别 memory 归因时，
 * 不再被 native 的 `memorySummary` / `native:memory` 与 compat_plus 的
 * `memory` / `memory` 两种写法拆散。
 *
 * compat 路径不在这里测试：api 层 `injectMemorySummary(...)` 直接把 memory
 * 后置插入到 ChatMessage 数组中，没有 section 归因面，属于已知 limitation。
 */

function makePreset(): STPreset {
  return {
    prompts: [
      { identifier: 'main', name: 'Main', role: 'system', content: 'You are {{char}}.', enabled: true },
      { identifier: 'chatHistory', name: 'Chat History', marker: true, enabled: true },
    ],
    promptOrder: ['main', 'chatHistory'],
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
  };
}

function makeMemoryItem(content: string): MemoryItem {
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
  };
}

function baseCompatPlusInput(memorySummary: string): CompatPlusAssemblerInput {
  return {
    preset: makePreset(),
    chatHistory: [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ],
    characterDescription: 'A brave knight.',
    memoryInjection: {
      items: [makeMemoryItem(memorySummary)],
      formattedText: memorySummary,
      tokenCount: 10,
    },
  };
}

function findMemorySection(sections: IRSection[]): IRSection | undefined {
  return sections.find((section) => section.name === PROMPT_MEMORY_SECTION_NAME);
}

function firstMemoryMessage(section: IRSection | undefined): IRMessage | undefined {
  return section?.messages[0];
}

describe('memory source convergence across compat_plus / native', () => {
  it('produces the same section name and message source for the memory injection', () => {
    const nativeIR = assembleNativePrompt({
      systemPrompt: 'You are {{char}}.',
      chatHistory: [{ role: 'user', content: 'Hello' }],
      variables: { char: 'Luna' },
      memorySummary: '- Luna remembers the ritual.',
      maxTokens: 2048,
      reservedForReply: 256,
    });

    const compatPlusIR = assembleCompatPlus(baseCompatPlusInput('- Luna remembers the ritual.'));

    const nativeMemory = findMemorySection(nativeIR.sections);
    const compatPlusMemory = findMemorySection(compatPlusIR.sections);

    expect(nativeMemory).toBeDefined();
    expect(compatPlusMemory).toBeDefined();

    // 1. section name 统一为 "memory"。
    expect(nativeMemory!.name).toBe('memory');
    expect(compatPlusMemory!.name).toBe('memory');
    expect(nativeMemory!.name).toBe(compatPlusMemory!.name);

    // 2. budgetGroup 一致。
    expect(nativeMemory!.budgetGroup).toBe('memory');
    expect(compatPlusMemory!.budgetGroup).toBe('memory');

    // 3. pinned 一致，并保持 soft_required（不固定但不可预算裁剪）。
    expect(nativeMemory!.pinned).toBe(false);
    expect(compatPlusMemory!.pinned).toBe(false);

    const nativeMessage = firstMemoryMessage(nativeMemory);
    const compatPlusMessage = firstMemoryMessage(compatPlusMemory);

    expect(nativeMessage).toBeDefined();
    expect(compatPlusMessage).toBeDefined();

    // 4. message source 统一为 "memory"，不再区分 "native:memory" 与 "memory"。
    expect(nativeMessage!.source).toBe(PROMPT_MEMORY_MESSAGE_SOURCE);
    expect(compatPlusMessage!.source).toBe(PROMPT_MEMORY_MESSAGE_SOURCE);
    expect(nativeMessage!.source).toBe(compatPlusMessage!.source);

    // 5. role 一致。
    expect(nativeMessage!.role).toBe('system');
    expect(compatPlusMessage!.role).toBe('system');

    // 6. prunable 现状一致（首轮保持 false，详见 Phase 3.2 的 prunable governance 复查）。
    expect(nativeMessage!.prunable).toBe(false);
    expect(compatPlusMessage!.prunable).toBe(false);
  });

  it('skips memory section in both paths when memory summary is empty', () => {
    const nativeIR = assembleNativePrompt({
      systemPrompt: 'Sys',
      chatHistory: [{ role: 'user', content: 'Hello' }],
      memorySummary: '',
      maxTokens: 512,
      reservedForReply: 64,
    });

    const compatPlusIR = assembleCompatPlus({
      preset: makePreset(),
      chatHistory: [{ role: 'user', content: 'Hello' }],
      characterDescription: 'Desc',
      memoryInjection: undefined,
    });

    expect(findMemorySection(nativeIR.sections)).toBeUndefined();
    expect(findMemorySection(compatPlusIR.sections)).toBeUndefined();
  });
});
