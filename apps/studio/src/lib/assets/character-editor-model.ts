/**
 * 角色卡编辑纯模型（SC2-8 / 方向 4）。
 *
 * 集中「角色卡快照 ↔ 本地草稿 ↔ 保存载荷」的映射与校验，无 Vue / 无 SDK 客户端依赖
 * （仅 `type import` + `isTavernApiError`），便于纯单测。
 *
 * 角色卡编辑语义特殊：一张卡就是一份完整快照（`SessionCharacterSnapshot`，camelCase + passthrough），
 * 编辑 = 发一份完整新快照（`characters.createVersion`，`name` 必填）。已知字段抽为可编辑文本、
 * 其余（`extensions` / `characterBook` / `groupOnlyGreetings` / `assets` / 日期 / 未知键）作为
 * passthrough 原样保留，保证 round-trip 无损。`greeting` 读时回退到 `primaryGreeting`、写时统一
 * `primaryGreeting` 并删除 legacy `greeting`（与后端 `normalizeSessionCharacterSnapshot` 一致）。
 */
import { isTavernApiError } from "@tavern/sdk";

/** 写操作错误分类：驱动 UI 冲突条幅 / 忙提示 / 权限提示。 */
export type CharacterWriteErrorKind = "conflict" | "busy" | "forbidden" | "unknown";

/** 校验错误码（UI 侧映射 `library.ce_*`）。 */
export interface CharacterDraftValidation {
  ok: boolean;
  errors: Partial<Record<"name", "nameRequired">>;
}

/**
 * 角色卡草稿（本地可编辑模型）。
 *
 * 全部字段为 string，便于表单绑定与脏态比较；数组字段以文本承载：
 * `alternateGreetings` 一行一条、`tags` 逗号分隔。
 */
export interface CharacterDraft {
  name: string;
  nickname: string;
  creator: string;
  characterVersion: string;
  description: string;
  personality: string;
  scenario: string;
  exampleDialogue: string;
  primaryGreeting: string;
  alternateGreetings: string;
  systemPrompt: string;
  postHistoryInstructions: string;
  creatorNotes: string;
  tags: string;
}

/**
 * 草稿拥有的快照键（camelCase）。`extractPassthrough` 用它剔除已知字段，
 * 含 `greeting` 别名（读时并入 `primaryGreeting`、写时不回写）。
 */
export const CHARACTER_KNOWN_KEYS = [
  "name",
  "nickname",
  "creator",
  "characterVersion",
  "description",
  "personality",
  "scenario",
  "exampleDialogue",
  "primaryGreeting",
  "greeting",
  "alternateGreetings",
  "systemPrompt",
  "postHistoryInstructions",
  "creatorNotes",
  "tags",
] as const;

function readText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

/**
 * 深拷贝 passthrough 数据。
 *
 * 用 JSON 克隆而非 `structuredClone`：角色卡快照源自 JSON API（JSON-safe），
 * 且 store 侧 passthrough 可能是 Vue reactive 代理，`structuredClone` 无法克隆 Proxy。
 */
