import type { STRegexScript } from '../types/regex.js';
import { SUBSTITUTE_REGEX } from '../types/regex.js';

// ── 公开类型 ──────────────────────────────────────────

/** 正则执行通道 */
export type RegexExecutionChannel = 'persist' | 'prompt' | 'display' | 'edit';

/** 正则脚本执行上下文 */
export interface RegexContext {
  /**
   * findRegex 的宏替换函数（用于 substituteRegex 模式）。
   * 接收一段含 {{var}} 的文本，返回替换后的文本。
   */
  substituteFindParams?: (text: string) => string;
  /**
   * replaceString / trimStrings 的宏替换函数。
   */
  substituteReplaceParams?: (text: string) => string;
  /**
   * 当前消息深度。
   */
  depth?: number;
  /**
   * 当前执行通道。
   * - persist: 持久化文本
   * - prompt: 发给模型前的 prompt 文本
   * - display: 显示层文本
   * - edit: 编辑后重新应用
   */
  channel?: RegexExecutionChannel;
}

const DEFAULT_CHANNEL: RegexExecutionChannel = 'persist';

export type RegexTraceSkipReason =
  | 'channel_filtered'
  | 'depth_filtered'
  | 'invalid_regex'
  | 'no_match';

export interface RegexTraceSkippedRule {
  ruleName: string;
  reason: RegexTraceSkipReason;
}

export interface RegexExecutionTraceResult {
  text: string;
  candidateRuleNames: string[];
  matchedRuleNames: string[];
  skippedRules: RegexTraceSkippedRule[];
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
    return findRegex.replace(/\{\{[^}]+\}\}/g, (match) => {
      const replaced = substituteParams(match);
      return replaced.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    });
  }

  return substituteParams(findRegex);
}

function resolveChannel(context?: RegexContext): RegexExecutionChannel {
  return context?.channel ?? DEFAULT_CHANNEL;
}

function shouldRunForChannel(script: STRegexScript, channel: RegexExecutionChannel): boolean {
  if (channel === 'display') {
    return script.markdownOnly;
  }

  if (channel === 'prompt') {
    return script.promptOnly;
  }

  if (channel === 'edit') {
    return !script.markdownOnly && !script.promptOnly && script.runOnEdit;
  }

  return !script.markdownOnly && !script.promptOnly;
}

function shouldRunForDepth(script: STRegexScript, depth?: number): boolean {
  if (typeof depth !== 'number' || Number.isNaN(depth)) {
    return true;
  }

  if (typeof script.minDepth === 'number' && !Number.isNaN(script.minDepth) && script.minDepth >= -1 && depth < script.minDepth) {
    return false;
  }

  if (typeof script.maxDepth === 'number' && !Number.isNaN(script.maxDepth) && script.maxDepth >= 0 && depth > script.maxDepth) {
    return false;
  }

  return true;
}

function applyTrimStrings(
  text: string,
  trimStrings: string[],
  substituteReplaceParams?: (text: string) => string,
): string {
  let result = text;

  for (const trim of trimStrings) {
    if (!trim) continue;
    const resolvedTrim = substituteReplaceParams ? substituteReplaceParams(trim) : trim;
    if (!resolvedTrim) continue;
    result = result.split(resolvedTrim).join('');
  }

  return result;
}

function getNamedGroups(args: unknown[]): Record<string, unknown> | undefined {
  const candidate = args.at(-1);
  if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
    return candidate as Record<string, unknown>;
  }
  return undefined;
}

function stringifyReplacementValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (value === null || value === undefined) {
    return '';
  }

  return String(value);
}

function buildReplacementString(
  script: STRegexScript,
  args: unknown[],
  substituteReplaceParams?: (text: string) => string,
): string {
  const namedGroups = getNamedGroups(args);
  const replacementTemplate = script.replaceString.replace(/\{\{match\}\}/gi, '$0');

  const replacementWithGroups = replacementTemplate.replace(/\$(\d+)|\$<([^>]+)>/g, (_token, num: string | undefined, groupName: string | undefined) => {
    const resolvedValue = num !== undefined
      ? args[Number(num)]
      : namedGroups?.[groupName ?? ''];
    const stringValue = stringifyReplacementValue(resolvedValue);

    if (!stringValue) {
      return '';
    }

    return applyTrimStrings(stringValue, script.trimStrings, substituteReplaceParams);
  });

  return substituteReplaceParams ? substituteReplaceParams(replacementWithGroups) : replacementWithGroups;
}

function resolveRegexTraceRuleName(script: STRegexScript): string {
  const trimmedScriptName = script.scriptName.trim();
  return trimmedScriptName.length > 0 ? trimmedScriptName : script.id.trim() || 'unnamed_regex_rule';
}

// ── 主函数 ────────────────────────────────────────────

/**
 * 执行正则脚本列表对文本进行处理。
 *
 * 执行逻辑：
 * 1. 过滤 disabled 脚本
 * 2. 过滤不匹配 placement 的脚本
 * 3. 按 channel / depth 过滤
 * 4. 对 findRegex 应用变量替换（如果 substituteRegex > 0）
 * 5. 按数组顺序依次执行替换
 *
 * @param text - 要处理的文本
 * @param scripts - 正则脚本列表
 * @param placement - 当前应用位置（如 REGEX_PLACEMENT.AI_OUTPUT）
 * @param context - 执行上下文（变量替换、深度、通道等）
 * @returns 处理后的文本
 */
export function applyRegexScripts(
  text: string,
  scripts: STRegexScript[],
  placement: number,
  context?: RegexContext,
): string {
  return executeRegexScripts(text, scripts, placement, context).text;
}

export function applyRegexScriptsWithTrace(
  text: string,
  scripts: STRegexScript[],
  placement: number,
  context?: RegexContext,
): RegexExecutionTraceResult {
  const result = executeRegexScripts(text, scripts, placement, context);

  return {
    text: result.text,
    candidateRuleNames: result.candidateRuleNames,
    matchedRuleNames: result.matchedRuleNames,
    skippedRules: result.skippedRules,
  };
}

function executeRegexScripts(
  text: string,
  scripts: STRegexScript[],
  placement: number,
  context?: RegexContext,
): RegexExecutionTraceResult {
  let result = text;
  const channel = resolveChannel(context);
  const candidateRuleNames: string[] = [];
  const matchedRuleNames: string[] = [];
  const skippedRules: RegexTraceSkippedRule[] = [];

  for (const script of scripts) {
    if (script.disabled) continue;
    if (!script.placement.includes(placement)) continue;

    const ruleName = resolveRegexTraceRuleName(script);
    candidateRuleNames.push(ruleName);

    if (!shouldRunForChannel(script, channel)) {
      skippedRules.push({ ruleName, reason: 'channel_filtered' });
      continue;
    }
    if (!shouldRunForDepth(script, context?.depth)) {
      skippedRules.push({ ruleName, reason: 'depth_filtered' });
      continue;
    }

    const processedFind = substituteRegexPattern(
      script.findRegex,
      script.substituteRegex,
      context?.substituteFindParams,
    );

    const regex = parseRegexString(processedFind);
    if (!regex) {
      skippedRules.push({ ruleName, reason: 'invalid_regex' });
      continue;
    }

    const nextResult = result.replace(regex, (...args) => buildReplacementString(
      script,
      args,
      context?.substituteReplaceParams,
    ));

    if (nextResult === result) {
      skippedRules.push({ ruleName, reason: 'no_match' });
      continue;
    }

    matchedRuleNames.push(ruleName);
    result = nextResult;
  }

  return {
    text: result,
    candidateRuleNames,
    matchedRuleNames,
    skippedRules,
  };
}
