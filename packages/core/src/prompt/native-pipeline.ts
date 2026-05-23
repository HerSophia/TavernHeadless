import type { ChatMessage, ChatRole, IRMessage, IRSection, PromptIR, TokenCounter } from './types.js';
import { resolvePromptRuntimeGovernancePolicy } from './governance.js';
import { TemplateEngine } from './template-engine.js';
import { PROMPT_MEMORY_MESSAGE_SOURCE, PROMPT_MEMORY_SECTION_NAME } from './runtime-registry.js';

export type NativePromptMode = 'compat_strict' | 'native';
export type NativePipelinePhase = 'pre_response' | 'assemble' | 'materialize';

export interface NativeWorldbookEntry {
  id: string;
  content: string;
  position?: 'before' | 'after' | 'an_top' | 'an_bottom' | 'em_top' | 'em_bottom' | 'depth' | 'outlet';
  role?: ChatRole;
  depth?: number;
}

export interface NativePipelineInput {
  systemPrompt: string;
  chatHistory: ChatMessage[];
  worldbookEntries?: NativeWorldbookEntry[];
  variables?: Record<string, unknown>;
  memorySummary?: string;
  maxTokens: number;
  reservedForReply: number;
  tokenCounter?: TokenCounter;
}

export interface NativePipelineState {
  input: NativePipelineInput;
  sections: IRSection[];
  output?: PromptIR;
  trace: NativePipelineNodeTraceEntry[];
  outputs: Record<string, NativePipelineNodeOutput>;
  artifacts?: Record<string, unknown>;
}

export interface NativePipelineNodeStateSnapshot {
  sectionCount: number;
  sectionNames: string[];
  messageCount: number;
  executedNodes: string[];
  outputReady: boolean;
}

export interface NativePipelineNodeOutput {
  nodeName: string;
  phase: NativePipelinePhase;
  sectionCount: number;
  sectionNames: string[];
  messageCount: number;
  producedSectionNames: string[];
  outputReady: boolean;
  artifactKeys: string[];
}

export interface NativePipelineNodeTraceEntry {
  nodeName: string;
  phase: NativePipelinePhase;
  inputSummary: NativePipelineNodeStateSnapshot;
  outputSummary: NativePipelineNodeOutput;
}

export interface NativePipelineNode {
  readonly name: string;
  readonly phase?: NativePipelinePhase;
  run(state: NativePipelineState): NativePipelineState;
}

export type ConditionNodeOptions = {
  /** Override node name used for executedNodes/debugging (default: 'condition') */
  name?: string;
  /** Override node phase used for trace/output modeling (default: 'assemble') */
  phase?: NativePipelinePhase;
  /** Predicate that selects which branch to run */
  when: (state: NativePipelineState) => boolean;
  /** Nodes to run when predicate returns true */
  thenNodes?: NativePipelineNode[];
  /** Nodes to run when predicate returns false */
  elseNodes?: NativePipelineNode[];
  /** Optional: store the boolean result into state.artifacts[artifactKey] */
  artifactKey?: string;
};

export type TransformRule = {
  /** JavaScript RegExp source (without surrounding /.../) */
  pattern: string;
  /** RegExp flags (default: 'g') */
  flags?: string;
  /** Replacement string */
  replace: string;
  /** Only apply to specific roles (default: all) */
  roles?: ChatRole[];
  /** Only apply to specific section names (default: all) */
  sectionNames?: string[];
};

export type TransformNodeOptions = {
  /** Override node name used for executedNodes/debugging (default: 'transform') */
  name?: string;
  /** Override node phase used for trace/output modeling (default: 'assemble') */
  phase?: NativePipelinePhase;
  rules: TransformRule[];
};

export interface NativePipelineInputSummary {
  systemPromptLength: number;
  chatHistoryCount: number;
  worldbookEntryCount: number;
  hasVariables: boolean;
  hasMemorySummary: boolean;
  maxTokens: number;
  reservedForReply: number;
}

export interface NativePipelineStateSummary {
  sectionCount: number;
  sectionNames: string[];
  messageCount: number;
  executedNodes: string[];
  outputReady: boolean;
  traceCount: number;
  outputNodes: string[];
}

export class NativePipelineError extends Error {
  readonly nodeName: string;
  readonly inputSummary: NativePipelineInputSummary;
  readonly stateSummary: NativePipelineStateSummary;

