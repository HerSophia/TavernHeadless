import type { NodeGraphDocument } from '../types.js';
import type { NodeGraphPackage } from './types.js';

/**
 * NG2-PKG（阶段 11）：导入前结构化安全摘要（纲领第 10.3 节）。
 *
 * 在用户确认导入前呈现该图会读什么长期数据、读哪些 session state namespace、
 * 是否提出随回合提交的写入、用到哪些 MCP server、是否请求文件写入 / 网络访问。
 * 复用批次 8 脱敏约定：操作日志只记录该摘要而非完整包正文。
 */
export interface NodeGraphPackageSecuritySummary {
  /** 读取的长期数据面（memory / character / persona / chat_history / worldbook / session_state）。 */
  longTermDataReads: string[];
  /** 读取的 session state namespace。 */
  sessionStateNamespaceReads: string[];
  /** 是否提出随回合提交的写入（任意 commit 阶段写节点）。 */
  proposesCommittedWrites: boolean;
  /** 持久输出目标（derived_output / project_inbox / session_state_proposal）。 */
  persistentOutputTargets: string[];
  /** 使用的 MCP server。 */
  mcpServers: string[];
  /** 是否请求网络访问（任意 MCP 依赖）。 */
  requestsNetworkAccess: boolean;
  /** 是否请求文件写入（权限含 file 面）。 */
  requestsFileWrite: boolean;
  /** 需要的工具权限。 */
  requiredPermissions: string[];
}

const LONG_TERM_DATA_BY_NODE_TYPE: Readonly<Record<string, string>> = {
  'source.chat_history': 'chat_history',
  'source.character': 'character',
  'source.persona': 'persona',
  'source.session_state': 'session_state',
  'select.worldbook_match': 'worldbook',
  'select.memory_retrieve': 'memory',
};

const PERSISTENT_OUTPUT_BY_NODE_TYPE: Readonly<Record<string, string>> = {
  'output.session_state_proposal': 'session_state_proposal',
  'output.derived_output': 'derived_output',
  'output.project_inbox': 'project_inbox',
};

function collectLongTermDataReads(document: NodeGraphDocument): string[] {
  const reads = new Set<string>();
  for (const node of document.nodes) {
    const face = LONG_TERM_DATA_BY_NODE_TYPE[node.type];
    if (face) {
      reads.add(face);
    }
  }
  return [...reads].sort();
}

function collectPersistentOutputTargets(document: NodeGraphDocument): string[] {
  const targets = new Set<string>();
  for (const node of document.nodes) {
    const target = PERSISTENT_OUTPUT_BY_NODE_TYPE[node.type];
    if (target) {
      targets.add(target);
    }
  }
  return [...targets].sort();
}

/** NG2-PKG（阶段 11）：构造包安全摘要。 */
export function buildNodeGraphPackageSecuritySummary(pkg: NodeGraphPackage): NodeGraphPackageSecuritySummary {
  const longTermDataReads = collectLongTermDataReads(pkg.graph);
  const persistentOutputTargets = collectPersistentOutputTargets(pkg.graph);
  const sessionStateNamespaceReads = [...(pkg.dependencies.sessionStateNamespaces ?? [])]
    .map((dep) => dep.namespace)
    .sort();
  const mcpServers = [...(pkg.dependencies.mcpServers ?? [])].map((dep) => dep.server).sort();
  const requiredPermissions = [...pkg.permissions].map((requirement) => requirement.permission).sort();
  const requestsNetworkAccess = (pkg.dependencies.mcpServers ?? []).some((dep) => dep.network !== false);
  const requestsFileWrite = requiredPermissions.some((permission) => /(^|[._])file([._]|$)/.test(permission));

  return {
    longTermDataReads,
    sessionStateNamespaceReads,
    proposesCommittedWrites: persistentOutputTargets.length > 0,
    persistentOutputTargets,
    mcpServers,
    requestsNetworkAccess,
    requestsFileWrite,
    requiredPermissions,
  };
}
