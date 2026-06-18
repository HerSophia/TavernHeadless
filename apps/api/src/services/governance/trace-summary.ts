import { createHash } from "node:crypto";

import type { PromptRuntimeToolTransportTrace } from "@tavern/core";

import {
  RUNTIME_GOVERNANCE_CONTRACT_VERSION,
  SENSITIVE_PAYLOAD_REDACTION_MARKER,
  type RuntimeGovernanceRef,
  type RuntimeGovernanceSideEffectsSummary,
  type RuntimeGovernanceStatus,
  type RuntimeGovernanceTraceSummary,
} from "./runtime-governance-types.js";

export type NodeGraphRunGovernanceTraceInput = {
  trace: unknown;
  graphRunId: string;
  graphId: string;
  graphVersionId: string;
  accountId?: string | null;
  workspaceId?: string | null;
  projectId?: string | null;
  sessionId?: string | null;
  floorId?: string | null;
  pageId?: string | null;
  jobId?: string | null;
  jobType?: string | null;
  rootRunId?: string | null;
  parentRunId?: string | null;
  status: string;
  intent?: string | null;
  dryRun?: boolean;
  preview?: boolean;
  startedAt?: number | null;
  finishedAt?: number | null;
};

export type GovernancePayloadSummary = {
  redacted: true;
  marker: typeof SENSITIVE_PAYLOAD_REDACTION_MARKER;
  kind: "undefined" | "null" | "string" | "number" | "boolean" | "array" | "object";
  byte_length: number;
  sha256: string;
  item_count?: number;
  key_count?: number;
};

export type ToolTransportGovernanceTraceInput = {
  trace: PromptRuntimeToolTransportTrace;
  runId?: string | null;
  rootRunId?: string | null;
  parentRunId?: string | null;
  accountId?: string | null;
  workspaceId?: string | null;
  projectId?: string | null;
  sessionId?: string | null;
  branchId?: string | null;
  floorId?: string | null;
  requestId?: string | null;
  route?: string | null;
  startedAt?: number | null;
  finishedAt?: number | null;
  dryRun?: boolean;
  preview?: boolean;
};

/** Normalizes domain-specific failures into stable snake_case reason codes. */
export function normalizeReasonCode(value: unknown, fallback = "unknown"): string {
  const source = typeof value === "string" && value.trim().length > 0 ? value : fallback;
  const normalized = source
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return normalized.length > 0 ? normalized : "unknown";
}

/** Creates a hash-only payload summary for operation logs and trace side-effect metadata. */
export function summarizePayloadForOperationLog(value: unknown): GovernancePayloadSummary {
  const stable = stableStringify(value);
  const summary: GovernancePayloadSummary = {
    redacted: true,
    marker: SENSITIVE_PAYLOAD_REDACTION_MARKER,
    kind: payloadKind(value),
    byte_length: Buffer.byteLength(stable, "utf8"),
    sha256: `sha256:${createHash("sha256").update(stable).digest("hex")}`,
  };
  if (Array.isArray(value)) {
    summary.item_count = value.length;
  } else if (isRecord(value)) {
    summary.key_count = Object.keys(value).length;
  }
  return summary;
}

