import { describe, expect, it } from "vitest";

import {
  AgentPermissionPolicyError,
  assertAgentScopeKind,
  assertAllowedOutputTargets,
  assertOutputTargetsNarrowing,
  assertGrantsNarrowing,
  assertSubscriptionsNarrowing,
  assertMcpNarrowing,
} from "../agent-permission-policy.js";

describe("AgentPermissionPolicy", () => {
  it("accepts valid scope kinds and output targets", () => {
    expect(assertAgentScopeKind("project")).toBe("project");
    expect(assertAllowedOutputTargets(["derived_output", "project_inbox"]))
      .toEqual(["derived_output", "project_inbox"]);
  });

  it("rejects forbidden output targets", () => {
    expect(() => assertAllowedOutputTargets(["session_messages"]))
      .toThrowError(AgentPermissionPolicyError);
    expect(() => assertAllowedOutputTargets(["session_messages"]))
      .toThrow(/reserved for the main narrative path/);
  });

  it("rejects output target expansion", () => {
    expect(() => assertOutputTargetsNarrowing(["derived_output"], ["derived_output", "project_inbox"]))
      .toThrowError(AgentPermissionPolicyError);
  });

  it("rejects grant expansion", () => {
    expect(() => assertGrantsNarrowing(
      { actions: ["project.agent.read"] },
      { actions: ["project.agent.read", "project.agent.run"] },
    )).toThrowError(AgentPermissionPolicyError);
  });

  it("rejects subscription expansion", () => {
    expect(() => assertSubscriptionsNarrowing(["floor.committed"], ["floor.committed", "message.created"]))
      .toThrowError(AgentPermissionPolicyError);
  });

  it("rejects mcp expansion", () => {
    expect(() => assertMcpNarrowing(
      { mcp_a: { allowedTools: ["search"] } },
      { mcp_a: { allowedTools: ["search", "delete_file"] } },
    )).toThrowError(AgentPermissionPolicyError);
  });
});
