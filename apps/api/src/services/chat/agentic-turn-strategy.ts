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

export class AgenticTurnStrategy implements ChatTurnExecutionStrategy {
  constructor(
    private readonly narratorTurnExecutionService: NarratorTurnExecutionService,
    private readonly turnCommitCoordinator: TurnCommitCoordinator,
    private readonly agenticTurnCoordinator: AgenticTurnCoordinator,
  ) {}

  async execute(args: ExecuteTurnAndCommitArgs): Promise<ExecuteTurnAndCommitResult> {
    const assistantMessageRef = createReservedAssistantMessageRef();
    const narrator = await this.narratorTurnExecutionService.execute(args);
    const postResponse = await this.runPostResponseBestEffort(args, narrator.execution, assistantMessageRef);
    const agentRuntimeTrace = this.buildAgentRuntimeTrace(args, postResponse);

    const commit = await this.turnCommitCoordinator.commit({
      ...args,
      execution: narrator.execution,
      turnInput: narrator.turnInput,
      toolExecutionRunId: narrator.toolExecutionRunId,
      assistantMessageRef,
    });

    if (agentRuntimeTrace) {
      args.inlineMvp?.attachTrace?.(agentRuntimeTrace);
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
  ): Promise<{ records: AgentRunRecord[]; envelope: PostResponseEnvelope }> {
    try {
      const post = await this.agenticTurnCoordinator.runPostResponse({
        source: {
          kind: "respond_post_response",
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

      return {
        records: post.records,
        envelope: post.envelope,
      };
    } catch {
      return {
        records: [],
        envelope: buildPostResponseEnvelope([]),
      };
    }
  }

  private buildAgentRuntimeTrace(
    args: ExecuteTurnAndCommitArgs,
    postResponse: { records: AgentRunRecord[]; envelope: PostResponseEnvelope },
  ): AgentRuntimeTrace | undefined {
    if (!args.inlineMvp?.attachTrace && !args.inlineMvp?.notifyTrace) {
      return undefined;
    }

    return this.agenticTurnCoordinator.buildTrace({
      preRecords: args.inlineMvp?.preResponse?.records ?? [],
      aggregated: args.inlineMvp?.preResponse?.aggregated,
      postRecords: postResponse.records,
      postEnvelope: postResponse.envelope,
    });
  }
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
