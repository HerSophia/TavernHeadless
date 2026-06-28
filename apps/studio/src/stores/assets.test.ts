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

function asset(id: string, kind = "preset") {
  return { kind, id, name: id, source: "sillytavern", version: 1, createdAt: 0, updatedAt: 0 };
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
    expect(libraryMock.list).toHaveBeenCalledWith("regex");
  });

  it("delegates version listing", async () => {
    libraryMock.listVersions.mockResolvedValue([{ id: "v1", versionNo: 1, createdAt: 0 }]);
    const store = useAssetsStore();
    const versions = await store.listVersions("preset", "p1");
    expect(versions).toHaveLength(1);
    expect(libraryMock.listVersions).toHaveBeenCalledWith("preset", "p1");
  });
});
