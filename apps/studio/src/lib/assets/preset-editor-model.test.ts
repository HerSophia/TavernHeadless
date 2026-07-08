import { describe, expect, it } from "vitest";

import type { PresetEditorDetail, PresetEditorEntry } from "@tavern/sdk";
import {
  blankEntry,
  moveEntry,
  serializeForBaseline,
  toDraft,
  toUpdatePayload,
  validateIdentifier,
  type PresetDraft,
  type PresetEntryDraft,
} from "./preset-editor-model";

function entry(over: Partial<PresetEditorEntry> = {}): PresetEditorEntry {
  return {
    identifier: "main",
    name: "Main",
    role: "system",
    content: "hello",
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
      entries: [entry()],
      orderContexts: [],
      topLevel: {},
    },
    ...over,
  };
}

function draftEntry(over: Partial<PresetEntryDraft> = {}): PresetEntryDraft {
  return { ...blankEntry("main"), ...over };
}

describe("toDraft", () => {
  it("maps the editor document to a draft", () => {
    const draft = toDraft(detail());
    expect(draft.name).toBe("My Preset");
    expect(draft.defaultCharacterId).toBe(0);
    expect(draft.format).toBe("legacy-compact");
    expect(draft.entries).toHaveLength(1);
    expect(draft.entries[0]).toMatchObject({ identifier: "main", role: "system", content: "hello" });
  });

  it("deep-clones entries, extra, orderContexts and topLevel (mutations do not leak back)", () => {
    const source = detail({
      editor: {
        format: "st-raw",
        defaultCharacterId: 7,
        entries: [entry({ extra: { keep: 1 }, injectionTrigger: [{ a: 1 }] })],
        orderContexts: [{ characterId: 7, order: [{ identifier: "main", enabled: true }], extra: { z: 9 } }],
        topLevel: { misc: { nested: true } },
      },
    });
    const draft = toDraft(source);
    const clonedEntry = draft.entries[0];
    const clonedCtx = draft.orderContexts[0];
    if (!clonedEntry || !clonedCtx) {
      throw new Error("expected cloned entry/context");
    }
    (clonedEntry.extra as { keep: number }).keep = 999;
    (clonedEntry.injectionTrigger as Array<{ a: number }>)[0] = { a: 999 };
    (draft.topLevel.misc as { nested: boolean }).nested = false;
    (clonedCtx.extra as { z: number }).z = 0;

    const srcEntry = source.editor.entries[0];
    const srcCtx = source.editor.orderContexts[0];
    if (!srcEntry || !srcCtx) {
      throw new Error("expected source entry/context");
    }
    expect((srcEntry.extra as { keep: number }).keep).toBe(1);
    expect((srcEntry.injectionTrigger as Array<{ a: number }>)[0]).toEqual({ a: 1 });
    expect((source.editor.topLevel.misc as { nested: boolean }).nested).toBe(true);
    expect((srcCtx.extra as { z: number }).z).toBe(9);
  });
});

describe("toUpdatePayload", () => {
  it("maps camelCase fields to snake_case and passes through extra/topLevel/orderContexts", () => {
    const draft: PresetDraft = {
      name: "P",
      defaultCharacterId: 3,
      format: "legacy-compact",
      entries: [
        draftEntry({
          identifier: "e1",
          name: "E1",
          role: "user",
          content: "c",
          systemPrompt: true,
          marker: true,
          injectionPosition: 2,
          injectionDepth: 4,
          injectionOrder: 6,
          forbidOverrides: true,
          injectionTrigger: ["x"],
          enabled: false,
          extra: { foo: "bar" },
        }),
      ],
      orderContexts: [{ characterId: 3, order: [{ identifier: "e1", enabled: true }], extra: { k: 1 } }],
      topLevel: { unknown: 42 },
    };

    const payload = toUpdatePayload(draft);
    expect(payload.name).toBe("P");
    expect(payload.editor.default_character_id).toBe(3);
    expect(payload.editor.top_level).toEqual({ unknown: 42 });
    expect(payload.editor.order_contexts).toEqual([
      { character_id: 3, order: [{ identifier: "e1", enabled: true }], extra: { k: 1 } },
    ]);
    expect(payload.editor.entries[0]).toEqual({
      identifier: "e1",
      name: "E1",
      role: "user",
      content: "c",
      system_prompt: true,
      marker: true,
      injection_position: 2,
      enabled: false,
      extra: { foo: "bar" },
      injection_depth: 4,
      injection_order: 6,
      forbid_overrides: true,
      injection_trigger: ["x"],
    });
  });

  it("omits optional fields when they are undefined", () => {
    const payload = toUpdatePayload({
      name: "P",
      defaultCharacterId: 0,
      format: "legacy-compact",
      entries: [draftEntry({ identifier: "e1" })],
      orderContexts: [],
      topLevel: {},
    });
    const record = payload.editor.entries[0];
    expect(record).not.toHaveProperty("injection_depth");
    expect(record).not.toHaveProperty("injection_order");
    expect(record).not.toHaveProperty("forbid_overrides");
    expect(record).not.toHaveProperty("injection_trigger");
  });
});

describe("blankEntry", () => {
  it("returns sane defaults for a new entry", () => {
    expect(blankEntry("greeting")).toEqual({
      identifier: "greeting",
      name: "greeting",
      role: "system",
      content: "",
      systemPrompt: false,
      marker: false,
      injectionPosition: 0,
      enabled: true,
      extra: {},
    });
  });
});

describe("validateIdentifier", () => {
  it("rejects empty / whitespace-only identifiers", () => {
    expect(validateIdentifier("", [])).toBe("empty");
    expect(validateIdentifier("   ", [])).toBe("empty");
  });

  it("rejects identifiers with illegal characters", () => {
    expect(validateIdentifier("has space", [])).toBe("pattern");
    expect(validateIdentifier("emoji😀", [])).toBe("pattern");
  });

  it("rejects identifiers longer than 64 characters", () => {
    expect(validateIdentifier("a".repeat(65), [])).toBe("tooLong");
  });

  it("rejects duplicate identifiers", () => {
    expect(validateIdentifier("main", ["main", "other"])).toBe("duplicate");
  });

  it("accepts a valid unique identifier", () => {
    expect(validateIdentifier("main-1_2", ["other"])).toBeNull();
  });
});

describe("moveEntry", () => {
  const entries = [draftEntry({ identifier: "a" }), draftEntry({ identifier: "b" }), draftEntry({ identifier: "c" })];

  it("moves an entry down", () => {
    const next = moveEntry(entries, 0, 1);
    expect(next.map((e) => e.identifier)).toEqual(["b", "a", "c"]);
    expect(next).not.toBe(entries);
  });

  it("moves an entry up", () => {
    const next = moveEntry(entries, 2, -1);
    expect(next.map((e) => e.identifier)).toEqual(["a", "c", "b"]);
  });

  it("returns the original reference when the move is out of bounds", () => {
    expect(moveEntry(entries, 0, -1)).toBe(entries);
    expect(moveEntry(entries, 2, 1)).toBe(entries);
    expect(moveEntry(entries, -1, 1)).toBe(entries);
  });
});

describe("serializeForBaseline", () => {
  it("equals the JSON of the update payload and is stable", () => {
    const draft = toDraft(detail());
    expect(serializeForBaseline(draft)).toBe(JSON.stringify(toUpdatePayload(draft)));
    expect(serializeForBaseline(draft)).toBe(serializeForBaseline(toDraft(detail())));
  });
});
