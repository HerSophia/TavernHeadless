import { describe, expect, it } from 'vitest';

import { TextProtocolToolResultFormatter } from '../../transport/index.js';

describe('TextProtocolToolResultFormatter', () => {
  it('formats success results with a success status', () => {
    const formatter = new TextProtocolToolResultFormatter();
    const result = formatter.format({
      callId: 'call-1',
      toolName: 'roll_dice',
      result: { data: { value: 4 } },
    });

    expect(result.content).toContain('<tool_result id="call-1" name="roll_dice" status="success">');
    expect(result.content).toContain('"data"');
    expect(result.content).toContain('"value": 4');
  });

  it('formats failure results with structured error metadata', () => {
    const formatter = new TextProtocolToolResultFormatter();
    const result = formatter.format({
      callId: 'call-2',
      toolName: 'get_variable',
      result: {
        error: 'Tool call denied: disabled',
        executionStatus: 'denied',
        executionReasonCode: 'disabled',
        retryable: false,
      },
    });

    expect(result.content).toContain('status="error"');
    expect(result.content).toContain('"error": "Tool call denied: disabled"');
    expect(result.content).toContain('"executionStatus": "denied"');
    expect(result.content).toContain('"executionReasonCode": "disabled"');
  });

  it('treats deferred receipts as success payloads', () => {
    const formatter = new TextProtocolToolResultFormatter();
    const result = formatter.format({
      callId: 'call-3',
      toolName: 'mcp_create_issue',
      result: {
        data: {
          accepted: true,
          delivery_mode: 'async_job',
          execution_id: 'exec-1',
          job_id: 'job-1',
          status: 'queued',
          message: 'Queued',
        },
        executionStatus: 'queued',
      },
    });

    expect(result.content).toContain('status="success"');
    expect(result.content).toContain('"delivery_mode": "async_job"');
    expect(result.content).toContain('"status": "queued"');
  });
});
