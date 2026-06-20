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

export interface NodeGraphPortDefinition {
  name: string;
  type: NodeGraphPortType;
  required?: boolean;
  multiple?: boolean;
  description?: string;
  schema?: unknown;
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
