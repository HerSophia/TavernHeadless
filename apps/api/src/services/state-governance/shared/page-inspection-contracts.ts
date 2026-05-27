import type { VariableWriteSourceMetadata } from "@tavern/core";

export const PAGE_INSPECTION_SOURCE_KINDS = [
  "unknown",
  "macro",
  "tool",
  "agent",
  "memory_runtime",
] as const;

export type PageInspectionSourceKind = (typeof PAGE_INSPECTION_SOURCE_KINDS)[number];

export const PAGE_INSPECTION_DECISION_CODES = [
  "source_page_missing",
  "source_page_not_output",
  "source_page_not_active",
  "source_page_superseded",
  "source_page_scope_mismatch",
  "rerouted_to_session_state",
  "policy_forbidden",
  "promotion_allowed",
] as const;

export type PageInspectionDecisionCode = (typeof PAGE_INSPECTION_DECISION_CODES)[number];

export const MEMORY_RUNTIME_SOURCE_KIND = "memory_runtime" as const;

function normalizeNonEmptyString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function deriveVariableSourceKind(args: {
  source?: VariableWriteSourceMetadata | null;
  runId?: string | null;
}): PageInspectionSourceKind {
  if (normalizeNonEmptyString(args.runId)?.startsWith("st-macro:")) {
    return "macro";
  }

  const source = args.source;
  if (!source) {
    return "unknown";
  }

  if (normalizeNonEmptyString(source.agentId) || normalizeNonEmptyString(source.stepId)) {
    return "agent";
  }

  if (
    normalizeNonEmptyString(source.toolName)
    || normalizeNonEmptyString(source.providerId)
    || normalizeNonEmptyString(source.nodeId)
  ) {
    return "tool";
  }

  return "unknown";
}

export function resolveVariableDecisionCode(args: {
  status: string;
  decisionReason?: string | null;
}): PageInspectionDecisionCode | null {
  const decisionReason = normalizeNonEmptyString(args.decisionReason);
  switch (decisionReason) {
    case "page_commit_gate_source_page_missing":
    case "source_page_missing":
      return "source_page_missing";
    case "page_commit_gate_source_page_not_output":
    case "source_page_not_output":
      return "source_page_not_output";
    case "page_commit_gate_floor_mismatch":
    case "source_page_scope_mismatch":
      return "source_page_scope_mismatch";
    case "page_not_active_at_commit":
    case "source_page_not_active":
      return "source_page_not_active";
    case "page_superseded_at_commit":
    case "source_page_superseded":
      return "source_page_superseded";
    case "identified_as_session_state_candidate":
    case "write_rerouted_to_session_state":
    case "rerouted_to_session_state":
      return "rerouted_to_session_state";
    case "promotion_skipped_if_absent":
    case "delete_op_not_materialized_in_phase_one":
    case "policy_forbidden":
      return "policy_forbidden";
    case "promotion_allowed":
      return "promotion_allowed";
    default:
      break;
  }

  switch (args.status) {
    case "promoted":
    case "accepted_page_only":
      return "promotion_allowed";
    case "rerouted_to_session_state":
      return "rerouted_to_session_state";
    case "rejected":
    case "discarded":
      return "policy_forbidden";
    default:
      return null;
  }
}
