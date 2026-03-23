// ── ToolExecutor ──────────────────────────────────────

import type { CoreEventBus } from '../events/event-bus.js';
import type {
  ToolDefinition,
  ToolCallResult,
  ToolExecutionContext,
  ToolPermissions,
  ToolDenyReason,
} from './types.js';
import type { ToolRegistry } from './tool-registry.js';
import type { InstanceSlot } from '../llm/types.js';

/** Vercel AI SDK 兼容的工具定义格式 */
export interface LLMToolEntry {
  description: string;
  parameters: ToolDefinition['parameters'];
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

/**
 * 工具执行器
 *
 * 负责权限检查、执行、事件发射。
 * 不关心调用模式（inline / standalone），只负责「执行一次工具调用」。
 */
export class ToolExecutor {
  /** 当前回合已执行的工具调用计数 */
  private turnCallCount = 0;

  constructor(
    private registry: ToolRegistry,
    private eventBus: CoreEventBus,
  ) {}

  /**
   * 执行一次工具调用。
   *
   * 流程：
   * 1. 查找工具定义和 provider
   * 2. 权限检查
   * 3. 发射 tool.call_started 事件
   * 4. 调用 provider.executeTool
   * 5. 成功 → tool.call_completed，失败 → tool.call_failed
   * 6. 权限拒绝 → tool.call_denied
   */
  async execute(
    toolName: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext,
    permissions: ToolPermissions,
  ): Promise<ToolCallResult & { denied?: ToolDenyReason }> {
    // 总开关检查
    if (!permissions.enabled) {
      return this.deny(toolName, args, context, 'disabled');
    }

    // 查找工具定义
    const toolDef = await this.registry.getTool(toolName);
    if (!toolDef) {
      return this.deny(toolName, args, context, 'tool_not_found');
    }

    // 查找 provider
    const provider = await this.registry.findProviderForTool(toolName);
    if (!provider) {
      return this.deny(toolName, args, context, 'tool_not_found');
    }

    // 权限检查
    const denyReason = this.checkPermissions(toolDef, context.callerSlot, permissions);
    if (denyReason) {
      return this.deny(toolName, args, context, denyReason);
    }

    // 发射 started 事件
    await this.eventBus.emit('tool.call_started', {
      floorId: context.floorId,
      pageId: context.pageId,
      callerSlot: context.callerSlot,
      toolName,
      args,
    });

    // 执行
    const startTime = Date.now();
    try {
      const result = await provider.executeTool(toolName, args, context);
      const durationMs = Date.now() - startTime;
      this.turnCallCount++;

      // 发射 completed 事件
      await this.eventBus.emit('tool.call_completed', {
        floorId: context.floorId,
        pageId: context.pageId,
        callerSlot: context.callerSlot,
        toolName,
        result: result.data,
        durationMs,
      });

      return result;
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const error = err instanceof Error ? err : new Error(String(err));

      // 发射 failed 事件
      await this.eventBus.emit('tool.call_failed', {
        floorId: context.floorId,
        pageId: context.pageId,
        callerSlot: context.callerSlot,
        toolName,
        error,
      });

      return { error: error.message };
    }
  }

  /**
   * 将 ToolDefinition[] 转为 Vercel AI SDK 兼容的 tools 对象。
   *
   * 返回 Record<string, { description, parameters, execute }>，
   * 可直接传给 generateText / streamText 的 tools 参数。
   */
  buildLLMTools(
    definitions: ToolDefinition[],
    context: ToolExecutionContext,
    permissions: ToolPermissions,
  ): Record<string, LLMToolEntry> {
    const tools: Record<string, LLMToolEntry> = {};

    for (const def of definitions) {
      tools[def.name] = {
        description: def.description,
        parameters: def.parameters,
        execute: async (args: Record<string, unknown>) => {
          const result = await this.execute(def.name, args, context, permissions);
          if (result.error) {
            // 返回错误信息让 LLM 知道调用失败
            return { error: result.error };
          }
          return result.data;
        },
      };
    }

    return tools;
  }

  /** 重置每回合调用计数器。在新回合开始时调用。 */
  resetTurnCounter(): void {
    this.turnCallCount = 0;
  }

  /** 获取当前回合已执行的调用次数 */
  getTurnCallCount(): number {
    return this.turnCallCount;
  }

  // ── 内部方法 ────────────────────────────────────────

  /**
   * 权限检查。返回 null 表示通过，否则返回拒绝原因。
   */
  private checkPermissions(
    tool: ToolDefinition,
    slot: InstanceSlot,
    permissions: ToolPermissions,
  ): ToolDenyReason | null {
    // 工具自身的 allowedSlots
    if (tool.allowedSlots.length > 0 && !tool.allowedSlots.includes(slot)) {
      return 'slot_not_allowed';
    }

    // 白名单
    const allowList = permissions.slotAllowList?.[slot];
    if (allowList && !allowList.includes(tool.name)) {
      return 'not_in_allow_list';
    }

    // 黑名单
    const denyList = permissions.slotDenyList?.[slot];
    if (denyList && denyList.includes(tool.name)) {
      return 'deny_listed';
    }

    // 调用次数上限
    if (
      permissions.maxCallsPerTurn !== undefined &&
      this.turnCallCount >= permissions.maxCallsPerTurn
    ) {
      return 'max_calls_exceeded';
    }

    // irreversible 检查
    if (tool.sideEffectLevel === 'irreversible' && !permissions.allowIrreversible) {
      return 'irreversible_blocked';
    }

    return null;
  }

  /**
   * 发射 denied 事件并返回带 denied 标记的结果。
   */
  private async deny(
    toolName: string,
    _args: Record<string, unknown>,
    context: ToolExecutionContext,
    reason: ToolDenyReason,
  ): Promise<ToolCallResult & { denied: ToolDenyReason }> {
    await this.eventBus.emit('tool.call_denied', {
      floorId: context.floorId,
      pageId: context.pageId,
      callerSlot: context.callerSlot,
      toolName,
      reason,
    });

    return { error: `Tool call denied: ${reason}`, denied: reason };
  }
}
