import { describe, expect, it } from "vitest";

import {
  readAgentCallConfigFormState,
  writeAgentCallConfigFormState,
} from "./agent-call-config";

describe("agent-call-config", () => {
  it("reads defaults from an empty config", () => {
    expect(readAgentCallConfigFormState(undefined)).toMatchObject({
      mediumKind: "single_call",
      deliveryTarget: "return_inline",
      purpose: "",
      targetPageId: "",
    });
  });

  it("writes medium and page staged target fields while preserving unknown fields", () => {
    const next = writeAgentCallConfigFormState(
      {
        custom: { keep: true },
        medium: { kind: "single_call", deliveryTarget: "return_inline", customMedium: "keep" },
        temporaryConversationRequest: {
          spec: { id: "agent" },
        },
      },
      {
        ...readAgentCallConfigFormState(undefined),
        mediumKind: "temporary_conversation",
        deliveryTarget: "page_staged_write",
        purpose: "agent_assist",
        targetPageId: "page_1",
        sourceOutputPageId: "page_source",
        reason: "draft update",
      },
    );

    expect(next).toMatchObject({
      custom: { keep: true },
      medium: {
        kind: "temporary_conversation",
        deliveryTarget: "page_staged_write",
        customMedium: "keep",
        purpose: "agent_assist",
      },
      temporaryConversationRequest: {
        spec: { id: "agent" },
        targetPageId: "page_1",
        sourceOutputPageId: "page_source",
        reason: "draft update",
      },
    });
  });

  it("writes background job binding fields", () => {
    const next = writeAgentCallConfigFormState(undefined, {
      ...readAgentCallConfigFormState(undefined),
      mediumKind: "background_job",
      deliveryTarget: "derived_output",
      agentBindingId: "binding_1",
      triggerReason: "node_graph.agent_call",
      derivedOutputProjectId: "project_1",
      derivedOutputDomain: "graph",
    });

    expect(next).toEqual({
      medium: { kind: "background_job", deliveryTarget: "derived_output" },
      agentBindingId: "binding_1",
      triggerReason: "node_graph.agent_call",
      temporaryConversationRequest: {
        derivedOutput: { projectId: "project_1", domain: "graph" },
      },
    });
  });
});
