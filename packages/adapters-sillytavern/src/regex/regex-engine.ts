import type { STRegexScript } from '../types/regex.js';
import { SUBSTITUTE_REGEX } from '../types/regex.js';

// ── 公开类型 ──────────────────────────────────────────

/** 正则脚本执行上下文 */
export interface RegexContext {
  /**
   * 变量替换函数（用于 substituteRegex 模式）。
   * 接收一段含 {{var}} 的文本，返回替换后的文本。
   */
  substituteParams?: (text: string) => string;
}

// ── 内部工具 ──────────────────────────────────────────

/**
 * 将字符串形式的正则表达式解析为 RegExp 对象。
 * 支持格式：/pattern/flags 或纯字符串（视为全局匹配）。
 */
function parseRegexString(regexStr: string): RegExp | null {
  if (!regexStr) return null;

  // 尝试 /pattern/flags 格式
  const match = regexStr.match(/^\/([\w\W]+?)\/([gimsuy]*)$/);
  if (match) {
    try {
      return new RegExp(match[1]!, match[2]);
    } catch {
      return null;
    }
  }

  // 纯字符串 → 视为全局匹配
  try {
    return new RegExp(regexStr, 'g');
  } catch {
    return null;
  }
}

/**
 * 对正则表达式的源文本做变量替换。
 * RAW 模式直接替换，ESCAPED 模式会对替换后的值做正则转义。
 */
function substituteRegexPattern(
  findRegex: string,
  mode: number,
  substituteParams?: (text: string) => string,
): string {
  if (mode === SUBSTITUTE_REGEX.NONE || !substituteParams) {
    return findRegex;
  }

  if (mode === SUBSTITUTE_REGEX.ESCAPED) {
    // 先替换，再对 {{}} 宏结果进行正则转义
    // 策略：先找到所有宏位置，替换后转义
    return findRegex.replace(/\{\{[^}]+\}\}/g, (match) => {
      const replaced = substituteParams(match);
      // 转义正则特殊字符
      return replaced.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    });
  }

  // RAW: 直接替换
  return substituteParams(findRegex);
}

/**
 * 执行单个正则脚本的 trimStrings 操作。
 */
function applyTrimStrings(text: string, trimStrings: string[]): string {
  let result = text;
  for (const trim of trimStrings) {
    if (!trim) continue;
    // trimStrings 支持多次替换
    while (result.includes(trim)) {
      result = result.replace(trim, '');
    }
  }
  return result;
}

// ── 主函数 ────────────────────────────────────────────

/**
 * 执行正则脚本列表对文本进行处理。
 *
 * 执行逻辑：
 * 1. 过滤 disabled 脚本
 * 2. 过滤不匹配 placement 的脚本
 * 3. 按数组顺序依次执行
 * 4. 对 findRegex 应用变量替换（如果 substituteRegex > 0）
 * 5. 执行正则替换
 * 6. 执行 trimStrings 裁剪
 *
 * @param text - 要处理的文本
 * @param scripts - 正则脚本列表
 * @param placement - 当前应用位置（如 REGEX_PLACEMENT.AI_OUTPUT）
 * @param context - 执行上下文（变量替换等）
 * @returns 处理后的文本
 */
export function applyRegexScripts(
  text: string,
  scripts: STRegexScript[],
  placement: number,
  context?: RegexContext,
): string {
  let result = text;

  for (const script of scripts) {
    // 跳过禁用脚本
    if (script.disabled) continue;

    // 跳过不匹配 placement 的脚本
    if (!script.placement.includes(placement)) continue;

    // 变量替换
    const processedFind = substituteRegexPattern(
      script.findRegex,
      script.substituteRegex,
      context?.substituteParams,
    );

    // 解析正则
    const regex = parseRegexString(processedFind);
    if (!regex) continue;

    // 执行替换
    result = result.replace(regex, script.replaceString);

    // 执行 trimStrings
    if (script.trimStrings.length > 0) {
      result = applyTrimStrings(result, script.trimStrings);
    }
  }

  return result;
}
