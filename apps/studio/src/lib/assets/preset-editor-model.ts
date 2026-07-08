/**
 * 预设编辑器纯模型（SC2-7 / 方向 3）。
 *
 * 集中「SDK 结构化模型 ↔ 本地草稿 ↔ 保存载荷」的映射与条目操作，
 * 无 Vue / 无 SDK 客户端依赖（仅 type import），便于纯单测。
 *
 * 保存走整体 PUT（`presets.update`），载荷字段为 snake_case；本地草稿沿用
 * `getEditor` 返回的 camelCase，映射集中在 `toUpdatePayload`。
 * `extra` / `injectionTrigger` / `orderContexts` / `topLevel` 未知字段原样保留（passthrough）。
 */
import type { PresetEditorDetail, PresetEditorDocument, PresetEditorEntry, PresetEditorOrderContext } from "@tavern/sdk";

/** 条目角色（对齐 `PresetEditorEntry.role`）。 */
export type PresetEntryRole = PresetEditorEntry["role"];

/** 预设文档格式（对齐 `PresetEditorDocument.format`）。 */
export type PresetEditorFormat = PresetEditorDocument["format"];

/**
 * 条目草稿：镜像 `PresetEditorEntry`。
 *
 * 可选数值字段（injectionDepth/injectionOrder）与 forbidOverrides 归一为「有值或 undefined」；
 * `extra` / `injectionTrigger` 原样持有并做深拷贝，保证 round-trip 无损。
 */
export interface PresetEntryDraft {
  identifier: string;
  name: string;
  role: PresetEntryRole;
  content: string;
  systemPrompt: boolean;
  marker: boolean;
  injectionPosition: number;
  injectionDepth?: number;
  injectionOrder?: number;
  forbidOverrides?: boolean;
  injectionTrigger?: unknown[];
  enabled: boolean;
  extra: Record<string, unknown>;
}

/** 预设草稿（本地可编辑模型）。 */
export interface PresetDraft {
  name: string;
  defaultCharacterId: number;
  format: PresetEditorFormat;
  entries: PresetEntryDraft[];
  orderContexts: PresetEditorOrderContext[];
  topLevel: Record<string, unknown>;
}

/** `presets.update` 的入参子集（snake_case 载荷）。 */
export interface PresetUpdatePayload {
  name: string;
  editor: {
    default_character_id: number;
    entries: Array<Record<string, unknown>>;
    order_contexts: Array<Record<string, unknown>>;
    top_level: Record<string, unknown>;
  };
}

/** identifier 校验问题枚举。 */
export type PresetIdentifierIssue = "empty" | "pattern" | "tooLong" | "duplicate";

const IDENTIFIER_PATTERN = /^[a-zA-Z0-9_-]+$/;
const IDENTIFIER_MAX_LENGTH = 64;

/**
 * 深拷贝 passthrough 数据。
 *
 * 用 JSON 克隆而非 `structuredClone`：预设数据源自 JSON API（JSON-safe），
 * 且 store 侧草稿是 Vue reactive 代理，`structuredClone` 无法克隆 Proxy（抛 DataCloneError）；
 * JSON 克隆读普通可枚举属性、与整体 PUT 的服务端语义一致。
 */
