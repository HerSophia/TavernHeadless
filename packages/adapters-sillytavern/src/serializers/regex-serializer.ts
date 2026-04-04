// ── STRegexScript[] → ST 原始正则数组 ─────────────────

import type { STRegexScript } from '../types/regex.js';

/**
 * ST 原始正则脚本。
 *
 * 当前内部存储已经保留 ST 兼容字段，因此这里直接复用同一结构。
 */
export type STRawRegexScript = STRegexScript;

/**
 * 将内部存储的正则脚本数组转换回 ST 兼容格式。
 *
 * 对历史旧数据中缺失的兼容字段使用安全默认值，以保证导出稳定。
 */
export function scriptsToStRegexArray(
  scripts: STRegexScript[],
): STRawRegexScript[] {
  return scripts.map((s) => ({
    id: s.id ?? '',
    scriptName: s.scriptName ?? '',
    findRegex: s.findRegex ?? '',
    replaceString: s.replaceString ?? '',
    trimStrings: Array.isArray(s.trimStrings) ? [...s.trimStrings] : [],
    placement: Array.isArray(s.placement) ? [...s.placement] : [],
    disabled: Boolean(s.disabled),
    markdownOnly: Boolean(s.markdownOnly),
    promptOnly: Boolean(s.promptOnly),
    runOnEdit: Boolean(s.runOnEdit),
    substituteRegex: s.substituteRegex ?? 0,
    minDepth: s.minDepth ?? 0,
    maxDepth: s.maxDepth ?? 0,
  }));
}
