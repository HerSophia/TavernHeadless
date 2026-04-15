import type { PromptIR, IRMessage, IRSection, PromptTrimReason, TokenCounter } from './types.js';

import {
  allocatePromptBudget,
  buildPromptBudgetTrimReasons,
  type PromptBudgetGroupPolicy,
} from './budget-allocator.js';
import { buildPromptRuntimeSectionBudgetGroup } from './runtime-registry.js';

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

interface PromptBudgetAllocatorTrace {
  estimatedByGroup: Record<string, number>;
  allocatedByGroup: Record<string, number>;
  trimReasons: PromptTrimReason[];
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
    : buildPromptRuntimeSectionBudgetGroup(section.name);
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
  prune(
    ir: PromptIR,
    options: { groupPolicies?: PromptBudgetGroupPolicy[] } = {},
  ): {
    ir: PromptIR;
    prunedCount: number;
    prunedTokensByGroup: Record<string, number>;
    allocator?: PromptBudgetAllocatorTrace;
  } {
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

    const pruneSet = new Set<string>(); // "sectionIndex:messageIndex"
    let allocatorTrace: PromptBudgetAllocatorTrace | undefined;
    let prunedTokensByGroup: Record<string, number> = {};

    if (options.groupPolicies && options.groupPolicies.length > 0) {
      const candidatesByGroup = new Map<string, PruneCandidate[]>();
      const estimatedByGroup: Record<string, number> = {};

      for (const candidate of candidates) {
        const bucket = candidatesByGroup.get(candidate.budgetGroup) ?? [];
        bucket.push(candidate);
        candidatesByGroup.set(candidate.budgetGroup, bucket);
        estimatedByGroup[candidate.budgetGroup] = (estimatedByGroup[candidate.budgetGroup] ?? 0) + (candidate.message.tokenCount ?? 0);
      }

      const allocation = allocatePromptBudget({
        availableTokens: availableForPrunable,
        estimatedByGroup,
        groupPolicies: options.groupPolicies,
      });
      const groupResultByName = new Map(
        allocation.groupResults.map((groupResult) => [groupResult.group, groupResult]),
      );
      const keptCandidates = new Set<string>();
      const retainedByGroup: Record<string, number> = {};
      let retainedTokens = 0;

      for (const [group, groupCandidates] of candidatesByGroup) {
        groupCandidates.sort(comparePruneCandidatesByRetentionPriority);
        const provisionalLimit = allocation.allocatedByGroup[group] ?? 0;
        let retainedInGroup = 0;

        for (const candidate of groupCandidates) {
          const tokens = candidate.message.tokenCount ?? 0;
          if (retainedInGroup + tokens <= provisionalLimit) {
            retainedInGroup += tokens;
            retainedByGroup[group] = (retainedByGroup[group] ?? 0) + tokens;
            retainedTokens += tokens;
            keptCandidates.add(createPruneCandidateKey(candidate));
          }
        }
      }

      const reconciliationCandidates = candidates
        .filter((candidate) => !keptCandidates.has(createPruneCandidateKey(candidate)))
        .sort((left, right) => {
          const leftResult = groupResultByName.get(left.budgetGroup);
          const rightResult = groupResultByName.get(right.budgetGroup);
          const leftPruneOrder = leftResult?.policy.pruneOrder ?? 0;
          const rightPruneOrder = rightResult?.policy.pruneOrder ?? 0;

          if (leftPruneOrder !== rightPruneOrder) {
            return rightPruneOrder - leftPruneOrder;
          }

          return comparePruneCandidatesByRetentionPriority(left, right);
        });

      for (const candidate of reconciliationCandidates) {
        const groupResult = groupResultByName.get(candidate.budgetGroup);
        if (!groupResult) {
          continue;
        }

        const tokens = candidate.message.tokenCount ?? 0;
        const retainedInGroup = retainedByGroup[candidate.budgetGroup] ?? 0;
        if (retainedTokens + tokens > availableForPrunable) {
          continue;
        }

        if (retainedInGroup + tokens > groupResult.hardCapTokens) {
          continue;
        }

        retainedByGroup[candidate.budgetGroup] = retainedInGroup + tokens;
        retainedTokens += tokens;
        keptCandidates.add(createPruneCandidateKey(candidate));
      }

      for (const [group, estimatedTokensByGroup] of Object.entries(allocation.estimatedByGroup)) {
        const retainedInGroup = retainedByGroup[group] ?? 0;
        const prunedInGroup = Math.max(0, estimatedTokensByGroup - retainedInGroup);
        if (prunedInGroup > 0) {
          prunedTokensByGroup[group] = prunedInGroup;
        }
      }

      for (const candidate of candidates) {
        const key = createPruneCandidateKey(candidate);
        if (!keptCandidates.has(key)) {
          pruneSet.add(key);
        }
      }

      allocatorTrace = {
        estimatedByGroup: allocation.estimatedByGroup,
        allocatedByGroup: allocation.allocatedByGroup,
        trimReasons: buildPromptBudgetTrimReasons({
          availableTokens: availableForPrunable,
          groupResults: allocation.groupResults,
          retainedByGroup,
        }),
      };
    } else {
      candidates.sort(comparePruneCandidatesByRetentionPriority);
      prunedTokensByGroup = {};
      let usedTokens = 0;

      for (const candidate of candidates) {
        const tokens = candidate.message.tokenCount ?? 0;
        if (usedTokens + tokens <= availableForPrunable) {
          usedTokens += tokens;
          continue;
        }

        prunedTokensByGroup[candidate.budgetGroup] = (prunedTokensByGroup[candidate.budgetGroup] ?? 0) + tokens;
        pruneSet.add(createPruneCandidateKey(candidate));
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
      ...(allocatorTrace ? { allocator: allocatorTrace } : {}),
    };
  }
}

function createPruneCandidateKey(candidate: PruneCandidate): string {
  return `${candidate.sectionIndex}:${candidate.messageIndex}`;
}

function comparePruneCandidatesByRetentionPriority(a: PruneCandidate, b: PruneCandidate): number {
  const pa = a.message.priority ?? 0;
  const pb = b.message.priority ?? 0;
  if (pa !== pb) {
    return pa - pb;
  }

  return b.globalIndex - a.globalIndex;
}
