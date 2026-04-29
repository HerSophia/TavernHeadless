import { eq } from "drizzle-orm";

import type { AppDb } from "../../../db/client.js";
import { toolExecutionRecords } from "../../../db/schema.js";
import { RuntimeJobFatalError } from "../../runtime-job-errors.js";
import { RuntimeJobProcessorRegistry } from "../../runtime-job-processor-registry.js";
import type {
  RuntimeJobCommitResult,
  RuntimeJobCommitContext,
  RuntimeJobExpiredRunningContext,
  RuntimeJobPrepareContext,
  RuntimeJobProcessor,
} from "../../runtime-job-types.js";
import { TOOL_RUNTIME_JOB_TYPES, type ToolExecuteJobPayload } from "./tool-runtime-job-definitions.js";
import type { FinalizedToolAsyncExecution } from "./tool-runtime-types.js";
import { finalizeToolCallResult } from "./tool-runtime-types.js";
import type { ToolAsyncHandlerRegistry } from "./tool-async-handler-registry.js";

const EXPIRED_RUNNING_UNCERTAIN_REASON = "expired_running_lease";
const EXPIRED_RUNNING_UNCERTAIN_MESSAGE =
  "Worker lease expired after tool execution entered running state; automatic replay blocked and outcome is uncertain.";

interface PreparedToolExecution {
  envelope: ToolExecuteJobPayload["envelope"];
  finalized: FinalizedToolAsyncExecution;
}

interface ToolExecuteJobResult {
  executionId: string;
  toolName: string;
  status: FinalizedToolAsyncExecution["status"];
  recoveryRequired?: true;
  reason?: typeof EXPIRED_RUNNING_UNCERTAIN_REASON;
}

export interface ToolRuntimeJobProcessorDependencies {
  db: AppDb;
  handlers: ToolAsyncHandlerRegistry;
  now?: () => number;
}

class ToolExecuteJobProcessor implements RuntimeJobProcessor<ToolExecuteJobPayload, PreparedToolExecution, ToolExecuteJobResult> {
  private readonly now: () => number;

  constructor(private readonly deps: ToolRuntimeJobProcessorDependencies) {
    this.now = deps.now ?? Date.now;
  }

  async prepare(context: RuntimeJobPrepareContext<ToolExecuteJobPayload>): Promise<PreparedToolExecution> {
    const envelope = context.payload.envelope;
    const handler = this.deps.handlers.find(envelope);

    if (!handler) {
      return {
        envelope,
        finalized: finalizeToolCallResult(
          envelope,
          {
            error: `Async handler for provider type '${envelope.providerType}' is not registered`,
            executionStatus: "error",
          },
          this.now(),
        ),
      };
    }

    const runningUpdate = await this.deps.db
      .update(toolExecutionRecords)
      .set({
        status: "running",
        lifecycleState: "opened",
        runtimeJobId: context.job.id,
      })
      .where(eq(toolExecutionRecords.id, envelope.executionId))
      .run();

    if (runningUpdate.changes !== 1) {
      throw new RuntimeJobFatalError(
        `Deferred tool execution record '${envelope.executionId}' not found while starting runtime job '${context.job.id}'`,
      );
    }

    await context.updateProgress({
      phase: "executing",
      progressCurrent: 0,
      progressTotal: 1,
      progressMessage: `executing ${envelope.toolName}`,
      state: { executionId: envelope.executionId },
      stateMode: "merge",
    });

    let result;
    try {
      result = await context.withHeartbeat(async () => {
        return await handler.executeDeferredJob(envelope);
      });
    } catch (error) {
      result = {
        error: error instanceof Error ? error.message : String(error),
        executionStatus: "error" as const,
      };
    }

    return {
      envelope,
      finalized: finalizeToolCallResult(envelope, result, this.now()),
    };
  }

  recoverExpiredRunning(context: RuntimeJobExpiredRunningContext<ToolExecuteJobPayload>): RuntimeJobCommitResult<ToolExecuteJobResult> {
    const envelope = context.payload.envelope;
    const finishedAt = context.recoveredAt;
    const durationMs = Math.max(0, finishedAt - envelope.acceptedAt);
    const resultJson = JSON.stringify({
      error: EXPIRED_RUNNING_UNCERTAIN_MESSAGE,
      recoveryRequired: true,
      reason: EXPIRED_RUNNING_UNCERTAIN_REASON,
    });

    const updateResult = context.tx
      .update(toolExecutionRecords)
      .set({
        resultJson,
        status: "uncertain",
        lifecycleState: "finished",
        errorMessage: EXPIRED_RUNNING_UNCERTAIN_MESSAGE,
        durationMs,
        finishedAt,
        runtimeJobId: context.job.id,
      })
      .where(eq(toolExecutionRecords.id, envelope.executionId))
      .run();

    if (updateResult.changes !== 1) {
      throw new RuntimeJobFatalError(
        `Deferred tool execution record '${envelope.executionId}' not found while recovering runtime job '${context.job.id}' after an expired running lease`,
      );
    }

    return {
      phase: "uncertain",
      result: {
        executionId: envelope.executionId,
        toolName: envelope.toolName,
        status: "uncertain",
        recoveryRequired: true,
        reason: EXPIRED_RUNNING_UNCERTAIN_REASON,
      },
      progressCurrent: 1,
      progressTotal: 1,
      progressMessage: "tool execution outcome uncertain",
      scopeMutation: "changed" as const,
      lastProcessedAt: finishedAt,
    };
  }

  commit(context: RuntimeJobCommitContext<ToolExecuteJobPayload, PreparedToolExecution>): RuntimeJobCommitResult<ToolExecuteJobResult> {
    const { envelope, finalized } = context.prepared;

    const updateResult = context.tx
      .update(toolExecutionRecords)
      .set({
        resultJson: finalized.resultJson,
        status: finalized.status,
        lifecycleState: "finished",
        errorMessage: finalized.errorMessage ?? null,
        durationMs: finalized.durationMs,
        finishedAt: finalized.finishedAt,
        runtimeJobId: context.job.id,
      })
      .where(eq(toolExecutionRecords.id, envelope.executionId))
      .run();

    if (updateResult.changes !== 1) {
      throw new RuntimeJobFatalError(
        `Deferred tool execution record '${envelope.executionId}' not found while finalizing runtime job '${context.job.id}'`,
      );
    }

    return {
      phase: finalized.status,
      result: {
        executionId: envelope.executionId,
        toolName: envelope.toolName,
        status: finalized.status,
      },
      progressCurrent: 1,
      progressTotal: 1,
      progressMessage: finalized.status === "success"
        ? "tool execution completed"
        : `tool execution ${finalized.status}`,
      scopeMutation: "changed" as const,
      lastProcessedAt: context.completedAt,
    };
  }
}

export function createToolRuntimeJobProcessorRegistry(
  deps: ToolRuntimeJobProcessorDependencies,
): RuntimeJobProcessorRegistry {
  const registry = new RuntimeJobProcessorRegistry();
  registry.register(
    TOOL_RUNTIME_JOB_TYPES.execute,
    new ToolExecuteJobProcessor(deps),
  );
  return registry;
}
