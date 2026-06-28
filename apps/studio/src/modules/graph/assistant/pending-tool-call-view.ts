/**
 * 图助手「执行前确认闸」待确认卡片的展示纯逻辑（阶段 3）。
 *
 * 从 PendingToolCallCard.vue 抽出便于单测：把工具调用参数压成简短的键值摘要、
 * 标注 live 持久写「危险」级别、复用工具短名。无 i18n 与 DOM 依赖。
 */
import type { GraphAssistantToolSideEffectLevel } from "../../../lib/graph-assistant-confirmation-api";

export { shortToolName } from "./tool-policy-grouping";

/** 单个参数值的最大展示长度，超出截断并以省略号结尾。 */
export const MAX_ARG_VALUE_LENGTH = 80;

/** 默认最多展示的参数条数，其余折叠为「+N」。 */
export const DEFAULT_ARG_ENTRY_LIMIT = 6;

export interface ToolArgEntry {
  key: string;
  value: string;
}

export interface ToolArgSummary {
  entries: ToolArgEntry[];
  /** 超出 limit 被折叠的参数条数（用于「+N」提示）。 */
  truncatedCount: number;
}

/** 把单个参数值压成单行可读字符串（截断长值、对象/数组转紧凑 JSON）。 */
export function formatArgValue(value: unknown): string {
  let text: string;
  if (value === null) {
    text = "null";
  } else if (value === undefined) {
    text = "undefined";
  } else if (typeof value === "string") {
    text = value;
  } else if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    text = String(value);
  } else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }
  // 折叠多余空白为单空格，避免卡片里出现换行/缩进。
  text = text.replace(/\s+/g, " ").trim();
  if (text.length > MAX_ARG_VALUE_LENGTH) {
    return `${text.slice(0, MAX_ARG_VALUE_LENGTH - 1)}…`;
  }
  return text;
}

/**
 * 把工具调用参数对象压成有限条键值摘要，按键名稳定排序，超出 limit 的折叠计数。
 * 非对象入参（理论上不应出现）按空摘要处理。
 */
export function summarizeToolArgs(
  args: Record<string, unknown> | null | undefined,
  limit: number = DEFAULT_ARG_ENTRY_LIMIT,
): ToolArgSummary {
  if (!args || typeof args !== "object") {
    return { entries: [], truncatedCount: 0 };
  }
  const keys = Object.keys(args).sort((a, b) => a.localeCompare(b));
  const visible = keys.slice(0, Math.max(0, limit));
  const entries = visible.map((key) => ({ key, value: formatArgValue(args[key]) }));
  return { entries, truncatedCount: Math.max(0, keys.length - visible.length) };
}

/** 是否为不可逆（live 持久写）的「危险」副作用级别。 */
export function isDangerSideEffect(level: GraphAssistantToolSideEffectLevel | null | undefined): boolean {
  return level === "irreversible";
}
