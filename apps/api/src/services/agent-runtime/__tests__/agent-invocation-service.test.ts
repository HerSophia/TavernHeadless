import { describe, expect, it } from "vitest";

import { AgentInvocationService } from "../agent-invocation-service.js";

describe("AgentInvocationService", () => {
  const service = new AgentInvocationService();

  it("生成 turn_pre_response 计划，包含第一批 pre Agent 且全部 fail_open", () => {
    const plan = service.planForSource({
      kind: "turn_pre_response",
      mode: "retry_floor",
      runType: "retry_turn",
      sessionId: "sess_1",
      floorId: "floor_1",
      attemptNo: 2,
    });

    expect(plan.phase).toBe("pre_response");
    expect(plan.source).toMatchObject({ mode: "retry_floor", runType: "retry_turn", attemptNo: 2 });
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

  it("生成 turn_post_response 计划，包含第一批 verifier 与 proposal Agent", () => {
    const plan = service.planForSource({
      kind: "turn_post_response",
      mode: "regenerate",
      runType: "regenerate_page",
      sessionId: "sess_1",
      floorId: "floor_1",
      attemptNo: 1,
      pageId: "page_1",
    });

    expect(plan.phase).toBe("post_response");
    expect(plan.source).toMatchObject({ mode: "regenerate", runType: "regenerate_page", pageId: "page_1" });
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
      kind: "turn_pre_response",
      mode: "respond",
      runType: "respond",
      sessionId: "sess_1",
      floorId: "floor_1",
      attemptNo: 1,
    });
    const ids = plan.groups.flatMap((group) => group.agents.map((spec) => spec.id));
    expect(ids).not.toContain("inline:aggregator");
  });

  it("短期兼容 R1 respond_pre_response 来源", () => {
    const plan = service.planForSource({
      kind: "respond_pre_response",
      sessionId: "sess_1",
      floorId: "floor_1",
    });

    expect(plan.phase).toBe("pre_response");
  });
});
