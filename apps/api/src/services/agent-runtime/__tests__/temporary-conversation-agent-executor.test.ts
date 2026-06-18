import { describe, expect, it, vi } from "vitest";

import {
  TemporaryConversationAgentExecutor,
  type TemporaryConversationAgentRequest,
  type TemporaryConversationAgentService,
} from "../temporary-conversation-agent-executor.js";
import {
  AgentOutputDispatcher,
  type DerivedOutputSink,
  type ProjectInboxSink,
  type SessionStateProposalSink,
} from "../agent-output-dispatcher.js";
import type { InlineAgentSpec } from "../inline-agent-types.js";
import type {
  TemporaryConversationExportResult,
  TemporaryConversationHandle,
  TemporaryConversationResult,
} from "../../temporary-conversation-types.js";
import type { DerivedOutputRecord } from "../../derived-output-service.js";
import type { ProjectInboxItemRecord} from "../../project-inbox-service.js";

const spec: InlineAgentSpec = {
  id: "inline:draft_assistant",
  roleKind: "director",
  phase: "pre_response",
  stabilityHint: "floor",
  failurePolicy: "fail_open",
};

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
    cleanedAt: null,
  };
}

function makeResult(): TemporaryConversationResult {
  return {
    conversationId: "conv_1",
    branchId: "main",
    floorId: "floor_1",
    floorNo: 1,
    pageId: "page_out_1",
    text: "draft text",
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

function makeDerivedOutputRecord(): DerivedOutputRecord {
  const now = Date.now();
  return {
    id: "dout_1",
    workspaceId: "ws_1",
    projectId: "proj_1",
    accountId: "acc_1",
    ownerAccountId: "acc_1",
    ownerClientId: null,
    sourceSessionId: null,
    sourceFloorId: null,
    sourcePageId: null,
    domain: "draft",
    value: { text: "draft text" },
    status: "draft",
    createdAt: now,
    updatedAt: now,
  };
}

function makeInboxRecord(): ProjectInboxItemRecord {
  const now = Date.now();
  return {
    id: "pinbox_1",
    workspaceId: "ws_1",
    projectId: "proj_1",
    accountId: "acc_1",
    senderAccountId: "acc_1",
    senderClientId: null,
    type: "draft_suggestion",
    title: null,
    payload: { text: "draft text" },
    sourceEventId: null,
    sourceSessionId: null,
    sourceFloorId: null,
    sourcePageId: null,
    status: "pending",
    decidedByAccountId: null,
    decidedByClientId: null,
    decidedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function makeDispatcher(overrides?: {
  derivedOutput?: DerivedOutputSink;
  projectInbox?: ProjectInboxSink;
  sessionStateProposal?: SessionStateProposalSink;
}): AgentOutputDispatcher {
  return new AgentOutputDispatcher({
    derivedOutput: overrides?.derivedOutput,
    projectInbox: overrides?.projectInbox,
    sessionStateProposal: overrides?.sessionStateProposal,
  });
}

function makeRequest(
  overrides: Partial<TemporaryConversationAgentRequest> = {},
): TemporaryConversationAgentRequest {
  return {
    accountId: "acc_1",
    spec,
    medium: {
      kind: "temporary_conversation",
      purpose: "draft",
      deliveryTarget: "return_inline",
    },
    source: { kind: "session", sourceSessionId: "sess_1" },
    inputMessage: "请给我一个草稿",
    ...overrides,
  };
}

describe("TemporaryConversationAgentExecutor", () => {
  it("return_inline：respond 后 finalize 且不导出", async () => {
    const service = makeServiceStub();
    const executor = new TemporaryConversationAgentExecutor(service);

    const result = await executor.execute(makeRequest());

    expect(result.status).toBe("completed");
    expect(result.conversationId).toBe("conv_1");
    expect(result.result?.text).toBe("draft text");
    expect(result.exportResult).toBeUndefined();
    expect(result.dispatchResult).toBeUndefined();
    expect(service.exportResult).not.toHaveBeenCalled();
    expect(service.finalize).toHaveBeenCalledTimes(1);
    expect(service.discard).not.toHaveBeenCalled();
  });

  it("page_staged_write：respond 后导出并 finalize", async () => {
    const service = makeServiceStub();
    const executor = new TemporaryConversationAgentExecutor(service);

    const result = await executor.execute(
      makeRequest({
        medium: {
          kind: "temporary_conversation",
          purpose: "agent_assist",
          deliveryTarget: "page_staged_write",
        },
        targetPageId: "page_target_1",
      }),
    );

    expect(result.status).toBe("completed");
    expect(result.exportResult?.stagedWriteId).toBe("staged_1");
    expect(service.exportResult).toHaveBeenCalledTimes(1);
    expect(service.finalize).toHaveBeenCalledTimes(1);
  });

  it("project 来源走 createFromProject", async () => {
    const service = makeServiceStub();
    const executor = new TemporaryConversationAgentExecutor(service);

    await executor.execute(
      makeRequest({
        source: { kind: "project", projectId: "proj_1" },
      }),
    );

    expect(service.createFromProject).toHaveBeenCalledTimes(1);
    expect(service.create).not.toHaveBeenCalled();
  });

  it("respond 失败时 discard 并返回 failed", async () => {
    const service = makeServiceStub({
      respond: vi.fn(async () => {
        throw Object.assign(new Error("llm boom"), { code: "llm_error" });
      }),
    });
    const executor = new TemporaryConversationAgentExecutor(service);

    const result = await executor.execute(makeRequest());

    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("llm_error");
    expect(service.discard).toHaveBeenCalledTimes(1);
    expect(service.finalize).not.toHaveBeenCalled();
  });

  it("未注入 dispatcher时 derived_output 在创建对话前直接拒绝", async () => {
    const service = makeServiceStub();
    const executor = new TemporaryConversationAgentExecutor(service);

    await expect(
      executor.execute(
        makeRequest({
          medium: {
            kind: "temporary_conversation",
            deliveryTarget: "derived_output",
          },
          derivedOutput: { projectId: "proj_1", domain: "draft" },
        }),
      ),
    ).rejects.toMatchObject({ code: "temporary_conversation_delivery_target_not_supported" });

    expect(service.create).not.toHaveBeenCalled();
    expect(service.respond).not.toHaveBeenCalled();
  });

  it("page_staged_write 缺少 targetPageId 在创建对话前直接拒绝", async () => {
    const service = makeServiceStub();
    const executor = new TemporaryConversationAgentExecutor(service);

    await expect(
      executor.execute(
        makeRequest({
          medium: {
            kind: "temporary_conversation",
            deliveryTarget: "page_staged_write",
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "temporary_conversation_target_page_required" });

    expect(service.create).not.toHaveBeenCalled();
  });

  it("derived_output 经 dispatcher 委托 DerivedOutputService.create", async () => {
    const service = makeServiceStub();
    const createSink =vi.fn(() => makeDerivedOutputRecord());
    const dispatcher = makeDispatcher({ derivedOutput: { create: createSink } });
    const executor = new TemporaryConversationAgentExecutor(service, dispatcher);

    const result = await executor.execute(
      makeRequest({
        source: { kind: "project", projectId: "proj_1" },
        medium: {
          kind: "temporary_conversation",
          purpose: "research",
          deliveryTarget: "derived_output",
        },
        derivedOutput: { projectId: "proj_1", domain: "draft" },
      }),
    );

    expect(result.status).toBe("completed");
    expect(result.dispatchResult).toMatchObject({ target: "derived_output" });
    expect(createSink).toHaveBeenCalledTimes(1);
   expect(createSink).toHaveBeenCalledWith(
      expect.objectContaining({
        actorAccountId: "acc_1",
        projectId: "proj_1",
        domain: "draft",
        value: { text: "draft text" },
      }),
    );
    expect(service.finalize).toHaveBeenCalledTimes(1);
    expect(service.exportResult).not.toHaveBeenCalled();
  });

  it("project_inbox 经 dispatcher 委托 ProjectInboxService.create", async () => {
    const service = makeServiceStub();
    const createSink = vi.fn(() => makeInboxRecord());
    const dispatcher = makeDispatcher({ projectInbox: { create: createSink } });
    const executor = new TemporaryConversationAgentExecutor(service, dispatcher);

    const result = await executor.execute(
      makeRequest({
        source: { kind: "project", projectId: "proj_1" },
        medium: {
          kind: "temporary_conversation",
          deliveryTarget: "project_inbox",
        },
        projectInbox: { projectId: "proj_1", type: "draft_suggestion" },
      }),
    );

    expect(result.status).toBe("completed");
    expect(result.dispatchResult).toMatchObject({ target: "project_inbox" });
    expect(createSink).toHaveBeenCalledTimes(1);
    expect(createSink).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj_1",
        type: "draft_suggestion",
        payload: { text: "draft text" },
      }),
    );
  });

  it("session_state_proposal 经 dispatcher 进入 proposal sink，summary 默认取输出文本", async () => {
    const service = makeServiceStub();
    const stageSink = vi.fn(() =>({ proposalId: "prop_1" }));
    const dispatcher = makeDispatcher({ sessionStateProposal: { stage: stageSink } });
    const executor = new TemporaryConversationAgentExecutor(service, dispatcher);

    const result = await executor.execute(
      makeRequest({
        medium: {
          kind: "temporary_conversation",
          deliveryTarget: "session_state_proposal",
        },
      }),
    );

    expect(result.status).toBe("completed");
    expect(result.dispatchResult).toMatchObject({ target: "session_state_proposal", proposalId: "prop_1" });
    expect(stageSink).toHaveBeenCalledTimes(1);
    expect(stageSink).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "acc_1",
        sessionId: "sess_1",
        summary: "draft text",
      }),
    );
  });

  it("session_state_proposal 在 project 来源下创建对话前直接拒绝", async () => {
    const service = makeServiceStub();
    const dispatcher =makeDispatcher({ sessionStateProposal: { stage: vi.fn(() => ({ proposalId: "prop_1" })) } });
    const executor = new TemporaryConversationAgentExecutor(service, dispatcher);

    await expect(
      executor.execute(
        makeRequest({
          source: { kind: "project", projectId: "proj_1" },
          medium: {
            kind: "temporary_conversation",
            deliveryTarget: "session_state_proposal",
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "temporary_conversation_delivery_source_invalid" });

    expect(service.create).not.toHaveBeenCalled();
    expect(service.createFromProject).not.toHaveBeenCalled();
  });
  it("prompt_runtime_injection request scope returns descriptor with output text as content", async () => {
    const service = makeServiceStub();
    const dispatcher = makeDispatcher();
    const executor = new TemporaryConversationAgentExecutor(service, dispatcher);

    const result = await executor.execute(
      makeRequest({
        medium: {
          kind: "temporary_conversation",
          deliveryTarget: "prompt_runtime_injection",
        },
        promptRuntimeInjection: {
          targetSessionId: "sess_main_1",
          placement: "after_history",
        },
      }),
    );

    expect(result.status).toBe("completed");
    expect(result.dispatchResult).toMatchObject({
      target: "prompt_runtime_injection",
      scope: "request",
    });
    if (result.dispatchResult?.target === "prompt_runtime_injection") {
      expect(result.dispatchResult.injection.content).toBe("draft text");
      expect(result.dispatchResult.injection.sourceKind).toBe("agent_injection");
      expect(result.dispatchResult.injection.targetSessionId).toBe("sess_main_1");
    }
  });

  it("prompt_runtime_injection persist scope is rejected before creating conversation", async () => {
    const service = makeServiceStub();
    const dispatcher = makeDispatcher();
    const executor = new TemporaryConversationAgentExecutor(service, dispatcher);

    await expect(
      executor.execute(
        makeRequest({
          medium: {
            kind: "temporary_conversation",
            deliveryTarget: "prompt_runtime_injection",
          },
          promptRuntimeInjection: {
            targetSessionId: "sess_main_1",
            scope: "session",
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "temporary_conversation_injection_persist_not_allowed" });

    expect(service.create).not.toHaveBeenCalled();
    expect(service.createFromProject).not.toHaveBeenCalled();
  });



  it("derived_output 缺少 projectId 在创建对话前直接拒绝", async () => {
    const service = makeServiceStub();
    const dispatcher = makeDispatcher({ derivedOutput: { create: vi.fn(() => makeDerivedOutputRecord()) } });
    const executor =new TemporaryConversationAgentExecutor(service, dispatcher);

    await expect(
    executor.execute(
        makeRequest({
          source: { kind: "project", projectId: "proj_1" },
          medium: {
            kind: "temporary_conversation",
            deliveryTarget: "derived_output",
          },
          derivedOutput: { projectId: "", domain: "draft" },
        }),
      ),
    ).rejects.toMatchObject({ code: "temporary_conversation_delivery_params_invalid" });

    expect(service.create).not.toHaveBeenCalled();
  });

  it("client_data 在创建对话前直接拒绝并标记未激活", async () => {
    const service = makeServiceStub();
    const dispatcher = makeDispatcher();
    const executor = new TemporaryConversationAgentExecutor(service, dispatcher);

    await expect(
      executor.execute(
        makeRequest({
          medium: {
            kind: "temporary_conversation",
            deliveryTarget: "client_data",
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "agent_output_target_not_activated" });

    expect(service.create).not.toHaveBeenCalled();
  });

  it("completed 时审计快照记录最小字段与 operation log", async () => {
    const service = makeServiceStub();
    const executor = new TemporaryConversationAgentExecutor(service);

    const lineage = { rootRunId: "root_1", sourceAgentRunId: "run_1" };
    const result = await executor.execute(
      makeRequest({
        medium: {
          kind: "temporary_conversation",
          purpose: "draft",
          deliveryTarget: "return_inline",
        },
        lineage,
      }),
    );

    const audit = result.auditSnapshot;
    expect(audit.conversationId).toBe("conv_1");
    expect(audit.status).toBe("completed");
    expect(audit.purpose).toBe("draft");
    expect(audit.deliveryTarget).toBe("return_inline");
    expect(audit.retentionPolicy).toBe("delete_on_finalize");
    expect(audit.lineage).toEqual(lineage);
    expect(audit.outputRef).toBeUndefined();
    expect(audit.traceSummary).toMatchObject({
      kind: "temporary_conversation",
      deliveryTarget: "return_inline",
      status: "completed",
    });
    // return_inline 不落库，不产生 output_dispatched 条目。
    expect(audit.operationLog.map((entry) => entry.type)).toEqual([
      "conversation_created",
      "agent_responded",
      "finalized",
    ]);
    expect(audit.operationLog.every((entry) => entry.category === "temporary_conversation_agent")).toBe(true);
  });

  it("page_staged_write 审计快照记录 outputRef 与 output_dispatched 条目", async () => {
    const service = makeServiceStub();
    const executor = new TemporaryConversationAgentExecutor(service);

    const result = await executor.execute(
      makeRequest({
        medium: {
          kind: "temporary_conversation",
          purpose: "agent_assist",
          deliveryTarget: "page_staged_write",
        },
        targetPageId: "page_target_1",
      }),
    );

    const audit = result.auditSnapshot;
    expect(audit.outputRef).toBe("staged_1");
    const types = audit.operationLog.map((entry) => entry.type);
    expect(types).toEqual([
      "conversation_created",
      "agent_responded",
      "output_dispatched",
      "finalized",
    ]);
    const dispatchedEntry = audit.operationLog.find((entry) =>entry.type === "output_dispatched");
    expect(dispatchedEntry?.outputRef).toBe("staged_1");
    expect(dispatchedEntry?.deliveryTarget).toBe("page_staged_write");
  });

  it("derived_output 审计快照 outputRef 取 record id", async () => {
    const service = makeServiceStub();
    const dispatcher = makeDispatcher({ derivedOutput: { create: vi.fn(() => makeDerivedOutputRecord()) } });
    const executor = new TemporaryConversationAgentExecutor(service, dispatcher);

    const result = await executor.execute(
      makeRequest({
        source: { kind: "project", projectId: "proj_1" },
        medium: {
          kind: "temporary_conversation",
          purpose: "research",
          deliveryTarget: "derived_output",
        },
        derivedOutput:{ projectId: "proj_1", domain: "draft" },
      }),
    );

    expect(result.auditSnapshot.outputRef).toBe("dout_1");
  });

  it("失败时审计快照状态为 failed 并含 discarded 条目", async () => {
    const service = makeServiceStub({
      respond: vi.fn(async () => {
        throw Object.assign(new Error("llm boom"), { code: "llm_error" });
      }),
    });
    const executor = new TemporaryConversationAgentExecutor(service);

    const result = await executor.execute(makeRequest());

    const audit = result.auditSnapshot;
    expect(audit.status).toBe("failed");
    expect(audit.traceSummary.status).toBe("failed");
    expect(audit.traceSummary.rejectionCode).toBe("llm_error");
    const types = audit.operationLog.map((entry) => entry.type);
    expect(types).toEqual(["conversation_created", "discarded"]);
    const discardedEntry = audit.operationLog.find((entry) => entry.type === "discarded");
    expect(discardedEntry?.detail).toBe("llm_error");
  });
});
