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
        attachTrace,
        notifyTrace,
      },
    } as never);

    expect(sequence).toEqual(["narrator", "post_response", "commit"]);
    expect(runPostResponse).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit.mock.calls[0]?.[0].assistantMessageRef).toMatchObject({
      pageId: expect.any(String),
      messageId: expect.any(String),
    });
    expect(buildTrace).toHaveBeenCalledTimes(1);
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
