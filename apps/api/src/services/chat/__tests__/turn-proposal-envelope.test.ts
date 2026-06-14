import { describe, expect, it } from "vitest";

import { buildTurnProposalEnvelope } from "../turn-proposal-envelope.js";
import type { TurnAttemptIdentity } from "../turn-attempt-types.js";
import type { AgentRunRecord, PostResponseEnvelope } from "../../agent-runtime/inline-agent-types.js";

const attempt: TurnAttemptIdentity = {
  sessionId: "session-1",
  branchId: "main",
  floorId: "floor-1",
  runId: "run-1",
  runType: "respond",
  attemptNo: 1,
  replayMode: "full_floor_context",
  candidateOutputPageId: "page-output",
  candidateAssistantMessageId: "msg-output",
};

const emptyEnvelope: PostResponseEnvelope = {
  findings: { continuity: [], agency: [], style: [] },
  stateProposals: [],
  memoryProposals: [],
  commitAdvice: "allow",
};

describe("buildTurnProposalEnvelope", () => {
  it("把 post_response proposal 绑定到 attempt 的 candidate output page", () => {
    const records: AgentRunRecord[] = [
      {
        agentId: "inline:state_proposal",
        roleKind: "state_proposal",
        phase: "post_response",
        status: "ok",
        durationMs: 1,
        stabilityHint: "page",
        output: {
          stateProposals: [{ namespace: "scene", slot: "mood", summary: "气氛变化", payload: { mood: "quiet" } }],
        },
      },
      {
        agentId: "inline:memory_proposal",
        roleKind: "memory_proposal",
        phase: "post_response",
        status: "ok",
        durationMs: 1,
        stabilityHint: "page",
        output: {
          memoryProposals: [{ kind: "fact", summary: "记住事实", payload: { fact: "x" } }],
        },
      },
    ];

    const envelope = buildTurnProposalEnvelope({ attempt, postEnvelope: emptyEnvelope, postRecords: records });

    expect(envelope.outputPageId).toBe("page-output");
    expect(envelope.stateProposals).toHaveLength(1);
    expect(envelope.stateProposals[0]).toMatchObject({
      sourceAgentId: "inline:state_proposal",
      targetNamespace: "scene",
      targetSlot: "mood",
      promotion: "observe_only",
    });
    expect(envelope.memoryProposals[0]).toMatchObject({
      sourceAgentId: "inline:memory_proposal",
      promotion: "stage_for_review",
    });
  });

  it("没有 records 时从 postEnvelope 保留 proposal", () => {
    const envelope = buildTurnProposalEnvelope({
      attempt,
      postEnvelope: {
        ...emptyEnvelope,
        stateProposals: [{ summary: "状态建议", payload: { ok: true } }],
      },
    });

    expect(envelope.stateProposals[0]).toMatchObject({
      sourceAgentId: "post_response_envelope",
      promotion: "observe_only",
    });
  });
});
