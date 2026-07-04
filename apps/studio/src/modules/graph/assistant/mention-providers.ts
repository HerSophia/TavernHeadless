/**
 * "@" 提及候选过滤与排序（图助手 · 提及阶段）。
 *
 * 纯函数：把图 / 节点 / 选中三类来源合并为一个扁平候选列表，并按 query 过滤、排序。
 * 匹配规则：大小写不敏感；前缀命中优先于子串命中；query 为空时给出各来源默认若干项。
 */
import type { MentionCandidate } from "./mention-types";

/**候选来源集合（已由 use-mention-sources 装配为同构候选）。 */
export interface MentionSources {
  /** 当前画布选中项（节点 / 边 / 分组）转成的候选，通常 0~1 条。 */
  selection: MentionCandidate[];
  /** 当前打开图的节点候选。 */
  nodes: MentionCandidate[];
  /** 项目内的图候选。 */
  graphs: MentionCandidate[];
}

/** query 为空时各来源默认展示的最大条数，避免一次性铺满。 */
const DEFAULT_LIMIT_PER_SOURCE = 8;

/** 命中等级：2 前缀、1 子串、0 不命中。 */
function matchRank(name: string, query: string): number {
  const lowerName = name.toLowerCase();
  const lowerQuery = query.toLowerCase();
  if (lowerName.startsWith(lowerQuery)) {
    return 2;
  }
  if (lowerName.includes(lowerQuery)) {
    return 1;
  }
  return 0;
}

/**
 * 过滤并排序候选。
 *
 * 固定来源顺序：选中 → 节点 → 图（同等命中等级下保持该相对顺序，稳定排序）。
 * query 非空时只保留命中项，按命中等级降序；query 为空时各来源取前若干条。
 *
 * @param query 过滤词（不含 `@`）。
 * @param sources 三类来源候选。
 * @returns 过滤排序后的候选列表。
 */
export function filterCandidates(query: string, sources: MentionSources): MentionCandidate[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
     // query 为空：各来源各取前若干条，保持来源顺序。
    return [
      ...sources.selection.slice(0, DEFAULT_LIMIT_PER_SOURCE),
      ...sources.nodes.slice(0, DEFAULT_LIMIT_PER_SOURCE),
      ...sources.graphs.slice(0, DEFAULT_LIMIT_PER_SOURCE),
    ];
  }

  // 固定来源顺序：选中 → 节点 → 图（同等命中等级下按此相对顺序稳定排序）。
  const ordered:MentionCandidate[] = [
    ...sources.selection,
    ...sources.nodes,
    ...sources.graphs,
  ];

  const scored = ordered
    .map((candidate, index) => ({ candidate, index, rank: matchRank(candidate.name, trimmed) }))
    .filter((entry) => entry.rank > 0);

  // 命中等级降序；同级按原始来源顺序（index 升序）稳定排序。
  scored.sort((a, b) => (b.rank - a.rank) || (a.index - b.index));

  return scored.map((entry) => entry.candidate);
}
