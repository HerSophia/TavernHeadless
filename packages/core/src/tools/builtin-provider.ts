import type { ToolProvider, ToolDefinition, ToolCallResult, ToolExecutionContext } from './types.js';
import type { InstanceSlot } from '../llm/types.js';
import type { VariableStore } from '../variables/variable-store.js';
import type { MemoryStore } from '../memory/memory-store.js';

// ── 内置工具定义 ────────────────────────────────────────

/** 内置工具公共属性 */
const BUILTIN_COMMON = {
  allowedSlots: [] as InstanceSlot[],  // 空数组 = 所有槽位均可使用
  source: 'builtin' as const,
} satisfies Pick<ToolDefinition, 'allowedSlots' | 'source'>;

const BUILTIN_TOOLS: ToolDefinition[] = [
  {
    name: 'get_variable',
    description: 'Get the value of a variable by key. Searches across all scopes (page → floor → chat → global) and returns the highest-priority match.',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Variable key to look up' },
      },
      required: ['key'],
    },
    sideEffectLevel: 'none',
    ...BUILTIN_COMMON,
  },
  {
    name: 'set_variable',
    description: 'Set a variable value. Writes to the current page scope by default (sandbox). The change will be promoted to floor scope only when the floor is committed.',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Variable key' },
        value: { type: 'string', description: 'Value to set (stored as string)' },
      },
      required: ['key', 'value'],
    },
    sideEffectLevel: 'sandbox',
    ...BUILTIN_COMMON,
  },
  {
    name: 'roll_dice',
    description: 'Roll one or more dice and return the results. Example: sides=6, count=2 rolls two six-sided dice.',
    parameters: {
      type: 'object',
      properties: {
        sides: { type: 'number', description: 'Number of sides per die (default: 6)' },
        count: { type: 'number', description: 'Number of dice to roll (default: 1)' },
      },
    },
    sideEffectLevel: 'none',
    ...BUILTIN_COMMON,
  },
  {
    name: 'random_choice',
    description: 'Randomly pick one item from a list of options.',
    parameters: {
      type: 'object',
      properties: {
        options: {
          type: 'array',
          description: 'Array of options to choose from',
          items: { type: 'string' },
        },
      },
      required: ['options'],
    },
    sideEffectLevel: 'none',
    ...BUILTIN_COMMON,
  },
  {
    name: 'get_time',
    description: 'Get the current date and time in ISO 8601 format.',
    parameters: {
      type: 'object',
      properties: {},
    },
    sideEffectLevel: 'none',
    ...BUILTIN_COMMON,
  },
  {
    name: 'query_memory',
    description: 'Query the memory store for relevant memories. Returns matching memory items.',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Memory type filter: summary, fact, event, relationship (optional)' },
        limit: { type: 'number', description: 'Max number of results (default: 10)' },
        minImportance: { type: 'number', description: 'Minimum importance threshold 0-1 (optional)' },
      },
    },
    sideEffectLevel: 'none',
    ...BUILTIN_COMMON,
  },
  {
    name: 'get_character_info',
    description: 'Get information about a character from the current session context. Returns available character metadata.',
    parameters: {
      type: 'object',
      properties: {
        field: { type: 'string', description: 'Specific field to retrieve: name, description, personality, scenario, or "all" (default: "all")' },
      },
    },
    sideEffectLevel: 'none',
    ...BUILTIN_COMMON,
  },
];

// ── 工具执行逻辑 ────────────────────────────────────────

type ToolHandler = (
  args: Record<string, unknown>,
  context: ToolExecutionContext,
  deps: BuiltinDeps,
) => Promise<ToolCallResult>;

interface BuiltinDeps {
  variableStore?: VariableStore;
  memoryStore?: MemoryStore;
}

function isToolAvailable(name: string, deps: BuiltinDeps): boolean {
  if (name === 'get_variable' || name === 'set_variable') {
    return deps.variableStore !== undefined;
  }

  if (name === 'query_memory') {
    return deps.memoryStore !== undefined;
  }

  return true;
}

