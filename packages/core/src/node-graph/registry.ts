import type {
  NodeGraphPhase,
  NodeGraphPortDefinition,
  NodeGraphPortType,
  NodeTypeRegistryEntry,
} from './types.js';

function registryKey(type: string, typeVersion: string): string {
  return `${type}@${typeVersion}`;
}

function port(name: string, type: NodeGraphPortType, options: Omit<NodeGraphPortDefinition, 'name' | 'type'> = {}): NodeGraphPortDefinition {
  return { name, type, ...options };
}

const ALL_PHASES: NodeGraphPhase[] = ['floor_prepare', 'pre_response', 'response', 'post_response', 'commit'];
const PRE_RESPONSE_PHASES: NodeGraphPhase[] = ['floor_prepare', 'pre_response'];
const RESPONSE_PHASES: NodeGraphPhase[] = ['response'];
const POST_RESPONSE_PHASES: NodeGraphPhase[] = ['post_response'];
const COMMIT_PHASES: NodeGraphPhase[] = ['commit'];

export class NodeTypeRegistry {
  private readonly entries = new Map<string, NodeTypeRegistryEntry>();

  register(entry: NodeTypeRegistryEntry): void {
    const key = registryKey(entry.type, entry.typeVersion);
    if (this.entries.has(key)) {
      throw new Error(`Node type already registered: ${key}`);
    }

    this.entries.set(key, {
      ...entry,
      inputPorts: [...entry.inputPorts],
      outputPorts: [...entry.outputPorts],
      supportedPhases: [...entry.supportedPhases],
      permissionsRequired: entry.permissionsRequired ? [...entry.permissionsRequired] : undefined,
    });
  }

  find(type: string, typeVersion: string): NodeTypeRegistryEntry | undefined {
    return this.entries.get(registryKey(type, typeVersion));
  }

  get(type: string, typeVersion: string): NodeTypeRegistryEntry {
    const entry = this.find(type, typeVersion);
    if (!entry) {
      throw new Error(`Node type not registered: ${registryKey(type, typeVersion)}`);
    }
    return entry;
  }

  list(): NodeTypeRegistryEntry[] {
    return [...this.entries.values()].sort((left, right) => {
      const byType = left.type.localeCompare(right.type);
      return byType !== 0 ? byType : left.typeVersion.localeCompare(right.typeVersion);
    });
  }
}

function define(entry: NodeTypeRegistryEntry): NodeTypeRegistryEntry {
  return entry;
}

