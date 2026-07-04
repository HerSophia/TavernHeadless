/**
 * 把提及引用渲染为「【用户提及】」上下文文本块（图助手 · 提及阶段）。
 *
 * 纯函数：发送时调用，把文本里解析出的结构化引用还原成一段给模型阅读的附录，
 * 随现有 dynamicContext 下发。引用块给出精确 graph_id / node_id，助手据此直接读图 / 改图，
 * 省掉 find_by_name 的试探。
 *
 * 重名处理（设计 §6）：同一名称对应多个 id 时，把候选 id全部列出并标注「名称重复」，
 * 由助手用 graph.get 确认具体目标。
 */
import type { MentionRef } from "./mention-types";

/** 提及块标题。 */
const BLOCK_HEADING ="【用户提及】";

/** 来源类别的中文名（用于行内说明）。 */
const KIND_LABEL: Record<MentionRef["kind"], string> = {
  graph: "图",
  node: "节点",
 selection: "选中",
};

/**渲染单条引用的标识部分（graph_id / node_id 等）。 */
function renderRefId(ref: MentionRef): string {
  switch (ref.kind) {
    case "graph":
      return `graph_id=${ref.id}`;
    case "node":
      return ref.type ? `node_id=${ref.id}, type=${ref.type}` : `node_id=${ref.id}`;
    case "selection":
  return ref.type ? `id=${ref.id}, type=${ref.type}` : `id=${ref.id}`;
    default:
      return `id=${ref.id}`;
  }
}

/** 分组键：同 kind + 同 name 视为「同名」，用于重名检测。 */
function groupKey(ref: MentionRef): string {
  return `${ref.kind}\u0000${ref.name}`;
}

/**
 * 渲染提及块。
 *
 * @param refs 去重后的引用列表（顺序即展示顺序）。
 * @returns 提及块文本；空列表返回空串。
 */
export function buildMentionsBlock(refs: MentionRef[]): string {
  if (refs.length === 0) {
    return "";
  }

  // 按 kind + name 分组，保留首次出现顺序，用于重名标注。
  const order: string[] = [];
  const groups = new Map<string, MentionRef[]>();
  for (const ref of refs) {
    const key = groupKey(ref);
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(ref);
  }

  const lines: string[] = [BLOCK_HEADING];
  for (const key of order) {
    const group = groups.get(key)!;
    const first = group[0]!;
    const label = KIND_LABEL[first.kind];
    if (group.length === 1) {
      lines.push(`- ${label}「${first.name}」: ${renderRefId(first)}`);
    } else {
      // 重名：列出所有候选 id，提示助手确认。
      const ids = group.map((ref) => renderRefId(ref)).join("; ");
      lines.push(`- ${label}「${first.name}」（名称重复，请用 graph.get 确认）: ${ids}`);
    }
  }
  return lines.join("\n");
}