const handlers: Record<string, ToolHandler> = {
  async get_variable(args, context, deps) {
    if (!deps.variableStore) {
      return { error: 'VariableStore not available' };
    }
    const key = String(args.key ?? '');
    if (!key) return { error: 'Missing required parameter: key' };

    const value = await deps.variableStore.get(key, context.variableContext);
    return { data: { key, value: value ?? null } };
  },

  async set_variable(args, context, deps) {
    if (!deps.variableStore) {
      return { error: 'VariableStore not available' };
    }
    const key = String(args.key ?? '');
    if (!key) return { error: 'Missing required parameter: key' };

    const value = args.value ?? '';
    const entry = await deps.variableStore.set(key, value, context.variableContext);
    return { data: { key: entry.key, value: entry.value, scope: entry.scope } };
  },

  async roll_dice(args) {
    const sides = Math.max(1, Math.floor(Number(args.sides) || 6));
    const count = Math.max(1, Math.min(100, Math.floor(Number(args.count) || 1)));

    const results: number[] = [];
    for (let i = 0; i < count; i++) {
      results.push(Math.floor(Math.random() * sides) + 1);
    }

    const total = results.reduce((a, b) => a + b, 0);
    return { data: { sides, count, results, total } };
  },

  async random_choice(args) {
    const options = args.options;
    if (!Array.isArray(options) || options.length === 0) {
      return { error: 'options must be a non-empty array' };
    }
    const index = Math.floor(Math.random() * options.length);
    return { data: { chosen: options[index], index } };
  },

  async get_time() {
    const now = new Date();
    return {
      data: {
        iso: now.toISOString(),
        unix: now.getTime(),
        readable: now.toLocaleString(),
      },
    };
  },

  async query_memory(args, context, deps) {
    if (!deps.memoryStore) {
      return { error: 'MemoryStore not available' };
    }

    const limit = Math.max(1, Math.min(50, Math.floor(Number(args.limit) || 10)));
    const type = args.type as string | undefined;
    const minImportance = typeof args.minImportance === 'number' ? args.minImportance : undefined;

    const items = await deps.memoryStore.query({
      scopeId: context.sessionId,
      accountId: context.accountId,
      ...(type ? { type: type as any } : {}),
      ...(minImportance !== undefined ? { minImportance } : {}),
      limit,
      orderBy: 'importance',
      orderDir: 'desc',
    });

    return {
      data: {
        count: items.length,
        items: items.map((m) => ({
          id: m.id,
          type: m.type,
          content: m.content,
          importance: m.importance,
        })),
      },
    };
  },

  async get_character_info(args, context) {
    const field = String(args.field || 'all');
    const info: Record<string, unknown> = {
      sessionId: context.sessionId,
    };

    if (field === 'all') {
      return { data: info };
    }
    return { data: { [field]: info[field] ?? null } };
  },
};

// ── BuiltinToolProvider ─────────────────────────────────

/**
 * 内置工具提供者
 *
 * 提供引擎自带的工具集：变量读写、骰子、随机选择、
 * 时间查询、记忆查询、角色信息查询。
 *
 * @example
 * ```typescript
 * const provider = new BuiltinToolProvider({ variableStore, memoryStore });
 * registry.register(provider);
 * ```
 */
export class BuiltinToolProvider implements ToolProvider {
  readonly id = 'builtin';
  readonly type = 'builtin' as const;

  private deps: BuiltinDeps;

  constructor(deps: { variableStore?: VariableStore; memoryStore?: MemoryStore } = {}) {
    this.deps = deps;
  }

  async listTools(): Promise<ToolDefinition[]> {
    return BUILTIN_TOOLS.filter((tool) => isToolAvailable(tool.name, this.deps)).map((tool) => ({
      ...tool,
    }));
  }

  async executeTool(
    name: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolCallResult> {
    const handler = handlers[name];
    if (!handler) {
      throw new Error(`Unknown builtin tool: ${name}`);
    }
    return handler(args, context, this.deps);
  }
}
