import { NODE_GRAPH_ANNOTATION_COMMENT_TYPE } from './annotation.js';
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

const DEFAULT_CONTROL_CONDITION_CONFIG = {
  condition: { op: 'exists', value: { source: 'runtime', path: ['intent'] } },
};
const DEFAULT_CONTROL_GATE_CONFIG = {
  ...DEFAULT_CONTROL_CONDITION_CONFIG,
  onSkip: 'empty_output',
};
const DEFAULT_AGENT_CALL_CONFIG = {
  medium: { kind: 'single_call', deliveryTarget: 'return_inline' },
};
const DEFAULT_ANNOTATION_COMMENT_CONFIG = { content: '' };

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
    description: 'Reads the latest user message for the current floor run.',
    inputPorts: [],
    outputPorts: [port('text', 'text', { required: true, description: 'Latest user message text.' })],
    supportedPhases: PRE_RESPONSE_PHASES,
    previewPolicy: 'auto',
    sideEffects: 'none',
    knowledge: {
      category: 'source',
      summary: 'Provides the latest user input as plain text.',
      usage: 'Use this as a starting source when later nodes need the current user message as a query, template value, or prompt block input.',
      config: { mode: 'none' },
      pitfalls: ['This node only exposes the current input. Use source.chat_history when previous messages are needed.'],
      relatedNodeTypes: ['source.chat_history', 'select.worldbook_match', 'compose.template_render'],
    },
  }),
  define({
    type: 'source.global_input',
    typeVersion: '1',
    title: 'Global Input',
    description: 'Broadcasts the current user input to every same-named, compatible, unconnected input port in the graph (excluding nodes inside subgraph groups).',
    inputPorts: [],
    outputPorts: [
      // `value` 是变长（variadic）通配输出端口：可重复连出，且类型为 `any`，
      // 可接入任意类型的输入端口。未显式连线的同名输入口会在编译期被自动广播。
      port('value', 'any', { variadic: true, multiple: true, description: 'Broadcast value (current user input). Auto-connects to same-named compatible unconnected inputs at compile time.' }),
    ],
    supportedPhases: PRE_RESPONSE_PHASES,
    previewPolicy: 'auto',
    sideEffects: 'none',
    knowledge: {
      category: 'source',
      summary: 'Broadcasts the current user input to compatible unconnected input ports across the graph.',
      usage: 'Use this when many nodes need the current user input but you do not want to wire each one individually. At compile time its output is auto-connected to every same-named, type-compatible, unconnected input port, except for nodes inside subgraph groups.',
      config: { mode: 'none' },
      pitfalls: [
        'Auto-broadcast only targets input ports whose name matches the output port name (value).',
        'Nodes inside subgraph groups are skipped; wire their group.input boundary explicitly instead.',
        'An input port that already has an incoming edge is never re-broadcast.',
      ],
      relatedNodeTypes: ['source.user_input', 'narration.narrator', 'agent.director_plan'],
    },
  }),
  define({
    type: 'source.chat_history',
    typeVersion: '1',
    title: 'Chat History',
    description: 'Reads normalized conversation history for prompt assembly.',
    inputPorts: [],
    outputPorts: [
      port('messages', 'messages', { description: 'History as model messages.' }),
      port('text', 'text', { description: 'History rendered as plain text.' }),
    ],
    supportedPhases: PRE_RESPONSE_PHASES,
    previewPolicy: 'auto',
    sideEffects: 'none',
    knowledge: {
      category: 'source',
      summary: 'Provides previous conversation messages and a text form of the same history.',
      usage: 'Use this when the narrator, verifier, or Agent needs earlier conversation context.',
      config: { mode: 'none' },
      pitfalls: ['Long history may be trimmed later by budget nodes or prompt assembly.'],
      relatedNodeTypes: ['compose.final_messages', 'agent.director_plan', 'narration.narrator'],
    },
  }),
  define({
    type: 'source.character',
    typeVersion: '1',
    title: 'Character',
    description: 'Reads active character information from the current session context.',
    inputPorts: [],
    outputPorts: [
      port('text', 'text', { description: 'Character information rendered as text.' }),
      port('json', 'json', { description: 'Structured character information.' }),
    ],
    supportedPhases: PRE_RESPONSE_PHASES,
    previewPolicy: 'auto',
    sideEffects: 'none',
    knowledge: {
      category: 'source',
      summary: 'Provides active character data as text and JSON.',
      usage: 'Use this to add character description, personality, scenario, or other character facts to a prompt graph.',
      config: { mode: 'none' },
      pitfalls: ['If the session has no active character data, downstream prompt content may be empty.'],
      relatedNodeTypes: ['compose.template_render', 'compose.text_to_block', 'compose.final_messages'],
    },
  }),
  define({
    type: 'source.persona',
    typeVersion: '1',
    title: 'Persona',
    description: 'Reads the active user persona for the current session.',
    inputPorts: [],
    outputPorts: [
      port('text', 'text', { description: 'Persona rendered as text.' }),
      port('json', 'json', { description: 'Structured persona information.' }),
    ],
    supportedPhases: PRE_RESPONSE_PHASES,
    previewPolicy: 'auto',
    sideEffects: 'none',
    knowledge: {
      category: 'source',
      summary: 'Provides user persona data as text and JSON.',
      usage: 'Use this when the model should consider the player or user persona during generation.',
      config: { mode: 'none' },
      pitfalls: ['Do not assume persona is always present in every session.'],
      relatedNodeTypes: ['compose.template_render', 'compose.text_to_block', 'compose.final_messages'],
    },
  }),
  define({
    type: 'source.dialogue_examples',
    typeVersion: '1',
    title: 'Dialogue Examples',
    description: 'Reads example dialogue from the active character context.',
    inputPorts: [],
    outputPorts: [
      port('text', 'text', { description: 'Example dialogue rendered as text.' }),
      port('json', 'json', { description: 'Structured example dialogue payload.' }),
    ],
    supportedPhases: PRE_RESPONSE_PHASES,
    previewPolicy: 'auto',
    sideEffects: 'none',
    knowledge: {
      category: 'source',
      summary: 'Provides active character example dialogue as text and JSON.',
      usage: 'Use this when a graph should include character card example dialogue in the final prompt.',
      config: { mode: 'none' },
      pitfalls: ['Not every character has example dialogue. Empty examples should be safe to ignore downstream.'],
      relatedNodeTypes: ['source.character', 'compose.text_to_block', 'compose.final_messages'],
    },
  }),
  define({
    type: 'source.session_state',
    typeVersion: '1',
    title: 'Session State',
    description: 'Reads structured session state as a state projection.',
    inputPorts: [],
    outputPorts: [
      port('state', 'state_projection', { description: 'Session state projection for prompt use.' }),
      port('json', 'json', { description: 'Raw structured session state.' }),
    ],
    supportedPhases: PRE_RESPONSE_PHASES,
    previewPolicy: 'auto',
    sideEffects: 'none',
    knowledge: {
      category: 'source',
      summary: 'Provides current session state for prompts, checks, and templates.',
      usage: 'Use this when the graph needs stable game state, scene state, or other structured session state.',
      config: { mode: 'none' },
      pitfalls: ['This node reads state. It does not write state changes. Use output.session_state_proposal for proposals.'],
      relatedNodeTypes: ['compose.session_state_projection_block', 'output.session_state_proposal'],
    },
  }),
  define({
    type: 'select.worldbook_match',
    typeVersion: '1',
    title: 'Worldbook Match',
    description: 'Selects worldbook entries that match a query and optional entry set.',
    inputPorts: [
      port('query', 'text', { description: 'Text used to match worldbook entries.' }),
      port('entries', 'json', { description: 'Optional worldbook entries or candidate set.' }),
    ],
    outputPorts: [
      port('selection', 'worldbook_selection', { description: 'Matched worldbook entries with metadata.' }),
      port('text', 'text', { description: 'Matched worldbook entries rendered as text.' }),
    ],
    supportedPhases: PRE_RESPONSE_PHASES,
    previewPolicy: 'auto',
    sideEffects: 'none',
    knowledge: {
      category: 'select',
      summary: 'Finds relevant worldbook entries for a query.',
      usage: 'Connect user input, history, or a template query to this node before rendering lore into final prompt messages.',
      config: { mode: 'none' },
      pitfalls: ['The quality of matches depends on the query text and the available worldbook entries.'],
      relatedNodeTypes: ['source.user_input', 'compose.text_to_block', 'compose.final_messages'],
    },
  }),
  define({
    type: 'select.memory_retrieve',
    typeVersion: '1',
    title: 'Memory Retrieve',
    description: 'Retrieves relevant project memory for a query.',
    inputPorts: [port('query', 'text', { description: 'Text used to retrieve memory records.' })],
    outputPorts: [
      port('selection', 'memory_selection', { description: 'Retrieved memory records with metadata.' }),
      port('text', 'text', { description: 'Retrieved memory rendered as prompt text.' }),
    ],
    supportedPhases: PRE_RESPONSE_PHASES,
    previewPolicy: 'manual',
    permissionsRequired: ['project.memory.read'],
    sideEffects: 'none',
    knowledge: {
      category: 'select',
      summary: 'Retrieves relevant memory records for the current turn.',
      usage: 'Use this before prompt composition when long-term memory should influence the response.',
      config: { mode: 'none' },
      pitfalls: ['Requires project.memory.read. Missing permission will make the graph fail validation.'],
      relatedNodeTypes: ['source.user_input', 'compose.template_render', 'output.session_state_proposal'],
    },
  }),
  define({
    type: 'select.token_budget_allocator',
    typeVersion: '1',
    title: 'Token Budget Allocator',
    description: 'Allocates prompt block budget and reports budget diagnostics.',
    inputPorts: [port('blocks', 'json', { description: 'Prompt blocks or budget candidates.' })],
    outputPorts: [
      port('blocks', 'json', { description: 'Budgeted prompt blocks.' }),
      port('diagnostics', 'diagnostics', { description: 'Budget diagnostics and trimming notes.' }),
    ],
    supportedPhases: ['pre_response', 'response'],
    previewPolicy: 'auto',
    sideEffects: 'none',
    knowledge: {
      category: 'select',
      summary: 'Applies token budget choices to prompt blocks.',
      usage: 'Use this when prompt sections need deterministic pruning before final message assembly.',
      config: { mode: 'none' },
      pitfalls: ['This node cannot recover content that was not provided by upstream nodes.'],
      relatedNodeTypes: ['compose.final_messages', 'source.chat_history'],
    },
  }),
  define({
    type: 'compose.session_state_projection_block',
    typeVersion: '1',
    title: 'Session State Projection Block',
    description: 'Renders a session state projection as a prompt block.',
    inputPorts: [port('state', 'state_projection', { description: 'State projection to render.' })],
    outputPorts: [
      port('block', 'prompt_block', { description: 'Prompt block built from session state.' }),
      port('text', 'text', { description: 'Plain text representation of the same block.' }),
    ],
    supportedPhases: PRE_RESPONSE_PHASES,
    previewPolicy: 'auto',
    sideEffects: 'none',
    knowledge: {
      category: 'compose',
      summary: 'Turns session state into prompt-ready text and a prompt block.',
      usage: 'Use this after source.session_state when state should enter final prompt messages.',
      config: { mode: 'none' },
      pitfalls: ['State projection content depends on upstream state availability.'],
      relatedNodeTypes: ['source.session_state', 'compose.final_messages'],
    },
  }),
  define({
    type: 'compose.template_render',
    typeVersion: '1',
    title: 'Template Render',
    description: 'Renders text from a template and JSON data.',
    inputPorts: [port('data', 'json', { description: 'Template data object.' })],
    outputPorts: [
      port('text', 'text', { description: 'Rendered template text.' }),
      port('block', 'prompt_block', { description: 'Rendered text as a prompt block.' }),
    ],
    supportedPhases: ['pre_response', 'response'],
    previewPolicy: 'auto',
    sideEffects: 'none',
    knowledge: {
      category: 'compose',
      summary: 'Renders a configured template with upstream JSON data.',
      usage: 'Use this for stable prompt sections, worldbook text wrapping, or custom instructions that need variables.',
      config: {
        mode: 'object',
        fields: [
          { path: 'template', label: 'Template', type: 'string', required: true, description: 'Template text to render. The engine may also read content as a legacy alias.' },
          { path: 'role', label: 'Message role', type: 'enum', description: 'Optional role hint when the rendered block is used as a message.', enumValues: ['system', 'user', 'assistant'] },
        ],
      },
      examples: [{ title: 'Render a system block', node: { type: 'compose.template_render', typeVersion: '1', phase: 'pre_response', config: { template: 'Use this context: {{context}}' } } }],
      pitfalls: ['Invalid or missing template data can produce empty rendered text.'],
      relatedNodeTypes: ['source.character', 'select.worldbook_match', 'compose.text_to_block', 'compose.final_messages'],
    },
  }),
  define({
    type: 'compose.text_to_block',
    typeVersion: '1',
    title: 'Text to Block',
    description: 'Converts text into a prompt block for final message composition.',
    inputPorts: [port('text', 'text', { required: true, description: 'Text to include as a prompt block.' })],
    outputPorts: [port('block', 'prompt_block', { description: 'Prompt block built from the input text.' })],
    supportedPhases: ['pre_response', 'response'],
    previewPolicy: 'auto',
    sideEffects: 'none',
    knowledge: {
      category: 'compose',
      summary: 'Wraps a text source as a prompt block.',
      usage: 'Use this between source nodes that output text and compose.final_messages blocks input.',
      config: {
        mode: 'object',
        fields: [
          { path: 'role', label: 'Message role', type: 'enum', description: 'Optional role hint when the block is used as a message.', enumValues: ['system', 'user', 'assistant'] },
        ],
      },
      examples: [{ title: 'Convert character text into a prompt block', node: { type: 'compose.text_to_block', typeVersion: '1', phase: 'pre_response', config: { role: 'system' } } }],
      pitfalls: ['Empty input text produces an empty block. Downstream composition may ignore empty blocks.'],
      relatedNodeTypes: ['source.character', 'source.persona', 'source.dialogue_examples', 'select.worldbook_match', 'compose.final_messages'],
    },
  }),
  define({
    type: 'compose.final_messages',
    typeVersion: '1',
    title: 'Final Messages',
    description: 'Composes prompt blocks and history into final model messages and PromptIR.',
    inputPorts: [
      port('blocks', 'prompt_block', { multiple: true, description: 'Prompt blocks to include in final messages.' }),
      port('messages', 'messages', { description: 'Existing messages, usually chat history.' }),
    ],
    outputPorts: [
      port('messages', 'messages', { description: 'Final model messages.' }),
      port('prompt_ir', 'prompt_ir', { description: 'Compiled PromptIR view.' }),
      port('diagnostics', 'diagnostics', { description: 'Prompt assembly diagnostics.' }),
    ],
    supportedPhases: RESPONSE_PHASES,
    previewPolicy: 'auto',
    sideEffects: 'none',
    knowledge: {
      category: 'compose',
      summary: 'Builds the final model messages from prompt blocks and history.',
      usage: 'Use this before narration or Agent nodes that need complete model messages.',
      config: { mode: 'none' },
      pitfalls: ['Missing key blocks may still produce messages, but the prompt can become incomplete.'],
      relatedNodeTypes: ['source.chat_history', 'compose.template_render', 'narration.narrator'],
    },
  }),
  define({
    type: 'agent.director_plan',
    typeVersion: '1',
    title: 'Director Plan',
    description: 'Calls a director Agent to produce planning guidance.',
    inputPorts: [
      port('messages', 'messages', { description: 'Messages used as director context.' }),
      port('text', 'text', { description: 'Optional additional text context for the director Agent.' }),
      port('user_input', 'text', { required: true, description: 'Current user input text; required so the director always sees what the player said.' }),
    ],
    outputPorts: [
      port('brief', 'agent_brief', { description: 'Director planning brief.' }),
      port('diagnostics', 'diagnostics', { description: 'Agent call diagnostics.' }),
    ],
    supportedPhases: ['pre_response', 'response'],
    previewPolicy: 'cached_only',
    permissionsRequired: ['project.agent.run'],
    sideEffects: 'llm',
    knowledge: {
      category: 'agent',
      summary: 'Runs a director Agent and returns planning guidance.',
      usage: 'Use this when the graph should obtain scene direction before narrator generation.',
      config: { mode: 'none' },
      pitfalls: ['Requires project.agent.run and performs an LLM call.'],
      relatedNodeTypes: ['compose.final_messages', 'agent.call', 'narration.narrator'],
    },
  }),
  define({
    type: 'agent.player_agency_precheck',
    typeVersion: '1',
    title: 'Player Agency Precheck',
    description: 'Calls an Agent to check player agency before response generation.',
    inputPorts: [
      port('messages', 'messages', { description: 'Messages used as agency check context.' }),
      port('text', 'text', { description: 'Optional additional text context for the agency check Agent.' }),
      port('user_input', 'text', { required: true, description: 'Current user input text; required to judge whether the player intent is being respected.' }),
    ],
    outputPorts: [
      port('brief', 'agent_brief', { description: 'Precheck brief and recommendations.' }),
      port('diagnostics', 'diagnostics', { description: 'Agent call diagnostics.' }),
    ],
    supportedPhases: ['pre_response', 'response'],
    previewPolicy: 'cached_only',
    permissionsRequired: ['project.agent.run'],
    sideEffects: 'llm',
    knowledge: {
      category: 'agent',
      summary: 'Checks player agency risk before generation.',
      usage: 'Use this when the response should be guided away from taking actions for the player.',
      config: { mode: 'none' },
      pitfalls: ['Requires project.agent.run and adds another LLM call to the run.'],
      relatedNodeTypes: ['agent.director_plan', 'verify.player_agency_postcheck'],
    },
  }),
  define({
    type: 'agent.call',
    typeVersion: '1',
    title: 'Agent Call',
    description: 'Runs a configured Agent interaction and returns structured results.',
    inputPorts: [
      port('input', 'json', { description: 'Agent input payload.' }),
      port('text', 'text', { description: 'Optional additional text context for the Agent call.' }),
    ],
    outputPorts: [
      port('result', 'json', { description: 'Raw Agent result payload.' }),
      port('brief', 'agent_brief', { description: 'Agent brief when available.' }),
      port('diagnostics', 'diagnostics', { description: 'Agent execution diagnostics.' }),
    ],
    supportedPhases: ALL_PHASES,
    previewPolicy: 'cached_only',
    permissionsRequired: ['project.agent.run'],
    sideEffects: 'llm',
    knowledge: {
      category: 'agent',
      summary: 'Runs a generic Agent call with configurable delivery and retention behavior.',
      usage: 'Use this for custom assistant, reviewer, memory, or workflow Agent calls that do not fit the built-in director and verifier nodes.',
      config: {
        mode: 'object',
        defaultConfig: DEFAULT_AGENT_CALL_CONFIG,
        fields: [
          { path: 'medium.kind', label: 'Medium', type: 'enum', required: true, description: 'How the Agent call is executed.', enumValues: ['single_call', 'temporary_conversation', 'background_job'], defaultValue: 'single_call' },
          { path: 'medium.deliveryTarget', label: 'Delivery target', type: 'enum', required: true, description: 'Where the Agent result is delivered.', enumValues: ['return_inline', 'page_staged_write', 'derived_output', 'project_inbox', 'session_state_proposal', 'prompt_runtime_injection', 'client_data', 'plugin_data'], defaultValue: 'return_inline' },
          { path: 'agentBindingId', label: 'Agent binding', type: 'string', description: 'Optional project Agent binding id. Required for some background job flows.' },
          { path: 'triggerReason', label: 'Trigger reason', type: 'string', description: 'Human-readable reason recorded for the call.' },
          { path: 'temporaryConversationRequest', label: 'Temporary conversation request', type: 'object', description: 'Delivery-specific request payload for temporary conversation based outputs.' },
        ],
      },
      examples: [{ title: 'Inline Agent result', node: { type: 'agent.call', typeVersion: '1', phase: 'pre_response', config: DEFAULT_AGENT_CALL_CONFIG } }],
      pitfalls: ['Requires project.agent.run.', 'background_job usually needs graph policy allowBackgroundJobs=true.', 'Persistent delivery targets may need allowPersistentOutputs=true.'],
      relatedNodeTypes: ['agent.director_plan', 'output.project_inbox', 'output.session_state_proposal'],
    },
  }),
  define({
    type: 'narration.narrator',
    typeVersion: '1',
    title: 'Narrator',
    description: 'Calls the narrator model to generate response text.',
    inputPorts: [
      port('messages', 'messages', { description: 'Final messages used for narration.' }),
      port('text', 'text', { description: 'Optional additional text context for narration.' }),
      port('user_input', 'text', { required: true, description: 'Current user input text; required so narration always reflects what the player actually said.' }),
    ],
    outputPorts: [
      port('text', 'text', { description: 'Generated narrator text.' }),
      port('diagnostics', 'diagnostics', { description: 'Narration diagnostics.' }),
    ],
    supportedPhases: RESPONSE_PHASES,
    previewPolicy: 'manual',
    sideEffects: 'llm',
    knowledge: {
      category: 'narration',
      summary: 'Generates the main assistant or narrator response text.',
      usage: 'Use this after compose.final_messages when a graph should produce the final narrative reply.',
      config: {
        mode: 'object',
        fields: [
          { path: 'source', label: 'Carrier source', type: 'enum', enumValues: ['preset', 'subgraph'], description: 'Optional execution carrier source. A narrator carries either a preset or a subgraph, never both. If omitted, the source is inferred from the content (subgraphRef => subgraph, otherwise preset).' },
          { path: 'presetRef.presetId', label: 'Preset id', type: 'string', description: 'Preset id carried by this narrator (preset source). If omitted, the recipe falls back to the session preset.' },
          { path: 'presetRef.presetVersionId', label: 'Preset version id', type: 'string', description: 'Optional preset version id. If omitted, the active preset version is used.' },
          { path: 'subgraphRef.graphId', label: 'Subgraph id', type: 'string', description: "Subgraph id carried by this narrator (subgraph source). Required when source === 'subgraph'; mutually exclusive with presetRef." },
          { path: 'subgraphRef.versionId', label: 'Subgraph version id', type: 'string', description: 'Optional subgraph version id. If omitted, the active subgraph version is used.' },
        ],
      },
      examples: [{ title: 'Use session preset', node: { type: 'narration.narrator', typeVersion: '1', phase: 'response' } }],
      pitfalls: [
        'This node performs the main LLM call and usually belongs in the response phase.',
        'Carrier source is mutually exclusive: a narrator carries either a preset (presetRef) or a subgraph (subgraphRef), never both.',
        'When source is omitted it is inferred from content: a structurally valid subgraphRef implies subgraph, otherwise preset (existing graphs stay backward compatible).',
        "When source === 'subgraph' a structurally valid subgraphRef { graphId, versionId? } is required.",
      ],
      relatedNodeTypes: ['compose.final_messages', 'verify.continuity', 'output.commit_gate'],
    },
  }),
  define({
    type: 'verify.continuity',
    typeVersion: '1',
    title: 'Continuity Check',
    description: 'Checks generated text against context for continuity issues.',
    inputPorts: [
      port('text', 'text', { description: 'Generated text to verify.' }),
      port('context', 'json', { description: 'Optional context used for verification.' }),
    ],
    outputPorts: [
      port('result', 'verifier_result', { description: 'Verifier result and decision data.' }),
      port('diagnostics', 'diagnostics', { description: 'Verifier diagnostics.' }),
    ],
    supportedPhases: POST_RESPONSE_PHASES,
    previewPolicy: 'cached_only',
    sideEffects: 'llm',
    knowledge: {
      category: 'verify',
      summary: 'Checks whether generated text preserves scene and story continuity.',
      usage: 'Use this after narration and before commit decisions when continuity review is required.',
      config: { mode: 'none' },
      pitfalls: ['Adds a post-response LLM call. Connect its result to output.commit_gate when it should affect commit decisions.'],
      relatedNodeTypes: ['narration.narrator', 'output.commit_gate'],
    },
  }),
  define({
    type: 'verify.player_agency_postcheck',
    typeVersion: '1',
    title: 'Player Agency Postcheck',
    description: 'Checks generated text for player agency violations after generation.',
    inputPorts: [
      port('text', 'text', { description: 'Generated text to verify.' }),
      port('context', 'json', { description: 'Optional context used for verification.' }),
      port('user_input', 'text', { required: true, description: 'Current user input text; required to judge whether the generated output respects the player intent.' }),
    ],
    outputPorts: [
      port('result', 'verifier_result', { description: 'Verifier result and decision data.' }),
      port('diagnostics', 'diagnostics', { description: 'Verifier diagnostics.' }),
    ],
    supportedPhases: POST_RESPONSE_PHASES,
    previewPolicy: 'cached_only',
    sideEffects: 'llm',
    knowledge: {
      category: 'verify',
      summary: 'Checks whether generated text preserves player agency.',
      usage: 'Use this after narration when the system should catch outputs that decide the player character’s action or intent.',
      config: { mode: 'none' },
      pitfalls: ['Adds a post-response LLM call. Connect its result to output.commit_gate when it should block or warn.'],
      relatedNodeTypes: ['agent.player_agency_precheck', 'narration.narrator', 'output.commit_gate'],
    },
  }),
  define({
    type: 'output.commit_gate',
    typeVersion: '1',
    title: 'Commit Gate',
    description: 'Builds a final commit decision from generated text and verifier outputs.',
    inputPorts: [
      port('text', 'text', { description: 'Generated text to commit.' }),
      port('verifier', 'verifier_result', { description: 'Verifier result that may affect the decision.' }),
      port('outputs', 'json', { description: 'Additional output payloads to include in the decision.' }),
    ],
    outputPorts: [
      port('decision', 'json', { description: 'Commit decision payload.' }),
      port('diagnostics', 'diagnostics', { description: 'Commit gate diagnostics.' }),
    ],
    supportedPhases: COMMIT_PHASES,
    previewPolicy: 'manual',
    sideEffects: 'none',
    knowledge: {
      category: 'output',
      summary: 'Decides whether generated text and related outputs can be committed.',
      usage: 'Use this as the final decision point for response text, verifier results, and output payloads.',
      config: {
        mode: 'object',
        fields: [
          { path: 'mode', label: 'Mode', type: 'enum', description: 'Optional commit decision mode.', enumValues: ['allow', 'warn', 'block_on_error'] },
          { path: 'requireVerifierPass', label: 'Require verifier pass', type: 'boolean', description: 'Whether verifier failure should block the commit decision.' },
        ],
      },
      examples: [{ title: 'Commit generated text', node: { type: 'output.commit_gate', typeVersion: '1', phase: 'commit' } }],
      pitfalls: ['A commit gate does not run verifiers by itself. Connect verifier nodes when verifier decisions matter.'],
      relatedNodeTypes: ['narration.narrator', 'verify.continuity', 'verify.player_agency_postcheck'],
    },
  }),
  define({
    type: 'output.graph_run_summary',
    typeVersion: '1',
    title: 'Graph Run Summary',
    description: 'Builds a structured summary of a graph run.',
    inputPorts: [port('result', 'json', { description: 'Result payload to summarize.' })],
    outputPorts: [
      port('summary', 'json', { description: 'Structured run summary.' }),
      port('diagnostics', 'diagnostics', { description: 'Summary diagnostics.' }),
    ],
    supportedPhases: COMMIT_PHASES,
    previewPolicy: 'auto',
    sideEffects: 'none',
    knowledge: {
      category: 'output',
      summary: 'Produces a structured summary for a NodeGraph run.',
      usage: 'Use this when downstream UI or logs need a compact run summary.',
      config: { mode: 'none' },
      pitfalls: ['This node summarizes provided result data. It does not persist records by itself.'],
      relatedNodeTypes: ['output.commit_gate'],
    },
  }),
  define({
    type: 'output.derived_output',
    typeVersion: '1',
    title: 'Derived Output',
    description: 'Writes a derived output record from a JSON value.',
    inputPorts: [port('value', 'json', { description: 'Value to persist as a derived output record.' })],
    outputPorts: [
      port('record', 'json', { description: 'Created derived output record.' }),
      port('diagnostics', 'diagnostics', { description: 'Write diagnostics.' }),
    ],
    supportedPhases: COMMIT_PHASES,
    previewPolicy: 'manual',
    permissionsRequired: ['project.derived_output.write'],
    sideEffects: 'write',
    knowledge: {
      category: 'output',
      summary: 'Persists a JSON value as a derived project output.',
      usage: 'Use this when an Agent or graph result should be saved as a project-level derived record.',
      config: { mode: 'none' },
      pitfalls: ['Requires project.derived_output.write and graph policy allowPersistentOutputs=true for persistent outputs.'],
      relatedNodeTypes: ['agent.call', 'output.project_inbox'],
    },
  }),
  define({
    type: 'output.project_inbox',
    typeVersion: '1',
    title: 'Project Inbox',
    description: 'Writes a payload into the project inbox for later review.',
    inputPorts: [port('payload', 'json', { description: 'Inbox payload to create.' })],
    outputPorts: [
      port('record', 'json', { description: 'Created inbox record.' }),
      port('diagnostics', 'diagnostics', { description: 'Write diagnostics.' }),
    ],
    supportedPhases: COMMIT_PHASES,
    previewPolicy: 'manual',
    permissionsRequired: ['project.inbox.write'],
    sideEffects: 'write',
    knowledge: {
      category: 'output',
      summary: 'Sends a structured payload to the project inbox.',
      usage: 'Use this for Agent proposals, review tasks, and graph outputs that need human approval.',
      config: { mode: 'none' },
      pitfalls: ['Requires project.inbox.write and may require allowPersistentOutputs=true.'],
      relatedNodeTypes: ['agent.call', 'output.derived_output'],
    },
  }),
  define({
    type: 'output.session_state_proposal',
    typeVersion: '1',
    title: 'Session State Proposal',
    description: 'Emits a proposal for session state changes.',
    inputPorts: [port('proposal', 'json', { description: 'Session state change proposal.' })],
    outputPorts: [
      port('proposal', 'json', { description: 'Normalized proposal payload.' }),
      port('diagnostics', 'diagnostics', { description: 'Proposal diagnostics.' }),
    ],
    supportedPhases: COMMIT_PHASES,
    previewPolicy: 'manual',
    permissionsRequired: ['session.state.write'],
    sideEffects: 'write',
    knowledge: {
      category: 'output',
      summary: 'Produces a session state write proposal.',
      usage: 'Use this when a graph should suggest state changes without mixing state writes into prompt generation.',
      config: { mode: 'none' },
      pitfalls: ['Requires session.state.write. The proposal still needs the appropriate runtime handling to become an actual state change.'],
      relatedNodeTypes: ['source.session_state', 'agent.call'],
    },
  }),
  define({
    type: 'group.input',
    typeVersion: '1',
    title: 'Group Input',
    description: 'Declares an input boundary for a reusable group or subgraph.',
    inputPorts: [],
    outputPorts: [port('value', 'json', { description: 'Value entering the group boundary.' })],
    supportedPhases: ALL_PHASES,
    previewPolicy: 'auto',
    sideEffects: 'none',
    knowledge: {
      category: 'group',
      summary: 'Defines an input boundary for a subgraph.',
      usage: 'Use this inside reusable subgraphs to expose values to the containing graph.',
      config: { mode: 'none' },
      pitfalls: ['This node is mainly meaningful inside a subgraph boundary.'],
      relatedNodeTypes: ['group.output', 'group.node'],
    },
  }),
  define({
    type: 'group.output',
    typeVersion: '1',
    title: 'Group Output',
    description: 'Declares an output boundary for a reusable group or subgraph.',
    inputPorts: [port('value', 'json', { description: 'Value leaving the group boundary.' })],
    outputPorts: [port('value', 'json', { description: 'Value exposed to the containing graph.' })],
    supportedPhases: ALL_PHASES,
    previewPolicy: 'auto',
    sideEffects: 'none',
    knowledge: {
      category: 'group',
      summary: 'Defines an output boundary for a subgraph.',
      usage: 'Use this inside reusable subgraphs to expose computed values to the containing graph.',
      config: { mode: 'none' },
      pitfalls: ['This node is mainly meaningful inside a subgraph boundary.'],
      relatedNodeTypes: ['group.input', 'group.node'],
    },
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
    knowledge: {
      category: 'group',
      summary: 'Instantiates a reusable subgraph as one node.',
      usage: 'Use this when a repeated graph segment should be edited and reused as a subgraph. Its ports are read from config.interface.',
      config: {
        mode: 'object',
        fields: [
          { path: 'ref.graphId', label: 'Graph id', type: 'string', required: true, description: 'Referenced graph definition id.' },
          { path: 'ref.versionId', label: 'Version id', type: 'string', description: 'Optional referenced graph version id.' },
          { path: 'interface.inputs', label: 'Inputs', type: 'array', description: 'Cached input boundary ports.' },
          { path: 'interface.outputs', label: 'Outputs', type: 'array', description: 'Cached output boundary ports.' },
        ],
      },
      examples: [{ title: 'Reference a subgraph', node: { type: 'group.node', typeVersion: '1', phase: 'pre_response', config: { ref: { graphId: 'ngraph_subgraph' }, interface: { inputs: [], outputs: [] } } } }],
      pitfalls: ['Ports are dynamic. Keep config.interface in sync with the referenced subgraph boundary.'],
      relatedNodeTypes: ['group.input', 'group.output'],
    },
  }),
  // NG2-1：编辑辅助注释节点。无端口、无副作用、禁用 preview；运行器会跳过它。
  define({
    type: NODE_GRAPH_ANNOTATION_COMMENT_TYPE,
    typeVersion: '1',
    title: 'Comment',
    description: 'Editor-only annotation. It is ignored by NodeGraph runtime and never affects PromptIR.',
    inputPorts: [],
    outputPorts: [],
    supportedPhases: ALL_PHASES,
    previewPolicy: 'disabled',
    sideEffects: 'none',
    knowledge: {
      category: 'annotation',
      summary: 'Adds an editor-only note on the canvas.',
      usage: 'Use this to explain graph sections, TODOs, or design intent for humans and Agents reading the graph.',
      config: {
        mode: 'object',
        defaultConfig: DEFAULT_ANNOTATION_COMMENT_CONFIG,
        fields: [{ path: 'content', label: 'Content', type: 'string', description: 'Annotation text shown on the canvas.' }],
      },
      pitfalls: ['This node is never executed and does not affect PromptIR, validation result, or compat output.'],
      relatedNodeTypes: ['group.node'],
    },
  }),
  // NG2-CORE：控制流节点最小集合（schemaVersion >= 2 才放行 control edge）。
  define({
    type: 'control.condition',
    typeVersion: '1',
    title: 'Condition',
    description: 'Evaluates a structured condition and outputs a boolean result.',
    inputPorts: [port('value', 'json', { multiple: true, description: 'Values available to the condition expression.' })],
    outputPorts: [port('result', 'boolean', { description: 'Boolean condition result.' })],
    supportedPhases: ALL_PHASES,
    previewPolicy: 'auto',
    sideEffects: 'none',
    knowledge: {
      category: 'control',
      summary: 'Evaluates a safe structured condition and outputs true or false.',
      usage: 'Use this when several downstream control nodes should reuse the same condition result.',
      config: {
        mode: 'object',
        defaultConfig: DEFAULT_CONTROL_CONDITION_CONFIG,
        fields: [{ path: 'condition', label: 'Condition', type: 'object', required: true, description: 'Structured condition expression. It is data, not executable code.' }],
      },
      examples: [{ title: 'Check runtime intent', node: { type: 'control.condition', typeVersion: '1', phase: 'pre_response', config: DEFAULT_CONTROL_CONDITION_CONFIG } }],
      pitfalls: ['Control nodes require schemaVersion 2 when connected with control edges.', 'The condition language is structured and cannot execute arbitrary code.'],
      relatedNodeTypes: ['control.branch', 'control.gate'],
    },
  }),
  define({
    type: 'control.branch',
    typeVersion: '1',
    title: 'Branch',
    description: 'Routes control flow on its true / false control ports based on a boolean.',
    inputPorts: [port('condition', 'boolean', { description: 'Boolean condition used to choose the branch.' })],
    outputPorts: [
      port('true', 'boolean', { description: 'Activated when the condition is true.' }),
      port('false', 'boolean', { description: 'Activated when the condition is false.' }),
    ],
    supportedPhases: ALL_PHASES,
    previewPolicy: 'auto',
    sideEffects: 'none',
    knowledge: {
      category: 'control',
      summary: 'Splits control flow into true and false branches.',
      usage: 'Use this when only one of two downstream paths should run.',
      config: {
        mode: 'object',
        defaultConfig: DEFAULT_CONTROL_CONDITION_CONFIG,
        fields: [{ path: 'condition', label: 'Inline condition', type: 'object', description: 'Optional structured condition. If omitted, the condition input port is used.' }],
      },
      examples: [{ title: 'Inline branch condition', node: { type: 'control.branch', typeVersion: '1', phase: 'pre_response', config: DEFAULT_CONTROL_CONDITION_CONFIG } }],
      pitfalls: ['If no inline condition is configured, connect the condition input port.'],
      relatedNodeTypes: ['control.condition', 'control.gate'],
    },
  }),
  define({
    type: 'control.gate',
    typeVersion: '1',
    title: 'Gate',
    description: 'Gates downstream nodes through its open control port, with an onSkip behavior.',
    inputPorts: [
      port('condition', 'boolean', { description: 'Boolean condition that opens or closes the gate.' }),
      port('value', 'json', { multiple: true, description: 'Values passed through when the gate is open.' }),
    ],
    outputPorts: [
      port('open', 'boolean', { description: 'Control output activated when the gate is open.' }),
      port('value', 'json', { description: 'Passed-through value output.' }),
    ],
    supportedPhases: ALL_PHASES,
    previewPolicy: 'auto',
    sideEffects: 'none',
    knowledge: {
      category: 'control',
      summary: 'Allows or skips downstream work based on a condition.',
      usage: 'Use this when a downstream node should run only when a condition passes, while also defining skip behavior.',
      config: {
        mode: 'object',
        defaultConfig: DEFAULT_CONTROL_GATE_CONFIG,
        fields: [
          { path: 'condition', label: 'Condition', type: 'object', description: 'Optional structured condition. If omitted, the condition input port is used.' },
          { path: 'onSkip', label: 'On skip', type: 'enum', required: true, description: 'How skipped downstream output should be handled.', enumValues: ['empty_output', 'use_cached', 'use_default', 'error'], defaultValue: 'empty_output' },
        ],
      },
      examples: [{ title: 'Gate by runtime intent', node: { type: 'control.gate', typeVersion: '1', phase: 'pre_response', config: DEFAULT_CONTROL_GATE_CONFIG } }],
      pitfalls: ['If the gate has no condition input and no inline condition, it cannot make a useful decision.'],
      relatedNodeTypes: ['control.condition', 'control.branch'],
    },
  }),
];

export function createDefaultNodeTypeRegistry(): NodeTypeRegistry {
  const registry = new NodeTypeRegistry();
  for (const entry of NODE_GRAPH_BUILTIN_NODE_TYPES) {
    registry.register(entry);
  }
  return registry;
}
