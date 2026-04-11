import { describe, expect, it } from "vitest";

import { evaluateStMacros } from "./runtime.js";

describe("st-macros if block", () => {
  it("evaluates truthy branch", () => {
    const result = evaluateStMacros("{{if {{flag}}}}YES{{else}}NO{{/if}}", {
      phase: "assemble",
      values: { flag: "true" },
    });

    expect(result.text).toBe("YES");
  });

  it("evaluates falsy branch", () => {
    const result = evaluateStMacros("{{if {{flag}}}}YES{{else}}NO{{/if}}", {
      phase: "assemble",
      values: { flag: "false" },
    });

    expect(result.text).toBe("NO");
  });

  it("supports equality comparison", () => {
    const result = evaluateStMacros("{{if {{getvar::mood}} == happy}}YES{{else}}NO{{/if}}", {
      phase: "assemble",
      values: { mood: "happy" },
    });

    expect(result.text).toBe("YES");
  });

  it("supports inequality comparison", () => {
    const result = evaluateStMacros("{{if {{getvar::mood}} != sad}}YES{{else}}NO{{/if}}", {
      phase: "assemble",
      values: { mood: "happy" },
    });

    expect(result.text).toBe("YES");
  });

  it("supports numeric comparisons", () => {
    const result = evaluateStMacros("{{if {{score}} >= 80}}PASS{{else}}FAIL{{/if}}", {
      phase: "assemble",
      values: { score: "90" },
    });

    expect(result.text).toBe("PASS");
  });

  it("supports logical operators and parentheses", () => {
    const result = evaluateStMacros("{{if ({{score}} >= 80) and not ({{rank}} == banned)}}YES{{else}}NO{{/if}}", {
      phase: "assemble",
      values: { score: "90", rank: "knight" },
    });

    expect(result.text).toBe("YES");
  });

  it("supports contains and startsWith predicates", () => {
    const result = evaluateStMacros("{{if {{title}} contains veteran}}A{{else}}B{{/if}}/{{if {{title}} startsWith The}}C{{else}}D{{/if}}", {
      phase: "assemble",
      values: { title: "The veteran guard" },
    });

    expect(result.text).toBe("A/C");
  });

  it("does not execute write macros in false branch", () =>{
    const result = evaluateStMacros("{{if {{flag}} == yes}}A{{else}}{{setvar::mood::sad}}B{{/if}}", {
      phase: "assemble",
      values: { flag: "yes", mood: "happy" },
    });

    expect(result.text).toBe("A");
    expect(result.stagedMutations).toEqual([]);
    expect(result.mutationPreview).toEqual([]);
  });

  it("does not execute short-circuited right side in and expression", () => {
    const result = evaluateStMacros("{{if {{flag}} and {{setvar::mood::sad}}}}YES{{else}}NO{{/if}}", {
      phase: "assemble",
      values: { flag: "false", mood: "happy" },
    });

    expect(result.text).toBe("NO");
    expect(result.stagedMutations).toEqual([]);
    expect(result.mutationPreview).toEqual([]);
    expect(result.usedMacros).toEqual(expect.arrayContaining(["if", "flag"]));
    expect(result.usedMacros).not.toContain("setvar");
  });

  it("does not execute short-circuited right side in or expression", () => {
    const result = evaluateStMacros("{{if {{flag}} or {{setvar::mood::sad}}}}YES{{else}}NO{{/if}}", {
      phase: "assemble",
      values: { flag: "true", mood: "happy" },
    });

    expect(result.text).toBe("YES");
    expect(result.stagedMutations).toEqual([]);
    expect(result.mutationPreview).toEqual([]);
    expect(result.usedMacros).toEqual(expect.arrayContaining(["if", "flag"]));
    expect(result.usedMacros).not.toContain("setvar");
  });

  it("treats empty string as falsy in non-comparison condition", () => {
    const result = evaluateStMacros("{{if {{flag}}}}YES{{else}}NO{{/if}}", {
      phase: "assemble",
      values: { flag: "" },
    });

    expect(result.text).toBe("NO");
  });

  it("keeps unsupported arithmetic block raw and warns", () => {
    const result = evaluateStMacros("{{if {{flag}} + 1}}YES{{else}}NO{{/if}}", {
      phase: "assemble",
      values: { flag: "1" },
    });

    expect(result.text).toBe("{{if {{flag}} + 1}}YES{{else}}NO{{/if}}");
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "macro_condition_unsupported", macroName: "if" }),
    ]));
  });

  it("keeps type-invalid numeric comparison raw and warns", () => {
    const result = evaluateStMacros("{{if {{flag}} >= happy}}YES{{else}}NO{{/if}}", {
      phase: "assemble",
      values: { flag: "1" },
    });

    expect(result.text).toBe("{{if {{flag}} >= happy}}YES{{else}}NO{{/if}}");
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "macro_arg_type_invalid", macroName: "if" }),
    ]));
  });

  it("keeps parse-failed block raw and warns", () => {
    const result = evaluateStMacros("{{if ({{flag}}}}YES{{else}}NO{{/if}}", {
      phase: "assemble",
      values: { flag: "true" },
    });

    expect(result.text).toBe("{{if ({{flag}}}}YES{{else}}NO{{/if}}");
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "macro_parse_failed", macroName: "if" }),
    ]));
  });

  it("reports unclosed scoped block", () => {
    const result = evaluateStMacros("{{if {{flag}}}}YES", {
      phase: "assemble",
      values: { flag: "true" },
    });

    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "macro_scoped_block_unclosed" }),
    ]));
  });
});
