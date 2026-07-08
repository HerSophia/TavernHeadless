import { TavernApiError } from "@tavern/sdk";
import type { WorldbookEntryRecord } from "@tavern/sdk";
import { describe, expect, it } from "vitest";

import {
  classifyWorldbookWriteError,
  computeMoveReorder,
  draftToCreateInput,
  draftToUpdateInput,
  emptyEntryDraft,
  entryToDraft,
  formatKeys,
  parseKeys,
  validateEntryDraft,
} from "./worldbook-editor";

function entryRecord(overrides: Partial<WorldbookEntryRecord> = {}): WorldbookEntryRecord {
  return {
    caseSensitive: null,
    comment: "note",
    constant: false,
    content: "body",
    createdAt: 1,
    depth: 4,
    disable: false,
    id: "e1",
    keys: ["alpha", "beta"],
    keysSecondary: ["gamma"],
    matchWholeWords: null,
    order: 100,
    position: 0,
    role: 0,
    scanDepth: null,
    selective: true,
    selectiveLogic: 0,
    uid: 1,
    updatedAt: 2,
    worldbookId: "wb1",
    ...overrides,
  };
}

describe("emptyEntryDraft", () => {
  it("matches backend defaults", () => {
    expect(emptyEntryDraft()).toEqual({
      comment: "",
      keys: "",
      keysSecondary: "",
      content: "",
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
  });
});

describe("parseKeys / formatKeys", () => {
  it("splits by comma and newline, trims, drops empties and dedups", () => {
    expect(parseKeys("alpha, beta\n beta ,, gamma\n")).toEqual(["alpha", "beta", "gamma"]);
  });

  it("returns empty array for blank text", () => {
    expect(parseKeys("  \n , ")).toEqual([]);
  });

  it("joins with comma-space", () => {
    expect(formatKeys(["alpha", "beta"])).toBe("alpha, beta");
  });
});

describe("entryToDraft / draftToCreateInput / draftToUpdateInput", () => {
  it("maps a record to a draft with tri-state and key text", () => {
    const draft = entryToDraft(
      entryRecord({ caseSensitive: true, matchWholeWords: false, scanDepth: 3, keys: ["a", "b"], keysSecondary: [] }),
    );
    expect(draft.caseSensitive).toBe("on");
    expect(draft.matchWholeWords).toBe("off");
    expect(draft.scanDepth).toBe(3);
    expect(draft.keys).toBe("a, b");
    expect(draft.keysSecondary).toBe("");
  });

  it("maps null tri-state to inherit", () => {
    const draft = entryToDraft(entryRecord({ caseSensitive: null, matchWholeWords: null }));
    expect(draft.caseSensitive).toBe("inherit");
    expect(draft.matchWholeWords).toBe("inherit");
  });

  it("round-trips draft -> create input with parsed keys and tri-state booleans", () => {
    const draft = entryToDraft(entryRecord({ caseSensitive: true, matchWholeWords: null }));
    const input = draftToCreateInput(draft, "wb9");
    expect(input.worldbookId).toBe("wb9");
    expect(input.keys).toEqual(["alpha", "beta"]);
    expect(input.keysSecondary).toEqual(["gamma"]);
    expect(input.caseSensitive).toBe(true);
    expect(input.matchWholeWords).toBeNull();
  });

  it("update input carries entryId", () => {
    const input = draftToUpdateInput(emptyEntryDraft(), "wb9", "entry-42");
    expect(input.worldbookId).toBe("wb9");
    expect(input.entryId).toBe("entry-42");
  });
});

describe("validateEntryDraft", () => {
  it("flags empty content", () => {
    const result = validateEntryDraft({ ...emptyEntryDraft(), content: "   ", keys: "a" });
    expect(result.ok).toBe(false);
    expect(result.errors.content).toBe("contentRequired");
  });

  it("requires keys when not constant", () => {
    const result = validateEntryDraft({ ...emptyEntryDraft(), content: "x", keys: "", constant: false });
    expect(result.ok).toBe(false);
    expect(result.errors.keys).toBe("keysRequired");
  });

  it("allows empty keys when constant", () => {
    const result = validateEntryDraft({ ...emptyEntryDraft(), content: "x", keys: "", constant: true });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual({});
  });

  it("passes a valid draft", () => {
    const result = validateEntryDraft({ ...emptyEntryDraft(), content: "x", keys: "a" });
    expect(result.ok).toBe(true);
  });
});

describe("classifyWorldbookWriteError", () => {
  it("maps status codes", () => {
    expect(classifyWorldbookWriteError(new TavernApiError({ message: "c", status: 409 }))).toBe("conflict");
    expect(classifyWorldbookWriteError(new TavernApiError({ message: "b", status: 503 }))).toBe("busy");
    expect(classifyWorldbookWriteError(new TavernApiError({ message: "f", status: 403 }))).toBe("forbidden");
    expect(classifyWorldbookWriteError(new TavernApiError({ message: "s", status: 500 }))).toBe("unknown");
  });

  it("treats non-api errors as unknown", () => {
    expect(classifyWorldbookWriteError(new Error("boom"))).toBe("unknown");
    expect(classifyWorldbookWriteError("nope")).toBe("unknown");
  });
});

describe("computeMoveReorder", () => {
  const entries = [
    entryRecord({ id: "a", uid: 1, order: 100 }),
    entryRecord({ id: "b", uid: 2, order: 100 }),
    entryRecord({ id: "c", uid: 3, order: 100 }),
  ];

  it("returns empty when moving the top item up", () => {
    expect(computeMoveReorder(entries, "a", "up")).toEqual([]);
  });

  it("returns empty when moving the bottom item down", () => {
    expect(computeMoveReorder(entries, "c", "down")).toEqual([]);
  });

  it("returns empty for an unknown id", () => {
    expect(computeMoveReorder(entries, "zzz", "up")).toEqual([]);
  });

  it("normalizes tied orders to sequential indices on first move", () => {
    // a,b,c all order=100; move b up -> b,a,c -> normalized 0,1,2
    expect(computeMoveReorder(entries, "b", "up")).toEqual([
      { id: "b", order: 0 },
      { id: "a", order: 1 },
      { id: "c", order: 2 },
    ]);
  });

  it("only emits changed items when orders are already sequential", () => {
    const seq = [
      entryRecord({ id: "a", uid: 1, order: 0 }),
      entryRecord({ id: "b", uid: 2, order: 1 }),
      entryRecord({ id: "c", uid: 3, order: 2 }),
    ];
    // move a down -> b,a,c -> only a(0->1) and b(1->0) change
    expect(computeMoveReorder(seq, "a", "down")).toEqual([
      { id: "b", order: 0 },
      { id: "a", order: 1 },
    ]);
  });
});
