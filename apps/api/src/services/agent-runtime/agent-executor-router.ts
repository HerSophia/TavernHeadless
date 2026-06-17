import type {
  AgentRuntimeMediumTrace,
  InlineAgentExecutionResult,
} from "./inline-agent-types.js";
import type { AgentMediumSelection } from "./agent-medium-types.js";
import { buildAgentRuntimeMediumTrace } from "./agent-runtime-trace.js";
import type {
  TemporaryConversationAgentExecutionResult,
  TemporaryConversationAgentExecutor,
  TemporaryConversationAgentRequest,
} from "./temporary-conversation-agent-executor.js";

/**
 * 后台 Agent 入队请求。
 *
 * router 不直接持有数据库或调度器，由调用方注入一个 BackgroundJobEnqueuer，
 * 把真实入队委托给 AgentJobTriggerService 或等价入口。
 */
export interface BackgroundJobRouteRequest {
  accountId: string;
  workspaceId: string;
  projectId: string;
  agentBindingId: string;
  triggerReason?: string | null;
  actorClientId?: string | null;
  dryRun?: boolean;
  inputJson?: Record<string, unknown>;
}

export interface BackgroundJobEnqueueResult {
  jobId: string;
  created: boolean;
  dryRun: boolean;
}

/**
 * 后台入队委托面。
 *
 * 真实实现由 AgentJobTriggerService.enqueueManual 适配，
 * router 只负责把 background_job 介质路由到它，并构造 mediumTrace。
 */
export interface BackgroundJobEnqueuer {
  enqueue(request: BackgroundJobRouteRequest): Promise<BackgroundJobEnqueueResult>;
}

/**
 * R3 遗留的硬拒绝结果。
 *
 * R4 默认路径不再触发它：只有在没有配置 BackgroundJobEnqueuer 时，
 * router 才回退到这个拒绝结果，给出明确的迁移点。
 */
export interface BackgroundJobRejectedResult {
  status: "rejected";
  medium: "background_job";
  code: "background_job_not_activated_until_r4" | "background_job_enqueuer_not_configured";
  message: string;
  mediumTrace: AgentRuntimeMediumTrace;
}

export interface BackgroundJobEnqueuedResult {
  status: "enqueued";
  medium: "background_job";
 jobId: string;
  created: boolean;
  dryRun: boolean;
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
      result: BackgroundJobEnqueuedResult | BackgroundJobRejectedResult;
    };

export interface SingleCallExecutorAdapter {
  execute(): Promise<InlineAgentExecutionResult>;
}

export interface AgentExecutorRouterOptions {
  backgroundJobEnqueuer?: BackgroundJobEnqueuer;
}

export class AgentExecutorRouter {
  private readonly backgroundJobEnqueuer?: BackgroundJobEnqueuer;

  constructor(
    private readonly temporaryConversationExecutor: TemporaryConversationAgentExecutor,
    options: AgentExecutorRouterOptions = {},
  ) {
    this.backgroundJobEnqueuer = options.backgroundJobEnqueuer;
  }

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

  async routeBackgroundJob(
    medium: AgentMediumSelection,
    request: BackgroundJobRouteRequest,
): Promise<AgentExecutorRouteResult> {
    if (!this.backgroundJobEnqueuer) {
      return {
        kind: "background_job",
        result: {
          status: "rejected",
          medium: "background_job",
          code: "background_job_enqueuer_not_configured",
          message: "background_job medium requiresa BackgroundJobEnqueuer to be configured.",
          mediumTrace: buildAgentRuntimeMediumTrace({
            kind: "background_job",
            deliveryTarget: medium.deliveryTarget,
            status: "rejected",
            rejectionCode: "background_job_enqueuer_not_configured",
          }),
        },
      };
    }

    const enqueued = await this.backgroundJobEnqueuer.enqueue(request);
    return {
      kind: "background_job",
      result: {
        status: "enqueued",
        medium: "background_job",
        jobId: enqueued.jobId,
        created: enqueued.created,
        dryRun: enqueued.dryRun,
        mediumTrace: buildAgentRuntimeMediumTrace({
          kind: "background_job",
          deliveryTarget: medium.deliveryTarget,
          // dry_run 演练入队记为 planned；真实执行入队记为 running。
          status: enqueued.dryRun ? "planned" : "running",
          runtimeJobId: enqueued.jobId,
          dryRun: enqueued.dryRun,
        }),
      },
    };
  }

  async routeByMedium(
    medium: AgentMediumSelection,
    options: {
      singleCallExecutor?: SingleCallExecutorAdapter;
      temporaryConversationRequest?: TemporaryConversationAgentRequest;
      backgroundJobRequest?: BackgroundJobRouteRequest;
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
        if (!options.backgroundJobRequest) {
          throw new Error("backgroundJobRequest is required for background_job medium.");
        }
        return this.routeBackgroundJob(medium, options.backgroundJobRequest);
      }
    }
  }
}
