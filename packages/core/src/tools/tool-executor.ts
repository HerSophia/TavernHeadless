// ── ToolExecutor ──────────────────────────────────────

import { randomUUID } from 'node:crypto';

import type { CoreEventBus } from '../events/event-bus.js';
import type { InstanceSlot } from '../llm/types.js';
import type {
  ExecutedToolCallRecord,
  ToolCallResult,
  ToolCallStatus,
  ToolDefinition,
  ToolDenyReason,
  ToolExecutionContext,
  ToolPermissions,
} from './types.js';
import type { ToolRegistry } from './tool-registry.js';

/** Vercel AI SDK 兼容的工具定义格式 */
export interface LLMToolEntry {
  description: string;
  parameters: ToolDefinition['parameters'];
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

interface ToolExecutionRecordInput {
  context: ToolExecutionContext;
  providerId: string;
  toolName: string;
  args: Record<string, unknown>;
  result: unknown;
  status: ToolCallStatus;
  errorMessage?: string;
  durationMs: number;
  createdAt: number;
}

function normalizeDurationMs(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }

  return Math.trunc(value);
}

function safeJsonStringify(value: unknown): string {
  const seen = new WeakSet<object>();

  try {
    const serialized = JSON.stringify(value, (_key, currentValue) => {
      if (typeof currentValue === 'bigint') {
        return currentValue.toString();
      }

      if (typeof currentValue === 'function') {
        return `[Function ${currentValue.name || 'anonymous'}]`;
      }

      if (typeof currentValue === 'symbol') {
        return currentValue.toString();
      }

      if (currentValue && typeof currentValue === 'object') {
        if (seen.has(currentValue)) {
          return '[Circular]';
        }

        seen.add(currentValue);
      }

      return currentValue;
    });

    return serialized ?? 'null';
  } catch {
    return JSON.stringify(String(value));
  }
}

/**
 * 工具执行器
 *
 * 负责权限检查、执行、事件发射。
 * 不关心调用模式（inline / standalone），只负责「执行一次工具调用」。
 *
 * 同时，它会为当前回合累计真实执行记录，供上层在 commit 阶段统一持久化。
 */
export class ToolExecutor {
  /** 当前回合已执行的工具调用计数 */
  private turnCallCount = 0;

  /** 当前回合的真实执行记录 */
  private executionRecords: ExecutedToolCallRecord[] = [];

  /** 当前回合的运行 ID */
  private runId = randomUUID();

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
    let providerId = 'unknown';

    // 总开关检查
    if (!permissions.enabled) {
      return this.deny(toolName, args, context, 'disabled', providerId);
    }

    // 查找工具定义
    const toolDef = await this.registry.getTool(toolName);
    if (!toolDef) {
      return this.deny(toolName, args, context, 'tool_not_found', providerId);
    }

    // 查找 provider
    const provider = await this.registry.findProviderForTool(toolName);
    if (!provider) {
      return this.deny(toolName, args, context, 'tool_not_found', providerId);
    }
    providerId = provider.id;

    // 权限检查
    const denyReason = this.checkPermissions(toolDef, context.callerSlot, permissions);
    if (denyReason) {
      return this.deny(toolName, args, context, denyReason, providerId);
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
      const completedAt = Date.now();
      const durationMs = completedAt - startTime;
      this.turnCallCount++;

      if (result.error) {
        const error = new Error(result.error);
        this.recordExecution({
          context,
          providerId,
          toolName,
          args,
          result: { error: result.error },
          status: 'error',
          errorMessage: result.error,
          durationMs,
          createdAt: completedAt,
        });

        // 发射 failed 事件
        await this.eventBus.emit('tool.call_failed', {
          floorId: context.floorId,
          pageId: context.pageId,
          callerSlot: context.callerSlot,
          toolName,
          error,
        });

        return { error: result.error };
      }

      this.recordExecution({
        context,
        providerId,
        toolName,
        args,
        result: result.data ?? null,
        status: 'success',
        durationMs,
        createdAt: completedAt,
      });

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
      const completedAt = Date.now();
      const durationMs = completedAt - startTime;
      const error = err instanceof Error ? err : new Error(String(err));
      this.turnCallCount++;

      this.recordExecution({
        context,
        providerId,
        toolName,
        args,
        result: { error: error.message },
        status: 'error',
        errorMessage: error.message,
        durationMs,
        createdAt: completedAt,
      });

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

  /** 重置每回合调用计数器和真实执行记录。在新回合开始时调用。 */
  resetTurnCounter(): void {
    this.turnCallCount = 0;
    this.executionRecords = [];
    this.runId = randomUUID();
  }

  /** 获取当前回合已执行的调用次数 */
  getTurnCallCount(): number {
    return this.turnCallCount;
  }

  /** 获取当前回合已收集的真实执行记录快照。 */
  getExecutionRecords(): ExecutedToolCallRecord[] {
    return this.executionRecords.map((record) => ({ ...record }));
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
    args: Record<string, unknown>,
    context: ToolExecutionContext,
    reason: ToolDenyReason,
    providerId: string,
  ): Promise<ToolCallResult & { denied: ToolDenyReason }> {
    const errorMessage = `Tool call denied: ${reason}`;
    const createdAt = Date.now();

    this.recordExecution({
      context,
      providerId,
      toolName,
      args,
      result: { denied: reason },
      status: 'denied',
      errorMessage,
      durationMs: 0,
      createdAt,
    });

    await this.eventBus.emit('tool.call_denied', {
      floorId: context.floorId,
      pageId: context.pageId,
      callerSlot: context.callerSlot,
      toolName,
      reason,
    });

    return { error: errorMessage, denied: reason };
  }

  private recordExecution(input: ToolExecutionRecordInput): void {
    this.executionRecords.push({
      id: randomUUID(),
      runId: this.runId,
      floorId: input.context.floorId,
      ...(input.context.pageId ? { pageId: input.context.pageId } : {}),
      callerSlot: input.context.callerSlot,
      providerId: input.providerId,
      toolName: input.toolName,
      argsJson: safeJsonStringify(input.args),
      resultJson: safeJsonStringify(input.result),
      status: input.status,
      ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
      durationMs: normalizeDurationMs(input.durationMs),
      createdAt: input.createdAt,
    });
  }
}
