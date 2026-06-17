/**
 * `agent.run` 后台 Agent 的真实两阶段 Processor（R4 阶段三）。
 *
 * 替换 Phase 5 的占位实现。它复用 Background Job Runtime 的 prepare / commit 两阶段：
 *
 *  - prepare（事务外，允许慢操作 / LLM）：
 *      校验 payload 与输出目标 -> 构造 BackgroundAgentExecutionContext
 *      -> 调用 BackgroundAgentExecutor.run 产出 BackgroundAgentResult。
 *  - commit（事务内，必须短）：
 *      复用 AgentOutputDispatcher.dispatchSync 写持久输出
 *      -> 写 operation log 与 trace -> 返回 commit 结果。
 *
 * 安全边界：
 *  - 后台 Agent 永不写主叙事正史。forbidden 目标在入队、prepare、commit 三处校验。
 *  - dry_run = true 时只做演练：commit 不写持久输出，只写演练 trace 与 operation log。
 */
import type { DbExecutor } from "../db/client.js";
import {
  RuntimeJobFatalError,
  RuntimeJobRetryableError,
  RuntimeJobUncertainOutcomeError,
} from "./runtime-job-errors.js";
import {RuntimeJobProcessorRegistry } from "./runtime-job-processor-registry.js";
import type {
  RuntimeJobCommitContext,
  RuntimeJobCommitResult,
  RuntimeJobPrepareContext,
  RuntimeJobProcessor,
} from "./runtime-job-types.js";
import {
  AGENT_RUN_JOB_TYPE,
  type AgentRunJobPayload,
} from "./agent-runtime-job-definitions.js";
import {
  assertAllowedOutputTargets,
  AgentPermissionPolicyError,
} from "./agent-permission-policy.js";
import { OperationLogService } from "./operation-log-service.js";
import {
  BackgroundAgentExecutor,
  BackgroundAgentExecutorError,
} from "./agent-runtime/background-agent-executor.js";
import type {
  BackgroundAgentExecutionContext,
  BackgroundAgentResult,
} from "./agent-runtime/background-agent-types.js";
import {
  AgentOutputDispatcher,
  AgentOutputDispatchError,
  type AgentOutputDispatchRequest,
  type AgentOutputDispatchResult,
} from "./agent-runtime/agent-output-dispatcher.js";
import { buildAgentRuntimeMediumTrace } from "./agent-runtime/agent-runtime-trace.js";
import type { AgentLineageRef } from "./agent-runtime/agent-lineage-types.js";
import type { AgentRuntimeMediumTrace } from "./agent-runtime/inline-agent-types.js";

export interface AgentRunJobPrepared {
  result: BackgroundAgentResult;
  dryRun: boolean;
}

export interface AgentRunJobOutputResult {
  target: string;
  id?: string;
}

export interface AgentRunJobResult {
  status: BackgroundAgentResult["status"];
  dryRun: boolean;
  summary: string;
  outputCount: number;
  outputs: AgentRunJobOutputResult[];
  mediumTrace: AgentRuntimeMediumTrace;
}

export interface AgentRuntimeJobProcessorDeps {
  executor: BackgroundAgentExecutor;
  /**
   * 构造一个 sink 绑定到当前事务 executor 的 AgentOutputDispatcher。
   *
   * commit 在同步事务内运行，持久输出必须写入同一事务，因此 dispatcher
   * 的 sink 需绑定到 commit 提供的 tx，而不是外层 app db。
   */
  createDispatcher: (tx: DbExecutor) => AgentOutputDispatcher;
  /** 可选：构造绑定到事务的 operation log service，默认 new OperationLogService(tx)。 */
  createOperationLog?: (tx: DbExecutor) => OperationLogService;
}

function buildLineage(payload: AgentRunJobPayload, jobId: string): AgentLineageRef {
  const input = payload.inputJson ?? {};
  const sourceSessionId = typeof input.source_session_id === "string" ? input.source_session_id : undefined;
  const sourceFloorId = typeof input.source_floor_id === "string" ? input.source_floor_id : undefined;
  const sourcePageId = typeof input.source_page_id === "string" ? input.source_page_id : undefined;

  return {
    rootRunId: jobId,
    ...(sourceSessionId ? { sourceSessionId } : {}),
    ...(sourceFloorId ? { sourceFloorId } : {}),
    ...(sourcePageId ? { sourcePageId } : {}),
  };
}