/** Builds the stable governance summary for a ToolCall Transport trace. */
export function buildToolTransportGovernanceTraceSummary(
  input: ToolTransportGovernanceTraceInput,
): RuntimeGovernanceTraceSummary {
  const parsing = input.trace.parsing;
  const diagnostics = parsing?.diagnostics ?? [];
  const toolList = input.trace.toolList;
  const toolResult = input.trace.toolResult;
  const startedAt = input.startedAt ?? null;
  const finishedAt = input.finishedAt ?? null;
  return {
    contract_version: RUNTIME_GOVERNANCE_CONTRACT_VERSION,
    runtime_kind: "tool_transport",
    run_id: input.runId ?? null,
    root_run_id: input.rootRunId ?? input.runId ?? null,
    parent_run_id: input.parentRunId ?? null,
    source_kind: input.route ? "http" : "chat_turn",
    source_ref: compactRef({
      request_id: input.requestId ?? null,
      route: input.route ?? null,
    }),
    target_kind: "tool_transport",
    target_ref: compactRef({
      account_id: input.accountId ?? null,
      workspace_id: input.workspaceId ?? null,
      project_id: input.projectId ?? null,
      session_id: input.sessionId ?? null,
      branch_id: input.branchId ?? null,
      floor_id: input.floorId ?? null,
      transport: input.trace.selection.transport,
    }),
    status: diagnostics.length > 0 ? "failed" : "succeeded",
    reason_code: deriveToolTransportReasonCode(input.trace),
    diagnostics: {
      selection_reason_code: input.trace.selection.reasonCode,
      block_count: parsing?.blockCount ?? 0,
      accepted_count: parsing?.acceptedCount ?? 0,
      rejected_count: parsing?.rejectedCount ?? 0,
      diagnostics_by_reason: summarizeToolTransportDiagnosticsByReason(input.trace),
      tool_list_injected: toolList?.injected ?? false,
      tool_count: toolList?.toolCount ?? 0,
      tool_result_written_back: toolResult?.writtenBack ?? false,
      tool_result_block_count: toolResult?.blockCount ?? 0,
    },
    started_at: startedAt,
    finished_at: finishedAt,
    duration_ms: startedAt !== null && finishedAt !== null ? Math.max(0, finishedAt - startedAt) : null,
    dry_run: input.dryRun ?? false,
    preview: input.preview ?? false,
    side_effects: {
      tool_execution: {
        count: parsing?.acceptedCount ?? 0,
      },
      tool_list_prompt: {
        written: toolList?.injected ?? false,
        count: toolList?.toolCount ?? 0,
      },
      tool_result_prompt: {
        written: toolResult?.writtenBack ?? false,
        count: toolResult?.blockCount ?? 0,
      },
      operation_log: {
        written: false,
      },
    },
  };
}

export function summarizeToolTransportDiagnosticsByReason(
  trace: PromptRuntimeToolTransportTrace,
): Record<string, number> {
  const explicit = trace.parsing?.diagnosticsByReason;
  if (explicit && Object.keys(explicit).length > 0) {
    return { ...explicit };
  }

  const byReason: Record<string, number> = {};
  for (const diagnostic of trace.parsing?.diagnostics ?? []) {
    byReason[diagnostic.reason] = (byReason[diagnostic.reason] ?? 0) + 1;
  }
  return byReason;
}

function deriveToolTransportReasonCode(trace: PromptRuntimeToolTransportTrace): string {
  const diagnostics = trace.parsing?.diagnostics ?? [];
  if (diagnostics.length > 0) {
    return normalizeReasonCode(diagnostics[0]?.reason, "parse_failed");
  }
  return normalizeReasonCode(trace.selection.reasonCode, "succeeded");
}

/** Builds the stable governance summary for a NodeGraph run trace. */
export function buildNodeGraphRunGovernanceTraceSummary(
  input: NodeGraphRunGovernanceTraceInput,
): RuntimeGovernanceTraceSummary {
  const trace = asRecord(input.trace);
  const intent = input.intent ?? readString(trace.intent);
  const status = normalizeStatus(input.status);
  const startedAt = input.startedAt ?? null;
  const finishedAt = input.finishedAt ?? null;
  return {
    contract_version: RUNTIME_GOVERNANCE_CONTRACT_VERSION,
    runtime_kind: "node_graph_run",
    run_id: input.graphRunId,
    root_run_id: input.rootRunId ?? input.graphRunId,
    parent_run_id: input.parentRunId ?? null,
    source_kind: input.jobId ? "runtime_job" : "system",
    source_ref: compactRef({
      job_id: input.jobId ?? null,
      job_type: input.jobType ?? null,
    }),
    target_kind: "node_graph",
    target_ref: compactRef({
      account_id: input.accountId ?? null,
      workspace_id: input.workspaceId ?? null,
      project_id: input.projectId ?? null,
      session_id: input.sessionId ?? null,
      floor_id: input.floorId ?? null,
      page_id: input.pageId ?? null,
      graph_id: input.graphId,
      graph_version_id: input.graphVersionId,
    }),
    status,
    reason_code: deriveNodeGraphReasonCode(trace, status),
    diagnostics: summarizeNodeGraphDiagnostics(trace),
    started_at: startedAt,
    finished_at: finishedAt,
    duration_ms: startedAt !== null && finishedAt !== null ? Math.max(0, finishedAt - startedAt) : null,
    dry_run: input.dryRun ?? intent === "dry_run",
    preview: input.preview ?? intent === "preview",
    side_effects: summarizeNodeGraphSideEffects(trace),
  };
}

/** Attaches NodeGraph governance summary fields while preserving the original trace JSON blob. */
export function attachNodeGraphRunGovernanceTraceSummary(
  input: NodeGraphRunGovernanceTraceInput,
): Record<string, unknown> {
  return {
    ...asRecord(input.trace),
    ...buildNodeGraphRunGovernanceTraceSummary(input),
  };
}

