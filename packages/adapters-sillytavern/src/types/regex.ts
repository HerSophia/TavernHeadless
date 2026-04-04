// ── ST Regex Script 兼容类型 ───────────────────────────

/** 正则脚本应用位置 */
export const REGEX_PLACEMENT = {
  /** Markdown 显示层（兼容保留） */
  MD_DISPLAY: 0,
  /** 用户输入 */
  USER_INPUT: 1,
  /** AI 输出 */
  AI_OUTPUT: 2,
  /** 斜杠命令（兼容保留） */
  SLASH_COMMAND: 3,
  /** 世界书内容 */
  WORLD_INFO: 5,
  /** Reasoning（兼容保留） */
  REASONING: 6,
} as const;

export type RegexPlacement = (typeof REGEX_PLACEMENT)[keyof typeof REGEX_PLACEMENT];

/** 正则查找中的变量替换模式 */
export const SUBSTITUTE_REGEX = {
  /** 不替换 */
  NONE: 0,
  /** 原样替换 */
  RAW: 1,
  /** 转义后替换 */
  ESCAPED: 2,
} as const;

export type SubstituteRegex = (typeof SUBSTITUTE_REGEX)[keyof typeof SUBSTITUTE_REGEX];

/**
 * SillyTavern Regex Script 兼容类型。
 *
 * 这里保留 ST 原始兼容字段，是否执行由运行时决定。
 */
export interface STRegexScript {
  /** 脚本 UUID */
  id: string;
  /** 脚本名称 */
  scriptName: string;
  /** 查找正则表达式（字符串形式） */
  findRegex: string;
  /** 替换字符串（支持 $1 等捕获组） */
  replaceString: string;
  /** 裁剪字符串列表 */
  trimStrings: string[];
  /** 应用位置列表 */
  placement: number[];
  /** 是否禁用 */
  disabled: boolean;
  /** 是否仅影响 Markdown / display */
  markdownOnly: boolean;
  /** 是否仅影响 outgoing prompt */
  promptOnly: boolean;
  /** 是否在编辑后执行 */
  runOnEdit: boolean;
  /** 变量替换模式 */
  substituteRegex: SubstituteRegex;
  /** 最小深度 */
  minDepth: number;
  /** 最大深度 */
  maxDepth: number;
}
