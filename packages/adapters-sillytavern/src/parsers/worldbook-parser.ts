import { z } from 'zod';
import type { STWorldBook, STWorldBookEntry } from '../types/worldbook.js';
import { WI_LOGIC, WI_POSITION, WI_ROLE } from '../types/worldbook.js';

// ── Raw Zod schemas ───────────────────────────────────

const rawDelayUntilRecursionSchema = z.union([
  z.boolean(),
  z.number().int().nonnegative(),
]);

const rawEntrySchema = z.object({
  uid: z.number().optional(),
  key: z.array(z.string()).default([]),
  keys: z.array(z.string()).optional(),
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
  excludeRecursion: z.boolean().optional(),
  preventRecursion: z.boolean().optional(),
  delayUntilRecursion: rawDelayUntilRecursionSchema.nullable().optional(),
  outletName: z.string().optional(),
  // Extensions 嵌套（v2 spec 把一些字段放在 extensions 里）
  extensions: z.object({
    position: z.number().optional(),
    scan_depth: z.number().nullable().optional(),
    case_sensitive: z.boolean().nullable().optional(),
    match_whole_words: z.boolean().nullable().optional(),
    selectiveLogic: z.number().optional(),
    role: z.number().optional(),
    depth: z.number().optional(),
    exclude_recursion: z.boolean().optional(),
    prevent_recursion: z.boolean().optional(),
    delay_until_recursion: rawDelayUntilRecursionSchema.nullable().optional(),
    outlet_name: z.string().optional(),
  }).passthrough().optional(),
}).passthrough();

const rawWorldBookSchema = z.object({
  // 世界书可以有 entries 作为对象（uid → entry）或数组
  entries: z.union([
    z.record(z.string(), rawEntrySchema),
    z.array(rawEntrySchema),
  ]).default({}),
  name: z.string().optional(),
  scanDepth: z.number().int().min(0).optional(),
  caseSensitive: z.boolean().optional(),
  matchWholeWords: z.boolean().optional(),
  recursive: z.boolean().optional(),
  maxRecursionSteps: z.number().int().min(0).optional(),
}).passthrough();

const RAW_WORLD_KNOWN_KEYS = new Set([
  'entries',
  'name',
  'scanDepth',
  'caseSensitive',
  'matchWholeWords',
  'recursive',
  'maxRecursionSteps',
]);

const RAW_ENTRY_KNOWN_KEYS = new Set([
  'uid',
  'key',
  'keys',
  'keysecondary',
  'secondary_keys',
  'selective',
  'selectiveLogic',
  'constant',
  'content',
  'comment',
  'position',
  'order',
  'insertion_order',
  'depth',
  'role',
  'disable',
  'enabled',
  'scanDepth',
  'caseSensitive',
  'matchWholeWords',
  'excludeRecursion',
  'preventRecursion',
  'delayUntilRecursion',
  'outletName',
  'extensions',
]);

const RAW_ENTRY_EXTENSION_KNOWN_KEYS = new Set([
  'position',
  'scan_depth',
  'case_sensitive',
  'match_whole_words',
  'selectiveLogic',
  'role',
  'depth',
  'exclude_recursion',
  'prevent_recursion',
  'delay_until_recursion',
  'outlet_name',
]);

// ── 解析函数 ──────────────────────────────────────────

function toPlainRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function omitKnownFields(record: Record<string, unknown>, knownKeys: Set<string>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    if (knownKeys.has(key) || value === undefined) {
      continue;
    }
    result[key] = value;
  }

  return result;
}

function compactExtra(extra: Record<string, unknown>): Record<string, unknown> | undefined {
  const entries = Object.entries(extra).filter(([, value]) => value !== undefined);
  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries);
}

function normalizeDelayUntilRecursion(value: boolean | number | null | undefined): number | null {
  if (value === true) {
    return 1;
  }

  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }

  return null;
}

/**
 * 将单个原始条目转换为精简类型
 */
function normalizeEntry(raw: z.infer<typeof rawEntrySchema>, index: number): STWorldBookEntry {
  const ext = raw.extensions;
  const primaryKeys = raw.key.length > 0 ? raw.key : (raw.keys ?? []);
  const secondaryKeys = raw.keysecondary.length > 0 ? raw.keysecondary : (raw.secondary_keys ?? []);

  const rootExtra = omitKnownFields(toPlainRecord(raw), RAW_ENTRY_KNOWN_KEYS);
  const extensionExtra = omitKnownFields(toPlainRecord(ext), RAW_ENTRY_EXTENSION_KNOWN_KEYS);
  const extra = compactExtra({
    ...rootExtra,
    ...(Object.keys(extensionExtra).length > 0 ? { extensions: extensionExtra } : {}),
  });

  return {
    uid: raw.uid ?? index,
    key: primaryKeys,
    keysecondary: secondaryKeys,
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
    excludeRecursion: ext?.exclude_recursion ?? raw.excludeRecursion ?? false,
    preventRecursion: ext?.prevent_recursion ?? raw.preventRecursion ?? false,
    delayUntilRecursion: normalizeDelayUntilRecursion(ext?.delay_until_recursion ?? raw.delayUntilRecursion),
    outletName: ext?.outlet_name ?? raw.outletName ?? '',
    ...(extra ? { extra } : {}),
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
  const extra = compactExtra(omitKnownFields(toPlainRecord(raw), RAW_WORLD_KNOWN_KEYS));

  return {
    name: name ?? raw.name ?? 'Unnamed',
    entries,
    scanDepth: typeof raw.scanDepth === 'number' ? raw.scanDepth : 2,
    caseSensitive: typeof raw.caseSensitive === 'boolean' ? raw.caseSensitive : false,
    matchWholeWords: typeof raw.matchWholeWords === 'boolean' ? raw.matchWholeWords : false,
    recursive: typeof raw.recursive === 'boolean' ? raw.recursive : false,
    maxRecursionSteps: typeof raw.maxRecursionSteps === 'number' ? raw.maxRecursionSteps : 0,
    ...(extra ? { extra } : {}),
  };
}
