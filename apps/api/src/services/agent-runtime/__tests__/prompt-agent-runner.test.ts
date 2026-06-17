import { describe, expect, it, vi } from "vitest";

import {
  PromptAgentRunner,
  PromptAgentRunError,
  resolvePromptAgentKind,
  getPromptAgentRunnerDefinition,
} from "../prompt-agent-runner.js";
import { AgentExecutorRouter } from "../agent-executor-router.js";
import {
  TemporaryConversationAgentExecutor,
  type TemporaryConversationAgentService,
} from "../temporary-conversation-agent-executor.js";
import type {
  TemporaryConversationExportResult,
  TemporaryConversationHandle,
  TemporaryConversationResult,
} from "../../temporary-conversation-types.js";

function makeHandle(): TemporaryConversationHandle {
  const now = Date.now();
  return {
    id: "conv_1",
    conversationId: "conv_1",
    branchId: "main",
    kind: "temporary",
    title: null,
    status: "active",
    purpose: "draft",
    workspaceId: null,
    projectId: null,
    sourceSessionId: "sess_1",
    retentionPolicy: "delete_on_finalize",
    visibility: "internal",
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
    expiresAt: null,
    finalizedAt: null,
    discardedAt: null,
    cancelledAt: null,
  };
}

function makeResult(): TemporaryConversationResult {
  return {
    conversationId: "conv_1",
    branchId: "main",
    floorId: "floor_1",
    floorNo: 1,
    pageId: "page_out_1",
    text: "assistant text",
  };
}

function makeExportResult(): TemporaryConversationExportResult {
  return {
    conversationId: "conv_1",
    target: "page_staged_write",
    stagedWriteId: "staged_1",
    targetPageId: "page_target_1",
    sourcePageId: "page_out_1",
    createdAt: Date.now(),
    status: "staged",
  };
}

function makeServiceStub(
  overrides: Partial<TemporaryConversationAgentService> = {},
): TemporaryConversationAgentService {
  return {
    create: vi.fn(async () => makeHandle()),
    createFromProject: vi.fn(async () => makeHandle()),
    appendMessage: vi.fn(async () => undefined),
    respond: vi.fn(async () => makeResult()),
    exportResult: vi.fn(async () => makeExportResult()),
  finalize: vi.fn(async () => undefined),
    discard: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    ...overrides,
  };
}

function makeRunner(service: TemporaryConversationAgentService): PromptAgentRunner {
  const executor = new TemporaryConversationAgentExecutor(service);
  const router = new AgentExecutorRouter(executor);
  return new PromptAgentRunner(router);
}

describe("resolvePromptAgentKind", () => {
  it("直接匹配 PromptAgentKind", () => {
    expect(resolvePromptAgentKind("draft_assistant")).toBe("draft_assistant");
    expect(resolvePromptAgentKind("revision_assistant")).toBe("revision_assistant");
    expect(resolvePromptAgentKind("qa_assistant")).toBe("qa_assistant");
  });

  it("惯用名称解析为 PromptAgentKind", () => {
    expect(resolvePromptAgentKind("draft")).toBe("draft_assistant");
    expect(resolvePromptAgentKind("revise")).toBe("revision_assistant");
    expect(resolvePromptAgentKind("revision")).toBe("revision_assistant");
    expect(resolvePromptAgentKind("qa")).toBe("qa_assistant");
    expect(resolvePromptAgentKind("question_answer")).toBe("qa_assistant");
  });

  it("未知名称抛 PromptAgentRunError", () => {
    expect(() => resolvePromptAgentKind("nope")).toThrowError(PromptAgentRunError);
  });
});

describe("getPromptAgentRunnerDefinition", () => {
  it("draft 默认临时对话 + return_inline，user_visible", () => {
    const def = getPromptAgentRunnerDefinition("draft");
    expect(def.audience).toBe("user_visible");
    expect(def.medium.kind).toBe("temporary_conversation");
    expect(def.medium.deliveryTarget).toBe("return_inline");
  });

  it("revision 默认临时对话 + page_staged_write，internal", () => {
    const def = getPromptAgentRunnerDefinition("revision");
    expect(def.audience).toBe("internal");
    expect(def.medium.deliveryTarget).toBe("page_staged_write");
  });

  it("qa 默认临时对话 + return_inline，user_visible", () => {
    const def= getPromptAgentRunnerDefinition("qa");
    expect(def.audience).toBe("user_visible");
    expect(def.medium.deliveryTarget).toBe("return_inline");
  });
});

describe("PromptAgentRunner", () => {
  it("draft_assistant 经临时对话 return_inline 运行，不导出", async () => {
    const service = makeServiceStub();
    const runner = makeRunner(service);

    const result = await runner.run({
      agent: "draft_assistant",
      accountId: "acc_1",
      source: { kind: "session", sourceSessionId: "sess_1" },
      inputMessage: "请给我一个草稿",
    });

    expect(result.status).toBe("completed");
    expect(result.medium.deliveryTarget).toBe("return_inline");
    expect(result.result?.text).toBe("assistant text");
    expect(result.exportResult).toBeUndefined();
    expect(service.exportResult).not.toHaveBeenCalled();
    expect(service.finalize).toHaveBeenCalledTimes(1);
  });

  it("惯用名称 draft 同样能运行", async () => {
    const service = makeServiceStub();
    const runner = makeRunner(service);

    const result = await runner.run({
      agent: "draft",
      accountId: "acc_1",
      source: { kind: "session", sourceSessionId: "sess_1" },
      inputMessage: "请给我一个草稿",
    });

    expect(result.status).toBe("completed");
    expect(service.create).toHaveBeenCalledTimes(1);
  });

  it("revision_assistant 经临时对话 page_staged_write 运行并导出", async () => {
    const service = makeServiceStub();
    const runner = makeRunner(service);

   const result = await runner.run({
      agent: "revision_assistant",
      accountId: "acc_1",
      source: { kind: "session", sourceSessionId: "sess_1" },
      inputMessage: "请把这段改写得更克制",
      targetPageId: "page_target_1",
    });

    expect(result.status).toBe("completed");
    expect(result.medium.deliveryTarget).toBe("page_staged_write");
    expect(result.exportResult?.stagedWriteId).toBe("staged_1");
    expect(service.exportResult).toHaveBeenCalledTimes(1);
    expect(service.finalize).toHaveBeenCalledTimes(1);
  });

  it("qa_assistant 经临时对话 return_inline运行", async () => {
    const service = makeServiceStub();
    const runner = makeRunner(service);

    const result = await runner.run({
      agent: "qa_assistant",
      accountId: "acc_1",
      source: { kind: "session", sourceSessionId: "sess_1" },
    inputMessage: "这个设定里主角的年龄是多少",
    });

    expect(result.status).toBe("completed");
    expect(result.medium.deliveryTarget).toBe("return_inline");
    expect(service.exportResult).not.toHaveBeenCalled();
  });

  it("未知助手类型在运行前抛 PromptAgentRunError", async () => {
    const service = makeServiceStub();
    const runner = makeRunner(service);

    await expect(
      runner.run({
        agent: "nope",
        accountId: "acc_1",
        source: { kind: "session", sourceSessionId: "sess_1" },
        inputMessage: "x",
      }),
    ).rejects.toBeInstanceOf(PromptAgentRunError);

    expect(service.create).not.toHaveBeenCalled();
  });
});
