import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { accounts, floors, sessions } from "../../db/schema.js";
import { OperationLogService } from "../operation-log-service.js";
import { appendToolTransportOperationLogs } from "../tool-transport-operation-log.js";

describe("appendToolTransportOperationLogs", () => {
  let database: DatabaseConnection;

  beforeEach(async () => {
    database = createDatabase(":memory:");
    await database.db.insert(accounts).values({
      id: "account-a",
      name: "Account A",
      role: "admin",
      status: "active",
      isDefault: false,
      createdAt: 1,
      updatedAt: 1,
    });
    await database.db.insert(sessions).values({
      id: "session-1",
      title: "Session 1",
      accountId: "account-a",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    await database.db.insert(floors).values({
      id: "floor-1",
      sessionId: "session-1",
      floorNo: 1,
      branchId: "main",
      parentFloorId: null,
      state: "generating",
      tokenIn: 0,
      tokenOut: 0,
      createdAt: 1,
      updatedAt: 1,
    });
  });

  afterEach(() => {
    database.close();
  });

  it("writes selection, result writeback, and parse failure logs without raw excerpts", () => {
    appendToolTransportOperationLogs(database.db, {
      accountId: "account-a",
      workspaceId: null,
      projectId: null,
      sessionId: "session-1",
      branchId: "main",
      floorId: "floor-1",
      runId: "run-1",
      operationLog: {
        requestId: "req-1",
        route: "POST /sessions/:id/respond",
      },
      createdAt: 123,
      trace: {
        selection: {
          transport: "text_protocol",
          reasonCode: "instance_not_supports_function_call",
        },
        toolList: {
          injected: true,
          contributorId: "builtin:tool_list",
          toolCount: 2,
          tokenCount: 96,
          budgetGroup: "tool_list",
        },
        parsing: {
          blockCount: 2,
          acceptedCount: 1,
          rejectedCount: 1,
          diagnostics: [{
            callId: "bad",
            toolName: "missing",
            reason: "tool_not_registered",
            excerpt: "SECRET_TOOL_CALL_EXCERPT",
          }],
          diagnosticsByReason: { tool_not_registered: 1 },
        },
        toolResult: {
          writtenBack: true,
          blockCount: 1,
          tokenCount: 128,
          budgetGroup: "tool_result",
        },
      },
    });

    const logs = new OperationLogService(database.db).list({
      accountId: "account-a",
      sessionId: "session-1",
      floorId: "floor-1",
      sortOrder: "asc",
    }).rows;

    expect(logs.map((log) => log.action)).toEqual([
      "tool_transport.fallback",
      "tool_transport.tool_result_writeback",
      "tool_transport.parse_failed",
    ]);
    expect(logs[0]).toMatchObject({
      sourceType: "tool_transport",
      status: "succeeded",
      targetType: "tool_transport",
      targetId: "text_protocol",
      runId: "run-1",
      requestId: "req-1",
    });
    expect(logs[2]).toMatchObject({
      status: "failed",
      reason: "tool_not_registered",
      targetType: "tool_transport_parse",
    });
    expect(logs[2]?.metadata).toEqual(expect.objectContaining({
      diagnostics_by_reason: { tool_not_registered: 1 },
    }));
    expect(JSON.stringify(logs)).not.toContain("SECRET_TOOL_CALL_EXCERPT");
  });
});
