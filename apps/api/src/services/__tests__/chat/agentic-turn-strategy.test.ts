import { describe, expect, it, vi } from "vitest";

import { AgenticTurnStrategy } from "../../chat/agentic-turn-strategy.js";
import { NarratorTurnExecutionService } from "../../chat/narrator-turn-execution-service.js";
import { TurnCommitCoordinator } from "../../chat/turn-commit-coordinator.js";

describe("AgenticTurnStrategy", () => {
  it("executes narrator, post_response and commit in order, and attaches trace", async () => {
    const sequence: string[] = [];
    const attachTrace = vi.fn();
    const notifyTrace = vi.fn();
    const narratorExecute = vi.fn(async (args) => {
      sequence.push("narrator");
      return {
        execution: {
          generatedText: "Narrator output.",
          toolResultWritebackText: "",
        },
        turnInput: args.turnInput,
        toolExecutionRunId: "run-1",
      } as never;
    });
    const runPostResponse = vi.fn(async () => {
      sequence.push("post_response");
      return {
        records: [],
        envelope: {
          findings: {
            continuity: [],
            agency: [],
            style: [],
          },
          stateProposals: [],
          memoryProposals: [],
          commitAdvice: "allow",
        },
      };
    });
    const buildTrace = vi.fn(() => ({
      strategy: "inline_mvp",
      scopeKind: "floor",
      preResponse: {
        runs: [],
      },
      response: {
        narratorCallerSlot: "narrator",
      },
      postResponse: {
        runs: [],
        findingCounts: {
          continuity: 0,
          agency: 0,
          style: 0,
        },
        proposalCounts: {
          state: 0,
          memory: 0,
        },
        commitAdvice: "allow",
      },
    }));
    const commit = vi.fn(async (args) => {
      sequence.push("commit");
      return {
        floorId: "floor-1",
        outputPageId: args.assistantMessageRef.pageId,
        assistantMessageId: args.assistantMessageRef.messageId,
        usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
        finalState: "committed" as const,
        proposalPromotion: {
          status: "staged" as const,
          pageWriteAcceptedCount: 1,
          pageWriteDiscardedCount: 0,
          stateObservedCount: 1,
          stateDiscardedCount: 0,
          sessionStateStagedCount: 0,
          memoryBatchCount: 1,
          memoryProposedCount: 1,
          memoryRejectedCount: 0,
          memorySupersededCount: 0,
        },
      };
    });

    const strategy = new AgenticTurnStrategy(
      new NarratorTurnExecutionService(narratorExecute),
      new TurnCommitCoordinator(commit),
      {
        runPostResponse,
        buildTrace,
      } as never,
    );

    const result = await strategy.execute({
      floorId: "floor-1",
      sessionId: "session-1",
      branchId: "main",
      accountId: "default-admin",
      turnInput: { floorId: "floor-1" },
      resolvedTurnModels: {},
      orchestrationFailureCode: "orchestration_failed",
      orchestrationFailureMessage: "Turn orchestration failed",
      persistMemory: false,
      runType: "respond",
      memoryConsolidationRequested: false,
      commitFailureMessage: "Turn commit failed",
      inlineMvp: {
        preResponse: {
          aggregated: {
            contributors: [],
            narratorConstraints: [],
            conflicts: [],
          },
          records: [],
        },
        attempt: {
          sessionId: "session-1",
          branchId: "main",
          floorId: "floor-1",
          runId: "run-attempt-1",
          runType: "respond",
          attemptNo: 1,
          replayMode: "full_floor_context",
          candidateOutputPageId: "candidate-page-1",
          candidateAssistantMessageId: "candidate-message-1",
        },
        attachTrace,
        notifyTrace,
      },
    } as never);

    expect(sequence).toEqual(["narrator", "post_response", "commit"]);
    expect(runPostResponse).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit.mock.calls[0]?.[0].assistantMessageRef).toMatchObject({
      pageId: "candidate-page-1",
      messageId: "candidate-message-1",
    });
    expect(commit.mock.calls[0]?.[0].proposalEnvelope).toMatchObject({
      outputPageId: "candidate-page-1",
      attempt: expect.objectContaining({
        candidateOutputPageId: "candidate-page-1",
        candidateAssistantMessageId: "candidate-message-1",
      }),
    });
    expect(commit.mock.calls[0]?.[0].commitGateDecision).toMatchObject({
      status: "allow",
      policy: "warn_only",
    });
    expect(buildTrace).toHaveBeenCalledTimes(1);
    expect(result.agentRuntimeTrace?.postResponse.promotion).toEqual({
      status: "staged",
      pageWriteAcceptedCount: 1,
      pageWriteDiscardedCount: 0,
      stateObservedCount: 1,
      stateDiscardedCount: 0,
      sessionStateStagedCount: 0,
      memoryBatchCount: 1,
      memoryProposedCount: 1,
      memoryRejectedCount: 0,
      memorySupersededCount: 0,
    });
    expect(attachTrace).toHaveBeenCalledWith(result.agentRuntimeTrace);
    expect(notifyTrace).toHaveBeenCalledWith(result.agentRuntimeTrace);
    expect(result.commit.outputPageId).toBe(commit.mock.calls[0]?.[0].assistantMessageRef.pageId);
  });

  it("keeps commit running when post_response fails", async () => {
    const narratorExecute = vi.fn(async (args) => ({
      execution: {
        generatedText: "Narrator output.",
        toolResultWritebackText: "",
      },
      turnInput: args.turnInput,
      toolExecutionRunId: "run-2",
    } as never));
    const commit = vi.fn(async (args) => ({
      floorId: "floor-2",
      outputPageId: args.assistantMessageRef.pageId,
      assistantMessageId: args.assistantMessageRef.messageId,
      usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
      finalState: "committed" as const,
    }));

    const strategy = new AgenticTurnStrategy(
      new NarratorTurnExecutionService(narratorExecute),
      new TurnCommitCoordinator(commit),
      {
        runPostResponse: vi.fn(async () => {
          throw new Error("post failed");
        }),
        buildTrace: vi.fn(),
      } as never,
    );

    const result = await strategy.execute({
      floorId: "floor-2",
      sessionId: "session-2",
      branchId: "main",
      accountId: "default-admin",
      turnInput: { floorId: "floor-2" },
      resolvedTurnModels: {},
      orchestrationFailureCode: "orchestration_failed",
      orchestrationFailureMessage: "Turn orchestration failed",
      persistMemory: false,
      runType: "respond",
      memoryConsolidationRequested: false,
      commitFailureMessage: "Turn commit failed",
      turnStrategy: "inline_mvp",
    } as never);

    expect(commit).toHaveBeenCalledTimes(1);
    expect(result.commit.finalState).toBe("committed");
  });
});