  constructor(options: {
    nodeName: string;
    inputSummary: NativePipelineInputSummary;
    stateSummary: NativePipelineStateSummary;
    cause: unknown;
  }) {
    const detail = options.cause instanceof Error ? options.cause.message : String(options.cause);
    super(`Native pipeline node '${options.nodeName}' failed: ${detail}`, { cause: options.cause });
    this.name = 'NativePipelineError';
    this.nodeName = options.nodeName;
    this.inputSummary = options.inputSummary;
    this.stateSummary = options.stateSummary;
  }
}

function summarizeInput(input: NativePipelineInput): NativePipelineInputSummary {
  return {
    systemPromptLength: input.systemPrompt.length,
    chatHistoryCount: input.chatHistory.length,
    worldbookEntryCount: input.worldbookEntries?.length ?? 0,
    hasVariables: Object.keys(input.variables ?? {}).length > 0,
    hasMemorySummary: typeof input.memorySummary === 'string' && input.memorySummary.trim().length > 0,
    maxTokens: input.maxTokens,
    reservedForReply: input.reservedForReply,
  };
}

function getExecutedNodes(artifacts?: Record<string, unknown>): string[] {
  const value = artifacts?.executedNodes;
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string');
}

function summarizeState(state: NativePipelineState): NativePipelineStateSummary {
  return {
    sectionCount: state.sections.length,
    sectionNames: state.sections.map((section) => section.name),
    messageCount: state.sections.reduce((sum, section) => sum + section.messages.length, 0),
    executedNodes: getExecutedNodes(state.artifacts),
    outputReady: state.output !== undefined,
    traceCount: state.trace.length,
    outputNodes: Object.keys(state.outputs).sort((left, right) => left.localeCompare(right)),
  };
}

function resolveNodePhase(node: NativePipelineNode): NativePipelinePhase {
  return node.phase ?? 'assemble';
}

function summarizeNodeState(state: NativePipelineState): NativePipelineNodeStateSnapshot {
  return {
    sectionCount: state.sections.length,
    sectionNames: state.sections.map((section) => section.name),
    messageCount: state.sections.reduce((sum, section) => sum + section.messages.length, 0),
    executedNodes: getExecutedNodes(state.artifacts),
    outputReady: state.output !== undefined,
  };
}

function buildNodeOutput(
  state: NativePipelineState,
  nextState: NativePipelineState,
  node: NativePipelineNode,
): NativePipelineNodeOutput {
  const previousSectionNames = new Set(state.sections.map((section) => section.name));

  return {
    nodeName: node.name,
    phase: resolveNodePhase(node),
    sectionCount: nextState.sections.length,
    sectionNames: nextState.sections.map((section) => section.name),
    messageCount: nextState.sections.reduce((sum, section) => sum + section.messages.length, 0),
    producedSectionNames: nextState.sections
      .map((section) => section.name)
      .filter((name) => !previousSectionNames.has(name)),
    outputReady: nextState.output !== undefined,
    artifactKeys: Object.keys(nextState.artifacts ?? {}).sort((left, right) => left.localeCompare(right)),
  };
}

function runNodeSequence(
  initialState: NativePipelineState,
  nodes: NativePipelineNode[]
): NativePipelineState {
  let state = initialState;

  for (const node of nodes) {
    try {
      const nextState = node.run(state);

      if (!nextState || !nextState.input || !Array.isArray(nextState.sections)) {
        throw new Error('Node returned an invalid pipeline state');
      }

      const previousExecutedNodes = getExecutedNodes(state.artifacts);
      const nextExecutedNodes = getExecutedNodes(nextState.artifacts);
      const mergedExecutedNodes = [
        ...previousExecutedNodes,
        ...nextExecutedNodes.filter((name) => !previousExecutedNodes.includes(name)),
      ];
      const outputSummary = buildNodeOutput(state, nextState, node);
      const baseTrace = nextState.trace.length >= state.trace.length
        ? nextState.trace
        : state.trace;
      const baseOutputs = {
        ...state.outputs,
        ...nextState.outputs,
      };

      state = {
        ...nextState,
        trace: [...baseTrace, { nodeName: node.name, phase: resolveNodePhase(node), inputSummary: summarizeNodeState(state), outputSummary }],
        outputs: { ...baseOutputs, [node.name]: outputSummary },
        artifacts: {
          ...(nextState.artifacts ?? {}),
          executedNodes: [...mergedExecutedNodes, node.name],
        },
      };
    } catch (error) {
      if (error instanceof NativePipelineError) {
        throw error;
      }

      throw new NativePipelineError({
        nodeName: node.name,
        inputSummary: summarizeInput(state.input),
        stateSummary: summarizeState(state),
        cause: error,
      });
    }
  }

  return state;
}

