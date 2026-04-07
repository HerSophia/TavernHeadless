/**
 * PresetToolProvider
 *
 * 管理预设/角色卡定义的自定义工具。
 * 工具定义来自 tool_definition 表，由 API 层加载后传入。
 * `script` handler 默认不执行；只有在显式受信配置下才允许启用。
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

export interface PresetToolProviderOptions {
  allowUnsafeScriptHandlerExecution?: boolean;
  disabledErrorMessage?: string;
}

const DEFAULT_SCRIPT_HANDLER_DISABLED_MESSAGE =
  'Script handler execution is disabled by default. Enable it only in a trusted environment.';

// ── PresetToolProvider ──────────────────────────────

export class PresetToolProvider implements ToolProvider {
  readonly id: string;
  readonly type = 'preset' as const;

  private tools: PresetToolInput[];
  private readonly options: PresetToolProviderOptions;

  /**
   * @param providerId — 提供者 ID，建议用 `preset:<presetId>` 或 `character:<charId>` 格式。
   * @param tools — 从 DB 加载的工具定义列表。
   */
  constructor(
    providerId: string,
    tools: PresetToolInput[],
    options: PresetToolProviderOptions = {},
  ) {
    this.id = providerId;
    this.tools = tools;
    this.options = options;
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
        if (this.options.allowUnsafeScriptHandlerExecution !== true) {
          return {
            error: this.options.disabledErrorMessage ?? DEFAULT_SCRIPT_HANDLER_DISABLED_MESSAGE,
          };
        }

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
      // 注意：这里仍然直接执行动态脚本。
      // 只有在上层显式开启受信模式时才允许走到这里。
      const fn = new Function('args', script);
      const result = fn(args);
      return { data: result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { error: `Script execution failed: ${message}` };
    }
  }
}
