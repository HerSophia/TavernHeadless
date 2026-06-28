import type { ChatMessage } from "@tavern/core";
import { and, asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { AppDb, DbExecutor } from "../db/client.js";
import { graphAssistantPendingToolCalls } from "../db/schema.js";

/**
 * 待确认工具调用的生命周期状态。
 *
 * - `pending`：已登记，等待用户批准/拒绝。
 * - `approved`：用户已批准，等待续跑时执行。
 * - `rejected`：用户已拒绝，不再执行。
 * - `executed`：批准后已实际执行完毕。
 * - `expired`：预留状态，本阶段不设硬过期，故运行期不会写入。
 * - `cancelled`：会话被丢弃或上层取消导致作废。
 */
export type GraphAssistantPendingToolCallStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "executed"
  | "expired"
  | "cancelled";

/** 待确认工具调用记录（已解析 JSON 字段）。 */
export interface GraphAssistantPendingToolCallRecord {
  id: string;
  workspaceId: string;
  projectId: string;
  accountId: string;
  conversationId: string;
  branchId: string;
  floorId: string;
  callId: string;
  toolName: string;
  args: Record<string, unknown>;
  sideEffectLevel: string | null;
  status: GraphAssistantPendingToolCallStatus;
  /** 暂停时刻的完整对话上下文，批准后据此重建多轮 agent 循环。 */
  conversationMessages: ChatMessage[];
  /** 暂停前已消耗的 agent 步数，用于续跑时延续步数预算。 */
  agentSteps: number;
  createdAt: number;
  updatedAt: number;
  expiresAt: number | null;
}

/** 登记一条待确认工具调用所需的输入。 */
export interface CreateGraphAssistantPendingToolCallInput {
  workspaceId: string;
  projectId: string;
  accountId: string;
  conversationId: string;
  branchId: string;
  floorId: string;
  callId: string;
  toolName: string;
  args: Record<string, unknown>;
  sideEffectLevel?: string | null;
  conversationMessages: ChatMessage[];
  agentSteps: number;
  expiresAt?: number | null;
}

export type GraphAssistantToolConfirmationServiceErrorCode =
  | "pending_not_found"
  | "invalid_status_transition";

export class GraphAssistantToolConfirmationServiceError extends Error {
  constructor(
    public readonly statusCode: 404 | 409,
    public readonly code: GraphAssistantToolConfirmationServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GraphAssistantToolConfirmationServiceError";
  }
}

/**
 * 图助手「执行前确认闸」待确认工具调用服务。
 *
 * 负责登记、查询与状态流转。决策（auto/confirm）由
 * {@link GraphAssistantToolPolicyService} 提供；本服务只在 text_protocol 多轮循环
 * 遇到 confirm 工具暂停时记录现场，并在用户批准/拒绝后驱动状态机。
 */
export class GraphAssistantToolConfirmationService {
  constructor(private readonly db: AppDb | DbExecutor) {}

  /** 登记一条待确认工具调用（状态 `pending`）。 */
  createPending(
    input: CreateGraphAssistantPendingToolCallInput,
    now = Date.now(),
  ): GraphAssistantPendingToolCallRecord {
    const id = `gaptc_${nanoid(16)}`;
    this.db
      .insert(graphAssistantPendingToolCalls)
      .values({
        id,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        accountId: input.accountId,
        conversationId: input.conversationId,
        branchId: input.branchId,
        floorId: input.floorId,
        callId: input.callId,
        toolName: input.toolName,
        argsJson: JSON.stringify(input.args ?? {}),
        sideEffectLevel: input.sideEffectLevel ?? null,
        status: "pending",
        conversationMessagesJson: JSON.stringify(input.conversationMessages ?? []),
        agentSteps: input.agentSteps,
        createdAt: now,
        updatedAt: now,
        expiresAt: input.expiresAt ?? null,
      })
      .run();

    const created = this.getById(id);
    if (!created) {
      throw new GraphAssistantToolConfirmationServiceError(
        404,
        "pending_not_found",
        `Failed to load just-created pending tool call '${id}'.`,
      );
    }
    return created;
  }

  /** 按 id 读取一条记录，不存在返回 null。 */
 getById(id: string): GraphAssistantPendingToolCallRecord | null {
    const row = this.db
      .select()
      .from(graphAssistantPendingToolCalls)
      .where(eq(graphAssistantPendingToolCalls.id, id))
      .limit(1)
      .all()[0];
    return row ? rowToRecord(row) : null;
  }

  /** 列出某临时对话下处于 `pending` 的待确认记录（按创建时间升序）。 */
  listPending(input: { conversationId: string }): GraphAssistantPendingToolCallRecord[] {
    return this.db
      .select()
      .from(graphAssistantPendingToolCalls)
      .where(and(
        eq(graphAssistantPendingToolCalls.conversationId, input.conversationId),
        eq(graphAssistantPendingToolCalls.status, "pending"),
      ))
      .orderBy(asc(graphAssistantPendingToolCalls.createdAt))
      .all()
            .map(rowToRecord);
  }

  /**
   * 查找某临时对话下可续跑的（状态 `approved`）待确认记录。
   *
   * 批准后未执行的记录才可续跑。取最早一条（按创建时间升序），不存在返回 null。
   */
 findResumable(input: { conversationId: string }): GraphAssistantPendingToolCallRecord | null {
    const row = this.db
      .select()
      .from(graphAssistantPendingToolCalls)
      .where(and(
        eq(graphAssistantPendingToolCalls.conversationId, input.conversationId),
        eq(graphAssistantPendingToolCalls.status, "approved"),
      ))
      .orderBy(asc(graphAssistantPendingToolCalls.createdAt))
      .limit(1)
      .all()[0];
    return row ? rowToRecord(row) : null;
  }

/** 用户批准：`pending` → `approved`。 */
  approve(id: string, now = Date.now()): GraphAssistantPendingToolCallRecord {
    return this.transition(id, "pending", "approved", now);
  }

  /** 用户拒绝：`pending` → `rejected`。 */
  reject(id: string, now = Date.now()): GraphAssistantPendingToolCallRecord {
    return this.transition(id, "pending", "rejected", now);
  }

  /** 批准后执行完毕：`approved` → `executed`。 */
  markExecuted(id: string, now = Date.now()): GraphAssistantPendingToolCallRecord {
    return this.transition(id, "approved", "executed", now);
  }

  /** 上层取消（会话丢弃等）：`pending` → `cancelled`。 */
  cancel(id: string, now = Date.now()): GraphAssistantPendingToolCallRecord {
    return this.transition(id, "pending", "cancelled", now);
  }

  private transition(
 id: string,
    from: GraphAssistantPendingToolCallStatus,
    to: GraphAssistantPendingToolCallStatus,
    now: number,
  ): GraphAssistantPendingToolCallRecord {
    const existing = this.getById(id);
    if (!existing) {
      throw new GraphAssistantToolConfirmationServiceError(
        404,
        "pending_not_found",
        `Pending tool call '${id}' not found.`,
      );
    }
    if (existing.status !== from) {
      throw new GraphAssistantToolConfirmationServiceError(
        409,
        "invalid_status_transition",
        `Pending tool call '${id}' is '${existing.status}', cannot transition to '${to}'.`,
      );
    }

    this.db
      .update(graphAssistantPendingToolCalls)
      .set({ status: to, updatedAt: now })
      .where(eq(graphAssistantPendingToolCalls.id, id))
      .run();

    const updated= this.getById(id);
    if (!updated) {
      throw new GraphAssistantToolConfirmationServiceError(
        404,
        "pending_not_found",
        `Pending tool call '${id}' disappeared during transition.`,
      );
    }
    return updated;
  }
}

function rowToRecord(
  row: typeof graphAssistantPendingToolCalls.$inferSelect,
): GraphAssistantPendingToolCallRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    accountId: row.accountId,
    conversationId: row.conversationId,
    branchId: row.branchId,
    floorId: row.floorId,
    callId: row.callId,
    toolName: row.toolName,
    args: parseJsonObject(row.argsJson),
    sideEffectLevel: row.sideEffectLevel,
    status: row.status,
    conversationMessages: parseConversationMessages(row.conversationMessagesJson),
    agentSteps: row.agentSteps,
 createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    expiresAt: row.expiresAt,
  };
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseConversationMessages(value: string): ChatMessage[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as ChatMessage[]) : [];
  } catch {
    return [];
  }
}
