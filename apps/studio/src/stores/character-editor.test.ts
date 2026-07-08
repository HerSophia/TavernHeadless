import { TavernApiError } from "@tavern/sdk";
import type { CharacterDetail, CharacterWriteVersion } from "@tavern/sdk";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/assets/character-editor", () => ({
  characterEditorApi: {
    getDetail: vi.fn(),
    saveVersion: vi.fn(),
  },
}));

// save() 成功后对账 assets store 的 character 列表，后者内部走 libraryApi.list —— mock 返回空表。
vi.mock("../lib/assets/library", () => ({
  libraryApi: {
    list: vi.fn().mockResolvedValue([]),
    listVersions: vi.fn(),
    remove: vi.fn(),
  },
}));

import { characterEditorApi } from "../lib/assets/character-editor";
import { libraryApi } from "../lib/assets/library";
import { useCharacterEditorStore } from "./character-editor";

function snapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "Aria",
    description: "A brave knight.",
    primaryGreeting: "Hello there.",
    tags: ["fantasy"],
    extensions: { world: "eldoria" },
    ...overrides,
  };
}

function detail(overrides: Partial<CharacterDetail> = {}): CharacterDetail {
  return {
    createdAt: 1,
    deletedAt: null,
    id: "char-1",
    latestVersion: {
      characterId: "char-1",
      contentHash: "hash",
      createdAt: 1,
      id: "ver-1",
      snapshot: snapshot(),
      versionNo: 3,
    },
    latestVersionNo: 3,
    name: "Aria",
    revision: 5,
    source: "sillytavern",
    status: "active",
    updatedAt: 2,
    ...overrides,
  };
}

function writeVersion(overrides: Partial<CharacterWriteVersion> = {}): CharacterWriteVersion {
  return {
    characterId: "char-1",
    contentHash: "hash2",
    createdAt: 9,
    id: "ver-2",
    snapshot: snapshot({ description: "Renamed body." }),
    versionNo: 4,
    revision: 6,
    ...overrides,
  };
}

const getDetailMock = vi.mocked(characterEditorApi.getDetail);
const saveVersionMock = vi.mocked(characterEditorApi.saveVersion);
const listMock = vi.mocked(libraryApi.list);

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  listMock.mockResolvedValue([]);
});

describe("useCharacterEditorStore.openEditor", () => {
  it("loads detail into a clean draft with revision baseline", async () => {
    getDetailMock.mockResolvedValue(detail());
    const store = useCharacterEditorStore();

    await store.openEditor("char-1");

    expect(store.open).toBe(true);
    expect(store.characterId).toBe("char-1");
    expect(store.expectedRevision).toBe(5);
    expect(store.draft?.name).toBe("Aria");
    expect(store.draft?.primaryGreeting).toBe("Hello there.");
    expect(store.draft?.tags).toBe("fantasy");
    expect(store.dirty).toBe(false);
    expect(store.nameInvalid).toBe(false);
    expect(store.lastError).toBeNull();
  });

  it("handles a character without any version (empty snapshot)", async () => {
    getDetailMock.mockResolvedValue(detail({ latestVersion: null, latestVersionNo: null }));
    const store = useCharacterEditorStore();

    await store.openEditor("char-1");

    expect(store.open).toBe(true);
    expect(store.draft?.name).toBe("");
    expect(store.nameInvalid).toBe(true);
  });

  it("records an error and leaves the editor closed on failure", async () => {
    getDetailMock.mockRejectedValue(new TavernApiError({ message: "boom", status: 500 }));
    const store = useCharacterEditorStore();

    await store.openEditor("char-1");

    expect(store.open).toBe(false);
    expect(store.draft).toBeNull();
    expect(store.lastError).toEqual({ kind: "unknown", message: "boom" });
  });
});

describe("useCharacterEditorStore edits", () => {
  it("marks dirty when a field changes", async () => {
    getDetailMock.mockResolvedValue(detail());
    const store = useCharacterEditorStore();
    await store.openEditor("char-1");

    store.updateField({ description: "changed" });
    expect(store.draft?.description).toBe("changed");
    expect(store.dirty).toBe(true);
  });
});

