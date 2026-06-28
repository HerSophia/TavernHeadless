/**
 * SG11（批次 11）：内置可复用**顾问子图**库。
 *
 * 承接 §10.5「先模板、后子图库」的第二条：把楼层编排里的顾问型子 Agent（director / verifier / memory）
 * 从「父图里的单节点」抽成**独立、内置、可复用的子图单元**，复用批次 10 已落地的 β 子图基建
 * （`group.input` / `group.output` 边界 + `group.node` 实例 + 递归嵌套执行）。
 *
 * 每个顾问子图 = 一份 `metadata.subgraph = true` 的 NodeGraph v2 定义，结构为
 * `group.input → 顾问节点 → group.output`（**薄封装**：稳定对外接口 + 可复用 + 可独立演进，
 * 不重写顾问内核）。边界约定见 `agentic-batch10-nodegroup-subgraph-v1-design.md` §3.3：
 * `group.input` / `group.output` 以 `config.ports` 声明多端口接口。
 *
 * 关键边界（SG11 设计 §2.4）：顾问子图**只产 brief / findings / selection，不写正史**——
 * 内部不含 `narration.narrator` / `output.commit_gate` / 持久 `output.*`；其所需 permission 由引用它的
 * 父图 manifest 上卷。本模块只是结构数据（纯 JSON、无副作用、无 `node:crypto`），可进入浏览器子路径。
 */
import type {
  NodeGraphDocument,
  NodeGraphEdge,
  NodeGraphNode,
  NodeGraphPhase,
  NodeGraphPortDefinition,
} from '../types.js';
import { NODE_GRAPH_SCHEMA_VERSION_V2 } from '../types.js';
import {
  NODE_GRAPH_GROUP_INPUT_TYPE,
  NODE_GRAPH_GROUP_OUTPUT_TYPE,
} from '../subgraph.js';

/** 内置顾问子图版本号（结构 / 接口语义升级时递增，写入 metadata）。 */
export const BUILTIN_ADVISOR_SUBGRAPH_VERSION = 'sg11.v1' as const;

/** 内置顾问子图稳定 id。 */
export const DIRECTOR_ADVISOR_SUBGRAPH_ID = 'system.subgraph.director' as const;
export const CONTINUITY_VERIFIER_SUBGRAPH_ID = 'system.subgraph.continuity_verifier' as const;
export const PLAYER_AGENCY_VERIFIER_SUBGRAPH_ID = 'system.subgraph.player_agency_verifier' as const;
export const MEMORY_RETRIEVE_SUBGRAPH_ID = 'system.subgraph.memory_retrieve' as const;

interface AdvisorSubgraphSpec {
  graphId: string;
  name: string;
  description: string;
  builtin: string;
  phase: NodeGraphPhase;
  /** 顾问节点（被薄封装的单一内核节点）。 */
  advisor: { id: string; type: string };
  /** 对外输入接口端口（= group.input 暴露的端口 = 顾问节点的输入端口名）。 */
  inputs: NodeGraphPortDefinition[];
  /** 对外输出接口端口（= group.output 暴露的端口 = 顾问节点的输出端口名）。 */
  outputs: NodeGraphPortDefinition[];
  permissions: string[];
}

/**
 * 由规格构造一份顾问子图定义：`group.input → 顾问节点 → group.output`。
 * 内部连线按端口名一一对接（group.input.<name> → advisor.<name>；advisor.<name> → group.output.<name>）。
 */
function buildAdvisorSubgraph(spec: AdvisorSubgraphSpec): NodeGraphDocument {
  const inputId = 'in';
  const outputId = 'out';
  const nodes: NodeGraphNode[] = [
    {
      id: inputId,
      type: NODE_GRAPH_GROUP_INPUT_TYPE,
      typeVersion: '1',
      phase: spec.phase,
      config: { ports: spec.inputs.map((port) => ({ ...port })) },
    },
    { id: spec.advisor.id, type: spec.advisor.type, typeVersion: '1', phase: spec.phase },
    {
      id: outputId,
      type: NODE_GRAPH_GROUP_OUTPUT_TYPE,
      typeVersion: '1',
      phase: spec.phase,
      config: { ports: spec.outputs.map((port) => ({ ...port })) },
    },
  ];
  const edges: NodeGraphEdge[] = [
    ...spec.inputs.map((port): NodeGraphEdge => ({
      id: `e_in_${port.name}`,
      kind: 'data',
      from: { nodeId: inputId, port: port.name },
      to: { nodeId: spec.advisor.id, port: port.name },
    })),
    ...spec.outputs.map((port): NodeGraphEdge => ({
      id: `e_out_${port.name}`,
      kind: 'data',
      from: { nodeId: spec.advisor.id, port: port.name },
      to: { nodeId: outputId, port: port.name },
    })),
  ];
  return {
    schemaVersion: NODE_GRAPH_SCHEMA_VERSION_V2,
    graphId: spec.graphId,
    name: spec.name,
    description: spec.description,
    mode: 'native_graph',
    nodes,
    edges,
    policies: {},
    permissions: { required: [...spec.permissions] },
    metadata: { subgraph: true, builtin: spec.builtin, builtinVersion: BUILTIN_ADVISOR_SUBGRAPH_VERSION },
  };
}

