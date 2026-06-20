import {
  RUNTIME_GOVERNANCE_OPERATION_DOMAINS,
  type RuntimeGovernanceOperationDomain,
} from "./runtime-governance-types.js";

/** Frequently used operation-log actions introduced or reserved by Batch 8 governance. */
export const GOVERNANCE_OPERATION_ACTIONS = {
  toolTransport: {
    selection: buildOperationLogAction("tool_transport", "selection"),
    fallback: buildOperationLogAction("tool_transport", "fallback"),
    parseFailed: buildOperationLogAction("tool_transport", "parse_failed"),
    toolRejected: buildOperationLogAction("tool_transport", "tool_rejected"),
    toolResultWriteback: buildOperationLogAction("tool_transport", "tool_result_writeback"),
  },
  promptInjection: {
    create: buildOperationLogAction("prompt_injection", "create"),
    update: buildOperationLogAction("prompt_injection", "update"),
    delete: buildOperationLogAction("prompt_injection", "delete"),
    cleanupExpired: buildOperationLogAction("prompt_injection", "cleanup_expired"),
  },
  temporaryConversation: {
    cleanup: buildOperationLogAction("temporary_conversation", "cleanup"),
    cleanupExpired: buildOperationLogAction("temporary_conversation", "cleanup_expired"),
    inspectTranscript: buildOperationLogAction("temporary_conversation", "transcript_inspect"),
  },
  agentRuntime: {
    run: buildOperationLogAction("agent_runtime", "run"),
    failed: buildOperationLogAction("agent_runtime", "failed"),
  },
  nodeGraph: {
    create: buildOperationLogAction("node_graph", "create"),
    versionCreate: buildOperationLogResourceAction("node_graph", "version", "create"),
    proposalSubmit: buildOperationLogResourceAction("node_graph", "proposal", "submit"),
    archive: buildOperationLogAction("node_graph", "archive"),
    unarchive: buildOperationLogAction("node_graph", "unarchive"),
    versionSetCurrent: buildOperationLogResourceAction("node_graph", "version", "set_current"),
    // NG2-PKG：package import / export 审计。只写摘要与 hash，不写完整图正文。
    export: buildOperationLogAction("node_graph", "export"),
    import: buildOperationLogAction("node_graph", "import"),
  },
  nodeGraphRun: {
    run: buildOperationLogAction("node_graph_run", "run"),
    failed: buildOperationLogAction("node_graph_run", "failed"),
    outputDispatched: buildOperationLogAction("node_graph_run", "output_dispatched"),
    outputRejected: buildOperationLogAction("node_graph_run", "output_rejected"),
    cleanup: buildOperationLogAction("node_graph_run", "cleanup"),
    checkpointCleanup: buildOperationLogAction("node_graph_run", "checkpoint_cleanup"),
    inspect: buildOperationLogAction("node_graph_run", "inspect"),
  },
} as const;

/** Builds a `<domain>.<action>` operation-log action. */
export function buildOperationLogAction(
  domain: RuntimeGovernanceOperationDomain,
  action: string,
): `${RuntimeGovernanceOperationDomain}.${string}` {
  assertGovernanceDomain(domain);
  return `${domain}.${normalizeActionSegment(action, "action")}`;
}

/** Builds a strict `<domain>.<resource>.<verb>` operation-log action. */
export function buildOperationLogResourceAction(
  domain: RuntimeGovernanceOperationDomain,
  resource: string,
  verb: string,
): `${RuntimeGovernanceOperationDomain}.${string}.${string}` {
  assertGovernanceDomain(domain);
  return `${domain}.${normalizeActionSegment(resource, "resource")}.${normalizeActionSegment(verb, "verb")}`;
}

/** Returns whether an action starts with one of the Batch 8 governance domains. */
export function isGovernanceOperationAction(action: string): boolean {
  const trimmed = action.trim();
  return RUNTIME_GOVERNANCE_OPERATION_DOMAINS.some((domain) => trimmed.startsWith(`${domain}.`));
}

function assertGovernanceDomain(domain: RuntimeGovernanceOperationDomain): void {
  if (!RUNTIME_GOVERNANCE_OPERATION_DOMAINS.includes(domain)) {
    throw new Error(`Unknown governance operation domain: ${domain}`);
  }
}

function normalizeActionSegment(value: string, fieldName: string): string {
  const normalized = value.trim().replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  if (normalized.length === 0) {
    throw new Error(`operation log ${fieldName} must be a non-empty string`);
  }
  return normalized;
}
