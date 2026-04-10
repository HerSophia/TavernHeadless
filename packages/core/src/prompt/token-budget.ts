import type { PromptIR, IRMessage, IRSection, TokenCounter } from './types.js';

/**
 * 简单 token 估算器：字符数 / 4
 *
 * 适用于快速原型和测试。生产环境建议替换为 tiktoken 等精确计数器。
 */
export class SimpleTokenCounter implements TokenCounter {
  readonly name = 'simple';

  count(text: string): number {
    return Math.ceil(text.length / 4);
  }
}

/** 裁剪候选项：关联消息在 IR 中的位置 */
interface PruneCandidate {
  sectionIndex: number;
  messageIndex: number;
  message: IRMessage;
  /** 全局位置序号（用于同 priority 时按位置排序） */
  globalIndex: number;
  /** 预算来源组 */
  budgetGroup: string;
}

/**
 * Token 预算管理器
 *
 * 职责：
 * 1. 为 IR 中的所有消息估算 token 数
 * 2. 根据总预算按优先级裁剪可裁剪消息
 */
export function resolveSectionBudgetGroupName(section: IRSection): string {
  const budgetGroup = typeof section.budgetGroup === 'string'
    ? section.budgetGroup.trim()
    : '';

  return budgetGroup.length > 0
    ? budgetGroup
    : `section:${section.name}`;
}

export class TokenBudget {
  constructor(private readonly counter: TokenCounter) {}

  /**
   * 为 IR 中所有消息填充 tokenCount
   * 返回新的 IR（不修改原对象）
   */
  estimate(ir: PromptIR): PromptIR {
    return {
      ...ir,
      sections: ir.sections.map((section) => ({
        ...section,
        messages: section.messages.map((msg) => ({
          ...msg,
          tokenCount: msg.tokenCount ?? this.counter.count(msg.content),
        })),
      })),
    };
  }

  /**
   * 根据预算裁剪 IR
   *
   * 策略：
   * 1. pinned 分区的消息不参与裁剪
   * 2. 非 prunable 消息不参与裁剪（prunable 默认 true）
   * 3. 按 priority 从大到小淘汰（数值大 = 优先淘汰）
   * 4. 同 priority 按全局位置从前到后淘汰（旧消息先淘汰）
   */
  prune(ir: PromptIR): { ir: PromptIR; prunedCount: number; prunedTokensByGroup: Record<string, number> } {
    // 先确保所有消息都有 tokenCount
    const estimated = this.estimate(ir);

    const { maxTokens, reservedForReply } = estimated.metadata;
    const budget = maxTokens - reservedForReply;

    // 计算 pinned 分区和 non-prunable 消息的固定 token
    let fixedTokens = 0;
    const candidates: PruneCandidate[] = [];
    let globalIndex = 0;

    for (let si = 0; si < estimated.sections.length; si++) {
      const section = estimated.sections[si]!;

      for (let mi = 0; mi < section.messages.length; mi++) {
        const msg = section.messages[mi]!;
        const tokens = msg.tokenCount ?? 0;

        const isPrunable = !section.pinned && msg.prunable !== false;

        if (!isPrunable) {
          fixedTokens += tokens;
        } else {
          const budgetGroup = resolveSectionBudgetGroupName(section);
          candidates.push({
            sectionIndex: si,
            messageIndex: mi,
            message: msg,
            globalIndex,
            budgetGroup,
          });
        }

        globalIndex++;
      }
    }

    const availableForPrunable = Math.max(0, budget - fixedTokens);

    // 排序：priority 小（高优先保留）在前，同 priority 按 globalIndex 大（新消息）在前
    // 这样我们从前往后累加，能保留的就保留
    candidates.sort((a, b) => {
      const pa = a.message.priority ?? 0;
      const pb = b.message.priority ?? 0;
      if (pa !== pb) return pa - pb; // priority 小的先保留
      return b.globalIndex - a.globalIndex; // 新消息优先保留
    });

    // 标记哪些消息被保留
    const pruneSet = new Set<string>(); // "sectionIndex:messageIndex"
    let usedTokens = 0;
    const prunedTokensByGroup: Record<string, number> = {};

    for (const candidate of candidates) {
      const tokens = candidate.message.tokenCount ?? 0;
      if (usedTokens + tokens <= availableForPrunable) {
        usedTokens += tokens;
        // 保留
      } else {
        prunedTokensByGroup[candidate.budgetGroup] = (prunedTokensByGroup[candidate.budgetGroup] ?? 0) + tokens;
        pruneSet.add(`${candidate.sectionIndex}:${candidate.messageIndex}`);
      }
    }

    // 构建裁剪后的 IR
    const prunedSections: IRSection[] = estimated.sections.map((section, si) => ({
      ...section,
      messages: section.messages.filter(
        (_, mi) => !pruneSet.has(`${si}:${mi}`)
      ),
    }));

    return {
      ir: {
        ...estimated,
        sections: prunedSections,
      },
      prunedCount: pruneSet.size,
      prunedTokensByGroup,
    };
  }
}
