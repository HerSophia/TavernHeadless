import { describe, expect, it } from "vitest";

import {
  collectCutEdges,
  distance,
  pickLazyConnectTarget,
  segmentsIntersect,
  type CandidateInputPort,
  type CuttableEdge,
} from "./connect-geometry";

describe("distance", () => {
  it("计算两点欧氏距离", () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});

describe("pickLazyConnectTarget", () => {
  const candidates: CandidateInputPort[] = [
    { nodeId: "a", port: "in1", type: "text", position: { x: 100, y: 100 }, occupied: false },
    { nodeId: "a", port: "in2", type: "number", position: { x: 100, y: 120 }, occupied: false },
    { nodeId: "a", port: "in3", type: "text", position: { x: 500, y: 500 }, occupied: false },
  ];

  it("挑出类型兼容且距离落点最近的空闲端口", () => {
    const target = pickLazyConnectTarget("text", { x: 105, y: 98 }, candidates);
    expect(target?.port).toBe("in1");
  });

  it("跳过类型不兼容的端口", () => {
    const target = pickLazyConnectTarget("text", { x: 100, y: 120 }, candidates);
    // 落点最近的是 number 端口（in2），但类型不兼容，退到 in1。
    expect(target?.port).toBe("in1");
  });

  it("跳过已被占用的端口", () => {
    const occupied: CandidateInputPort[] = [
      { nodeId: "a", port: "in1", type: "text", position: { x: 100, y: 100 }, occupied: true },
      { nodeId: "a", port: "in3", type: "text", position: { x: 500, y: 500 }, occupied: false },
    ];
    const target = pickLazyConnectTarget("text", { x: 105, y: 98 }, occupied);
    expect(target?.port).toBe("in3");
  });

  it("超过最大吸附距离时返回 null", () => {
    const target = pickLazyConnectTarget("text", { x: 105, y: 98 }, [candidates[2]!], 50);
    expect(target).toBeNull();
  });

  it("json 输入端口接受任意来源类型", () => {
    const jsonCandidates: CandidateInputPort[] = [
      { nodeId: "a", port: "payload", type: "json", position: { x: 10, y: 10 }, occupied: false },
    ];
    const target = pickLazyConnectTarget("messages", { x: 12, y: 11 }, jsonCandidates);
    expect(target?.port).toBe("payload");
  });
});

describe("segmentsIntersect", () => {
  it("相交的线段返回 true", ()=> {
    expect(
      segmentsIntersect(
        { a: { x: 0, y: 0 }, b: { x: 10, y: 10 } },
        { a: { x: 0, y: 10 }, b: { x: 10, y: 0 } },
      ),
    ).toBe(true);
  });

  it("不相交的线段返回 false", () => {
    expect(
      segmentsIntersect(
        { a: { x: 0, y: 0 }, b: { x: 1, y: 1 } },
        { a: { x: 5, y: 5 }, b: { x: 6, y: 6 } },
      ),
    ).toBe(false);
  });

  it("端点接触视为相交", () => {
    expect(
      segmentsIntersect(
        { a: { x: 0, y: 0 }, b: { x: 5, y: 5 } },
        { a: { x: 5, y: 5 }, b: { x: 10, y: 0 } },
      ),
    ).toBe(true);
  });
});

describe("collectCutEdges", () => {
  it("返回与划线相交的所有边 id", () => {
    const edges: CuttableEdge[] = [
      { id: "e1", segment: { a: { x: 0, y: 0 }, b: { x: 0, y: 100 } } },
      { id: "e2", segment: {a: { x: 200, y: 0 }, b: { x: 200, y: 100 }} },
      { id: "e3", segment: { a: { x: 50, y: 0 }, b: { x: 50, y: 100 } } },
    ];
    const cutLine = { a: { x: -10, y: 50 }, b: { x: 100, y: 50 } };
    const hit = collectCutEdges(cutLine, edges);
    expect(hit.sort()).toEqual(["e1", "e3"]);
  });

  it("无相交时返回空数组", () => {
    const edges: CuttableEdge[] = [{ id: "e1", segment: { a: { x: 0, y: 0 }, b: { x: 0, y: 100 } } }];
    const cutLine ={ a: { x: 500, y: 500 }, b: { x: 600, y: 600 } };
    expect(collectCutEdges(cutLine, edges)).toEqual([]);
  });
});
