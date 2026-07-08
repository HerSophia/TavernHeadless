import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { libraryMock, importAssetMock } = vi.hoisted(() => ({
  libraryMock: {
    list: vi.fn(),
    listVersions: vi.fn(),
    remove: vi.fn(),
  },
  importAssetMock: vi.fn(),
}));

vi.mock("../lib/assets/library", () => ({ libraryApi: libraryMock }));
vi.mock("../lib/assets/imports", () => ({ importAsset: importAssetMock }));

import { useAssetsStore } from "./assets";

function asset(id: string, kind = "preset", overrides: Record<string, unknown> = {}) {
  return { kind, id, name: id, source: "sillytavern", version: 1, createdAt: 0, updatedAt: 0, ...overrides };
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  libraryMock.list.mockResolvedValue([]);
  libraryMock.remove.mockResolvedValue(undefined);
  libraryMock.listVersions.mockResolvedValue([]);
});

describe("assets store", () => {
  it("loads assets for a kind", async () => {
    libraryMock.list.mockResolvedValue([asset("p1")]);
    const store = useAssetsStore();
    await store.loadAssets("preset");
    expect(store.lists.preset).toHaveLength(1);
    expect(store.loading).toBeNull();
  });

  it("captures load errors", async () => {
    libraryMock.list.mockRejectedValue(new Error("boom"));
    const store = useAssetsStore();
    await store.loadAssets("worldbook");
    expect(store.error).toBe("boom");
  });

  it("imports a validated file and reloads the kind", async () => {
    importAssetMock.mockResolvedValue({ id: "c1", name: "Sera", source: "sillytavern" });
    libraryMock.list.mockResolvedValue([asset("c1", "character")]);
    const store = useAssetsStore();
    const summary = await store.importValidated("character", { fileName: "Sera.png", ok: true, reason: "okCharacterImage", payload: {} });
    expect(importAssetMock).toHaveBeenCalledOnce();
    expect(summary.id).toBe("c1");
    expect(store.lists.character).toHaveLength(1);
    expect(store.importing).toBe(false);
  });

  it("removes an asset and reloads", async () => {
    const store = useAssetsStore();
    await store.removeAsset("regex", "r1");
    expect(libraryMock.remove).toHaveBeenCalledWith("regex", "r1");
    expect(libraryMock.list).toHaveBeenCalledWith("regex", undefined);
  });

  it("delegates version listing", async () => {
    libraryMock.listVersions.mockResolvedValue([{ id: "v1", versionNo: 1, createdAt: 0 }]);
    const store = useAssetsStore();
    const versions = await store.listVersions("preset", "p1");
    expect(versions).toHaveLength(1);
    expect(libraryMock.listVersions).toHaveBeenCalledWith("preset", "p1");
  });

  it("passes character query through to the server", async () => {
    const store = useAssetsStore();
    await store.loadAssets("character", { keyword: "  sera  ", sortBy: "name", sortOrder: "asc", status: "archived" });
    expect(libraryMock.list).toHaveBeenCalledWith("character", {
      keyword: "sera",
      sortBy: "name",
      sortOrder: "asc",
      status: "archived",
    });
    // 查询态被合并保存
    expect(store.query.character.keyword).toBe("  sera  ");
    expect(store.query.character.sortBy).toBe("name");
  });

  it("maps status 'all' to undefined for character query", async () => {
    const store = useAssetsStore();
    await store.loadAssets("character", { status: "all" });
    expect(libraryMock.list).toHaveBeenCalledWith("character", {
      keyword: undefined,
      sortBy: "updated_at",
      sortOrder: "desc",
      status: undefined,
    });
  });

  it("ignores query for non-character kinds (full load)", async () => {
    const store = useAssetsStore();
    await store.loadAssets("preset", { keyword: "abc" });
    expect(libraryMock.list).toHaveBeenCalledWith("preset", undefined);
  });

  it("visibleAssets applies front-end filter + sort for presets", async () => {
    libraryMock.list.mockResolvedValue([
      asset("1", "preset", { name: "Alpha", updatedAt: 10 }),
      asset("2", "preset", { name: "alpine", updatedAt: 30 }),
      asset("3", "preset", { name: "Beta", updatedAt: 20 }),
    ]);
    const store = useAssetsStore();
    await store.loadAssets("preset");
    store.query.preset.keyword = "alp";
    store.query.preset.sortBy = "updated_at";
    store.query.preset.sortOrder = "desc";
    expect(store.visibleAssets("preset").map((a) => a.id)).toEqual(["2", "1"]);
  });

  it("visibleAssets returns character list as-is (server-side)", async () => {
    libraryMock.list.mockResolvedValue([
      asset("c1", "character", { name: "Zed" }),
      asset("c2", "character", { name: "Amy" }),
    ]);
    const store = useAssetsStore();
    await store.loadAssets("character");
    store.query.character.keyword = "zzz"; // 不应在前端二次过滤
    expect(store.visibleAssets("character").map((a) => a.id)).toEqual(["c1", "c2"]);
  });

  it("counts reflect visible assets per kind", async () => {
    const store = useAssetsStore();
    libraryMock.list.mockResolvedValueOnce([asset("c1", "character"), asset("c2", "character")]);
    await store.loadAssets("character");
    libraryMock.list.mockResolvedValueOnce([
      asset("p1", "preset", { name: "keep" }),
      asset("p2", "preset", { name: "drop" }),
    ]);
    await store.loadAssets("preset");
    store.query.preset.keyword = "keep";
    expect(store.counts.character).toBe(2);
    expect(store.counts.preset).toBe(1);
    expect(store.counts.worldbook).toBe(0);
  });

  it("totals reflect raw list length regardless of keyword", async () => {
    libraryMock.list.mockResolvedValue([
      asset("p1", "preset", { name: "keep" }),
      asset("p2", "preset", { name: "drop" }),
    ]);
    const store = useAssetsStore();
    await store.loadAssets("preset");
    store.query.preset.keyword = "keep";
    // counts 随过滤变化，但 totals 保持原始长度
    expect(store.counts.preset).toBe(1);
    expect(store.totals.preset).toBe(2);
  });

  it("loadAllKinds populates all four kinds and marks them loaded", async () => {
    libraryMock.list.mockImplementation((kind: string) => Promise.resolve([asset(`${kind}-1`, kind)]));
    const store = useAssetsStore();
    await store.loadAllKinds();
    expect(store.lists.character).toHaveLength(1);
    expect(store.lists.preset).toHaveLength(1);
    expect(store.lists.worldbook).toHaveLength(1);
    expect(store.lists.regex).toHaveLength(1);
    expect(store.loaded.character).toBe(true);
    expect(store.loaded.regex).toBe(true);
    expect(libraryMock.list).toHaveBeenCalledTimes(4);
  });

  it("ensureLoaded fetches once then serves cached without re-fetching", async () => {
    libraryMock.list.mockResolvedValue([asset("w1", "worldbook")]);
    const store = useAssetsStore();
    await store.ensureLoaded("worldbook");
    await store.ensureLoaded("worldbook");
    expect(store.loaded.worldbook).toBe(true);
    expect(libraryMock.list).toHaveBeenCalledTimes(1);
  });
});

