export const NODE_GRAPH_SCHEMA_VERSION = 1 as const;

/** NG2-CORE：NodeGraph v2 schema 版本。 */
export const NODE_GRAPH_SCHEMA_VERSION_V2 = 2 as const;

/** v2 runtime 可读取的全部 schema 版本（向后兼容 v1）。 */
export const NODE_GRAPH_SUPPORTED_SCHEMA_VERSIONS = [
  NODE_GRAPH_SCHEMA_VERSION,
  NODE_GRAPH_SCHEMA_VERSION_V2,
] as const;

export type NodeGraphSchemaVersion =
  | typeof NODE_GRAPH_SCHEMA_VERSION
  | typeof NODE_GRAPH_SCHEMA_VERSION_V2;

export const NODE_GRAPH_PORT_TYPES = [
  'text',
  'json',
  'boolean',
  'number',
  'prompt_block',
  'prompt_ir',
  'messages',
  'agent_brief',
  'verifier_result',
  'state_projection',
  'memory_selection',
  'worldbook_selection',
  'nodegraph_patch',
  'diagnostics',
  // NG2-GLOBAL-INPUT：自适应通配类型，与任意端口类型兼容。
  // 目前仅 `source.global_input` 节点使用，用于把单个输出广播到同名任意类型输入口。
  'any',
] as const;

export type NodeGraphPortType = (typeof NODE_GRAPH_PORT_TYPES)[number];

export const NODE_GRAPH_PHASES = [
  'floor_prepare',
  'pre_response',
  'response',
  'post_response',
  'commit',
] as const;

export type NodeGraphPhase = (typeof NODE_GRAPH_PHASES)[number];

export type NodeGraphEdgeKind = 'data' | 'control';

export type NodeGraphRetryPolicy =
  | 'reuse_if_inputs_same'
  | 'always_rerun_per_page'
  | 'rerun_if_upstream_changed'
  | 'never_reuse';

/**
 * NG2-CORE：节点执行作用域（纲领第 6.4 节）。
 *
 * 决定该节点输出是否能进入 floor 级持久 checkpoint：
 * - `floor_stable` / `pre_response_deterministic`：可进入 floor checkpoint，PageRun 重试可复用。
 * - `pre_response_stochastic`：含随机性（如 LLM），不进入 floor checkpoint。
 * - `page_volatile`：每次生成尝试都重算，归属 PageRun。
 */
export type NodeGraphNodeScope =
  | 'floor_stable'
  | 'pre_response_deterministic'
  | 'pre_response_stochastic'
  | 'page_volatile';

export const NODE_GRAPH_NODE_SCOPES = [
  'floor_stable',
  'pre_response_deterministic',
  'pre_response_stochastic',
  'page_volatile',
] as const;

/**
 * NG2-CORE：节点 checkpoint 复用策略（纲领第 6.3 节）。
 *
 * - `reuse_on_regen`（默认）：重试时若 input/config/version 一致则复用 checkpoint。
 * - `rerun_on_regen`：每次重试都重跑该节点，不复用 checkpoint。
 * - `manual_refresh`：仅在用户显式刷新时重算，其余复用。
 */
export type NodeGraphCheckpointPolicy =
  | 'reuse_on_regen'
  | 'rerun_on_regen'
  | 'manual_refresh';

export const NODE_GRAPH_CHECKPOINT_POLICIES = [
  'reuse_on_regen',
  'rerun_on_regen',
  'manual_refresh',
] as const;

export type NodeGraphFailurePolicy = 'fail_open' | 'fail_closed' | 'use_default' | 'skip';

export type NodeGraphPreviewPolicy = 'auto' | 'cached_only' | 'manual' | 'disabled';

export type NodeGraphRunIntent = 'normal' | 'dry_run' | 'regenerate' | 'preview';

export type NodeGraphRunStatus = 'running' | 'succeeded' | 'failed' | 'cancelled';

export type NodeGraphNodeRunStatus = 'skipped' | 'running' | 'succeeded' | 'failed' | 'reused';