describe("useCharacterEditorStore.save", () => {
  it("saves via createVersion, refreshes revision/baseline and reconciles the character list", async () => {
    getDetailMock.mockResolvedValue(detail());
    saveVersionMock.mockResolvedValue(writeVersion());
    const store = useCharacterEditorStore();
    await store.openEditor("char-1");
    store.updateField({ description: "Renamed body." });
    expect(store.dirty).toBe(true);

    const ok = await store.save();

    expect(ok).toBe(true);
    expect(saveVersionMock).toHaveBeenCalledTimes(1);
    const call = saveVersionMock.mock.calls.at(0);
    if (!call) {
      throw new Error("saveVersion was not called");
    }
    const [id, sentSnapshot, expectedRevision] = call;
    expect(id).toBe("char-1");
    expect(expectedRevision).toBe(5);
    expect(sentSnapshot.name).toBe("Aria");
    expect(sentSnapshot.description).toBe("Renamed body.");
    // passthrough 无损透传
    expect(sentSnapshot.extensions).toEqual({ world: "eldoria" });
    expect(store.expectedRevision).toBe(6);
    expect(store.dirty).toBe(false);
    expect(store.saving).toBe(false);
    // 对账走 assets.loadAssets("character")，其内部以服务端查询参数调 libraryApi.list（区别于 preset/worldbook 的 undefined）。
    expect(listMock).toHaveBeenCalledWith(
      "character",
      expect.objectContaining({ sortBy: "updated_at", sortOrder: "desc", status: "active" }),
    );
  });

  it("blocks save and does not call the API when name is empty", async () => {
    getDetailMock.mockResolvedValue(detail());
    const store = useCharacterEditorStore();
    await store.openEditor("char-1");
    store.updateField({ name: "   " });

    const ok = await store.save();

    expect(ok).toBe(false);
    expect(saveVersionMock).not.toHaveBeenCalled();
  });

  it("flags conflict on 409 without auto-reloading", async () => {
    getDetailMock.mockResolvedValue(detail());
    saveVersionMock.mockRejectedValue(new TavernApiError({ message: "revision conflict", status: 409 }));
    const store = useCharacterEditorStore();
    await store.openEditor("char-1");
    store.updateField({ description: "changed" });

    const ok = await store.save();

    expect(ok).toBe(false);
    expect(store.lastError?.kind).toBe("conflict");
    expect(getDetailMock).toHaveBeenCalledTimes(1); // 未自动重载
    expect(store.draft?.description).toBe("changed"); // 本地草稿保留
  });

  it("maps 503 to busy and 403 to forbidden", async () => {
    getDetailMock.mockResolvedValue(detail());
    const store = useCharacterEditorStore();
    await store.openEditor("char-1");
    store.updateField({ description: "changed" });

    saveVersionMock.mockRejectedValueOnce(new TavernApiError({ message: "busy", status: 503 }));
    expect(await store.save()).toBe(false);
    expect(store.lastError?.kind).toBe("busy");

    saveVersionMock.mockRejectedValueOnce(new TavernApiError({ message: "forbidden", status: 403 }));
    expect(await store.save()).toBe(false);
    expect(store.lastError?.kind).toBe("forbidden");
  });
});

describe("useCharacterEditorStore.reload / close", () => {
  it("reload refetches the latest version, discarding local edits", async () => {
    getDetailMock.mockResolvedValue(detail());
    const store = useCharacterEditorStore();
    await store.openEditor("char-1");
    store.updateField({ description: "local edit" });
    expect(store.dirty).toBe(true);

    await store.reload();

    expect(getDetailMock).toHaveBeenCalledTimes(2);
    expect(store.draft?.description).toBe("A brave knight.");
    expect(store.dirty).toBe(false);
  });

  it("close clears all state", async () => {
    getDetailMock.mockResolvedValue(detail());
    const store = useCharacterEditorStore();
    await store.openEditor("char-1");

    store.close();

    expect(store.open).toBe(false);
    expect(store.draft).toBeNull();
    expect(store.characterId).toBeNull();
    expect(store.expectedRevision).toBe(0);
    expect(store.lastError).toBeNull();
  });
});