function assertPayloadOutputTargets(targets: readonly string[]): void {
  try {
    assertAllowedOutputTargets(targets);
  } catch (error) {
    if (error instanceof AgentPermissionPolicyError) {
      throw new RuntimeJobFatalError(error.code, { cause: error });
    }
    throw error;
  }
}

function assertOutputDescriptorsAllowed(outputs: readonly AgentOutputDispatchRequest[]): void {
  const persistedTargets = outputs
    .map((output) => output.target)
    .filter((target) => target !== "return_inline");
  assertPayloadOutputTargets(persistedTargets);
}

function classifyExecutorError(error: unknown): Error {
  if (
    error instanceof RuntimeJobFatalError
    || error instanceof RuntimeJobRetryableError
    || error instanceof RuntimeJobUncertainOutcomeError
  ) {
    return error;
  }
  if (error instanceof BackgroundAgentExecutorError) {
    if (error.kind === "fatal") {
      return new RuntimeJobFatalError(error.code, { cause: error });
    }
    if (error.kind === "uncertain") {
      return new RuntimeJobUncertainOutcomeError(error.code, { cause: error });
    }
    return new RuntimeJobRetryableError(error.code, { cause: error });
  }
  if (error instanceof AgentPermissionPolicyError) {
    return new RuntimeJobFatalError(error.code, { cause: error });
  }
  if (error instanceof AgentOutputDispatchError) {
    return new RuntimeJobFatalError(error.code, { cause: error });
  }
  // 默认按业务可重试错误处理，外部副作用不确定的情况由具体 handler 显式抛 uncertain。
  return new RuntimeJobRetryableError(error instanceof Error ? error.message : String(error), {
    cause: error instanceof Error ? error: undefined,
  });
}

function classifyCommitError(error: unknown): Error {
  if (
    error instanceof RuntimeJobFatalError
    || error instanceof RuntimeJobRetryableError
    || error instanceof RuntimeJobUncertainOutcomeError
  ) {
    return error;
  }
  if (error instanceof AgentPermissionPolicyError || error instanceof AgentOutputDispatchError) {
    return new RuntimeJobFatalError(error.code, { cause: error });
  }
  // 持久写入服务的权限 / 校验类错误一般是配置问题，按 fatal 处理。
  const code = (error as { code?: unknown })?.code;
  if (typeof code === "string") {
    return new RuntimeJobFatalError(code, { cause: error instanceof Error ? error : undefined});
  }
  return new RuntimeJobUncertainOutcomeError(error instanceof Error ? error.message : String(error), {
    cause: error instanceof Error ? error : undefined,
  });
}

function extractOutputResult(result: AgentOutputDispatchResult): AgentRunJobOutputResult {
  switch (result.target) {
    case "derived_output":
      return { target: result.target, id: result.record.id };
    case "project_inbox":
      return { target: result.target, id: result.record.id };
    case "session_state_proposal":
      return { target: result.target, id: result.proposalId };
    case "prompt_runtime_injection":
      return result.scope === "request"
        ? { target: result.target }
        : { target: result.target, id: result.injectionId };
    case "page_staged_write":
 case "return_inline":
      return { target: result.target };
  }
}

