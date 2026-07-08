import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/assets/preset-editor", () => ({
  presetEditorApi: {
    getEditor: vi.fn(),
    save: vi.fn(),
  },
}));

// preset-editor store 在 save() 成功后对账 assets store 的 preset 列表，
// 后者内部走 libraryApi.list —— 这里 mock 掉即可（返回空表）。
vi.mock("../lib/assets/library", () => ({
  libraryApi: {
    list: vi.fn().mockResolvedValue([]),
    listVersions: vi.fn(),
    remove: vi.fn(),
  },
}));

import type { PresetEditorDetail, PresetEditorEntry, PresetListItem } from "@tavern/sdk";
import { presetEditorApi } from "../lib/assets/preset-editor";
import { libraryApi } from "../lib/assets/library";
import { usePresetEditorStore } from "./preset-editor";

function entry(over: Partial<PresetEditorEntry> = {}): PresetEditorEntry {
  return {
    identifier: "a",
    name: "A",
    role: "system",
    content: "",
    systemPrompt: false,
    marker: false,
    injectionPosition: 0,
    enabled: true,
    extra: {},
    ...over,
  };
}

function detail(over: Partial<PresetEditorDetail> = {}): PresetEditorDetail {
  return {
    id: "preset-1",
    name: "My Preset",
    source: "user",
    createdAt: 1,
    updatedAt: 2,
    version: 5,
    editor: {
      format: "legacy-compact",
      defaultCharacterId: 0,
      entries: [entry({ identifier: "a" }), entry({ identifier: "b" }), entry({ identifier: "c" })],
      orderContexts: [],
      topLevel: {},
    },
    ...over,
  };
}

const getEditorMock = vi.mocked(presetEditorApi.getEditor);
const saveMock = vi.mocked(presetEditorApi.save);
const listMock = vi.mocked(libraryApi.list);

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  listMock.mockResolvedValue([]);
});

describe("usePresetEditorStore.openEditor", () => {
  it("loads the editor detail into a clean draft and selects the first entry", async () => {
    getEditorMock.mockResolvedValue(detail());
    const store = usePresetEditorStore();

    await store.openEditor("preset-1");

    expect(store.open).toBe(true);
    expect(store.presetId).toBe("preset-1");
    expect(store.expectedVersion).toBe(5);
    expect(store.draft?.name).toBe("My Preset");
    expect(store.identifiers).toEqual(["a", "b", "c"]);
    expect(store.selectedIdentifier).toBe("a");
    expect(store.dirty).toBe(false);
    expect(store.error).toBeNull();
  });

  it("records an error and leaves the editor closed on failure", async () => {
    getEditorMock.mockRejectedValue(new Error("boom"));
    const store = usePresetEditorStore();

    await store.openEditor("preset-1");

    expect(store.open).toBe(false);
    expect(store.draft).toBeNull();
    expect(store.error).toBe("boom");
  });
});

