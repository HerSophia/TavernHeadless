import { describe, expect, it, vi } from "vitest";

import {
  AgentOutputDispatcher,
  AgentOutputDispatchError,
  type DerivedOutputSink,
  type PageStagedWriteSink,
  type ProjectInboxSink,
  type PromptRuntimeInjectionPersistSink,
  type SessionStateProposalSink,
} from "../agent-output-dispatcher.js";

function makePageStagedWriteSink(): PageStagedWriteSink {
  return {
    exportResult: vi.fn(async () => ({
      conversationId: "conv_1",
      target: "page_staged_write" as const,
      stagedWriteId: "staged_1",
      targetPageId: "page_target_1",
      sourcePageId: "page_out_1",
      createdAt: Date.now(),
      status: "staged" as const,
    })),
  };
}

function makeDerivedOutputSink(): DerivedOutputSink {
  return {
    create: vi.fn(() => ({
      id: "dout_1",
      workspaceId: "ws_1",
      projectId: "proj_1",
      accountId: "acc_1",
      ownerAccountId: "acc_1",
      ownerClientId: null,
      sourceSessionId: null,
      sourceFloorId: null,
      sourcePageId: null,
      domain: "research",
      value: { text: "x" },
      status: "draft" as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })),
  };
}

function makeProjectInboxSink(): ProjectInboxSink {
  return {
    create: vi.fn(() => ({
      id: "pinbox_1",
      workspaceId:"ws_1",
      projectId: "proj_1",
      accountId: "acc_1",
      senderAccountId: "acc_1",
      senderClientId: null,
      type: "agent_suggestion",
      title: null,
      payload: { text: "x" },
      sourceEventId: null,
      sourceSessionId: null,
      sourceFloorId: null,
      sourcePageId: null,
      status: "pending" as const,
      decidedByAccountId: null,
      decidedByClientId: null,
      decidedAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })),
  };
}

function makeSessionStateProposalSink(): SessionStateProposalSink {
  return {
    stage: vi.fn(() => ({ proposalId: "prop_1" })),
  };
}

