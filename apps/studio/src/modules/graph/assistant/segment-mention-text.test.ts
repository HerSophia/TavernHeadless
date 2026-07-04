import { describe, expect, it } from "vitest";

import {
  collectMentionRefs,
  segmentMentionText,
  type MentionIndex,
} from "./segment-mention-text";
import type { MentionRef } from "./mention-types";

function indexOf(...refs: MentionRef[]): MentionIndex {
  const map: MentionIndex = new Map();
  for (const ref of refs) {
    const list = map.get(ref.name) ?? [];
    list.push(ref);
    map.set(ref.name, list);
  }
  return map;
}

const graphRef: MentionRef = { kind: "graph", id: "ngraph_x", name: "订单处理" };

describe("segmentMentionText", () => {
  it("把 @名称 识别为 mention 段并带起止下标", () => {
    const text = "看看 @订单处理 这个图";
    const segments = segmentMentionText(text, indexOf(graphRef));
    const mention = segments.find((s) => s.type === "mention");
    expect(mention).toBeTruthy();
    expect(mention?.value).toBe("@订单处理");
    expect(text.slice(mention!.start, mention!.end)).toBe("@订单处理");
  });

  it("索引为空时不识别任何 mention", () => {
    const text = "看看 @订单处理";
    const segments = segmentMentionText(text, new Map());
    expect(segments.every((s) => s.type === "text")).toBe(true);
  });

  it("名称不在索引中时按普通文本处理（降级）", () => {
    const text = "@未知名字";
    const segments = segmentMentionText(text, indexOf(graphRef));
    expect(segments.every((s) => s.type === "text")).toBe(true);
  });

  it("@ 前为非空白时不识别", () => {
    const text = "foo@订单处理";
    const segments = segmentMentionText(text, indexOf(graphRef));
    expect(segments.every((s) => s.type === "text")).toBe(true);
  });

  it("支持带空格的名称整段命中", () => {
    const spaced: MentionRef = { kind: "graph", id: "g1", name: "订单 处理" };
    const text = "@订单 处理 后面是正文";
    const segments = segmentMentionText(text, indexOf(spaced));
    const mention = segments.find((s) => s.type === "mention");
    expect(mention?.value).toBe("@订单 处理");
  });

  it("同位多名称时取最长", () => {
    const short: MentionRef = { kind: "node", id: "n1", name: "订单" };
    const long: MentionRef = { kind: "node", id: "n2", name: "订单处理" };
    const text = "@订单处理";
    const segments = segmentMentionText(text, indexOf(short, long));
    const mention = segments.find((s) => s.type === "mention");
    expect(mention?.value).toBe("@订单处理");
    expect(mention?.type === "mention" && mention.ref.id).toBe("n2");
  });

  it("同名多引用时 refs 全部保留", () => {
    const a: MentionRef = { kind: "graph",id: "g1", name: "订单处理" };
    const b: MentionRef = { kind: "graph", id: "g2", name: "订单处理" };
    const text = "@订单处理";
    const segments = segmentMentionText(text, indexOf(a, b));
    const mention = segments.find((s) => s.type === "mention");
    expect(mention?.type ==="mention" && mention.refs).toHaveLength(2);
  });
});

describe("collectMentionRefs", () => {
  it("按 kind+id 去重", () => {
    const text = "@订单处理 和 @订单处理";
    const segments = segmentMentionText(text, indexOf(graphRef));
    expect(collectMentionRefs(segments)).toHaveLength(1);
  });

  it("纯文本无 mention 时返回空数组", () => {
    const segments = segmentMentionText("普通文本", indexOf(graphRef));
    expect(collectMentionRefs(segments)).toEqual([]);
  });
});
