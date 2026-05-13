import type { ProjectEventRecord } from "@tavern/sdk";

export type ProjectEventCursor = number;

/**
 * 判断一个值是否是 SDK 归一化后的 Project Event。
 */
export function isProjectEvent(value: unknown): value is ProjectEventRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return typeof record.id === "string"
    && typeof record.workspaceId === "string"
    && typeof record.projectId === "string"
    && typeof record.sequence === "number"
    && Number.isInteger(record.sequence)
    && record.sequence > 0
    && typeof record.type === "string"
    && isProjectEventVisibility(record.visibility)
    && isProjectEventSource(record.source)
    && isNullableString(record.actorAccountId)
    && isNullableString(record.sessionId)
    && isNullableString(record.branchId)
    && isNullableString(record.floorId)
    && isNullableString(record.pageId)
    && isNullableString(record.messageId)
    && isNullableString(record.operationLogId)
    && isNullableString(record.correlationId)
    && isNullableString(record.causationEventId)
    && "payload" in record
    && typeof record.createdAt === "number"
    && Number.isFinite(record.createdAt);
}

/**
 * 读取单个 Project Event 的 SSE / query cursor。
 */
export function getProjectEventCursor(event: unknown): ProjectEventCursor | null {
  return isProjectEvent(event) ? event.sequence : null;
}

/**
 * 对 Project Event 列表去重。
 *
 * 相同 Project 中相同 sequence 只保留第一次出现的事件。
 * 输入中的非 Project Event 值会被跳过。
 */
export function dedupeProjectEvents(events: readonly unknown[]): ProjectEventRecord[] {
  const seen = new Set<string>();
  const result: ProjectEventRecord[] = [];

  for (const event of events) {
    if (!isProjectEvent(event)) {
      continue;
    }

    const key = `${event.projectId}:${event.sequence}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(event);
  }

  return result;
}

/**
 * 基于上一个 cursor 和一个 Project Event 计算新的 cursor。
 */
export function applyProjectEventCursor(previousCursor: number | string | null | undefined, event: unknown): ProjectEventCursor | null {
  const previous = normalizeCursor(previousCursor);
  const current = getProjectEventCursor(event);

  if (current === null) {
    return previous;
  }

  return previous === null ? current : Math.max(previous, current);
}

function normalizeCursor(value: number | string | null | undefined): ProjectEventCursor | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value.trim());
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
  }

  return null;
}

function isNullableString(value: unknown): boolean {
  return typeof value === "string" || value === null;
}

function isProjectEventVisibility(value: unknown): boolean {
  return value === "project" || value === "owner" || value === "internal";
}

function isProjectEventSource(value: unknown): boolean {
  return value === "api" || value === "runtime_job" || value === "migration" || value === "system";
}
