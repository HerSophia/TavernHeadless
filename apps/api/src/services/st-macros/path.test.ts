import { describe, expect, it } from "vitest";

import { evaluateStMacros } from "./runtime.js";

describe("st-macros variable path", () => {
  it("reads nested object paths through getvar", () => {
    const result = evaluateStMacros("{{getvar::资产.金币}}/{{getvar::资产.银币}}", {
      phase: "assemble",
      values: {},
      variableSnapshot: {
        local: {
          资产: {
            金币: 3,
            银币: 5,
          },
        },
        global: {},
        plain: {},
      },
    });

    expect(result.text).toBe("3/5");
  });

  it("prefers exact dotted keys over path fallback during reads", () => {
    const result = evaluateStMacros("{{getvar::资产.金币}}", {
      phase: "assemble",
      values: {},
      variableSnapshot: {
        local: {
          "资产.金币": "flat",
          资产: {
            金币: "nested",
          },
        },
        global: {},
        plain: {},
      },
    });

    expect(result.text).toBe("flat");
  });

  it("supports shorthand path reads", () => {
    const result = evaluateStMacros("{{.资产.金币}}/{{$账户.余额}}", {
      phase: "assemble",
      values: {},
      variableSnapshot: {
        local: {
          资产: {
            金币: 3,
          },
        },
        global: {
          账户: {
            余额: 8,
          },
        },
        plain: {},
      },
    });

    expect(result.text).toBe("3/8");
  });

  it("supports hasvar on nested paths", () => {
    const result = evaluateStMacros("{{hasvar::资产.金币}}/{{hasvar::资产.铜币}}", {
      phase: "assemble",
      values: {},
      variableSnapshot: {
        local: {
          资产: {
            金币: 3,
          },
        },
        global: {},
        plain: {},
      },
    });

    expect(result.text).toBe("true/false");
  });

  it("keeps invalid path reads raw and warns", () => {
    const result = evaluateStMacros("{{getvar::资产..金币}}", {
      phase: "assemble",
      values: {},
      variableSnapshot: {
        local: {},
        global: {},
        plain: {},
      },
    });

    expect(result.text).toBe("{{getvar::资产..金币}}");
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "macro_parse_failed", macroName: "getvar" }),
    ]));
  });

  it("keeps type-invalid path reads raw and warns", () => {
    const result = evaluateStMacros("{{getvar::资产.金币}}", {
      phase: "assemble",
      values: {},
      variableSnapshot: {
        local: {
          资产: "很多",
        },
        global: {},
        plain: {},
      },
    });

    expect(result.text).toBe("{{getvar::资产.金币}}");
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "macro_arg_type_invalid", macroName: "getvar" }),
    ]));
  });

  it("writes nested object paths and exposes staged root mutation", () => {
    const result = evaluateStMacros("{{setvar::资产.金币::3}}{{getvar::资产.金币}}", {
      phase: "assemble",
      values: {},
      variableSnapshot: {
        local: {},
        global: {},
        plain: {},
      },
    });

    expect(result.text).toBe("3");
    expect(result.mutationPreview).toEqual([
      { kind: "set", scope: "branch", key: "资产", value: { 金币: "3" } },
    ]);
    expect(result.stagedMutations).toEqual([
      { kind: "set", scope: "branch", key: "资产", value: { 金币: "3" }, sourceMacro: "setvar" },
    ]);
  });

  it("prefers exact dotted keys over path fallback during writes", () => {
    const result = evaluateStMacros("{{setvar::资产.金币::3}}{{getvar::资产.金币}}", {
      phase: "assemble",
      values: {},
      variableSnapshot: {
        local: {
          "资产.金币": "old",
        },
        global: {},
        plain: {},
      },
    });

    expect(result.text).toBe("3");
    expect(result.stagedMutations).toEqual([
      { kind: "set", scope: "branch", key: "资产.金币", value: "3", sourceMacro: "setvar" },
    ]);
  });

  it("rewrites deletevar on nested paths into root set mutation", () => {
    const result = evaluateStMacros("{{deletevar::资产.银币}}{{getvar::资产.银币}}/{{getvar::资产.金币}}", {
      phase: "assemble",
      values: {},
      variableSnapshot: {
        local: {
          资产: {
            金币: 3,
            银币: 5,
          },
        },
        global: {},
        plain: {},
      },
    });

    expect(result.text).toBe("/3");
    expect(result.stagedMutations).toEqual([
      { kind: "set", scope: "branch", key: "资产", value: { 金币: 3 }, sourceMacro: "deletevar" },
    ]);
  });

  it("keeps type-invalid nested writes raw and warns", () => {
    const result = evaluateStMacros("{{setvar::资产.金币::3}}", {
      phase: "assemble",
      values: {},
      variableSnapshot: {
        local: {
          资产: "很多",
        },
        global: {},
        plain: {},
      },
    });

    expect(result.text).toBe("{{setvar::资产.金币::3}}");
    expect(result.stagedMutations).toEqual([]);
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "macro_arg_type_invalid", macroName: "setvar" }),
    ]));
  });

  it("supports richer if conditions with nested path reads", () => {
    const result = evaluateStMacros("{{if {{getvar::资产.金币}} >= 3}}RICH{{else}}POOR{{/if}}", {
      phase: "assemble",
      values: {},
      variableSnapshot: {
        local: {
          资产: {
            金币: 3,
          },
        },
        global: {},
        plain: {},
      },
    });

    expect(result.text).toBe("RICH");
  });
});
