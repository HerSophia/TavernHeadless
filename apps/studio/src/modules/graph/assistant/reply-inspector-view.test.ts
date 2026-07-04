import { describe, expect, it } from "vitest";

import type { AssistantFloorMessageView, AssistantFloorView } from "./floor-view-model";
import { buildReplyInspectorView } from "./reply-inspector-view";

function floor(over: Partial<AssistantFloorView> = {}): AssistantFloorView {
  return {
    id: "f1",
    floorNo: 1,
    state: "committed",
messages: [],
    steps: [],
    metrics: {
      finishedAt: 1000,
      durationMs: 2000,
      tokensPerSecond: 10,
      totalTokens: 150,
      tokenIn: 100,
      tokenOut: 50,
      cachedTokens: null,
    },
    ...over,
};
}

function message(content: string): AssistantFloorMessageView {
  return { id: "m1", role: "assistant", content };
}

describe("buildReplyInspectorView", () => {
  it("装配正文、思考、片段、统计与元信息", () => {
    const view = buildReplyInspectorView({
      floor: floor({ reasoning:"先找图，再读图" }),
      message: message("回答正文"),
    });

 expect(view.role).toBe("assistant");
    expect(view.content).toBe("回答正文");
    expect(view.reasoning).toBe("先找图，再读图");
    expect(view.stats.hasLeakedToolBlocks).toBe(false);
    expect(view.meta).toMatchObject({
      floorId: "f1",
      floorNo: 1,
      state: "committed",
      tokenIn: 100,
      tokenOut: 50,
      totalTokens: 150,
      durationMs: 2000,
    });
  });

  it("无思考时 reasoning 为 null", () =>{
    const view = buildReplyInspectorView({ floor: floor(), message: message("x") });
   expect(view.reasoning).toBeNull();
  });

  it("从正文抽取工具调用并配对紧邻结果", () => {
    const content =
      "我来查看。" +
      '<tool_call>{"name": "nodegraph.graph.get", "arguments": {"graph_id": "g1"}}</tool_call>' +
      '<tool_response>{"graph_id": "g1", "name": "demo"}</tool_response>' +
      "完成。";
    const view = buildReplyInspectorView({ floor: floor(),message: message(content) });

    expect(view.stats.hasLeakedToolBlocks).toBe(true);
    expect(view.toolCalls).toHaveLength(1);
    expect(view.toolCalls[0]).toMatchObject({
      index: 1,
      name: "nodegraph.graph.get",
      malformed: false,
    });
    expect(view.toolCalls[0]?.argsText).toContain("graph_id");
    expect(view.toolCalls[0]?.resultText).toContain("demo");
  });

  it("无结果块时工具调用的 resultText为 null", () => {
    const content = '<tool_call>{"name": "x", "arguments": {}}</tool_call>';
    const view = buildReplyInspectorView({ floor: floor(), message: message(content) });
    expect(view.toolCalls[0]?.resultText).toBeNull();
  });
});
