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
 * 解析酒馆正则脚本 JSON 数组，返回 STRegexScript[]。
 *
 * 该函数只负责结构校验和默认值补齐，不负责按当前后端执行能力裁剪字段。
 *
 * @throws {z.ZodError} JSON 结构不符合预期时
 */
export function parseRegexScripts(json: unknown): STRegexScript[] {
  const rawScripts = rawRegexArraySchema.parse(json);

  return rawScripts.map((s) => ({
    id: s.id,
    scriptName: s.scriptName,
    findRegex: s.findRegex,
    replaceString: s.replaceString,
    trimStrings: s.trimStrings,
    placement: s.placement,
    disabled: s.disabled,
    markdownOnly: s.markdownOnly,
    promptOnly: s.promptOnly,
    runOnEdit: s.runOnEdit,
    substituteRegex: s.substituteRegex as STRegexScript['substituteRegex'],
    minDepth: s.minDepth,
    maxDepth: s.maxDepth,
  }));
}
