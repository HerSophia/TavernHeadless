import { describe, expect, it, vi } from "vitest";
import type { PromptIR } from "@tavern/core";
import { buildNativePromptFloorTemplate } from "@tavern/core";

import {
  COMPAT_STRICT_RECIPE,
  CompositeTurnProcessor,
  DEFAULT_NATIVE_PROMPT_BRIDGE_DECISION,
  NATIVE_PROMPT_RECIPE,
  NodeGraphTurnProcessor,
  NodeGraphTurnProcessorError,
  PromptModeTurnProcessor,
  compareTurnAssemblyResults,
  readNativePromptBridgeWorkspaceDefault,
  resolveNativePromptBridgeDecision,
  selectTurnAssemblyProcessor,
  type PromptModeComposeResult,
  type TurnAssemblyContext,
} from "../index.js";
import type { AgentRuntimeTrace } from "../inline-agent-types.js";
import {
  NATIVE_PROMPT_SYSTEM_GRAPH_ID,
  NATIVE_PROMPT_SYSTEM_GRAPH_VERSION,
  assertNativePromptSystemGraphExecutable,
  buildNativePromptSystemGraph,
  validateNativePromptSystemGraph,
} from "../../node-graph-runtime/index.js";
import { EffectiveConfigService } from "../../effective-config-service.js";

function samplePromptIr(systemText = "Native system."): PromptIR {
  return {
    sections: [
      { name: "main", messages: [{ role: "system", content: systemText }] },
      { name: "chatHistory", messages: [{ role: "user", content: "Hi." }] },
    ],
    metadata: { maxTokens: 4096, reservedForReply: 512 },
  } as unknown as PromptIR;
}

function composeResult(systemText = "Native system."): PromptModeComposeResult {
  return {
    promptIr: samplePromptIr(systemText),
    characterOverridesHandledInPromptIR: true,
    memorySummaryHandledInPromptIR: true,
  };
}

function agentRuntimeTrace(): AgentRuntimeTrace {
  return {
    strategy: "inline_mvp",
    scopeKind: "floor",
    preResponse: { runs: [] },
    response: { narratorCallerSlot: "narrator" },
    postResponse: {
      runs: [],
      findingCounts: { continuity: 0, agency: 0, style: 0 },
      proposalCounts: { state: 0, memory: 0 },
      commitAdvice: "allow",
    },
  };
}

function makeContext(overrides: Partial<TurnAssemblyContext> = {}): TurnAssemblyContext {
  return {
    promptMode: "native",
    recipe: NATIVE_PROMPT_RECIPE,
    accountId: "acc_1",
    sessionId: "sess_1",
    floorId: "floor_1",
    intent: "normal",
    assemblyInputDigest: { userMessage: "Hi.", presetId: "preset_native" },
    composePromptModeIr: () => composeResult(),
    ...overrides,
  };
}

describe("NG2-BRIDGE native prompt system graph", () => {
  it("validates as an executable system graph with unique narrator / commit_gate / compose", () => {
    const result = validateNativePromptSystemGraph();
    expect(result.isValid).toBe(true);
    expect(() => assertNativePromptSystemGraphExecutable()).not.toThrow();
    const doc = result.nodesById;
    expect([...doc.values()].filter((n) => n.type === "narration.narrator")).toHaveLength(1);
    expect([...doc.values()].filter((n) => n.type === "output.commit_gate")).toHaveLength(1);
    expect([...doc.values()].filter((n) => n.type === "compose.final_messages")).toHaveLength(1);
  });
});

describe("DG11 default floor template ↔ system graph drift guard", () => {
  it("the system graph and the forkable template share the same structure", () => {
    const system = buildNativePromptSystemGraph();
    const template = buildNativePromptFloorTemplate();
    // 同结构（§10.5）：节点 / 边 / 权限 / policies / mode 逐字段相等。
    expect(template.nodes).toEqual(system.nodes);
    expect(template.edges).toEqual(system.edges);
    expect(template.permissions).toEqual(system.permissions);
    expect(template.policies).toEqual(system.policies);
    expect(template.mode).toBe(system.mode);
  });

  it("differs only in identity (id / systemGraph flag), keeping the system graph immutable & authoritative", () => {
    const system = buildNativePromptSystemGraph();
    const template = buildNativePromptFloorTemplate();
    expect(system.metadata?.systemGraph).toBe(true);
    expect(template.metadata?.systemGraph).toBe(false);
    expect(template.graphId).not.toBe(system.graphId);
    expect(system.graphId).toBe(NATIVE_PROMPT_SYSTEM_GRAPH_ID);
  });
});

