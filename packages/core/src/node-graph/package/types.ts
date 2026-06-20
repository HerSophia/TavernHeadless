import type { NodeGraphDocument } from '../types.js';

/**
 * NG2-PKG：NodeGraphPackage import / export 合同（B9-DESIGN 第 4 节，纲领第 10 节）。
 *
 * 导出不再是裸 graph JSON，而是带 manifest / 兼容性 / 依赖 / 权限 / 完整性的包，
 * 使图能被安全地跨环境分发与落地。本模块只定义类型与常量，纯函数逻辑见
 * `export.ts` / `import-diagnostics.ts` / `security-summary.ts`。
 */
export const NODE_GRAPH_PACKAGE_KIND = 'tavernheadless.nodegraph' as const;

/** Package 信封自身的 schema 版本（与 graph document schemaVersion 区分）。 */
export const NODE_GRAPH_PACKAGE_SCHEMA_VERSION = '1' as const;

/** 当前平台导出的 graph API 版本（对齐 NodeGraph v2）。 */
export const NODE_GRAPH_PACKAGE_GRAPH_API_VERSION = '2' as const;

/** 当前平台版本号，写入导出包的 compatibility 与 testedVersions。 */
export const NODE_GRAPH_PACKAGE_PLATFORM_VERSION = '0.1.0' as const;

export interface NodeTypeDependency {
  type: string;
  typeVersion: string;
  /** 缺失时是否可降级（跳过该节点并警告）。缺省按节点类型分类判定。 */
  optional?: boolean;
}

export interface GroupDependency {
  /** 形如 `core.rp.preflight@1.2.0` 的引用，或内联组的 id。 */
  groupRef: string;
  /** Inline Bundle（组定义打进 package）= true；External Reference = false。 */
  inline: boolean;
}

export interface MCPDependency {
  server: string;
  version?: string;
  /** 是否需要外部网络访问（用于安全摘要）。 */
  network?: boolean;
}

export interface SessionStateDependency {
  namespace: string;
  /** 该 namespace 是否被随回合提交的写入使用（影响降级判定）。 */
  write?: boolean;
}

export interface AssetReference {
  id: string;
  kind?: string;
  description?: string;
}

export interface ToolPermissionRequirement {
  permission: string;
  reason?: string;
  /** 缺失时是否可降级。缺省视为必需（不可降级）。 */
  optional?: boolean;
}

export interface NodeGraphPackageMetadata {
  id: string;
  name: string;
  version: string;
  author?: string;
  description?: string;
  tags?: string[];
}

export interface NodeGraphPackageCompatibility {
  minTavernHeadlessVersion: string;
  testedVersions?: string[];
  graphApiVersion: string;
}

export interface NodeGraphPackageDependencies {
  nodeTypes: NodeTypeDependency[];
  groups?: GroupDependency[];
  capabilities?: string[];
  mcpServers?: MCPDependency[];
  sessionStateNamespaces?: SessionStateDependency[];
}

export interface NodeGraphPackageIntegrity {
  contentHash?: string;
  signature?: string;
}

export interface NodeGraphPackage {
  kind: typeof NODE_GRAPH_PACKAGE_KIND;
  schemaVersion: string;
  metadata: NodeGraphPackageMetadata;
  compatibility: NodeGraphPackageCompatibility;
  /** v2 graph document（导出时统一升为 schemaVersion 2）。 */
  graph: NodeGraphDocument;
  dependencies: NodeGraphPackageDependencies;
  permissions: ToolPermissionRequirement[];
  assets?: AssetReference[];
  integrity?: NodeGraphPackageIntegrity;
}

/** 统一缺失依赖诊断代码（纲领第 10.2 节）。 */
export const GRAPH_IMPORT_DIAGNOSTIC_CODES = [
  'NODE_TYPE_MISSING',
  'NODE_VERSION_INCOMPATIBLE',
  'GROUP_MISSING',
  'CAPABILITY_MISSING',
  'PERMISSION_REQUIRED',
  'SESSION_STATE_NAMESPACE_MISSING',
  'MCP_SERVER_MISSING',
  'ASSET_REFERENCE_MISSING',
  'MIGRATION_AVAILABLE',
  'MIGRATION_REQUIRED',
] as const;

export type GraphImportDiagnosticCode = (typeof GRAPH_IMPORT_DIAGNOSTIC_CODES)[number];

export type GraphImportResolutionAction =
  | 'install_node_pack'
  | 'enable_capability'
  | 'grant_permission'
  | 'register_namespace'
  | 'bind_asset'
  | 'run_migration'
  | 'replace_node'
  | 'ignore';

export interface GraphImportResolution {
  action: GraphImportResolutionAction;
  label: string;
}

export interface GraphImportDiagnostic {
  severity: 'error' | 'warning' | 'info';
  code: GraphImportDiagnosticCode;
  message: string;
  nodeId?: string;
  dependencyId?: string;
  /** 该诊断是否可降级（跳过并警告）。`severity === 'error'` 即不可降级。 */
  degradable?: boolean;
  resolution?: GraphImportResolution;
}

/**
 * 节点类型 → 平台 capability 映射（纲领第 10 节）。
 *
 * 导出时据此推断图所需 capability；导入预检时对照平台 capability 集合检测缺失。
 */
export const NODE_GRAPH_NODE_TYPE_CAPABILITIES: Readonly<Record<string, string>> = {
  'agent.director_plan': 'agent_runtime',
  'agent.player_agency_precheck': 'agent_runtime',
  'agent.call': 'agent_runtime',
  'select.memory_retrieve': 'memory',
  'output.session_state_proposal': 'session_state_write',
  'output.derived_output': 'derived_output',
  'output.project_inbox': 'project_inbox',
  'verify.continuity': 'continuity_verifier',
  'verify.player_agency_postcheck': 'player_agency_verifier',
  'control.condition': 'control_flow',
  'control.branch': 'control_flow',
  'control.gate': 'control_flow',
};

/** 当前平台提供的全部 capability（内置节点可推断的并集）。 */
export const NODE_GRAPH_PLATFORM_CAPABILITIES: readonly string[] = Array.from(
  new Set(Object.values(NODE_GRAPH_NODE_TYPE_CAPABILITIES)),
).sort();

/**
 * 关键节点类型：缺失时不可降级（纲领第 10.5 节）。
 *
 * PromptCompose / Narrator / CommitGate 缺失会破坏主链；Condition / Branch / Gate
 * 缺失会让控制路径不可判定。
 */
export const NODE_GRAPH_CRITICAL_NODE_TYPES: ReadonlySet<string> = new Set([
  'compose.final_messages',
  'narration.narrator',
  'output.commit_gate',
  'control.condition',
  'control.branch',
  'control.gate',
]);

/**
 * 可降级节点类型：缺失时跳过并警告（纲领第 10.5 节）。
 *
 * StyleVerifier / DirectorAgent / 外部资料检索类节点缺失只降低质量，不阻断主链。
 */
export const NODE_GRAPH_DEGRADABLE_NODE_TYPES: ReadonlySet<string> = new Set([
  'agent.director_plan',
  'agent.player_agency_precheck',
  'verify.continuity',
  'verify.player_agency_postcheck',
  'select.memory_retrieve',
]);
