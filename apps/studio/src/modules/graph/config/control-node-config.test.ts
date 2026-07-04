import { describe, expect, it } from "vitest";

import {
  defaultConditionExpr,
  normalizeConditionExpr,
  readControlConditionExpr,
  readGateOnSkip,
  validateControlConditionExpr,
  writeControlConditionExpr,
  writeGateOnSkipConfig,
} from "./control-node-config";

import type { NodeGraphConditionExpr } from "@tavern/core/node-graph";

describe("control-node-config", () => {
  it("reads a missing condition as null", () => {
    expect(readControlConditionExpr({})).toBeNull();
  });

  it("normalizes unknown condition shapes to a controlled default", () => {
    expect(normalizeConditionExpr({ op: "javascript", code: "return true" })).toEqual({
      op: "exists",
      value: { source: "runtime", path: ["intent"] },
    });
  });

  it("writes inline conditions while preserving unknown config fields", () => {
    const condition: NodeGraphConditionExpr = {
      op: "eq",
      left: { source: "runtime", path: ["intent"] },
      right: "preview",
    };
    const next = writeControlConditionExpr({ label: "keep", condition: defaultConditionExpr() }, condition);
    expect(next).toEqual({ label: "keep", condition });
  });

  it("removes inline conditions when the node should use its condition input", () => {
    const next = writeControlConditionExpr({ label: "keep", condition: defaultConditionExpr() }, null);
    expect(next).toEqual({ label: "keep" });
  });

  it("validates malformed and/or expressions through core validation", () => {
    const issues = validateControlConditionExpr({ op: "and", items: [] });
    expect(issues.map((issue) => issue.code)).toContain("condition_empty_items");
  });

  it("reads and writes gate onSkip using core-supported values", () => {
    expect(readGateOnSkip({ onSkip: "use_cached" })).toBe("use_cached");
    expect(readGateOnSkip({ onSkip: "unknown" })).toBe("empty_output");
    expect(writeGateOnSkipConfig({ condition: defaultConditionExpr() }, "use_default")).toEqual({
      condition: defaultConditionExpr(),
      onSkip: "use_default",
    });
  });
});
