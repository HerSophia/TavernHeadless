/**
 * 回复正文片段解析（图助手 · 回复查看器）。
 *
 * 把一条助手回复正文拆成有序片段：普通文本与工具往返文本块
 * （`<tool_call>` / `<tool_result>` / `<tool_response>`，含带属性的开标签）。
 * 其中 `tool_call` 块会尝试解析出结构化的工具名与参数，供查看器分区展示。
 *
 *背景：原生（native）协议下工具调用本应走结构化通道，正文不含工具块。当模型
 * 出格式把工具往返写成文本时，这些块会泄漏进落库正文。本解析器让查看器把泄漏的
 * 工具块与真实文本分离呈现，便于排查。纯函数、无 DOM 依赖，便于单测。
 *
 * 标签匹配规则与后端 native 剥离器保持一致：开标签前缀之后必须紧跟 `>`、空白或
 * 字符串结束，避免把 `<tool_calls>` 这类同前缀异名标签误判为工具块。
 */

/** 片段类型：普通文本，或三类工具往返文本块。 */
export type ReplyFragmentType = "text" | "tool_call" | "tool_result" | "tool_response";

const TOOL_BLOCK_TAGS = ["tool_call", "tool_result", "tool_response"] as const;
type ToolBlockTag = (typeof TOOL_BLOCK_TAGS)[number];

interface ToolBlockMatcher {
  tag: ToolBlockTag;
  openPrefix: string;
  closeTag: string;
}

const MATCHERS: readonly ToolBlockMatcher[] = TOOL_BLOCK_TAGS.map((tag) => ({
  tag,
  openPrefix: `<${tag}`,
  closeTag: `</${tag}>`,
}));

/** tool_call 块解析出的结构化工具调用。 */
export interface ParsedToolCall {
  /** 工具名（从 JSON 的 name 字段解析；缺失或解析失败为 null）。 */
  name: string | null;
  /** 工具参数（从 JSON 的 arguments / args 字段解析；缺失或解析失败为 null）。 */
  arguments: unknown;
}

/** 单个回复片段。 */
export interface ReplyFragment {
  type: ReplyFragmentType;
  /** 该片段原始文本：文本片段为文本本身；工具块为含标签的完整块。 */
  raw: string;
  /** 工具块标签内的内容（文本片段无此字段）。 */
  inner?: string;
  /** 工具块未闭合（缺少闭合标签）时为 true。 */
  malformed?: boolean;
  /** tool_call 块解析出的结构化工具调用（JSON 可解析时）。 */
  toolCall?: ParsedToolCall;
}

/**
 * 从 startIndex 起查找指定标签的有效开标签起点。
 *
 * 仅当开标签前缀之后紧跟 `>`、空白或字符串结束时才认为有效。
 */
function findTagOpenStart(text: string, matcher: ToolBlockMatcher, startIndex: number): number {
  let cursor = startIndex;
  while (cursor < text.length) {
    const candidate = text.indexOf(matcher.openPrefix, cursor);
    if (candidate === -1) {
      return -1;
    }
   const after = text[candidate + matcher.openPrefix.length];
    if (after === undefined || after === ">" || /\s/.test(after)) {
   return candidate;
    }
    cursor = candidate + matcher.openPrefix.length;
  }
  return -1;
}

/** 查找最早出现的工具块开标签，返回其起点与命中的标签匹配器。 */
function findEarliestToolBlockStart(
  text: string,
  startIndex: number,
): {index: number; matcher: ToolBlockMatcher } | undefined {
  let best: { index: number; matcher: ToolBlockMatcher } | undefined;
  for (const matcher of MATCHERS) {
    const index = findTagOpenStart(text, matcher, startIndex);
    if (index === -1) {
      continue;
    }
    if (!best || index < best.index) {
      best = { index, matcher };
    }
  }
  return best;
}