export const NODE_GRAPH_BUILTIN_NODE_TYPES: NodeTypeRegistryEntry[] = [
  define({
    type: 'source.user_input',
    typeVersion: '1',
    title: 'User Input',
    inputPorts: [],
    outputPorts: [port('text', 'text', { required: true })],
    supportedPhases: PRE_RESPONSE_PHASES,
    previewPolicy: 'auto',
    sideEffects: 'none',
  }),
  define({
    type: 'source.chat_history',
    typeVersion: '1',
    inputPorts: [],
    outputPorts: [port('messages', 'messages'), port('text', 'text')],
    supportedPhases: PRE_RESPONSE_PHASES,
    previewPolicy: 'auto',
    sideEffects: 'none',
  }),
  define({
    type: 'source.character',
    typeVersion: '1',
    inputPorts: [],
    outputPorts: [port('text', 'text'), port('json', 'json')],
    supportedPhases: PRE_RESPONSE_PHASES,
    previewPolicy: 'auto',
    sideEffects: 'none',
  }),
  define({
    type: 'source.persona',
    typeVersion: '1',
    inputPorts: [],
    outputPorts: [port('text', 'text'), port('json', 'json')],
    supportedPhases: PRE_RESPONSE_PHASES,
    previewPolicy: 'auto',
    sideEffects: 'none',
  }),
  define({
    type: 'source.session_state',
    typeVersion: '1',
    inputPorts: [],
    outputPorts: [port('state', 'state_projection'), port('json', 'json')],
    supportedPhases: PRE_RESPONSE_PHASES,
    previewPolicy: 'auto',
    sideEffects: 'none',
  }),
  define({
    type: 'select.worldbook_match',
    typeVersion: '1',
    inputPorts: [port('query', 'text'), port('entries', 'json')],
    outputPorts: [port('selection', 'worldbook_selection'), port('text', 'text')],
    supportedPhases: PRE_RESPONSE_PHASES,
    previewPolicy: 'auto',
    sideEffects: 'none',
  }),
  define({
    type: 'select.memory_retrieve',
    typeVersion: '1',
    inputPorts: [port('query', 'text')],
    outputPorts: [port('selection', 'memory_selection'), port('text', 'text')],
    supportedPhases: PRE_RESPONSE_PHASES,
    previewPolicy: 'manual',
    permissionsRequired: ['project.memory.read'],
    sideEffects: 'none',
  }),
  define({
    type: 'select.token_budget_allocator',
    typeVersion: '1',
    inputPorts: [port('blocks', 'json')],
    outputPorts: [port('blocks', 'json'), port('diagnostics', 'diagnostics')],
    supportedPhases: ['pre_response', 'response'],
    previewPolicy: 'auto',
    sideEffects: 'none',
  }),
  define({
    type: 'compose.session_state_projection_block',
    typeVersion: '1',
    inputPorts: [port('state', 'state_projection')],
    outputPorts: [port('block', 'prompt_block'), port('text', 'text')],
    supportedPhases: PRE_RESPONSE_PHASES,
    previewPolicy: 'auto',
    sideEffects: 'none',
  }),
  define({
    type: 'compose.template_render',
    typeVersion: '1',
    inputPorts: [port('data', 'json')],
    outputPorts: [port('text', 'text'), port('block', 'prompt_block')],
    supportedPhases: ['pre_response', 'response'],
    previewPolicy: 'auto',
    sideEffects: 'none',
  }),
  define({
    type: 'compose.final_messages',
    typeVersion: '1',
    inputPorts: [port('blocks', 'prompt_block', { multiple: true }), port('messages', 'messages')],
    outputPorts: [port('messages', 'messages'), port('prompt_ir', 'prompt_ir'), port('diagnostics', 'diagnostics')],
    supportedPhases: RESPONSE_PHASES,
    previewPolicy: 'auto',
    sideEffects: 'none',
  }),
  define({
    type: 'agent.director_plan',
    typeVersion: '1',
    inputPorts: [port('messages', 'messages')],
    outputPorts: [port('brief', 'agent_brief'), port('diagnostics', 'diagnostics')],
    supportedPhases: ['pre_response', 'response'],
    previewPolicy: 'cached_only',
    permissionsRequired: ['project.agent.run'],
    sideEffects: 'llm',
  }),
  define({
    type: 'agent.player_agency_precheck',
    typeVersion: '1',
    inputPorts: [port('messages', 'messages')],
    outputPorts: [port('brief', 'agent_brief'), port('diagnostics', 'diagnostics')],
    supportedPhases: ['pre_response', 'response'],
    previewPolicy: 'cached_only',
    permissionsRequired: ['project.agent.run'],
    sideEffects: 'llm',
  }),
  define({
    type: 'agent.call',
    typeVersion: '1',
    inputPorts: [port('input', 'json')],
    outputPorts: [port('result', 'json'), port('brief', 'agent_brief'), port('diagnostics', 'diagnostics')],
    supportedPhases: ALL_PHASES,
    previewPolicy: 'cached_only',
    permissionsRequired: ['project.agent.run'],
    sideEffects: 'llm',
  }),
  define({
    type: 'narration.narrator',
    typeVersion: '1',
    inputPorts: [port('messages', 'messages')],
    outputPorts: [port('text', 'text'), port('diagnostics', 'diagnostics')],
    supportedPhases: RESPONSE_PHASES,
    previewPolicy: 'manual',
    sideEffects: 'llm',
  }),
  define({
    type: 'verify.continuity',
    typeVersion: '1',
    inputPorts: [port('text', 'text'), port('context', 'json')],
    outputPorts: [port('result', 'verifier_result'), port('diagnostics', 'diagnostics')],
    supportedPhases: POST_RESPONSE_PHASES,
    previewPolicy: 'cached_only',
    sideEffects: 'llm',
  }),
  define({
    type: 'verify.player_agency_postcheck',
    typeVersion: '1',
    inputPorts: [port('text', 'text'), port('context', 'json')],
    outputPorts: [port('result', 'verifier_result'), port('diagnostics', 'diagnostics')],
    supportedPhases: POST_RESPONSE_PHASES,
    previewPolicy: 'cached_only',
    sideEffects: 'llm',
  }),
  define({
    type: 'output.commit_gate',
    typeVersion: '1',
    inputPorts: [port('text', 'text'), port('verifier', 'verifier_result'), port('outputs', 'json')],
    outputPorts: [port('decision', 'json'), port('diagnostics', 'diagnostics')],
    supportedPhases: COMMIT_PHASES,
    previewPolicy: 'manual',
    sideEffects: 'none',
  }),
  define({
    type: 'output.graph_run_summary',
    typeVersion: '1',
    inputPorts: [port('result', 'json')],
    outputPorts: [port('summary', 'json'), port('diagnostics', 'diagnostics')],
    supportedPhases: COMMIT_PHASES,
    previewPolicy: 'auto',
    sideEffects: 'none',
  }),
  define({
    type: 'output.derived_output',
    typeVersion: '1',
    inputPorts: [port('value', 'json')],
    outputPorts: [port('record', 'json'), port('diagnostics', 'diagnostics')],
    supportedPhases: COMMIT_PHASES,
    previewPolicy: 'manual',
    permissionsRequired: ['project.derived_output.write'],
    sideEffects: 'write',
  }),
  define({
    type: 'output.project_inbox',
    typeVersion: '1',
    inputPorts: [port('payload', 'json')],
    outputPorts: [port('record', 'json'), port('diagnostics', 'diagnostics')],
    supportedPhases: COMMIT_PHASES,
    previewPolicy: 'manual',
    permissionsRequired: ['project.inbox.write'],
    sideEffects: 'write',
  }),
  define({
    type: 'output.session_state_proposal',
    typeVersion: '1',
    inputPorts: [port('proposal', 'json')],
    outputPorts: [port('proposal', 'json'), port('diagnostics', 'diagnostics')],
    supportedPhases: COMMIT_PHASES,
    previewPolicy: 'manual',
    permissionsRequired: ['session.state.write'],
    sideEffects: 'write',
  }),
  define({
    type: 'group.input',
    typeVersion: '1',
    inputPorts: [],
    outputPorts: [port('value', 'json')],
    supportedPhases: ALL_PHASES,
    previewPolicy: 'auto',
    sideEffects: 'none',
  }),
  define({
    type: 'group.output',
    typeVersion: '1',
    inputPorts: [port('value', 'json')],
    outputPorts: [port('value', 'json')],
    supportedPhases: ALL_PHASES,
    previewPolicy: 'auto',
    sideEffects: 'none',
  }),
  // NodeGroup（子图实例，方案 β）：端口为**动态**——不来自此处静态声明，而来自
  // `config.interface`（绑定子图时从其 group.input/output 边界反规范化缓存）。validator /
  // 画布 / ELK 对 group.node 走 `resolveNodeGraphNodePorts` 读取 config.interface。
  define({
    type: 'group.node',
    typeVersion: '1',
    title: 'Node Group',
    description: 'Instantiates a reusable subgraph definition; ports come from its boundary interface.',
    inputPorts: [],
    outputPorts: [],
    supportedPhases: ALL_PHASES,
    previewPolicy: 'manual',
    sideEffects: 'none',
  }),
  // NG2-CORE：控制流节点最小集合（schemaVersion >= 2 才放行 control edge）。
  define({
    type: 'control.condition',
    typeVersion: '1',
    title: 'Condition',
    description: 'Evaluates a structured condition and outputs a boolean result.',
    inputPorts: [port('value', 'json', { multiple: true })],
    outputPorts: [port('result', 'boolean')],
    supportedPhases: ALL_PHASES,
    previewPolicy: 'auto',
    sideEffects: 'none',
  }),
  define({
    type: 'control.branch',
    typeVersion: '1',
    title: 'Branch',
    description: 'Routes control flow on its true / false control ports based on a boolean.',
    inputPorts: [port('condition', 'boolean')],
    outputPorts: [port('true', 'boolean'), port('false', 'boolean')],
    supportedPhases: ALL_PHASES,
    previewPolicy: 'auto',
    sideEffects: 'none',
  }),
  define({
    type: 'control.gate',
    typeVersion: '1',
    title: 'Gate',
    description: 'Gates downstream nodes through its open control port, with an onSkip behavior.',
    inputPorts: [port('condition', 'boolean'), port('value', 'json', { multiple: true })],
    outputPorts: [port('open', 'boolean'), port('value', 'json')],
    supportedPhases: ALL_PHASES,
    previewPolicy: 'auto',
    sideEffects: 'none',
  }),
];

export function createDefaultNodeTypeRegistry(): NodeTypeRegistry {
  const registry = new NodeTypeRegistry();
  for (const entry of NODE_GRAPH_BUILTIN_NODE_TYPES) {
    registry.register(entry);
  }
  return registry;
}