function deepClone<T>(value: T): T {
  if (value === undefined || value === null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneEntry(entry: PresetEditorEntry): PresetEntryDraft {
  return {
    identifier: entry.identifier,
    name: entry.name,
    role: entry.role,
    content: entry.content,
    systemPrompt: entry.systemPrompt,
    marker: entry.marker,
    injectionPosition: entry.injectionPosition,
    injectionDepth: entry.injectionDepth,
    injectionOrder: entry.injectionOrder,
    forbidOverrides: entry.forbidOverrides,
    injectionTrigger: entry.injectionTrigger === undefined ? undefined : deepClone(entry.injectionTrigger),
    enabled: entry.enabled,
    extra: deepClone(entry.extra ?? {}),
  };
}

function entryToRecord(entry: PresetEntryDraft): Record<string, unknown> {
  const record: Record<string, unknown> = {
    identifier: entry.identifier,
    name: entry.name,
    role: entry.role,
    content: entry.content,
    system_prompt: entry.systemPrompt,
    marker: entry.marker,
    injection_position: entry.injectionPosition,
    enabled: entry.enabled,
    extra: deepClone(entry.extra ?? {}),
  };
  if (entry.injectionDepth !== undefined) {
    record.injection_depth = entry.injectionDepth;
  }
  if (entry.injectionOrder !== undefined) {
    record.injection_order = entry.injectionOrder;
  }
  if (entry.forbidOverrides !== undefined) {
    record.forbid_overrides = entry.forbidOverrides;
  }
  if (entry.injectionTrigger !== undefined) {
    record.injection_trigger = deepClone(entry.injectionTrigger);
  }
  return record;
}

function orderContextToRecord(context: PresetEditorOrderContext): Record<string, unknown> {
  return {
    character_id: context.characterId,
    order: context.order.map((item) => ({ identifier: item.identifier, enabled: item.enabled })),
    extra: deepClone(context.extra ?? {}),
  };
}

/** 从 `presets.getEditor` 结果构建本地草稿（深拷贝，隔离编辑）。 */
export function toDraft(detail: PresetEditorDetail): PresetDraft {
  const doc = detail.editor;
  return {
    name: detail.name,
    defaultCharacterId: doc.defaultCharacterId,
    format: doc.format,
    entries: doc.entries.map(cloneEntry),
    orderContexts: deepClone(doc.orderContexts ?? []),
    topLevel: deepClone(doc.topLevel ?? {}),
  };
}

/** 草稿 → `presets.update` 入参：camelCase → snake_case，可选字段仅在有值时写。 */
export function toUpdatePayload(draft: PresetDraft): PresetUpdatePayload {
  return {
    name: draft.name,
    editor: {
      default_character_id: draft.defaultCharacterId,
      entries: draft.entries.map(entryToRecord),
      order_contexts: draft.orderContexts.map(orderContextToRecord),
      top_level: deepClone(draft.topLevel ?? {}),
    },
  };
}

/** 新条目默认值。 */
export function blankEntry(identifier: string): PresetEntryDraft {
  return {
    identifier,
    name: identifier,
    role: "system",
    content: "",
    systemPrompt: false,
    marker: false,
    injectionPosition: 0,
    enabled: true,
    extra: {},
  };
}

/**
 * identifier 校验：非空、`^[a-zA-Z0-9_-]+$`、长度 ≤ 64、不与 `existing` 重复。
 * 返回首个命中的问题枚举，全部通过返回 null。
 */
export function validateIdentifier(id: string, existing: string[]): PresetIdentifierIssue | null {
  const value = id.trim();
  if (value.length === 0) {
    return "empty";
  }
  if (!IDENTIFIER_PATTERN.test(value)) {
    return "pattern";
  }
  if (value.length > IDENTIFIER_MAX_LENGTH) {
    return "tooLong";
  }
  if (existing.includes(value)) {
    return "duplicate";
  }
  return null;
}

/** 重排条目：把 `index` 处的条目沿 `dir`（-1 上移 / 1 下移）移动，越界返回原引用。 */
export function moveEntry(entries: PresetEntryDraft[], index: number, dir: -1 | 1): PresetEntryDraft[] {
  const target = index + dir;
  if (index < 0 || index >= entries.length || target < 0 || target >= entries.length) {
    return entries;
  }
  const next = entries.slice();
  const moved = next[index];
  if (!moved) {
    return entries;
  }
  next.splice(index, 1);
  next.splice(target, 0, moved);
  return next;
}

/** 稳定序列化草稿（= 保存载荷的 JSON），供脏态比较。 */
export function serializeForBaseline(draft: PresetDraft): string {
  return JSON.stringify(toUpdatePayload(draft));
}
