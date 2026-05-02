// ── ToolExecutor ──────────────────────────────────────

import { randomUUID } from 'node:crypto';
import { jsonSchema } from 'ai';
import type { JSONSchema7, Schema } from 'ai';

import type { CoreEventBus } from '../events/event-bus.js';
import type { ToolExecutionRepository } from '../ports/tool-execution-repository.js';
import type { InstanceSlot, LLMToolDefinition } from '../llm/types.js';
import type {
  ExecutedToolCallRecord,
  BufferedToolVariableMutation,
  PendingToolJobRequest,
  ToolCallResult,
  ToolDefinition,
  ToolDenyReason,
  ToolExecutionDeliveryMode,
  ToolExecutionContext,
  ToolExecutionOpenRecord,
  ToolExecutionProviderType,
  ToolExecutionStatus,
  ToolResultVisibility,
  StructuredToolExecutionOutcome,
  ToolAsyncReceipt,
  ToolAsyncCapability,
  ToolPermissions,
  ToolSideEffectLevel,
} from './types.js';
import type { ToolRegistry } from './tool-registry.js';
import { ToolMutationBuffer } from './tool-mutation-buffer.js';

/** Vercel AI SDK 兼容的工具定义格式 */
export interface LLMToolEntry extends LLMToolDefinition {
  description: string;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
  inputSchema: Schema<unknown>;
}

type FinalToolExecutionStatus = Exclude<ToolExecutionStatus, 'running' | 'queued'>;
type FinalStructuredToolExecutionOutcome = StructuredToolExecutionOutcome & { executionStatus: FinalToolExecutionStatus };
type FailedToolExecutionStatus = Extract<FinalToolExecutionStatus, 'error' | 'timeout' | 'uncertain' | 'blocked'>;
type FailedStructuredToolExecutionOutcome = StructuredToolExecutionOutcome & { executionStatus: FailedToolExecutionStatus };

const FINAL_TOOL_EXECUTION_STATUSES = new Set<FinalToolExecutionStatus>([
  'success',
  'error',
  'denied',
  'timeout',
  'uncertain',
  'blocked',
]);

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

function isFinalToolExecutionStatus(value: unknown): value is FinalToolExecutionStatus {
  return typeof value === 'string' && FINAL_TOOL_EXECUTION_STATUSES.has(value as FinalToolExecutionStatus);
}

function resolveAsyncCapability(tool: ToolDefinition): ToolAsyncCapability {
  return tool.asyncCapability ?? 'inline_only';
}

function resolveDeliveryMode(tool: ToolDefinition): ToolExecutionDeliveryMode {
  return tool.defaultDeliveryMode ?? 'inline';
}

function resolveResultVisibility(tool: ToolDefinition): ToolResultVisibility {
  return tool.resultVisibility ?? 'immediate';
}

function shouldDispatchDeferred(tool: ToolDefinition): boolean {
  return tool.sideEffectLevel === 'irreversible'
    && resolveAsyncCapability(tool) === 'deferred_ok'
    && resolveDeliveryMode(tool) === 'async_job'
    && resolveResultVisibility(tool) === 'deferred_receipt';
}

function buildPlannedToolRuntimeJobId(executionId: string): string {
  return `tool-job:${executionId}`;
}

function buildDeferredReceipt(args: {
  executionId: string;
  jobId: string;
  toolName: string;
}): ToolAsyncReceipt {
  return {
    accepted: true,
    delivery_mode: 'async_job',
    execution_id: args.executionId,
    job_id: args.jobId,
    status: 'queued',
    message: `Tool '${args.toolName}' was accepted for deferred execution. This turn only receives an acceptance receipt; the final provider result is not available inline.`,
  };
}

