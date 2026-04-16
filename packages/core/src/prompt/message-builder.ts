import type {
  PromptIR,
  ChatMessage,
  AssembledPrompt,
  TokenCounter,
  IRMessage,
  IRSection,
} from './types.js';
import { TokenBudget, resolveSectionBudgetGroupName } from './token-budget.js';

/** 拼装选项 */
export interface MessageBuilderOptions {
  /**
   * 是否合并相邻同 role 消息
   * 合并时用 `\n\n` 连接 content
   * 默认 false
   */
  mergeAdjacentSameRole?: boolean;
}

interface FlattenedSectionMessage {
  sectionName: string;
  message: IRMessage;
  budgetGroup: string;
}

/**
 * 消息拼装器
 *
 * 将 Prompt IR 转换为 LLM 接受的 messages[] 格式。
 * 完整流程：estimate → prune → assemble
 */
export class MessageBuilder {
  private readonly tokenBudget: TokenBudget;

  constructor(
    private readonly counter: TokenCounter,
    private readonly options: MessageBuilderOptions = {}
  ) {
    this.tokenBudget = new TokenBudget(counter);
  }

  /**
   * 完整流程：estimate → prune → assemble
   */
  build(
    ir: PromptIR,
    options: {
      groupPolicies?: Array<{
        group: string;
        minTokens?: number;
        maxTokens?: number;
        targetTokens?: number;
        weight?: number;
        pruneOrder?: number;
      }>;
    } = {},
  ): AssembledPrompt {
    const { ir: prunedIR, prunedCount, prunedTokensByGroup, allocator } = this.tokenBudget.prune(ir, {
      groupPolicies: options.groupPolicies,
    });
    return this.assemble(prunedIR, prunedCount, prunedTokensByGroup, allocator);
  }

  /**
   * 将 IR 按分区排序 → 展开插入位 → 扁平化 → 可选合并 → 统计
   */
  assemble(
    ir: PromptIR,
    prunedCount: number = 0,
    prunedTokensByGroup: Record<string, number> = {},
    allocator?: AssembledPrompt['tokenUsage']['allocator'],
  ): AssembledPrompt {
    const sortedSections = [...ir.sections].sort((a, b) => a.order - b.order);
    const expandedMessages = this.expandSections(sortedSections);

    const flatMessages: ChatMessage[] = [];
    const bySection: Record<string, number> = {};
    const byGroup: Record<string, number> = {};
    let totalTokens = 0;

    for (const item of expandedMessages) {
      const tokens = item.message.tokenCount ?? this.counter.count(item.message.content);
      flatMessages.push({
        role: item.message.role,
        content: item.message.content,
      });
      bySection[item.sectionName] = (bySection[item.sectionName] ?? 0) + tokens;
      byGroup[item.budgetGroup] = (byGroup[item.budgetGroup] ?? 0) + tokens;
      totalTokens += tokens;
    }

    const finalMessages = this.options.mergeAdjacentSameRole
      ? this.mergeAdjacent(flatMessages)
      : flatMessages;

    let finalTotal = totalTokens;
    if (this.options.mergeAdjacentSameRole && finalMessages.length !== flatMessages.length) {
      finalTotal = 0;
      for (const msg of finalMessages) {
        finalTotal += this.counter.count(msg.content);
      }
    }

    const availableForReply = Math.max(
      0,
      ir.metadata.maxTokens - finalTotal
    );

    return {
      messages: finalMessages,
      tokenUsage: {
        total: finalTotal,
        bySection,
        byGroup,
        prunedByGroup: prunedTokensByGroup,
        ...(allocator ? { allocator } : {}),
        availableForReply,
      },
      prunedCount,
    };
  }

