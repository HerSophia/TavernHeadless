import { z } from 'zod';
import type { STRegexScript } from '../types/regex.js';
import { SUBSTITUTE_REGEX } from '../types/regex.js';

// ── Raw Zod schema ────────────────────────────────────

const rawRegexScriptSchema = z.object({
  id: z.string().default(''),
  scriptName: z.string().default(''),
  findRegex: z.string(),
  replaceString: z.string().default(''),
  trimStrings: z.array(z.string()).default([]),
  placement: z.array(z.number()).default([]),
  disabled: z.boolean().default(false),
  markdownOnly: z.boolean().default(false),
  promptOnly: z.boolean().default(false),
  runOnEdit: z.boolean().default(false),
  substituteRegex: z.number().default(SUBSTITUTE_REGEX.NONE),
  minDepth: z.number().default(0),
  maxDepth: z.number().default(0),
}).passthrough();

const rawRegexArraySchema = z.array(rawRegexScriptSchema);

// ── 解析函数 ──────────────────────────────────────────

/**
 * 解析酒馆正则脚本 JSON 数组，返回精简的 STRegexScript[]。
 *
 * 过滤规则：
 * - markdownOnly=true 的脚本被过滤（我们不做 MD 渲染）
 * - placement 中的 MD_DISPLAY(0) 和 SLASH_COMMAND(3) 被移除
 *
 * @throws {z.ZodError} JSON 结构不符合预期时
 */
export function parseRegexScripts(json: unknown): STRegexScript[] {
  const rawScripts = rawRegexArraySchema.parse(json);

  return rawScripts
    // 过滤 markdownOnly
    .filter(s => !s.markdownOnly)
    .map(s => {
      // 过滤无用的 placement
      const filteredPlacement = s.placement.filter(p => p !== 0 && p !== 3);

      return {
        id: s.id,
        scriptName: s.scriptName,
        findRegex: s.findRegex,
        replaceString: s.replaceString,
        trimStrings: s.trimStrings,
        placement: filteredPlacement,
        disabled: s.disabled,
        substituteRegex: s.substituteRegex as STRegexScript['substituteRegex'],
        minDepth: s.minDepth,
        maxDepth: s.maxDepth,
      };
    })
    // 过滤掉没有有效 placement 的脚本
    .filter(s => s.placement.length > 0);
}
