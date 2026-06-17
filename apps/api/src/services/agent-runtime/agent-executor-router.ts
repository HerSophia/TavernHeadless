import type {
  AgentRuntimeMediumTrace,
  InlineAgentExecutionResult,
} from "./inline-agent-types.js";
import type { AgentMediumSelection } from "./agent-medium-types.js";
import type {
  TemporaryConversationAgentExecutionResult,
  TemporaryConversationAgentExecutor,
  TemporaryConversationAgentRequest,
} from "./temporary-conversation-agent-executor.js";

export interface BackgroundJobRejectedResult {
  status: "rejected";
  medium: "background_job";
  code: "background_job_not_activated_until_r4";
  message: string;
  mediumTrace: AgentRuntimeMediumTrace;
}

export type AgentExecutorRouteResult =
  | {
      kind: "single_call";
      result: InlineAgentExecutionResult;
    }
  | {
      kind: "temporary_conversation";
      result: TemporaryConversationAgentExecutionResult;
    }
  | {
      kind: "background_job";
      result: BackgroundJobRejectedResult;
    };

export interface SingleCallExecutorAdapter {
  execute(): Promise<InlineAgentExecutionResult>;
}

export class AgentExecutorRouter {
  constructor(private readonly temporaryConversationExecutor: TemporaryConversationAgentExecutor) {}

  async routeSingleCall(
    executor: SingleCallExecutorAdapter,
  ): Promise<AgentExecutorRouteResult> {
    return {
      kind: "single_call",
      result: await executor.execute(),
    };
  }

  async routeTemporaryConversation(
    request: TemporaryConversationAgentRequest,
  ): Promise<AgentExecutorRouteResult> {
    return {
      kind: "temporary_conversation",
      result: await this.temporaryConversationExecutor.execute(request),
    };
  }

  async routeByMedium(
    medium: AgentMediumSelection,
    options: {
      singleCallExecutor?: SingleCallExecutorAdapter;
      temporaryConversationRequest?: TemporaryConversationAgentRequest;
    },
  ): Promise<AgentExecutorRouteResult> {
    switch (medium.kind) {
      case "single_call": {
        if (!options.singleCallExecutor) {
          throw new Error("singleCallExecutor is required for single_call medium.");
        }
        return this.routeSingleCall(options.singleCallExecutor);
      }

      case "temporary_conversation": {
        if (!options.temporaryConversationRequest) {
          throw new Error("temporaryConversationRequest is required for temporary_conversation medium.");
        }
        return this.routeTemporaryConversation(options.temporaryConversationRequest);
      }

      case "background_job": {
        return {
          kind: "background_job",
          result: {
            status: "rejected",
            medium: "background_job",
            code: "background_job_not_activated_until_r4",
            message: "background_job medium is reserved for R4 runtime activation.",
            mediumTrace: {
              kind: "background_job",
              deliveryTarget: medium.deliveryTarget,
              status: "rejected",
              rejectionCode: "background_job_not_activated_until_r4",
            },
          },
        };
      }
    }
  }
}
