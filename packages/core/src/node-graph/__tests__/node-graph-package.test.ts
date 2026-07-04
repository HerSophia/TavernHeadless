import { describe, expect, it } from 'vitest';

import { createDefaultNodeTypeRegistry } from '../registry.js';
import type { NodeGraphDocument } from '../types.js';
import {
  buildNodeGraphPackageSecuritySummary,
  exportNodeGraphPackage,
  NodeGraphPackageParseError,
  parseNodeGraphPackage,
  preflightNodeGraphPackage,
  type NodeGraphPackage,
  type NodeGraphPackageEnvironment,
} from '../package/index.js';
import { NODE_GRAPH_PACKAGE_KIND, NODE_GRAPH_PLATFORM_CAPABILITIES } from '../package/types.js';

function mvpDocument(overrides: Partial<NodeGraphDocument> = {}): NodeGraphDocument {
  return {
    schemaVersion: 2,
    graphId: 'ngraph_pkg',
    name: 'Package MVP',
    mode: 'native_graph',
    policies: {},
    permissions: { required: [] },
    nodes: [
      { id: 'history', type: 'source.chat_history', typeVersion: '1', phase: 'pre_response' },
      { id: 'userInput', type: 'source.user_input', typeVersion: '1', phase: 'pre_response' },
      { id: 'messages', type: 'compose.final_messages', typeVersion: '1', phase: 'response' },
      { id: 'narrator', type: 'narration.narrator', typeVersion: '1', phase: 'response' },
      { id: 'commit', type: 'output.commit_gate', typeVersion: '1', phase: 'commit' },
    ],
    edges: [
      { id: 'e_hm', kind: 'data', from: { nodeId: 'history', port: 'messages' }, to: { nodeId: 'messages', port: 'messages' } },
      { id: 'e_mn', kind: 'data', from: { nodeId: 'messages', port: 'messages' }, to: { nodeId: 'narrator', port: 'messages' } },
      { id: 'e_un', kind: 'data', from: { nodeId: 'userInput', port: 'text' }, to: { nodeId: 'narrator', port: 'user_input' } },
      { id: 'e_nc', kind: 'data', from: { nodeId: 'narrator', port: 'text' }, to: { nodeId: 'commit', port: 'text' } },
    ],
    ...overrides,
  };
}

function platformEnvironment(
  overrides: Partial<NodeGraphPackageEnvironment> = {},
): NodeGraphPackageEnvironment {
  const registry = createDefaultNodeTypeRegistry();
  return {
    availableNodeTypes: new Set(registry.list().map((entry) => `${entry.type}@${entry.typeVersion}`)),
    availableCapabilities: new Set(NODE_GRAPH_PLATFORM_CAPABILITIES),
    grantedPermissions: new Set(['project.agent.run', 'project.memory.read']),
    ...overrides,
  };
}

const META = { id: 'pkg.mvp', name: 'MVP', version: '1.0.0' } as const;

describe('NodeGraphPackage export', () => {
  it('exports a manifest with node type dependencies and content hash', () => {
    const pkg = exportNodeGraphPackage({ document: mvpDocument(), metadata: { ...META } });
    expect(pkg.kind).toBe(NODE_GRAPH_PACKAGE_KIND);
    expect(pkg.graph.schemaVersion).toBe(2);
    expect(pkg.dependencies.nodeTypes.map((dep) => `${dep.type}@${dep.typeVersion}`)).toEqual([
      'compose.final_messages@1',
      'narration.narrator@1',
      'output.commit_gate@1',
      'source.chat_history@1',
      'source.user_input@1',
    ]);
    expect(pkg.dependencies.capabilities).toBeUndefined();
    expect(pkg.integrity?.contentHash).toMatch(/^sha256:/);
  });

  it('migrates a v1 document to v2 on export', () => {
    const v1 = mvpDocument({ schemaVersion: 1 });
    v1.edges = v1.edges.map((edge) => ({ ...edge, kind: undefined }));
    const pkg = exportNodeGraphPackage({ document: v1, metadata: { ...META } });
    expect(pkg.graph.schemaVersion).toBe(2);
    expect(pkg.graph.edges.every((edge) => edge.kind === 'data')).toBe(true);
  });

  it('derives capabilities and permissions from agent and memory nodes', () => {
    const doc = mvpDocument();
    doc.nodes.push(
      { id: 'memory', type: 'select.memory_retrieve', typeVersion: '1', phase: 'pre_response' },
      { id: 'director', type: 'agent.director_plan', typeVersion: '1', phase: 'pre_response' },
    );
    const pkg = exportNodeGraphPackage({ document: doc, metadata: { ...META } });
    expect(pkg.dependencies.capabilities).toEqual(['agent_runtime', 'memory']);
    expect(pkg.permissions.map((p) => p.permission)).toEqual(['project.agent.run', 'project.memory.read']);
    // 可降级节点类型在依赖中标记 optional。
    const memoryDep = pkg.dependencies.nodeTypes.find((dep) => dep.type === 'select.memory_retrieve');
    expect(memoryDep?.optional).toBe(true);
  });

  it('produces a deterministic content hash for identical inputs', () => {
    const first = exportNodeGraphPackage({ document: mvpDocument(), metadata: { ...META } });
    const second = exportNodeGraphPackage({ document: mvpDocument(), metadata: { ...META } });
    expect(first.integrity?.contentHash).toBe(second.integrity?.contentHash);
  });
});

