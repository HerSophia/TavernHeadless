/**
 * Graph 画布的**视觉编码单一事实源**（B10 阶段 4）。
 *
 * 这里集中定义 NodeGraph 的数据编码配色与形状：14 种 port type、5 个 phase、
 * 4 种 side-effect、5 种运行状态、data/control 两类边。审美约束要求"颜色全部走令牌、
 * 无散落硬编码"——本模块即该领域编码的**唯一集中处**（而非散落各组件），且所有色值
 * 刻意取低饱和；可在主题间通用的语义状态色直接复用 `--color-signal-*` / `--color-text-*`
 * CSS 变量（Tailwind v4 `@theme` 暴露），其余 port/phase 编码色为主题中性的领域调色板。
 */
import type {
  NodeGraphEdgeKind,
  NodeGraphNodeRunStatus,
  NodeGraphPhase,
  NodeGraphPortType,
} from "@tavern/core/node-graph";

export type PortShape = "circle" | "square" | "diamond";

export interface PortStyle {
  /** 低饱和、主题中性的端口色（用于端口点与连线提示）。 */
  color: string;
  /** 形状按"数据族"编码：标量=圆、结构化负载=方、选择/投影/元信息=菱。 */
  shape: PortShape;
}

/** 未知 port type 的兜底样式（次文本灰 + 圆点）。 */
export const FALLBACK_PORT_STYLE: PortStyle = {
  color: "rgb(113 113 122)",
  shape: "circle",
};

/**
 * 14 种 port type 的颜色/形状编码。颜色低饱和、两主题通用；形状按数据族区分，
 * 让端口在缩略与远观时仍可扫读。
 */
export const PORT_STYLES: Record<NodeGraphPortType, PortStyle> = {
  // 标量 / 简单数据 → 圆
  text: { color: "rgb(154 167 184)", shape: "circle" },
  number: { color: "rgb(142 155 214)", shape: "circle" },
  boolean: { color: "rgb(95 179 163)", shape: "circle" },
  json: { color: "rgb(201 163 107)", shape: "circle" },
  // 结构化 prompt / agent 负载 → 方
  messages: { color: "rgb(123 176 214)", shape: "square" },
  prompt_block: { color: "rgb(169 155 214)", shape: "square" },
  prompt_ir: { color: "rgb(189 147 201)", shape: "square" },
  agent_brief: { color: "rgb(207 152 173)", shape: "square" },
  verifier_result: { color: "rgb(132 189 143)", shape: "square" },
  // 选择 / 投影 / 元信息 → 菱
  state_projection: { color: "rgb(111 182 194)", shape: "diamond" },
  memory_selection: { color: "rgb(210 162 115)", shape: "diamond" },
  worldbook_selection: { color: "rgb(169 189 126)", shape: "diamond" },
  nodegraph_patch: { color: "rgb(197 143 190)", shape: "diamond" },
  diagnostics: { color: "rgb(156 163 175)", shape: "diamond" },
};

export function portStyle(type: string): PortStyle {
  return PORT_STYLES[type as NodeGraphPortType] ?? FALLBACK_PORT_STYLE;
}

export interface PhaseStyle {
  /** 阶段强调色（用于节点左侧细色条与阶段标签），色温由冷到暖编码流水线顺序。 */
  accent: string;
  /** 流水线顺序，供占位列布局与小地图排序使用。 */
  order: number;
  /** 简短技术标签（mono 展示，data-as-texture）。 */
  label: string;
}

/** 5 个 phase 的色温 + 顺序编码（冷→暖：准备→前置→生成→后置→提交）。 */
export const PHASE_STYLES: Record<NodeGraphPhase, PhaseStyle> = {
  floor_prepare: { accent: "rgb(107 143 181)", order: 0, label: "prepare" },
  pre_response: { accent: "rgb(95 168 160)", order: 1, label: "pre" },
  response: { accent: "rgb(201 163 107)", order: 2, label: "response" },
  post_response: { accent: "rgb(207 146 119)", order: 3, label: "post" },
  commit: { accent: "rgb(155 143 207)", order: 4, label: "commit" },
};

export const FALLBACK_PHASE_STYLE: PhaseStyle = {
  accent: "rgb(113 113 122)",
  order: 99,
  label: "unknown",
};

export function phaseStyle(phase: string): PhaseStyle {
  return PHASE_STYLES[phase as NodeGraphPhase] ?? FALLBACK_PHASE_STYLE;
}

export type NodeSideEffect = "none" | "llm" | "tool" | "write";

export interface SideEffectStyle {
  /** 角标文案（none 不展示角标）。 */
  label: string;
  /** 角标色（低饱和）。 */
  color: string;
  /**
   * 强调级别：0 无角标；1 普通（llm/tool）；2 显著（write，仍克制）。
   * 决定节点边框强调与角标对比度。
   */
  emphasis: 0 | 1 | 2;
}

/** side-effect → 角标与边框强调级别（write 最显著，但仍克制）。 */
export const SIDE_EFFECT_STYLES: Record<NodeSideEffect, SideEffectStyle> = {
  none: { label: "", color: "rgb(113 113 122)", emphasis: 0 },
  llm: { label: "LLM", color: "rgb(169 155 214)", emphasis: 1 },
  tool: { label: "TOOL", color: "rgb(123 176 214)", emphasis: 1 },
  write: { label: "WRITE", color: "rgb(207 146 119)", emphasis: 2 },
};

export function sideEffectStyle(effect: string | undefined): SideEffectStyle {
  return SIDE_EFFECT_STYLES[(effect ?? "none") as NodeSideEffect] ?? SIDE_EFFECT_STYLES.none;
}

export interface RunStatusStyle {
  /** 状态色——复用语义信号令牌，随主题切换。 */
  color: string;
  /** 简短技术标签。 */
  label: string;
}

/** 节点运行状态叠加配色，复用 `--color-signal-*` / `--color-text-muted`（主题感知）。 */
export const RUN_STATUS_STYLES: Record<NodeGraphNodeRunStatus, RunStatusStyle> = {
  skipped: { color: "var(--color-text-muted)", label: "skipped" },
  running: { color: "var(--color-signal-accent)", label: "running" },
  succeeded: { color: "var(--color-signal-success)", label: "ok" },
  failed: { color: "var(--color-signal-error)", label: "failed" },
  reused: { color: "var(--color-signal-info)", label: "reused" },
};

export function runStatusStyle(status: NodeGraphNodeRunStatus): RunStatusStyle {
  return RUN_STATUS_STYLES[status];
}

export interface EdgeStyle {
  stroke: string;
  width: number;
  /** SVG strokeDasharray；control 边为虚线。 */
  dash?: string;
}

/**
 * data 与 control 边的视觉区分（设计 §3.1：control 边更细、虚线）。
 * 取主题中性的次文本灰（data）与低饱和品红（control），两主题下均可辨。
 */
export const EDGE_STYLES: Record<NodeGraphEdgeKind, EdgeStyle> = {
  data: { stroke: "rgb(113 113 122 / 0.6)", width: 1.5 },
  control: { stroke: "rgb(197 143 190 / 0.85)", width: 1.25, dash: "5 4" },
};
