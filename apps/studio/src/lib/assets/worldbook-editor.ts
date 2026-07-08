/**
 * 世界书编辑纯逻辑（SC2-6 / 方向 2）。
 *
 * 只做「表单模型 ↔ SDK 输入」的映射、字段校验、写错误分类与重排计算，无副作用、可纯单测。
 * 条目富字段取值语义见 `.limcode/design/studio-sc2-6-worldbook-editor-design.md` §2.1。
 */
import { isTavernApiError } from "@tavern/sdk";
import type { WorldbookEntryRecord } from "@tavern/sdk";

/** 三态布尔（null=继承全局）在表单中的字符串表示。 */
export type WorldbookTriState = "inherit" | "on" | "off";

/** 写操作错误分类：驱动 UI 冲突对账 / 忙提示 / 权限提示。 */
export type WorldbookWriteErrorKind = "conflict" | "busy" | "forbidden" | "unknown";

/** 条目校验错误码（UI 侧映射 `library.wb_err_*`）。 */
export type WorldbookEntryErrorCode = "contentRequired" | "keysRequired";

export interface WorldbookEntryValidation {
  ok: boolean;
  errors: Partial<Record<"content" | "keys", WorldbookEntryErrorCode>>;
}

/** 可编辑的条目表单模型（keys 为原始文本、三态布尔用字符串）。 */
export interface WorldbookEntryDraft {
  comment: string;
  keys: string;
  keysSecondary: string;
  content: string;
  position: number;
  role: number;
  depth: number;
  order: number;
  selective: boolean;
  selectiveLogic: number;
  constant: boolean;
  disable: boolean;
  /** null=继承全局；否则 ≥0 的整数。 */
  scanDepth: number | null;
  caseSensitive: WorldbookTriState;
  matchWholeWords: WorldbookTriState;
}

/** `worldbook-entries.create` 的归一化输入（不含 `expected_version`）。 */
export interface WorldbookEntryCreateInput {
  worldbookId: string;
  content: string;
  keys: string[];
  keysSecondary: string[];
  comment: string;
  position: number;
  role: number;
  depth: number;
  order: number;
  selective: boolean;
  selectiveLogic: number;
  constant: boolean;
  disable: boolean;
  scanDepth: number | null;
  caseSensitive: boolean | null;
  matchWholeWords: boolean | null;
}

/** `worldbook-entries.update` 的归一化输入。 */
export interface WorldbookEntryUpdateInput extends WorldbookEntryCreateInput {
  entryId: string;
}

/** 暴露的插入位置取值（0..6；7=Outlet 不暴露）。 */
export const WORLDBOOK_POSITION_VALUES = [0, 1, 2, 3, 4, 5, 6] as const;
/** 消息角色取值（0 系统 / 1 用户 / 2 助手）。 */
export const WORLDBOOK_ROLE_VALUES = [0, 1, 2] as const;
/** selective 逻辑取值（0 AND_ANY / 1 NOT_ALL / 2 NOT_ANY / 3 AND_ALL）。 */
export const WORLDBOOK_SELECTIVE_LOGIC_VALUES = [0, 1, 2, 3] as const;

/** position=4（指定深度）时 depth / role 才生效。 */
export const WORLDBOOK_POSITION_AT_DEPTH = 4;

/** 对齐后端默认值的空白草稿（新建条目用）。 */
export function emptyEntryDraft(): WorldbookEntryDraft {
  return {
    comment: "",
    keys: "",
    keysSecondary: "",
    content: "",
    position: 0,
    role: 0,
    depth: 4,
    order: 100,
    selective: true,
    selectiveLogic: 0,
    constant: false,
    disable: false,
    scanDepth: null,
    caseSensitive: "inherit",
    matchWholeWords: "inherit",
  };
}

function toTriState(value: boolean | null): WorldbookTriState {
  if (value === null) {
    return "inherit";
  }
  return value ? "on" : "off";
}

function fromTriState(value: WorldbookTriState): boolean | null {
  if (value === "inherit") {
    return null;
  }
  return value === "on";
}

/** 把关键词文本拆成数组：逗号 / 换行分隔、trim、去空、去重（保序）。 */
export function parseKeys(text: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of text.split(/[\n,]/)) {
    const key = raw.trim();
    if (key.length === 0 || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(key);
  }
  return result;
}

