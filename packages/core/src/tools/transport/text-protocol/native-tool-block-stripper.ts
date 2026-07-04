/**
 * native function calling 路径的输出侧防御性剥离器。
 *
 * 背景：native 路径假设模型走原生协议返回结构化 toolCalls，正文不含工具往返文本块。
 * 当模型出格式——用纯文本写工具往返而非发起结构化调用——时，native 路径既不解析也不剥离，
 * 这些文本块会泄漏进可见输出。本剥离器作为兜底（defense-in-depth），在终值与流式两侧
 * 对称地把工具往返文本块剥离掉。
 *
 * 与 text-protocol 的 `TextProtocolStreamOutputBuffer` 的区别：
 * - text-protocol 那套只认 `<tool_call>`，是 text_protocol 协议的主防线，不能改它的语义。
 * - 本剥离器独立实现，认 `<tool_call>` / `<tool_result>` / `<tool_response>` 三类成对标签
 *   （含带属性的开标签），只服务 native 路径，是兜底而非主防线。
 *
 * 行为约定（与 text-protocol 剥离器对称）：
 * - 完整闭合的工具块被剥离，块前后的正文保留。
 * - 流式分块跨标签边界时安全缓冲，不会把半个开标签前缀当正文吐出。
 * - 尾部未闭合（malformed）的工具块在 finalize 时按原样保留，避免吞掉模型尚未写完的内容。
 */

const NATIVE_TOOL_BLOCK_TAGS = ['tool_call', 'tool_result', 'tool_response'] as const;

type NativeToolBlockTag = (typeof NATIVE_TOOL_BLOCK_TAGS)[number];

interface NativeToolBlockMatcher {
 tag: NativeToolBlockTag;
  /** 开标签前缀，例如 `<tool_call`（不含结尾 `>`，以容纳带属性的开标签）。 */
  openPrefix: string;
  /** 闭标签，例如 `</tool_call>`。 */
  closeTag: string;
}

const NATIVE_TOOL_BLOCK_MATCHERS: readonly NativeToolBlockMatcher[] = NATIVE_TOOL_BLOCK_TAGS.map(
  (tag) => ({
    tag,
    openPrefix: `<${tag}`,
    closeTag: `</${tag}>`,
  }),
);

const MAX_OPEN_PREFIX_LENGTH = NATIVE_TOOL_BLOCK_MATCHERS.reduce(
  (max, matcher) => Math.max(max, matcher.openPrefix.length),
  0,
);

/**
 * 在 text 中从 startIndex 起查找指定标签的有效开标签起点。
 *
 * 仅当开标签前缀之后紧跟 `>`、空白或字符串结束时才认为有效，避免误匹配
 * `<tool_calls>` 这类同前缀但不同名的标签。
 */
function findTagOpenStart(
  text: string,
  matcher: NativeToolBlockMatcher,
  startIndex: number,
): number {
  let cursor = startIndex;
  while (cursor < text.length) {
    const candidate = text.indexOf(matcher.openPrefix, cursor);
    if (candidate === -1) {
      return -1;
    }

    const after = text[candidate + matcher.openPrefix.length];
    if (after === undefined || after === '>' || /\s/.test(after)) {
      return candidate;
    }

    cursor = candidate + matcher.openPrefix.length;
  }

  return -1;
}

/**
 * 在 text 中查找最早出现的工具块开标签，返回其起点与命中的标签匹配器。
 */
