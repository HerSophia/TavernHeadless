/**
* 图助手「上下文」配置类型与默认值（图助手 · 提示词阶段二）。
 *
 * context 页负责「采集什么数据、采集多少」：每个数据块一个开关，外加深度 / 数量等预算参数。
 * 配置以一个 JSON 列承载（后端 `context_config`），结构会演进，因此前端读取时统一经
 * `normalizeContextConfig` 与内置默认合并，容忍缺字段与脏数据。
 */

/** 诊断问题类型（NodeGraph 当前只有错误 / 警告两档）。 */
export type DiagnosticKind = "error" | "warning";

/** 「图结构概要」数据块配置。 */
export interface GraphSummaryBlockConfig {
  enabled:boolean;
  /** 是否在概要中附带节点清单。 */
  includeNodeList: boolean;
  /** 节点清单最大条数；-1 表示无限制。 */
  maxNodes: number;
}

/** 「当前选中」数据块配置（无额外预算参数）。 */
export interface SelectionBlockConfig {
  enabled: boolean;
}

/** 「图版本」数据块配置。 */
export interface GraphVersionBlockConfig {
  enabled: boolean;
  /** 历史版本最大条数；-1 表示无限制。 */
  maxVersions: number;
}

/** 「诊断信息」数据块配置。 */
export interface DiagnosticsBlockConfig {
  enabled: boolean;
  /** 纳入的问题类型多选。 */
  types: DiagnosticKind[];
  /** 每类最大条数；-1 表示无限制。 */
  maxPerType: number;
}

/** 「项目元信息」数据块配置（无额外预算参数）。 */
export interface ProjectMetaBlockConfig {
  enabled: boolean;
}

/** 图助手上下文数据块整体配置。 */
export interface GraphAssistantContextConfig {
  graphSummary: GraphSummaryBlockConfig;
  selection: SelectionBlockConfig;
graphVersion: GraphVersionBlockConfig;
  diagnostics: DiagnosticsBlockConfig;
  projectMeta: ProjectMetaBlockConfig;
  /**
   * 注入动态上下文文本的 token 预算上限（粗略估算）；-1 表示不限制。
   * 注意：这里只限制本回合注入的上下文体量，生成的真正 max token 由 LLM Profile 决定。
   */
  maxTokens: number;
}

/** 数据块键（与占位符一一对应，渲染时使用）。 */
export const CONTEXT_BLOCK_KEYS = [
  "graphSummary",
  "selection",
  "graphVersion",
  "diagnostics",
  "projectMeta",
] as const;

export type ContextBlockKey = (typeof CONTEXT_BLOCK_KEYS)[number];

/** 数据块键 → 动态模板占位符 token（不含花括号）。*/
export const CONTEXT_BLOCK_PLACEHOLDER: Record<ContextBlockKey, string> = {
  graphSummary: "graph_summary",
  selection: "selection",
  graphVersion: "graph_version",
  diagnostics: "diagnostics",
  projectMeta: "project_meta",
};

/**
 * 内置默认配置：概要 + 选中 + 诊断开，版本 + 项目元信息关。
 * 缺配置时用它，保证开箱即有合理上下文。
 */
export function defaultContextConfig(): GraphAssistantContextConfig {
  return {
    graphSummary: { enabled: true, includeNodeList: false, maxNodes: 50 },
    selection: { enabled: true },
    graphVersion: { enabled: false, maxVersions: 5 },
    diagnostics: { enabled: true, types: ["error", "warning"], maxPerType: 10},
    projectMeta: { enabled: false },
    // 默认不限制：生成的真正 max token 由 LLM Profile 限定，这里仅在需要时手动收束注入上下文体量。
    maxTokens: -1,
  };
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** 归一化数量预算：非整数或小于 -1 一律回退默认；-1 表示无限制，保留。 */
function asBudget(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return fallback;
  }
  if(value < -1) {
    return fallback;
  }
  return value;
}

function asDiagnosticKinds(value: unknown, fallback: DiagnosticKind[]): DiagnosticKind[] {
  if (!Array.isArray(value)) {
    return [...fallback];
 }
  const result: DiagnosticKind[] = [];
  for (const item of value) {
    if ((item === "error" || item === "warning") && !result.includes(item)) {
      result.push(item);
    }
  }
  return result;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
  ? (value as Record<string, unknown>)
    : {};
}

/**
 * 把后端 `context_config`（任意 JSON 或 null）与内置默认合并为完整配置。
 * 容忍缺字段、类型错误与多余字段；脏值回退默认。
 */
export function normalizeContextConfig(
  raw: Record<string, unknown> | null | undefined,
): GraphAssistantContextConfig {
  const base = defaultContextConfig();
  if (!raw) {
    return base;
  }
  const summary = asRecord(raw.graphSummary);
  const selection = asRecord(raw.selection);
  const version = asRecord(raw.graphVersion);
  const diagnostics = asRecord(raw.diagnostics);
  const projectMeta = asRecord(raw.projectMeta);
  return {
    graphSummary: {
      enabled: asBoolean(summary.enabled, base.graphSummary.enabled),
      includeNodeList: asBoolean(summary.includeNodeList, base.graphSummary.includeNodeList),
      maxNodes: asBudget(summary.maxNodes, base.graphSummary.maxNodes),
    },
    selection: {
      enabled: asBoolean(selection.enabled, base.selection.enabled),
    },
    graphVersion: {
      enabled: asBoolean(version.enabled, base.graphVersion.enabled),
      maxVersions: asBudget(version.maxVersions, base.graphVersion.maxVersions),
    },
    diagnostics: {
      enabled: asBoolean(diagnostics.enabled, base.diagnostics.enabled),
   types: asDiagnosticKinds(diagnostics.types, base.diagnostics.types),
      maxPerType: asBudget(diagnostics.maxPerType, base.diagnostics.maxPerType),
    },
    projectMeta: {
      enabled: asBoolean(projectMeta.enabled, base.projectMeta.enabled),
    },
    maxTokens: asBudget(raw.maxTokens, base.maxTokens),
  };
}
