// ── ST Regex Script 精简类型 ───────────────────────────
// 原始酒馆正则有 12 个字段，这里保留 ~10 个核心字段。
// 砍掉：markdownOnly（我们不做 MD 渲染）、runOnEdit（UI 行为）

/** 正则脚本应用位置 */
export const REGEX_PLACEMENT = {
  /** 用户输入 */
  USER_INPUT: 1,
  /** AI 输出 */
  AI_OUTPUT: 2,
  /** 斜杠命令（不使用） */
  SLASH_COMMAND: 3,
  /** 世界书内容 */
  WORLD_INFO: 5,
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
 * 精简后的正则脚本
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
  /** 变量替换模式 */
  substituteRegex: SubstituteRegex;
  /** 最小深度 */
  minDepth: number;
  /** 最大深度 */
  maxDepth: number;
}
