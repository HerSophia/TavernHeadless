/**
 * DG11（批次 11）：native prompt 楼层运行图的**单一结构事实源**。
 *
 * 维护者在 `.limcode/design/agentic-batch10-wb10-agent-nodegraph-relationship-discussion.md`
 * §10.5 定调：以 `system.native_prompt` 系统图为权威执行路径，另给用户一份**同结构、可 fork、
 * 可编辑**的默认楼层模板作为起点。为保证「同结构」长期成立，本模块把楼层图的节点 / 边 / 权限
 * 骨架下沉到 `@tavern/core`，由两侧共享：
 *
 * - apps/api 的 `buildNativePromptSystemGraph()`（系统图）在此结构上叠加系统图标识。
 * - apps/studio 的「默认楼层模板」直接消费 `buildNativePromptFloorTemplate()` 完成 fork。
 *
 * 关键边界：本模块只是**结构数据**（纯 JSON、无副作用、无 `node:crypto`），可安全进入浏览器子路径
 * （`@tavern/core/node-graph`）。它不重写编排逻辑——真正的 PromptIR 仍由后端 compose 闭包产出。
 */
import type {
  NodeGraphDocument,
  NodeGraphEdge,
  NodeGraphNode,
  NodeGraphPermissionManifest,
  NodeGraphPolicies,
} from '../types.js';
import { NODE_GRAPH_SCHEMA_VERSION_V2 } from '../types.js';

/** 默认楼层模板（可 fork 副本）的稳定 graphId。fork 时会清空交后端分配新 id。 */
export const NATIVE_PROMPT_FLOOR_TEMPLATE_ID = 'template.native_prompt_floor' as const;

/** 默认楼层模板版本号（结构语义升级时递增，写入模板 metadata）。 */
export const NATIVE_PROMPT_FLOOR_TEMPLATE_VERSION = 'dg11.v1' as const;

/** 楼层图共享结构骨架：系统图与默认模板由此派生，保证二者同结构。 */
export interface NativePromptFloorStructure {
  mode: 'native_graph';
  nodes: NodeGraphNode[];
  edges: NodeGraphEdge[];
  policies: NodeGraphPolicies;
  permissions: NodeGraphPermissionManifest;
}

/**
 * 构造 native prompt 楼层图的共享结构（每次返回全新对象，避免共享可变引用）。
 *
 * 节点覆盖主链阶段，与 `system.native_prompt` 逐节点 / 逐边一致：
 * - source：`source.user_input` / `source.chat_history`（pre_response，floor_stable）。
 * - agent decision：`agent.director_plan`（pre_response，pre_response_stochastic，需 `project.agent.run`）。
 * - compose：`compose.final_messages`（response）。
 * - narrator：`narration.narrator`（response，唯一正文）。
 * - postprocess / verify：`verify.continuity`（post_response）。
 * - commit：`output.commit_gate`（commit，唯一正史写入边界）。
 */
export function buildNativePromptFloorStructure(): NativePromptFloorStructure {
  return {
    mode: 'native_graph',
    policies: {},
    permissions: { required: ['project.agent.run'] },
    nodes: [
      { id: 'user_input', type: 'source.user_input', typeVersion: '1', phase: 'pre_response', scope: 'floor_stable' },
      { id: 'history', type: 'source.chat_history', typeVersion: '1', phase: 'pre_response', scope: 'floor_stable' },
      { id: 'director', type: 'agent.director_plan', typeVersion: '1', phase: 'pre_response', scope: 'pre_response_stochastic' },
      { id: 'compose', type: 'compose.final_messages', typeVersion: '1', phase: 'response' },
      { id: 'narrator', type: 'narration.narrator', typeVersion: '1', phase: 'response' },
      { id: 'verify', type: 'verify.continuity', typeVersion: '1', phase: 'post_response' },
      { id: 'commit', type: 'output.commit_gate', typeVersion: '1', phase: 'commit' },
    ],
    edges: [
      { id: 'e_history_director', kind: 'data', from: { nodeId: 'history', port: 'messages' }, to: { nodeId: 'director', port: 'messages' } },
      { id: 'e_history_compose', kind: 'data', from: { nodeId: 'history', port: 'messages' }, to: { nodeId: 'compose', port: 'messages' } },
      { id: 'e_compose_narrator', kind: 'data', from: { nodeId: 'compose', port: 'messages' }, to: { nodeId: 'narrator', port: 'messages' } },
      { id: 'e_narrator_verify', kind: 'data', from: { nodeId: 'narrator', port: 'text' }, to: { nodeId: 'verify', port: 'text' } },
      { id: 'e_narrator_commit', kind: 'data', from: { nodeId: 'narrator', port: 'text' }, to: { nodeId: 'commit', port: 'text' } },
      { id: 'e_verify_commit', kind: 'data', from: { nodeId: 'verify', port: 'result' }, to: { nodeId: 'commit', port: 'verifier' } },
    ],
  };
}

/**
 * 构造**默认楼层运行模板图**：与 `system.native_prompt` 同结构，但 `systemGraph = false`，
 * 是一张可 fork、可编辑的普通 NodeGraph v2 文档。用户载入后保存即生成自己的编排图，不影响系统图。
 *
 * 名称用英文（core 语言无关）；前端可在 fork 时以本地化名覆盖。
 */
export function buildNativePromptFloorTemplate(): NodeGraphDocument {
  const structure = buildNativePromptFloorStructure();
  return {
    schemaVersion: NODE_GRAPH_SCHEMA_VERSION_V2,
    graphId: NATIVE_PROMPT_FLOOR_TEMPLATE_ID,
    name: 'Default Floor Run Template',
    description:
      'Forkable copy of the native prompt floor run (same structure as the system graph). Edit it to create your own orchestration graph.',
    mode: structure.mode,
    nodes: structure.nodes,
    edges: structure.edges,
    policies: structure.policies,
    permissions: structure.permissions,
    metadata: {
      systemGraph: false,
      template: 'native_prompt_floor',
      templateVersion: NATIVE_PROMPT_FLOOR_TEMPLATE_VERSION,
    },
  };
}
