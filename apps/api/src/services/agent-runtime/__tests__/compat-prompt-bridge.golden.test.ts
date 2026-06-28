import { describe, expect, it } from "vitest";
import type { PromptIR } from "@tavern/core";
import { buildCompatPromptFloorTemplate } from "@tavern/core";

import {
  COMPAT_PLUS_RECIPE,
  COMPAT_STRICT_RECIPE,
  COMPAT_SYSTEM_GRAPH_CARRIER,
  DEFAULT_COMPAT_PROMPT_BRIDGE_DECISION,
  NATIVE_PROMPT_RECIPE,
  NodeGraphTurnProcessor,
  NodeGraphTurnProcessorError,
  PromptModeTurnProcessor,
  compareTurnAssemblyResults,
  readCompatPromptBridgeWorkspaceDefault,
  resolveCompatPromptBridgeDecision,
  selectTurnAssemblyProcessor,
  type PromptModeComposeResult,
  type TurnAssemblyContext,
} from "../index.js";
import {
  COMPAT_PROMPT_SYSTEM_GRAPH_ID,
  COMPAT_PROMPT_SYSTEM_GRAPH_VERSION,
  assertCompatPromptSystemGraphExecutable,
  buildCompatPromptSystemGraph,
  validateCompatPromptSystemGraph,
} from "../../node-graph-runtime/index.js";
import { EffectiveConfigService } from "../../effective-config-service.js";

function samplePromptIr(systemText = "Compat system."): PromptIR {
  return {
    sections: [
      { name: "main", messages: [{ role: "system", content: systemText }] },
      { name: "chatHistory", messages: [{ role: "user", content: "Hi." }] },
    ],
    metadata: { maxTokens: 4096, reservedForReply: 512 },
  } as unknown as PromptIR;
}

function composeResult(systemText = "Compat system."): PromptModeComposeResult {
  return {
    promptIr: samplePromptIr(systemText),
    characterOverridesHandledInPromptIR: false,
    memorySummaryHandledInPromptIR: false,
  };
}

function makeContext(overrides: Partial<TurnAssemblyContext> = {}): TurnAssemblyContext {
  return {
    promptMode: "compat_strict",
    recipe: COMPAT_STRICT_RECIPE,
    accountId: "acc_1",
    sessionId: "sess_1",
    floorId: "floor_1",
    intent: "normal",
    assemblyInputDigest: { userMessage: "Hi.", presetId: "preset_compat" },
    composePromptModeIr: () => composeResult(),
    ...overrides,
  };
}

describe("CG11 compat prompt system graph", () => {
  it("validates as an executable, zero-agentic system graph with unique narrator / commit_gate / compose", () => {
    const result = validateCompatPromptSystemGraph();
    expect(result.isValid).toBe(true);
    expect(() => assertCompatPromptSystemGraphExecutable()).not.toThrow();
    const nodes = [...result.nodesById.values()];
    expect(nodes.filter((n) => n.type === "narration.narrator")).toHaveLength(1);
    expect(nodes.filter((n) => n.type === "output.commit_gate")).toHaveLength(1);
    expect(nodes.filter((n) => n.type === "compose.final_messages")).toHaveLength(1);
    // compat 零 Agentic：无 agent.* / verify.* 决策节点。
    expect(nodes.some((n) => n.type.startsWith("agent."))).toBe(false);
    expect(nodes.some((n) => n.type.startsWith("verify."))).toBe(false);
  });

  it("shares the same structure as the forkable compat template (drift guard)", () => {
    const system = buildCompatPromptSystemGraph();
    const template = buildCompatPromptFloorTemplate();
    expect(template.nodes).toEqual(system.nodes);
    expect(template.edges).toEqual(system.edges);
    expect(template.permissions).toEqual(system.permissions);
    expect(template.policies).toEqual(system.policies);
    expect(system.metadata?.systemGraph).toBe(true);
    expect(template.metadata?.systemGraph).toBe(false);
    expect(system.graphId).toBe(COMPAT_PROMPT_SYSTEM_GRAPH_ID);
  });
});

