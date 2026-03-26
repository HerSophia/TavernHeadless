import type { WorkspaceRegenerateResult, WorkspaceRespondResult } from "../../../lib/workspace-api";

type TurnCompletionEventBaseKey =
  | "events.messageRegenerated"
  | "events.messageRetried"
  | "events.respondDone";

type TurnCompletionResult =
  | Pick<WorkspaceRespondResult, "finalState" | "summaries">
  | Pick<WorkspaceRegenerateResult, "finalState" | "summaries">;

export function countTurnSummaries(result?: TurnCompletionResult): number {
  return result?.summaries.length ?? 0;
}

function hasPendingCommit(result?: TurnCompletionResult): boolean {
  return Boolean(result?.finalState && result.finalState !== "committed");
}

export function resolveTurnCompletionEventKey(
  baseKey: TurnCompletionEventBaseKey,
  result?: TurnCompletionResult
): string {
  const summaryCount = countTurnSummaries(result);
  const pendingCommit = hasPendingCommit(result);

  if (pendingCommit && summaryCount > 0) {
    return `${baseKey}PendingCommitWithSummaries`;
  }

  if (pendingCommit) {
    return `${baseKey}PendingCommit`;
  }

  if (summaryCount > 0) {
    return `${baseKey}WithSummaries`;
  }

  return baseKey;
}
