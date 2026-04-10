import { describe, expect, it } from "vitest";

import { evaluateStMacros } from "./runtime.js";

describe("evaluateStMacros limits", () => {
  it("reports depth limit exceeded and preserves remaining source", () => {
    const result = evaluateStMacros("{{outer::{{inner}}}}", {
      phase: "assemble",
      values: { inner: "value" },
      maxDepth: 0,
    });

    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "macro_depth_limit_exceeded" }),
    ]));
    expect(result.text).toContain("{{inner}}");
  });

  it("reports step limit exceeded", () => {
    const result = evaluateStMacros("{{a}}{{b}}{{c}}", {
      phase: "assemble",
      values: { a: "A", b: "B", c: "C" },
      maxDepth: 16,
      maxSteps: 2,
    });

    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "macro_step_limit_exceeded" }),
    ]));
  });

  it("reports expanded length limit exceeded", () => {
    const result = evaluateStMacros("{{big}}", {
      phase: "assemble",
      values: { big: "1234567890" },
      maxDepth: 16,
      maxExpandedLength: 5,
    });

    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "macro_expanded_length_limit_exceeded" }),
    ]));
    expect(result.text.length).toBeLessThanOrEqual(5);
  });

  it("reports mutation count limit exceeded", () => {
    const result = evaluateStMacros("{{setvar::a::1}}{{setvar::b::2}}", {
      phase: "assemble",
      values: {},
      maxDepth: 16,
      maxMutationCount: 1,
    });

    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "macro_mutation_limit_exceeded" }),
    ]));
    expect(result.stagedMutations).toHaveLength(1);
  });

  it("keeps unsupported comparison syntax raw and emits warning", () => {
    const result = evaluateStMacros("{{if {{flag}} >= 1}}YES{{else}}NO{{/if}}", {
      phase: "assemble",
      values: { flag: "1" },
    });

    expect(result.text).toBe("{{if {{flag}} >= 1}}YES{{else}}NO{{/if}}");
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "macro_condition_unsupported", macroName: "if" }),
    ]));
  });

  it("reports macro cycle and preserves raw text", () => {
    const result = evaluateStMacros("{{loop}}", {
      phase: "assemble",
      values: { loop: "{{loop}}" },
    });

    expect(result.text).toBe("{{loop}}");
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "macro_cycle_detected", macroName: "loop" }),
    ]));
  });

  it("records trace metadata for if branch selection", () => {
    const result = evaluateStMacros("{{if {{flag}}}}YES{{else}}NO{{/if}}", {
      phase: "dry_run",
      values: { flag: "true" },
    });

    expect(result.traces).toEqual(expect.arrayContaining([
      expect.objectContaining({
        macroName: "if",
        phase: "dry_run",
        sourceKind: "if",
        selectedBranch: "then",
        resolvedText: "YES",
      }),
    ]));
  });

  it("uses updated subset warning text for unsupported macro argument shape", () => {
    const result = evaluateStMacros("{{random::a::b}}", {
      phase: "assemble",
      values: {},
    });

    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "macro_arg_arity_invalid",
        message: expect.stringContaining("outside the current Beta3 macro subset"),
      }),
    ]));
  });

  it("uses shared write mutation budget for preview and staged mutation recording", () => {
    const result = evaluateStMacros("{{setvar::a::1}}{{setvar::b::2}}", {
      phase: "assemble",
      values: {},
      maxMutationCount: 1,
    });

    expect(result.mutationPreview).toEqual([
      { kind: "set", scope: "branch", key: "a", value: "1" },
    ]);
    expect(result.stagedMutations).toEqual([
      { kind: "set", scope: "branch", key: "a", value: "1", sourceMacro: "setvar" },
    ]);
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "macro_mutation_limit_exceeded" }),
    ]));
  });

});
