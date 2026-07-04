import { describe, expect, it } from "vitest";

import { applyTokenBudget, estimateTokens } from "./estimate-tokens";

describe("estimateTokens",() => {
  it("空串为 0", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("CJK 每字约 1 token", () => {
    expect(estimateTokens("你好世界")).toBe(4);
  });

  it("ASCII 按约 4 字符 1 token", () => {
    expect(estimateTokens("aaaa")).toBe(1);
    expect(estimateTokens("aaaaa")).toBe(2);
  });
});

describe("applyTokenBudget", () => {
  it("未超预算原样返回", () => {
    const result = applyTokenBudget("你好世界", 100);
    expect(result.truncated).toBe(false);
    expect(result.text).toBe("你好世界");
  });

  it("maxTokens < 0 表示不限制", () => {
    const long = "你".repeat(1000);
    const result = applyTokenBudget(long, -1);
    expect(result.truncated).toBe(false);
    expect(result.text).toBe(long);
  });

  it("超预算时截断并加省略提示，结果不超过预算", () => {
    const long = "你".repeat(1000);
    const result = applyTokenBudget(long, 50);
    expect(result.truncated).toBe(true);
    expect(result.tokens).toBeLessThanOrEqual(50);
    expect(result.text).toContain("已截断");
  });
});