/** 把关键词数组拼回表单文本。 */
export function formatKeys(keys: string[]): string {
  return keys.join(", ");
}

/** SDK 条目记录 → 表单草稿。 */
export function entryToDraft(record: WorldbookEntryRecord): WorldbookEntryDraft {
  return {
    comment: record.comment,
    keys: formatKeys(record.keys),
    keysSecondary: formatKeys(record.keysSecondary),
    content: record.content,
    position: record.position,
    role: record.role,
    depth: record.depth,
    order: record.order,
    selective: record.selective,
    selectiveLogic: record.selectiveLogic,
    constant: record.constant,
    disable: record.disable,
    scanDepth: record.scanDepth,
    caseSensitive: toTriState(record.caseSensitive),
    matchWholeWords: toTriState(record.matchWholeWords),
  };
}

function draftToFields(draft: WorldbookEntryDraft): Omit<WorldbookEntryCreateInput, "worldbookId"> {
  return {
    content: draft.content,
    keys: parseKeys(draft.keys),
    keysSecondary: parseKeys(draft.keysSecondary),
    comment: draft.comment,
    position: draft.position,
    role: draft.role,
    depth: draft.depth,
    order: draft.order,
    selective: draft.selective,
    selectiveLogic: draft.selectiveLogic,
    constant: draft.constant,
    disable: draft.disable,
    scanDepth: draft.scanDepth,
    caseSensitive: fromTriState(draft.caseSensitive),
    matchWholeWords: fromTriState(draft.matchWholeWords),
  };
}

/** 表单草稿 → 创建输入。 */
export function draftToCreateInput(draft: WorldbookEntryDraft, worldbookId: string): WorldbookEntryCreateInput {
  return { worldbookId, ...draftToFields(draft) };
}

/** 表单草稿 → 更新输入。 */
export function draftToUpdateInput(
  draft: WorldbookEntryDraft,
  worldbookId: string,
  entryId: string,
): WorldbookEntryUpdateInput {
  return { worldbookId, entryId, ...draftToFields(draft) };
}

/** 校验草稿：内容必填；非常驻条目至少一个主关键词。 */
export function validateEntryDraft(draft: WorldbookEntryDraft): WorldbookEntryValidation {
  const errors: WorldbookEntryValidation["errors"] = {};
  if (draft.content.trim().length === 0) {
    errors.content = "contentRequired";
  }
  if (!draft.constant && parseKeys(draft.keys).length === 0) {
    errors.keys = "keysRequired";
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

/** 分类写错误：409 冲突 / 503 忙 / 403 无权限 / 其余未知。 */
export function classifyWorldbookWriteError(cause: unknown): WorldbookWriteErrorKind {
  if (isTavernApiError(cause)) {
    if (cause.status === 409) {
      return "conflict";
    }
    if (cause.status === 503) {
      return "busy";
    }
    if (cause.status === 403) {
      return "forbidden";
    }
  }
  return "unknown";
}

/**
 * 计算上/下移一位的重排项。
 *
 * 按 `order` 升序（同 order 以 uid 稳定）取当前顺序，移动目标一位后把顺序规整为 0..n 序号，
 * 仅返回 `order` 发生变化的条目。越界（顶部再上移 / 底部再下移 / id 不存在）返回空数组。
 */
export function computeMoveReorder(
  entries: WorldbookEntryRecord[],
  id: string,
  direction: "up" | "down",
): Array<{ id: string; order: number }> {
  const sorted = [...entries].sort((a, b) => a.order - b.order || a.uid - b.uid);
  const index = sorted.findIndex((entry) => entry.id === id);
  if (index < 0) {
    return [];
  }
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= sorted.length) {
    return [];
  }
  const reordered = [...sorted];
  const moved = reordered[index]!;
  reordered[index] = reordered[target]!;
  reordered[target] = moved;

  const items: Array<{ id: string; order: number }> = [];
  reordered.forEach((entry, nextOrder) => {
    if (entry.order !== nextOrder) {
      items.push({ id: entry.id, order: nextOrder });
    }
  });
  return items;
}
