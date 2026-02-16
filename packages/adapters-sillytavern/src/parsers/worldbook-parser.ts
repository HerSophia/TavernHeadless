import { z } from 'zod';
import type { STWorldBook, STWorldBookEntry } from '../types/worldbook.js';
import { WI_LOGIC, WI_POSITION, WI_ROLE } from '../types/worldbook.js';

// ── Raw Zod schemas ───────────────────────────────────

const rawEntrySchema = z.object({
  uid: z.number().optional(),
  key: z.array(z.string()).default([]),
  keysecondary: z.array(z.string()).default([]),
  secondary_keys: z.array(z.string()).optional(), // v2 spec 用 secondary_keys
  selective: z.boolean().default(true),
  selectiveLogic: z.number().default(WI_LOGIC.AND_ANY),
  constant: z.boolean().default(false),
  content: z.string().default(''),
  comment: z.string().default(''),
  position: z.number().default(WI_POSITION.BEFORE),
  order: z.number().default(100),
  insertion_order: z.number().optional(), // v2 spec 别名
  depth: z.number().default(4),
  role: z.number().default(WI_ROLE.SYSTEM),
  disable: z.boolean().default(false),
  enabled: z.boolean().optional(), // v2 spec: enabled 是 !disable
  scanDepth: z.number().nullable().default(null),
  caseSensitive: z.boolean().nullable().default(null),
  matchWholeWords: z.boolean().nullable().default(null),
  // Extensions 嵌套（v2 spec 把一些字段放在 extensions 里）
  extensions: z.object({
    position: z.number().optional(),
    scan_depth: z.number().nullable().optional(),
    case_sensitive: z.boolean().nullable().optional(),
    match_whole_words: z.boolean().nullable().optional(),
    selectiveLogic: z.number().optional(),
    role: z.number().optional(),
    depth: z.number().optional(),
  }).passthrough().optional(),
}).passthrough();

const rawWorldBookSchema = z.object({
  // 世界书可以有 entries 作为对象（uid → entry）或数组
  entries: z.union([
    z.record(z.string(), rawEntrySchema),
    z.array(rawEntrySchema),
  ]).default({}),
  name: z.string().optional(),
}).passthrough();

// ── 解析函数 ──────────────────────────────────────────

/**
 * 将单个原始条目转换为精简类型
 */
function normalizeEntry(raw: z.infer<typeof rawEntrySchema>, index: number): STWorldBookEntry {
  const ext = raw.extensions;

  return {
    uid: raw.uid ?? index,
    key: raw.key,
    keysecondary: raw.keysecondary.length > 0 ? raw.keysecondary : (raw.secondary_keys ?? []),
    selective: raw.selective,
    selectiveLogic: (ext?.selectiveLogic ?? raw.selectiveLogic) as STWorldBookEntry['selectiveLogic'],
    constant: raw.constant,
    content: raw.content,
    comment: raw.comment,
    position: (ext?.position ?? raw.position) as STWorldBookEntry['position'],
    order: raw.insertion_order ?? raw.order,
    depth: ext?.depth ?? raw.depth,
    role: (ext?.role ?? raw.role) as STWorldBookEntry['role'],
    disable: raw.enabled !== undefined ? !raw.enabled : raw.disable,
    scanDepth: ext?.scan_depth ?? raw.scanDepth,
    caseSensitive: ext?.case_sensitive ?? raw.caseSensitive,
    matchWholeWords: ext?.match_whole_words ?? raw.matchWholeWords,
  };
}

/**
 * 解析酒馆世界书 JSON，返回精简的 STWorldBook。
 *
 * 支持两种 entries 格式：
 * - 对象形式 { "0": {...}, "1": {...} }（酒馆内部格式）
 * - 数组形式 [{...}, {...}]（v2 character_book 格式）
 *
 * @throws {z.ZodError} JSON 结构不符合预期时
 */
export function parseWorldBook(json: unknown, name?: string): STWorldBook {
  const raw = rawWorldBookSchema.parse(json);

  // 统一 entries 为数组
  let rawEntries: z.infer<typeof rawEntrySchema>[];
  if (Array.isArray(raw.entries)) {
    rawEntries = raw.entries;
  } else {
    rawEntries = Object.values(raw.entries);
  }

  const entries = rawEntries.map((e, i) => normalizeEntry(e, i));

  return {
    name: name ?? raw.name ?? 'Unnamed',
    entries,
    scanDepth: 2,
    caseSensitive: false,
    matchWholeWords: false,
    recursive: false,
    maxRecursionSteps: 0,
  };
}
