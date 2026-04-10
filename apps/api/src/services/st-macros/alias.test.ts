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
});