function findNativeToolBlockStart(
  text: string,
  startIndex = 0,
): { index: number; matcher: NativeToolBlockMatcher } | undefined {
  let best: { index: number; matcher: NativeToolBlockMatcher } | undefined;
  for (const matcher of NATIVE_TOOL_BLOCK_MATCHERS) {
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

/**
 * 假定 text 以指定标签的开标签起始，查找完整闭合后的结束位置。
 *
 * 支持同名标签嵌套（按深度计数），未闭合时返回 undefined。
 */
function findCompleteNativeToolBlockEnd(
  text: string,
  matcher: NativeToolBlockMatcher,
): number | undefined {
  const openEnd = text.indexOf('>');
  if (openEnd === -1) {
    return undefined;
  }

  let depth = 1;
  let cursor = openEnd + 1;
  while (cursor < text.length) {
    const nextStart = findTagOpenStart(text, matcher, cursor);
    const nextClose = text.indexOf(matcher.closeTag, cursor);
    if (nextClose === -1) {
      return undefined;
    }

    if (nextStart !== -1 && nextStart < nextClose) {
      depth += 1;
      cursor = nextStart + matcher.openPrefix.length;
      continue;
    }

    depth -= 1;
    cursor = nextClose + matcher.closeTag.length;
    if (depth === 0) {
      return cursor;
    }
  }

  return undefined;
}

/**
 * 计算 text 末尾与任一开标签前缀的最长公共前缀长度。
 *
 * 用于流式场景：当 chunk 末尾恰好是某个开标签的前半截（例如 `<tool_re`）时，
 * 暂不吐出这一段，等后续 chunk 补齐再判断，避免把半个工具块当正文输出。
 */
function longestNativeToolBlockStartPrefixSuffix(text: string): number {
  const maxLength = Math.min(text.length, MAX_OPEN_PREFIX_LENGTH - 1);
  for (let length = maxLength; length > 0; length -= 1) {
    const suffix = text.slice(text.length - length);
    for (const matcher of NATIVE_TOOL_BLOCK_MATCHERS) {
      if (matcher.openPrefix.startsWith(suffix)) {
        return length;
      }
    }
  }

  return 0;
}

/**
 * native 路径的流式工具块剥离缓冲。
 *
 * 用法与 `TextProtocolStreamOutputBuffer` 对称：每收到一段 chunk 调用 `process`，
 * 返回这一刻可安全吐出的可见文本；流结束时调用 `finalize` 取回尾部残留。
 */
export class NativeToolBlockStreamBuffer {
  private visibleBuffer = '';
  private toolBlockBuffer = '';
  private activeMatcher: NativeToolBlockMatcher | undefined;

  process(chunk: string): string {
    let output = '';

    if (this.activeMatcher) {
      this.toolBlockBuffer += chunk;
    } else {
      this.visibleBuffer += chunk;
    }

    while (true) {
      if (this.activeMatcher) {
        const end = findCompleteNativeToolBlockEnd(this.toolBlockBuffer, this.activeMatcher);
        if (end === undefined) {
          break;
       }

        const remainder = this.toolBlockBuffer.slice(end);
        this.toolBlockBuffer = '';
        this.activeMatcher = undefined;
        if (remainder.length > 0) {
          this.visibleBuffer += remainder;
          continue;
        }
        break;
      }

      const start = findNativeToolBlockStart(this.visibleBuffer);
      if (!start) {
        const overlap = longestNativeToolBlockStartPrefixSuffix(this.visibleBuffer);
        const safeLength = this.visibleBuffer.length - overlap;
        if (safeLength <= 0) {
          break;
        }

        output += this.visibleBuffer.slice(0, safeLength);
        this.visibleBuffer = this.visibleBuffer.slice(safeLength);
        break;
      }

      output += this.visibleBuffer.slice(0, start.index);
      this.toolBlockBuffer = this.visibleBuffer.slice(start.index);
      this.visibleBuffer = '';
      this.activeMatcher = start.matcher;
    }

    return output;
  }

  finalize(): string {
    const trailingText = this.activeMatcher
      ? `${this.visibleBuffer}${this.toolBlockBuffer}`
      : this.visibleBuffer;

    this.visibleBuffer = '';
    this.toolBlockBuffer = '';
    this.activeMatcher = undefined;

    return trailingText;
  }
}

/**
 * 对一段完整文本剥离 native 工具往返文本块，保留尾部未闭合内容。
 *
 * 这是 native 路径终值剥离的入口，与 text-protocol 的
 * `stripTextProtocolToolCallBlocksPreservingTrailingMalformed` 对称。
 */
export function stripNativeToolBlocksPreservingTrailingMalformed(text: string): string {
  const buffer = new NativeToolBlockStreamBuffer();
  return `${buffer.process(text)}${buffer.finalize()}`.trim();
}


/**
 * 判断文本中是否存在 native 工具往返文本块的开标签。
 *
 * 用于历史协议归一化：仅对确实含工具块的历史 assistant 文本做剥离，不含时
 * 原样透传，避免对正常历史做无谓改写（包括首尾空白）。标签匹配复用同一套
 * findNativeToolBlockStart 逻辑，与剥离器保持一致。
 */
export function containsNativeToolBlock(text: string): boolean {
  return findNativeToolBlockStart(text) !== undefined;
}