export interface NodeGraphDocument {
  /**
   * Schema 版本。v1 = 1，NG2-CORE v2 = 2。缺省（旧文档无此字段）按 v1 读取。
   */
  schemaVersion: NodeGraphSchemaVersion;
  graphId: string;
  name: string;
  description?: string;
  mode: 'native_graph';
  nodes: NodeGraphNode[];
  edges: NodeGraphEdge[];
  groups?: NodeGraphGroup[];
  policies: NodeGraphPolicies;
  permissions?: NodeGraphPermissionManifest;
  /**
   * 图级预算覆盖。只能收紧平台默认预算；缺省时使用平台默认值。
   */
  budgets?: NodeGraphBudgetOverrides;
  /**
   * 任意元数据。NG2-CORE 约定保留键：
   * - `systemGraph?: boolean`：标记该图承载主链 prompt 编排，受更严格校验（见 validator）。
   */
  metadata?: Record<string, unknown>;
}

export interface NodeGraphNode {
  id: string;
  type: string;
  typeVersion: string;
  name?: string;
  enabled?: boolean;
  phase: NodeGraphPhase;
  config?: unknown;
  retryPolicy?: NodeGraphRetryPolicy;
  failurePolicy?: NodeGraphFailurePolicy;
  previewPolicy?: NodeGraphPreviewPolicy;
  /** NG2-CORE：执行作用域，决定是否进入 floor checkpoint。 */
  scope?: NodeGraphNodeScope;
  /** NG2-CORE：checkpoint 复用策略。 */
  checkpointPolicy?: NodeGraphCheckpointPolicy;
  ui?: {
    position?: { x: number; y: number };
    groupId?: string;
  };
}

export interface NodeGraphEdgeEndpoint {
  nodeId: string;
  port: string;
}

export interface NodeGraphEdge {
  id: string;
  from: NodeGraphEdgeEndpoint;
  to: NodeGraphEdgeEndpoint;
  /**
   * 边类型。NG2-CORE 起可选：缺省视为 `data`，与 v1（总是显式 data）兼容。
   * `control` 边只在 schemaVersion >= 2 放行（见 validator）。
   */
  kind?: NodeGraphEdgeKind;
  /**
   * 编译期生成的虚拟边标记。
   *
   * 这类边只存在于编译产物（edge maps / 拓扑），不应写回 `document.edges`。
   */
  auto?: boolean;
}

export interface NodeGraphGroup {
  id: string;
  name: string;
  kind: 'visual' | 'subgraph';
  inputPorts?: NodeGraphPortDefinition[];
  outputPorts?: NodeGraphPortDefinition[];
  exposedConfig?: NodeGraphExposedGroupConfig[];
  nodeIds: string[];
  version?: string;
  /**
   * 节点组级「开关」（小部件）：无需钻入组内部即可整体启停其成员节点。
   * 缺省（undefined）= 开（成员各自的 `node.enabled` 生效）。开关与成员 `node.enabled`
   * 保持同步（关 → 成员置 `enabled:false`；开 → 成员清除禁用）；运行时仍只读 `node.enabled`，
   * 因此本字段不引入新的运行时语义，仅为「绑定节点的成组启停」提供持久化状态与 UI 锚点。
   */
  enabled?: boolean;
  /**
   * UI 折叠态：`true` 时该子图组在画布上**对外表现为单个节点**（Blender 式 NodeGroup，
   * 左入右出的接口端口由跨边界连线派生），双击该节点即可钻入其内部子图；`false`/缺省时
   * 铺开为包围盒区域。纯展示状态，不影响校验/运行。
   */
  collapsed?: boolean;
  /**
   * UI 输出通道显式关闭集合：折叠节点组对外暴露的「输出通道」（组内成员→ 外部连线派生）
   * 可被逐条显式开关，关闭项以其通道 handle id（`out:<memberNodeId>:<port>`）记入本集合。
   * 纯展示/编排显示状态：被关闭的通道在画布上灰显标签、虚化连线，但不改写底层数据与边。
   * 缺省/空数组 = 全部通道开启。
   */
  disabledChannels?: string[];
  /** NG2-CORE：节点组级 checkpoint 复用策略。 */
  checkpointPolicy?: NodeGraphRetryPolicy;
}

export interface NodeGraphExposedGroupConfig {
  key: string;
  label?: string;
  nodeId: string;
  configPath: string;
  valueType?: NodeGraphPortType;
}

