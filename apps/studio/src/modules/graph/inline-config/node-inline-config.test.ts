import type { NodeGraphDocument, NodeGraphNode } from "@tavern/core/node-graph";
import { describe, expect, it } from "vitest";

import {
  applyInlineConfigValue,
  buildInlineConfigControls,
  readInlineConfigValue,
  summarizeInlineCondition,
} from "./node-inline-config";

function node(type: string, config?: unknown): NodeGraphNode {
  return { id: type.replaceAll(".", "_"), type, typeVersion: "1", phase: "pre_response", config };
}

function document(nodes: NodeGraphNode[]): NodeGraphDocument {
  return {
    schemaVersion: 2,
    graphId: "g",
    name: "g",
    mode: "native_graph",
    nodes,
    edges: [],
    policies: {},
  };
}

describe("inline config path helpers", () => {
  it("reads nested values and returns undefined for unknown paths", () => {
    const config = { medium: { kind: "single_call" } };
    expect(readInlineConfigValue(config, "medium.kind")).toBe("single_call");
    expect(readInlineConfigValue(config, "medium.deliveryTarget")).toBeUndefined();
  });

  it("writes to an empty config without mutating the original object", () => {
    const original = { medium: { kind: "single_call" } };
    const next = applyInlineConfigValue(original, "medium.deliveryTarget", "return_inline");
    expect(next).toEqual({ medium: { kind: "single_call", deliveryTarget: "return_inline" } });
    expect(original).toEqual({ medium: { kind: "single_call" } });
  });

  it("deletes empty string fields and cleans empty parent objects", () => {
    expect(applyInlineConfigValue({ presetRef: { presetId: "p1" } }, "presetRef.presetId", "")).toBeUndefined();
    expect(applyInlineConfigValue({ triggerReason: "old" }, "triggerReason", "")).toBeUndefined();
  });

  it("can write null for empty fields when requested", () => {
    expect(
      applyInlineConfigValue(
        { presetRef: { presetId: "p1", presetVersionId: "v1" } },
        "presetRef.presetVersionId",
        "",
        { emptyValue: "null" },
      ),
    ).toEqual({ presetRef: { presetId: "p1", presetVersionId: null } });
  });

  it("rejects array style paths", () => {
    expect(() => readInlineConfigValue({}, "items[0].name")).toThrow(/does not support arrays/);
  });
});

describe("summarizeInlineCondition", () => {
  it("summarizes common condition expressions", () => {
    expect(summarizeInlineCondition({ op: "exists", value: { source: "runtime", path: ["intent"] } })).toBe(
      "exists runtime.intent",
    );
    expect(summarizeInlineCondition({ op: "and", items: [{}, {}] })).toBe("and 2");
  });
});

