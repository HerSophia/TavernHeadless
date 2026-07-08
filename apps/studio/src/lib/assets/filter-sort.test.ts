import { describe, expect, it } from "vitest";

import { countAssets, filterAndSort, filterByKeyword, sortAssets } from "./filter-sort";
import type { LibraryAsset } from "./types";

function asset(partial: Partial<LibraryAsset> & { id: string }): LibraryAsset {
  return {
    kind: "preset",
    name: partial.id,
    source: "sillytavern",
    version: 1,
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

describe("filterByKeyword", () => {
  it("空 keyword 返回原数组（同引用）", () => {
    const list = [asset({ id: "a" }), asset({ id: "b" })];
    expect(filterByKeyword(list, "")).toBe(list);
    expect(filterByKeyword(list, "   ")).toBe(list);
  });

  it("不区分大小写按 name 过滤", () => {
    const list = [asset({ id: "1", name: "Alpha" }), asset({ id: "2", name: "beta" })];
    expect(filterByKeyword(list, "ALP").map((a) => a.id)).toEqual(["1"]);
    expect(filterByKeyword(list, "BET").map((a) => a.id)).toEqual(["2"]);
  });

  it("无匹配返回空数组", () => {
    const list = [asset({ id: "1", name: "Alpha" })];
    expect(filterByKeyword(list, "zzz")).toEqual([]);
  });
});

describe("sortAssets", () => {
  it("按 name 升序 / 降序", () => {
    const list = [asset({ id: "1", name: "Bob" }), asset({ id: "2", name: "alice" }), asset({ id: "3", name: "Cara" })];
    expect(sortAssets(list, "name", "asc").map((a) => a.name)).toEqual(["alice", "Bob", "Cara"]);
    expect(sortAssets(list, "name", "desc").map((a) => a.name)).toEqual(["Cara", "Bob", "alice"]);
  });

  it("按 updated_at / created_at 排序", () => {
    const list = [
      asset({ id: "1", updatedAt: 30, createdAt: 1 }),
      asset({ id: "2", updatedAt: 10, createdAt: 3 }),
      asset({ id: "3", updatedAt: 20, createdAt: 2 }),
    ];
    expect(sortAssets(list, "updated_at", "desc").map((a) => a.id)).toEqual(["1", "3", "2"]);
    expect(sortAssets(list, "created_at", "asc").map((a) => a.id)).toEqual(["1", "3", "2"]);
  });

  it("稳定排序：等值元素保持原相对次序", () => {
    const list = [
      asset({ id: "1", updatedAt: 5 }),
      asset({ id: "2", updatedAt: 5 }),
      asset({ id: "3", updatedAt: 5 }),
    ];
    expect(sortAssets(list, "updated_at", "desc").map((a) => a.id)).toEqual(["1", "2", "3"]);
    expect(sortAssets(list, "updated_at", "asc").map((a) => a.id)).toEqual(["1", "2", "3"]);
  });

  it("不改动入参数组", () => {
    const list = [asset({ id: "2", name: "b" }), asset({ id: "1", name: "a" })];
    const snapshot = list.map((a) => a.id);
    sortAssets(list, "name", "asc");
    expect(list.map((a) => a.id)).toEqual(snapshot);
  });
});

describe("countAssets", () => {
  it("返回长度", () => {
    expect(countAssets([])).toBe(0);
    expect(countAssets([asset({ id: "1" }), asset({ id: "2" })])).toBe(2);
  });
});

describe("filterAndSort", () => {
  it("先过滤后排序", () => {
    const list = [
      asset({ id: "1", name: "Alpha", updatedAt: 10 }),
      asset({ id: "2", name: "alpine", updatedAt: 30 }),
      asset({ id: "3", name: "beta", updatedAt: 20 }),
    ];
    expect(filterAndSort(list, "alp", "updated_at", "desc").map((a) => a.id)).toEqual(["2", "1"]);
  });
});
