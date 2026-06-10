import { describe, expect, it } from "vitest";

import {
  PROMPT_RUNTIME_INJECTION_PLACEMENTS,
  type PromptRuntimeInjectionPlacement,
} from "../../prompt-runtime-injection-types.js";
import { PromptRuntimeInjectionPlacementResolver } from "../../chat/prompt-runtime-injection-placement-resolver.js";

const EXPECTED_INTERNAL_KEYS: Record<PromptRuntimeInjectionPlacement, string> = {
  before_system_prompt: "system_prompt.before",
  after_system_prompt: "system_prompt.after",
  before_character: "character.before",
  after_character: "character.after",
  before_persona: "persona.before",
  after_persona: "persona.after",
  before_worldbook: "worldbook.before",
  after_worldbook: "worldbook.after",
  before_memory: "memory.before",
  after_memory: "memory.after",
  before_examples: "examples.before",
  after_examples: "examples.after",
  before_history: "history.before",
  after_history: "history.after",
  before_current_user_input: "current_user_input.before",
  after_current_user_input: "current_user_input.after",
  before_output_instruction: "output_instruction.before",
  before_assistant_prefill: "assistant_prefill.before",
};

describe("PromptRuntimeInjectionPlacementResolver", () => {
  it("resolves every supported placement in every supported prompt mode", () => {
    const resolver = new PromptRuntimeInjectionPlacementResolver();

    for (const placement of PROMPT_RUNTIME_INJECTION_PLACEMENTS) {
      for (const promptMode of ["compat_strict", "compat_plus", "native"] as const) {
        expect(resolver.resolve({ placement, promptMode })).toEqual({
          resolved: true,
          internalKey: EXPECTED_INTERNAL_KEYS[placement],
        });
      }
    }
  });

  it("rejects unknown placements with a stable reason", () => {
    const resolver = new PromptRuntimeInjectionPlacementResolver();

    expect(resolver.resolve({
      placement: "after_assistant_prefill",
      promptMode: "compat_plus",
    })).toEqual({
      resolved: false,
      reason: "unknown_placement",
    });
  });
});