/** 导演顾问子图：`messages` → `brief`（剧情规划，不写正文）。 */
export function buildDirectorAdvisorSubgraph(): NodeGraphDocument {
  return buildAdvisorSubgraph({
    graphId: DIRECTOR_ADVISOR_SUBGRAPH_ID,
    name: 'Director Advisor',
    description: 'Reusable advisor subgraph: produces a director brief from chat messages (no canon write).',
    builtin: 'advisor.director',
    phase: 'pre_response',
    advisor: { id: 'director', type: 'agent.director_plan' },
    inputs: [{ name: 'messages', type: 'messages' }],
    outputs: [{ name: 'brief', type: 'agent_brief' }],
    permissions: ['project.agent.run'],
  });
}

/** 连续性校验顾问子图：`text` / `context` → `result`（连续性 findings，不写正文）。 */
export function buildContinuityVerifierSubgraph(): NodeGraphDocument {
  return buildAdvisorSubgraph({
    graphId: CONTINUITY_VERIFIER_SUBGRAPH_ID,
    name: 'Continuity Verifier',
    description: 'Reusable advisor subgraph: continuity verification findings over narrator text (no canon write).',
    builtin: 'advisor.continuity_verifier',
    phase: 'post_response',
    advisor: { id: 'verify', type: 'verify.continuity' },
    inputs: [
      { name: 'text', type: 'text' },
      { name: 'context', type: 'json' },
    ],
    outputs: [{ name: 'result', type: 'verifier_result' }],
    permissions: [],
  });
}

/** 玩家自主性后检顾问子图：`text` / `context` → `result`（自主性 findings，不写正文）。 */
export function buildPlayerAgencyVerifierSubgraph(): NodeGraphDocument {
  return buildAdvisorSubgraph({
    graphId: PLAYER_AGENCY_VERIFIER_SUBGRAPH_ID,
    name: 'Player Agency Verifier',
    description: 'Reusable advisor subgraph: player-agency postcheck findings over narrator text (no canon write).',
    builtin: 'advisor.player_agency_verifier',
    phase: 'post_response',
    advisor: { id: 'verify', type: 'verify.player_agency_postcheck' },
    inputs: [
      { name: 'text', type: 'text' },
      { name: 'context', type: 'json' },
    ],
    outputs: [{ name: 'result', type: 'verifier_result' }],
    permissions: [],
  });
}

/** 记忆检索顾问子图：`query` → `selection`（记忆选择，不写正文）。 */
export function buildMemoryRetrieveSubgraph(): NodeGraphDocument {
  return buildAdvisorSubgraph({
    graphId: MEMORY_RETRIEVE_SUBGRAPH_ID,
    name: 'Memory Retrieve',
    description: 'Reusable advisor subgraph: retrieves a memory selection from a query (no canon write).',
    builtin: 'advisor.memory_retrieve',
    phase: 'pre_response',
    advisor: { id: 'memory', type: 'select.memory_retrieve' },
    inputs: [{ name: 'query', type: 'text' }],
    outputs: [{ name: 'selection', type: 'memory_selection' }],
    permissions: ['project.memory.read'],
  });
}

/** 返回全部内置顾问子图（供 studio 子图库面板 / 校验自检）。 */
export function listBuiltinAdvisorSubgraphs(): NodeGraphDocument[] {
  return [
    buildDirectorAdvisorSubgraph(),
    buildContinuityVerifierSubgraph(),
    buildPlayerAgencyVerifierSubgraph(),
    buildMemoryRetrieveSubgraph(),
  ];
}