export interface NodeGraphPolicies {
  /**
   * 保留字段（reserved）。运行时 executor 当前**顺序执行**，不消费该字段，
   * 不承诺真正的节点并发语义。单层最大节点数（fan-out 宽度）由运行时预算的
   * `maxFanOut` 单独治理，避免“声明却不生效”的歧义。
   */
  maxParallelNodes?: number;
  defaultRetryPolicy?: NodeGraphRetryPolicy;
  defaultFailurePolicy?: NodeGraphFailurePolicy;
  allowBackgroundJobs?: boolean;
  allowPersistentOutputs?: boolean;
}

export interface NodeGraphPermissionManifest {
  required?: string[];
  grants?: Record<string, unknown>;
  outputTargets?: string[];
  toolScopes?: string[];
}

/** NodeGraph 单次运行预算。 */
export interface NodeGraphRuntimeBudget {
  /** 单次运行最多执行的非注释节点数。 */
  maxNodesExecuted: number;
  /** 最大拓扑深度。 */
  maxDepth: number;
  /** 单个拓扑层允许的最大节点数。 */
  maxFanOut: number;
  /** 真实运行中最多允许入队的后台 Agent job 数。0 表示禁用。 */
  maxNestedAgentJobs: number;
  /** 真实运行中最多允许创建的临时对话数。0 表示禁用。 */
  maxTemporaryConversations: number;
  /** 软运行时长上限，单位毫秒。 */
  maxRuntimeDurationMs: number;
}

/**
 * 图级预算覆盖。
 *
 * 每个字段缺省时使用平台默认值。保存时应为有限整数；解析有效预算时只能收紧平台默认值。
 */
export interface NodeGraphBudgetOverrides {
  maxNodesExecuted?: number;
  maxDepth?: number;
  maxFanOut?: number;
  maxNestedAgentJobs?: number;
  maxTemporaryConversations?: number;
  maxRuntimeDurationMs?: number;
}

/**
 * NodeGraph 内置节点分类。
 *
 * 分类只描述编辑和说明用途，不改变节点运行语义。
 */
export const NODE_GRAPH_NODE_CATEGORIES = [
  'source',
  'select',
  'compose',
  'agent',
  'narration',
  'verify',
  'output',
  'group',
  'control',
  'annotation',
] as const;

export type NodeGraphNodeCategory = (typeof NODE_GRAPH_NODE_CATEGORIES)[number];

export type NodeGraphNodeConfigFieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'object'
  | 'array'
  | 'enum'
  | 'json';

/** 单个节点配置字段的说明。 */
export interface NodeGraphNodeConfigFieldKnowledge {
  path: string;
  label?: string;
  type: NodeGraphNodeConfigFieldType;
  required?: boolean;
  description: string;
  enumValues?: string[];
  defaultValue?: unknown;
}

/** 节点配置说明。第一版只表达对象配置和无配置两类。 */
export interface NodeGraphNodeConfigKnowledge {
  mode: 'none' | 'object';
  fields?: NodeGraphNodeConfigFieldKnowledge[];
  /** 新建节点时可使用的默认配置。该值只服务编辑体验，不改变运行时默认语义。 */
  defaultConfig?: unknown;
}

/** 节点使用示例。 */
export interface NodeGraphNodeExample {
  title: string;
  description?: string;
  node?: unknown;
  notes?: string[];
}

/** 面向 Studio 与 Agent 工具的节点知识。 */
export interface NodeGraphNodeTypeKnowledge {
  category: NodeGraphNodeCategory;
  summary: string;
  usage?: string;
  config?: NodeGraphNodeConfigKnowledge;
  examples?: NodeGraphNodeExample[];
  pitfalls?: string[];
  relatedNodeTypes?: string[];
}

export interface NodeGraphPortDefinition {
  name: string;
  type: NodeGraphPortType;
  required?: boolean;
  multiple?: boolean;
  description?: string;
  schema?: unknown;
  /**
   * 变长输出端口标记（NG2-GLOBAL-INPUT）。
   *
   * 仅用于输出端口：表示该端口可被重复连出（画布表现为可堆叠插槽），校验上等价于 `multiple: true`。
   * 用于 `source.global_input` 这类「一个端口承载多条出边」的广播源节点。
   * 缺省（undefined）= 普通端口，维持向后兼容。
   */
  variadic?: boolean;
}