function tryParseToolCall(inner: string): ParsedToolCall | undefined {
  try {
    const parsed: unknown = JSON.parse(inner.trim());
    if (!parsed || typeof parsed !== "object") {
      return undefined;
    }
    const record = parsed as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name : null;
    const args =
      "arguments" in record ? record.arguments : "args" in record ? record.args : null;
    return { name, arguments: args ?? null };
  } catch {
    return undefined;
  }
}

function makeToolFragment(
  tag: ToolBlockTag,
  raw: string,
  inner: string,
  malformed: boolean,
): ReplyFragment {
  const fragment: ReplyFragment = { type: tag, raw, inner };
  if (malformed) {
    fragment.malformed = true;
  }
  if (tag === "tool_call") {
    const parsed = tryParseToolCall(inner);
    if (parsed) {
      fragment.toolCall = parsed;
    }
  }
  return fragment;
}

/** 仅在文本含非空白字符时推入文本片段，避免相邻工具块之间产生空白片段。 */
function pushText(fragments: ReplyFragment[], text: string): void {
  if (text.trim().length === 0) {
    return;
  }
  fragments.push({ type: "text", raw: text });
}

/**
 * 把回复正文拆成有序片段。
 *
 * 工具块按"最早出现的开标签 → 同名最近闭合标签"切分；tool_call 块的 inner 是
 * JSON 对象，不含闭合标签，因此最近闭合匹配是安全的。开标签或闭合标签缺失时，
 * 把剩余内容作为未闭合（malformed）工具块片段，保留排查信息。
 */
export function parseReplyFragments(content: string): ReplyFragment[] {
  const fragments: ReplyFragment[] = [];
  let cursor = 0;

  while (cursor < content.length) {
    const start = findEarliestToolBlockStart(content, cursor);
    if (!start) {
      pushText(fragments, content.slice(cursor));
      break;
    }

    if (start.index > cursor) {
      pushText(fragments, content.slice(cursor, start.index));
    }

    const { matcher } = start;
    const openTagEnd = content.indexOf(">", start.index);
    if (openTagEnd === -1) {
      // 开标签未闭合：剩余整段作为未闭合工具块。
      fragments.push(makeToolFragment(matcher.tag, content.slice(start.index), "", true));
      break;
    }

    const closeIndex = content.indexOf(matcher.closeTag, openTagEnd + 1);
    if (closeIndex === -1) {
      // 缺少闭合标签：剩余作为未闭合工具块。
      const raw = content.slice(start.index);
      const inner = content.slice(openTagEnd + 1);
      fragments.push(makeToolFragment(matcher.tag, raw, inner, true));
      break;
    }

    const blockEnd = closeIndex + matcher.closeTag.length;
    const raw = content.slice(start.index, blockEnd);
    const inner = content.slice(openTagEnd + 1, closeIndex);
    fragments.push(makeToolFragment(matcher.tag, raw, inner, false));
    cursor = blockEnd;
  }

  return fragments;
}

/** 片段统计：用于查看器头部提示与泄漏判定。 */
export interface ReplyFragmentStats {
  textCount: number;
  toolCallCount: number;
  /** tool_result 与 tool_response 合计。 */
  toolResultCount: number;
  /** 是否检测到任何工具往返文本块（原生协议下不应出现）。 */
  hasLeakedToolBlocks: boolean;
}

/** 统计片段构成。 */
export function summarizeReplyFragments(fragments: readonly ReplyFragment[]): ReplyFragmentStats {
  let textCount = 0;
  let toolCallCount = 0;
  let toolResultCount = 0;
  for (const fragment of fragments) {
    if (fragment.type === "text") {
      textCount += 1;
    } else if (fragment.type === "tool_call") {
      toolCallCount += 1;
    } else {
      toolResultCount += 1;
    }
  }
  return {
    textCount,
    toolCallCount,
    toolResultCount,
    hasLeakedToolBlocks: toolCallCount + toolResultCount > 0,
  };
}
