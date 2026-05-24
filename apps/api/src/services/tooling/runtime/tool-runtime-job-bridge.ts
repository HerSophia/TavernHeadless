import type { PendingToolJobRequest, CoreEventBus } from "@tavern/core";

import type { AppDb, DbExecutor } from "../../../db/client.js";
import { RuntimeJobScheduler } from "../../runtime-job-scheduler.js";
import { createToolRuntimeJobCatalog, TOOL_RUNTIME_JOB_TYPES } from "./tool-runtime-job-definitions.js";
import type { ToolRuntimePolicy } from "./tool-runtime-policy.js";
import { buildToolRuntimeScopeKey, TOOL_RUNTIME_SCOPE_TYPE } from "./tool-runtime-types.js";

export interface ToolRuntimeJobBridgeOptions {
  eventBus?: CoreEventBus;
  catalog?: ReturnType<typeof createToolRuntimeJobCatalog>;
  toolRuntimePolicy?: ToolRuntimePolicy;
}

export class ToolRuntimeJobBridge {
  private readonly scheduler: RuntimeJobScheduler;

  constructor(
    _db: AppDb,
    options: ToolRuntimeJobBridgeOptions = {},
  ) {
    void _db;

    this.options = options;
    this.scheduler = new RuntimeJobScheduler(
      options.catalog ?? createToolRuntimeJobCatalog(),
      { eventBus: options.eventBus },
    );
  }

  private readonly options: ToolRuntimeJobBridgeOptions;

  enqueue(tx: DbExecutor, request: PendingToolJobRequest) {
    if (!request.envelope.accountId) {
      throw new Error(`Deferred tool job '${request.jobId}' is missing accountId`);
    }

    const policySnapshot = this.options.toolRuntimePolicy?.getExecutionPolicySnapshot();

    return this.scheduler.enqueue(tx, {
      jobId: request.jobId,
      jobType: TOOL_RUNTIME_JOB_TYPES.execute,
      accountId: request.envelope.accountId,
      scopeType: TOOL_RUNTIME_SCOPE_TYPE,
      scopeKey: buildToolRuntimeScopeKey(request.envelope.sessionId),
      sessionId: request.envelope.sessionId,
      floorId: request.envelope.floorId,
      pageId: request.envelope.pageId ?? null,
      payload: {
        envelope: request.envelope,
        ...(policySnapshot ? { policy: policySnapshot } : {}),
        provenance: {
          triggerScope: "chat_turn",
        },
      },
      availableAt: request.envelope.acceptedAt,
      phase: "queued",
      state: {
        executionId: request.executionId,
      },
      dedupeKey: `tool-execution:${request.executionId}`,
      ...(policySnapshot?.maxAttempts
        ? { maxAttempts: policySnapshot.maxAttempts }
        : {}),
    });
  }
}

export function createToolRuntimeJobBridge(
  db: AppDb,
  options: ToolRuntimeJobBridgeOptions = {},
): ToolRuntimeJobBridge {
  return new ToolRuntimeJobBridge(db, options);
}