function renderWithVariables(
  templateEngine: TemplateEngine,
  text: string,
  variables: Record<string, unknown>
): string {
  return templateEngine.render(text, new Map(Object.entries(variables)));
}

export class TemplateNode implements NativePipelineNode {
  readonly name = 'template';
  readonly phase = 'assemble' as const;

  run(state: NativePipelineState): NativePipelineState {
    const templateEngine = new TemplateEngine();
    const variables = state.input.variables ?? {};

    const sections: IRSection[] = [];

    const nativeSystemGovernance = resolvePromptRuntimeGovernancePolicy({
      sourceKind: 'native_system',
      fallback: {
        budgetGroup: 'section:nativeSystem',
        pinned: true,
        prunable: false,
      },
    });
    const historyGovernance = resolvePromptRuntimeGovernancePolicy({
      sourceKind: 'history',
      fallback: { budgetGroup: 'history', pinned: false, prunable: true },
    });
    const renderedSystem = renderWithVariables(
      templateEngine,
      state.input.systemPrompt,
      variables
    ).trim();

    if (renderedSystem.length > 0) {
      sections.push({
        name: 'nativeSystem',
        order: 0,
        pinned: nativeSystemGovernance.pinned,
        budgetGroup: nativeSystemGovernance.budgetGroup,
        messages: [{
          role: 'system',
          content: renderedSystem,
          source: 'native:system',
          prunable: nativeSystemGovernance.prunable,
          priority: 0,
        }],
      });
    }

    const chatMessages: IRMessage[] = state.input.chatHistory
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .map((message, index) => ({
        role: message.role,
        content: renderWithVariables(templateEngine, message.content, variables),
        source: `native:chat:${index}`,
        prunable: historyGovernance.prunable,
        priority: index,
      }));

    sections.push({
      name: 'chatHistory',
      order: 2,
      budgetGroup: historyGovernance.budgetGroup,
      pinned: historyGovernance.pinned,
      messages: chatMessages,
    });

    return {
      ...state,
      sections,
    };
  }
}


export class ConditionNode implements NativePipelineNode {
  readonly name: string;
  readonly phase: NativePipelinePhase;

  private readonly when: (state: NativePipelineState) => boolean;
  private readonly thenNodes: NativePipelineNode[];
  private readonly elseNodes: NativePipelineNode[];
  private readonly artifactKey?: string;

  constructor(options: ConditionNodeOptions) {
    this.name = options.name ?? 'condition';
    this.phase = options.phase ?? 'assemble';
    this.when = options.when;
    this.thenNodes = options.thenNodes ?? [];
    this.elseNodes = options.elseNodes ?? [];
    this.artifactKey = options.artifactKey;
  }

  run(state: NativePipelineState): NativePipelineState {
    const matched = this.when(state);
    const nodes = matched ? this.thenNodes : this.elseNodes;
    const nextState = nodes.length > 0 ? runNodeSequence(state, nodes) : state;

    return {
      ...nextState,
      artifacts: {
        ...(nextState.artifacts ?? {}),
        ...(this.artifactKey ? { [this.artifactKey]: matched } : {}),
      },
    };
  }
}

export class WorldbookResolveNode implements NativePipelineNode {
  readonly name = 'worldbook_resolve';
  readonly phase = 'assemble' as const;