describe('NodeGraphPackage parse', () => {
  it('rejects an invalid kind and unsupported schema', () => {
    expect(() => parseNodeGraphPackage({ kind: 'other' })).toThrow(NodeGraphPackageParseError);
    expect(() => parseNodeGraphPackage({ kind: NODE_GRAPH_PACKAGE_KIND, schemaVersion: '99' })).toThrow(
      NodeGraphPackageParseError,
    );
  });

  it('round-trips an exported package', () => {
    const pkg = exportNodeGraphPackage({ document: mvpDocument(), metadata: { ...META } });
    const parsed = parseNodeGraphPackage(JSON.parse(JSON.stringify(pkg)));
    expect(parsed.metadata.id).toBe('pkg.mvp');
  });
});

describe('NodeGraphPackage preflight', () => {
  it('reports a clean install when all dependencies are available', () => {
    const pkg = exportNodeGraphPackage({ document: mvpDocument(), metadata: { ...META } });
    const result = preflightNodeGraphPackage(pkg, platformEnvironment());
    expect(result.installable).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  it('flags missing critical node types as non-degradable errors', () => {
    const pkg = exportNodeGraphPackage({ document: mvpDocument(), metadata: { ...META } });
    const env = platformEnvironment({
      availableNodeTypes: new Set(
        [...platformEnvironment().availableNodeTypes].filter((key) => key !== 'narration.narrator@1'),
      ),
    });
    const result = preflightNodeGraphPackage(pkg, env);
    const narratorDiag = result.diagnostics.find((d) => d.dependencyId === 'narration.narrator@1');
    expect(narratorDiag?.code).toBe('NODE_TYPE_MISSING');
    expect(narratorDiag?.severity).toBe('error');
    expect(narratorDiag?.degradable).toBe(false);
    expect(result.installable).toBe(false);
  });

  it('treats missing optional node types as degradable warnings', () => {
    const doc = mvpDocument();
    doc.nodes.push({ id: 'director', type: 'agent.director_plan', typeVersion: '1', phase: 'pre_response' });
    const pkg = exportNodeGraphPackage({ document: doc, metadata: { ...META } });
    const env = platformEnvironment({
      availableNodeTypes: new Set(
        [...platformEnvironment().availableNodeTypes].filter((key) => key !== 'agent.director_plan@1'),
      ),
    });
    const result = preflightNodeGraphPackage(pkg, env);
    const diag = result.diagnostics.find((d) => d.dependencyId === 'agent.director_plan@1');
    expect(diag?.code).toBe('NODE_TYPE_MISSING');
    expect(diag?.severity).toBe('warning');
    expect(result.degradableNodeTypes).toContain('agent.director_plan@1');
    expect(result.installable).toBe(true);
  });

  it('detects node version incompatibility when only another version exists', () => {
    const doc = mvpDocument();
    doc.nodes = doc.nodes.map((node) => (node.id === 'history' ? { ...node, typeVersion: '2' } : node));
    const pkg = exportNodeGraphPackage({ document: doc, metadata: { ...META } });
    const result = preflightNodeGraphPackage(pkg, platformEnvironment());
    const diag = result.diagnostics.find((d) => d.dependencyId === 'source.chat_history@2');
    expect(diag?.code).toBe('NODE_VERSION_INCOMPATIBLE');
    expect(diag?.severity).toBe('warning');
  });

  it('flags missing capabilities, mcp servers, namespaces, assets and permissions', () => {
    const pkg: NodeGraphPackage = {
      ...exportNodeGraphPackage({ document: mvpDocument(), metadata: { ...META } }),
      dependencies: {
        nodeTypes: [],
        capabilities: ['external_research'],
        mcpServers: [{ server: 'research', network: true }],
        sessionStateNamespaces: [
          { namespace: 'mood' },
          { namespace: 'inventory', write: true },
        ],
      },
      permissions: [{ permission: 'project.inbox.write' }],
      assets: [{ id: 'avatar.png' }],
    };
    const result = preflightNodeGraphPackage(pkg, platformEnvironment({ grantedPermissions: new Set() }));
    const byCode = new Map(result.diagnostics.map((d) => [d.code, d]));
    expect(byCode.get('CAPABILITY_MISSING')?.severity).toBe('warning');
    expect(byCode.get('MCP_SERVER_MISSING')?.severity).toBe('warning');
    expect(byCode.get('ASSET_REFERENCE_MISSING')?.severity).toBe('warning');
    expect(byCode.get('PERMISSION_REQUIRED')?.severity).toBe('warning');
    // 写入用途的 namespace 缺失不可降级。
    const writeNs = result.diagnostics.find((d) => d.dependencyId === 'inventory');
    expect(writeNs?.code).toBe('SESSION_STATE_NAMESPACE_MISSING');
    expect(writeNs?.severity).toBe('error');
    expect(result.installable).toBe(false);
  });

  it('emits MIGRATION_AVAILABLE for v1 graphs and MIGRATION_REQUIRED for newer graph API', () => {
    const v1Pkg: NodeGraphPackage = {
      ...exportNodeGraphPackage({ document: mvpDocument(), metadata: { ...META } }),
      graph: mvpDocument({ schemaVersion: 1 }),
    };
    const v1Result = preflightNodeGraphPackage(v1Pkg, platformEnvironment());
    expect(v1Result.migrationAvailable).toBe(true);
    expect(v1Result.diagnostics.some((d) => d.code === 'MIGRATION_AVAILABLE')).toBe(true);

    const futurePkg: NodeGraphPackage = {
      ...exportNodeGraphPackage({ document: mvpDocument(), metadata: { ...META } }),
      compatibility: { minTavernHeadlessVersion: '9.9.9', graphApiVersion: '3' },
    };
    const futureResult = preflightNodeGraphPackage(futurePkg, platformEnvironment());
    expect(futureResult.migrationRequired).toBe(true);
    expect(futureResult.installable).toBe(false);
  });

  it('flags missing external group references', () => {
    const pkg: NodeGraphPackage = {
      ...exportNodeGraphPackage({ document: mvpDocument(), metadata: { ...META } }),
      dependencies: {
        nodeTypes: [],
        groups: [
          { groupRef: 'core.rp.preflight@1.2.0', inline: false },
          { groupRef: 'local_visual', inline: true },
        ],
      },
    };
    const result = preflightNodeGraphPackage(pkg, platformEnvironment());
    const diag = result.diagnostics.find((d) => d.code === 'GROUP_MISSING');
    expect(diag?.dependencyId).toBe('core.rp.preflight@1.2.0');
    expect(diag?.severity).toBe('error');
  });
});

describe('NodeGraphPackage security summary', () => {
  it('summarizes data reads, write targets, mcp and permissions', () => {
    const doc = mvpDocument();
    doc.nodes.push(
      { id: 'memory', type: 'select.memory_retrieve', typeVersion: '1', phase: 'pre_response' },
      { id: 'persona', type: 'source.persona', typeVersion: '1', phase: 'pre_response' },
      { id: 'proposal', type: 'output.session_state_proposal', typeVersion: '1', phase: 'commit', config: { namespace: 'mood' } },
    );
    const pkg: NodeGraphPackage = {
      ...exportNodeGraphPackage({ document: doc, metadata: { ...META } }),
      dependencies: {
        nodeTypes: [],
        mcpServers: [{ server: 'research', network: true }],
        sessionStateNamespaces: [{ namespace: 'mood', write: true }],
      },
      permissions: [{ permission: 'session.state.write' }, { permission: 'file.write' }],
    };
    const summary = buildNodeGraphPackageSecuritySummary(pkg);
    expect(summary.longTermDataReads).toEqual(['chat_history', 'memory', 'persona']);
    expect(summary.persistentOutputTargets).toEqual(['session_state_proposal']);
    expect(summary.proposesCommittedWrites).toBe(true);
    expect(summary.sessionStateNamespaceReads).toEqual(['mood']);
    expect(summary.mcpServers).toEqual(['research']);
    expect(summary.requestsNetworkAccess).toBe(true);
    expect(summary.requestsFileWrite).toBe(true);
    expect(summary.requiredPermissions).toEqual(['file.write', 'session.state.write']);
  });
});
