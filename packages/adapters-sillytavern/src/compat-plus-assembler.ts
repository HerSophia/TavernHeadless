import type { PromptIR, IRSection } from '@tavern/core';
import type { MemoryInjectionResult } from '@tavern/core';
import { assembleCompat } from './compat-assembler.js';
import type { CompatAssemblerInput } from './compat-assembler.js';

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
    ...compatInput
  } = input;

  // 1. 获取基础 IR
  const baseIR = assembleCompat(compatInput);

  // 2. 如果没有记忆注入或注入内容为空，直接返回
  if (
    !memoryInjection ||
    memoryInjection.items.length === 0 ||
    !memoryInjection.formattedText
  ) {
    return baseIR;
  }

  // 3. 创建 memory section
  const memoryOrder = calculateMemoryOrder(baseIR.sections, memoryPosition);

  const memorySection: IRSection = {
    name: 'memory',
    order: memoryOrder,
    pinned: true,
    messages: [{
      role: 'system',
      content: memoryInjection.formattedText,
      source: 'memory',
      prunable: false,
    }],
  };

  // 4. 插入到 sections 中
  return {
    ...baseIR,
    sections: [...baseIR.sections, memorySection],
  };
}
