import { describe, expect, it } from "vitest";

import { evaluateStMacros } from "./runtime.js";

describe("st-macros alias", () => {
  it("normalizes legacy user and char aliases", () => {
    const result = evaluateStMacros("<USER> meets <BOT> and <CHAR>", {
      phase: "assemble",
      values: { user: "Traveler", char: "Knight" },
    });

    expect(result.text).toBe("Traveler meets Knight and Knight");
  });

  it("resolves shorthand variable aliases", () => {
    const result = evaluateStMacros("{{.mood}}/{{$world}}", {
      phase: "assemble",
      values: { mood: "calm", world: "earth" },
    });

    expect(result.text).toBe("calm/earth");
  });

  it("normalizes variable macro aliases to canonical macro names in traces and used macros", () => {
    const result = evaluateStMacros("{{varexists::mood}}/{{globalvarexists::world}}{{flushvar::mood}}{{flushglobalvar::world}}", {
      phase: "assemble",
      values: {},
      variableSnapshot: {
        local: { mood: "calm" },
        global: { world: "earth" },
        plain: {},
      },
    });

    expect(result.text).toBe("true/true");
    expect(result.usedMacros).toEqual(expect.arrayContaining(["hasvar", "hasglobalvar", "deletevar", "deleteglobalvar"]));
    expect(result.usedMacros).not.toContain("varexists");
    expect(result.usedMacros).not.toContain("globalvarexists");
    expect(result.usedMacros).not.toContain("flushvar");
    expect(result.usedMacros).not.toContain("flushglobalvar");
    expect(result.traces).toEqual(expect.arrayContaining([
      expect.objectContaining({ macroName: "hasvar", rawText: "{{varexists::mood}}", resolvedText: "true" }),
      expect.objectContaining({ macroName: "hasglobalvar", rawText: "{{globalvarexists::world}}", resolvedText: "true" }),
      expect.objectContaining({ macroName: "deletevar", rawText: "{{flushvar::mood}}", resolvedText: "" }),
      expect.objectContaining({ macroName: "deleteglobalvar", rawText: "{{flushglobalvar::world}}", resolvedText: "" }),
    ]));
    expect(result.stagedMutations).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: "branch", key: "mood", sourceMacro: "deletevar" }),
      expect.objectContaining({ scope: "global", key: "world", sourceMacro: "deleteglobalvar" }),
    ]));
  });
});
