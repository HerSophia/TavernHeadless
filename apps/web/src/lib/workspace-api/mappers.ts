import type { SessionRecord } from "@tavern/sdk";

import type {
  WorkspaceAssetKind,
  WorkspaceSession
} from "./types";

export function toWorkspaceSession(session: SessionRecord, accountId?: string): WorkspaceSession {
  return {
    account: accountId ?? "studio-alpha",
    archived: session.status === "archived",
    characterName: session.characterBinding?.snapshotSummary?.name ?? "Unbound Character",
    id: session.id,
    title: session.title ?? "Untitled Session",
    userName: session.userBinding?.snapshotSummary?.name ?? "Unbound User",
    deepBinding: session.deepBinding ?? false,
    presetId: session.presetId ?? null,
    presetVersionId: session.presetVersionId ?? null,
    regexProfileId: session.regexProfileId ?? null,
    regexProfileVersionId: session.regexProfileVersionId ?? null,
    worldbookCount: session.worldbookProfileId ? 1 : 0,
    worldbookProfileId: session.worldbookProfileId ?? null,
    worldbookVersionId: session.worldbookVersionId ?? null
  };
}

export function asRecordPayload(payload: unknown, kind: WorkspaceAssetKind): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`${kind} import payload must be a JSON object`);
  }
  return payload as Record<string, unknown>;
}

export function normalizeUserSnapshot(payload: unknown, fallbackName: string): Record<string, unknown> {
  const source = asRecordPayload(payload, "user");
  const nested = source.snapshot;

  let snapshot: Record<string, unknown>;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    snapshot = { ...(nested as Record<string, unknown>) };
  } else {
    snapshot = { ...source };
  }

  if (typeof snapshot.name !== "string" || !snapshot.name.trim()) {
    snapshot.name = fallbackName;
  }

  return snapshot;
}

export function deriveAssetName(fileName: string): string {
  const trimmed = fileName.trim();
  if (!trimmed) {
    return "Imported Asset";
  }

  return trimmed.replace(/\.[^/.]+$/, "");
}
