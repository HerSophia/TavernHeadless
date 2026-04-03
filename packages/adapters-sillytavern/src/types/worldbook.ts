// ── ST WorldBook 精简类型 ──────────────────────────────
// 原始酒馆世界书条目有较多字段，这里保留当前运行时需要的核心字段，
// 并额外保留递归 / outlet 对齐所需字段。

/** 世界书条目插入位置 */
export const WI_POSITION = {
  /** 角色定义之前 */
  BEFORE: 0,
  /** 角色定义之后 */
  AFTER: 1,
  /** Author's Note 之上 */
  AN_TOP: 2,
  /** Author's Note 之下 */
  AN_BOTTOM: 3,
  /** 指定深度 */
  AT_DEPTH: 4,
  /** 示例消息之上 */
  EM_TOP: 5,
  /** 示例消息之下 */
  EM_BOTTOM: 6,
  /** Outlet 宏展开槽位 */
  OUTLET: 7,
} as const;

export type WIPosition = (typeof WI_POSITION)[keyof typeof WI_POSITION];

/** 世界书条目 selective 逻辑 */
export const WI_LOGIC = {
  /** 主关键词命中 + 至少一个辅助关键词命中 */
  AND_ANY: 0,
  /** 主关键词命中 + 不是所有辅助关键词都命中 */
  NOT_ALL: 1,
  /** 主关键词命中 + 没有辅助关键词命中 */
  NOT_ANY: 2,
  /** 主关键词命中 + 所有辅助关键词都命中 */
  AND_ALL: 3,
} as const;

export type WILogic = (typeof WI_LOGIC)[keyof typeof WI_LOGIC];

/** 消息角色 */
export const WI_ROLE = {
  SYSTEM: 0,
  USER: 1,
  ASSISTANT: 2,
} as const;

export type WIRole = (typeof WI_ROLE)[keyof typeof WI_ROLE];

/**
 * 精简后的世界书条目
 */
export interface STWorldBookEntry {
  /** 条目唯一 ID */
  uid: number;
  /** 主关键词 */
  key: string[];
  /** 辅助关键词 */
  keysecondary: string[];
  /** 是否启用辅助关键词 */
  selective: boolean;
  /** 辅助关键词逻辑 */
  selectiveLogic: WILogic;
  /** 常驻条目（无需触发） */
  constant: boolean;
  /** 注入的文本内容 */
  content: string;
  /** 标题/备注 */
  comment: string;
  /** 插入位置 */
  position: WIPosition;
  /** 插入优先级（数值大 = 高优先） */
  order: number;
  /** @depth 模式的深度 */
  depth: number;
  /** 消息角色（用于 @depth 模式） */
  role: WIRole;
  /** 是否禁用 */
  disable: boolean;
  /** 独立扫描深度（null = 使用全局） */
  scanDepth: number | null;
  /** 独立大小写设置（null = 使用全局） */
  caseSensitive: boolean | null;
  /** 独立全词匹配（null = 使用全局） */
  matchWholeWords: boolean | null;
  /** 仅允许初始轮触发，递归轮跳过 */
  excludeRecursion?: boolean;
  /** 条目本身可触发，但内容不进入递归缓冲区 */
  preventRecursion?: boolean;
  /** 至少递归到指定层级后才允许触发；null 表示关闭 */
  delayUntilRecursion?: number | null;
  /** Outlet 位置使用的名称 */
  outletName?: string;
  /** 暂未接运行时、但需要保留 round-trip 的扩展字段 */
  extra?: Record<string, unknown>;
}

/**
 * 精简后的世界书
 */
export interface STWorldBook {
  /** 世界书名称 */
  name: string;
  /** 所有条目 */
  entries: STWorldBookEntry[];

  // ── 全局设置 ──

  /** 全局扫描深度（扫描最近 N 条消息） */
  scanDepth: number;
  /** 全局大小写敏感 */
  caseSensitive: boolean;
  /** 全局全词匹配 */
  matchWholeWords: boolean;
  /** 是否启用递归扫描 */
  recursive: boolean;
  /** 最大递归步数 */
  maxRecursionSteps: number;
  /** 暂未接运行时、但需要保留 round-trip 的顶层字段 */
  extra?: Record<string, unknown>;
}