describe("assets store picker state", () => {
  it("serves ensurePickerList from cache on repeat calls", async () => {
    libraryMock.list.mockResolvedValue([asset("c1", "character")]);
    const store = useAssetsStore();
    const first = await store.ensurePickerList("character");
    const second = await store.ensurePickerList("character");
    expect(first).toHaveLength(1);
    expect(second).toBe(first);
    expect(libraryMock.list).toHaveBeenCalledTimes(1);
  });

  it("dedupes concurrent ensurePickerList calls per kind", async () => {
    let resolveList: ((items: unknown[]) => void) | undefined;
    libraryMock.list.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveList = resolve;
        }),
    );
    const store = useAssetsStore();
    const p1 = store.ensurePickerList("character");
    const p2 = store.ensurePickerList("character");
    resolveList?.([asset("c1", "character")]);
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(libraryMock.list).toHaveBeenCalledTimes(1);
    expect(r1).toHaveLength(1);
    expect(r2).toHaveLength(1);
  });

  it("refreshPickerList invalidates and re-fetches", async () => {
    libraryMock.list.mockResolvedValue([asset("c1", "character")]);
    const store = useAssetsStore();
    await store.ensurePickerList("character");
    await store.refreshPickerList("character");
    expect(libraryMock.list).toHaveBeenCalledTimes(2);
  });

  it("resolves asset name from picker cache and returns null on miss", async () => {
    libraryMock.list.mockResolvedValue([{ ...asset("c1", "character"), name: "Sera" }]);
    const store = useAssetsStore();
    await store.ensurePickerList("character");
    expect(store.getAssetName("character", "c1")).toBe("Sera");
    expect(store.getAssetName("character", "missing")).toBeNull();
  });

  it("resolves asset name from library lists when picker cache misses", async () => {
    libraryMock.list.mockResolvedValue([{ ...asset("p1", "preset"), name: "Preset A" }]);
    const store = useAssetsStore();
    await store.loadAssets("preset");
    expect(store.getAssetName("preset", "p1")).toBe("Preset A");
  });

  it("ensureAssetName loads the list then resolves the name", async () => {
    libraryMock.list.mockResolvedValue([{ ...asset("w1", "worldbook"), name: "World" }]);
    const store = useAssetsStore();
    const name = await store.ensureAssetName("worldbook", "w1");
    expect(name).toBe("World");
    expect(libraryMock.list).toHaveBeenCalledWith("worldbook");
  });

  it("keeps picker cache and library lists independent", async () => {
    libraryMock.list.mockResolvedValue([asset("c1", "character")]);
    const store = useAssetsStore();
    await store.ensurePickerList("character");
    // ensurePickerList 不写库视图 lists
    expect(store.lists.character).toHaveLength(0);

    libraryMock.list.mockResolvedValue([asset("c2", "character"), asset("c3", "character")]);
    await store.loadAssets("character");
    expect(store.lists.character).toHaveLength(2);

    // loadAssets 不覆盖选择器缓存：ensurePickerList 仍返回首拉的 1 条
    const picker = await store.ensurePickerList("character");
    expect(picker).toHaveLength(1);
  });
});