function deriveNodeGraphReasonCode(trace: Record<string, unknown>, status: RuntimeGovernanceStatus): string {
  if (status === "succeeded") {
    return "succeeded";
  }
  const failedNodeCode = firstDiagnosticCodeFromFailedNodes(trace.failedNodes);
  if (failedNodeCode) {
    return normalizeReasonCode(failedNodeCode, "node_graph_node_execution_failed");
  }
  const compileCode = firstDiagnosticCode(trace.compileDiagnostics);
  if (compileCode) {
    return normalizeReasonCode(compileCode, "node_graph_not_executable");
  }
  const error = readString(trace.error);
  if (error) {
    return normalizeReasonCode(error, "failed");
  }
  return "failed";
}

function summarizeNodeGraphDiagnostics(trace: Record<string, unknown>): Record<string, unknown> {
  const failedNodes = arrayOfRecords(trace.failedNodes);
  const compileDiagnostics = arrayOfRecords(trace.compileDiagnostics);
  return {
    failed_node_id: readString(trace.failedNodeId),
    failed_node_count: failedNodes.length,
    compile_diagnostic_count: compileDiagnostics.length,
    first_reason_code: firstDiagnosticCodeFromFailedNodes(failedNodes) ?? firstDiagnosticCode(compileDiagnostics) ?? readString(trace.error),
    status_counts: isRecord(trace.statusCounts) ? trace.statusCounts : null,
  };
}

function summarizeNodeGraphSideEffects(trace: Record<string, unknown>): RuntimeGovernanceSideEffectsSummary {
  const outputRefs = arrayOfRecords(trace.outputDispatchRefs);
  const outputResults = arrayOfRecords(trace.outputDispatchResults);
  const nestedJobRefs = arrayOfRecords(trace.nestedJobRefs);
  const outputTargetCounts: Record<string, number> = {};
  let planned = 0;
  let pending = 0;
  let dispatched = 0;
  let rejected = 0;
  for (const ref of outputRefs) {
    const target = readString(ref.target) ?? "unknown";
    outputTargetCounts[target] = (outputTargetCounts[target] ?? 0) + 1;
    switch (readString(ref.status)) {
      case "planned":
        planned += 1;
        break;
      case "pending":
        pending += 1;
        break;
      case "dispatched":
        dispatched += 1;
        break;
      case "rejected":
        rejected += 1;
        break;
      default:
        pending += 1;
        break;
    }
  }

  const nestedRefs = nestedJobRefs.map((ref) => compactRef({
    node_id: readString(ref.nodeId),
    job_id: readString(ref.jobId),
    medium: readString(ref.medium),
  })).filter((ref) => Object.keys(ref).length > 0);

  return {
    output_dispatch: {
      count: outputRefs.length,
      planned,
      pending,
      dispatched,
      rejected,
      result_count: outputResults.length,
      targets: Object.keys(outputTargetCounts).sort(),
      target_counts: outputTargetCounts,
    },
    nested_job: {
      count: nestedJobRefs.length,
      created: nestedJobRefs.filter((ref) => ref.created === true).length,
      dry_run: nestedJobRefs.filter((ref) => ref.dryRun === true).length,
      refs: nestedRefs,
    },
    operation_log: {
      written: false,
    },
  };
}

function firstDiagnosticCodeFromFailedNodes(value: unknown): string | null {
  for (const failedNode of arrayOfRecords(value)) {
    const code = firstDiagnosticCode(failedNode.diagnostics);
    if (code) {
      return code;
    }
  }
  return null;
}

function firstDiagnosticCode(value: unknown): string | null {
  for (const diagnostic of arrayOfRecords(value)) {
    const code = readString(diagnostic.code);
    if (code) {
      return code;
    }
  }
  return null;
}

function normalizeStatus(value: string): RuntimeGovernanceStatus {
  switch (value) {
    case "running":
    case "succeeded":
    case "failed":
    case "cancelled":
    case "denied":
    case "skipped":
    case "reused":
      return value;
    default:
      return "unknown";
  }
}

function compactRef(input: Record<string, string | number | boolean | null | undefined>): RuntimeGovernanceRef {
  const ref: RuntimeGovernanceRef = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== null) {
      ref[key] = value;
    }
  }
  return ref;
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function arrayOfRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function payloadKind(value: unknown): GovernancePayloadSummary["kind"] {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "object";
}

function stableStringify(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
