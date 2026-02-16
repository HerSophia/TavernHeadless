import type { STWorldBookEntry } from '../types/worldbook.js';
import { WI_LOGIC, WI_POSITION } from '../types/worldbook.js';

// ── 公开类型 ──────────────────────────────────────────

/** 触发引擎的扫描上下文 */
export interface TriggerContext {
  /** 最近的聊天消息（从新到旧） */
  messages: string[];
  /** 全局扫描深度（扫描最近 N 条消息） */
  scanDepth: number;
  /** 全局大小写敏感 */
  caseSensitive: boolean;
  /** 全局全词匹配 */
  matchWholeWords: boolean;
}

/** @depth 条目的触发结果 */
export interface DepthEntry {
  entry: STWorldBookEntry;
  depth: number;
  role: number;
}

/** 触发引擎的输出 */
export interface TriggerResult {
  /** 所有被激活的条目（按 order 降序排列） */
  activated: STWorldBookEntry[];
  /** position=before(0) 的条目 */
  before: STWorldBookEntry[];
  /** position=after(1) 的条目 */
  after: STWorldBookEntry[];
  /** position=atDepth(4) 的条目 */
  atDepth: DepthEntry[];
}

// ── 内部工具 ──────────────────────────────────────────

/**
 * 解析斜杠分隔的正则表达式字符串。
 * 匹配格式：/pattern/flags
 * @returns 编译好的 RegExp，如果不是合法正则则返回 null
 */
function parseRegex(input: string): RegExp | null {
  const match = input.match(/^\/([\w\W]+?)\/([gimsuy]*)$/);
  if (!match) return null;

  let [, pattern, flags] = match;
  // 检查未转义的斜杠
  if (pattern!.match(/(^|[^\\])\//)) return null;
  // 反转义斜杠
  pattern = pattern!.replace('\\/', '/');

  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

/**
 * 检查单个关键词是否在文本中命中。
 */
function matchKey(
  haystack: string,
  needle: string,
  caseSensitive: boolean,
  matchWholeWords: boolean,
): boolean {
  // 尝试解析为正则
  const regex = parseRegex(needle);
  if (regex) {
    return regex.test(haystack);
  }

  // 纯文本匹配
  const h = caseSensitive ? haystack : haystack.toLowerCase();
  const n = caseSensitive ? needle : needle.toLowerCase();

  if (!n) return false;

  if (matchWholeWords) {
    // 多词短语用 includes
    const words = n.split(/\s+/);
    if (words.length > 1) {
      return h.includes(n);
    }
    // 单词用 word boundary
    const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wordRegex = new RegExp(`(?:^|\\W)${escaped}(?:$|\\W)`);
    return wordRegex.test(h);
  }

  return h.includes(n);
}

/**
 * 检查一组关键词是否在文本中命中（至少一个命中即返回 true）。
 */
function matchAnyKey(
  haystack: string,
  keys: string[],
  caseSensitive: boolean,
  matchWholeWords: boolean,
): boolean {
  return keys.some(k => matchKey(haystack, k, caseSensitive, matchWholeWords));
}

/**
 * 检查一组关键词是否全部在文本中命中。
 */
function matchAllKeys(
  haystack: string,
  keys: string[],
  caseSensitive: boolean,
  matchWholeWords: boolean,
): boolean {
  return keys.every(k => matchKey(haystack, k, caseSensitive, matchWholeWords));
}

/**
 * 计算辅助关键词命中数。
 */
function countSecondaryHits(
  haystack: string,
  keys: string[],
  caseSensitive: boolean,
  matchWholeWords: boolean,
): number {
  return keys.filter(k => matchKey(haystack, k, caseSensitive, matchWholeWords)).length;
}

/**
 * 检查条目是否被触发（综合 selective + selectiveLogic）。
 */
function isEntryTriggered(
  entry: STWorldBookEntry,
  haystack: string,
  globalCaseSensitive: boolean,
  globalMatchWholeWords: boolean,
): boolean {
  // constant 条目始终激活
  if (entry.constant) return true;

  // 没有主关键词 → 不触发
  if (entry.key.length === 0) return false;

  const caseSensitive = entry.caseSensitive ?? globalCaseSensitive;
  const matchWholeWords = entry.matchWholeWords ?? globalMatchWholeWords;

  // 主关键词：至少一个命中
  const primaryHit = matchAnyKey(haystack, entry.key, caseSensitive, matchWholeWords);
  if (!primaryHit) return false;

  // 非 selective 模式 → 只需主关键词
  if (!entry.selective || entry.keysecondary.length === 0) return true;

  // selective 模式 → 按 selectiveLogic 检查辅助关键词
  const secondaryCount = entry.keysecondary.length;
  const secondaryHits = countSecondaryHits(haystack, entry.keysecondary, caseSensitive, matchWholeWords);

  switch (entry.selectiveLogic) {
    case WI_LOGIC.AND_ANY:
      // 至少一个辅助关键词命中
      return secondaryHits > 0;

    case WI_LOGIC.AND_ALL:
      // 所有辅助关键词都命中
      return secondaryHits === secondaryCount;

    case WI_LOGIC.NOT_ANY:
      // 没有辅助关键词命中
      return secondaryHits === 0;

    case WI_LOGIC.NOT_ALL:
      // 不是所有辅助关键词都命中
      return secondaryHits < secondaryCount;

    default:
      return true;
  }
}

// ── 主函数 ────────────────────────────────────────────

/**
 * 世界书触发引擎：根据聊天消息扫描世界书条目，返回被触发的条目。
 *
 * @param entries - 世界书条目列表（应包含所有条目，包括 disabled 的）
 * @param context - 扫描上下文
 * @returns 触发结果（按 position 分类）
 */
export function triggerWorldBook(
  entries: STWorldBookEntry[],
  context: TriggerContext,
): TriggerResult {
  // 构建扫描文本（最近 scanDepth 条消息）
  const scanMessages = context.messages.slice(0, context.scanDepth);
  const haystack = scanMessages.join('\n');

  // 过滤并检查每个条目
  const activated: STWorldBookEntry[] = [];

  for (const entry of entries) {
    // 跳过禁用条目
    if (entry.disable) continue;

    // 独立 scanDepth
    let entryHaystack = haystack;
    if (entry.scanDepth !== null && entry.scanDepth !== context.scanDepth) {
      const depth = Math.max(0, entry.scanDepth);
      entryHaystack = context.messages.slice(0, depth).join('\n');
    }

    if (isEntryTriggered(entry, entryHaystack, context.caseSensitive, context.matchWholeWords)) {
      activated.push(entry);
    }
  }

  // 按 order 降序排列（高 order = 高优先）
  activated.sort((a, b) => b.order - a.order);

  // 按 position 分类
  const before: STWorldBookEntry[] = [];
  const after: STWorldBookEntry[] = [];
  const atDepth: DepthEntry[] = [];

  for (const entry of activated) {
    switch (entry.position) {
      case WI_POSITION.BEFORE:
        before.push(entry);
        break;
      case WI_POSITION.AFTER:
        after.push(entry);
        break;
      case WI_POSITION.AT_DEPTH:
        atDepth.push({ entry, depth: entry.depth, role: entry.role });
        break;
      default:
        // AN_TOP, AN_BOTTOM, EM_TOP, EM_BOTTOM → 暂时放入 after
        after.push(entry);
        break;
    }
  }

  return { activated, before, after, atDepth };
}
