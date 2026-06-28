import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { createTestSessionWithScope } from "../../__tests__/helpers/workspace-project.js";
import {
  GraphAssistantToolConfirmationService,
  GraphAssistantToolConfirmationServiceError,
  type CreateGraphAssistantPendingToolCallInput,
} from "../graph-assistant-tool-confirmation-service.js";

const ACCOUNT_ID = "gaptc-owner";

describe("GraphAssistantToolConfirmationService", () => {
  let database: DatabaseConnection;
  let service: GraphAssistantToolConfirmationService;
let scope: { accountId: string; workspaceId: string; projectId: string; sessionId: string };

beforeEach(() => {
    database = createDatabase(":memory:");
    scope = createTestSessionWithScope(database.db, {
      accountId: ACCOUNT_ID,
      id: "sess_gaptc",
      values: { kind: "temporary", purpose: "graph-assistant" },
    });
    service = new GraphAssistantToolConfirmationService(database.db);
  });

  afterEach(() => {
    database.close();
  });

  function buildInput(
    overrides: Partial<CreateGraphAssistantPendingToolCallInput> = {},
  ): CreateGraphAssistantPendingToolCallInput {
    return {
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      accountId: scope.accountId,
      conversationId:scope.sessionId,
      branchId: "main",
      floorId: "floor_1",
      callId: "call_1",
      toolName: "nodegraph.graph.create",
      args: { name: "demo" },
      sideEffectLevel: "sandbox",
      conversationMessages: [
        { role: "user", content: "建一张图" },
        { role: "assistant", content: "<tool_call>...</tool_call>" },
      ],
      agentSteps: 2,
      ...overrides,
    };
  }

  it("creates a pending record with parsed args and conversation context", () => {
    const record = service.createPending(buildInput(), 1000);

    expect(record.id).toMatch(/^gaptc_/);
    expect(record.status).toBe("pending");
    expect(record.args).toEqual({ name: "demo" });
    expect(record.conversationMessages).toHaveLength(2);
    expect(record.agentSteps).toBe(2);
    expect(record.expiresAt).toBeNull();
    expect(record.createdAt).toBe(1000);
  });

  it("lists pending records for a conversation in creation order", () => {
    service.createPending(buildInput({ callId: "call_a" }), 1000);
    const approved = service.createPending(buildInput({ callId: "call_b" }), 1001);
    service.approve(approved.id, 2000);
    service.createPending(buildInput({ callId: "call_c" }), 1002);

    const pending = service.listPending({ conversationId: scope.sessionId });
    expect(pending.map((row) => row.callId)).toEqual(["call_a", "call_c"]);
  });

  it("approves then marks executed", () => {
    const record = service.createPending(buildInput(), 1000);
    const approved = service.approve(record.id, 2000);
    expect(approved.status).toBe("approved");
    expect(approved.updatedAt).toBe(2000);

    const executed = service.markExecuted(record.id, 3000);
    expect(executed.status).toBe("executed");
  });

  it("rejects a pending record", () => {
    const record = service.createPending(buildInput(), 1000);
    const rejected = service.reject(record.id, 2000);
    expect(rejected.status).toBe("rejected");
  });

  it("cancels a pending record", () => {
    const record = service.createPending(buildInput(), 1000);
    expect(service.cancel(record.id, 2000).status).toBe("cancelled");
  });

  it("rejects invalid status transitions", () => {
    const record = service.createPending(buildInput(), 1000);
    service.reject(record.id, 2000);
    expect(() => service.approve(record.id, 3000)).toThrow(
      GraphAssistantToolConfirmationServiceError,
    );
    // markExecuted requires approved, not pending.
    const other = service.createPending(buildInput({ callId: "call_x" }), 1000);
    expect(() => service.markExecuted(other.id, 3000)).toThrow(
      GraphAssistantToolConfirmationServiceError,
    );
  });

  it("throws not_found for unknown id", () =>{
    expect(() => service.approve("gaptc_missing",1000)).toThrow(
      GraphAssistantToolConfirmationServiceError,
    );
    expect(service.getById("gaptc_missing")).toBeNull();
  });

  it("findResumable returns the earliest approved record and null when none", () => {
    // 无 approved 记录时返回 null。
    expect(service.findResumable({ conversationId: scope.sessionId })).toBeNull();

    service.createPending(buildInput({ callId: "call_a" }), 1000);
    const second = service.createPending(buildInput({ callId: "call_b" }), 1001);
  const third = service.createPending(buildInput({ callId: "call_c" }), 1002);
    // 按创建时间取最早一条 approved。
    service.approve(third.id, 2000);
    service.approve(second.id, 2001);

    const resumable = service.findResumable({ conversationId: scope.sessionId });
    expect(resumable?.callId).toBe("call_b");

    // executed 后不再续跑。
    service.markExecuted(second.id, 3000);
    expect(service.findResumable({ conversationId: scope.sessionId })?.callId).toBe("call_c");
  });
});
