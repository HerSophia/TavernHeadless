import type {
  WorkspaceAssetImportEntry,
  WorkspaceAssetKind
} from "./types";

export function resolveImportAssetName(kind: WorkspaceAssetKind, entry: WorkspaceAssetImportEntry): string {
  const fallback = entry.fileName.replace(/\.[^/.]+$/, "").trim() || "Imported Asset";
  const payload = entry.payload;

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return fallback;
  }

  const record = payload as Record<string, unknown>;
  const directName = toNonEmptyString(record.name);
  if (directName) {
    return directName;
  }

  const data = record.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const nestedDataName = toNonEmptyString((data as Record<string, unknown>).name);
    if (nestedDataName) {
      return nestedDataName;
    }
  }

  if (kind === "user") {
    const snapshot = record.snapshot;
    if (snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)) {
      const nestedName = toNonEmptyString((snapshot as Record<string, unknown>).name);
      if (nestedName) {
        return nestedName;
      }
    }
  }

  return fallback;
}

export function normalizeImportName(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function toNonEmptyString(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}
