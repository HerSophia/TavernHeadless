import { detectNodeGraphSchemaMigration } from '../migration.js';
import type { NodeGraphDocument } from '../types.js';
import {
  NODE_GRAPH_CRITICAL_NODE_TYPES,
  NODE_GRAPH_DEGRADABLE_NODE_TYPES,
  NODE_GRAPH_PACKAGE_GRAPH_API_VERSION,
  type GraphImportDiagnostic,
  type NodeGraphPackage,
} from './types.js';

/**
 * NG2-PKG（阶段 10）：导入目标环境能力描述。
 *
 * Workspace 决定是否安装了所需 node type / 插件 / MCP / model slot；Project 决定是否启用。
 * 由 API 层据 registry + project 边界构造，core 预检纯函数只读它。
 */
export interface NodeGraphPackageEnvironment {
  /** 已安装的节点类型，形如 `type@version`。 */
  availableNodeTypes: ReadonlySet<string>;
  /** 已安装的节点类型（忽略版本），用于版本不兼容判定。缺省由 availableNodeTypes 推导。 */
  availableNodeTypeKinds?: ReadonlySet<string>;
  /** 平台提供的 capability。 */
  availableCapabilities?: ReadonlySet<string>;
  /** 可解析的 external group 引用（`name@version`）。 */
  availableGroups?: ReadonlySet<string>;
  /** 已注册的 MCP server。 */
  availableMcpServers?: ReadonlySet<string>;
  /** 已注册的 session state namespace。 */
  registeredSessionStateNamespaces?: ReadonlySet<string>;
  /** 可绑定的资产 id。 */
  availableAssets?: ReadonlySet<string>;
  /** 已授予的工具权限。 */
  grantedPermissions?: ReadonlySet<string>;
  /** 平台支持的最高 graph API 版本，缺省 v2。 */
  graphApiVersion?: string;
}

export interface NodeGraphPackagePreflightResult {
  diagnostics: GraphImportDiagnostic[];
  /** 无 error 级诊断即可安装（降级 warning 不阻断安装）。 */
  installable: boolean;
  migrationAvailable: boolean;
  migrationRequired: boolean;
  counts: { error: number; warning: number; info: number };
  requiredNodeTypes: string[];
  missingNodeTypes: string[];
  /** 缺失但可降级（跳过并警告）的节点类型。 */
  degradableNodeTypes: string[];
}

function deriveKinds(available: ReadonlySet<string>): Set<string> {
  const kinds = new Set<string>();
  for (const key of available) {
    const at = key.lastIndexOf('@');
    kinds.add(at >= 0 ? key.slice(0, at) : key);
  }
  return kinds;
}

function firstNodeIdByType(document: NodeGraphDocument): Map<string, string> {
  const byType = new Map<string, string>();
  for (const node of document.nodes) {
    const key = `${node.type}@${node.typeVersion}`;
    if (!byType.has(key)) {
      byType.set(key, node.id);
    }
    if (!byType.has(node.type)) {
      byType.set(node.type, node.id);
    }
  }
  return byType;
}

/**
 * 收集图与 manifest 声明的全部所需节点类型（去重）。
 *
 * graph 节点是真实需求来源；manifest 声明用于补充（例如 external group 引入的类型）。
 */
function collectRequiredNodeTypes(pkg: NodeGraphPackage): Map<string, { type: string; typeVersion: string; optional: boolean }> {
  const required = new Map<string, { type: string; typeVersion: string; optional: boolean }>();
  for (const node of pkg.graph.nodes) {
    const key = `${node.type}@${node.typeVersion}`;
    if (!required.has(key)) {
      required.set(key, { type: node.type, typeVersion: node.typeVersion, optional: false });
    }
  }
  for (const dep of pkg.dependencies.nodeTypes ?? []) {
    const key = `${dep.type}@${dep.typeVersion}`;
    const existing = required.get(key);
    if (existing) {
      existing.optional = existing.optional || dep.optional === true;
    } else {
      required.set(key, { type: dep.type, typeVersion: dep.typeVersion, optional: dep.optional === true });
    }
  }
  return required;
}