describe("NodeGraphTurnProcessor (NG2-BRIDGE node_graph carrier)", () => {
  it("rejects non-native recipes", () => {
    expect(() => new NodeGraphTurnProcessor(COMPAT_STRICT_RECIPE)).toThrow(NodeGraphTurnProcessorError);
  });

  it("is golden-identical to the composite carrier for the same context", () => {
    const context = makeContext();
    const composite = new CompositeTurnProcessor(NATIVE_PROMPT_RECIPE);
    const nodeGraph = new NodeGraphTurnProcessor(NATIVE_PROMPT_RECIPE);

    const compositeResult = composite.execute(composite.prepare(context));
    const nodeGraphResult = nodeGraph.execute(nodeGraph.prepare(context));

    // 承载表达不同，但 prompt 编排产物逐字段一致（golden）。
    expect(nodeGraphResult.assemblyInputHash).toBe(compositeResult.assemblyInputHash);
    expect(nodeGraphResult.promptIr).toEqual(compositeResult.promptIr);
    expect(nodeGraphResult.characterOverridesHandledInPromptIR).toBe(compositeResult.characterOverridesHandledInPromptIR);
    expect(nodeGraphResult.memorySummaryHandledInPromptIR).toBe(compositeResult.memorySummaryHandledInPromptIR);

    // 但承载路径标注不同。
    expect(nodeGraphResult.processorKind).toBe("node_graph");
    expect(nodeGraphResult.governanceSummary.diagnostics).toMatchObject({
      processor_kind: "node_graph",
      carrier: "system_graph",
      system_graph_id: NATIVE_PROMPT_SYSTEM_GRAPH_ID,
      system_graph_version: NATIVE_PROMPT_SYSTEM_GRAPH_VERSION,
    });
  });

  it("composes exactly once per execute (Narrator unique) and carries inline agentic trace + checkpoint", () => {
    const compose = vi.fn(() => composeResult());
    const trace = agentRuntimeTrace();
    const processor = new NodeGraphTurnProcessor(NATIVE_PROMPT_RECIPE);
    const result = processor.execute(processor.prepare(makeContext({ composePromptModeIr: compose, agentRuntimeTrace: trace })));
    expect(compose).toHaveBeenCalledTimes(1);
    expect(result.agentRuntimeTrace).toBe(trace);
    expect(result.checkpoint?.kind).toBe("node_graph");
    expect(result.checkpoint?.assemblyInputHash).toBe(result.assemblyInputHash);
  });
});

describe("compareTurnAssemblyResults (shadow comparison)", () => {
  it("reports equal when both carriers compose identical prompts", () => {
    const context = makeContext();
    const composite = new CompositeTurnProcessor(NATIVE_PROMPT_RECIPE);
    const nodeGraph = new NodeGraphTurnProcessor(NATIVE_PROMPT_RECIPE);
    const comparison = compareTurnAssemblyResults(
      nodeGraph.execute(nodeGraph.prepare(context)),
      composite.execute(composite.prepare(context)),
    );
    expect(comparison.equal).toBe(true);
    expect(comparison.diffs).toEqual([]);
    expect(comparison.carrierKind).toBe("node_graph");
    expect(comparison.shadowKind).toBe("composite");
  });

  it("flags prompt_ir diff when the shadow prompt differs", () => {
    const composite = new CompositeTurnProcessor(NATIVE_PROMPT_RECIPE);
    const nodeGraph = new NodeGraphTurnProcessor(NATIVE_PROMPT_RECIPE);
    const carrier = nodeGraph.execute(nodeGraph.prepare(makeContext({ composePromptModeIr: () => composeResult("A") })));
    const shadow = composite.execute(composite.prepare(makeContext({ composePromptModeIr: () => composeResult("B") })));
    const comparison = compareTurnAssemblyResults(carrier, shadow);
    expect(comparison.equal).toBe(false);
    expect(comparison.diffs).toContain("prompt_ir");
  });
});

