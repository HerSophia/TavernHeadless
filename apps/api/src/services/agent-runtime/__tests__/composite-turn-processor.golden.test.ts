import { describe, expect, it, vi } from "vitest";
import type { PromptIR } from "@tavern/core";

import {
  COMPAT_STRICT_RECIPE,
  CompositeTurnProcessor,
  CompositeTurnProcessorError,
  NATIVE_PROMPT_RECIPE,
  type PromptModeComposeResult,
  type TurnAssemblyContext,
} from "../index.js";
import type { AgentRuntimeTrace } from "../inline-agent-types.js";

function samplePromptIr(): PromptIR {
  return {
    sections: [
      { name: "main", messages: [{ role: "system", content: "Native system." }] },
      { name: "chatHistory", messages: [{ role: "user", content: "Hi." }] },
    ],
    metadata: { maxTokens: 4096, reservedForReply: 512 },
  } as unknown as PromptIR;
}

function composeResult(): PromptModeComposeResult {
  return {
    promptIr: samplePromptIr(),
    // native 在 PromptIR 内处理角色覆盖与记忆摘要
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

describe("CompositeTurnProcessor (P9 composite / native_prompt)", () => {
  it("rejects non-native recipes", () => {
    expect(() => new CompositeTurnProcessor(COMPAT_STRICT_RECIPE)).toThrow(CompositeTurnProcessorError);
  });

  it("passes the native promptIR through and exports a checkpoint", () => {
    const processor = new CompositeTurnProcessor(NATIVE_PROMPT_RECIPE);
    const result = processor.execute(processor.prepare(makeContext()));

    expect(result.processorKind).toBe("composite");
    expect(result.recipeKind).toBe("native_prompt");
    expect(result.promptIr).toEqual(samplePromptIr());
    expect(result.characterOverridesHandledInPromptIR).toBe(true);
    expect(result.memorySummaryHandledInPromptIR).toBe(true);

    expect(result.checkpoint).toBeDefined();
    expect(result.checkpoint?.kind).toBe("composite");
    expect(result.checkpoint?.assemblyInputHash).toBe(result.assemblyInputHash);
    expect(result.checkpoint?.recipeVersion).toBe(NATIVE_PROMPT_RECIPE.version);
  });

  it("keeps Narrator unique by composing exactly once per execute", () => {
    const compose = vi.fn(() => composeResult());
    const processor = new CompositeTurnProcessor(NATIVE_PROMPT_RECIPE);
    processor.execute(processor.prepare(makeContext({ composePromptModeIr: compose })));
    expect(compose).toHaveBeenCalledTimes(1);
  });

  it("surfaces inline agentic trace when provided (composite encloses existing inline agents)", () => {
    const processor = new CompositeTurnProcessor(NATIVE_PROMPT_RECIPE);
    const trace = agentRuntimeTrace();
    const result = processor.execute(processor.prepare(makeContext({ agentRuntimeTrace: trace })));

    expect(result.agentRuntimeTrace).toBe(trace);
    expect(result.governanceSummary.diagnostics).toMatchObject({
      processor_kind: "composite",
      recipe_kind: "native_prompt",
      enable_inline_agents: true,
      inline_agents_engaged: true,
    });
    expect(result.governanceSummary.side_effects?.inline_agents).toEqual({ count: 1 });
  });

  it("omits inline agentic trace when none is provided", () => {
    const processor = new CompositeTurnProcessor(NATIVE_PROMPT_RECIPE);
    const result = processor.execute(processor.prepare(makeContext()));

    expect(result.agentRuntimeTrace).toBeUndefined();
    expect(result.governanceSummary.runtime_kind).toBe("chat_turn");
    expect(result.governanceSummary.diagnostics).toMatchObject({ inline_agents_engaged: false });
  });

  it("produces a standalone checkpoint with the same assembly input hash", () => {
    const processor = new CompositeTurnProcessor(NATIVE_PROMPT_RECIPE);
    const prepared = processor.prepare(makeContext());
    const checkpoint = processor.checkpoint(prepared);
    expect(checkpoint.assemblyInputHash).toBe(prepared.assemblyInputHash);
    expect(checkpoint.characterOverridesHandledInPromptIR).toBe(true);
    expect(checkpoint.memorySummaryHandledInPromptIR).toBe(true);
  });
});
