/**
 * AgenticTurnCoordinator：R1 单回合 inline Agent 的三段式编排器。
 *
 * 它在聊天主链 prepared 构建前后串联 inline Agent：
 *  - prepared 之前：执行pre_response Agent，产出可注入 prompt 的 contributor 与 Narrator 约束。
 *  - Narrator 执行 + commit 之后：执行 post_response Agent，产出 finding 与 proposal 信封。
 *
 * 约束（见 R1 设计与实施计划）：
 *  - Narrator 仍是唯一正文输出者。本协调器不生成正文，也不托管 Narrator 执行。
 *  - pre_response 在 prepared 之前运行，因此只消费 prepared 之前可得的上下文；
 *    依赖 prepared 产物（memoryTrace / worldbookHits）的 Agent 在 R1 自然 skipped。
 *  - post_response 的 proposal 只进 buffer，不写真相层；commitAdvice 只允许 allow / warn。
 *  - 除 Narrator 外的内建 Agent 默认 fail_open，失败只进 trace。
 *
 * 命名约束（见 docs/contributing.md第 8 节）：本协调器属于聊天主链的回合级编排，
 * 不写主链 turn run 快照，也不与 Execution 子级执行记录混用。
 */
import {
  buildAgentRuntimeTrace,
  buildPostResponseEnvelope,
} from "../agent-runtime/agent-runtime-trace.js";
import type { AgentInvocationService } from "../agent-runtime/agent-invocation-service.js";
import type {
  InlineAgentExecutor,
  InlineAgentExecutorContext,
} from "../agent-runtime/inline-agent-executor.js";
import type { AgentContextAggregator } from "../agent-runtime/agent-context-aggregator.js";
import type {
  AggregatedPreResponseContext,
  AgentInvocationSource,
  AgentRunRecord,
  AgentRuntimeTrace,
  PostResponseEnvelope,
} from "../agent-runtime/inline-agent-types.js";

export interface AgenticPreResponseResult {
  aggregated: AggregatedPreResponseContext;
  records: AgentRunRecord[];
}

export interface AgenticPostResponseResult {
  envelope: PostResponseEnvelope;
  records: AgentRunRecord[];
}

export class AgenticTurnCoordinator {
  constructor(
    private readonly invocationService: AgentInvocationService,
    private readonly executor: InlineAgentExecutor,
    private readonly aggregator: AgentContextAggregator,
  ) {}

  async runPreResponse(args: {
    source: Extract<AgentInvocationSource, { kind: "respond_pre_response" }>;
 context: InlineAgentExecutorContext;
  }): Promise<AgenticPreResponseResult> {
    const plan = this.invocationService.planForSource(args.source);
    const result =await this.executor.execute(plan, args.context);
    const aggregated = this.aggregator.aggregate(result.records);
    return { aggregated, records: result.records };
  }

  async runPostResponse(args: {
    source: Extract<AgentInvocationSource, { kind: "respond_post_response" }>;
    context: InlineAgentExecutorContext;
  }): Promise<AgenticPostResponseResult> {
    const plan = this.invocationService.planForSource(args.source);
    const result = await this.executor.execute(plan, args.context);
    const envelope = buildPostResponseEnvelope(result.records);
    return { envelope, records: result.records};
  }

  buildTrace(args: {
    preRecords: AgentRunRecord[];
    aggregated?: AggregatedPreResponseContext;
    postRecords: AgentRunRecord[];
    postEnvelope: PostResponseEnvelope;
  }): AgentRuntimeTrace {
    return buildAgentRuntimeTrace(args);
  }
}
