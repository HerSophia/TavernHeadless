import type { ChatMessage, ChatRole, IRMessage, IRSection, PromptIR, TokenCounter } from './types.js';
import { TemplateEngine } from './template-engine.js';
import { PROMPT_MEMORY_MESSAGE_SOURCE, PROMPT_MEMORY_SECTION_NAME } from './runtime-registry.js';

export type NativePromptMode = 'compat_strict' | 'native';

export interface NativeWorldbookEntry {
  id: string;
  content: string;
  position?: 'before' | 'after' | 'depth';
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
  artifacts?: Record<string, unknown>;
}

export interface NativePipelineNode {
  readonly name: string;
  run(state: NativePipelineState): NativePipelineState;
}

export type ConditionNodeOptions = {
  /** Override node name used for executedNodes/debugging (default: 'condition') */
  name?: string;
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

      state = {
        ...nextState,
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

  run(state: NativePipelineState): NativePipelineState {
    const templateEngine = new TemplateEngine();
    const variables = state.input.variables ?? {};

    const sections: IRSection[] = [];

    const renderedSystem = renderWithVariables(
      templateEngine,
      state.input.systemPrompt,
      variables
    ).trim();

    if (renderedSystem.length > 0) {
      sections.push({
        name: 'nativeSystem',
        order: 0,
        pinned: true,
        budgetGroup: 'section:nativeSystem',
        messages: [{
          role: 'system',
          content: renderedSystem,
          source: 'native:system',
          prunable: false,
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
        prunable: true,
        priority: index,
      }));

    sections.push({
      name: 'chatHistory',
      order: 2,
      budgetGroup: 'history',
      pinned: false,
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

  private readonly when: (state: NativePipelineState) => boolean;
  private readonly thenNodes: NativePipelineNode[];
  private readonly elseNodes: NativePipelineNode[];
  private readonly artifactKey?: string;

  constructor(options: ConditionNodeOptions) {
    this.name = options.name ?? 'condition';
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

  run(state: NativePipelineState): NativePipelineState {
    const entries = state.input.worldbookEntries ?? [];
    if (entries.length === 0) {
      return state;
    }

    const templateEngine = new TemplateEngine();
    const variables = state.input.variables ?? {};

    const beforeMessages: IRMessage[] = [];
    const afterMessages: IRMessage[] = [];
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
          budgetGroup: 'worldbook',
          pinned: true,
          messages: [{
            role: entry.role ?? 'system',
            content: rendered,
            source: `native:worldbook:${entry.id}@depth${depth}`,
            // Phase 3 governance: worldbook registry 记为 `budget_prunable`，
            // 但当前 native pipeline 固定 pin 住世界书条目。已公开治理的裁剪策略
            // 仍由 `sourceSelection.worldbook.enabled` 与 budget allocator 的
            // 组级裁剪承担，后续若放开 IR 层级 trim，应读取 registry 的
            // governance level 决策。
            prunable: false,
          }],
        });
        continue;
      }

      const target = entry.position === 'after' ? afterMessages : beforeMessages;
      target.push({
        role: entry.role ?? 'system',
        content: rendered,
        source: `native:worldbook:${entry.id}`,
        // Phase 3 governance: worldbook registry 记为 `budget_prunable`。
        // 说明同上，首轮保持 pin 住的既有行为。
        prunable: false,
      });
    }

    const sections = [...state.sections];

    if (beforeMessages.length > 0) {
      sections.push({
        name: 'worldbookBefore',
        order: 1,
        budgetGroup: 'worldbook',
        pinned: true,
        messages: beforeMessages,
      });
    }

    if (afterMessages.length > 0) {
      sections.push({
        name: 'worldbookAfter',
        order: 3,
        budgetGroup: 'worldbook',
        pinned: true,
        messages: afterMessages,
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
  private readonly rules: CompiledTransformRule[];

  constructor(options: TransformNodeOptions) {
    this.name = options.name ?? 'transform';
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

  run(state: NativePipelineState): NativePipelineState {
    const summary = state.input.memorySummary?.trim();
    if (!summary) {
      return state;
    }

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
      budgetGroup: 'memory',
      pinned: true,
      messages: [{
        role: 'system',
        content: `[Memory Summary]\n${summary}`,
        source: PROMPT_MEMORY_MESSAGE_SOURCE,
        // Phase 3 governance: memory registry 记为 `soft_required`。首轮保留
        // `prunable: false`，对外治理依然走 `sourceSelection.memory.enabled`。
        // 后续若允许 budget 在极端压力下裁剪 memory，应改为读取
        // `resolvePromptRuntimeSourceGovernanceLevel('memory')`。
        prunable: false,
        priority: 0,
      }],
    });

    return {
      ...state,
      sections,
    };
  }
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
  let state: NativePipelineState = {
    input,
    sections: [],
    artifacts: {},
  };

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

      state = {
        ...nextState,
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

  if (state.output) {
    return state.output;
  }

  return finalizePrompt(input, state.sections);
}
export class PackMessagesNode implements NativePipelineNode {
  readonly name = 'pack_messages';

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
