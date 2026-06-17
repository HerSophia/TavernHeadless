import { describe, expect, it } from "vitest";

import {
  PROMPT_AGENT_DEFINITIONS,
  buildPromptAgentTemporaryRequest,
  getPromptAgentDefinition,
  resolvePromptAgentKindFromLegacyMode,
} from "../prompt-agent-definitions.js";

describe("PromptAgent definitions", () => {
  it("draft_assistant 是用户可见，默认临时对话 + return_inline", () => {
    const def = getPromptAgentDefinition("draft_assistant");
    expect(def.audience).toBe("user_visible");
    expect(def.medium.kind).toBe("temporary_conversation");
    expect(def.medium.deliveryTarget).toBe("return_inline");
  });

  it("revision_assistant 是内部辅助，默认临时对话+ page_staged_write", () => {
  const def = getPromptAgentDefinition("revision_assistant");
    expect(def.audience).toBe("internal");
    expect(def.medium.deliveryTarget).toBe("page_staged_write");
  });

  it("qa_assistant 默认临时对话 + return_inline", () => {
    const def =getPromptAgentDefinition("qa_assistant");
    expect(def.medium.kind).toBe("temporary_conversation");
    expect(def.medium.deliveryTarget).toBe("return_inline");
  });

  it("三类 Agent 都不使用 single_call 或 background_job", () => {
    for (const def of Object.values(PROMPT_AGENT_DEFINITIONS)) {
      expect(def.medium.kind).toBe("temporary_conversation");
    }
  });
});

describe("旧 prompt mode 兼容映射", () => {
  it("旧名称解析为对应 PromptAgentKind", () => {
    expect(resolvePromptAgentKindFromLegacyMode("draft")).toBe("draft_assistant");
    expect(resolvePromptAgentKindFromLegacyMode("revision")).toBe("revision_assistant");
    expect(resolvePromptAgentKindFromLegacyMode("revise")).toBe("revision_assistant");
    expect(resolvePromptAgentKindFromLegacyMode("qa")).toBe("qa_assistant");
    expect(resolvePromptAgentKindFromLegacyMode("question_answer")).toBe("qa_assistant");
  });

  it("大小写与空白不敏感", () => {
    expect(resolvePromptAgentKindFromLegacyMode("  Draft  ")).toBe("draft_assistant");
  });

  it("未知旧名称返回 undefined", () => {
    expect(resolvePromptAgentKindFromLegacyMode("unknown_mode")).toBeUndefined();
  });
});

describe("buildPromptAgentTemporaryRequest", () => {
  it("draft_assistant 组装出 return_inline 的临时对话请求", () => {
    const request =buildPromptAgentTemporaryRequest("draft_assistant", {
      accountId: "acc_1",
      source: { kind: "session", sourceSessionId: "sess_1" },
      inputMessage: "帮我起草",
    });

    expect(request.accountId).toBe("acc_1");
    expect(request.medium.kind).toBe("temporary_conversation");
    expect(request.medium.deliveryTarget).toBe("return_inline");
    expect(request.spec.id).toBe("prompt_agent:draft_assistant");
    expect(request.spec.medium?.deliveryTarget).toBe("return_inline");
    expect(request.inputMessage).toBe("帮我起草");
  });

  it("revision_assistant 携带 targetPageId 走 page_staged_write", () => {
    const request = buildPromptAgentTemporaryRequest("revision_assistant", {
      accountId: "acc_1",
      source: { kind: "session", sourceSessionId: "sess_1" },
      inputMessage: "帮我修订",
      targetPageId: "page_target_1",
    });

    expect(request.medium.deliveryTarget).toBe("page_staged_write");
    expect(request.targetPageId).toBe("page_target_1");
  });

  it("支持显式覆盖投递目标", () => {
    const request =buildPromptAgentTemporaryRequest("draft_assistant", {
      accountId: "acc_1",
      source: { kind: "project", projectId: "proj_1" },
      inputMessage: "研究一下",
      deliveryTargetOverride: "derived_output",
    });

    expect(request.medium.deliveryTarget).toBe("derived_output");
    expect(request.source.kind).toBe("project");
  });
});
