import type {
  ExecutedToolCallRecord,
  ToolCallRecord,
  ToolCallStatus,
  ToolExecutionStatus,
} from '@tavern/core';

/**
 * `tool_call_record` 只保留为 legacy-compatible projection。
 *
 * 主审计真相固定为：
 * - `tool_execution_record`
 * - `runtime_job`（deferred 时）
 *
 * 因此这个模块只负责把真实执行日志压缩为旧兼容读面，
 * 不承载新的执行语义，也不反向定义主执行真相。
 */

export interface LegacyToolCallProjectionOptions {
  pageId?: string;
  startSeq?: number;
}

export function toLegacyToolCallStatus(status: ToolExecutionStatus): ToolCallStatus {
  if (status === 'success') {
    return 'success';
  }

  if (status === 'denied' || status === 'blocked') {
    return 'denied';
  }

  if (status === 'queued' || status === 'running') {
    return status;
  }

  return 'error';
}

export function projectLegacyToolCallRecord(
  record: ExecutedToolCallRecord,
  seq: number,
  options: Pick<LegacyToolCallProjectionOptions, 'pageId'> = {},
): ToolCallRecord {
  return {
    id: record.id,
    pageId: options.pageId ?? record.pageId ?? '',
    seq,
    callerSlot: record.callerSlot,
    toolName: record.toolName,
    argsJson: record.argsJson,
    resultJson: record.resultJson,
    status: toLegacyToolCallStatus(record.status),
    durationMs: record.durationMs,
    createdAt: record.createdAt,
  };
}

export function projectLegacyToolCallRecords(
  records: ExecutedToolCallRecord[],
  options: LegacyToolCallProjectionOptions = {},
): ToolCallRecord[] {
  const startSeq = options.startSeq ?? 1;

  return records.map((record, index) => projectLegacyToolCallRecord(record, startSeq + index, {
    pageId: options.pageId,
  }));
}