describe("buildInlineConfigControls", () => {
  it("builds controls for annotation comments", () => {
    const controls = buildInlineConfigControls(node("annotation.comment", { content: "note" }));
    expect(controls.map((control) => [control.type, control.path, control.value])).toEqual([
      ["textarea", "content", "note"],
    ]);
  });

  it("builds template controls", () => {
    const controls = buildInlineConfigControls(node("compose.template_render", { template: "hello", role: "system" }));
    expect(controls.map((control) => control.path)).toEqual(["template", "role"]);
    expect(controls[1]?.options?.map((option) => option.value)).toEqual(["", "system", "user", "assistant"]);
  });

  it("builds control summaries and gate onSkip select", () => {
    const gate = node("control.gate", {
      condition: { op: "exists", value: { source: "runtime", path: ["intent"] } },
      onSkip: "use_default",
    });
    const controls = buildInlineConfigControls(gate);
    expect(controls.map((control) => [control.type, control.path])).toEqual([
      ["summary", "condition"],
      ["select", "onSkip"],
    ]);
    expect(controls[0]?.summary).toBe("exists runtime.intent");
    expect(controls[1]?.value).toBe("use_default");
  });

  it("marks a control summary as input when an incoming condition edge exists", () => {
    const branch = node("control.branch");
    const doc = document([branch, node("control.condition")]);
    doc.edges.push({
      id: "e",
      from: { nodeId: "control_condition", port: "result" },
      to: { nodeId: "control_branch", port: "condition" },
    });
    const controls = buildInlineConfigControls(branch, undefined, { document: doc });
    expect(controls[0]?.summary).toBe("input");
    expect(controls[0]?.tone).toBe("info");
  });

  it("builds agent.call controls and policy hints", () => {
    const controls = buildInlineConfigControls(
      node("agent.call", { medium: { kind: "background_job", deliveryTarget: "derived_output" } }),
      undefined,
      { policies: { allowBackgroundJobs: false, allowPersistentOutputs: false } },
    );
    expect(controls.map((control) => control.path)).toEqual([
      "medium.kind",
      "medium.deliveryTarget",
      "triggerReason",
      "execution.modelSource",
      "execution.modelId",
      "execution.generation.temperature",
      "execution.generation.topP",
      "execution.generation.maxOutputTokens",
      "execution.generation.maxContextTokens",
    ]);
    expect(controls[0]?.hintKey).toBe("graph.inlineConfig.policyWarning.backgroundJob");
    expect(controls[0]?.tone).toBe("warning");
  });

  it("builds an agent model source select from provided profiles", () => {
    const controls = buildInlineConfigControls(
      node("agent.director_plan", { execution: { modelSource: { mode: "llm_profile", profileId: "p1" } } }),
      undefined,
      { llmProfiles: [{ id: "p1", name: "GPT" }, { id: "p2", name: "Claude" }] },
    );
  const modelSource = controls.find((control) => control.path === "execution.modelSource");
    expect(modelSource?.type).toBe("model_source");
    expect(modelSource?.value).toBe("p1");
  expect(modelSource?.options?.map((option) => option.value)).toEqual(["", "p1", "p2"]);
  });

  it("keeps a selected profile visible even when it is missing from the list", () => {
    const controls = buildInlineConfigControls(
      node("agent.director_plan", { execution: { modelSource: { mode: "llm_profile", profileId: "gone" } } }),
      undefined,
      { llmProfiles: [{ id: "p1", name: "GPT" }] },
    );
    const modelSource = controls.find((control) => control.path === "execution.modelSource");
    expect(modelSource?.options?.map((option) => option.value)).toEqual(["", "p1", "gone"]);
  });

  it("builds narrator preset controls", () => {
    const controls = buildInlineConfigControls(
      node("narration.narrator", { presetRef: { presetId: "p1", presetVersionId: "v1" } }),
    );
    expect(controls.map((control) => [control.type, control.path])).toEqual([
      ["text", "presetRef.presetId"],
      ["text", "presetRef.presetVersionId"],
      ["model_source", "execution.modelSource"],
      ["text", "execution.modelId"],
      ["toggle_number", "execution.generation.temperature"],
      ["toggle_number", "execution.generation.topP"],
      ["toggle_number", "execution.generation.maxOutputTokens"],
      ["toggle_number", "execution.generation.maxContextTokens"],
    ]);
    expect(controls[0]?.value).toBe("p1");
    expect(controls[1]?.value).toBe("v1");
  expect(controls[1]?.emptyValue).toBe("null");
  });

  it("returns no controls for unsupported nodes", () => {
    expect(buildInlineConfigControls(node("source.user_input"))).toEqual([]);
  });

  it("reads a toggleable generation param value", () => {
    const controls = buildInlineConfigControls(
      node("narration.narrator", {
        execution: { generation: { temperature: { enabled: true, value: 0.5 } } },
      }),
    );
    const temperature = controls.find((control) => control.path === "execution.generation.temperature");
    expect(temperature?.type).toBe("toggle_number");
    expect(temperature?.value).toEqual({ enabled: true, value: 0.5 });
  });
});