function nodeTypeDegradable(type: string, declaredOptional: boolean): boolean {
  if (NODE_GRAPH_CRITICAL_NODE_TYPES.has(type)) {
    return false;
  }
  return declaredOptional || NODE_GRAPH_DEGRADABLE_NODE_TYPES.has(type);
}

/**
 * NG2-PKG（阶段 10）：导入预检与统一缺失依赖诊断。
 *
 * 在**执行前**对照目标环境产出 `GraphImportDiagnostic`，区分可降级（warning，跳过并警告）
 * 与不可降级（error，阻断安装）。与 NG2-CORE validator 协同：不等运行时才发现缺节点。
 */
export function preflightNodeGraphPackage(
  pkg: NodeGraphPackage,
  environment: NodeGraphPackageEnvironment,
): NodeGraphPackagePreflightResult {
  const diagnostics: GraphImportDiagnostic[] = [];
  const availableKinds = environment.availableNodeTypeKinds ?? deriveKinds(environment.availableNodeTypes);
  const capabilities = environment.availableCapabilities ?? new Set<string>();
  const groups = environment.availableGroups ?? new Set<string>();
  const mcpServers = environment.availableMcpServers ?? new Set<string>();
  const namespaces = environment.registeredSessionStateNamespaces ?? new Set<string>();
  const assets = environment.availableAssets ?? new Set<string>();
  const grantedPermissions = environment.grantedPermissions ?? new Set<string>();
  const supportedGraphApi = Number(environment.graphApiVersion ?? NODE_GRAPH_PACKAGE_GRAPH_API_VERSION);

  // 1. 迁移判定。
  const schemaMigrations = detectNodeGraphSchemaMigration(pkg.graph);
  let migrationAvailable = false;
  for (const migration of schemaMigrations) {
    migrationAvailable = true;
    diagnostics.push({
      severity: migration.severity,
      code: migration.code,
      message: migration.message,
      degradable: true,
      resolution: { action: 'run_migration', label: 'Migrate graph to schema v2 on import.' },
    });
  }

  // 1b. graph API 版本兼容（包面向更高 graph API 时不可直接运行）。
  let migrationRequired = false;
  const packageGraphApi = Number(pkg.compatibility?.graphApiVersion ?? NODE_GRAPH_PACKAGE_GRAPH_API_VERSION);
  if (Number.isFinite(packageGraphApi) && packageGraphApi > supportedGraphApi) {
    migrationRequired = true;
    diagnostics.push({
      severity: 'error',
      code: 'MIGRATION_REQUIRED',
      message: `Package targets graph API v${packageGraphApi} but this platform supports v${supportedGraphApi}.`,
      degradable: false,
      resolution: { action: 'run_migration', label: 'Upgrade the platform or migrate the package.' },
    });
  }

  // 2. 节点类型检测。
  const firstNodeId = firstNodeIdByType(pkg.graph);
  const required = collectRequiredNodeTypes(pkg);
  const requiredNodeTypes = [...required.keys()].sort();
  const missingNodeTypes: string[] = [];
  const degradableNodeTypes: string[] = [];
  for (const key of requiredNodeTypes) {
    const dep = required.get(key)!;
    if (environment.availableNodeTypes.has(key)) {
      continue;
    }
    if (availableKinds.has(dep.type)) {
      diagnostics.push({
        severity: 'warning',
        code: 'NODE_VERSION_INCOMPATIBLE',
        message: `Node type '${dep.type}' is installed but version '${dep.typeVersion}' is not available.`,
        nodeId: firstNodeId.get(key) ?? firstNodeId.get(dep.type),
        dependencyId: key,
        degradable: true,
        resolution: { action: 'run_migration', label: `Migrate node '${dep.type}' to an available version.` },
      });
      continue;
    }
    missingNodeTypes.push(key);
    const degradable = nodeTypeDegradable(dep.type, dep.optional);
    if (degradable) {
      degradableNodeTypes.push(key);
    }
    diagnostics.push({
      severity: degradable ? 'warning' : 'error',
      code: 'NODE_TYPE_MISSING',
      message: degradable
        ? `Optional node type '${key}' is not installed; it will be skipped on import.`
        : `Required node type '${key}' is not installed.`,
      nodeId: firstNodeId.get(key) ?? firstNodeId.get(dep.type),
      dependencyId: key,
      degradable,
      resolution: degradable
        ? { action: 'ignore', label: `Skip optional node '${dep.type}'.` }
        : { action: 'install_node_pack', label: `Install a node pack that provides '${dep.type}'.` },
    });
  }

  // 3. 节点组（External Reference 缺失不可降级）。
  for (const group of (pkg.dependencies.groups ?? []).filter((entry) => !entry.inline)) {
    if (groups.has(group.groupRef)) {
      continue;
    }
    diagnostics.push({
      severity: 'error',
      code: 'GROUP_MISSING',
      message: `External group reference '${group.groupRef}' is not available.`,
      dependencyId: group.groupRef,
      degradable: false,
      resolution: { action: 'install_node_pack', label: `Install the group pack '${group.groupRef}'.` },
    });
  }

  // 4. capability（可降级）。
  for (const capability of [...(pkg.dependencies.capabilities ?? [])].sort()) {
    if (capabilities.has(capability)) {
      continue;
    }
    diagnostics.push({
      severity: 'warning',
      code: 'CAPABILITY_MISSING',
      message: `Capability '${capability}' is not enabled; dependent nodes may degrade.`,
      dependencyId: capability,
      degradable: true,
      resolution: { action: 'enable_capability', label: `Enable capability '${capability}'.` },
    });
  }

  // 5. MCP server（可降级，禁用外部资料）。
  for (const mcp of [...(pkg.dependencies.mcpServers ?? [])].sort((a, b) => a.server.localeCompare(b.server))) {
    if (mcpServers.has(mcp.server)) {
      continue;
    }
    diagnostics.push({
      severity: 'warning',
      code: 'MCP_SERVER_MISSING',
      message: `MCP server '${mcp.server}' is not registered; external lookups will be disabled.`,
      dependencyId: mcp.server,
      degradable: true,
      resolution: { action: 'ignore', label: `Disable nodes that require MCP server '${mcp.server}'.` },
    });
  }

  // 6. session state namespace（写入用途缺失不可降级）。
  for (const ns of [...(pkg.dependencies.sessionStateNamespaces ?? [])].sort((a, b) => a.namespace.localeCompare(b.namespace))) {
    if (namespaces.has(ns.namespace)) {
      continue;
    }
    const degradable = ns.write !== true;
    diagnostics.push({
      severity: degradable ? 'warning' : 'error',
      code: 'SESSION_STATE_NAMESPACE_MISSING',
      message: degradable
        ? `Session state namespace '${ns.namespace}' is not registered.`
        : `Session state namespace '${ns.namespace}' is required for committed writes but not registered.`,
      dependencyId: ns.namespace,
      degradable,
      resolution: { action: 'register_namespace', label: `Register session state namespace '${ns.namespace}'.` },
    });
  }

  // 7. 资产（可降级）。
  for (const asset of [...(pkg.assets ?? [])].sort((a, b) => a.id.localeCompare(b.id))) {
    if (assets.has(asset.id)) {
      continue;
    }
    diagnostics.push({
      severity: 'warning',
      code: 'ASSET_REFERENCE_MISSING',
      message: `Asset reference '${asset.id}' is not bound.`,
      dependencyId: asset.id,
      degradable: true,
      resolution: { action: 'bind_asset', label: `Bind asset '${asset.id}'.` },
    });
  }

  // 8. 权限（需授予；不阻断安装，但 enable 前必须满足）。
  for (const requirement of [...pkg.permissions].sort((a, b) => a.permission.localeCompare(b.permission))) {
    if (grantedPermissions.has(requirement.permission)) {
      continue;
    }
    diagnostics.push({
      severity: 'warning',
      code: 'PERMISSION_REQUIRED',
      message: `Permission '${requirement.permission}' must be granted before the graph can run.`,
      dependencyId: requirement.permission,
      degradable: requirement.optional === true,
      resolution: { action: 'grant_permission', label: `Grant permission '${requirement.permission}'.` },
    });
  }

  const counts = { error: 0, warning: 0, info: 0 };
  for (const diagnostic of diagnostics) {
    counts[diagnostic.severity] += 1;
  }

  return {
    diagnostics,
    installable: counts.error === 0,
    migrationAvailable,
    migrationRequired,
    counts,
    requiredNodeTypes,
    missingNodeTypes,
    degradableNodeTypes,
  };
}
