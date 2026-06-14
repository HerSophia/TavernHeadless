import { nanoid } from "nanoid";

import { buildPostResponseEnvelope } from "../agent-runtime/agent-runtime-trace.js";
import type {
  AgentRunRecord,
  AgentRuntimeTrace,
  PostResponseEnvelope,
} from "../agent-runtime/inline-agent-types.js";
import type { PersistedMessageRef } from "../chat-message-persistence.js";
import { AgenticTurnCoordinator } from "./agentic-turn-coordinator.js";
import type { ChatTurnExecutionStrategy } from "./naive-turn-strategy.js";
import { NarratorTurnExecutionService } from "./narrator-turn-execution-service.js";
import type { ExecuteTurnAndCommitArgs, ExecuteTurnAndCommitResult } from "./turn-execution-facade.js";
import { TurnCommitCoordinator } from "./turn-commit-coordinator.js";
import {
  buildCommitGateDecision,
  type CommitGateDecision,
  type CommitGatePolicy,
} from "./turn-commit-gate.js";
import { modeFromRunType } from "./turn-attempt-coordinator.js";
import { buildTurnProposalEnvelope, type TurnProposalEnvelope } from "./turn-proposal-envelope.js";
import type { TurnAttemptIdentity } from "./turn-attempt-types.js";

export class AgenticTurnStrategy implements ChatTurnExecutionStrategy {
  constructor(
    private readonly narratorTurnExecutionService: NarratorTurnExecutionService,
    private readonly turnCommitCoordinator: TurnCommitCoordinator,
    private readonly agenticTurnCoordinator: AgenticTurnCoordinator,
    private readonly commitGatePolicy: CommitGatePolicy = "warn_only",
  ) {}

  async execute(args: ExecuteTurnAndCommitArgs): Promise<ExecuteTurnAndCommitResult> {
    const attempt = resolveAttempt(args);
    const assistantMessageRef = attempt
      ? {
          pageId: attempt.candidateOutputPageId,
          messageId: attempt.candidateAssistantMessageId,
        }
      : createReservedAssistantMessageRef();
    const narrator = await this.narratorTurnExecutionService.execute(args);
    const postResponse = await this.runPostResponseBestEffort(args, narrator.execution, assistantMessageRef, attempt);
    const agentRuntimeTrace = this.buildAgentRuntimeTrace(args, postResponse, assistantMessageRef, attempt);

    if (agentRuntimeTrace) {
      args.inlineMvp?.attachTrace?.(agentRuntimeTrace);
    }

    const commit = await this.turnCommitCoordinator.commit({
      ...args,
      execution: narrator.execution,
      turnInput: narrator.turnInput,
      toolExecutionRunId: narrator.toolExecutionRunId,
      assistantMessageRef,
      attempt,
      ...(postResponse.proposalEnvelope ? { proposalEnvelope: postResponse.proposalEnvelope } : {}),
      commitGateDecision: postResponse.gateDecision,
    });

    if (agentRuntimeTrace && commit.proposalPromotion) {
      agentRuntimeTrace.postResponse.promotion = {
        status: commit.proposalPromotion.status,
        ...(commit.proposalPromotion.reason ? { reason: commit.proposalPromotion.reason } : {}),
        ...(commit.proposalPromotion.decisionCode ? { decisionCode: commit.proposalPromotion.decisionCode } : {}),
        pageWriteAcceptedCount: commit.proposalPromotion.pageWriteAcceptedCount,
        pageWriteDiscardedCount: commit.proposalPromotion.pageWriteDiscardedCount,
        stateObservedCount: commit.proposalPromotion.stateObservedCount,
        stateDiscardedCount: commit.proposalPromotion.stateDiscardedCount,
        sessionStateStagedCount: commit.proposalPromotion.sessionStateStagedCount,
        memoryBatchCount: commit.proposalPromotion.memoryBatchCount,
        memoryProposedCount: commit.proposalPromotion.memoryProposedCount,
        memoryRejectedCount: commit.proposalPromotion.memoryRejectedCount,
        memorySupersededCount: commit.proposalPromotion.memorySupersededCount,
      };
    }

    if (agentRuntimeTrace) {
      args.inlineMvp?.notifyTrace?.(agentRuntimeTrace);
    }

    return {
      execution: narrator.execution,
      commit,
      ...(agentRuntimeTrace ? { agentRuntimeTrace } : {}),
    };
  }

