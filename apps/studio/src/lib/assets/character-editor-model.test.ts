import { TavernApiError } from "@tavern/sdk";
import { describe, expect, it } from "vitest";

import {
  buildSnapshot,
  classifyCharacterWriteError,
  extractPassthrough,
  parseLines,
  parseTags,
  serializeForBaseline,
  snapshotToDraft,
  validateDraft,
  type CharacterDraft,
} from "./character-editor-model";

function snapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "Aria",
    nickname: "Ari",
    description: "A brave knight.",
    personality: "bold",
    scenario: "a castle",
    exampleDialogue: "<START>",
    primaryGreeting: "Hello there.",
    alternateGreetings: ["Hi!", "Hey."],
    systemPrompt: "sys",
    postHistoryInstructions: "phi",
    creatorNotes: "notes",
    tags: ["fantasy", "knight"],
    creator: "me",
    characterVersion: "1.0",
    // passthrough（未暴露字段）
    extensions: { world: "eldoria" },
    characterBook: { entries: [] },
    groupOnlyGreetings: ["group hi"],
    creationDate: 1_700_000_000,
    importedFormat: "v3",
    ...overrides,
  };
}

describe("snapshotToDraft", () => {
  it("extracts known fields and joins arrays to text", () => {
    const draft = snapshotToDraft(snapshot());
    expect(draft.name).toBe("Aria");
    expect(draft.nickname).toBe("Ari");
    expect(draft.primaryGreeting).toBe("Hello there.");
    expect(draft.alternateGreetings).toBe("Hi!\nHey.");
    expect(draft.tags).toBe("fantasy, knight");
    expect(draft.creator).toBe("me");
    expect(draft.characterVersion).toBe("1.0");
  });

  it("falls back to legacy greeting when primaryGreeting absent", () => {
    const draft = snapshotToDraft(snapshot({ primaryGreeting: undefined, greeting: "Legacy hi" }));
    expect(draft.primaryGreeting).toBe("Legacy hi");
  });

  it("coerces missing / non-string fields to empty text", () => {
    const draft = snapshotToDraft({ name: "X" });
    expect(draft.description).toBe("");
    expect(draft.alternateGreetings).toBe("");
    expect(draft.tags).toBe("");
  });
});

describe("extractPassthrough", () => {
  it("drops all known keys (including greeting) and keeps unknown fields", () => {
    const passthrough = extractPassthrough(snapshot({ greeting: "legacy" }));
    expect(passthrough.name).toBeUndefined();
    expect(passthrough.primaryGreeting).toBeUndefined();
    expect(passthrough.greeting).toBeUndefined();
    expect(passthrough.tags).toBeUndefined();
    expect(passthrough.extensions).toEqual({ world: "eldoria" });
    expect(passthrough.characterBook).toEqual({ entries: [] });
    expect(passthrough.groupOnlyGreetings).toEqual(["group hi"]);
    expect(passthrough.importedFormat).toBe("v3");
  });

  it("does not mutate the source snapshot", () => {
    const source = snapshot();
    extractPassthrough(source);
    expect(source.name).toBe("Aria");
    expect(source.extensions).toEqual({ world: "eldoria" });
  });
});

describe("buildSnapshot", () => {
  it("round-trips known fields and preserves passthrough", () => {
    const source = snapshot();
    const draft = snapshotToDraft(source);
    const passthrough = extractPassthrough(source);
    const built = buildSnapshot(draft, passthrough);

    expect(built.name).toBe("Aria");
    expect(built.primaryGreeting).toBe("Hello there.");
    expect(built.alternateGreetings).toEqual(["Hi!", "Hey."]);
    expect(built.tags).toEqual(["fantasy", "knight"]);
    // passthrough 原样保留
    expect(built.extensions).toEqual({ world: "eldoria" });
    expect(built.characterBook).toEqual({ entries: [] });
    expect(built.groupOnlyGreetings).toEqual(["group hi"]);
    // 始终不写 legacy greeting
    expect(built.greeting).toBeUndefined();
  });

  it("trims name and omits empty optional fields", () => {
    const draft: CharacterDraft = {
      ...snapshotToDraft(snapshot()),
      name: "  Aria  ",
      nickname: "   ",
      description: "",
      alternateGreetings: "",
      tags: "",
    };
    const built = buildSnapshot(draft, {});
    expect(built.name).toBe("Aria");
    expect(built.nickname).toBeUndefined();
    expect(built.description).toBeUndefined();
    expect(built.alternateGreetings).toBeUndefined();
    expect(built.tags).toBeUndefined();
  });

  it("drops legacy greeting even if present only in passthrough", () => {
    const built = buildSnapshot(snapshotToDraft({ name: "X" }), { greeting: "legacy" });
    expect(built.greeting).toBeUndefined();
  });

  it("does not mutate the passthrough argument", () => {
    const passthrough = { extensions: { a: 1 } };
    buildSnapshot(snapshotToDraft({ name: "X" }), passthrough);
    expect(passthrough).toEqual({ extensions: { a: 1 } });
  });
});

describe("parseLines / parseTags", () => {
  it("parseLines trims, drops empty and dedupes preserving order", () => {
    expect(parseLines("a\n b \n\na\n c")).toEqual(["a", "b", "c"]);
  });

  it("parseTags splits by comma, trims, drops empty and dedupes", () => {
    expect(parseTags("x, y ,,x, z")).toEqual(["x", "y", "z"]);
  });
});

describe("validateDraft", () => {
  it("flags empty name", () => {
    const result = validateDraft(snapshotToDraft({ name: "   " }));
    expect(result.ok).toBe(false);
    expect(result.errors.name).toBe("nameRequired");
  });

  it("passes with a non-empty name", () => {
    expect(validateDraft(snapshotToDraft({ name: "Aria" })).ok).toBe(true);
  });
});

describe("serializeForBaseline", () => {
  it("changes when an edited field changes", () => {
    const source = snapshot();
    const draft = snapshotToDraft(source);
    const passthrough = extractPassthrough(source);
    const baseline = serializeForBaseline(draft, passthrough);
    const next = serializeForBaseline({ ...draft, description: "changed" }, passthrough);
    expect(next).not.toBe(baseline);
  });

  it("is stable for semantically equal drafts (trailing whitespace)", () => {
    const source = snapshot();
    const draft = snapshotToDraft(source);
    const passthrough = extractPassthrough(source);
    const baseline = serializeForBaseline(draft, passthrough);
    const same = serializeForBaseline({ ...draft, personality: "bold   " }, passthrough);
    expect(same).toBe(baseline);
  });
});

describe("classifyCharacterWriteError", () => {
  it("maps status codes", () => {
    expect(classifyCharacterWriteError(new TavernApiError({ message: "c", status: 409 }))).toBe("conflict");
    expect(classifyCharacterWriteError(new TavernApiError({ message: "b", status: 503 }))).toBe("busy");
    expect(classifyCharacterWriteError(new TavernApiError({ message: "f", status: 403 }))).toBe("forbidden");
    expect(classifyCharacterWriteError(new TavernApiError({ message: "s", status: 500 }))).toBe("unknown");
  });

  it("treats non-API errors as unknown", () => {
    expect(classifyCharacterWriteError(new Error("boom"))).toBe("unknown");
    expect(classifyCharacterWriteError("nope")).toBe("unknown");
  });
});
