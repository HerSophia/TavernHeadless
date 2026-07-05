/**
 * `NodeGraphDocument` ↔ Vue Flow 映射（B10 阶段 4，纯函数、可单测）。
 *
 * 设计 §3.1：用 registry 元数据驱动节点外观（phase / side-effect / ports），
 * 区分 data/control 边，并支持运行状态叠加。坐标 `ui.position` 可缺省——本映射对缺省
 * 节点用**确定性的占位列布局**（按 phase 分列、列内按文档序堆叠）兜底，真正的 elkjs
 * 自动布局在阶段 5 接入；`hasPosition` 标记原文档是否自带坐标，供上层提示与阶段 5 复用。
 */
import {
  createDefaultNodeTypeRegistry,
  groupSwitchState,
  nodeGraphEdgeKind,
  resolveNodeGraphNodePorts,
  type NodeGraphDocument,
  type NodeGraphEdgeKind,
  type NodeGraphGroup,
  type NodeGraphGroupSwitchState,
  type NodeGraphNode,
  type NodeGraphNodeRunStatus,
  type NodeGraphPhase,
  type NodeGraphPortDefinition,
  type NodeGraphPortType,
  type NodeGraphPreview,
  type NodeGraphPreviewPolicy,
  type NodeTypeRegistry,
  type NodeTypeRegistryEntry,
} from "@tavern/core/node-graph";
import type { Edge, EdgeMarker, MarkerType, Node, Styles } from "@vue-flow/core";

import type { InlineConfigLlmProfileOption, NodeInlineConfigControl } from "../inline-config/node-inline-config";
import { buildInlineConfigControls } from "../inline-config/node-inline-config";
import {
  channelHandleId,
  deriveGroupBoundaryHandles,
  inputHandleId,
  type GroupBoundaryHandles,
} from "../subgraph/group-channels";
import { EDGE_STYLES, phaseStyle, type NodeSideEffect } from "./port-styles";

/** 节点固定宽度（px）。组件与包围盒计算共用，保证一致。 */
export const NODE_WIDTH = 220;
/** 节点头部高度（标题 + 类型行）。 */
export const NODE_HEADER_HEIGHT = 66;
/** 单个端口行高。 */
export const NODE_PORT_ROW_HEIGHT = 22;
/** 节点底部高度（phase / previewPolicy 行）。 */
export const NODE_FOOTER_HEIGHT = 22;

/** 占位列布局：列间距、列内行间距、起点。 */
const FALLBACK_COLUMN_GAP = 320;
const FALLBACK_ROW_GAP = 28;
const FALLBACK_ORIGIN = { x: 0, y: 0 };

/** 分组容器内边距与顶部标签预留高度。 */
const GROUP_PADDING = 24;
const GROUP_LABEL_SPACE = 8;

/** 自定义节点 / 分组容器在 Vue Flow 中的 type 标识。 */
export const TAVERN_NODE_TYPE = "tavern" as const;
export const GROUP_NODE_TYPE = "group" as const;
/** 折叠态子图组：对外表现为单个节点（Blender 式 NodeGroup）。 */
export const GROUP_COLLAPSED_NODE_TYPE = "groupCollapsed" as const;

/** 折叠节点的 Vue Flow node id 前缀（区别于包围盒容器 `group:`）。 */
export const COLLAPSED_NODE_ID_PREFIX = "groupx:" as const;

const AGENT_EXECUTION_NODE_TYPES = new Set([
  "narration.narrator",
  "agent.director_plan",
  "agent.player_agency_precheck",
  "agent.call",
  "verify.continuity",
  "verify.player_agency_postcheck",
]);

const AGENT_GENERATION_PARAM_KEYS = [
  "temperature",
  "topP",
  "maxOutputTokens",
  "maxContextTokens",
  "frequencyPenalty",
  "presencePenalty",
  "repetitionPenalty",
];

export interface GraphNodeConfigSummaryItem {
  label: string;
  /** 标签 i18n key（缺省回退到 label 英文技术短码）。 */
  labelKey?: string;
  value?: string;
/** 描述性取值的 i18n key（枚举 / 表达式等技术标识不设，保留原样等宽展示）。 */
  valueKey?: string;
  /** valueKey 的插值参数（如字符数、端口数）。 */
  valueParams?: Record<string, string | number>;
  tone?: "neutral" | "warning";
}

export type GraphNodePreviewStatus = "available" | "disabled" | "running" | "succeeded" | "failed";

export interface GraphNodePreviewSummary {
  status: GraphNodePreviewStatus;
  policy: NodeGraphPreviewPolicy;
  source?: NodeGraphPreview["source"];
}

