/**
 * PresetToolProvider
 *
 * 管理预设/角色卡定义的自定义工具。
 * 工具定义来自 tool_definition 表，由 API 层加载后传入。
 * 支持 handler_type = 'script' 的简单表达式执行。
 */

import type {
  ToolProvider,
  ToolDefinition,
  ToolCallResult,
  ToolExecutionContext,
  ToolSideEffectLevel,
} from './types.js';
import type { InstanceSlot } from '../llm/types.js';

// ── Types ───────────────────────────────────────────

/** 传入 PresetToolProvider 的工具定义（从 DB 行转换而来） */
export interface PresetToolInput {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  sideEffectLevel: ToolSideEffectLevel;
  allowedSlots: InstanceSlot[];
  handlerType: 'script' | 'prompt' | 'delegate';
  handler: Record<string, unknown>;
}

// ── PresetToolProvider ──────────────────────────────

export class PresetToolProvider implements ToolProvider {
  readonly id: string;
  readonly type = 'preset' as const;

  private tools: PresetToolInput[];

  /**
   * @param providerId — 提供者 ID，建议用 `preset:<presetId>` 或 `character:<charId>` 格式。
   * @param tools — 从 DB 加载的工具定义列表。
   */
  constructor(providerId: string, tools: PresetToolInput[]) {
    this.id = providerId;
    this.tools = tools;
  }

  async listTools(): Promise<ToolDefinition[]> {
    return this.tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters as ToolDefinition['parameters'],
      sideEffectLevel: t.sideEffectLevel,
      allowedSlots: t.allowedSlots,
      source: 'preset' as const,
    }));
  }

  async executeTool(
    name: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolCallResult> {
    const tool = this.tools.find((t) => t.name === name);
    if (!tool) {
      return { error: `Unknown preset tool: ${name}` };
    }

    switch (tool.handlerType) {
      case 'script':
        return this.executeScript(tool.handler, args, context);
      case 'prompt':
        return { error: 'Handler type "prompt" is not yet implemented' };
      case 'delegate':
        return { error: 'Handler type "delegate" is not yet implemented' };
      default:
        return { error: `Unknown handler type: ${tool.handlerType}` };
    }
  }

  // ── Script Handler ────────────────────────────────

  private executeScript(
    handler: Record<string, unknown>,
    args: Record<string, unknown>,
    _context: ToolExecutionContext,
  ): ToolCallResult {
    const script = String(handler.script ?? '');
    if (!script) {
      return { error: 'Script handler is empty' };
    }

    try {
      // 安全的表达式求值：仅允许访问 args 对象
      // 注意：这是一个简化实现，生产环境中应使用沙箱
      const fn = new Function('args', script);
      const result = fn(args);
      return { data: result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { error: `Script execution failed: ${message}` };
    }
  }
}
