import type { PromptRunIntent } from '@tavern/core';

// ── ST Preset 精简类型 ─────────────────────────────────
// 原始酒馆预设有 50+ 字段，这里只保留核心字段。

export type STPromptPlacement =
  | { kind: 'relative'; order: number }
  | { kind: 'in_chat'; depth: number; order: number };

export interface STPromptEntryBehavior {
  /** Prompt Manager triggers */
  triggers?: PromptRunIntent[];
  /** Prompt Manager placement */
  placement: STPromptPlacement;
}

/**
 * 预设中的提示词条目
 *
 * 对应酒馆 prompts[] 中的单个条目。
 * marker 类型的条目没有 content，只用于标记插入位置。
 */
export interface STPromptEntry {
  /** 唯一标识符（如 'main', 'nsfw', 'jailbreak', 'chatHistory'） */
  identifier: string;
  /** 显示名称 */
  name: string;
  /** 消息角色 */
  role?: 'system' | 'user' | 'assistant';
  /** 提示词内容（marker 类型没有此字段） */
  content?: string;
  /** 是否是位置标记（如 chatHistory, worldInfoBefore） */
  marker?: boolean;
  /** 是否启用（从 prompt_order 合并） */
  enabled?: boolean;
  /** Prompt Manager 行为元数据 */
  behavior?: STPromptEntryBehavior;
}

/** prompt_order 中的单个条目 */
export interface STPromptOrderItem {
  identifier: string;
  enabled: boolean;
}

/**
 * prompt_order 的单条上下文轨道
 *
 * 当前运行时仍只会选择一条 active 轨道执行，
 * 但 parser 会尽量保留所有轨道，供导入报告和后续升级使用。
 */
export interface STPromptOrderTrack {
  characterId: number;
  order: STPromptOrderItem[];
}

/**
 * ST preset 导入报告
 *
 * 用于说明当前 parser / runtime 的选择、忽略和降级情况。
 */
export interface STPresetImportReport {
  /** 当前选中的 prompt_order 轨道 character_id；若无 prompt_order 则为 null */
  selectedPromptOrderCharacterId: number | null;
  /** 被忽略的其他 prompt_order 轨道 character_id */
  ignoredPromptOrderCharacterIds: number[];
  /** 当前存在但未完整承接的字段路径 */
  unsupportedFields: string[];
  /** 当前被忽略的字段路径 */
  ignoredFields: string[];
  /** 已识别但被降级的条目 */
  downgradedEntries: Array<{
    identifier: string;
    reason: string;
  }>;
  /** 当前无法映射的 marker 标识 */
  unresolvedMarkers: string[];
  /** 额外提示信息 */
  warnings: string[];
}

/**
 * 精简后的 SillyTavern 预设
 *
 * 保留提示词定义、生成参数、特殊提示词、格式化设置。
 * 丢弃：模型选择、代理配置、UI 相关字段。
 */
export interface STPreset {
  // ── 提示词定义 ──

  /** 所有提示词条目（含 marker） */
  prompts: STPromptEntry[];
  /** 提示词拼装顺序（identifier 列表，仅包含 active 轨道中 enabled 的条目） */
  promptOrder: string[];
  /** 所有保留下来的 prompt_order 轨道 */
  promptOrderTracks?: STPromptOrderTrack[];
  /** 当前选中的 prompt_order 轨道 character_id；若无 prompt_order 则为 null */
  selectedPromptOrderCharacterId?: number | null;
  /** 导入报告 */
  importReport?: STPresetImportReport;

  // ── 生成参数 ──

  /** 最大上下文 token 数 */
  maxContext: number;
  /** 最大回复 token 数 */
  maxTokens: number;
  /** 采样温度 */
  temperature: number;
  /** Top-P 采样 */
  topP: number;
  /** Top-K 采样 */
  topK: number;
  /** Min-P 采样 */
  minP: number;
  /** 频率惩罚 */
  frequencyPenalty: number;
  /** 存在惩罚 */
  presencePenalty: number;
  /** 重复惩罚 */
  repetitionPenalty: number;

  // ── 特殊提示词 ──

  /** 新对话提示词 */
  newChatPrompt: string;
  /** 新示例对话提示词 */
  newExampleChatPrompt: string;
  /** 继续生成提示词 */
  continueNudgePrompt: string;
  /** 助手预填充 */
  assistantPrefill: string;

  // ── 格式化 ──

  /** 世界书格式模板（{0} 代表条目内容） */
  wiFormat: string;
  /** 名称行为：0=off, 1=always */
  namesBehavior: number;

  // ── 行为 ──

  /** 是否启用流式输出 */
  stream: boolean;
}