function deepClone<T>(value: T): T {
  if (value === undefined || value === null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

/** 把多行文本拆成数组：换行分隔、trim、去空、去重（保序）。 */
export function parseLines(text: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const value = raw.trim();
    if (value.length === 0 || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

/** 把标签文本拆成数组：逗号分隔、trim、去空、去重（保序）。 */
export function parseTags(text: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of text.split(",")) {
    const value = raw.trim();
    if (value.length === 0 || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

/** 角色卡快照 → 表单草稿（文本字段字符串化，`greeting` 回退到 `primaryGreeting`，数组转文本）。 */
export function snapshotToDraft(snapshot: Record<string, unknown>): CharacterDraft {
  const primaryGreeting = readText(snapshot.primaryGreeting) || readText(snapshot.greeting);
  return {
    name: readText(snapshot.name),
    nickname: readText(snapshot.nickname),
    creator: readText(snapshot.creator),
    characterVersion: readText(snapshot.characterVersion),
    description: readText(snapshot.description),
    personality: readText(snapshot.personality),
    scenario: readText(snapshot.scenario),
    exampleDialogue: readText(snapshot.exampleDialogue),
    primaryGreeting,
    alternateGreetings: readStringArray(snapshot.alternateGreetings).join("\n"),
    systemPrompt: readText(snapshot.systemPrompt),
    postHistoryInstructions: readText(snapshot.postHistoryInstructions),
    creatorNotes: readText(snapshot.creatorNotes),
    tags: readStringArray(snapshot.tags).join(", "),
  };
}

/** 抽取 passthrough：深拷贝快照后删除全部已知键（含 `greeting`），保留未知 / 未暴露字段。 */
export function extractPassthrough(snapshot: Record<string, unknown>): Record<string, unknown> {
  const clone = deepClone<Record<string, unknown>>(snapshot ?? {}) ?? {};
  for (const key of CHARACTER_KNOWN_KEYS) {
    delete clone[key];
  }
  return clone;
}

/**
 * 草稿 + passthrough → 完整快照（`createVersion` 载荷）。
 *
 * `name` trim 后必填；可选文本 trim 非空才写、空则删；`primaryGreeting` 同理且始终删除
 * legacy `greeting`；`alternateGreetings` / `tags` 解析为数组、空则删。未知字段随 passthrough 原样保留。
 */
export function buildSnapshot(draft: CharacterDraft, passthrough: Record<string, unknown>): Record<string, unknown> {
  const snapshot: Record<string, unknown> = { ...deepClone(passthrough ?? {}) };

  snapshot.name = draft.name.trim();

  const setText = (key: string, value: string): void => {
    const trimmed = value.trim();
    if (trimmed) {
      snapshot[key] = trimmed;
    } else {
      delete snapshot[key];
    }
  };
  setText("nickname", draft.nickname);
  setText("creator", draft.creator);
  setText("characterVersion", draft.characterVersion);
  setText("description", draft.description);
  setText("personality", draft.personality);
  setText("scenario", draft.scenario);
  setText("exampleDialogue", draft.exampleDialogue);
  setText("systemPrompt", draft.systemPrompt);
  setText("postHistoryInstructions", draft.postHistoryInstructions);
  setText("creatorNotes", draft.creatorNotes);

  const primaryGreeting = draft.primaryGreeting.trim();
  if (primaryGreeting) {
    snapshot.primaryGreeting = primaryGreeting;
  } else {
    delete snapshot.primaryGreeting;
  }
  // 始终不回写 legacy `greeting`（后端 normalize 会删，统一到 primaryGreeting）。
  delete snapshot.greeting;

  const alternateGreetings = parseLines(draft.alternateGreetings);
  if (alternateGreetings.length > 0) {
    snapshot.alternateGreetings = alternateGreetings;
  } else {
    delete snapshot.alternateGreetings;
  }

  const tags = parseTags(draft.tags);
  if (tags.length > 0) {
    snapshot.tags = tags;
  } else {
    delete snapshot.tags;
  }

  return snapshot;
}

/** 校验草稿：`name` 非空。 */
export function validateDraft(draft: CharacterDraft): CharacterDraftValidation {
  const errors: CharacterDraftValidation["errors"] = {};
  if (draft.name.trim().length === 0) {
    errors.name = "nameRequired";
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

/** 稳定序列化草稿（= 保存载荷 JSON），供脏态比较。 */
export function serializeForBaseline(draft: CharacterDraft, passthrough: Record<string, unknown>): string {
  return JSON.stringify(buildSnapshot(draft, passthrough));
}

/** 分类写错误：409 冲突 / 503 忙 / 403 无权限 / 其余未知。 */
export function classifyCharacterWriteError(cause: unknown): CharacterWriteErrorKind {
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
