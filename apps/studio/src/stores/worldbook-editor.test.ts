import { TavernApiError } from "@tavern/sdk";
import type { WorldbookDetail, WorldbookEntryRecord } from "@tavern/sdk";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { worldbookMock } = vi.hoisted(() => ({
  worldbookMock: {
    getDetail: vi.fn(),
    listEntries: vi.fn(),
    createEntry: vi.fn(),
    updateEntry: vi.fn(),
    removeEntry: vi.fn(),
    reorderEntries: vi.fn(),
    updateBook: vi.fn(),
  },
}));

vi.mock("../lib/assets/worldbook", () => ({ worldbookApi: worldbookMock }));

import { useWorldbookEditorStore } from "./worldbook-editor";

function detail(overrides: Partial<WorldbookDetail> = {}): WorldbookDetail {
  return {
    createdAt: 0,
    data: { scanDepth: 2 },
    id: "wb1",
    name: "Lore",
    source: "sillytavern",
    updatedAt: 0,
    version: 5,
    ...overrides,
  };
}

function entry(overrides: Partial<WorldbookEntryRecord> = {}): WorldbookEntryRecord {
  return {
    caseSensitive: null,
    comment: "c",
    constant: false,
    content: "body",
    createdAt: 0,
    depth: 4,
    disable: false,
    id: "e1",
    keys: ["k"],
    keysSecondary: [],
    matchWholeWords: null,
    order: 100,
    position: 0,
    role: 0,
    scanDepth: null,
    selective: true,
    selectiveLogic: 0,
    uid: 1,
    updatedAt: 0,
    worldbookId: "wb1",
    ...overrides,
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  worldbookMock.getDetail.mockResolvedValue(detail());
  worldbookMock.listEntries.mockResolvedValue([]);
  worldbookMock.createEntry.mockResolvedValue(entry());
  worldbookMock.updateEntry.mockResolvedValue(entry());
  worldbookMock.removeEntry.mockResolvedValue(undefined);
  worldbookMock.reorderEntries.mockResolvedValue({ meta: { notFound: 0, total: 0, updated: 0 }, results: [] });
  worldbookMock.updateBook.mockResolvedValue({ createdAt: 0, id: "wb1", name: "x", source: "s", updatedAt: 0, version: 6 });
});

describe("worldbook editor store", () => {
  it("opens and loads detail + entries", async () => {
    worldbookMock.listEntries.mockResolvedValue([entry({ id: "e1" })]);
    const store = useWorldbookEditorStore();
    await store.open("wb1");
    expect(store.detail?.version).toBe(5);
    expect(store.entries).toHaveLength(1);
    expect(store.loading).toBe(false);
    expect(store.lastError).toBeNull();
  });

  it("captures load errors", async () => {
    worldbookMock.getDetail.mockRejectedValue(new Error("nope"));
    const store = useWorldbookEditorStore();
    await store.open("wb1");
    expect(store.lastError?.kind).toBe("unknown");
    expect(store.lastError?.message).toBe("nope");
  });

  it("creates an entry with the current version and reconciles", async () => {
    const store = useWorldbookEditorStore();
    await store.open("wb1");
    const ok = await store.createEntry({
      comment: "",
      keys: "hero",
      keysSecondary: "",
      content: "text",
      position: 0,
      role: 0,
      depth: 4,
      order: 100,
      selective: true,
      selectiveLogic: 0,
      constant: false,
      disable: false,
      scanDepth: null,
      caseSensitive: "inherit",
      matchWholeWords: "inherit",
    });
    expect(ok).toBe(true);
    expect(worldbookMock.createEntry).toHaveBeenCalledWith(
      expect.objectContaining({ worldbookId: "wb1", content: "text", keys: ["hero"] }),
      5,
    );
    // open + reconcile after write
    expect(worldbookMock.getDetail).toHaveBeenCalledTimes(2);
    expect(store.saving).toBe(false);
  });

  it("toggles disable via update", async () => {
    worldbookMock.listEntries.mockResolvedValue([entry({ id: "e1", disable: false })]);
    const store = useWorldbookEditorStore();
    await store.open("wb1");
    const ok = await store.setEntryDisabled("e1", true);
    expect(ok).toBe(true);
    expect(worldbookMock.updateEntry).toHaveBeenCalledWith(
      expect.objectContaining({ entryId: "e1", disable: true }),
      5,
    );
  });

  it("reorders and skips no-op moves", async () => {
    worldbookMock.listEntries.mockResolvedValue([
      entry({ id: "a", uid: 1, order: 100 }),
      entry({ id: "b", uid: 2, order: 100 }),
      entry({ id: "c", uid: 3, order: 100 }),
    ]);
    const store = useWorldbookEditorStore();
    await store.open("wb1");

    const noop = await store.moveEntry("a", "up");
    expect(noop).toBe(false);
    expect(worldbookMock.reorderEntries).not.toHaveBeenCalled();

    const moved = await store.moveEntry("b", "up");
    expect(moved).toBe(true);
    expect(worldbookMock.reorderEntries).toHaveBeenCalledWith(
      "wb1",
      [
        { id: "b", order: 0 },
        { id: "a", order: 1 },
        { id: "c", order: 2 },
      ],
      5,
    );
  });

  it("renames the book preserving global data", async () => {
    const store = useWorldbookEditorStore();
    await store.open("wb1");
    const ok = await store.renameBook("New Name");
    expect(ok).toBe(true);
    expect(worldbookMock.updateBook).toHaveBeenCalledWith("wb1", "New Name", { scanDepth: 2 }, 5);
  });

  it("marks conflict, reconciles and returns false on 409", async () => {
    worldbookMock.updateEntry.mockRejectedValue(new TavernApiError({ message: "conflict", status: 409 }));
    worldbookMock.listEntries.mockResolvedValue([entry({ id: "e1" })]);
    const store = useWorldbookEditorStore();
    await store.open("wb1");
    const ok = await store.updateEntry("e1", {
      ...{
        comment: "",
        keys: "hero",
        keysSecondary: "",
        content: "text",
        position: 0,
        role: 0,
        depth: 4,
        order: 100,
        selective: true,
        selectiveLogic: 0,
        constant: false,
        disable: false,
        scanDepth: null,
        caseSensitive: "inherit" as const,
        matchWholeWords: "inherit" as const,
      },
    });
    expect(ok).toBe(false);
    expect(store.lastError?.kind).toBe("conflict");
    // open + reconcile-after-conflict
    expect(worldbookMock.getDetail).toHaveBeenCalledTimes(2);
    expect(store.saving).toBe(false);
  });

  it("marks busy on 503 without extra reconcile", async () => {
    worldbookMock.removeEntry.mockRejectedValue(new TavernApiError({ message: "busy", status: 503 }));
    const store = useWorldbookEditorStore();
    await store.open("wb1");
    const ok = await store.removeEntry("e1");
    expect(ok).toBe(false);
    expect(store.lastError?.kind).toBe("busy");
    expect(worldbookMock.getDetail).toHaveBeenCalledTimes(1);
  });
});
