/**
 * CG11（批次 11）：compat prompt 楼层运行图的**单一结构事实源**。
 *
 * 维护者定调（`.limcode/design/prompt-runtime-explicit-prompt-mode-surface-design.md` §1 远期补充）：
 * compat 模式远期与 native 同构，由一张内置、不可改、可 fork 的图承载，但 compat 图化必须走
 * 「影子比对 + golden 等价」门槛，golden 不绿不切流，守住 SillyTavern 兼容底线。
 *
 * 与 native 的差异：compat 主链**零 Agentic**——无导演 / 校验顾问节点（`agent.*` / `verify.*`），
 * 因此 compat floor 结构是 native 结构的子集：source → compose → narrator → commit，且无需
 * `project.agent.run` 权限。`compat_strict` 与 `compat_plus` 结构相同（差异在 recipe / 装配），
 * 故只需这一张结构事实源。
 *
 * 与 DG11 一致：本模块只是结构数据（纯 JSON、无副作用、无 `node:crypto`），可进入浏览器子路径；
 * 真正的 PromptIR 仍由后端既有 compat 装配闭包产出（golden 一致），本图不重写编排。
 */
import type {
  NodeGraphDocument,
  NodeGraphEdge,
  NodeGraphNode,
  NodeGraphPermissionManifest,
  NodeGraphPolicies,
} from '../types.js';
import { NODE_GRAPH_SCHEMA_VERSION_V2 } from '../types.js';

/** compat 默认楼层模板（可 fork 副本）的稳定 graphId。fork 时会清空交后端分配新 id。 */
export const COMPAT_PROMPT_FLOOR_TEMPLATE_ID = 'template.compat_prompt_floor' as const;

/** compat 默认楼层模板版本号（结构语义升级时递增，写入模板 metadata）。 */
export const COMPAT_PROMPT_FLOOR_TEMPLATE_VERSION = 'cg11.v1' as const;

/** compat 楼层图共享结构骨架：compat system graph 与默认模板由此派生，保证二者同结构。 */
export interface CompatPromptFloorStructure {
  mode: 'native_graph';
  nodes: NodeGraphNode[];
  edges: NodeGraphEdge[];
  policies: NodeGraphPolicies;
  permissions: NodeGraphPermissionManifest;
}

/**
 * 构造 compat prompt 楼层图的共享结构（每次返回全新对象，避免共享可变引用）。
 *
 * 节点覆盖 compat 主链（零 Agentic）：
 * - source：`source.user_input`（占位，断连，与 native system graph 一致）/ `source.chat_history`。
 * - compose：`compose.final_messages`（response）。
 * - narrator：`narration.narrator`（response，唯一正文 = compat 单次 LLM 调用）。
 * - commit：`output.commit_gate`（commit，唯一正史写入边界）。
 *
 * 不含 `agent.*` / `verify.*`，故 `permissions.required` 为空（不需 `project.agent.run`）。
 */
export function buildCompatPromptFloorStructure(): CompatPromptFloorStructure {
  return {
    mode: 'native_graph',
    policies: {},
    permissions: { required: [] },
    nodes: [
      { id: 'user_input', type: 'source.user_input', typeVersion: '1', phase: 'pre_response', scope: 'floor_stable' },
      { id: 'history', type: 'source.chat_history', typeVersion: '1', phase: 'pre_response', scope: 'floor_stable' },
      { id: 'compose', type: 'compose.final_messages', typeVersion: '1', phase: 'response' },
      { id: 'narrator', type: 'narration.narrator', typeVersion: '1', phase: 'response' },
      { id: 'commit', type: 'output.commit_gate', typeVersion: '1', phase: 'commit' },
    ],
    edges: [
      { id: 'e_history_compose', kind: 'data', from: { nodeId: 'history', port: 'messages' }, to: { nodeId: 'compose', port: 'messages' } },
      { id: 'e_compose_narrator', kind: 'data', from: { nodeId: 'compose', port: 'messages' }, to: { nodeId: 'narrator', port: 'messages' } },
      { id: 'e_user_input_narrator', kind: 'data', from: { nodeId: 'user_input', port: 'text' }, to: { nodeId: 'narrator', port: 'user_input' } },
      { id: 'e_narrator_commit', kind: 'data', from: { nodeId: 'narrator', port: 'text' }, to: { nodeId: 'commit', port: 'text' } },
    ],
  };
}

/**
 * 构造 compat **默认楼层运行模板图**：与 `system.compat_prompt` 同结构，但 `systemGraph = false`，
 * 是一张可 fork、可编辑的普通 NodeGraph v2 文档。用户载入后保存即生成自己的 compat 编排图。
 */
export function buildCompatPromptFloorTemplate(): NodeGraphDocument {
  const structure = buildCompatPromptFloorStructure();
  return {
    schemaVersion: NODE_GRAPH_SCHEMA_VERSION_V2,
    graphId: COMPAT_PROMPT_FLOOR_TEMPLATE_ID,
    name: 'Default Compat Floor Template',
    description:
      'Forkable copy of the compat prompt floor run (same structure as the compat system graph, zero agentic). Edit it to create your own compat orchestration graph.',
    mode: structure.mode,
    nodes: structure.nodes,
    edges: structure.edges,
    policies: structure.policies,
    permissions: structure.permissions,
    metadata: {
      systemGraph: false,
      template: 'compat_prompt_floor',
      templateVersion: COMPAT_PROMPT_FLOOR_TEMPLATE_VERSION,
    },
  };
}
