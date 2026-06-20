import { describe, expect, it } from "vitest";

import {
  COMPAT_PLUS_RECIPE,
  COMPAT_STRICT_RECIPE,
  NATIVE_PROMPT_RECIPE,
  PROMPT_PROCESSOR_RECIPE_KINDS,
  PROMPT_PROCESSOR_RECIPE_VERSION,
  resolvePromptProcessorRecipe,
  resolvePromptProcessorRecipeKind,
  resolveTurnAssemblyProcessorKind,
  TURN_ASSEMBLY_PROCESSOR_KINDS,
  unresolvedRunModelSnapshot,
  type PromptProcessorRecipe,
} from "../index.js";

describe("P9 TurnAssemblyProcessor contract baseline", () => {
  it("declares the three prompt processor recipe kinds", () => {
    expect([...PROMPT_PROCESSOR_RECIPE_KINDS]).toEqual([
      "compat_strict",
      "compat_plus",
      "native_prompt",
    ]);
  });

  it("declares the three turn assembly processor kinds", () => {
    expect([...TURN_ASSEMBLY_PROCESSOR_KINDS]).toEqual([
      "prompt_mode",
      "composite",
      "node_graph",
    ]);
  });

  it("keeps compat recipes deterministic and zero-agentic", () => {
    for (const recipe of [COMPAT_STRICT_RECIPE, COMPAT_PLUS_RECIPE] satisfies PromptProcessorRecipe[]) {
      expect(recipe.enableInlineAgents).toBe(false);
      expect(recipe.version).toBe(PROMPT_PROCESSOR_RECIPE_VERSION);
      expect(recipe.preflightRoles).toBeUndefined();
      expect(recipe.postVerifierRoles).toBeUndefined();
    }
  });

  it("declares native_prompt as a composite recipe with inline agent roles", () => {
    expect(NATIVE_PROMPT_RECIPE.kind).toBe("native_prompt");
    expect(NATIVE_PROMPT_RECIPE.enableInlineAgents).toBe(true);
    expect(NATIVE_PROMPT_RECIPE.preflightRoles).toContain("director");
    expect(NATIVE_PROMPT_RECIPE.postVerifierRoles).toContain("continuity_verifier");
  });

  it("maps prompt mode to recipe and processor kind", () => {
    expect(resolvePromptProcessorRecipeKind("compat_strict")).toBe("compat_strict");
    expect(resolvePromptProcessorRecipeKind("compat_plus")).toBe("compat_plus");
    expect(resolvePromptProcessorRecipeKind("native")).toBe("native_prompt");

    expect(resolvePromptProcessorRecipe("native")).toBe(NATIVE_PROMPT_RECIPE);
    expect(resolvePromptProcessorRecipe("compat_strict")).toBe(COMPAT_STRICT_RECIPE);

    expect(resolveTurnAssemblyProcessorKind("compat_strict")).toBe("prompt_mode");
    expect(resolveTurnAssemblyProcessorKind("compat_plus")).toBe("prompt_mode");
    expect(resolveTurnAssemblyProcessorKind("native_prompt")).toBe("composite");
  });

  it("provides an unresolved model snapshot placeholder", () => {
    const snapshot = unresolvedRunModelSnapshot(123);
    expect(snapshot).toEqual({ source: "unresolved", capturedAt: 123 });
  });
});
