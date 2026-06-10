import {
  PROMPT_RUNTIME_INJECTION_PLACEMENTS,
  type PromptRuntimeInjectionPlacement,
  type PromptRuntimeInjectionPlacementResolverInput,
  type PromptRuntimeInjectionPlacementResolverOutput,
} from "../prompt-runtime-injection-types.js";

const INTERNAL_PLACEMENT_KEYS: Record<PromptRuntimeInjectionPlacement, string> = {
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

function isKnownPlacement(value: string): value is PromptRuntimeInjectionPlacement {
  return (PROMPT_RUNTIME_INJECTION_PLACEMENTS as readonly string[]).includes(value);
}

export class PromptRuntimeInjectionPlacementResolver {
  resolve(
    input: PromptRuntimeInjectionPlacementResolverInput,
  ): PromptRuntimeInjectionPlacementResolverOutput {
    if (!isKnownPlacement(input.placement)) {
      return {
        resolved: false,
        reason: "unknown_placement",
      };
    }

    if (!this.isPlacementAvailableInMode(input.placement, input.promptMode)) {
      return {
        resolved: false,
        reason: "placement_not_available_in_mode",
      };
    }

    return {
      resolved: true,
      internalKey: INTERNAL_PLACEMENT_KEYS[input.placement],
    };
  }

  private isPlacementAvailableInMode(
    _placement: PromptRuntimeInjectionPlacement,
    _promptMode: PromptRuntimeInjectionPlacementResolverInput["promptMode"],
  ): boolean {
    return true;
  }
}
