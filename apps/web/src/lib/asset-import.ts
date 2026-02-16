import type { WorkspaceAssetKind } from "./workspace-api";

export type AssetImportValidationReason =
  | "okCharacterImage"
  | "okJson"
  | "errorCharacterImageUnsupported"
  | "errorCharacterMetadataMissing"
  | "errorCharacterMetadataParse"
  | "errorFileRead"
  | "errorJsonObjectExpected"
  | "errorJsonParse"
  | "errorUnsupportedFormat";

export type AssetImportValidationResult = {
  fileName: string;
  ok: boolean;
  payload?: unknown;
  detail?: string;
  reason: AssetImportValidationReason;
};

export type AssetImportReadyEntry = {
  fileName: string;
  payload: unknown;
};

export async function validateAssetImportFile(
  kind: WorkspaceAssetKind,
  file: File
): Promise<AssetImportValidationResult> {
  try {
    if (kind !== "character") {
      if (!isJsonFile(file)) {
        return {
          fileName: file.name,
          ok: false,
          reason: "errorUnsupportedFormat",
          detail: `Only JSON is allowed for ${kind} imports`
        };
      }

      const payload = await parseJsonObjectFile(file);
      if (!payload) {
        return {
          fileName: file.name,
          ok: false,
          reason: "errorJsonObjectExpected",
          detail: "Top-level JSON value must be an object"
        };
      }

      return {
        fileName: file.name,
        ok: true,
        payload,
        reason: "okJson"
      };
    }

    if (isJsonFile(file)) {
      const payload = await parseJsonObjectFile(file);
      if (!payload) {
        return {
          fileName: file.name,
          ok: false,
          reason: "errorJsonObjectExpected",
          detail: "Top-level JSON value must be an object"
        };
      }

      return {
        fileName: file.name,
        ok: true,
        payload,
        reason: "okJson"
      };
    }

    if (!isPngFile(file) && !isWebpFile(file)) {
      return {
        fileName: file.name,
        ok: false,
        reason: "errorCharacterImageUnsupported",
        detail: "Character import accepts JSON, PNG, and WebP files"
      };
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const encoded = isPngFile(file) ? extractCharaFromPng(bytes) : extractCharaFromWebp(bytes);
    if (!encoded) {
      return {
        fileName: file.name,
        ok: false,
        reason: "errorCharacterMetadataMissing",
        detail: "No chara metadata payload found in this image"
      };
    }

    const payload = parseCharacterPayload(encoded);
    if (!payload) {
      return {
        fileName: file.name,
        ok: false,
        reason: "errorCharacterMetadataParse",
        detail: "Chara metadata exists but does not decode to a JSON object"
      };
    }

    return {
      fileName: file.name,
      ok: true,
      payload,
      reason: "okCharacterImage"
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      return {
        fileName: file.name,
        ok: false,
        reason: "errorJsonParse",
        detail: error.message
      };
    }

    const detail = error instanceof Error ? error.message : "Unknown read failure";
    return {
      fileName: file.name,
      ok: false,
      reason: "errorFileRead",
      detail
    };
  }
}

async function parseJsonObjectFile(file: File): Promise<Record<string, unknown> | null> {
  const content = await file.text();
  const parsed = JSON.parse(content) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  return parsed as Record<string, unknown>;
}

function parseCharacterPayload(encoded: string): Record<string, unknown> | null {
  const trimmed = encoded.trim();
  const direct = parseJsonObject(trimmed);
  if (direct) {
    return direct;
  }

  const maybeDecoded = tryDecodeURIComponent(trimmed);
  const decodedJson = parseJsonObject(maybeDecoded);
  if (decodedJson) {
    return decodedJson;
  }

  const base64Decoded = decodeBase64Utf8(maybeDecoded);
  if (!base64Decoded) {
    return null;
  }

  return parseJsonObject(base64Decoded);
}

function parseJsonObject(input: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(input) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function decodeBase64Utf8(input: string): string | null {
  const compact = input
    .replace(/\s+/g, "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  if (!compact) {
    return null;
  }

  const padded = compact.length % 4 === 0 ? compact : compact + "=".repeat(4 - (compact.length % 4));

  try {
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function extractCharaFromPng(bytes: Uint8Array): string | null {
  if (!isPngSignature(bytes)) {
    return null;
  }

  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const chunkLength = readUint32BE(bytes, offset);
    const chunkType = ascii(bytes, offset + 4, 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkLength;

    if (chunkEnd + 4 > bytes.length) {
      break;
    }

    if (chunkType === "tEXt") {
      const text = extractCharaFromPngTextChunk(bytes, chunkStart, chunkEnd);
      if (text) {
        return text;
      }
    } else if (chunkType === "iTXt") {
      const text = extractCharaFromPngInternationalTextChunk(bytes, chunkStart, chunkEnd);
      if (text) {
        return text;
      }
    }

    if (chunkType === "IEND") {
      break;
    }

    offset = chunkEnd + 4;
  }

  return extractCharaFromTextBlob(bytes);
}

function extractCharaFromPngTextChunk(bytes: Uint8Array, start: number, end: number): string | null {
  const separator = findNullByte(bytes, start, end);
  if (separator < 0) {
    return null;
  }

  const keyword = latin1(bytes, start, separator);
  if (keyword !== "chara") {
    return null;
  }

  return latin1(bytes, separator + 1, end);
}

function extractCharaFromPngInternationalTextChunk(bytes: Uint8Array, start: number, end: number): string | null {
  const keyEnd = findNullByte(bytes, start, end);
  if (keyEnd < 0) {
    return null;
  }

  const keyword = latin1(bytes, start, keyEnd);
  if (keyword !== "chara") {
    return null;
  }

  if (keyEnd + 2 >= end) {
    return null;
  }

  const compressionFlag = bytes[keyEnd + 1] ?? 0;
  let cursor = keyEnd + 3;

  const languageEnd = findNullByte(bytes, cursor, end);
  if (languageEnd < 0) {
    return null;
  }
  cursor = languageEnd + 1;

  const translatedEnd = findNullByte(bytes, cursor, end);
  if (translatedEnd < 0) {
    return null;
  }
  cursor = translatedEnd + 1;

  if (compressionFlag === 1) {
    return null;
  }

  return new TextDecoder().decode(bytes.subarray(cursor, end));
}

function extractCharaFromWebp(bytes: Uint8Array): string | null {
  if (!isWebpSignature(bytes)) {
    return null;
  }

  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkType = ascii(bytes, offset, 4);
    const chunkSize = readUint32LE(bytes, offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;

    if (chunkEnd > bytes.length) {
      break;
    }

    if (chunkType === "EXIF" || chunkType === "XMP " || chunkType === "META") {
      const encoded = extractCharaFromTextBlob(bytes.subarray(chunkStart, chunkEnd));
      if (encoded) {
        return encoded;
      }
    }

    offset = chunkEnd + (chunkSize % 2);
  }

  return extractCharaFromTextBlob(bytes);
}

function extractCharaFromTextBlob(bytes: Uint8Array): string | null {
  const source = latin1(bytes, 0, bytes.length);
  const patterns = [
    /chara\u0000([A-Za-z0-9%+/_=-]{32,})/,
    /"chara"\s*[:=]\s*"([^"]{32,})"/,
    /<chara>([^<]{32,})<\/chara>/i,
    /chara=([A-Za-z0-9%+/_=-]{32,})/
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
}

function findNullByte(bytes: Uint8Array, start: number, end: number): number {
  for (let cursor = start; cursor < end; cursor += 1) {
    if (bytes[cursor] === 0) {
      return cursor;
    }
  }
  return -1;
}

function latin1(bytes: Uint8Array, start: number, end: number): string {
  return new TextDecoder("latin1").decode(bytes.subarray(start, end));
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, false);
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

function isPngSignature(bytes: Uint8Array): boolean {
  if (bytes.length < 8) {
    return false;
  }

  return (
    bytes[0] === 137 &&
    bytes[1] === 80 &&
    bytes[2] === 78 &&
    bytes[3] === 71 &&
    bytes[4] === 13 &&
    bytes[5] === 10 &&
    bytes[6] === 26 &&
    bytes[7] === 10
  );
}

function isWebpSignature(bytes: Uint8Array): boolean {
  if (bytes.length < 12) {
    return false;
  }

  return ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP";
}

function isJsonFile(file: File): boolean {
  return file.type === "application/json" || file.name.toLowerCase().endsWith(".json");
}

function isPngFile(file: File): boolean {
  return file.type === "image/png" || file.name.toLowerCase().endsWith(".png");
}

function isWebpFile(file: File): boolean {
  return file.type === "image/webp" || file.name.toLowerCase().endsWith(".webp");
}

function tryDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