  run(state: NativePipelineState): NativePipelineState {
    const entries = state.input.worldbookEntries ?? [];
    if (entries.length === 0) {
      return state;
    }

    const templateEngine = new TemplateEngine();
    const variables = state.input.variables ?? {};
    const worldbookGovernance = resolvePromptRuntimeGovernancePolicy({
      sourceKind: 'worldbook',
      fallback: { budgetGroup: 'worldbook', pinned: false, prunable: true },
    });

    const beforeMessages: IRMessage[] = [];
    const afterMessages: IRMessage[] = [];
    const anTopMessages: IRMessage[] = [];
    const anBottomMessages: IRMessage[] = [];
    const emTopMessages: IRMessage[] = [];
    const emBottomMessages: IRMessage[] = [];
    const depthSections: IRSection[] = [];

    for (const entry of entries) {
      const rendered = renderWithVariables(templateEngine, entry.content, variables).trim();
      if (rendered.length === 0) {
        continue;
      }

      if (entry.position === 'depth') {
        const depth = entry.depth ?? 0;
        depthSections.push({
          name: `worldbookDepth:${depth}`,
          order: 1000 + depth,
          budgetGroup: worldbookGovernance.budgetGroup,
          pinned: worldbookGovernance.pinned,
          messages: [{
            role: entry.role ?? 'system',
            content: rendered,
            source: `native:worldbook:${entry.id}@depth${depth}`,
            prunable: worldbookGovernance.prunable,
          }],
        });
        continue;
      }

      const message = {
        role: entry.role ?? 'system',
        content: rendered,
        source: `native:worldbook:${entry.id}`,
        prunable: worldbookGovernance.prunable,
      } satisfies IRMessage;

      if (entry.position === 'after') {
        afterMessages.push(message);
      } else if (entry.position === 'an_top') {
        anTopMessages.push(message);
      } else if (entry.position === 'an_bottom') {
        anBottomMessages.push(message);
      } else if (entry.position === 'em_top') {
        emTopMessages.push(message);
      } else if (entry.position === 'em_bottom') {
        emBottomMessages.push(message);
      } else {
        beforeMessages.push(message);
      }
    }

    const sections = [...state.sections];

    if (beforeMessages.length > 0) {
      sections.push({
        name: 'worldbookBefore',
        order: 1,
        budgetGroup: worldbookGovernance.budgetGroup,
        pinned: worldbookGovernance.pinned,
        messages: beforeMessages,
      });
    }

    if (afterMessages.length > 0) {
      sections.push({
        name: 'worldbookAfter',
        order: 3,
        budgetGroup: worldbookGovernance.budgetGroup,
        pinned: worldbookGovernance.pinned,
        messages: afterMessages,
      });
    }

    if (anTopMessages.length > 0) {
      sections.push({
        name: 'worldbookAuthorNoteTop',
        order: 2.1,
        budgetGroup: worldbookGovernance.budgetGroup,
        pinned: worldbookGovernance.pinned,
        messages: anTopMessages,
      });
    }

    if (anBottomMessages.length > 0) {
      sections.push({
        name: 'worldbookAuthorNoteBottom',
        order: 2.2,
        budgetGroup: worldbookGovernance.budgetGroup,
        pinned: worldbookGovernance.pinned,
        messages: anBottomMessages,
      });
    }

    if (emTopMessages.length > 0) {
      sections.push({
        name: 'worldbookExampleMessageTop',
        order: 2.3,
        budgetGroup: worldbookGovernance.budgetGroup,
        pinned: worldbookGovernance.pinned,
        messages: emTopMessages,
      });
    }

    if (emBottomMessages.length > 0) {
      sections.push({
        name: 'worldbookExampleMessageBottom',
        order: 2.4,
        budgetGroup: worldbookGovernance.budgetGroup,
        pinned: worldbookGovernance.pinned,
        messages: emBottomMessages,
      });
    }

    if (depthSections.length > 0) {
      sections.push(...depthSections);
    }

    return {
      ...state,
      sections,
    };
  }
}


type CompiledTransformRule = TransformRule & {
  regex: RegExp;
};

export class TransformNode implements NativePipelineNode {
  readonly name: string;
  readonly phase: NativePipelinePhase;
  private readonly rules: CompiledTransformRule[];

  constructor(options: TransformNodeOptions) {
    this.name = options.name ?? 'transform';
    this.phase = options.phase ?? 'assemble';
    this.rules = (options.rules ?? []).map((rule) => ({
      ...rule,
      regex: new RegExp(rule.pattern, rule.flags ?? 'g'),
    }));
  }

  run(state: NativePipelineState): NativePipelineState {
    if (this.rules.length === 0 || state.sections.length === 0) {
      return state;
    }

    const counter = state.input.tokenCounter;
    const sections = state.sections.map((section) => ({
      ...section,
      messages: section.messages.map((message) => {
        let content = message.content;

        for (const rule of this.rules) {
          if (rule.sectionNames && !rule.sectionNames.includes(section.name)) {
            continue;
          }
          if (rule.roles && !rule.roles.includes(message.role)) {
            continue;
          }

          // Clone regex to avoid shared lastIndex state across runs.
          const regex = new RegExp(rule.regex.source, rule.regex.flags);
          content = content.replace(regex, rule.replace);
        }

        if (content === message.content) {
          return message;
        }

        return {
          ...message,
          content,
          tokenCount: counter ? counter.count(content) : undefined,
        };
      }),
    }));

    return {
      ...state,
      sections,
      // If a previous node produced output, keep it in sync with sections.
      output: state.output ? finalizePrompt(state.input, sections) : state.output,
    };
  }
}