function inferLegacyErrorStatus(
  value: { error?: string } | Error,
  fallback: FinalToolExecutionStatus = 'error',
): FinalToolExecutionStatus {
  const message = value instanceof Error ? value.message : value.error;
  if (typeof message === 'string') {
    const normalizedMessage = message.toLowerCase();

    if (normalizedMessage.includes('execution outcome is uncertain')) {
      return 'uncertain';
    }

    if (normalizedMessage.includes('timeout')) {
      return 'timeout';
    }
  }

  return fallback;
}

function resolveStructuredErrorOutcome(
  value: ({ error?: string } & Partial<StructuredToolExecutionOutcome>) | Error,
  fallback: FinalToolExecutionStatus = 'error',
): FinalStructuredToolExecutionOutcome {
  if (!(value instanceof Error) && isFinalToolExecutionStatus(value.executionStatus)) {
    const providerMessage = value.providerMessage ?? value.error;
    return {
      executionStatus: value.executionStatus,
      ...(value.executionReasonCode ? { executionReasonCode: value.executionReasonCode } : {}),
      ...(value.reconnectRequired !== undefined ? { reconnectRequired: value.reconnectRequired } : {}),
      ...(value.retryable !== undefined ? { retryable: value.retryable } : {}),
      ...(providerMessage ? { providerMessage } : {}),
    };
  }

  const providerMessage = value instanceof Error ? value.message : value.providerMessage ?? value.error;
  return {
    executionStatus: inferLegacyErrorStatus(value, fallback),
    ...(providerMessage ? { providerMessage } : {}),
  };
}

function normalizeFailureOutcome(outcome: FinalStructuredToolExecutionOutcome): FailedStructuredToolExecutionOutcome {
  if (outcome.executionStatus === 'success' || outcome.executionStatus === 'denied') {
    return {
      ...outcome,
      executionStatus: 'error',
    };
  }

  return {
    ...outcome,
    executionStatus: outcome.executionStatus as FailedToolExecutionStatus,
  };
}

function buildStructuredToolErrorResult(error: string, outcome: StructuredToolExecutionOutcome): ToolCallResult {
  return {
    error,
    executionStatus: outcome.executionStatus,
    ...(outcome.executionReasonCode ? { executionReasonCode: outcome.executionReasonCode } : {}),
    ...(outcome.reconnectRequired !== undefined ? { reconnectRequired: outcome.reconnectRequired } : {}),
    ...(outcome.retryable !== undefined ? { retryable: outcome.retryable } : {}),
    ...(outcome.providerMessage && outcome.providerMessage !== error ? { providerMessage: outcome.providerMessage } : {}),
  };
}

function toStructuredToolErrorPayload(error: string, outcome: StructuredToolExecutionOutcome): Record<string, unknown> {
  return {
    error,
    executionStatus: outcome.executionStatus,
    ...(outcome.executionReasonCode ? { executionReasonCode: outcome.executionReasonCode } : {}),
    ...(outcome.reconnectRequired !== undefined ? { reconnectRequired: outcome.reconnectRequired } : {}),
    ...(outcome.retryable !== undefined ? { retryable: outcome.retryable } : {}),
    ...(outcome.providerMessage && outcome.providerMessage !== error ? { providerMessage: outcome.providerMessage } : {}),
  };
}

/**
 * 工具执行器
 *
 * 负责权限检查、执行、事件发射。
 * 不关心调用模式（inline / standalone），只负责「执行一次工具调用」。
 *
 * 同时，它会为当前回合累计真实执行记录，供上层读取快照；
 * 若提供了 ToolExecutionRepository，则会在执行期间直接写入 open / finish 生命周期日志。
 */
export class ToolExecutor {
  /** 当前回合已完成并计入上限的工具调用计数 */
  private turnCallCount = 0;

  /** 当前回合已预留但尚未完成的调用槽位数 */
  private inFlightTurnCallCount = 0;

  /** 当前回合的真实执行记录 */
  private executionRecords: ExecutedToolCallRecord[] = [];

  /** 当前回合的运行 ID */
  private runId: string;

