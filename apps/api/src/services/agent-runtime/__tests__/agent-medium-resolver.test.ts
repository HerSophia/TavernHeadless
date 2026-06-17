import { describe, expect, it } from "vitest";

import { AgentMediumResolver } from "../agent-medium-resolver.js";
import { AgentInvocationService } from "../agent-invocation-service.js";
import type { InlineAgentSpec } from "../inline-agent-types.js";

const spec: InlineAgentSpec = {
  id: "inline:scene_state",
  roleKind: "scene_state",
  phase: "pre_response",
  stabilityHint: "floor",
  failurePolicy: "fail_open",
};

describe("AgentMediumResolver", () => {
  const resolver = new AgentMediumResolver();

  it("默认把 inline Agent 解析为 single_call + return_inline", () => {
    const medium = resolver.resolve({ spec });
    expect(medium.kind).toBe("single_call");
    expect(medium.deliveryTarget).toBe("return_inline");
  });

  it("提供 preferredMedium 时原样返回", () => {
    const medium = resolver.resolve({
      spec,
      preferredMedium: {
        kind: "temporary_conversation",
        purpose: "draft",
        deliveryTarget: "page_staged_write",
      },
    });
    expect(medium.kind).toBe("temporary_conversation");
    expect(medium.purpose).toBe("draft");
    expect(medium.deliveryTarget).toBe("page_staged_write");
  });
});

describe("AgentInvocationService medium 默认值", () => {
  const service = new AgentInvocationService();

  it("pre_response 计划项默认携带 single_call medium", () => {
    const plan =service.planForSource({
      kind: "turn_pre_response",
      mode: "respond",
      runType: "respond",
      sessionId: "sess_1",
      floorId: "floor_1",
      attemptNo: 1,
    });
    const mediums = plan.groups[0]?.agents.map((agent) => agent.medium?.kind) ?? [];
    expect(mediums.length).toBeGreaterThan(0);
    expect(mediums.every((kind) => kind === "single_call")).toBe(true);
 });

  it("post_response 计划项默认携带 single_call medium", () => {
    const plan = service.planForSource({
      kind: "turn_post_response",
      mode: "respond",
      runType: "respond",
      sessionId: "sess_1",
      floorId: "floor_1",
      attemptNo: 1,
      pageId: "page_1",
    });
    const mediums = plan.groups[0]?.agents.map((agent) => agent.medium?.deliveryTarget) ?? [];
    expect(mediums.length).toBeGreaterThan(0);
    expect(mediums.every((target) => target === "return_inline")).toBe(true);
  });
});
