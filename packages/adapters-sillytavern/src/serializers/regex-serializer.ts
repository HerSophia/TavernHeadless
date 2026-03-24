// ── STRegexScript[] → ST 原始正则数组 ─────────────────

import type { STRegexScript } from '../types/regex.js';

/**
 * ST 原始正则脚本（含导入时被丢弃的字段）。
 */
export interface STRawRegexScript extends STRegexScript {
  markdownOnly: boolean;
  promptOnly: boolean;
  runOnEdit: boolean;
}

/**
 * 将 TH 精简格式的正则脚本数组转换回 ST 原始格式。
 *
 * 补回导入时丢弃的 3 个字段，均使用安全的默认值：
 * - markdownOnly: false（存活的脚本一定不是 markdownOnly）
 * - promptOnly: false
 * - runOnEdit: false
 */
export function scriptsToStRegexArray(
  scripts: STRegexScript[],
): STRawRegexScript[] {
  return scripts.map((s) => ({
    ...s,
    markdownOnly: false,
    promptOnly: false,
    runOnEdit: false,
  }));
}