  private expandSections(sections: IRSection[]): FlattenedSectionMessage[] {
    const relativeSections = sections.filter((section) => section.insertion?.kind !== 'in_chat');
    const inChatSections = sections.filter((section) => section.insertion?.kind === 'in_chat');
    const chatHistorySectionIndex = relativeSections.findIndex((section) => section.semantic === 'chat_history');
    const expanded: FlattenedSectionMessage[] = [];

    for (let index = 0; index < relativeSections.length; index++) {
      const section = relativeSections[index]!;
      const budgetGroup = resolveSectionBudgetGroupName(section);
      if (index === chatHistorySectionIndex) {
        expanded.push(...this.expandChatHistorySection(section, inChatSections));
        continue;
      }

      expanded.push(...section.messages.map((message) => ({
        sectionName: section.name,
        budgetGroup,
        message,
      })));
    }

    if (chatHistorySectionIndex < 0 && inChatSections.length > 0) {
      const fallbackSections = [...inChatSections].sort((left, right) => left.order - right.order);
      for (const section of fallbackSections) {
        const budgetGroup = resolveSectionBudgetGroupName(section);
        expanded.push(...section.messages.map((message) => ({
          sectionName: section.name,
          budgetGroup,
          message,
        })));
      }
    }

    return expanded;
  }

  private expandChatHistorySection(section: IRSection, inChatSections: IRSection[]): FlattenedSectionMessage[] {
    const historyBudgetGroup = resolveSectionBudgetGroupName(section);
    const prefixMessages = section.messages.filter((message) => typeof message.priority !== 'number');
    const historyMessages = section.messages.filter((message) => typeof message.priority === 'number');
    const historyLength = historyMessages.length;
    const buckets = new Map<number, IRSection[]>();

    const sortedInsertions = [...inChatSections].sort((left, right) => {
      const leftDepth = left.insertion?.depth ?? 0;
      const rightDepth = right.insertion?.depth ?? 0;
      if (leftDepth !== rightDepth) {
        return leftDepth - rightDepth;
      }

      const leftOrder = left.insertion?.order ?? 0;
      const rightOrder = right.insertion?.order ?? 0;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }

      const leftRolePriority = this.rolePriority(left.messages[0]?.role);
      const rightRolePriority = this.rolePriority(right.messages[0]?.role);
      if (leftRolePriority !== rightRolePriority) {
        return leftRolePriority - rightRolePriority;
      }

      return left.order - right.order;
    });

    for (const inChatSection of sortedInsertions) {
      const depth = Math.max(0, inChatSection.insertion?.depth ?? 0);
      const insertIndex = Math.max(0, Math.min(historyLength, historyLength - depth));
      const bucket = buckets.get(insertIndex) ?? [];
      bucket.push(inChatSection);
      buckets.set(insertIndex, bucket);
    }

    const expanded: FlattenedSectionMessage[] = prefixMessages.map((message) => ({
      sectionName: section.name,
      budgetGroup: historyBudgetGroup,
      message,
    }));

    for (let position = 0; position <= historyLength; position++) {
      const bucket = buckets.get(position) ?? [];
      for (const bucketSection of bucket) {
        const budgetGroup = resolveSectionBudgetGroupName(bucketSection);
        expanded.push(...bucketSection.messages.map((message) => ({
          sectionName: bucketSection.name,
          budgetGroup,
          message,
        })));
      }

      if (position < historyLength) {
        expanded.push({
          sectionName: section.name,
          budgetGroup: historyBudgetGroup,
          message: historyMessages[position]!,
        });
      }
    }

    return expanded;
  }

  private rolePriority(role: ChatMessage['role'] | undefined): number {
    switch (role) {
      case 'user':
        return 0;
      case 'assistant':
        return 1;
      case 'system':
      default:
        return 2;
    }
  }

  /**
   * 合并相邻同 role 消息
   */
  private mergeAdjacent(messages: ChatMessage[]): ChatMessage[] {
    if (messages.length === 0) return [];

    const merged: ChatMessage[] = [];
    let current = { ...messages[0]! };

    for (let i = 1; i < messages.length; i++) {
      const next = messages[i]!;
      if (next.role === current.role) {
        current.content += '\n\n' + next.content;
      } else {
        merged.push(current);
        current = { ...next };
      }
    }

    merged.push(current);
    return merged;
  }
}
