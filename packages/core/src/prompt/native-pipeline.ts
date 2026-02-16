import type { ChatMessage, ChatRole, IRMessage, IRSection, PromptIR, TokenCounter } from './types.js';
import { TemplateEngine } from './template-engine.js';

export type NativePromptMode = 'compat_strict' | 'native';

export interface NativeWorldbookEntry {
  id: string;
  content: string;
  position?: 'before' | 'after';
  role?: ChatRole;
}

export interface NativePipelineInput {
  systemPrompt: string;
  chatHistory: ChatMessage[];
  worldbookEntries?: NativeWorldbookEntry[];
  variables?: Record<string, string>;
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

function renderWithVariables(
  templateEngine: TemplateEngine,
  text: string,
  variables: Record<string, string>
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
      pinned: false,
      messages: chatMessages,
    });

    return {
      ...state,
      sections,
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

    for (const entry of entries) {
      const rendered = renderWithVariables(templateEngine, entry.content, variables).trim();
      if (rendered.length === 0) {
        continue;
      }

      const target = entry.position === 'after' ? afterMessages : beforeMessages;
      target.push({
        role: entry.role ?? 'system',
        content: rendered,
        source: `native:worldbook:${entry.id}`,
        prunable: false,
      });
    }

    const sections = [...state.sections];

    if (beforeMessages.length > 0) {
      sections.push({
        name: 'worldbookBefore',
        order: 1,
        pinned: true,
        messages: beforeMessages,
      });
    }

    if (afterMessages.length > 0) {
      sections.push({
        name: 'worldbookAfter',
        order: 3,
        pinned: true,
        messages: afterMessages,
      });
    }

    return {
      ...state,
      sections,
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
    const sections = state.sections.filter((section) => section.name !== 'memorySummary');

    sections.push({
      name: 'memorySummary',
      order,
      pinned: true,
      messages: [{
        role: 'system',
        content: `[Memory Summary]\n${summary}`,
        source: 'native:memory',
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
