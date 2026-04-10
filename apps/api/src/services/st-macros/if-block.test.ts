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

  it("does not execute write macros in false branch", () => {
    const result = evaluateStMacros("{{if {{flag}} == yes}}A{{else}}{{setvar::mood::sad}}B{{/if}}", {
      phase: "assemble",
      values: { flag: "yes", mood: "happy" },
    });

    expect(result.text).toBe("A");
    expect(result.stagedMutations).toEqual([]);
    expect(result.mutationPreview).toEqual([]);
  });

  it("treats empty string as falsy in non-comparison condition", () => {
    const result = evaluateStMacros("{{if {{flag}}}}YES{{else}}NO{{/if}}", {
      phase: "assemble",
      values: { flag: "" },
    });

    expect(result.text).toBe("NO");
  });

  it("keeps unsupported comparison block raw and warns", () => {
    const result = evaluateStMacros("{{if {{flag}} >= 1}}YES{{else}}NO{{/if}}", {
      phase: "assemble",
      values: { flag: "1" },
    });

    expect(result.text).toBe("{{if {{flag}} >= 1}}YES{{else}}NO{{/if}}");
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "macro_condition_unsupported", macroName: "if" }),
    ]));
  });

  it("keeps unsupported logical block raw and warns", () => {
    const result = evaluateStMacros("{{if {{flag}} and {{other}}}}YES{{else}}NO{{/if}}", {
      phase: "assemble",
      values: { flag: "yes", other: "yes" },
    });

    expect(result.text).toBe("{{if {{flag}} and {{other}}}}YES{{else}}NO{{/if}}");
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "macro_condition_unsupported", macroName: "if" }),
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
