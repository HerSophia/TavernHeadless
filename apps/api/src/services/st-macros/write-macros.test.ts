import { describe, expect, it } from "vitest";

import { evaluateStMacros } from "./runtime.js";

describe("st-macros write macros", () => {
  it("collects preview and staged mutation for setvar in assemble phase", () => {
    const result = evaluateStMacros("{{setvar::mood::happy}}{{getvar::mood}}", {
      phase: "assemble",
      values: {},
    });

    expect(result.text).toBe("happy");
    expect(result.mutationPreview).toEqual([
      { kind: "set", scope: "branch", key: "mood", value: "happy" },
    ]);
    expect(result.stagedMutations).toEqual([
      { kind: "set", scope: "branch", key: "mood", value: "happy", sourceMacro: "setvar" },
    ]);
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "macro_preview_side_effect_suppressed", macroName: "setvar" }),
    ]));
  });

  it("supports deleteglobalvar preview", () => {
    const result = evaluateStMacros("{{deleteglobalvar::gold}}", {
      phase: "assemble",
      values: { gold: "10" },
    });

    expect(result.text).toBe("");
    expect(result.mutationPreview).toEqual([
      { kind: "delete", scope: "global", key: "gold" },
    ]);
    expect(result.stagedMutations).toEqual([
      { kind: "delete", scope: "global", key: "gold", sourceMacro: "deleteglobalvar" },
    ]);
  });

  it("blocks write macro outside allowed phases", () => {
    const result = evaluateStMacros("{{setvar::mood::happy}}", {
      phase: "import",
      values: {},
    });

    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "macro_eval_phase_disallowed" }),
    ]));
  });

  it("blocks write macro during commit_consume phase", () => {
    const result = evaluateStMacros("{{setvar::mood::happy}}{{getvar::mood}}", {
      phase: "commit_consume",
      values: { mood: "steady" },
    });

    expect(result.text).toBe("steady");
    expect(result.stagedMutations).toEqual([]);
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "macro_eval_phase_disallowed", macroName: "setvar" }),
    ]));
  });
});
