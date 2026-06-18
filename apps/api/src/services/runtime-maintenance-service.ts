import type { AppDb } from "../db/client.js";

import { GOVERNANCE_OPERATION_ACTIONS } from "./governance/operation-log-names.js";
import { NodeGraphRunRetentionService } from "./node-graph-run-retention-service.js";
import { OperationLogService } from "./operation-log-service.js";
import { PromptRuntimeInjectionService } from "./prompt-runtime/injection-service.js";
import { TemporaryConversationRetentionService } from "./temporary-conversation-retention-service.js";

export interface RuntimeMaintenanceRunOptions {
  now?: number;
  promptRuntimeInjection?: {
    enabled?: boolean;
  };
  temporaryConversation?: {
    enabled?: boolean;
    retentionGraceMs?: number;
    expireLimit?: number;
    cleanupLimit?: number;
  };
  nodeGraphRun?: {
    enabled?: boolean;
    retentionGraceMs?: number;
    cleanupLimit?: number;
  };
  operationLog?: {
    accountId: string;
    actorType?: string;
    actorId?: string | null;
    requestId?: string | null;
    operationGroupId?: string | null;
    sourceType?: string;
  };
}

export interface RuntimeMaintenanceRunResult {
  now: number;
  promptRuntimeInjection: {
    expiredDeleted: number;
  };
  temporaryConversation: {
    expired: number;
    cleaned: number;
    deletedMessages: number;
  };
  nodeGraphRun: {
    cleaned: number;
    redactedNodeRuns: number;
  };
  durationMs: number;
}

/**
 * Batch 8 runtime maintenance service.
 *
 * Runs the generic periodic cleanup passes:
 * - Prompt Runtime Injection expiry (I4).
 * - Temporary Conversation retention: TTL expiry sweep plus terminal body
 *   cleanup (T4).
 *
 * Return values only contain summary counts, never deleted content bodies.
 */
export class RuntimeMaintenanceService {
  constructor(private readonly db: AppDb) {}

  run(options: RuntimeMaintenanceRunOptions = {}): RuntimeMaintenanceRunResult {
    const startedAt = Date.now();
    const now = options.now ?? Date.now();
    const promptRuntimeInjectionEnabled = options.promptRuntimeInjection?.enabled !== false;
    const temporaryConversationEnabled = options.temporaryConversation?.enabled !== false;
    let expiredDeleted = 0;

    if (promptRuntimeInjectionEnabled) {
      expiredDeleted = new PromptRuntimeInjectionService(this.db).deleteExpired(now);
    }

    let temporaryConversationExpired = 0;
    let temporaryConversationCleaned = 0;
    let temporaryConversationDeletedMessages = 0;
    if (temporaryConversationEnabled) {
      const retention = new TemporaryConversationRetentionService(this.db).run({
        now,
        ...(options.temporaryConversation?.retentionGraceMs !== undefined
          ? { retentionGraceMs: options.temporaryConversation.retentionGraceMs }
          : {}),
        ...(options.temporaryConversation?.expireLimit !== undefined
          ? { expireLimit: options.temporaryConversation.expireLimit }
          : {}),
        ...(options.temporaryConversation?.cleanupLimit !== undefined
          ? { cleanupLimit: options.temporaryConversation.cleanupLimit }
          : {}),
      });
      temporaryConversationExpired = retention.expired;
      temporaryConversationCleaned = retention.cleaned;
      temporaryConversationDeletedMessages = retention.deletedMessages;
    }

    // R6-3（缺口 5）：NodeGraph 终态运行的 node-run 正文裁剪。默认启用，可关闭。
    const nodeGraphRunEnabled = options.nodeGraphRun?.enabled !== false;
    let nodeGraphRunCleaned = 0;
    let nodeGraphRunRedactedNodeRuns = 0;
    if (nodeGraphRunEnabled) {
      const retention = new NodeGraphRunRetentionService(this.db).run({
        now,
        ...(options.nodeGraphRun?.retentionGraceMs !== undefined
          ? { retentionGraceMs: options.nodeGraphRun.retentionGraceMs }
          : {}),
        ...(options.nodeGraphRun?.cleanupLimit !== undefined
          ? { cleanupLimit: options.nodeGraphRun.cleanupLimit }
          : {}),
      });
      nodeGraphRunCleaned = retention.cleaned;
      nodeGraphRunRedactedNodeRuns = retention.redactedNodeRuns;
    }

    const result: RuntimeMaintenanceRunResult = {
      now,
      promptRuntimeInjection: {
        expiredDeleted,
      },
      temporaryConversation: {
        expired: temporaryConversationExpired,
        cleaned: temporaryConversationCleaned,
        deletedMessages: temporaryConversationDeletedMessages,
      },
      nodeGraphRun: {
        cleaned: nodeGraphRunCleaned,
        redactedNodeRuns: nodeGraphRunRedactedNodeRuns,
      },
      durationMs: Date.now() - startedAt,
    };

    if (options.operationLog) {
      if (expiredDeleted > 0) {
        this.appendPromptRuntimeInjectionCleanupLog(options.operationLog, result);
      }
      if (temporaryConversationExpired > 0 || temporaryConversationCleaned > 0) {
        this.appendTemporaryConversationCleanupLog(options.operationLog, result);
      }
      if (nodeGraphRunCleaned > 0) {
        this.appendNodeGraphRunCleanupLog(options.operationLog, result);
      }
    }

    return result;
  }