describe("AgentOutputDispatcher", () => {
  it("return_inline 直接回传，不调用任何持久 sink", async () => {
    const pageStagedWrite = makePageStagedWriteSink();
    const dispatcher = new AgentOutputDispatcher({ pageStagedWrite });

    const result = await dispatcher.dispatch({
      target: "return_inline",
      payload: { text: "draft text" },
    });

    expect(result.target).toBe("return_inline");
    if (result.target === "return_inline") {
      expect(result.inline.text).toBe("draft text");
    }
    expect(pageStagedWrite.exportResult).not.toHaveBeenCalled();
  });

  it("page_staged_write 委托到 exportResult", async () => {
    const pageStagedWrite = makePageStagedWriteSink();
    const dispatcher = new AgentOutputDispatcher({ pageStagedWrite });

    const result = await dispatcher.dispatch({
      target: "page_staged_write",
      accountId: "acc_1",
      conversationId: "conv_1",
      targetPageId: "page_target_1",
    });

    expect(result.target).toBe("page_staged_write");
    expect(pageStagedWrite.exportResult).toHaveBeenCalledTimes(1);
  });

  it("derived_output 委托到 DerivedOutputService.create", async () => {
    const derivedOutput = makeDerivedOutputSink();
    const dispatcher = new AgentOutputDispatcher({ derivedOutput });

    const result = await dispatcher.dispatch({
      target: "derived_output",
      actorAccountId: "acc_1",
      projectId: "proj_1",
      domain: "research",
      value: { text: "x" },
    });

    expect(result.target).toBe("derived_output");
    expect(derivedOutput.create).toHaveBeenCalledTimes(1);
  });

  it("project_inbox 委托到 ProjectInboxService.create", async () => {
    const projectInbox = makeProjectInboxSink();
    const dispatcher = new AgentOutputDispatcher({ projectInbox });

    const result = await dispatcher.dispatch({
      target: "project_inbox",
      actorAccountId: "acc_1",
      projectId: "proj_1",
      type: "agent_suggestion",
      payload: { text: "x" },
    });

    expect(result.target).toBe("project_inbox");
    expect(projectInbox.create).toHaveBeenCalledTimes(1);
  });

  it("session_state_proposal 委托到注入的 proposal sink", async () => {
    const sessionStateProposal = makeSessionStateProposalSink();
    const dispatcher = new AgentOutputDispatcher({ sessionStateProposal });

    const result = await dispatcher.dispatch({
      target: "session_state_proposal",
      accountId: "acc_1",
      sessionId: "sess_1",
      summary: "建议更新状态",
    });

    expect(result.target).toBe("session_state_proposal");
    if (result.target === "session_state_proposal") {
      expect(result.proposalId).toBe("prop_1");
    }
    expect(sessionStateProposal.stage).toHaveBeenCalledTimes(1);
  });

  it("client_data 在 R3 明确拒绝", async () => {
    const dispatcher = new AgentOutputDispatcher({});
    await expect(
      dispatcher.dispatch({ target: "client_data" }),
    ).rejects.toBeInstanceOf(AgentOutputDispatchError);
  });

  it("plugin_data 在 R3 明确拒绝", async () => {
    const dispatcher = new AgentOutputDispatcher({});
    await expect(
      dispatcher.dispatch({ target: "plugin_data" }),
    ).rejects.toMatchObject({ code: "agent_output_target_not_activated" });
  });

  it("未配置 sink 时抛出配置错误", async () => {
    const dispatcher = new AgentOutputDispatcher({});
    await expect(
      dispatcher.dispatch({
        target: "derived_output",
        actorAccountId: "acc_1",
        projectId: "proj_1",
        domain: "research",
      }),
    ).rejects.toMatchObject({ code: "agent_output_sink_not_configured" });
  });

  function makePromptRuntimeInjectionSink(): PromptRuntimeInjectionPersistSink {
    return {
      createSessionInjection: vi.fn(() => ({ id: "inj_session_1" })),
      createBranchInjection: vi.fn(() => ({ id: "inj_branch_1" })),
    };
  }

  it("prompt_runtime_injection defaults to request scope without persisting",async () => {
    const promptRuntimeInjection = makePromptRuntimeInjectionSink();
    const dispatcher = new AgentOutputDispatcher({ promptRuntimeInjection });

    const result = await dispatcher.dispatch({
      target: "prompt_runtime_injection",
      accountId: "acc_1",
      targetSessionId: "sess_1",
      agentTypeId: "director",
      agentRunId: "run_1",
      lineage: { rootRunId: "root_1" },
      injection: {
        sourceKind: "agent_injection",
        title: "Director hint",
        content: "stay focused",
      placement: "after_history",
      },
    });

    expect(result.target).toBe("prompt_runtime_injection");
    if (result.target === "prompt_runtime_injection") {
      expect(result.scope).toBe("request");
      expect(result.injection.sourceKind).toBe("agent_injection");
      expect(result.injection.agentTypeId).toBe("director");
      expect(result.injection.agentRunId).toBe("run_1");
      expect(result.injection.lineage?.rootRunId).toBe("root_1");
    }
    expect(promptRuntimeInjection.createSessionInjection).not.toHaveBeenCalled();
    expect(promptRuntimeInjection.createBranchInjection).not.toHaveBeenCalled();
  });

  it("prompt_runtime_injection session scope persists through the sink", async () => {
    const promptRuntimeInjection = makePromptRuntimeInjectionSink();
    const dispatcher = new AgentOutputDispatcher({ promptRuntimeInjection });

    const result = await dispatcher.dispatch({
      target: "prompt_runtime_injection",
      accountId: "acc_1",
      targetSessionId: "sess_1",
      scope: "session",
   injection: {
        sourceKind: "agent_injection",
        title: "Persisted hint",
        content: "remember this",
        placement: "after_history",
      },
    });

    expect(result.target).toBe("prompt_runtime_injection");
    if (result.target === "prompt_runtime_injection" && result.scope !== "request") {
      expect(result.injectionId).toBe("inj_session_1");
    }
    expect(promptRuntimeInjection.createSessionInjection).toHaveBeenCalledTimes(1);
  });

  it("prompt_runtime_injection branch scope without targetBranchId is rejected", async() => {
    const promptRuntimeInjection = makePromptRuntimeInjectionSink();
    const dispatcher = new AgentOutputDispatcher({ promptRuntimeInjection });

    await expect(
      dispatcher.dispatch({
        target: "prompt_runtime_injection",
        accountId: "acc_1",
        targetSessionId: "sess_1",
        scope: "branch",
        injection: {
          sourceKind: "agent_injection",
          title: "x",
          content: "y",
          placement: "after_history",
        },
      }),
    ).rejects.toMatchObject({ code: "agent_injection_persist_scope_invalid" });
  });

  it("temporary conversation source cannot persist injections", async () => {
    const promptRuntimeInjection = makePromptRuntimeInjectionSink();
    const dispatcher = new AgentOutputDispatcher({ promptRuntimeInjection });

    await expect(
      dispatcher.dispatch({
        target: "prompt_runtime_injection",
        accountId: "acc_1",
        targetSessionId: "sess_1",
        scope: "session",
        sourceMediumKind: "temporary_conversation",
        injection: {
          sourceKind: "agent_injection",
          title: "x",
          content: "y",
          placement: "after_history",
        },
      }),
    ).rejects.toMatchObject({ code: "temporary_conversation_injection_persist_not_allowed" });
    expect(promptRuntimeInjection.createSessionInjection).not.toHaveBeenCalled();
  });

  it("prompt_runtime_injection rejects non agent_injection source", async () => {
    const dispatcher = new AgentOutputDispatcher({});

    await expect(
      dispatcher.dispatch({
        target: "prompt_runtime_injection",
        accountId: "acc_1",
        targetSessionId: "sess_1",
        injection: {
      sourceKind: "client_injection" as never,
          title: "x",
          content: "y",
          placement: "after_history",
        },
      }),
    ).rejects.toMatchObject({ code: "agent_injection_source_kind_invalid" });
  });
});
