/**
 * 回复查看器视图模型装配（图助手 · 回复查看器）。
 *
 * 把一条助手回复（楼层 + 消息视图）装配成查看器所需的纯数据：回复正文、思考内容、
 * 内容片段、从正文解析出的工具调用、片段统计与元信息。无 i18n与 DOM依赖，便于单测。
 *
 * 数据边界：原生协议下结构化工具调用不进 transcript，历史楼层正文里若出现工具块，
 * 属模型出格式的文本泄漏。本视图据落库正文解析，正是为了把这些泄漏块单独呈现以便排查。
 */
import type { AssistantFloorMessageView, AssistantFloorView } from "./floor-view-model";
import {
  parseReplyFragments,
  summarizeReplyFragments,
  type ReplyFragment,
  type ReplyFragmentStats,
} from "./parse-reply-fragments";

/** 从正文解析出的单条工具调用（含其后紧邻的工具结果，若有）。 */
export interface ReplyInspectorToolCall {
  /** 从 1 起的序号，供展示。 */
  index: number;
  /** 工具名（解析失败为 null）。 */
  name: string | null;
  /** 参数文本：能解析为 JSON 时美化输出，否则取标签内原文。 */
  argsText: string;
  /** 结果文本：紧邻的 tool_result / tool_response 块内容（无则 null）。 */
  resultText: string | null;
  /** 该工具块是否未闭合 / 出格式。 */
  malformed: boolean;
}

/** 查看器元信息（取楼层指标与状态）。 */
export interface ReplyInspectorMeta {
  floorId: string;
  floorNo: number;
  state: string;
  finishedAt: number;
  durationMs: number;
  tokenIn: number;
  tokenOut: number;
  totalTokens: number;
}

/** 查看器完整视图模型。 */
export interface ReplyInspectorView {
  role: string;
  content: string;
  reasoning: string | null;
  fragments: ReplyFragment[];
  toolCalls: ReplyInspectorToolCall[];
  stats: ReplyFragmentStats;
  meta: ReplyInspectorMeta;
}

function safeStringify(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** 能解析为 JSON 时美化输出，否则返回去空白后的原文。 */
function formatJsonish(text: string): string {
  const trimmed = text.trim();
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return trimmed;
  }
}

/** 从片段序列抽取工具调用，并把紧邻的结果块配对到对应调用。 */
function extractToolCalls(fragments: readonly ReplyFragment[]): ReplyInspectorToolCall[] {
  const calls: ReplyInspectorToolCall[] = [];
  for (let i = 0; i < fragments.length; i += 1) {
    const fragment = fragments[i];
    if (!fragment || fragment.type !== "tool_call") {
      continue;
    }

    const name = fragment.toolCall?.name ?? null;
    const argsText =
      fragment.toolCall && fragment.toolCall.arguments != null
        ? safeStringify(fragment.toolCall.arguments)
        : formatJsonish(fragment.inner ?? "");

    let resultText: string | null = null;
    const next = fragments[i + 1];
    if (next && (next.type === "tool_result" || next.type === "tool_response")) {
      resultText = formatJsonish(next.inner ?? "");
    }

    calls.push({
      index: calls.length + 1,
      name,
      argsText,
      resultText,
      malformed: Boolean(fragment.malformed),
    });
  }
  return calls;
}

/** 装配回复查看器视图模型。 */
export function buildReplyInspectorView(args: {
  floor: AssistantFloorView;
  message: AssistantFloorMessageView;
}): ReplyInspectorView {
  const fragments = parseReplyFragments(args.message.content);
  const stats = summarizeReplyFragments(fragments);
  const toolCalls = extractToolCalls(fragments);
  const { metrics } = args.floor;
  return {
    role: args.message.role,
    content: args.message.content,
    reasoning: args.floor.reasoning ?? null,
    fragments,
    toolCalls,
    stats,
    meta: {
      floorId: args.floor.id,
      floorNo: args.floor.floorNo,
      state: args.floor.state,
      finishedAt: metrics.finishedAt,
      durationMs:metrics.durationMs,
      tokenIn: metrics.tokenIn,
      tokenOut: metrics.tokenOut,
      totalTokens: metrics.totalTokens,
    },
  };
}
