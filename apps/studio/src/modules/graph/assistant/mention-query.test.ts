import { describe, expect, it } from "vitest";

import { findActiveMentionQuery } from "./mention-query";

describe("findActiveMentionQuery", () => {
  it("在行首 @ 后激活并取过滤词", () => {
    const text = "@订单";
    expect(findActiveMentionQuery(text, text.length)).toEqual({ start: 0, query: "订单" });
  });

  it("@ 前为空白时激活", () => {
      const text = "帮我看 @订单";
    expect(findActiveMentionQuery(text, text.length)).toEqual({ start: 4, query: "订单" });
  });

  it("@ 前为非空白时不激活（避免 foo@bar 误触发）", () => {
    const text = "foo@bar";
    expect(findActiveMentionQuery(text, text.length)).toBeNull();
  });

  it("@ 到光标之间出现空格即封口", () => {
    const text = "@某个节点 我想改一下";
    expect(findActiveMentionQuery(text, text.length)).toBeNull();
  });

  it("刚输入一个 @ 时激活，过滤词为空", () => {
    const text = "你好 @";
    expect(findActiveMentionQuery(text, text.length)).toEqual({ start: 3, query: "" });
  });

  it("光标在 @query 中间时只取到光标处", () => {
    const text = "@订单处理";
    // 光标在「订单」之后（下标 3）。
    expect(findActiveMentionQuery(text, 3)).toEqual({ start: 0, query: "订单" });
  });

  it("光标左侧无 @ 时不激活", () => {
    const text = "普通文本";
    expect(findActiveMentionQuery(text, text.length)).toBeNull();
  });

  it("多个 @ 时取光标左侧最近的一个", () => {
    const text = "@甲 @乙";
expect(findActiveMentionQuery(text, text.length)).toEqual({ start: 3,query:"乙" });
  });
});
