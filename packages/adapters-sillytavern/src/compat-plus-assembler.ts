import type { PromptIR, IRSection } from '@tavern/core';
import type { MemoryInjectionResult } from '@tavern/core';
import {
  PROMPT_MEMORY_MESSAGE_SOURCE,
  PROMPT_MEMORY_SECTION_NAME,
  resolvePromptRuntimeGovernancePolicy,
} from '@tavern/core';
import { assembleCompat } from './compat-assembler.js';
import type { CompatAssemblerInput } from './compat-assembler.js';

export interface CompatPlusRenderableInjection {
  sourceKind: string;
  title: string;
  content: string;
}

// ── 类型 ──────────────────────────────────────────────

/** compat_plus 编排器输入 */
export interface CompatPlusAssemblerInput extends CompatAssemblerInput {
  /** 记忆注入结果（由 MemoryStore.prepareInjection 获得） */
  memoryInjection?: MemoryInjectionResult;
  /**
   * 记忆 section 的插入位置
   *
   * - `'before_chat'`（默认）：在 chatHistory section 之前
   * - `'after_worldinfo'`：在 worldInfoAfter section 之后
   * - `'before_jailbreak'`：在 jailbreak section 之前
   */
  memoryPosition?: 'before_chat' | 'after_worldinfo' | 'before_jailbreak';
  renderableInjections?: CompatPlusRenderableInjection[];
}

// ── 内部工具 ──────────────────────────────────────────

/** 查找 section 在数组中的索引位置 */
function findSectionIndex(sections: IRSection[], name: string): number {
  return sections.findIndex((s) => s.name === name);
}

/**
 * 根据 memoryPosition 计算 memory section 的 order 值。
 *
 * 策略：取目标 section 的 order 值，减 0.5 使其排在目标之前。
 * 如果找不到目标 section，默认放在所有现有 section 的最大 order 之后。
 */
function calculateMemoryOrder(
  sections: IRSection[],
  position: 'before_chat' | 'after_worldinfo' | 'before_jailbreak',
): number {
  switch (position) {
    case 'before_chat': {
      const idx = findSectionIndex(sections, 'chatHistory');
      if (idx >= 0) return sections[idx]!.order - 0.5;
      break;
    }
    case 'after_worldinfo': {
      const idx = findSectionIndex(sections, 'worldInfoAfter');
      if (idx >= 0) return sections[idx]!.order + 0.5;
      break;
    }
    case 'before_jailbreak': {
      const idx = findSectionIndex(sections, 'jailbreak');
      if (idx >= 0) return sections[idx]!.order - 0.5;
      break;
    }
  }

  // 回退：放在最后一个 section 之后
  const maxOrder = sections.reduce((max, s) => Math.max(max, s.order), 0);
  return maxOrder + 1;
}

// ── 主函数 ────────────────────────────────────────────

function sanitizeRenderableInjectionContent(
  injection: CompatPlusRenderableInjection,
): string {
  const content = injection.content.trim();
  if (!content) {
    return '';
  }
  return [`[${injection.title}]`, content].join('\n');
}

function createRenderableSections(
  sections: IRSection[],
  injections: CompatPlusRenderableInjection[],
): IRSection[] {
  const firstChatOrder = sections.find((section) => section.name === 'chatHistory')?.order ?? sections.length + 1;

  const nextSections: IRSection[] = [];
  for (const [index, injection] of injections.entries()) {
      const content = sanitizeRenderableInjectionContent(injection);
      if (!content) {
        continue;
      }

      const governance = resolvePromptRuntimeGovernancePolicy({
        sourceKind: injection.sourceKind,
        fallback: { budgetGroup: `section:${injection.title}`, pinned: false, prunable: false },
      });
      nextSections.push({
        name: injection.sourceKind === 'state_projection' ? 'stateProjection' : `contributor:${injection.sourceKind}:${index + 1}`,
        order: firstChatOrder - 0.25 + index * 0.01,
        budgetGroup: governance.budgetGroup,
        pinned: governance.pinned,
        messages: [{ role: 'system', content, source: injection.sourceKind, prunable: governance.prunable }],
      });
  }

  return nextSections;
}

/**
 * compat_plus 编排器
 *
 * 在 compat_strict（assembleCompat）的基础上，注入一个 memory section。
 *
 * 设计：
 * 1. 调用 assembleCompat 获得基础 PromptIR
 * 2. 如果有 memoryInjection 且不为空，在指定位置插入 memory IRSection
 * 3. 返回增强后的 PromptIR
 *
 * 当没有 memoryInjection 时，行为等同于 assembleCompat。
 *
 * @example
 * ```typescript
 * const injection = await memoryStore.prepareInjection(sessionId, { maxTokens: 300 });
 * const ir = assembleCompatPlus({
 *   ...compatInput,
 *   memoryInjection: injection,
 *   memoryPosition: 'before_chat',
 * });
 * ```
 */
export function assembleCompatPlus(input: CompatPlusAssemblerInput): PromptIR {
  const {
    memoryInjection,
    memoryPosition = 'before_chat',
    renderableInjections = [],
    ...compatInput
  } = input;

  // 1. 获取基础 IR
  const baseIR = assembleCompat(compatInput);
  const contributorSections = createRenderableSections(baseIR.sections, renderableInjections);

  if (!memoryInjection || memoryInjection.items.length === 0 || !memoryInjection.formattedText) {
    return contributorSections.length > 0
      ? { ...baseIR, sections: [...baseIR.sections, ...contributorSections] }
      : baseIR;
  }

  // 3. 创建 memory section
  const memoryOrder = calculateMemoryOrder(baseIR.sections, memoryPosition);

  const memorySection: IRSection = {
    name: PROMPT_MEMORY_SECTION_NAME,
    order: memoryOrder,
    budgetGroup: 'memory',
    pinned: false,
    messages: [{
      role: 'system',
      content: memoryInjection.formattedText,
      source: PROMPT_MEMORY_MESSAGE_SOURCE,
      // Phase 3 governance: memory registry 记为 `soft_required`。
      // 因此 section 不固定，但 message 继续保持 `prunable: false`。
      // 对外治理仍走 `sourceSelection.memory.enabled`。
      // 若后续允许在极端 budget 压力下裁剪 memory，应重新决策。
      prunable: false,
    }],
  };
  const sections = [...baseIR.sections, ...contributorSections, memorySection];

  // 4. 插入到 sections 中
  return {
    ...baseIR,
    sections,
  };
}
