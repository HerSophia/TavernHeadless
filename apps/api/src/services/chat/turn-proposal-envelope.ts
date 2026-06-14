import type {
  AgentFinding,
  AgentMemoryProposal,
  AgentRunRecord,
  AgentStateProposal,
  PostResponseEnvelope,
} from "../agent-runtime/inline-agent-types.js";
import type { TurnAttemptIdentity } from "./turn-attempt-types.js";

export interface TurnStateProposal {
  id: string;
  sourceAgentId: string;
  targetNamespace?: string;
  targetSlot?: string;
  payload: unknown;
  promotion: "observe_only" | "stage_for_commit" | "promote_on_commit";
}

export interface TurnMemoryProposal {
  id: string;
  sourceAgentId: string;
  kind: string;
  summary: string;
  payload?: unknown;
  promotion: "observe_only" | "stage_for_review" | "promote_on_commit";
}

export interface TurnRelationshipProposal {
  id: string;
  summary: string;
  payload?: unknown;
  promotion: "observe_only" | "stage_for_review";
}

export interface TurnOpenLoopProposal {
  id: string;
  summary: string;
  payload?: unknown;
  promotion: "observe_only" | "stage_for_review";
}

export interface TurnProposalEnvelope {
  attempt: TurnAttemptIdentity;
  outputPageId: string;
  findings: {
    continuity: AgentFinding[];
    agency: AgentFinding[];
    style: AgentFinding[];
  };
  stateProposals: TurnStateProposal[];
  memoryProposals: TurnMemoryProposal[];
  relationshipProposals: TurnRelationshipProposal[];
  openLoopProposals: TurnOpenLoopProposal[];
}

/**
 * 从 R1 post_response envelope 构造 R2 proposal envelope。
 */
export function buildTurnProposalEnvelope(input: {
  attempt: TurnAttemptIdentity;
  postEnvelope: PostResponseEnvelope;
  postRecords?: AgentRunRecord[];
}): TurnProposalEnvelope {
  const stateProposals = buildStateProposals(input.postEnvelope, input.postRecords);
  const memoryProposals = buildMemoryProposals(input.postEnvelope, input.postRecords);

  return {
    attempt: input.attempt,
    outputPageId: input.attempt.candidateOutputPageId,
    findings: {
      continuity: [...input.postEnvelope.findings.continuity],
      agency: [...input.postEnvelope.findings.agency],
      style: [...input.postEnvelope.findings.style],
    },
    stateProposals,
    memoryProposals,
    relationshipProposals: [],
    openLoopProposals: [],
  };
}

function buildStateProposals(
  envelope: PostResponseEnvelope,
  records: AgentRunRecord[] | undefined,
): TurnStateProposal[] {
  const fromRecords = (records ?? []).flatMap((record) =>
    (record.output?.stateProposals ?? []).map((proposal, index) =>
      toStateProposal(proposal, record.agentId, `${record.agentId}:state:${index}`),
    ),
  );

  if (fromRecords.length > 0) {
    return fromRecords;
  }

  return envelope.stateProposals.map((proposal, index) =>
    toStateProposal(proposal, "post_response_envelope", `post_response_envelope:state:${index}`),
  );
}

function buildMemoryProposals(
  envelope: PostResponseEnvelope,
  records: AgentRunRecord[] | undefined,
): TurnMemoryProposal[] {
  const fromRecords = (records ?? []).flatMap((record) =>
    (record.output?.memoryProposals ?? []).map((proposal, index) =>
      toMemoryProposal(proposal, record.agentId, `${record.agentId}:memory:${index}`),
    ),
  );

  if (fromRecords.length > 0) {
    return fromRecords;
  }

  return envelope.memoryProposals.map((proposal, index) =>
    toMemoryProposal(proposal, "post_response_envelope", `post_response_envelope:memory:${index}`),
  );
}

function toStateProposal(proposal: AgentStateProposal, sourceAgentId: string, id: string): TurnStateProposal {
  return {
    id,
    sourceAgentId,
    ...(proposal.namespace ? { targetNamespace: proposal.namespace } : {}),
    ...(proposal.slot ? { targetSlot: proposal.slot } : {}),
    payload: proposal.payload ?? { summary: proposal.summary },
    promotion: "observe_only",
  };
}

function toMemoryProposal(proposal: AgentMemoryProposal, sourceAgentId: string, id: string): TurnMemoryProposal {
  return {
    id,
    sourceAgentId,
    kind: proposal.kind,
    summary: proposal.summary,
    ...(proposal.payload !== undefined ? { payload: proposal.payload } : {}),
    promotion: "stage_for_review",
  };
}
