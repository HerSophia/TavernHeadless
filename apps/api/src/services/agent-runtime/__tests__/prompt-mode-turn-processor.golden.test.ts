import { describe, expect, it, vi } from "vitest";
import type { PromptIR } from "@tavern/core";

import {
  COMPAT_PLUS_RECIPE,
  COMPAT_STRICT_RECIPE,
  NATIVE_PROMPT_RECIPE,
  PromptModeTurnProcessor,
  PromptModeTurnProcessorError,
  type PromptModeComposeResult,
  type TurnAssemblyContext,
} from "../index.js";

function samplePromptIr(): PromptIR {
  return {
    sections: [
      {
        name: "main",
        messages: [{ role: "system", content: "You are a helpful assistant." }],
      },
      {
        name: "chatHistory",
        messages: [{ role: "user", content: "Hello there." }],
      },
    ],
    metadata: { maxTokens: 512, reservedForReply: 128 },
  } as unknown as PromptIR;
}

function composeResult(): PromptModeComposeResult {
  return {
    promptIr: samplePromptIr(),
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
    assemblyInputDigest: { userMessage: "Hello there.", presetId: "preset_1" },
    composePromptModeIr: () => composeResult(),
    ...overrides,
  };
}

describe("PromptModeTurnProcessor (P9 prompt_mode)", () => {
  it("rejects the native_prompt recipe", () => {
    expect(() => new PromptModeTurnProcessor(NATIVE_PROMPT_RECIPE)).toThrow(PromptModeTurnProcessorError);
  });

  it("passes the composed promptIR through unchanged (golden field-by-field)", () => {
    const processor = new PromptModeTurnProcessor(COMPAT_STRICT_RECIPE);
    const expected = composeResult();
    const context = makeContext({ composePromptModeIr: () => expected });

    const prepared = processor.prepare(context);
    const result = processor.execute(prepared);

    expect(result.promptIr).toBe(expected.promptIr);
    expect(result.promptIr).toEqual(samplePromptIr());
    expect(result.characterOverridesHandledInPromptIR).toBe(false);
    expect(result.memorySummaryHandledInPromptIR).toBe(false);
  });

  it("invokes the compose closure exactly once per execute", () => {
    const compose = vi.fn(() => composeResult());
    const processor = new PromptModeTurnProcessor(COMPAT_PLUS_RECIPE);
    const context = makeContext({
      promptMode: "compat_plus",
      recipe: COMPAT_PLUS_RECIPE,
      composePromptModeIr: compose,
    });

    processor.execute(processor.prepare(context));
    expect(compose).toHaveBeenCalledTimes(1);
  });

  it("is deterministic: identical digest yields identical assemblyInputHash, different digest differs", () => {
    const processor = new PromptModeTurnProcessor(COMPAT_STRICT_RECIPE);
    const a = processor.prepare(makeContext());
    const b = processor.prepare(makeContext());
    const c = processor.prepare(makeContext({ assemblyInputDigest: { userMessage: "Different.", presetId: "preset_1" } }));

    expect(a.assemblyInputHash).toMatch(/^sha256:/);
    expect(a.assemblyInputHash).toBe(b.assemblyInputHash);
    expect(a.assemblyInputHash).not.toBe(c.assemblyInputHash);
  });

  it("separates hashes by recipe even for the same digest", () => {
    const strict = new PromptModeTurnProcessor(COMPAT_STRICT_RECIPE).prepare(makeContext());
    const plus = new PromptModeTurnProcessor(COMPAT_PLUS_RECIPE).prepare(
      makeContext({ promptMode: "compat_plus", recipe: COMPAT_PLUS_RECIPE }),
    );
    expect(strict.assemblyInputHash).not.toBe(plus.assemblyInputHash);
  });

  it("emits zero-agentic results with a chat_turn governance summary and no checkpoint", () => {
    const processor = new PromptModeTurnProcessor(COMPAT_STRICT_RECIPE);
    const result = processor.execute(processor.prepare(makeContext()));

    expect(result.processorKind).toBe("prompt_mode");
    expect(result.recipeKind).toBe("compat_strict");
    expect(result.agentRuntimeTrace).toBeUndefined();
    expect(result.checkpoint).toBeUndefined();

    expect(result.governanceSummary.runtime_kind).toBe("chat_turn");
    expect(result.governanceSummary.contract_version).toBe("b8-governance.v1");
    expect(result.governanceSummary.status).toBe("succeeded");
    expect(result.governanceSummary.reason_code).toBe("succeeded");
    expect(result.governanceSummary.diagnostics).toMatchObject({
      processor_kind: "prompt_mode",
      recipe_kind: "compat_strict",
      enable_inline_agents: false,
      inline_agents_engaged: false,
    });
    expect(result.governanceSummary.side_effects?.live_state).toEqual({ written: false });
  });
});