  /** 当前回合的工具执行序号 */
  private executionAttemptCount = 0;

  /** 当前生成尝试编号（用于隔离 verifier retry 之间的变量缓冲） */
  private generationAttemptNo = 0;

  /** 当前回合的工具变量缓冲区 */
  private mutationBuffer: ToolMutationBuffer;

  /** 当前回合已受理、但尚未 durable enqueue 的异步工具请求 */
  private pendingToolJobs: PendingToolJobRequest[] = [];

  constructor(
    private registry: ToolRegistry,
    private eventBus: CoreEventBus,
    private readonly executionRepository?: ToolExecutionRepository,
    initialRunId?: string,
  ) {
    this.runId = initialRunId ?? randomUUID();
    this.mutationBuffer = new ToolMutationBuffer(this.runId);
  }

  /**
   * 执行一次工具调用。
   *
   * 流程：
   * 1. 查找工具定义和 provider
   * 2. 权限检查
   * 3. 在 provider 执行前打开 execution journal
   * 4. 发射 tool.call_started 事件
   * 5. 调用 provider.executeTool
   * 6. 成功 / 失败 / 拒绝后补全 execution journal
   */
  async execute(
    toolName: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext,
    permissions: ToolPermissions,
  ): Promise<ToolCallResult & { denied?: ToolDenyReason }> {
    let providerId = 'unknown';
    let providerType: ToolExecutionProviderType = 'unknown';
    let sideEffectLevel: ToolSideEffectLevel | undefined;

    // 总开关检查
    if (!permissions.enabled) {
      return this.deny(toolName, args, context, 'disabled', providerId, providerType, sideEffectLevel);
    }

    // 查找工具定义
    const toolDef = await this.registry.getTool(toolName);
    if (!toolDef) {
      return this.deny(toolName, args, context, 'tool_not_found', providerId, providerType, sideEffectLevel);
    }
    sideEffectLevel = toolDef.sideEffectLevel;

    // 查找 provider
    const provider = await this.registry.findProviderForTool(toolName);
    if (!provider) {
      providerType = toolDef.source;
      return this.deny(toolName, args, context, 'tool_not_found', providerId, providerType, sideEffectLevel);
    }
    providerId = provider.id;
    providerType = provider.type;

    // 权限检查
    const denyReason = this.checkPermissions(toolDef, context.callerSlot, permissions);
    if (denyReason) {
      return this.deny(toolName, args, context, denyReason, providerId, providerType, sideEffectLevel);
    }

    if (!this.reserveTurnCallSlot(permissions.maxCallsPerTurn)) {
      return this.deny(toolName, args, context, 'max_calls_exceeded', providerId, providerType, sideEffectLevel);
    }

    const deferredDispatch = shouldDispatchDeferred(toolDef);

    let providerExecutionStarted = false;
    let openedExecution: ToolExecutionOpenRecord | undefined;

    try {
      if (deferredDispatch) {
        const executionId = randomUUID();
        const jobId = buildPlannedToolRuntimeJobId(executionId);
        const receipt = buildDeferredReceipt({ executionId, jobId, toolName });
        const receiptJson = safeJsonStringify(receipt);

        openedExecution = await this.openExecutionAttempt({
          context,
          recordId: executionId,
          providerId,
          providerType,
          toolName,
          args,
          sideEffectLevel,
          status: 'queued',
          deliveryMode: 'async_job',
          resultJson: receiptJson,
        });

        this.bufferPendingToolJob({
          openRecord: openedExecution,
          context,
          providerId,
          providerType,
          toolName,
          args,
          sideEffectLevel: sideEffectLevel ?? 'irreversible',
          jobId,
          receipt,
        });

        this.recordQueuedExecution(openedExecution, receipt);
        this.finalizeTurnCallSlot(true);

        return {
          data: receipt,
          executionStatus: 'queued',
        };
      }

      openedExecution = await this.openExecutionAttempt({
        context,
        providerId,
        providerType,
        toolName,
        args,
        sideEffectLevel,
      });

      // 发射 started 事件
      await this.eventBus.emit('tool.call_started', {
        floorId: context.floorId,
        pageId: context.pageId,
        callerSlot: context.callerSlot,
        executionId: openedExecution.id,
        providerId,
        providerType,
        sideEffectLevel,
        toolName,
        args,
      });

      // 执行
      providerExecutionStarted = true;

      try {
        const providerContext = this.buildProviderExecutionContext(context);
        const result = await provider.executeTool(toolName, args, providerContext);
        const finishedAt = Date.now();
        const durationMs = finishedAt - openedExecution.startedAt;
        this.finalizeTurnCallSlot(true);

        if (result.error) {
          const failureOutcome = normalizeFailureOutcome(resolveStructuredErrorOutcome(result, 'error'));
          const error = new Error(result.error);

          await this.completeExecutionAttempt(openedExecution, {
            result: toStructuredToolErrorPayload(result.error, failureOutcome),
            status: failureOutcome.executionStatus,
            errorMessage: result.error,
            durationMs,
            finishedAt,
          });

          // 发射 failed 事件
          await this.eventBus.emit('tool.call_failed', {
            floorId: context.floorId,
            pageId: context.pageId,
            callerSlot: context.callerSlot,
            executionId: openedExecution.id,
            providerId,
            providerType,
            sideEffectLevel,
            toolName,
            status: failureOutcome.executionStatus,
            error,
            durationMs,
          });

          return buildStructuredToolErrorResult(result.error, failureOutcome);
        }

        await this.completeExecutionAttempt(openedExecution, {
          result: result.data ?? null,
          status: 'success',
          durationMs,
          finishedAt,
        });

        // 发射 completed 事件
        await this.eventBus.emit('tool.call_completed', {
          floorId: context.floorId,
          pageId: context.pageId,
          callerSlot: context.callerSlot,
          executionId: openedExecution.id,
          providerId,
          providerType,
          sideEffectLevel,
          toolName,
          result: result.data,
          status: 'success',
          durationMs,
        });

        return result;
      } catch (err) {
        const finishedAt = Date.now();
        const durationMs = finishedAt - openedExecution.startedAt;
        const error = err instanceof Error ? err : new Error(String(err));
        const failureOutcome = normalizeFailureOutcome(resolveStructuredErrorOutcome(error, 'error'));
        this.finalizeTurnCallSlot(true);

        await this.completeExecutionAttempt(openedExecution, {
          result: toStructuredToolErrorPayload(error.message, failureOutcome),
          status: failureOutcome.executionStatus,
          errorMessage: error.message,
          durationMs,
          finishedAt,
        });

        // 发射 failed 事件
        await this.eventBus.emit('tool.call_failed', {
          floorId: context.floorId,
          pageId: context.pageId,
          callerSlot: context.callerSlot,
          executionId: openedExecution.id,
          providerId,
          providerType,
          sideEffectLevel,
          toolName,
          status: failureOutcome.executionStatus,
          error,
          durationMs,
        });

        return buildStructuredToolErrorResult(error.message, failureOutcome);
      }
    } catch (err) {
      if (!providerExecutionStarted) {
        this.finalizeTurnCallSlot(false);

        if (openedExecution) {
          const error = err instanceof Error ? err : new Error(String(err));
          const finishedAt = Date.now();
          const blockedMessage = `Tool execution blocked before provider start: ${error.message}`;
          const blockedError = new Error(blockedMessage);
          const durationMs = finishedAt - openedExecution.startedAt;

          await this.completeExecutionAttempt(openedExecution, {
            result: toStructuredToolErrorPayload(blockedMessage, {
              executionStatus: 'blocked',
              providerMessage: error.message,
            }),
            status: 'blocked',
            errorMessage: blockedMessage,
            durationMs,
            finishedAt,
          });

          await this.eventBus.emit('tool.call_failed', {
            floorId: context.floorId,
            pageId: context.pageId,
            callerSlot: context.callerSlot,
            executionId: openedExecution.id,
            providerId,
            providerType,
            sideEffectLevel,
            toolName,
            status: 'blocked',
            error: blockedError,
            durationMs,
          });
        }
      }

      throw err;
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
        inputSchema: jsonSchema(def.parameters as JSONSchema7),
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
  resetTurnCounter(runId?: string): void {
    this.turnCallCount = 0;
    this.inFlightTurnCallCount = 0;
    this.executionRecords = [];
    this.executionAttemptCount = 0;
    this.generationAttemptNo = 0;
    this.runId = runId ?? randomUUID();
    this.pendingToolJobs = [];
    this.mutationBuffer = new ToolMutationBuffer(this.runId);
  }

  /** 获取当前回合已完成并计入上限的调用次数 */
  getTurnCallCount(): number {
    return this.turnCallCount;
  }

  /** 获取当前回合已收集的真实执行记录快照。 */
  getExecutionRecords(): ExecutedToolCallRecord[] {
    return this.executionRecords.map((record) => ({ ...record }));
  }

  /** 获取当前回合已收集的真实执行记录数量。 */
  getExecutionRecordCount(): number {
    return this.executionRecords.length;
  }

  /** 获取自某个索引以来新增的真实执行记录。 */
  getExecutionRecordsSince(startIndex: number): ExecutedToolCallRecord[] {
    return this.executionRecords
      .slice(Math.max(0, startIndex))
      .map((record) => ({ ...record }));
  }

  /** 开始一个新的生成尝试。 */
  beginGenerationAttempt(): number {
    this.generationAttemptNo += 1;
    return this.generationAttemptNo;
  }

  /** 丢弃某次生成尝试中的工具变量缓冲写入。 */
  discardGenerationAttempt(generationAttemptNo: number): void {
    if (generationAttemptNo < 1) {
      return;
    }

    this.mutationBuffer.discardGenerationAttempt(generationAttemptNo);
  }

  /** 读取当前生成尝试保留的工具变量缓冲快照。 */
  getBufferedVariableMutations(
    generationAttemptNo: number = this.generationAttemptNo,
  ): BufferedToolVariableMutation[] {
    if (generationAttemptNo < 1) {
      return [];
    }

    return this.mutationBuffer.snapshot(generationAttemptNo);
  }

  /** 读取当前回合已受理、但尚未 durable enqueue 的异步工具请求。 */
  getPendingToolJobs(): PendingToolJobRequest[] {
    return this.pendingToolJobs.map((job) => ({ ...job, envelope: { ...job.envelope }, receipt: { ...job.receipt } }));
  }

  // ── 内部方法 ────────────────────────────────────────

  private getActiveGenerationAttemptNo(): number {
    if (this.generationAttemptNo < 1) {
      this.generationAttemptNo = 1;
    }

    return this.generationAttemptNo;
  }

  private buildProviderExecutionContext(context: ToolExecutionContext): ToolExecutionContext {
    const generationAttemptNo = this.getActiveGenerationAttemptNo();

    return {
      ...context,
      variableContext: {
        ...context.variableContext,
        toolMutationBuffer: this.mutationBuffer,
        toolMutationAttemptNo: generationAttemptNo,
      },
    };
  }

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

    // irreversible 检查
    if (tool.sideEffectLevel === 'irreversible' && !permissions.allowIrreversible) {
      return 'irreversible_blocked';
    }

    return null;
  }

  private reserveTurnCallSlot(maxCallsPerTurn?: number): boolean {
    if (
      maxCallsPerTurn !== undefined &&
      this.turnCallCount + this.inFlightTurnCallCount >= maxCallsPerTurn
    ) {
      return false;
    }

    this.inFlightTurnCallCount += 1;
    return true;
  }

  private finalizeTurnCallSlot(consume: boolean): void {
    if (this.inFlightTurnCallCount > 0) {
      this.inFlightTurnCallCount -= 1;
    }

    if (consume) {
      this.turnCallCount += 1;
    }
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
    providerType: ToolExecutionProviderType,
    sideEffectLevel?: ToolSideEffectLevel,
  ): Promise<ToolCallResult & { denied: ToolDenyReason }> {
    const errorMessage = `Tool call denied: ${reason}`;
    const openedExecution = await this.openExecutionAttempt({
      context,
      providerId,
      providerType,
      toolName,
      args,
      sideEffectLevel,
    });

    await this.completeExecutionAttempt(openedExecution, {
      result: { denied: reason },
      status: 'denied',
      errorMessage,
      durationMs: 0,
      finishedAt: openedExecution.startedAt,
    });

    await this.eventBus.emit('tool.call_denied', {
      floorId: context.floorId,
      pageId: context.pageId,
      callerSlot: context.callerSlot,
      executionId: openedExecution.id,
      providerId,
      providerType,
      sideEffectLevel,
      toolName,
      status: 'denied',
      reason,
    });

    return { error: errorMessage, denied: reason };
  }

  private bufferPendingToolJob(input: {
    openRecord: ToolExecutionOpenRecord;
    context: ToolExecutionContext;
    providerId: string;
    providerType: ToolExecutionProviderType;
    toolName: string;
    args: Record<string, unknown>;
    sideEffectLevel: ToolSideEffectLevel;
    jobId: string;
    receipt: ToolAsyncReceipt;
  }): PendingToolJobRequest {
    const pendingJob: PendingToolJobRequest = {
      executionId: input.openRecord.id,
      runId: input.openRecord.runId,
      jobId: input.jobId,
      envelope: {
        executionId: input.openRecord.id,
        runId: input.openRecord.runId,
        sessionId: input.context.sessionId,
        ...(input.context.accountId ? { accountId: input.context.accountId } : {}),
        ...(input.context.branchId ? { branchId: input.context.branchId } : {}),
        floorId: input.context.floorId,
        ...(input.context.pageId ? { pageId: input.context.pageId } : {}),
        callerSlot: input.context.callerSlot,
        providerId: input.providerId,
        providerType: input.providerType,
        toolName: input.toolName,
        args: { ...input.args },
        sideEffectLevel: input.sideEffectLevel,
        deliveryMode: 'async_job',
        asyncCapability: 'deferred_ok',
        resultVisibility: 'deferred_receipt',
        acceptedAt: input.openRecord.startedAt,
      },
      receipt: { ...input.receipt },
    };

    this.pendingToolJobs.push(pendingJob);
    return pendingJob;
  }

  private recordQueuedExecution(
    openRecord: ToolExecutionOpenRecord,
    receipt: ToolAsyncReceipt,
  ): ExecutedToolCallRecord {
    const queuedRecord: ExecutedToolCallRecord = {
      id: openRecord.id,
      deliveryMode: 'async_job',
      runId: openRecord.runId,
      floorId: openRecord.floorId,
      ...(openRecord.pageId ? { pageId: openRecord.pageId } : {}),
      callerSlot: openRecord.callerSlot,
      providerId: openRecord.providerId,
      providerType: openRecord.providerType,
      toolName: openRecord.toolName,
      argsJson: openRecord.argsJson,
      resultJson: openRecord.resultJson ?? safeJsonStringify(receipt),
      status: 'queued',
      lifecycleState: 'opened',
      commitOutcome: 'pending',
      ...(openRecord.sideEffectLevel ? { sideEffectLevel: openRecord.sideEffectLevel } : {}),
      durationMs: 0,
      startedAt: openRecord.startedAt,
      attemptNo: openRecord.attemptNo,
      createdAt: openRecord.createdAt,
    };

    this.executionRecords.push(queuedRecord);
    return queuedRecord;
  }

  private async openExecutionAttempt(input: {
    context: ToolExecutionContext;
    recordId?: string;
    providerId: string;
    providerType: ToolExecutionProviderType;
    toolName: string;
    args: Record<string, unknown>;
    sideEffectLevel?: ToolSideEffectLevel;
    status?: Extract<ToolExecutionStatus, 'running' | 'queued'>;
    deliveryMode?: ToolExecutionDeliveryMode;
    resultJson?: string;
    runtimeJobId?: string;
  }): Promise<ToolExecutionOpenRecord> {
    const startedAt = Date.now();
    const record: ToolExecutionOpenRecord = {
      id: input.recordId ?? randomUUID(),
      runId: this.runId,
      status: input.status ?? 'running',
      deliveryMode: input.deliveryMode ?? 'inline',
      ...(input.resultJson !== undefined ? { resultJson: input.resultJson } : {}),
      ...(input.runtimeJobId ? { runtimeJobId: input.runtimeJobId } : {}),
      floorId: input.context.floorId,
      ...(input.context.pageId ? { pageId: input.context.pageId } : {}),
      callerSlot: input.context.callerSlot,
      providerId: input.providerId,
      providerType: input.providerType,
      toolName: input.toolName,
      argsJson: safeJsonStringify(input.args),
      ...(input.sideEffectLevel ? { sideEffectLevel: input.sideEffectLevel } : {}),
      startedAt,
      createdAt: startedAt,
      attemptNo: this.nextAttemptNo(),
    };

    if (this.executionRepository) {
      await this.executionRepository.open(record);
    }

    return record;
  }

  private async completeExecutionAttempt(
    openRecord: ToolExecutionOpenRecord,
    input: {
      result: unknown;
      status: FinalToolExecutionStatus;
      errorMessage?: string;
      durationMs: number;
      finishedAt: number;
    },
  ): Promise<ExecutedToolCallRecord> {
    const completedRecord: ExecutedToolCallRecord = {
      id: openRecord.id,
      deliveryMode: openRecord.deliveryMode ?? 'inline',
      runId: openRecord.runId,
      floorId: openRecord.floorId,
      ...(openRecord.pageId ? { pageId: openRecord.pageId } : {}),
      callerSlot: openRecord.callerSlot,
      providerId: openRecord.providerId,
      providerType: openRecord.providerType,
      toolName: openRecord.toolName,
      argsJson: openRecord.argsJson,
      resultJson: safeJsonStringify(input.result),
      status: input.status,
      lifecycleState: 'finished',
      commitOutcome: 'pending',
      ...(openRecord.sideEffectLevel ? { sideEffectLevel: openRecord.sideEffectLevel } : {}),
      ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
      durationMs: normalizeDurationMs(input.durationMs),
      startedAt: openRecord.startedAt,
      finishedAt: input.finishedAt,
      ...(openRecord.runtimeJobId ? { runtimeJobId: openRecord.runtimeJobId } : {}),
      attemptNo: openRecord.attemptNo,
      ...(openRecord.replayParentExecutionId
        ? { replayParentExecutionId: openRecord.replayParentExecutionId }
        : {}),
      createdAt: openRecord.createdAt,
    };

    if (this.executionRepository) {
      await this.executionRepository.finish(openRecord.id, {
        resultJson: completedRecord.resultJson,
        status: input.status,
        lifecycleState: 'finished',
        errorMessage: completedRecord.errorMessage,
        durationMs: completedRecord.durationMs,
        finishedAt: input.finishedAt,
      });
    }

    this.executionRecords.push(completedRecord);
    return completedRecord;
  }

  private nextAttemptNo(): number {
    this.executionAttemptCount += 1;
    return this.executionAttemptCount;
  }
}
