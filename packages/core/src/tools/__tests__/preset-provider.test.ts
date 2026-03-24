import { describe, it, expect } from 'vitest';

import { PresetToolProvider, type PresetToolInput } from '../preset-provider.js';
import type { ToolExecutionContext } from '../types.js';

// ── helpers ──────────────────────────────────────────────

function makeContext(overrides?: Partial<ToolExecutionContext>): ToolExecutionContext {
  return {
    sessionId: 'session-1',
    floorId: 'floor-1',
    pageId: 'page-1',
    callerSlot: 'narrator',
    variableContext: {
      sessionId: 'session-1',
      floorId: 'floor-1',
      pageId: 'page-1',
      globalScopeId: 'global',
    },
    ...overrides,
  };
}

function makeTool(overrides?: Partial<PresetToolInput>): PresetToolInput {
  return {
    name: 'my_tool',
    description: 'A test tool',
    parameters: { type: 'object', properties: { x: { type: 'number' } } },
    sideEffectLevel: 'none',
    allowedSlots: [],
    handlerType: 'script',
    handler: { script: 'return args.x + 1' },
    ...overrides,
  };
}

// ── listTools ────────────────────────────────────────────

describe('PresetToolProvider > listTools', () => {
  it('returns converted ToolDefinition list', async () => {
    const provider = new PresetToolProvider('preset:1', [
      makeTool({ name: 'tool_a', description: 'desc A' }),
      makeTool({ name: 'tool_b', description: 'desc B' }),
    ]);

    const tools = await provider.listTools();

    expect(tools).toHaveLength(2);
    expect(tools[0]!.name).toBe('tool_a');
    expect(tools[0]!.description).toBe('desc A');
    expect(tools[0]!.source).toBe('preset');
    expect(tools[0]!.sideEffectLevel).toBe('none');
    expect(tools[1]!.name).toBe('tool_b');
  });

  it('returns empty array when no tools are provided', async () => {
    const provider = new PresetToolProvider('preset:empty', []);
    const tools = await provider.listTools();
    expect(tools).toEqual([]);
  });
});

// ── executeTool ──────────────────────────────────────────

describe('PresetToolProvider > executeTool', () => {
  const ctx = makeContext();

  // ── unknown name ────────────────────────────────────

  it('returns error for unknown tool name', async () => {
    const provider = new PresetToolProvider('preset:1', [makeTool()]);
    const result = await provider.executeTool('nonexistent', {}, ctx);
    expect(result.error).toContain('Unknown preset tool');
  });

  // ── script handler ─────────────────────────────────

  it('executes script handler and returns data', async () => {
    const provider = new PresetToolProvider('preset:1', [
      makeTool({ handler: { script: 'return args.x * 2' } }),
    ]);

    const result = await provider.executeTool('my_tool', { x: 5 }, ctx);
    expect(result.data).toBe(10);
    expect(result.error).toBeUndefined();
  });

  it('returns error when script handler is empty string', async () => {
    const provider = new PresetToolProvider('preset:1', [
      makeTool({ handler: { script: '' } }),
    ]);

    const result = await provider.executeTool('my_tool', {}, ctx);
    expect(result.error).toBe('Script handler is empty');
  });

  it('returns error when handler.script is undefined', async () => {
    const provider = new PresetToolProvider('preset:1', [
      makeTool({ handler: {} }),
    ]);

    const result = await provider.executeTool('my_tool', {}, ctx);
    expect(result.error).toBe('Script handler is empty');
  });

  it('returns error when script throws', async () => {
    const provider = new PresetToolProvider('preset:1', [
      makeTool({ handler: { script: 'throw new Error("boom")' } }),
    ]);

    const result = await provider.executeTool('my_tool', {}, ctx);
    expect(result.error).toContain('Script execution failed');
    expect(result.error).toContain('boom');
  });

  // ── prompt handler ─────────────────────────────────

  it('returns not-implemented error for prompt handler', async () => {
    const provider = new PresetToolProvider('preset:1', [
      makeTool({ handlerType: 'prompt' }),
    ]);

    const result = await provider.executeTool('my_tool', {}, ctx);
    expect(result.error).toContain('not yet implemented');
  });

  // ── delegate handler ───────────────────────────────

  it('returns not-implemented error for delegate handler', async () => {
    const provider = new PresetToolProvider('preset:1', [
      makeTool({ handlerType: 'delegate' }),
    ]);

    const result = await provider.executeTool('my_tool', {}, ctx);
    expect(result.error).toContain('not yet implemented');
  });

  // ── unknown handler type ───────────────────────────

  it('returns error for unknown handler type', async () => {
    const provider = new PresetToolProvider('preset:1', [
      makeTool({ handlerType: 'webhook' as any }),
    ]);

    const result = await provider.executeTool('my_tool', {}, ctx);
    expect(result.error).toContain('Unknown handler type');
  });
});

// ── constructor / id / type ──────────────────────────────

describe('PresetToolProvider > identity', () => {
  it('exposes correct id and type', () => {
    const provider = new PresetToolProvider('preset:abc', []);
    expect(provider.id).toBe('preset:abc');
    expect(provider.type).toBe('preset');
  });
});
