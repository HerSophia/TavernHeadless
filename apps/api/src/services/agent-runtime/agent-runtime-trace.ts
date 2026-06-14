/**
 * Agent Runtime R1 的 trace 与 post_response 信封构造 helper。
 *
 * R1 不新增 agent_run 表，trace 只在内存中构造，并在 debug / runtime trace 打开时返回。
 */
import type {
  AggregatedPreResponseContext,
  AgentRunRecord,
  AgentRunTraceItem,
  AgentRuntimeTrace,
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

/**
 * 从 post_response 执行记录构造输出信封。
 *
 * R1 规则：commitAdvice 只允许 allow / warn，不引入 reject。
 * 任何 finding 都不会自动触发 regenerate；proposal 只进 buffer。
 */
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

/**
 * 构造 R1 最小 Agent Runtime trace。
 */
export function buildAgentRuntimeTrace(args: {
  preRecords: AgentRunRecord[];
  aggregated?: AggregatedPreResponseContext;
  postRecords: AgentRunRecord[];
  postEnvelope: PostResponseEnvelope;
}): AgentRuntimeTrace {
  return {
    strategy: "inline_mvp",
    scopeKind: "floor",
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
    },
  };
}