export interface GraphTavernNodeData {
  kind: "node";
  node: NodeGraphNode;
  /** registry 元数据；未知节点类型时为 undefined。 */
  entry?: NodeTypeRegistryEntry;
  title: string;
  phase: NodeGraphPhase;
  sideEffects: NodeSideEffect;
  permissionsRequired: string[];
  inputPorts: NodeGraphPortDefinition[];
  outputPorts: NodeGraphPortDefinition[];
  previewPolicy: NodeGraphPreviewPolicy;
  previewSummary: GraphNodePreviewSummary;
  configSummary: GraphNodeConfigSummaryItem[];
  inlineConfigControls: NodeInlineConfigControl[];
  configMissing: boolean;
  /** 运行状态叠加（来自 run trace，可缺省）。 */
  runStatus?: NodeGraphNodeRunStatus;
  /** 原文档是否自带坐标（false = 本次为占位布局）。 */
  hasPosition: boolean;
  /** registry 未登记该类型。 */
  unknownType: boolean;
  enabled: boolean;
}

export interface GraphGroupNodeData {
  kind: "group";
  group: NodeGraphGroup;
  memberCount: number;
  /** 组开关三态（由成员 `node.enabled` 派生）：驱动组容器上的开关 UI。 */
  switchState: NodeGraphGroupSwitchState;
}

/** 折叠节点的一个接口端口（由跨边界连线派生）。 */
export interface CollapsedGroupHandle {
  /** Vue Flow handle id（与重路由后的边 sourceHandle/targetHandle 对应）。 */
  id: string;
  /** 展示标签（取边界成员节点标题 + 端口）。 */
  label: string;
  /** 端口数据类型（用于句柄形状/配色）。 */
  type: NodeGraphPortDefinition["type"];
  /** 产出该输出通道的成员节点 id（仅输出句柄）。 */
  producerNodeId?: string;
  /** 通道关闭态（显式关闭或末端节点禁用）：灰显标签、虚化连线（仅输出句柄）。 */
  disabled?: boolean;
}

export interface GraphCollapsedGroupNodeData {
  kind: "groupCollapsed";
  group: NodeGraphGroup;
  memberCount: number;
  switchState: NodeGraphGroupSwitchState;
  /** 左侧输入插槽（外部 → 组内成员的跨界连线派生，按首现去重）。 */
  inputs: CollapsedGroupHandle[];
  /** 右侧输出插槽（组内成员 → 外部的跨界连线派生，按首现去重）。 */
  outputs: CollapsedGroupHandle[];
}

export type GraphFlowNodeData =
  | GraphTavernNodeData
  | GraphGroupNodeData
  | GraphCollapsedGroupNodeData;

export type GraphFlowNode = Node<GraphFlowNodeData>;
/**
 * 边附带渲染元信息：`kind`（data/control）+ `muted`（产出侧关闭：禁用节点/关闭通道→虚化）。
 * `dashed = kind === 'control' || muted`，供「仅显示实线」过滤。
 */
export interface GraphFlowEdgeData {
  kind: NodeGraphEdgeKind;
  muted: boolean;
}
/**
 * vue-flow 的输入 `Edge` 类型不含 `selected`（该字段属内部 `GraphEdge`），
 * NG2-6 需要在映射结果上携带选中态供高亮与测试断言，故用交叉类型补上。
 */
export type GraphFlowEdge = Edge<GraphFlowEdgeData> & { selected?: boolean };

export interface MapDocumentOptions {
  registry?: NodeTypeRegistry;
  /** 节点运行状态（按 nodeId），用于运行态叠加。 */
  runStatusByNodeId?: Record<string, NodeGraphNodeRunStatus>;
  /**
   * 钻入（drill-in）：仅渲染该组的成员节点与组内边，隐藏其余节点与所有分组容器。
   * 用于把导入的大图按「系统功能」分组聚焦编辑。组不存在时回退为整图。
   */
  focusGroupId?: string | null;
  /**可选的 LLM Profile 列表：供 Agent 节点卡片上的模型来源下拉选择。 */
  llmProfiles?: InlineConfigLlmProfileOption[];
  /** NG2-6：当前选中的边 id，用于选中态高亮（描边加粗提亮）。 */
  selectedEdgeId?: string | null;
}

