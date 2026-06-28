import { describe, expect, it } from "vitest";

import {
  DEFAULT_ARG_ENTRY_LIMIT,
  MAX_ARG_VALUE_LENGTH,
  formatArgValue,
  isDangerSideEffect,
  shortToolName,
  summarizeToolArgs,
} from "./pending-tool-call-view";

describe("formatArgValue", () => {
  it("keeps short strings as-is", () => {
    expect(formatArgValue("hello")).toBe("hello");
  });

  it("stringifies primitives", () => {
    expect(formatArgValue(42)).toBe("42");
    expect(formatArgValue(true)).toBe("true");
    expect(formatArgValue(null)).toBe("null");
    expect(formatArgValue(undefined)).toBe("undefined");
  });

  it("compacts objects/arrays to single-line JSON", () => {
    expect(formatArgValue({ a: 1, b: [2, 3] })).toBe('{"a":1,"b":[2,3]}');
  });

  it("collapses internal whitespace and newlines", () => {
    expect(formatArgValue("a\n  b\t c")).toBe("a b c");
  });

  it("truncates over-long values with an ellipsis", () => {
    const long = "x".repeat(MAX_ARG_VALUE_LENGTH + 20);
    const out = formatArgValue(long);
    expect(out.length).toBe(MAX_ARG_VALUE_LENGTH);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("summarizeToolArgs", () => {
  it("returns sorted key/value entries", () => {
    const summary = summarizeToolArgs({ name: "New", mode: "native_graph" });
    expect(summary.entries.map((e) => e.key)).toEqual(["mode", "name"]);
    expect(summary.truncatedCount).toBe(0);
  });

  it("folds extra entries beyond the limit", () => {
    const args: Record<string, unknown> = {};
    for (let i = 0; i < DEFAULT_ARG_ENTRY_LIMIT + 3; i += 1) {
      args[`k${i}`] = i;
    }
    const summary = summarizeToolArgs(args);
    expect(summary.entries.length).toBe(DEFAULT_ARG_ENTRY_LIMIT);
    expect(summary.truncatedCount).toBe(3);
  });

  it("respects an explicit limit", () => {
    const summary = summarizeToolArgs({ a: 1, b: 2, c: 3 }, 1);
    expect(summary.entries.length).toBe(1);
    expect(summary.truncatedCount).toBe(2);
  });

  it("handles empty / missing args", () => {
    expect(summarizeToolArgs({})).toEqual({ entries: [], truncatedCount: 0 });
    expect(summarizeToolArgs(null)).toEqual({ entries: [], truncatedCount: 0 });
    expect(summarizeToolArgs(undefined)).toEqual({ entries: [], truncatedCount: 0 });
  });
});

describe("isDangerSideEffect", () => {
  it("flags only irreversible side effects", () => {
    expect(isDangerSideEffect("irreversible")).toBe(true);
    expect(isDangerSideEffect("sandbox")).toBe(false);
    expect(isDangerSideEffect("none")).toBe(false);
    expect(isDangerSideEffect(null)).toBe(false);
    expect(isDangerSideEffect(undefined)).toBe(false);
  });
});

describe("shortToolName (re-exported)", () => {
  it("drops the nodegraph prefix", () => {
    expect(shortToolName("nodegraph.graph.create")).toBe("graph.create");
    expect(shortToolName("custom.tool")).toBe("custom.tool");
  });
});