export class AgentRuntimeJobProcessor
  implements RuntimeJobProcessor<AgentRunJobPayload, AgentRunJobPrepared, AgentRunJobResult>
{
  constructor(private readonly deps: AgentRuntimeJobProcessorDeps) {}

  async prepare(
    context: RuntimeJobPrepareContext<AgentRunJobPayload>,
  ): Promise<AgentRunJobPrepared> {
    const { payload, db, job } = context;

    // forbidden 目标双重保险：入队已校验，这里再校验一次。
    assertPayloadOutputTargets(payload.resolvedConfig.allowedOutputTargets);

    const lineage = buildLineage(payload, job.id);
    const execContext: BackgroundAgentExecutionContext = {
      db,
      accountId: payload.accountId,
      workspaceId: payload.workspaceId,
      projectId: payload.projectId,
      agentTypeId: payload.agentTypeId,
      agentBindingId: payload.agentBindingId,
      scopeKind: payload.scopeKind,
      resolvedConfig: payload.resolvedConfig,
      lineage,
      dryRun: payload.dryRun,
      inputJson: payload.inputJson,
      sourceEventId: payload.sourceEventId ?? null,
      actorClientId: payload.actorClientId ?? null,
    };

    let result: BackgroundAgentResult;
    try {
      result = await context.withHeartbeat(async () => this.deps.executor.run(execContext));
    } catch (error) {
      throw classifyExecutorError(error);
    }

    if (payload.dryRun && result.outputs.length > 0) {
      throw new RuntimeJobFatalError("agent_dry_run_must_not_produce_outputs");
    }

    // 即便 handler 越权产出 forbidden 目标，也在 commit 前再拦一次。
    try {
      assertOutputDescriptorsAllowed(result.outputs);
    } catch (error) {
      throw classifyExecutorError(error);
    }

    return { result, dryRun: payload.dryRun };
  }

  commit(
    context: RuntimeJobCommitContext<AgentRunJobPayload, AgentRunJobPrepared>,
  ): RuntimeJobCommitResult<AgentRunJobResult> {
    const { tx,job, payload, prepared, completedAt } = context;
    const { result, dryRun } = prepared;

    const outputResults: AgentRunJobOutputResult[] = [];
    if (!dryRun) {
      const dispatcher = this.deps.createDispatcher(tx);
      try {
        for (const output of result.outputs) {
          outputResults.push(extractOutputResult(dispatcher.dispatchSync(output)));
        }
      } catch (error) {
        throw classifyCommitError(error);
      }
    }

    const wrotePersistedOutput = !dryRun && outputResults.length > 0;
    const mediumTrace = buildAgentRuntimeMediumTrace({
      kind: "background_job",
      deliveryTarget: result.traceDraft.deliveryTarget,
      status: dryRun ? "planned" : result.status === "failed" ?"failed" : "completed",
      runtimeJobId: job.id,
      dryRun,
      ...(result.traceDraft.purpose ? { purpose: result.traceDraft.purpose } : {}),
      ...(result.traceDraft.lineage ? { lineage: result.traceDraft.lineage } : {}),
    });

    const operationLog = this.deps.createOperationLog?.(tx) ?? new OperationLogService(tx);
    operationLog.append({
      accountId: payload.accountId,
      actorType: payload.actorClientId ? "client" : "system",
      actorId: payload.actorClientId ?? null,
      sourceType: "agent_runtime",
      action: "agent.run",
      status: result.status === "failed" ? "failed" : "succeeded",
      workspaceId: payload.workspaceId,
      projectId: payload.projectId,
      actorClientId: payload.actorClientId ?? null,
      runId: job.id,
      targetType: "agent_binding",
      targetId: payload.agentBindingId,
      metadata: {
        agent_type_id: payload.agentTypeId,
        agent_binding_id: payload.agentBindingId,
        source_event_id: payload.sourceEventId ?? null,
        trigger_type: payload.triggerType,
        dry_run: dryRun,
        delivery_target: result.traceDraft.deliveryTarget,
        output_results: outputResults,
        trace_summary: result.summary,
        medium_trace: mediumTrace,
      },
    });

    const commitResult: AgentRunJobResult = {
      status: result.status,
      dryRun,
      summary: result.summary,
      outputCount: outputResults.length,
      outputs: outputResults,
      mediumTrace,
    };

    return {
      result: commitResult,
      phase: "finished",
      scopeMutation: wrotePersistedOutput ? "changed" : "none",
    };
  }
}

export function createAgentRuntimeJobProcessorRegistry(
  deps: AgentRuntimeJobProcessorDeps,
): RuntimeJobProcessorRegistry {
  const registry = new RuntimeJobProcessorRegistry();
  registry.register(AGENT_RUN_JOB_TYPE, new AgentRuntimeJobProcessor(deps));
  return registry;
}
