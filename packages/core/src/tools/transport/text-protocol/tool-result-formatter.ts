import type { ToolResultFormatInput, ToolResultFormatOutput } from '../transport-types.js';

import {
  TEXT_PROTOCOL_TOOL_RESULT_CLOSE,
  TEXT_PROTOCOL_TOOL_RESULT_TAG,
} from './constants.js';

const FAILURE_STATUSES = new Set(['error', 'denied', 'timeout', 'uncertain', 'blocked']);

function escapeXmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function isFailure(input: ToolResultFormatInput): boolean {
  if (typeof input.result.error === 'string' && input.result.error.trim().length > 0) {
    return true;
  }

  return input.result.executionStatus !== undefined && FAILURE_STATUSES.has(input.result.executionStatus);
}

function buildPayload(input: ToolResultFormatInput, failed: boolean): Record<string, unknown> {
  if (!failed) {
    return {
      data: input.result.data ?? null,
    };
  }

  return {
    error: input.result.error ?? input.result.providerMessage ?? 'Tool execution failed',
    ...(input.result.executionStatus !== undefined ? { executionStatus: input.result.executionStatus } : {}),
    ...(input.result.executionReasonCode !== undefined ? { executionReasonCode: input.result.executionReasonCode } : {}),
    ...(input.result.reconnectRequired !== undefined ? { reconnectRequired: input.result.reconnectRequired } : {}),
    ...(input.result.retryable !== undefined ? { retryable: input.result.retryable } : {}),
    ...(input.result.providerMessage !== undefined ? { providerMessage: input.result.providerMessage } : {}),
  };
}

/**
 * 将工具执行结果格式化为文本协议中的 `<tool_result>` 块。
 */
export class TextProtocolToolResultFormatter {
  format(input: ToolResultFormatInput): ToolResultFormatOutput {
    const failed = isFailure(input);
    const status = failed ? 'error' : 'success';
    const payload = buildPayload(input, failed);
    const callId = escapeXmlAttribute(input.callId);
    const toolName = escapeXmlAttribute(input.toolName);

    return {
      content: [
        `<${TEXT_PROTOCOL_TOOL_RESULT_TAG} id="${callId}" name="${toolName}" status="${status}">`,
        JSON.stringify(payload, null, 2),
        TEXT_PROTOCOL_TOOL_RESULT_CLOSE,
      ].join('\n'),
    };
  }
}