  private appendPromptRuntimeInjectionCleanupLog(
    operationLog: NonNullable<RuntimeMaintenanceRunOptions["operationLog"]>,
    result: RuntimeMaintenanceRunResult,
  ): void {
    new OperationLogService(this.db).append({
      accountId: operationLog.accountId,
      actorType: operationLog.actorType ?? "system",
      actorId: operationLog.actorId ?? "runtime_maintenance",
      operationGroupId: operationLog.operationGroupId ?? null,
      requestId: operationLog.requestId ?? null,
      sourceType: operationLog.sourceType ?? "maintenance",
      action: GOVERNANCE_OPERATION_ACTIONS.promptInjection.cleanupExpired,
      status: "succeeded",
      targetType: "prompt_runtime_injection",
      targetId: null,
      metadata: {
        cleanup_kind: "expired",
        expired_deleted: result.promptRuntimeInjection.expiredDeleted,
        now: result.now,
        duration_ms: result.durationMs,
      },
    });
  }

  private appendTemporaryConversationCleanupLog(
    operationLog: NonNullable<RuntimeMaintenanceRunOptions["operationLog"]>,
    result: RuntimeMaintenanceRunResult,
  ): void {
    new OperationLogService(this.db).append({
      accountId: operationLog.accountId,
      actorType: operationLog.actorType ?? "system",
      actorId: operationLog.actorId ?? "runtime_maintenance",
      operationGroupId: operationLog.operationGroupId ?? null,
      requestId: operationLog.requestId ?? null,
      sourceType: operationLog.sourceType ?? "maintenance",
      action: GOVERNANCE_OPERATION_ACTIONS.temporaryConversation.cleanup,
      status: "succeeded",
      targetType: "temporary_conversation",
      targetId: null,
      metadata: {
        cleanup_kind: "retention",
        expired: result.temporaryConversation.expired,
        cleaned: result.temporaryConversation.cleaned,
        deleted_messages: result.temporaryConversation.deletedMessages,
        now: result.now,
        duration_ms: result.durationMs,
      },
    });
  }

  private appendNodeGraphRunCleanupLog(
    operationLog: NonNullable<RuntimeMaintenanceRunOptions["operationLog"]>,
    result: RuntimeMaintenanceRunResult,
  ): void {
    new OperationLogService(this.db).append({
      accountId: operationLog.accountId,
      actorType: operationLog.actorType ?? "system",
      actorId: operationLog.actorId ?? "runtime_maintenance",
      operationGroupId: operationLog.operationGroupId ?? null,
      requestId: operationLog.requestId ?? null,
      sourceType: operationLog.sourceType ?? "maintenance",
      action: GOVERNANCE_OPERATION_ACTIONS.nodeGraphRun.cleanup,
      status: "succeeded",
      targetType: "node_graph_run",
      targetId: null,
      metadata: {
        cleanup_kind: "retention",
        cleaned: result.nodeGraphRun.cleaned,
        redacted_node_runs: result.nodeGraphRun.redactedNodeRuns,
        now: result.now,
        duration_ms: result.durationMs,
      },
    });
  }
}
