// ── Chat Role ─────────────────────────────────────────

/** LLM 消息角色 */
export type ChatRole = 'system' | 'user' | 'assistant';

// ── Prompt IR ─────────────────────────────────────────

/**
 * IR 消息：Prompt IR 的最小单元
 *
 * 每条消息携带角色、内容、以及用于裁剪决策的元数据。
 */
export interface IRMessage {
  /** 消息角色 */
  role: ChatRole;
  /** 消息内容（纯文本） */
  content: string;
  /** 消息来源标记，用于调试追溯（如 'system_prompt', 'worldbook:entry_42'） */
  source?: string;
  /** token 估算值（由 TokenBudget.estimate 填充） */
  tokenCount?: number;
  /** 是否可被裁剪（默认 true；系统提示通常设为 false） */
  prunable?: boolean;
  /** 裁剪优先级（0 = 最高优先保留，数值越大越先被裁剪） */
  priority?: number;
}

/**
 * IR 分区：按逻辑分组的消息块
 *
 * 典型分区：system_prompt, worldbook, history, jailbreak, memory 等。
 */
export interface IRSection {
  /** 分区名称 */
  name: string;
  /** 该分区的消息列表 */
  messages: IRMessage[];
  /** 分区是否固定（固定分区不参与裁剪） */
  pinned?: boolean;
  /** 分区排序权重（数值小的排前面） */
  order: number;
}

/**
 * 完整的 Prompt IR
 *
 * 所有编排路径（compat / native）的输出都是 PromptIR，
 * 所有渲染器的输入也是 PromptIR。
 */
export interface PromptIR {
  /** 所有分区 */
  sections: IRSection[];
  /** 全局元信息 */
  metadata: PromptMetadata;
}

/** Prompt 元信息 */
export interface PromptMetadata {
  /** 最大 token 预算（包含回复预留） */
  maxTokens: number;
  /** 预留给 LLM 回复的 token 数 */
  reservedForReply: number;
  /** 使用的 token 计数方式标识 */
  tokenizer?: string;
}

// ── Token Counter ─────────────────────────────────────

/**
 * Token 计数策略接口
 *
 * 通过接口注入不同的计数实现（简单估算 / tiktoken / 模型自带计数）。
 */
export interface TokenCounter {
  /** 估算字符串的 token 数 */
  count(text: string): number;
  /** 计数器标识名 */
  name: string;
}

// ── 拼装输出 ──────────────────────────────────────────

/** 最终发给 LLM 的单条消息 */
export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/** 消息拼装结果 */
export interface AssembledPrompt {
  /** 最终消息数组 */
  messages: ChatMessage[];
  /** token 使用统计 */
  tokenUsage: {
    /** 总 token 数 */
    total: number;
    /** 各分区 token 占用 */
    bySection: Record<string, number>;
    /** 留给回复的 token 数 */
    availableForReply: number;
  };
  /** 被裁剪的消息数量 */
  prunedCount: number;
}

/**
 * 单轮 Prompt 快照记录。
 *
 * 用于记录某个 floor 在实际生成时冻结使用的 Prompt 资源版本与摘要信息。
 */
export interface PromptSnapshotRecord {
  floorId: string;
  sessionId: string;
  presetId: string | null;
  presetUpdatedAt: number | null;
  presetVersion: number | null;
  worldbookId: string | null;
  worldbookUpdatedAt: number | null;
  worldbookVersion: number | null;
  regexProfileId: string | null;
  regexProfileUpdatedAt: number | null;
  regexProfileVersion: number | null;
  worldbookActivatedEntryUids: number[];
  regexPreRuleNames: string[];
  regexPostRuleNames: string[];
  promptMode: 'native' | 'compat_plus' | 'compat_strict';
  promptDigest: string;
  tokenEstimate: number;
  createdAt: number;
}