describe("NodeGraphTurnProcessor compat carrier (CG11)", () => {
  it("rejects a recipe the carrier does not accept", () => {
    // compat 描述符不接受 native_prompt recipe。
    expect(() => new NodeGraphTurnProcessor(NATIVE_PROMPT_RECIPE, COMPAT_SYSTEM_GRAPH_CARRIER)).toThrow(
      NodeGraphTurnProcessorError,
    );
    // 默认（native）描述符不接受 compat recipe。
    expect(() => new NodeGraphTurnProcessor(COMPAT_STRICT_RECIPE)).toThrow(NodeGraphTurnProcessorError);
  });

  for (const { recipe, mode } of [
    { recipe: COMPAT_STRICT_RECIPE, mode: "compat_strict" as const },
    { recipe: COMPAT_PLUS_RECIPE, mode: "compat_plus" as const },
  ]) {
    it(`is golden-identical to the prompt_mode carrier for ${mode}`, () => {
      const context = makeContext({ promptMode: mode, recipe });
      const promptMode = new PromptModeTurnProcessor(recipe);
      const nodeGraph = new NodeGraphTurnProcessor(recipe, COMPAT_SYSTEM_GRAPH_CARRIER);

      const promptModeResult = promptMode.execute(promptMode.prepare(context));
      const nodeGraphResult = nodeGraph.execute(nodeGraph.prepare(context));

      // 承载表达不同，但 prompt 编排产物逐字段一致（golden 等价门槛）。
      expect(nodeGraphResult.assemblyInputHash).toBe(promptModeResult.assemblyInputHash);
      expect(nodeGraphResult.promptIr).toEqual(promptModeResult.promptIr);
      expect(nodeGraphResult.characterOverridesHandledInPromptIR).toBe(promptModeResult.characterOverridesHandledInPromptIR);
      expect(nodeGraphResult.memorySummaryHandledInPromptIR).toBe(promptModeResult.memorySummaryHandledInPromptIR);

      // 承载路径标注不同。
      expect(promptModeResult.processorKind).toBe("prompt_mode");
      expect(nodeGraphResult.processorKind).toBe("node_graph");
      expect(nodeGraphResult.governanceSummary.diagnostics).toMatchObject({
        carrier: "system_graph",
        system_graph_id: COMPAT_PROMPT_SYSTEM_GRAPH_ID,
        system_graph_version: COMPAT_PROMPT_SYSTEM_GRAPH_VERSION,
        recipe_kind: recipe.kind,
      });
    });
  }

  it("stays zero-agentic: no agentRuntimeTrace / checkpoint on the compat carrier", () => {
    const context = makeContext();
    const nodeGraph = new NodeGraphTurnProcessor(COMPAT_STRICT_RECIPE, COMPAT_SYSTEM_GRAPH_CARRIER);
    const result = nodeGraph.execute(nodeGraph.prepare(context));
    expect(result.agentRuntimeTrace).toBeUndefined();
  });
});

