import { describe, expect, it } from "vitest";

import { AgentInvocationService } from "../agent-invocation-service.js";

describe("AgentInvocationService", () => {
  const service = new AgentInvocationService();

  it("生成 pre_response 计划，包含第一批 pre Agent 且全部 fail_open", () => {
    const plan = service.planForSource({
      kind: "respond_pre_response",
      sessionId: "sess_1",
      floorId: "floor_1",
    });

    expect(plan.phase).toBe("pre_response");
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0]?.parallel).toBe(true);

    const roleKinds = plan.groups[0]?.agents.map((spec) => spec.roleKind) ?? [];
    expect(roleKinds).toEqual([
      "scene_state",
      "memory_selection",
      "worldbook_focus",
      "director",
      "agency_guard",
    ]);
    expect(plan.groups[0]?.agents.every((spec) => spec.failurePolicy === "fail_open")).toBe(true);
  });

  it("生成 post_response 计划，包含第一批 verifier 与 proposal Agent", () => {
    const plan = service.planForSource({
      kind: "respond_post_response",
      sessionId: "sess_1",
      floorId: "floor_1",
      pageId: "page_1",
    });

    expect(plan.phase).toBe("post_response");
    const roleKinds = plan.groups[0]?.agents.map((spec) => spec.roleKind) ?? [];
    expect(roleKinds).toEqual([
      "continuity_verifier",
      "agency_guard",
      "style_verifier",
      "state_proposal",
      "memory_proposal",
    ]);
  });

  it("计划中不包含 aggregator，aggregator 由上层单独调用", () => {
    const plan = service.planForSource({
      kind:"respond_pre_response",
      sessionId: "sess_1",
      floorId: "floor_1",
  });
    const ids = plan.groups.flatMap((group) => group.agents.map((spec) => spec.id));
    expect(ids).not.toContain("inline:aggregator");
  });
});
