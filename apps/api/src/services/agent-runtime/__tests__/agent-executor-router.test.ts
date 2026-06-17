import { describe, expect, it, vi } from "vitest";

import { AgentExecutorRouter } from "../agent-executor-router.js";
import type {
  TemporaryConversationAgentExecutionResult,
  TemporaryConversationAgentExecutor,
  TemporaryConversationAgentRequest,
} from "../temporary-conversation-agent-executor.js";
import type { InlineAgentExecutionResult } from "../inline-agent-types.js";

function makeTemporaryExecutorStub(
  result: TemporaryConversationAgentExecutionResult,
): TemporaryConversationAgentExecutor {
  return {
    execute: vi.fn(async () => result),
  } as unknown as TemporaryConversationAgentExecutor;
}

const temporaryResult: TemporaryConversationAgentExecutionResult = {
  status: "completed",
  conversationId: "conv_1",
  medium: { kind: "temporary_conversation", deliveryTarget: "return_inline" },
  mediumTrace: {
    kind: "temporary_conversation",
    deliveryTarget: "return_inline",
    status: "completed",
    conversationId: "conv_1",
  },
  auditSnapshot: {
    conversationId: "conv_1",
    status: "completed",
    purpose: "agent_private",
    deliveryTarget: "return_inline",
    retentionPolicy: "delete_on_finalize",
    traceSummary: {
      kind: "temporary_conversation",
      deliveryTarget: "return_inline",
    status: "completed",
    },
    operationLog: [],
  },
};

const inlineResult: InlineAgentExecutionResult = {
  phase: "pre_response",
  records: [],
  aborted: false,
};

describe("AgentExecutorRouter", () => {
  it("single_call 路由到 inline executor adapter", async () => {
    const router = new AgentExecutorRouter(makeTemporaryExecutorStub(temporaryResult));
    const route = await router.routeByMedium(
      { kind: "single_call", deliveryTarget: "return_inline" },
      { singleCallExecutor: { execute: async () => inlineResult } },
    );

    expect(route.kind).toBe("single_call");
    if (route.kind === "single_call") {
      expect(route.result.phase).toBe("pre_response");
    }
  });

  it("temporary_conversation 路由到临时对话 executor", async () => {
    const temporaryExecutor = makeTemporaryExecutorStub(temporaryResult);
    const router = new AgentExecutorRouter(temporaryExecutor);
    const request = {
      accountId: "acc_1",
      medium: { kind: "temporary_conversation", deliveryTarget: "return_inline" },
      source: { kind: "session", sourceSessionId: "sess_1" },
    } as unknown as TemporaryConversationAgentRequest;

    const route = await router.routeByMedium(
      { kind: "temporary_conversation", deliveryTarget: "return_inline" },
      { temporaryConversationRequest: request },
    );

    expect(route.kind).toBe("temporary_conversation");
    expect(temporaryExecutor.execute).toHaveBeenCalledTimes(1);
  });

  it("background_job 在 R3 返回明确拒绝结果", async () => {
    const router = new AgentExecutorRouter(makeTemporaryExecutorStub(temporaryResult));
    const route = await router.routeByMedium(
      { kind: "background_job",deliveryTarget: "derived_output" },
      {},
    );

    expect(route.kind).toBe("background_job");
    if (route.kind === "background_job") {
      expect(route.result.status).toBe("rejected");
      expect(route.result.code).toBe("background_job_not_activated_until_r4");
    }
  });

  it("single_call 缺少 executor 时抛错", async () => {
    const router = new AgentExecutorRouter(makeTemporaryExecutorStub(temporaryResult));
    await expect(
      router.routeByMedium({ kind: "single_call", deliveryTarget: "return_inline" }, {}),
    ).rejects.toThrow();
  });
});
