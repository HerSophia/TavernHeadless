/**
 * 基于解析索引把输入文本切片为「普通文本 / 提及」片段（图助手 · 提及阶段）。
 *
 * 纯函数：渲染 chip 与发送解析共用同一套识别逻辑。识别规则见设计 §3.5：
 * - 命中条件：`@` 前为行首或空白，且其后紧随一个「已知名称」（来自解析索引）。
 * - 同一位置多个名称可匹配时取最长名称（兼容带空格的名称）。
 * - 每段带在文本中的起止下标，供镜像层渲染与 ✕ 精确删除。
 *
 *名称作 token 在「带空格且重名」时无法从纯文本无歧义还原到唯一 id，
 * 故同名多引用时片段带 `refs`（全部候选），由 build-mentions-block 标注「名称重复」。
 */
import type { MentionRef } from "./mention-types";

/** 解析索引：名称 → 该名称对应的一个或多个结构化引用。 */
export type MentionIndex = Map<string, MentionRef[]>;

/** 文本片段：普通文本或一个提及。 */
export interface TextSegment {
  type: "text";
  value: string;
  start: number;
  end: number;
}

export interface MentionSegment {
  type: "mention";
  /** token 文本，含前导 `@`（如 `@订单处理`）。 */
  value: string;
  start: number;
  end: number;
  /** 首个引用（同名唯一时即它）。 */
  ref: MentionRef;
  /** 同名的全部引用（长度 > 1 表示重名）。 */
  refs: MentionRef[];
}

export type MentionTextSegment = TextSegment | MentionSegment;

function isWhitespace(char: string): boolean {
  return /\s/.test(char);
}

/**
 * 把文本按解析索引切片。
 *
 * @param text 当前输入文本。
 * @param index 名称 → 引用列表 的解析索引。
 * @returns 有序片段数组；连续普通文本会合并为一个 text 段。
 */
export function segmentMentionText(text: string, index: MentionIndex): MentionTextSegment[] {
  // 已知名称按长度降序，保证同位匹配时最长优先。
  const names = [...index.keys()].filter((name) => name.length > 0).sort((a, b) => b.length- a.length);

  const segments: MentionTextSegment[] = [];
  let textStart = 0;
  let i = 0;

  /** 把 [textStart, end) 之间的普通文本压入结果（非空才压）。 */
  const flushText =(end: number): void => {
    if (end > textStart) {
      segments.push({ type: "text", value: text.slice(textStart, end), start: textStart, end });
    }
  };

  while (i < text.length) {
    if (text[i] !== "@") {
      i+= 1;
      continue;
    }
    // 前边界：`@` 前必须行首或空白。
    const prev = i > 0 ? text[i - 1]! : "";
 if (i !== 0 && !isWhitespace(prev)) {
      i += 1;
      continue;
    }
    //尝试用已知名称匹配 `@`之后的文本（最长优先）。
    const matched = names.find((name) => text.startsWith(name, i + 1));
    if (!matched) {
      i += 1;
      continue;
    }
    const refs = index.get(matched)!;
    const end = i + 1 + matched.length;
    flushText(i);
    segments.push({
      type: "mention",
      value: text.slice(i, end),
      start: i,
      end,
      ref: refs[0]!,
      refs,
    });
    textStart = end;
    i = end;
  }

  flushText(text.length);
  return segments;
}

/** 从切片结果收集去重后的引用（按 kind + id 去重；同名多引用全部保留）。 */
export function collectMentionRefs(segments: MentionTextSegment[]): MentionRef[] {
  const seen = new Set<string>();
  const result: MentionRef[] = [];
  for (const segment of segments) {
    if (segment.type !== "mention") {
      continue;
    }
    for (const ref of segment.refs) {
      const key = `${ref.kind}:${ref.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(ref);
      }
    }
}
  return result;
}