describe("usePresetEditorStore edits", () => {
  it("marks dirty when the name changes", async () => {
    getEditorMock.mockResolvedValue(detail());
    const store = usePresetEditorStore();
    await store.openEditor("preset-1");

    store.setName("Renamed");
    expect(store.draft?.name).toBe("Renamed");
    expect(store.dirty).toBe(true);
  });

  it("updates and toggles an entry field", async () => {
    getEditorMock.mockResolvedValue(detail());
    const store = usePresetEditorStore();
    await store.openEditor("preset-1");

    store.updateEntryField("a", { content: "hello", role: "user" });
    expect(store.draft?.entries[0]).toMatchObject({ content: "hello", role: "user" });

    store.toggleEntry("a");
    expect(store.draft?.entries[0]?.enabled).toBe(false);
    expect(store.dirty).toBe(true);
  });

  it("adds a valid entry, selects it, and rejects a duplicate", async () => {
    getEditorMock.mockResolvedValue(detail());
    const store = usePresetEditorStore();
    await store.openEditor("preset-1");

    expect(store.addEntry("new-1")).toBeNull();
    expect(store.identifiers).toEqual(["a", "b", "c", "new-1"]);
    expect(store.selectedIdentifier).toBe("new-1");

    expect(store.addEntry("a")).toBe("duplicate");
    expect(store.addEntry(" ")).toBe("empty");
    expect(store.identifiers).toEqual(["a", "b", "c", "new-1"]);
  });

  it("removes an entry and reselects an adjacent one", async () => {
    getEditorMock.mockResolvedValue(detail());
    const store = usePresetEditorStore();
    await store.openEditor("preset-1");
    store.selectEntry("b");

    store.removeEntry("b");
    expect(store.identifiers).toEqual(["a", "c"]);
    expect(store.selectedIdentifier).toBe("c");
  });

  it("reorders entries", async () => {
    getEditorMock.mockResolvedValue(detail());
    const store = usePresetEditorStore();
    await store.openEditor("preset-1");

    store.moveEntry("a", 1);
    expect(store.identifiers).toEqual(["b", "a", "c"]);
    store.moveEntry("c", -1);
    expect(store.identifiers).toEqual(["b", "c", "a"]);
  });
});

describe("usePresetEditorStore.save", () => {
  function savedItem(version: number): PresetListItem {
    return { id: "preset-1", name: "My Preset", source: "user", createdAt: 1, updatedAt: 9, version };
  }

  it("saves via presetEditorApi, refreshes version/baseline and reconciles the preset list", async () => {
    getEditorMock.mockResolvedValue(detail());
    saveMock.mockResolvedValue(savedItem(6));
    const store = usePresetEditorStore();
    await store.openEditor("preset-1");
    store.setName("Renamed");
    expect(store.dirty).toBe(true);

    const ok = await store.save();

    expect(ok).toBe(true);
    expect(saveMock).toHaveBeenCalledTimes(1);
    const call = saveMock.mock.calls.at(0);
    if (!call) {
      throw new Error("save was not called");
    }
    const [id, payload, expectedVersion] = call;
    expect(id).toBe("preset-1");
    expect(expectedVersion).toBe(5);
    expect(payload.name).toBe("Renamed");
    expect(payload.editor.entries).toHaveLength(3);
    expect(store.expectedVersion).toBe(6);
    expect(store.dirty).toBe(false);
    expect(store.saving).toBe(false);
    expect(listMock).toHaveBeenCalledWith("preset", undefined);
  });

  it("flags a conflict on a 409-style failure without setting a generic error", async () => {
    getEditorMock.mockResolvedValue(detail());
    saveMock.mockRejectedValue(new Error("409 conflict: version mismatch"));
    const store = usePresetEditorStore();
    await store.openEditor("preset-1");
    store.setName("Renamed");

    const ok = await store.save();

    expect(ok).toBe(false);
    expect(store.conflict).toBe(true);
    expect(store.error).toBeNull();
  });

  it("records a generic error on non-conflict failures and keeps the draft", async () => {
    getEditorMock.mockResolvedValue(detail());
    saveMock.mockRejectedValue(new Error("network down"));
    const store = usePresetEditorStore();
    await store.openEditor("preset-1");
    store.setName("Renamed");

    const ok = await store.save();

    expect(ok).toBe(false);
    expect(store.conflict).toBe(false);
    expect(store.error).toBe("network down");
    expect(store.draft?.name).toBe("Renamed");
  });
});

describe("usePresetEditorStore.close", () => {
  it("clears all state", async () => {
    getEditorMock.mockResolvedValue(detail());
    const store = usePresetEditorStore();
    await store.openEditor("preset-1");

    store.close();

    expect(store.open).toBe(false);
    expect(store.draft).toBeNull();
    expect(store.presetId).toBeNull();
    expect(store.selectedIdentifier).toBeNull();
    expect(store.error).toBeNull();
    expect(store.conflict).toBe(false);
  });
});
