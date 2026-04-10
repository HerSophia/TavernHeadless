import { describe, expect, it } from "vitest";

import { evaluateStMacros } from "./runtime.js";

describe("st-macros limits", () => {
  it("warns on step limit", () => {
    const result = evaluateStMacros("{{a}}{{b}}{{c}}", {
      phase: "assemble",
      values: { a: "A", b: "B", c: "C" },
      maxSteps: 2,
    });

    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "macro_step_limit_exceeded" }),
    ]));
  });

  it("warns on expanded length limit", () => {
    const result = evaluateStMacros("{{big}}", {
      phase: "assemble",
      values: { big: "1234567890" },
  maxExpandedLength: 4,
    });

    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "macro_expanded_length_limit_exceeded" }),
    ]));
    expect(result.text).toBe("1234");
  });

  it("warns on mutation count limit", () => {
    const result = evaluateStMacros("{{setvar::a::1}}{{setvar::b::2}}", {
      phase: "assemble",
      values: {},
      maxMutationCount: 1,
    });

    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "macro_mutation_limit_exceeded" }),
    ]));
    expect(result.stagedMutations).toHaveLength(1);
  });
});
