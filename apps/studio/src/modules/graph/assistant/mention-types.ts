/**
 * 图助手 "@" 提及的类型定义（图助手 · 提及阶段）。
 *
 * 数据层与视觉层分离：textarea 纯文本 token `@名称` 是唯一事实源，
 * 这里的结构化引用（MentionRef）只是「把文本里的 @名称 还原成带 id 的引用」的产物，
 * 由可丢弃、可重建的解析索引承载，不进入持久化数据。
 */

/** 提及来源类别：项目内的图、当前图的节点、当前画布选中项。 */
export type MentionKind = "graph" | "node" | "selection";

/**
 * 结构化引用：一个 `@名称` token 解析后的目标。
 *
 * `name` 既是展示名，也是文本里 token 的内容（`@` + name）。
 * `type` 仅节点提及携带（节点类型），用于在提及块里补充说明。
 */
export interface MentionRef {
  kind: MentionKind;
  id: string;
  name: string;
  type?: string;
}

/**
 * 候选项：弹层里可供选择的一条提及目标。
 *
 * `subtitle` 给出 kind / type / 短 id 等摘要，便于在重名或同类目标间区分。
 */
export interface MentionCandidate {
  kind: MentionKind;
  id: string;
  name: string;
  /** 节点类型（仅节点候选携带），随确认写入 MentionRef.type。 */
  type?: string;
  subtitle?: string;
}

/** 候选确认后转为结构化引用（丢弃 subtitle 等纯展示字段）。 */
export function candidateToRef(candidate: MentionCandidate): MentionRef {
  return {
    kind: candidate.kind,
    id: candidate.id,
    name: candidate.name,
    ...(candidate.type ? { type: candidate.type } : {}),
  } as MentionRef;
}