describe("compat shadow comparison + factory", () => {
  it("reports equal when both carriers compose identical prompts", () => {
    const context = makeContext();
    const promptMode = new PromptModeTurnProcessor(COMPAT_STRICT_RECIPE);
    const nodeGraph = new NodeGraphTurnProcessor(COMPAT_STRICT_RECIPE, COMPAT_SYSTEM_GRAPH_CARRIER);
    const comparison = compareTurnAssemblyResults(
      nodeGraph.execute(nodeGraph.prepare(context)),
      promptMode.execute(promptMode.prepare(context)),
    );
    expect(comparison.equal).toBe(true);
    expect(comparison.diffs).toEqual([]);
  });

  it("flags prompt_ir diff when the shadow prompt differs", () => {
    const promptMode = new PromptModeTurnProcessor(COMPAT_STRICT_RECIPE);
    const nodeGraph = new NodeGraphTurnProcessor(COMPAT_STRICT_RECIPE, COMPAT_SYSTEM_GRAPH_CARRIER);
    const carrier = nodeGraph.execute(nodeGraph.prepare(makeContext({ composePromptModeIr: () => composeResult("A") })));
    const shadow = promptMode.execute(promptMode.prepare(makeContext({ composePromptModeIr: () => composeResult("B") })));
    const comparison = compareTurnAssemblyResults(carrier, shadow);
    expect(comparison.equal).toBe(false);
    expect(comparison.diffs).toContain("prompt_ir");
  });

  it("factory routes compat carriers: default prompt_mode, system_graph graphizes", () => {
    expect(selectTurnAssemblyProcessor("compat_strict")).toBeInstanceOf(PromptModeTurnProcessor);
    expect(selectTurnAssemblyProcessor("compat_plus", "prompt_mode")).toBeInstanceOf(PromptModeTurnProcessor);
    expect(selectTurnAssemblyProcessor("compat_strict", "system_graph")).toBeInstanceOf(NodeGraphTurnProcessor);
    expect(selectTurnAssemblyProcessor("compat_plus", "system_graph")).toBeInstanceOf(NodeGraphTurnProcessor);
  });
});

describe("resolveCompatPromptBridgeDecision (layered gray switch)", () => {
  it("defaults to prompt_mode + shadow off", () => {
    expect(resolveCompatPromptBridgeDecision({})).toEqual(DEFAULT_COMPAT_PROMPT_BRIDGE_DECISION);
    expect(DEFAULT_COMPAT_PROMPT_BRIDGE_DECISION).toEqual({ carrier: "prompt_mode", shadow: false });
  });

  it("lets later layers override earlier ones (workspace -> project -> session)", () => {
    expect(resolveCompatPromptBridgeDecision({ workspace: { carrier: "system_graph" } }))
      .toEqual({ carrier: "system_graph", shadow: false });
    expect(resolveCompatPromptBridgeDecision({
      workspace: { carrier: "system_graph", shadow: true },
      project: { carrier: "prompt_mode" },
    })).toEqual({ carrier: "prompt_mode", shadow: true });
    expect(resolveCompatPromptBridgeDecision({
      workspace: { carrier: "prompt_mode" },
      project: { carrier: "system_graph" },
      session: { shadow: true },
    })).toEqual({ carrier: "system_graph", shadow: true });
  });

  it("reads the workspace default from env", () => {
    expect(readCompatPromptBridgeWorkspaceDefault({} as NodeJS.ProcessEnv)).toEqual({});
    expect(readCompatPromptBridgeWorkspaceDefault({
      COMPAT_PROMPT_SYSTEM_GRAPH_CARRIER: "system_graph",
      COMPAT_PROMPT_SYSTEM_GRAPH_SHADOW: "true",
    } as unknown as NodeJS.ProcessEnv)).toEqual({ carrier: "system_graph", shadow: true });
  });
});

describe("EffectiveConfigService.resolveCompatPromptBridge", () => {
  it("layers env workspace default and records the source", () => {
    const fromEnv = EffectiveConfigService.resolveCompatPromptBridge({
      env: { COMPAT_PROMPT_SYSTEM_GRAPH_CARRIER: "system_graph" } as unknown as NodeJS.ProcessEnv,
    });
    expect(fromEnv).toMatchObject({ carrier: "system_graph", shadow: false, source: "workspace" });

    const fromSession = EffectiveConfigService.resolveCompatPromptBridge({
      env: {} as NodeJS.ProcessEnv,
      session: { carrier: "system_graph" },
    });
    expect(fromSession).toMatchObject({ carrier: "system_graph", source: "session" });

    expect(EffectiveConfigService.resolveCompatPromptBridge({ env: {} as NodeJS.ProcessEnv }))
      .toMatchObject({ carrier: "prompt_mode", shadow: false, source: "workspace" });
  });
});
