import { beforeEach, describe, expect, it, vi } from "vitest";

const { importsMock } = vi.hoisted(() => ({
  importsMock: {
    character: vi.fn(),
    preset: vi.fn(),
    worldbook: vi.fn(),
    regex: vi.fn(),
  },
}));

vi.mock("../sdk", () => ({ apiClient: { imports: importsMock } }));

import { deriveAssetName, importAsset } from "./imports";
import type { AssetImportValidationResult } from "./types";

function result(overrides: Partial<AssetImportValidationResult>): AssetImportValidationResult {
  return { fileName: "x.json", ok: true, reason: "okJson", ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("deriveAssetName", () => {
  it("strips the extension", () => {
    expect(deriveAssetName("My Card.png")).toBe("My Card");
    expect(deriveAssetName("preset.v2.json")).toBe("preset.v2");
    expect(deriveAssetName("noext")).toBe("noext");
  });
});

describe("importAsset", () => {
  it("imports a character with createSession=false", async () => {
    importsMock.character.mockResolvedValue({ characterId: "c1", name: "Sera", source: "sillytavern" });
    const summary = await importAsset("character", result({ fileName: "Sera.png", payload: { name: "Sera" } }));
    expect(importsMock.character).toHaveBeenCalledWith(
      expect.objectContaining({ createSession: false, title: "Sera" }),
    );
    expect(summary).toEqual({ id: "c1", name: "Sera", source: "sillytavern" });
  });

  it("imports a preset", async () => {
    importsMock.preset.mockResolvedValue({ id: "p1", name: "P", source: "sillytavern" });
    const summary = await importAsset("preset", result({ fileName: "P.json", payload: { a: 1 } }));
    expect(importsMock.preset).toHaveBeenCalledWith({ data: { a: 1 }, name: "P" });
    expect(summary.id).toBe("p1");
  });

  it("imports a worldbook", async () => {
    importsMock.worldbook.mockResolvedValue({ id: "w1", name: "W", source: "sillytavern" });
    await importAsset("worldbook", result({ fileName: "W.json", payload: { entries: [] } }));
    expect(importsMock.worldbook).toHaveBeenCalledWith({ data: { entries: [] }, name: "W" });
  });

  it("imports regex using the raw string", async () => {
    importsMock.regex.mockResolvedValue({ id: "r1", name: "R", source: "sillytavern", scriptCount: 1 });
    await importAsset("regex", result({ fileName: "R.json", payload: [{ x: 1 }], raw: '[{"x":1}]' }));
    expect(importsMock.regex).toHaveBeenCalledWith({ data: '[{"x":1}]', name: "R" });
  });

  it("falls back to JSON.stringify for regex without raw", async () => {
    importsMock.regex.mockResolvedValue({ id: "r2", name: "R2", source: "x", scriptCount: 0 });
    await importAsset("regex", result({ fileName: "R2.json", payload: [{ y: 2 }] }));
    expect(importsMock.regex).toHaveBeenCalledWith({ data: JSON.stringify([{ y: 2 }]), name: "R2" });
  });
});