  private async runPostResponseBestEffort(
    args: ExecuteTurnAndCommitArgs,
    execution: ExecuteTurnAndCommitResult["execution"],
    assistantMessageRef: PersistedMessageRef,
    attempt: TurnAttemptIdentity | undefined,
  ): Promise<{
    records: AgentRunRecord[];
    envelope: PostResponseEnvelope;
    gateDecision: CommitGateDecision;
    proposalEnvelope?: TurnProposalEnvelope;
  }> {
    try {
      const post = await this.agenticTurnCoordinator.runPostResponse({
        source: {
          kind: "turn_post_response",
          mode: modeFromRunType(args.runType),
          runType: args.runType,
          attemptNo: attempt?.attemptNo ?? 1,
          sessionId: args.sessionId,
          floorId: args.floorId,
          pageId: assistantMessageRef.pageId,
        },
        context: {
          sessionId: args.sessionId,
          ...(args.branchId ? { branchId: args.branchId } : {}),
          floorId: args.floorId,
          pageId: assistantMessageRef.pageId,
          accountId: args.accountId,
          ...(args.inlineMvp?.firstPartyStateContext
            ? { firstPartyStateContext: args.inlineMvp.firstPartyStateContext }
            : {}),
          narratorText: composeAssistantOutputText(execution),
          ...(args.inlineMvp?.abortSignal ? { abortSignal: args.inlineMvp.abortSignal } : {}),
        },
      });

      const gateDecision = buildCommitGateDecision({
        findings: post.envelope.findings,
        policy: this.commitGatePolicy,
      });

      return {
        records: post.records,
        envelope: post.envelope,
        gateDecision,
        ...(attempt
          ? {
              proposalEnvelope: buildTurnProposalEnvelope({
                attempt,
                postEnvelope: post.envelope,
                postRecords: post.records,
              }),
            }
          : {}),
      };
    } catch {
      const envelope = buildPostResponseEnvelope([]);
      return {
        records: [],
        envelope,
        gateDecision: buildCommitGateDecision({
          findings: envelope.findings,
          policy: this.commitGatePolicy,
        }),
      };
    }
  }

  private buildAgentRuntimeTrace(
    args: ExecuteTurnAndCommitArgs,
    postResponse: {
      records: AgentRunRecord[];
      envelope: PostResponseEnvelope;
      gateDecision: CommitGateDecision;
    },
    assistantMessageRef: PersistedMessageRef,
    attempt: TurnAttemptIdentity | undefined,
  ): AgentRuntimeTrace | undefined {
    if (!args.inlineMvp?.attachTrace && !args.inlineMvp?.notifyTrace) {
      return undefined;
    }

    const source = {
      kind: "turn_post_response" as const,
      mode: modeFromRunType(args.runType),
      runType: args.runType,
      attemptNo: attempt?.attemptNo ?? 1,
      sessionId: args.sessionId,
      floorId: args.floorId,
      pageId: assistantMessageRef.pageId,
    };

    return this.agenticTurnCoordinator.buildTrace({
      preRecords: args.inlineMvp?.preResponse?.records ?? [],
      aggregated: args.inlineMvp?.preResponse?.aggregated,
      postRecords: postResponse.records,
      postEnvelope: postResponse.envelope,
      source: source.pageId ? source : undefined,
      outputPageId: source.pageId,
      gateDecision: postResponse.gateDecision,
    });
  }
}

function resolveAttempt(args: ExecuteTurnAndCommitArgs): TurnAttemptIdentity | undefined {
  return args.attempt ?? args.inlineMvp?.attempt;
}

function composeAssistantOutputText(
  execution: Pick<ExecuteTurnAndCommitResult["execution"], "generatedText" | "toolResultWritebackText">,
): string {
  const parts = [execution.generatedText, execution.toolResultWritebackText]
    .map((value) => value?.trim())
    .filter((value): value is string => typeof value === "string" && value.length > 0);

  return parts.join("\n\n");
}

function createReservedAssistantMessageRef(): PersistedMessageRef {
  return {
    pageId: nanoid(),
    messageId: nanoid(),
  };
}
