import { describe, expect, it } from "vitest";

import { validateAssetImportFile } from "./asset-import";

describe("validateAssetImportFile", () => {
  it("accepts JSON object files for non-character imports", async () => {
    const file = new File([JSON.stringify({ name: "Preset A", temperature: 0.8 })], "preset.json", {
      type: "application/json"
    });

    const result = await validateAssetImportFile("preset", file);

    expect(result.ok).toBe(true);
    expect(result.reason).toBe("okJson");
    expect(result.payload).toEqual({ name: "Preset A", temperature: 0.8 });
  });

  it("rejects non-JSON files for non-character imports", async () => {
    const file = new File(["hello"], "preset.txt", { type: "text/plain" });

    const result = await validateAssetImportFile("preset", file);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("errorUnsupportedFormat");
    expect(result.detail).toContain("Only JSON");
  });

  it("rejects character JSON when top-level value is not an object", async () => {
    const file = new File([JSON.stringify(["invalid"])], "character.json", { type: "application/json" });

    const result = await validateAssetImportFile("character", file);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("errorJsonObjectExpected");
  });

  it("extracts character payload from PNG chara metadata", async () => {
    const payload = { name: "Seraphina", version: "v4" };
    const encoded = encodeURIComponent(JSON.stringify(payload));
    const pngBytes = createPngWithTextChunk("chara", encoded);
    const file = fileFromBytes(pngBytes, "character-card.png", "image/png");

    const result = await validateAssetImportFile("character", file);

    expect(result.ok).toBe(true);
    expect(result.reason).toBe("okCharacterImage");
    expect(result.payload).toEqual(payload);
  });

  it("extracts character payload from WebP metadata chunk", async () => {
    const payload = { name: "Rowan", tags: ["mystery", "noir"] };
    const base64 = btoa(JSON.stringify(payload));
    const webpBytes = createWebpWithMetadataChunk("EXIF", `chara\u0000${base64}`);
    const file = fileFromBytes(webpBytes, "character-card.webp", "image/webp");

    const result = await validateAssetImportFile("character", file);

    expect(result.ok).toBe(true);
    expect(result.reason).toBe("okCharacterImage");
    expect(result.payload).toEqual(payload);
  });

  it("reports missing metadata for character PNG files without chara payload", async () => {
    const pngBytes = createPngWithTextChunk("title", "no metadata");
    const file = fileFromBytes(pngBytes, "character-card.png", "image/png");

    const result = await validateAssetImportFile("character", file);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("errorCharacterMetadataMissing");
  });

  it("reports parse errors for invalid JSON content", async () => {
    const file = new File(["{"], "broken.json", { type: "application/json" });

    const result = await validateAssetImportFile("character", file);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("errorJsonParse");
    expect(result.detail).toBeTruthy();
  });
});

function createPngWithTextChunk(keyword: string, value: string): Uint8Array {
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const textData = concatBytes([encodeAscii(keyword), new Uint8Array([0]), encodeLatin1(value)]);
  const textChunk = createPngChunk("tEXt", textData);
  const iendChunk = createPngChunk("IEND", new Uint8Array(0));
  return concatBytes([signature, textChunk, iendChunk]);
}

function createPngChunk(type: string, data: Uint8Array): Uint8Array {
  return concatBytes([
    uint32BE(data.length),
    encodeAscii(type),
    data,
    new Uint8Array(4)
  ]);
}

function createWebpWithMetadataChunk(chunkType: "EXIF" | "META" | "XMP ", payload: string): Uint8Array {
  const payloadBytes = encodeLatin1(payload);
  const padding = payloadBytes.length % 2 === 1 ? new Uint8Array([0]) : new Uint8Array(0);
  const chunk = concatBytes([
    encodeAscii(chunkType),
    uint32LE(payloadBytes.length),
    payloadBytes,
    padding
  ]);

  const riffSize = 4 + chunk.length;
  return concatBytes([
    encodeAscii("RIFF"),
    uint32LE(riffSize),
    encodeAscii("WEBP"),
    chunk
  ]);
}

function encodeAscii(value: string): Uint8Array {
  return Uint8Array.from(value, (char) => char.charCodeAt(0));
}

function encodeLatin1(value: string): Uint8Array {
  return Uint8Array.from(value, (char) => char.charCodeAt(0) & 0xff);
}

function uint32BE(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

function uint32LE(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;

  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }

  return merged;
}

function fileFromBytes(bytes: Uint8Array, name: string, type: string): File {
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new File([arrayBuffer], name, { type });
}
