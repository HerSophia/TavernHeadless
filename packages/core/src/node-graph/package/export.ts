import { createHash } from 'node:crypto';

import { migrateNodeGraphDocumentToV2 } from '../migration.js';
import { createDefaultNodeTypeRegistry, NodeTypeRegistry } from '../registry.js';
import type { NodeGraphDocument, NodeGraphNode } from '../types.js';
import {
  NODE_GRAPH_DEGRADABLE_NODE_TYPES,
  NODE_GRAPH_NODE_TYPE_CAPABILITIES,
  NODE_GRAPH_PACKAGE_GRAPH_API_VERSION,
  NODE_GRAPH_PACKAGE_KIND,
  NODE_GRAPH_PACKAGE_PLATFORM_VERSION,
  NODE_GRAPH_PACKAGE_SCHEMA_VERSION,
  type AssetReference,
  type GroupDependency,
  type MCPDependency,
  type NodeGraphPackage,
  type NodeGraphPackageCompatibility,
  type NodeGraphPackageDependencies,
  type NodeGraphPackageMetadata,
  type NodeTypeDependency,
  type SessionStateDependency,
  type ToolPermissionRequirement,
} from './types.js';

export class NodeGraphPackageParseError extends Error {
  constructor(
    public readonly code: 'package_kind_invalid' | 'package_schema_unsupported' | 'package_malformed',
    message: string,
  ) {
    super(message);
    this.name = 'NodeGraphPackageParseError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readConfigString(node: NodeGraphNode, ...keys: string[]): string | undefined {
  if (!isRecord(node.config)) {
    return undefined;
  }
  for (const key of keys) {
    const value = node.config[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function readNestedConfigString(node: NodeGraphNode, parentKey: string, childKey: string): string | undefined {
  if (!isRecord(node.config)) {
    return undefined;
  }
  const parent = node.config[parentKey];
  if (isRecord(parent) && typeof parent[childKey] === 'string' && parent[childKey].trim().length > 0) {
    return (parent[childKey] as string).trim();
  }
  return undefined;
}

/** 收集图中用到的全部节点类型依赖（去重、按 type@version 排序）。 */
export function collectNodeTypeDependencies(document: NodeGraphDocument): NodeTypeDependency[] {
  const byKey = new Map<string, NodeTypeDependency>();
  for (const node of document.nodes) {
    const key = `${node.type}@${node.typeVersion}`;
    if (byKey.has(key)) {
      continue;
    }
    byKey.set(key, {
      type: node.type,
      typeVersion: node.typeVersion,
      optional: NODE_GRAPH_DEGRADABLE_NODE_TYPES.has(node.type) ? true : undefined,
    });
  }
  return [...byKey.values()].sort((left, right) =>
    `${left.type}@${left.typeVersion}`.localeCompare(`${right.type}@${right.typeVersion}`),
  );
}

/**
 * 收集节点组依赖。
 *
 * 约定：空成员（`nodeIds.length === 0`）且带 `version` 的组视为 External Reference
 * （`core.rp.preflight@1.2.0`，inline = false）；其余视为打进包的 Inline Bundle。
 */
export function collectGroupDependencies(document: NodeGraphDocument): GroupDependency[] {
  const deps: GroupDependency[] = [];
  for (const group of document.groups ?? []) {
    const external = group.nodeIds.length === 0 && typeof group.version === 'string' && group.version.length > 0;
    deps.push({
      groupRef: external ? `${group.name}@${group.version}` : group.id,
      inline: !external,
    });
  }
  return deps.sort((left, right) => left.groupRef.localeCompare(right.groupRef));
}

/** 据节点类型推断图所需 capability（去重、排序）。 */
export function deriveNodeGraphRequiredCapabilities(document: NodeGraphDocument): string[] {
  const capabilities = new Set<string>();
  for (const node of document.nodes) {
    const capability = NODE_GRAPH_NODE_TYPE_CAPABILITIES[node.type];
    if (capability) {
      capabilities.add(capability);
    }
  }
  return [...capabilities].sort();
}

/** 收集 session state namespace 依赖（来自 source.session_state / output.session_state_proposal 配置）。 */
export function collectSessionStateNamespaces(document: NodeGraphDocument): SessionStateDependency[] {
  const byNamespace = new Map<string, SessionStateDependency>();
  for (const node of document.nodes) {
    const namespace = readConfigString(node, 'namespace', 'sessionStateNamespace');
    if (!namespace) {
      continue;
    }
    const write = node.type === 'output.session_state_proposal';
    const existing = byNamespace.get(namespace);
    if (existing) {
      existing.write = existing.write || write;
    } else {
      byNamespace.set(namespace, { namespace, write: write || undefined });
    }
  }
  return [...byNamespace.values()].sort((left, right) => left.namespace.localeCompare(right.namespace));
}

/** 收集 MCP server 依赖（来自节点配置 mcpServer / mcp.server）。 */
export function collectMcpServers(document: NodeGraphDocument): MCPDependency[] {
  const byServer = new Map<string, MCPDependency>();
  for (const node of document.nodes) {
    const server = readConfigString(node, 'mcpServer') ?? readNestedConfigString(node, 'mcp', 'server');
    if (!server) {
      continue;
    }
    if (!byServer.has(server)) {
      byServer.set(server, { server, network: true });
    }
  }
  return [...byServer.values()].sort((left, right) => left.server.localeCompare(right.server));
}

/** 收集资产引用（来自节点配置 assetRef / assets）。 */
export function collectAssetReferences(document: NodeGraphDocument): AssetReference[] {
  const byId = new Map<string, AssetReference>();
  for (const node of document.nodes) {
    const single = readConfigString(node, 'assetRef');
    if (single) {
      byId.set(single, { id: single });
    }
    if (isRecord(node.config) && Array.isArray(node.config.assets)) {
      for (const asset of node.config.assets) {
        if (typeof asset === 'string' && asset.trim().length > 0) {
          byId.set(asset.trim(), { id: asset.trim() });
        }
      }
    }
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

/** 收集图所需工具权限（图 manifest required + 各节点 registry permissionsRequired 的并集）。 */
export function collectNodeGraphPackagePermissions(
  document: NodeGraphDocument,
  registry: NodeTypeRegistry,
): ToolPermissionRequirement[] {
  const permissions = new Set<string>(document.permissions?.required ?? []);
  for (const node of document.nodes) {
    const entry = registry.find(node.type, node.typeVersion);
    for (const permission of entry?.permissionsRequired ?? []) {
      permissions.add(permission);
    }
  }
  return [...permissions].sort().map((permission) => ({ permission }));
}

/** 组装包依赖块（空集合省略，保持 manifest 简洁与确定性）。 */
export function collectNodeGraphPackageDependencies(
  document: NodeGraphDocument,
): NodeGraphPackageDependencies {
  const groups = collectGroupDependencies(document);
  const capabilities = deriveNodeGraphRequiredCapabilities(document);
  const mcpServers = collectMcpServers(document);
  const sessionStateNamespaces = collectSessionStateNamespaces(document);
  return {
    nodeTypes: collectNodeTypeDependencies(document),
    ...(groups.length > 0 ? { groups } : {}),
    ...(capabilities.length > 0 ? { capabilities } : {}),
    ...(mcpServers.length > 0 ? { mcpServers } : {}),
    ...(sessionStateNamespaces.length > 0 ? { sessionStateNamespaces } : {}),
  };
}

function stableStringify(value: unknown): string {
  if (value === undefined) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** 计算包内容哈希（排除 integrity 字段，确定性）。 */
export function computeNodeGraphPackageContentHash(pkg: Omit<NodeGraphPackage, 'integrity'>): string {
  return `sha256:${createHash('sha256').update(stableStringify(pkg)).digest('hex')}`;
}

export interface ExportNodeGraphPackageInput {
  document: NodeGraphDocument;
  metadata: NodeGraphPackageMetadata;
  compatibility?: Partial<NodeGraphPackageCompatibility>;
  registry?: NodeTypeRegistry;
  assets?: AssetReference[];
  /** 是否计算 contentHash 写入 integrity，缺省 true。 */
  computeIntegrity?: boolean;
}

/**
 * NG2-PKG（阶段 9）：把一个 graph document 导出为 NodeGraphPackage。
 *
 * 导出时统一把 document 升为 v2、收集依赖 / 权限 / 资产，并默认写入 contentHash。
 */
export function exportNodeGraphPackage(input: ExportNodeGraphPackageInput): NodeGraphPackage {
  const registry = input.registry ?? createDefaultNodeTypeRegistry();
  const { document } = migrateNodeGraphDocumentToV2(input.document);
  const dependencies = collectNodeGraphPackageDependencies(document);
  const permissions = collectNodeGraphPackagePermissions(document, registry);
  const assets = input.assets ?? collectAssetReferences(document);

  const compatibility: NodeGraphPackageCompatibility = {
    minTavernHeadlessVersion: input.compatibility?.minTavernHeadlessVersion ?? NODE_GRAPH_PACKAGE_PLATFORM_VERSION,
    graphApiVersion: input.compatibility?.graphApiVersion ?? NODE_GRAPH_PACKAGE_GRAPH_API_VERSION,
    ...(input.compatibility?.testedVersions
      ? { testedVersions: input.compatibility.testedVersions }
      : { testedVersions: [NODE_GRAPH_PACKAGE_PLATFORM_VERSION] }),
  };

  const base: Omit<NodeGraphPackage, 'integrity'> = {
    kind: NODE_GRAPH_PACKAGE_KIND,
    schemaVersion: NODE_GRAPH_PACKAGE_SCHEMA_VERSION,
    metadata: input.metadata,
    compatibility,
    graph: document,
    dependencies,
    permissions,
    ...(assets.length > 0 ? { assets } : {}),
  };

  if (input.computeIntegrity === false) {
    return base;
  }
  return { ...base, integrity: { contentHash: computeNodeGraphPackageContentHash(base) } };
}

/**
 * NG2-PKG：解析并校验包信封结构。
 *
 * 只校验信封（kind / schemaVersion / metadata / graph 形状），不做依赖预检；
 * 依赖 / 权限 / capability / migration 预检见 `preflightNodeGraphPackage`。
 */
export function parseNodeGraphPackage(raw: unknown): NodeGraphPackage {
  if (!isRecord(raw)) {
    throw new NodeGraphPackageParseError('package_malformed', 'NodeGraphPackage must be an object.');
  }
  if (raw.kind !== NODE_GRAPH_PACKAGE_KIND) {
    throw new NodeGraphPackageParseError(
      'package_kind_invalid',
      `NodeGraphPackage kind must be '${NODE_GRAPH_PACKAGE_KIND}'.`,
    );
  }
  if (typeof raw.schemaVersion !== 'string' || raw.schemaVersion !== NODE_GRAPH_PACKAGE_SCHEMA_VERSION) {
    throw new NodeGraphPackageParseError(
      'package_schema_unsupported',
      `Unsupported NodeGraphPackage schemaVersion '${String(raw.schemaVersion)}'.`,
    );
  }
  if (!isRecord(raw.metadata) || typeof raw.metadata.id !== 'string' || typeof raw.metadata.name !== 'string') {
    throw new NodeGraphPackageParseError('package_malformed', 'NodeGraphPackage metadata.id and metadata.name are required.');
  }
  if (!isRecord(raw.graph) || !Array.isArray((raw.graph as { nodes?: unknown }).nodes)) {
    throw new NodeGraphPackageParseError('package_malformed', 'NodeGraphPackage graph must be a NodeGraphDocument.');
  }
  if (!isRecord(raw.compatibility)) {
    throw new NodeGraphPackageParseError('package_malformed', 'NodeGraphPackage compatibility is required.');
  }
  return raw as unknown as NodeGraphPackage;
}