describe("resolveNativePromptBridgeDecision (layered gray switch)", () => {
  it("defaults to composite + shadow off", () => {
    expect(resolveNativePromptBridgeDecision({})).toEqual(DEFAULT_NATIVE_PROMPT_BRIDGE_DECISION);
  });

  it("lets later layers override earlier ones (workspace -> project -> session)", () => {
    expect(resolveNativePromptBridgeDecision({ workspace: { carrier: "system_graph" } }))
      .toEqual({ carrier: "system_graph", shadow: false });
    expect(resolveNativePromptBridgeDecision({
      workspace: { carrier: "system_graph", shadow: true },
      project: { carrier: "composite" },
    })).toEqual({ carrier: "composite", shadow: true });
    expect(resolveNativePromptBridgeDecision({
      workspace: { carrier: "composite" },
      project: { carrier: "system_graph" },
      session: { shadow: true },
    })).toEqual({ carrier: "system_graph", shadow: true });
  });

  it("reads the workspace default from env", () => {
    expect(readNativePromptBridgeWorkspaceDefault({} as NodeJS.ProcessEnv)).toEqual({});
    expect(readNativePromptBridgeWorkspaceDefault({
      NATIVE_PROMPT_SYSTEM_GRAPH_CARRIER: "system_graph",
      NATIVE_PROMPT_SYSTEM_GRAPH_SHADOW: "true",
    } as unknown as NodeJS.ProcessEnv)).toEqual({ carrier: "system_graph", shadow: true });
  });
});

describe("EffectiveConfigService.resolveNativePromptBridge", () => {
  it("layers env workspace default and records the source", () => {
    const fromEnv = EffectiveConfigService.resolveNativePromptBridge({
      env: { NATIVE_PROMPT_SYSTEM_GRAPH_CARRIER: "system_graph" } as unknown as NodeJS.ProcessEnv,
    });
    expect(fromEnv).toMatchObject({ carrier: "system_graph", shadow: false, source: "workspace" });

    const fromSession = EffectiveConfigService.resolveNativePromptBridge({
      env: {} as NodeJS.ProcessEnv,
      session: { carrier: "system_graph" },
    });
    expect(fromSession).toMatchObject({ carrier: "system_graph", source: "session" });

    expect(EffectiveConfigService.resolveNativePromptBridge({ env: {} as NodeJS.ProcessEnv }))
      .toMatchObject({ carrier: "composite", shadow: false, source: "workspace" });
  });
});

describe("selectTurnAssemblyProcessor (carrier-aware)", () => {
  it("routes native carriers (NG2-BRIDGE)", () => {
    expect(selectTurnAssemblyProcessor("native")).toBeInstanceOf(CompositeTurnProcessor);
    expect(selectTurnAssemblyProcessor("native", "composite")).toBeInstanceOf(CompositeTurnProcessor);
    expect(selectTurnAssemblyProcessor("native", "system_graph")).toBeInstanceOf(NodeGraphTurnProcessor);
  });

  it("routes compat carriers (CG11): default prompt_mode, system_graph graphizes", () => {
    // 默认（无 carrier / prompt_mode）→ 命令式 PromptModeTurnProcessor，零回归。
    expect(selectTurnAssemblyProcessor("compat_strict")).toBeInstanceOf(PromptModeTurnProcessor);
    expect(selectTurnAssemblyProcessor("compat_strict", "prompt_mode")).toBeInstanceOf(PromptModeTurnProcessor);
    expect(selectTurnAssemblyProcessor("compat_plus", "prompt_mode")).toBeInstanceOf(PromptModeTurnProcessor);
    // CG11：compat + system_graph carrier → 图化承载（NodeGraphTurnProcessor，compat 描述符）。
    expect(selectTurnAssemblyProcessor("compat_strict", "system_graph")).toBeInstanceOf(NodeGraphTurnProcessor);
    expect(selectTurnAssemblyProcessor("compat_plus", "system_graph")).toBeInstanceOf(NodeGraphTurnProcessor);
  });
});