export interface NodeTypeRegistryEntry {
  type: string;
  typeVersion: string;
  title?: string;
  description?: string;
  inputPorts: NodeGraphPortDefinition[];
  outputPorts: NodeGraphPortDefinition[];
  configSchema?: unknown;
  supportedPhases: NodeGraphPhase[];
  previewPolicy: NodeGraphPreviewPolicy;
  permissionsRequired?: string[];
  sideEffects?: 'none' | 'llm' | 'tool' | 'write';
  knowledge?: NodeGraphNodeTypeKnowledge;
}

export interface NodeGraphNodeTypePortSummary {
  name: string;
  type: NodeGraphPortType;
  required?: boolean;
  multiple?: boolean;
  variadic?: boolean;
  description?: string;
}

/** 节点知识列表视图。用于节点选择，不包含长示例。 */
export interface NodeGraphNodeTypeKnowledgeListItem {
  type: string;
  typeVersion: string;
  title?: string;
  description?: string;
  inputPorts: NodeGraphPortDefinition[];
  outputPorts: NodeGraphPortDefinition[];
  inputPortNames: string[];
  outputPortNames: string[];
  inputPortSummary: NodeGraphNodeTypePortSummary[];
  outputPortSummary: NodeGraphNodeTypePortSummary[];
  configSchema?: unknown;
  supportedPhases: NodeGraphPhase[];
  previewPolicy: NodeGraphPreviewPolicy;
  permissionsRequired?: string[];
  sideEffects?: 'none' | 'llm' | 'tool' | 'write';
  category: NodeGraphNodeCategory;
  summary: string;
}

/** 节点知识详情视图。用于百科、检查器帮助区和 Agent describe 工具。 */
export interface NodeGraphNodeTypeKnowledgeDetail extends NodeGraphNodeTypeKnowledgeListItem {
  usage?: string;
  config?: NodeGraphNodeConfigKnowledge;
  examples?: NodeGraphNodeExample[];
  pitfalls?: string[];
  relatedNodeTypes?: string[];
  knowledge?: NodeGraphNodeTypeKnowledge;
}

export interface NodeGraphDiagnostic {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
  groupId?: string;
  port?: string;
  path?: Array<string | number>;
}

export interface NodeGraphPreview {
  kind: 'text' | 'json' | 'messages' | 'prompt_ir' | 'diff' | 'diagnostics' | 'none';
  title?: string;
  summary?: string;
  value?: unknown;
  tokenEstimate?: number;
  stale?: boolean;
  source?: 'live' | 'cached' | 'dry_run' | 'synthetic';
}

export interface NodeGraphNodeRunOutput {
  value?: unknown;
  outputs?: Record<string, unknown>;
  preview?: NodeGraphPreview;
  diagnostics?: NodeGraphDiagnostic[];
}

export interface CompiledNodeGraph {
  document: NodeGraphDocument;
  nodesById: Map<string, NodeGraphNode>;
  incomingEdgesByNodeId: Map<string, NodeGraphEdge[]>;
  outgoingEdgesByNodeId: Map<string, NodeGraphEdge[]>;
  topologicalLevels: NodeGraphNode[][];
  diagnostics: NodeGraphDiagnostic[];
  isExecutable: boolean;
}

export interface NodeGraphCompilerOptions {
  availablePermissions?: readonly string[];
}

export interface NodeGraphRunRecord {
  id: string;
  accountId: string;
  workspaceId?: string | null;
  projectId?: string | null;
  sessionId?: string | null;
  floorId?: string | null;
  pageId?: string | null;
  graphId: string;
  graphVersionId: string;
  intent: NodeGraphRunIntent;
  status: NodeGraphRunStatus;
  traceJson?: unknown;
  createdAt: number;
  updatedAt: number;
}

export interface NodeGraphNodeRunRecord {
  id: string;
  graphRunId: string;
  nodeId: string;
  phase: NodeGraphPhase | string;
  status: NodeGraphNodeRunStatus;
  inputHash?: string | null;
  outputHash?: string | null;
  previewJson?: unknown;
  diagnosticsJson?: unknown;
  startedAt?: number | null;
  finishedAt?: number | null;
}
