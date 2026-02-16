import type {
  SessionResponse,
  UsagePayload,
  WorkspaceAssetKind,
  WorkspaceMessageRole,
  WorkspaceSession
} from "./types";

export function toWorkspaceSession(session: SessionResponse, accountId?: string): WorkspaceSession {
  return {
    account: accountId ?? "studio-alpha",
    archived: session.status === "archived",
    characterName: session.character_binding?.snapshot_summary?.name ?? "Unbound Character",
    id: session.id,
    title: session.title ?? "Untitled Session",
    userName: session.user_binding?.snapshot_summary?.name ?? "Unbound User",
    worldbookCount: session.worldbook_profile_id ? 1 : 0,
    worldbookProfileId: session.worldbook_profile_id ?? null
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

export function isWorkspaceMessageRole(role: string): role is WorkspaceMessageRole {
  return role === "assistant" || role === "narrator" || role === "system" || role === "user";
}

export function normalizeContentFormat(format: string): "json" | "markdown" | "text" {
  return format === "markdown" || format === "json" ? format : "text";
}

export function resolveInputTokens(usage: UsagePayload): number {
  if (!usage) {
    return 0;
  }

  return usage.input_tokens ?? usage.prompt_tokens ?? 0;
}

export function resolveOutputTokens(usage: UsagePayload): number {
  if (!usage) {
    return 0;
  }

  return usage.output_tokens ?? usage.completion_tokens ?? 0;
}

export function resolveTotalTokens(usage: UsagePayload): number {
  return usage?.total_tokens ?? resolveInputTokens(usage) + resolveOutputTokens(usage);
}
