import { describe, expect, it } from "vitest";

import { parseReplyFragments, summarizeReplyFragments } from "./parse-reply-fragments";

describe("parseReplyFragments", () => {
  it("纯文本返回单个文本片段", () => {
    const fragments = parseReplyFragments("这是一段最终回答，没有任何工具往返。");
    expect(fragments).toHaveLength(1);
    expect(fragments[0]).toMatchObject({ type: "text" });
  });

  it("拆出 tool_call 块并保留前后文本", () => {
    const content = [
      "我来帮你查看这个图。",
      '<tool_call>{"name": "nodegraph.graph.find_by_name", "arguments": {"name": "x"}}</tool_call>',
      "找到了。",
    ].join("");
    const fragments = parseReplyFragments(content);

    expect(fragments.map((f) => f.type)).toEqual(["text", "tool_call", "text"]);
    expect(fragments[1]?.toolCall).toEqual({
      name: "nodegraph.graph.find_by_name",
      arguments: { name: "x" },
    });
  });

  it("识别 tool_call 后紧邻的 tool_response 块", () => {
    const content =
      '<tool_call>{"name": "nodegraph.graph.get", "arguments": {"graph_id": "g1"}}</tool_call>' +
      '<tool_response>{"graph_id": "g1", "name": "demo"}</tool_response>';
    const fragments = parseReplyFragments(content);

    expect(fragments.map((f) => f.type)).toEqual(["tool_call", "tool_response"]);
    expect(fragments[1]?.inner).toContain("\"name\": \"demo\"");
  });

  it("识别 tool_result 块", () => {
    const fragments = parseReplyFragments('<tool_result name="x">{"data": {}}</tool_result>');
    expect(fragments.map((f) => f.type)).toEqual(["tool_result"]);
  });

  it("解析带属性的开标签", () => {
    const content = '<tool_call id="c1"name="x">{"name":"x","arguments":{}}</tool_call>';
    const fragments = parseReplyFragments(content);
    expect(fragments[0]?.type).toBe("tool_call");
    expect(fragments[0]?.toolCall?.name).toBe("x");
  });

  it("尾部未闭合的工具块标记为 malformed", () => {
    const fragments = parseReplyFragments('文本<tool_call>{"name":"x"');
    expect(fragments.map((f) => f.type)).toEqual(["text", "tool_call"]);
    expect(fragments[1]?.malformed).toBe(true);
});

  it("不把同前缀异名标签误判为工具块", () => {
    const content ="看 <tool_calls> 与 <tool_responses> 这种复数标签";
    const fragments = parseReplyFragments(content);
    expect(fragments).toHaveLength(1);
    expect(fragments[0]?.type).toBe("text");
  });

  it("JSON 无法解析时 tool_call 不带结构化字段但仍归类为工具块", () => {
    const fragments = parseReplyFragments("<tool_call>not-json</tool_call>");
    expect(fragments[0]?.type).toBe("tool_call");
    expect(fragments[0]?.toolCall).toBeUndefined();
 });
});

describe("summarizeReplyFragments", () => {
  it("统计文本 / 工具调用 / 工具结果数量并判定泄漏", () => {
    const content =
      "A" +
      "<tool_call>{}</tool_call>" +
      "<tool_response>{}</tool_response>" +
      "B" +
      "<tool_result>{}</tool_result>";
    const stats = summarizeReplyFragments(parseReplyFragments(content));
    expect(stats.textCount).toBe(2);
    expect(stats.toolCallCount).toBe(1);
    expect(stats.toolResultCount).toBe(2);
    expect(stats.hasLeakedToolBlocks).toBe(true);
  });

 it("纯文本不判定为泄漏", () => {
 const stats= summarizeReplyFragments(parseReplyFragments("只是普通回答"));
    expect(stats.hasLeakedToolBlocks).toBe(false);
  });
});