export interface MappedGraph {
  nodes: GraphFlowNode[];
  edges: GraphFlowEdge[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function summarizeAgentExecutionConfig(config: Record<string, unknown>): GraphNodeConfigSummaryItem[] {
  const execution = asRecord(config.execution);
  const modelSource = asRecord(execution.modelSource);
  const mode = readString(modelSource.mode) ?? "inherit";
  const profileId = readString(modelSource.profileId);
  const agentBindingId = readString(config.agentBindingId) ?? readString(modelSource.agentBindingId);
  const slot = readString(modelSource.slot);
  const modelId = readString(execution.modelId);
  const items: GraphNodeConfigSummaryItem[] = [summarizeAgentExecutionSource(mode, profileId, modelId, agentBindingId, slot)];
  const generationSummary = summarizeAgentGenerationConfig(execution.generation);
  if (generationSummary) {
    items.push(generationSummary);
  }
  return items;
}

function summarizeAgentExecutionSource(
  mode: string,
  profileId: string | undefined,
  modelId: string | undefined,
  agentBindingId: string | undefined,
  slot: string | undefined,
): GraphNodeConfigSummaryItem {
  if (profileId && modelId) {
    return { label: "execution", value: `${profileId} · ${modelId}` };
  }
  if (profileId) {
    return { label: "execution", value: profileId };
  }
  if (modelId) {
    return { label: "execution", value: modelId };
  }
  if (agentBindingId) {
    return { label: "execution", value: agentBindingId };
  }
  if (mode === "slot" && slot) {
    return { label: "execution", value: slot };
  }
  if (mode === "inherit" || mode === "llm_profile" || mode === "agent_binding" || mode === "slot") {
    const missing = mode !== "inherit";
    return {
      label: "execution",
      value: missing ? "missing" : mode,
      valueKey: missing ? "graphNode.summary.value.missing" : "graphNode.summary.value.execution.inherit",
      tone: missing ? "warning" : "neutral",
    };
  }
  return { label: "execution", value: mode, tone: "warning" };
}

function summarizeAgentGenerationConfig(generation: unknown): GraphNodeConfigSummaryItem | null {
  const record = asRecord(generation);
  const knownParams = AGENT_GENERATION_PARAM_KEYS.filter((key) => record[key] !== undefined);
  if (knownParams.length === 0) {
    return null;
  }
  const enabledCount = knownParams.filter((key) => asRecord(record[key]).enabled === true).length;
  if (enabledCount === 0) {
    return {
      label: "generation",
      value: "default",
      valueKey: "graphNode.summary.value.execution.backendDefaults",
    };
  }
  return {
    label: "generation",
    value: `${enabledCount} enabled`,
    valueKey: "graphNode.summary.value.execution.paramsEnabled",
    valueParams: { count: enabledCount },
  };
}

function compactPath(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  return value.map((segment) => String(segment)).join(".");
}

function summarizeConditionExpr(expr: unknown): string {
  const condition = asRecord(expr);
  const op = typeof condition.op === "string" ? condition.op : "condition";
  switch (op) {
    case "exists":
    case "empty": {
      const value = asRecord(condition.value);
      const source = typeof value.source === "string" ? value.source : "value";
      const path = compactPath(value.path);
      return path ? `${op} ${source}.${path}` : op;
    }
    case "eq":
    case "neq":
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const left = asRecord(condition.left);
      const source = typeof left.source === "string" ? left.source : "value";
      const path = compactPath(left.path);
      return path ? `${source}.${path} ${op}` : op;
    }
    case "and":
    case "or":
      return `${op} ${Array.isArray(condition.items) ? condition.items.length : 0}`;
    case "not":
      return "not";
    default:
      return op;
  }
}

function hasIncomingConditionEdge(document: NodeGraphDocument, nodeId: string): boolean {
  return document.edges.some((edge) => nodeGraphEdgeKind(edge) === "data" && edge.to.nodeId === nodeId && edge.to.port === "condition");
}

export function summarizeNodeConfig(
  document: NodeGraphDocument,
  node: NodeGraphNode,
): { items: GraphNodeConfigSummaryItem[]; missing: boolean } {
  const config = asRecord(node.config);
  const items: GraphNodeConfigSummaryItem[] = [];
  let missing = false;

  switch (node.type) {
    case "agent.call": {
      const medium = asRecord(config.medium);
      const kind = readString(medium.kind) ?? "single_call";
      const deliveryTarget = readString(medium.deliveryTarget) ?? "return_inline";
      items.push({ label: "medium", value: kind });
      items.push({ label: "output", value: deliveryTarget });

      if (kind === "background_job") {
        const agentBindingId = readString(config.agentBindingId);
        items.push({
          label: "binding",
          value: agentBindingId ?? "missing",
          valueKey: agentBindingId ? undefined : "graphNode.summary.value.missing",
          tone: agentBindingId ? "neutral" : "warning",
        });
        missing = missing || !agentBindingId;
      }

      const request = asRecord(config.temporaryConversationRequest);
      if (deliveryTarget === "page_staged_write") {
        const targetPageId = readString(request.targetPageId);
        missing = missing || !targetPageId;
      } else if (deliveryTarget === "derived_output") {
        const derivedOutput = asRecord(request.derivedOutput);
        missing = missing || !readString(derivedOutput.projectId) || !readString(derivedOutput.domain);
      } else if (deliveryTarget === "project_inbox") {
        const projectInbox = asRecord(request.projectInbox);
        missing = missing || !readString(projectInbox.projectId) || !readString(projectInbox.type);
      } else if (deliveryTarget === "prompt_runtime_injection") {
        const injection = asRecord(request.promptRuntimeInjection);
        missing = missing || !readString(injection.targetSessionId) || !readString(injection.content);
      }
      break;
    }

    case "control.condition": {
      if (config.condition === undefined) {
        items.push({ label: "condition", value: "missing", valueKey: "graphNode.summary.value.missing", tone: "warning" });
        missing = true;
      } else {
        items.push({ label: "condition", value: summarizeConditionExpr(config.condition) });
      }
      break;
    }

    case "control.branch": {
      if (config.condition === undefined) {
        items.push({ label: "condition", value: "input", valueKey: "graphNode.summary.value.input" });
      } else {
        items.push({ label: "condition", value: summarizeConditionExpr(config.condition) });
      }
      items.push({ label: "ports", value: "true / false" });
      break;
    }

    case "control.gate": {
      const onSkip = readString(config.onSkip) ?? "empty_output";
      items.push({ label: "onSkip", value: onSkip });
      if (config.condition !== undefined) {
        items.push({ label: "condition", value: summarizeConditionExpr(config.condition) });
      } else if (hasIncomingConditionEdge(document, node.id)) {
        items.push({ label: "condition", value: "input", valueKey: "graphNode.summary.value.input" });
      } else {
        items.push({ label: "condition", value: "missing", valueKey: "graphNode.summary.value.missing", tone: "warning" });
        missing = true;
      }
      break;
    }

    case "compose.template_render": {
      const template = readString(config.template) ?? readString(config.content);
      if (template) {
        items.push({ label: "template", value: `${template.length} chars`, valueKey: "graphNode.summary.value.chars", valueParams: { count: template.length } });
      }
      break;
    }

    case "narration.narrator": {
      const presetRef = asRecord(config.presetRef);
      const presetId = readString(presetRef.presetId);
      items.push({ label: "preset", value: presetId ?? "session", valueKey: presetId ? undefined : "graphNode.summary.value.session" });
      break;
    }

    case "annotation.comment": {
    const content = readString(config.content);
      items.push(
        content
          ? { label: "note", value: `${content.length} chars`, valueKey: "graphNode.summary.value.chars", valueParams: { count: content.length } }
          : { label: "note", value: "empty", valueKey: "graphNode.summary.value.empty" },
      );
      break;
    }

    case "group.node": {
      const ref = asRecord(config.ref);
      const graphId = readString(ref.graphId);
      const iface = asRecord(config.interface);
      const inputs = Array.isArray(iface.inputs) ? iface.inputs.length : 0;
      const outputs = Array.isArray(iface.outputs) ? iface.outputs.length : 0;
      items.push({
        label: "ref",
        value: graphId ?? "missing",
        valueKey: graphId ? undefined : "graphNode.summary.value.missing",
        tone: graphId ? "neutral" : "warning",
      });
      items.push({ label: "ports", value: `${inputs} in / ${outputs} out`, valueKey: "graphNode.summary.value.ports", valueParams: { in: inputs, out: outputs } });
      missing = missing || !graphId || config.interface === undefined;
      break;
    }

    default:
      break;
  }

  if (AGENT_EXECUTION_NODE_TYPES.has(node.type)) {
    items.push(...summarizeAgentExecutionConfig(config));
  }

  const maxSummaryItems = AGENT_EXECUTION_NODE_TYPES.has(node.type) ? 5 : 4;
  const localized = items.slice(0, maxSummaryItems).map((item) => ({
    ...item,
    labelKey: item.labelKey ?? `graphNode.summary.label.${item.label}`,
  }));
  return { items: localized, missing };
}

export function summarizeNodePreview(
  previewPolicy: NodeGraphPreviewPolicy,
  runStatus?: NodeGraphNodeRunStatus,
): GraphNodePreviewSummary {
  if (previewPolicy === "disabled") {
    return { status: "disabled", policy: previewPolicy };
  }
  if (runStatus === "running") {
    return { status: "running", policy: previewPolicy };
  }
  if (runStatus === "succeeded" || runStatus === "reused") {
    return { status: "succeeded", policy: previewPolicy };
  }
  if (runStatus === "failed") {
    return { status: "failed", policy: previewPolicy };
  }
  return { status: "available", policy: previewPolicy };
}

function estimateInlineControlsHeight(controls: readonly NodeInlineConfigControl[] = []): number {
  if (controls.length === 0) {
    return 0;
  }
  const rows = controls.reduce((sum, control) => {
    if (control.type === "textarea") {
      return sum + 52;
    }
    if (control.type === "summary") {
      return sum + 20;
    }
    return sum + 25;
  }, 14);
  return Math.min(rows, 170);
}

export function estimateNodeHeight(
  entry: NodeTypeRegistryEntry | undefined,
  inlineControls: readonly NodeInlineConfigControl[] = [],
): number {
  const inCount = entry?.inputPorts.length ?? 0;
  const outCount = entry?.outputPorts.length ?? 0;
  const rows = Math.max(inCount, outCount, 0);
  return NODE_HEADER_HEIGHT + rows * NODE_PORT_ROW_HEIGHT + estimateInlineControlsHeight(inlineControls) + NODE_FOOTER_HEIGHT;
}

/**
 * 为缺省坐标的节点计算占位列布局：按 phase 顺序分列（仅排入实际出现的 phase，避免空列拉开
 * 大距离），列内按文档顺序自上而下堆叠（用各节点估算高度避免重叠）。
 */
function computeFallbackPositions(
  nodes: NodeGraphNode[],
  entries: Map<string, NodeTypeRegistryEntry | undefined>,
  inlineControlsByNodeId: Map<string, NodeInlineConfigControl[]> = new Map(),
): Map<string, { x: number; y: number }> {
  const missing = nodes.filter((node) => !node.ui?.position);
  const orders = [...new Set(missing.map((node) => phaseStyle(node.phase).order))].sort(
    (left, right) => left - right,
  );
  const columnByOrder = new Map<number, number>(orders.map((order, index) => [order, index]));
  const cumulativeYByOrder = new Map<number, number>();

  const result = new Map<string, { x: number; y: number }>();
  for (const node of missing) {
    const order = phaseStyle(node.phase).order;
    const column = columnByOrder.get(order) ?? 0;
    const cumulativeY = cumulativeYByOrder.get(order) ?? 0;
    result.set(node.id, {
      x: FALLBACK_ORIGIN.x + column * FALLBACK_COLUMN_GAP,
      y: FALLBACK_ORIGIN.y + cumulativeY,
    });
    cumulativeYByOrder.set(
      order,
      cumulativeY + estimateNodeHeight(entries.get(node.id), inlineControlsByNodeId.get(node.id) ?? []) + FALLBACK_ROW_GAP,
    );
  }
  return result;
}

/** 关闭/禁用产出侧的虚化连线视觉（更细、点划、低对比）。 */
const MUTED_EDGE_STROKE = "rgb(113 113 122 / 0.4)";
const MUTED_EDGE_DASH = "2 4";

/** NG2-6：选中边高亮色（复用语义强调令牌，随主题切换）。 */
const SELECTED_EDGE_STROKE = "var(--color-signal-accent)";

function toEdgeStyle(
  kind: NodeGraphEdgeKind,
  muted: boolean,
  selected = false,
): { style: Styles; markerColor: string } {
  const edgeStyle = EDGE_STYLES[kind];
  // NG2-6：选中态优先——描边提亮加粗（内联 style 会盖过 vue-flow 默认选中高亮，故这里显式给出）。
  if (selected) {
    const style: Styles = {
      stroke: SELECTED_EDGE_STROKE,
      strokeWidth: Math.max(edgeStyle.width + 1.25, 2.5),
    };
    if (edgeStyle.dash) {
      style.strokeDasharray = edgeStyle.dash;
    }
    return { style, markerColor: SELECTED_EDGE_STROKE };
  }
  if (muted) {
    return {
      style: { stroke: MUTED_EDGE_STROKE, strokeWidth: 1.25, strokeDasharray: MUTED_EDGE_DASH },
      markerColor: MUTED_EDGE_STROKE,
    };
  }
  const style: Styles = {
    stroke: edgeStyle.stroke,
       strokeWidth: edgeStyle.width,
  };
  if (edgeStyle.dash) {
    style.strokeDasharray = edgeStyle.dash;
  }
  return { style, markerColor: edgeStyle.stroke };
}
/**
 * NG2-6：把某条边装饰为「选中态」（描边提亮加粗）。
 *
 * 单独抽出，供画布在不重算节点的前提下叠加选中高亮——选中边属于高频交互，
 * 若混进 `mapDocumentToFlow` 会导致 nodes 一并重算、丢失仅存于视图层的自动布局坐标。
 *
 * @param edge - 基础边（由 `mapDocumentToFlow` 产出，未选中）
 * @param selected - 是否选中
 * @returns 选中则返回带高亮样式的新边；否则原样返回
 */
export function decorateSelectedEdge(edge: GraphFlowEdge, selected: boolean): GraphFlowEdge {
  if (!selected) {
    return edge;
  }
  const kind = edge.data?.kind ?? "data";
  const muted = edge.data?.muted ?? false;
  const { style, markerColor } = toEdgeStyle(kind, muted, true);
  const baseClass =
    typeof edge.class === "string" ? edge.class : `graph-edge graph-edge--${kind}${muted ? " graph-edge--muted" : ""}`;
  const nextMarkerEnd =
    edge.markerEnd && typeof edge.markerEnd === "object" ? { ...edge.markerEnd, color: markerColor } : edge.markerEnd;
  return {
    ...edge,
    selected: true,
    class: `${baseClass} graph-edge--selected`,
    style,
    markerEnd: nextMarkerEnd,
  };
}



/** 将 `NodeGraphDocument` 映射为 Vue Flow 的 nodes / edges。 */
export function mapDocumentToFlow(
  document: NodeGraphDocument,
  options: MapDocumentOptions = {},
): MappedGraph {
  const registry = options.registry ?? createDefaultNodeTypeRegistry();
  const runStatusByNodeId = options.runStatusByNodeId ?? {};
  const selectedEdgeId = options.selectedEdgeId ?? null;

  // 钻入：聚焦某组时仅渲染其成员 + 组内边，隐藏其余节点与所有分组容器。
  const focusGroup = options.focusGroupId
    ? (document.groups ?? []).find((group) => group.id === options.focusGroupId)
    : undefined;
  const focusSet = focusGroup ? new Set(focusGroup.nodeIds) : null;
  const isRoot = !focusSet;

  // 参与布局/坐标计算的节点集合：根图 = 全部；钻入 = 该组成员。
  const layoutNodes = focusSet ? document.nodes.filter((node) => focusSet.has(node.id)) : document.nodes;

  // 折叠子图组（仅根视图）：成员从画布隐藏、整组改画为单个折叠节点。
  const collapsedGroups = isRoot
    ? (document.groups ?? []).filter((group) => group.kind === "subgraph" && group.collapsed === true)
    : [];
  const memberToCollapsed = new Map<string, NodeGraphGroup>();
  for (const group of collapsedGroups) {
    for (const nodeId of group.nodeIds) {
      memberToCollapsed.set(nodeId, group);
    }
  }
  const hiddenNodeIds = new Set(memberToCollapsed.keys());

  const entries = new Map<string, NodeTypeRegistryEntry | undefined>();
  const titleById = new Map<string, string>();
  const portsById = new Map<
    string,
    { inputPorts: readonly NodeGraphPortDefinition[]; outputPorts: readonly NodeGraphPortDefinition[] }
  >();
  const inlineControlsByNodeId = new Map<string, NodeInlineConfigControl[]>();
  const nodeById = new Map<string, NodeGraphNode>();
  for (const node of layoutNodes) {
    const entry = registry.find(node.type, node.typeVersion);
    entries.set(node.id, entry);
    titleById.set(node.id, node.name ?? entry?.title ?? node.type);
    portsById.set(node.id, resolveNodeGraphNodePorts(node, entry));
    inlineControlsByNodeId.set(
      node.id,
      buildInlineConfigControls(node, entry, {
        document,
        policies: document.policies ?? null,
        llmProfiles: options.llmProfiles,
      }),
    );
    nodeById.set(node.id, node);
  }

  const fallbackPositions = computeFallbackPositions(layoutNodes, entries, inlineControlsByNodeId);
  const resolvedPositions = new Map<string, { x: number; y: number }>();
  for (const node of layoutNodes) {
    resolvedPositions.set(node.id, node.ui?.position ?? fallbackPositions.get(node.id) ?? { x: 0, y: 0 });
  }

  // 钻入兜底：若组成员的显式坐标存在重叠（例如折叠组成员曾被写入同一坐标），
  // 改用确定性占位布局，避免「多个节点叠在一起、只看得到最上面一个」。
  if (focusSet) {
    const seenPositionKeys = new Set<string>();
    let hasOverlap = false;
    for (const node of layoutNodes) {
      const position = resolvedPositions.get(node.id);
      if (!position) {
        continue;
      }
      const key = `${Math.round(position.x)}:${Math.round(position.y)}`;
      if (seenPositionKeys.has(key)) {
        hasOverlap = true;
        break;
      }
      seenPositionKeys.add(key);
    }
    if (hasOverlap) {
      // 强制对全部可见节点重排（忽略其显式坐标），得到互不重叠的占位布局。
      const relaid = computeFallbackPositions(
        layoutNodes.map((node) => ({ ...node, ui: undefined })),
            entries,
      );
      for (const node of layoutNodes) {
        resolvedPositions.set(node.id, relaid.get(node.id) ?? { x: 0, y: 0 });
      }
    }
  }

  // 折叠组的边界端口/输出通道（含通道关闭态），供折叠节点渲染与连线虚化共用。
  const boundaryByGroup = new Map<string, GroupBoundaryHandles>();
  const outputDisabledById = new Map<string, boolean>();
  for (const group of collapsedGroups) {
    const handles = deriveGroupBoundaryHandles(document, group, registry);
    boundaryByGroup.set(group.id, handles);
    for (const channel of handles.outputs) {
      outputDisabledById.set(channel.id, channel.disabled);
    }
  }

  // 普通可见节点：排除被折叠组隐藏的成员。
  const tavernNodes: GraphFlowNode[] = layoutNodes
    .filter((node) => !hiddenNodeIds.has(node.id))
    .map((node) => {
      const entry = entries.get(node.id);
      const explicit = node.ui?.position;
      const position = resolvedPositions.get(node.id) ?? { x: 0, y: 0 };
      const ports = portsById.get(node.id) ?? { inputPorts: [], outputPorts: [] };
      const previewPolicy = node.previewPolicy ?? entry?.previewPolicy ?? "auto";
      const configSummary = summarizeNodeConfig(document, node);
      const inlineConfigControls = inlineControlsByNodeId.get(node.id) ?? [];

      const data: GraphTavernNodeData = {
        kind: "node",
        node,
        entry,
        // 优先显示节点自身 name（如导入预设的 slot 名），便于「哪个节点 = 哪个 slot」；
        // 无 name 时回退注册表标题，再回退类型 id。
        title: titleById.get(node.id) ?? node.type,
        phase: node.phase,
        sideEffects: (entry?.sideEffects ?? "none") as NodeSideEffect,
        permissionsRequired: [...(entry?.permissionsRequired ?? [])],
        inputPorts: [...ports.inputPorts],
        outputPorts: [...ports.outputPorts],
        previewPolicy,
        previewSummary: summarizeNodePreview(previewPolicy, runStatusByNodeId[node.id]),
        configSummary: configSummary.items,
        inlineConfigControls,
        configMissing: configSummary.missing,
        runStatus: runStatusByNodeId[node.id],
        hasPosition: Boolean(explicit),
        unknownType: !entry,
        enabled: node.enabled !== false,
      };

      return {
        id: node.id,
        type: TAVERN_NODE_TYPE,
        position: { ...position },
        data,
        zIndex: 1,
        style: { width: `${NODE_WIDTH}px` },
      };
    });

  // —— 边：根视图全部、钻入仅组内；折叠组内部边隐藏，跨界边重路由到折叠节点的派生端口 ——
  const visibleEdges = focusSet
    ? document.edges.filter((edge) => focusSet.has(edge.from.nodeId) && focusSet.has(edge.to.nodeId))
    : document.edges;

  const edges: GraphFlowEdge[] = [];
  for (const edge of visibleEdges) {
    const fromGroup = memberToCollapsed.get(edge.from.nodeId);
    const toGroup = memberToCollapsed.get(edge.to.nodeId);
    // 同一折叠组内部的边：隐藏（已收进折叠节点）。
    if (fromGroup && toGroup && fromGroup.id === toGroup.id) {
      continue;
    }

    // 产出侧关闭 → 连线虚化：折叠组看输出通道关闭态；普通节点看其 enabled。
    let source = edge.from.nodeId;
    let sourceHandle = edge.from.port;
    let muted: boolean;
    if (fromGroup) {
      const handleId = channelHandleId(edge.from.nodeId, edge.from.port);
      source = `${COLLAPSED_NODE_ID_PREFIX}${fromGroup.id}`;
      sourceHandle = handleId;
      muted = outputDisabledById.get(handleId) ?? false;
    } else {
      muted = nodeById.get(edge.from.nodeId)?.enabled === false;
    }

    let target = edge.to.nodeId;
    let targetHandle = edge.to.port;
    if (toGroup) {
      target = `${COLLAPSED_NODE_ID_PREFIX}${toGroup.id}`;
      targetHandle = inputHandleId(edge.to.nodeId, edge.to.port);
    }

    const kind = nodeGraphEdgeKind(edge);
    const selected = edge.id === selectedEdgeId;
    const { style, markerColor } = toEdgeStyle(kind, muted, selected);
    // 字面量 'arrowclosed' 即 MarkerType.ArrowClosed，避免从 @vue-flow/core 引入运行时值，
    // 使本纯映射可在无 DOM 的 node 环境单测。
    const markerEnd: EdgeMarker = {
      type: "arrowclosed" as MarkerType,
      color: markerColor,
      width: 12,
      height: 12,
    };
    edges.push({
      id: edge.id,
      source,
      target,
      sourceHandle,
      targetHandle,
      data: { kind, muted },
      label: kind === "control" ? "control" : undefined,
      selected,
      class: `graph-edge graph-edge--${kind}${muted ? " graph-edge--muted" : ""}${selected ? " graph-edge--selected" : ""}`,
      style,
      markerEnd,
    });
  }

  // —— 分组包围盒：根视图、非折叠子图组 / 可视组才画框（折叠组改画折叠节点）——
  const boxGroups = focusSet
    ? []
    : (document.groups ?? []).filter((group) => !(group.kind === "subgraph" && group.collapsed === true));
  const groupNodes: GraphFlowNode[] = [];
  for (const group of boxGroups) {
    const memberRects = group.nodeIds
      .map((nodeId) => {
        const position = resolvedPositions.get(nodeId);
        if (!position) {
          return null;
        }
        return {
          x: position.x,
          y: position.y,
          width: NODE_WIDTH,
          height: estimateNodeHeight(entries.get(nodeId), inlineControlsByNodeId.get(nodeId) ?? []),
        };
      })
      .filter((rect): rect is { x: number; y: number; width: number; height: number } => rect !== null);

    if (memberRects.length === 0) {
      continue;
    }

    const minX = Math.min(...memberRects.map((rect) => rect.x));
    const minY = Math.min(...memberRects.map((rect) => rect.y));
    const maxX = Math.max(...memberRects.map((rect) => rect.x + rect.width));
    const maxY = Math.max(...memberRects.map((rect) => rect.y + rect.height));

    const members = group.nodeIds
      .map((nodeId) => nodeById.get(nodeId))
      .filter((node): node is NodeGraphNode => Boolean(node));

    groupNodes.push({
      id: `group:${group.id}`,
      type: GROUP_NODE_TYPE,
      position: { x: minX - GROUP_PADDING, y: minY - GROUP_PADDING - GROUP_LABEL_SPACE },
      data: { kind: "group", group, memberCount: memberRects.length, switchState: groupSwitchState(members) },
      zIndex: 0,
      selectable: false,
      draggable: false,
      focusable: false,
      connectable: false,
      style: {
        width: `${maxX - minX + GROUP_PADDING * 2}px`,
        height: `${maxY - minY + GROUP_PADDING * 2 + GROUP_LABEL_SPACE}px`,
      },
    });
  }

  // —— 折叠节点：每个折叠子图组一个单节点，端口由跨界连线派生 ——
  const collapsedNodes: GraphFlowNode[] = [];
  for (const group of collapsedGroups) {
    const positions = group.nodeIds
      .map((nodeId) => resolvedPositions.get(nodeId))
      .filter((position): position is { x: number; y: number } => Boolean(position));
    if (positions.length === 0) {
      continue;
    }
    const minX = Math.min(...positions.map((position) => position.x));
    const minY = Math.min(...positions.map((position) => position.y));
    const members = group.nodeIds
      .map((nodeId) => nodeById.get(nodeId))
      .filter((node): node is NodeGraphNode => Boolean(node));

    const boundary = boundaryByGroup.get(group.id);
    const data: GraphCollapsedGroupNodeData = {
      kind: "groupCollapsed",
      group,
      memberCount: members.length,
      switchState: groupSwitchState(members),
      inputs: (boundary?.inputs ?? []).map((handle) => ({
        id: handle.id,
        label: handle.label,
        type: handle.type,
      })),
      outputs: (boundary?.outputs ?? []).map((channel) => ({
        id: channel.id,
        label: channel.label,
        type: channel.type,
        producerNodeId: channel.memberNodeId,
        disabled: channel.disabled,
      })),
    };

    collapsedNodes.push({
      id: `${COLLAPSED_NODE_ID_PREFIX}${group.id}`,
      type: GROUP_COLLAPSED_NODE_TYPE,
      position: { x: minX, y: minY },
      data,
      zIndex: 1,
      // 可拖动：拖动折叠节点时由上层按位移整体平移其成员坐标（保留内部布局）。
      draggable: true,
      connectable: false,
      style: { width: `${NODE_WIDTH}px` },
    });
  }

  // 分组容器在前（zIndex 0），普通节点与折叠节点在后（zIndex 1）。
  return { nodes: [...groupNodes, ...tavernNodes, ...collapsedNodes], edges };
}
