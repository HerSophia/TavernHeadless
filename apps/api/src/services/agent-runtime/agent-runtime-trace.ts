/**
 * Agent Runtime 的 trace 与 post_response 信封构造 helper。
 *
 * R2 继续不新增 agent_run 表。trace 仍只在内存中构造，并在 debug / runtime trace 打开时返回。
 */
import type {
  AggregatedPreResponseContext,
  AgentInvocationSource,
  AgentRunRecord,
  AgentRunTraceItem,
  AgentRuntimeTrace,
  AgentRuntimeTraceInvocation,
  PostResponseEnvelope,
} from "./inline-agent-types.js";

function toTraceItem(record: AgentRunRecord): AgentRunTraceItem {
  return {
    agentId: record.agentId,
    roleKind: record.roleKind,
    phase: record.phase,
    status: record.status,
    durationMs: record.durationMs,
    stabilityHint: record.stabilityHint,
    ...(record.outputSummary ? { outputSummary: record.outputSummary } : {}),
    ...(record.errorCode ? { errorCode: record.errorCode } : {}),
  };
}

export function buildPostResponseEnvelope(records: AgentRunRecord[]): PostResponseEnvelope {
  const envelope: PostResponseEnvelope = {
    findings: {
      continuity: [],
      agency: [],
      style: [],
    },
    stateProposals: [],
    memoryProposals: [],
    commitAdvice: "allow",
  };

  for (const record of records) {
    if (record.phase !== "post_response" || !record.output) {
      continue;
    }

    const output = record.output;
    if (output.findings?.length) {
      if (record.roleKind === "continuity_verifier") {
        envelope.findings.continuity.push(...output.findings);
      } else if (record.roleKind === "agency_guard") {
        envelope.findings.agency.push(...output.findings);
      } else if (record.roleKind === "style_verifier") {
        envelope.findings.style.push(...output.findings);
      }
    }
    if (output.stateProposals?.length) {
      envelope.stateProposals.push(...output.stateProposals);
    }
    if (output.memoryProposals?.length) {
      envelope.memoryProposals.push(...output.memoryProposals);
    }
  }

  const hasWarnOrError = [
    ...envelope.findings.continuity,
    ...envelope.findings.agency,
    ...envelope.findings.style,
  ].some((finding) => finding.severity === "warn" || finding.severity === "error");

  envelope.commitAdvice = hasWarnOrError ? "warn" : "allow";
  return envelope;
}

export function buildAgentRuntimeTrace(args: {
  preRecords: AgentRunRecord[];
  aggregated?: AggregatedPreResponseContext;
  postRecords: AgentRunRecord[];
  postEnvelope: PostResponseEnvelope;
  source?: AgentInvocationSource;
  outputPageId?: string;
  gateDecision?: {
    status: "allow" | "warn" | "block";
    policy: "warn_only" | "block_on_error";
    reasons: Array<{
      code: string;
      severity: "info" | "warn" | "error";
      summary: string;
      sourceAgentId?: string;
    }>;
  };
  strategy?: AgentRuntimeTrace["strategy"];
}): AgentRuntimeTrace {
  return {
    strategy: args.strategy ?? "inline_mvp",
    scopeKind: "floor",
    ...(args.source ? { invocation: toInvocationTrace(args.source) } : {}),
    preResponse: {
      runs: args.preRecords.map(toTraceItem),
      ...(args.aggregated
        ? {
            aggregator: {
              contributorIds: args.aggregated.contributors.map((contributor) => contributor.id),
              conflictCount: args.aggregated.conflicts.length,
              conflicts: args.aggregated.conflicts.map((conflict) => ({
                code: conflict.code,
                summary: conflict.summary,
              })),
            },
          }
        : {}),
    },
    response: {
      narratorCallerSlot: "narrator",
      ...(args.outputPageId ? { outputPageId: args.outputPageId } : {}),
    },
    postResponse: {
      runs: args.postRecords.map(toTraceItem),
      findingCounts: {
        continuity: args.postEnvelope.findings.continuity.length,
        agency: args.postEnvelope.findings.agency.length,
        style: args.postEnvelope.findings.style.length,
      },
      proposalCounts: {
        state: args.postEnvelope.stateProposals.length,
        memory: args.postEnvelope.memoryProposals.length,
      },
      commitAdvice: args.postEnvelope.commitAdvice,
      ...(args.gateDecision
        ? {
            gate: {
              status: args.gateDecision.status,
              policy: args.gateDecision.policy,
              reasonCount: args.gateDecision.reasons.length,
            },
          }
        : {}),
    },
  };
}

function toInvocationTrace(source: AgentInvocationSource): AgentRuntimeTraceInvocation {
  if (source.kind === "turn_pre_response" || source.kind === "turn_post_response") {
    return {
      kind: source.kind,
      mode: source.mode,
      runType: source.runType,
      attemptNo: source.attemptNo,
      ...(source.pageId ? { pageId: source.pageId } : {}),
    };
  }

  return {
    kind: source.kind,
    ...(source.pageId ? { pageId: source.pageId } : {}),
  };
}
