import { describe, expect, it } from "vitest";

import { formatBadgeCount } from "./badge-format";

describe("formatBadgeCount", () => {
  it("上限内原样输出", () => {
    expect(formatBadgeCount(0)).toBe("0");
    expect(formatBadgeCount(5)).toBe("5");
    expect(formatBadgeCount(99)).toBe("99");
  });

  it("超过上限折叠为 N+", () => {
    expect(formatBadgeCount(100)).toBe("99+");
    expect(formatBadgeCount(1000)).toBe("99+");
  });

  it("支持自定义上限", () => {
    expect(formatBadgeCount(9, 9)).toBe("9");
    expect(formatBadgeCount(10, 9)).toBe("9+");
  });

  it("负数归零", () => {
    expect(formatBadgeCount(-3)).toBe("0");
  });

  it("小数取整", () => {
    expect(formatBadgeCount(3.7)).toBe("3");
  });

  it("非有限数返回空串", () => {
    expect(formatBadgeCount(Number.NaN)).toBe("");
    expect(formatBadgeCount(Number.POSITIVE_INFINITY)).toBe("");
  });
});
