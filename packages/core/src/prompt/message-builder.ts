import type {
  PromptIR,
  ChatMessage,
  AssembledPrompt,
  TokenCounter,
} from './types.js';
import { TokenBudget } from './token-budget.js';

/** 拼装选项 */
export interface MessageBuilderOptions {
  /**
   * 是否合并相邻同 role 消息
   * 合并时用 `\n\n` 连接 content
   * 默认 false
   */
  mergeAdjacentSameRole?: boolean;
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
  build(ir: PromptIR): AssembledPrompt {
    const { ir: prunedIR, prunedCount } = this.tokenBudget.prune(ir);
    return this.assemble(prunedIR, prunedCount);
  }

  /**
   * 将 IR 按分区排序 → 扁平化 → 可选合并 → 统计
   */
  assemble(ir: PromptIR, prunedCount: number = 0): AssembledPrompt {
    // 1. 按 order 排序分区
    const sortedSections = [...ir.sections].sort((a, b) => a.order - b.order);

    // 2. 扁平化为 ChatMessage[]，同时统计各分区 token
    const flatMessages: ChatMessage[] = [];
    const bySection: Record<string, number> = {};
    let totalTokens = 0;

    for (const section of sortedSections) {
      let sectionTokens = 0;

      for (const msg of section.messages) {
        const tokens = msg.tokenCount ?? this.counter.count(msg.content);
        sectionTokens += tokens;

        flatMessages.push({
          role: msg.role,
          content: msg.content,
        });
      }

      if (section.messages.length > 0) {
        bySection[section.name] = (bySection[section.name] ?? 0) + sectionTokens;
      }
      totalTokens += sectionTokens;
    }

    // 3. 可选：合并相邻同 role 消息
    const finalMessages = this.options.mergeAdjacentSameRole
      ? this.mergeAdjacent(flatMessages)
      : flatMessages;

    // 如果合并了消息，需要重新计算 token
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
        availableForReply,
      },
      prunedCount,
    };
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