export class TokenBudgetNode implements NativePipelineNode {
  readonly name = 'token_budget';
  readonly phase = 'materialize' as const;

  run(state: NativePipelineState): NativePipelineState {
    const counter = state.input.tokenCounter;
    if (!counter) {
      return state;
    }

    return {
      ...state,
      sections: state.sections.map((section) => ({
        ...section,
        messages: section.messages.map((message) => ({
          ...message,
          tokenCount: message.tokenCount ?? counter.count(message.content),
        })),
      })),
    };
  }
}

export class MemoryInjectNode implements NativePipelineNode {
  readonly name = 'memory_inject';
  readonly phase = 'pre_response' as const;

  run(state: NativePipelineState): NativePipelineState {
    const summary = state.input.memorySummary?.trim();
    if (!summary) {
      return state;
    }
    const memoryGovernance = resolvePromptRuntimeGovernancePolicy({
      sourceKind: 'memory',
      fallback: { budgetGroup: 'memory', pinned: false, prunable: false },
    });

    const firstSystemOrder = state.sections
      .filter((section) => section.messages.some((message) => message.role === 'system'))
      .map((section) => section.order)
      .sort((a, b) => a - b)[0];

    const order = firstSystemOrder !== undefined ? firstSystemOrder + 0.5 : -1;
    const sections = state.sections.filter(
      (section) => section.name !== PROMPT_MEMORY_SECTION_NAME && section.name !== 'memorySummary',
    );

    sections.push({
      name: PROMPT_MEMORY_SECTION_NAME,
      order,
      budgetGroup: memoryGovernance.budgetGroup,
      pinned: memoryGovernance.pinned,
      messages: [{
        role: 'system',
        content: `[Memory Summary]\n${summary}`,
        source: PROMPT_MEMORY_MESSAGE_SOURCE,
        prunable: memoryGovernance.prunable,
        priority: 0,
      }],
    });

    return {
      ...state,
      sections,
    };
  }
}

export function runNativePipeline(
  input: NativePipelineInput,
  nodes: NativePipelineNode[] = [
    new TemplateNode(),
    new WorldbookResolveNode(),
    new MemoryInjectNode(),
    new TokenBudgetNode(),
    new PackMessagesNode(),
  ]
): NativePipelineState {
  const state = runNodeSequence({
    input,
    sections: [],
    trace: [],
    outputs: {},
    artifacts: {},
  }, nodes);

  return state.output ? state : { ...state, output: finalizePrompt(input, state.sections) };
}

export function assembleNativePrompt(
  input: NativePipelineInput,
  nodes: NativePipelineNode[] = [
    new TemplateNode(),
    new WorldbookResolveNode(),
    new MemoryInjectNode(),
    new TokenBudgetNode(),
    new PackMessagesNode(),
  ]
): PromptIR {
  return runNativePipeline(input, nodes).output ?? finalizePrompt(input, []);
}
export class PackMessagesNode implements NativePipelineNode {
  readonly name = 'pack_messages';
  readonly phase = 'materialize' as const;

  run(state: NativePipelineState): NativePipelineState {
    const sections = [...state.sections]
      .map((section) => ({
        ...section,
        messages: section.messages.filter((message) => message.content.trim().length > 0),
      }))
      .filter((section) => section.messages.length > 0)
      .sort((a, b) => a.order - b.order);

    return {
      ...state,
      sections,
      output: finalizePrompt(state.input, sections),
      artifacts: {
        ...state.artifacts,
        packedMessageCount: sections.reduce((sum, section) => sum + section.messages.length, 0),
      },
    };
  }
}

function finalizePrompt(input: NativePipelineInput, sections: IRSection[]): PromptIR {
  return {
    sections,
    metadata: {
      maxTokens: input.maxTokens,
      reservedForReply: input.reservedForReply,
      tokenizer: input.tokenCounter?.name,
    },
  };
}
