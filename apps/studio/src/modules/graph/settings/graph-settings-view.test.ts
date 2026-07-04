import { describe, expect, it } from "vitest";
import type { NodeGraphDocument } from "@tavern/core/node-graph";

import { buildAgentExecutionItems, buildGraphSettingsDiagnostics, buildGraphSettingsView } from "./graph-settings-view";

function baseDocument(overrides: Partial<NodeGraphDocument> = {}): NodeGraphDocument {
  return {
    schemaVersion: 2,
    graphId: "g_settings",
    name: "Settings",
    mode: "native_graph",
    policies: {},
    nodes: [
      { id: "input", type: "source.user_input", typeVersion: "1", phase: "pre_response" },
      { id: "agent", type: "agent.call", typeVersion: "1", phase: "pre_response" },
    ],
    edges: [],
    ...overrides,
  };
}

describe("graph settings view", () => {
  it("derives required permissions from registry and marks missing declarations", () => {
    const view = buildGraphSettingsView(baseDocument());
    const agentRun = view.permissions.required.find((item) => item.permission === "project.agent.run");

    expect(agentRun?.declared).toBe(false);
    expect(agentRun?.requiredBy.map((item) => item.nodeId)).toEqual(["agent"]);
    expect(view.permissions.missingRequired).toContain("project.agent.run");
  });

  it("keeps outputTargets undefined distinct from an empty array", () => {
    const unscoped = buildGraphSettingsView(baseDocument());
    expect(unscoped.permissions.outputTargetsMode).toBe("unscoped");

    const denyAll = buildGraphSettingsView(baseDocument({ permissions: { outputTargets: [] } }));
    expect(denyAll.permissions.outputTargetsMode).toBe("deny_all");
  });

  it("reports persistent delivery target policy diagnostics", () => {
    const diagnostics = buildGraphSettingsDiagnostics(baseDocument({
      nodes: [{
        id: "agent",
        type: "agent.call",
        typeVersion: "1",
        phase: "pre_response",
        config: { medium: { kind: "single_call", deliveryTarget: "derived_output" } },
      }],
    }));

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain("studio_graph_agent_call_persistent_output_policy_missing");
  });

  it("summarizes agent execution source and toggleable generation params", () => {
    const items = buildAgentExecutionItems(baseDocument({
      nodes: [{
        id: "narrator",
        type: "narration.narrator",
        typeVersion: "1",
        phase: "response",
        config: {
          execution: {
            modelSource: { mode: "llm_profile", profileId: "prof_1" },
            modelId: "model-a",
            generation: {
              temperature: { enabled: false, value: 1 },
              maxOutputTokens: { enabled: true, value: 2048 },
            },
          },
        },
      }],
    }));

    expect(items).toHaveLength(1);
    expect(items[0]?.sourceMode).toBe("node_override");
    expect(items[0]?.profileId).toBe("prof_1");
    expect(items[0]?.modelId).toBe("model-a");
    expect(items[0]?.generationParams.find((item) => item.key === "temperature")?.enabled).toBe(false);
    expect(items[0]?.generationParams.find((item) => item.key === "maxOutputTokens")?.value).toBe(2048);
  });

  it("compares budget usage with effective graph overrides", () => {
    const view = buildGraphSettingsView(baseDocument({
      budgets: { maxNodesExecuted: 1 },
      nodes: [
        { id: "a", type: "source.user_input", typeVersion: "1", phase: "pre_response" },
        { id: "b", type: "source.chat_history", typeVersion: "1", phase: "pre_response" },
      ],
    }));

    const maxNodes = view.budgets.runtime.find((item) => item.key === "maxNodesExecuted");
    expect(maxNodes?.effectiveLimit).toBe(1);
    expect(maxNodes?.currentUsage).toBe(2);
    expect(maxNodes?.exceeded).toBe(true);
  });
});
