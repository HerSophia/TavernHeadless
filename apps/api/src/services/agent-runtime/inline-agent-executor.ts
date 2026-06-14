/**
 * InlineAgentExecutor：执行 AgentInvocationPlan。
 *
 * 职责：
 *  - 逐组执行计划。
 *  - 并行组使用 Promise.allSettled，单组内单个 Agent 失败不影响同组其他 Agent。
 *  - 收集每个 Agent 的状态、耗时、输出摘要、错误码。
 *  - 按 failurePolicy 决定继续还是中止。
 *
 * R1 规则：除 Narrator 外的内建 Agent 默认 fail_open，失败只进 trace，不阻断主链。
 * Narrator 不由本 executor 托管，它仍由聊天主链的 narrator 执行协作者负责。
 */
import type {
  AgentInvocationPlan,
  AgentProcessor,
  AgentRunContext,
  AgentRunRecord,
  InlineAgentExecutionResult,
  InlineAgentSpec,
} from "./inline-agent-types.js";

/**
 * 内建 Agent 注册表：按角色类型解析 processor。
 */
export interface InlineAgentRegistry {
  resolve(spec: InlineAgentSpec): AgentProcessor | undefined;
}

export interface InlineAgentExecutorContext {
  sessionId: string;
  branchId?: string;
  floorId: string;
  pageId?: string;
  accountId: string;
  preparedTurn?: AgentRunContext["preparedTurn"];
  firstPartyStateContext?: AgentRunContext["firstPartyStateContext"];
  memorySummary?: string;
  memoryTrace?: AgentRunContext["memoryTrace"];
  worldbookHits?: AgentRunContext["worldbookHits"];
  narratorText?: string;
promptMode?: AgentRunContext["promptMode"];
  abortSignal?: AbortSignal;
}

export class InlineAgentExecutor {
  constructor(private readonly registry: InlineAgentRegistry) {}

  async execute(
    plan: AgentInvocationPlan,
    context: InlineAgentExecutorContext,
  ): Promise<InlineAgentExecutionResult> {
    const records: AgentRunRecord[] = [];
    let aborted = false;

    for (const group of plan.groups) {
      if (aborted) {
        break;
      }

      if (group.parallel) {
        const groupRecords = await Promise.all(
          group.agents.map((spec) => this.runAgentSafely(spec, plan, context)),
        );
        records.push(...groupRecords);
      } else {
        for (const spec of group.agents) {
          const record = await this.runAgentSafely(spec, plan, context);
          records.push(record);
          if (record.status === "failed" && spec.failurePolicy === "fail_closed") {
            aborted = true;
            break;
          }
        }
      }

      if (
        group.parallel &&
        group.agents.some(
          (spec) =>
            spec.failurePolicy === "fail_closed" &&
            records.find((record) => record.agentId === spec.id)?.status === "failed",
        )
      ) {
        aborted = true;
      }
    }

    return {
      phase: plan.phase,
      records,
      aborted,
    };
  }

  private async runAgentSafely(
    spec: InlineAgentSpec,
    plan: AgentInvocationPlan,
    context: InlineAgentExecutorContext,
  ): Promise<AgentRunRecord> {
    const startedAt = Date.now();
    const processor = this.registry.resolve(spec);

    if (!processor) {
      return {
        agentId: spec.id,
        roleKind: spec.roleKind,
        phase: spec.phase,
        status: "skipped",
        durationMs: 0,
        stabilityHint: spec.stabilityHint,
        outputSummary: "no processor registered",
      };
    }

    const runContext: AgentRunContext = {
      sessionId: context.sessionId,
      branchId: context.branchId,
      floorId: context.floorId,
      pageId: context.pageId,
      accountId: context.accountId,
      source: plan.source,
      spec,
      preparedTurn: context.preparedTurn,
      firstPartyStateContext: context.firstPartyStateContext,
      memorySummary: context.memorySummary,
      memoryTrace: context.memoryTrace,
      worldbookHits: context.worldbookHits,
      narratorText: context.narratorText,
      promptMode: context.promptMode,
      abortSignal: context.abortSignal,
    };

    try {
      const prepared = await processor.prepare(runContext);
      const output = await processor.execute(prepared, runContext);
      const hasOutput =
     Boolean(output.contributor) ||
        Boolean(output.narratorConstraints?.length) ||
        Boolean(output.worldbookSelectionOverride) ||
        Boolean(output.memorySelectionOverride) ||
        Boolean(output.findings?.length) ||
        Boolean(output.stateProposals?.length) ||
        Boolean(output.memoryProposals?.length);

      return {
        agentId: spec.id,
        roleKind: spec.roleKind,
        phase: spec.phase,
        status: hasOutput ? "ok" : "skipped",
        durationMs: Date.now() - startedAt,
        stabilityHint: spec.stabilityHint,
        output,
        ...(output.summary ? { outputSummary: output.summary } : {}),
      };
    } catch (error) {
      return {
        agentId: spec.id,
        roleKind: spec.roleKind,
        phase: spec.phase,
        status: "failed",
        durationMs: Date.now() - startedAt,
        stabilityHint: spec.stabilityHint,
        errorCode: resolveErrorCode(error),
        outputSummary: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

function resolveErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) {
      return code;
    }
  }
  return "agent_run_failed";
}
