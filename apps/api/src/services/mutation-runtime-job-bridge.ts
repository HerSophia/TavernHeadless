import type { CoreEventBus } from "@tavern/core"

import type { AppDb } from "../db/client.js"
import { RuntimeJobScheduler } from "./runtime-job-scheduler.js"
import { emitRuntimeMutationEvent } from "./runtime-mutation-events.js"
import { createMutationRuntimeJobCatalog, MUTATION_RUNTIME_JOB_TYPES } from "./mutation-runtime-job-definitions.js"
import type { MutationAsyncBridge, MutationAsyncEnqueueOptions, RuntimeMutationEnvelope } from "./runtime-mutation-types.js"

export interface MutationRuntimeJobBridgeOptions {
  eventBus?: CoreEventBus
  catalog?: ReturnType<typeof createMutationRuntimeJobCatalog>
}

export class MutationRuntimeJobBridge implements MutationAsyncBridge {
  private readonly scheduler: RuntimeJobScheduler
  private readonly eventBus?: CoreEventBus

  constructor(
    private readonly db: AppDb,
    options: MutationRuntimeJobBridgeOptions = {},
  ) {
    this.scheduler = new RuntimeJobScheduler(
      options.catalog ?? createMutationRuntimeJobCatalog(),
      { eventBus: options.eventBus },
    )
    this.eventBus = options.eventBus
  }

  async enqueue<TPayload>(
    envelope: RuntimeMutationEnvelope<TPayload>,
    options: MutationAsyncEnqueueOptions<TPayload> = {},
  ) {
    const result = this.db.transaction((tx) => this.scheduler.enqueue(tx, {
      jobType: options.jobType ?? MUTATION_RUNTIME_JOB_TYPES.apply,
      accountId: envelope.accountId,
      scopeType: envelope.scopeType,
      scopeKey: envelope.scopeKey,
      sessionId: options.sessionId ?? envelope.sessionId ?? null,
      floorId: options.floorId ?? envelope.floorId ?? null,
      pageId: options.pageId ?? envelope.pageId ?? null,
      payload: {
        envelope: {
          ...envelope,
          payload: options.payload ?? envelope.payload,
        },
      },
      availableAt: options.availableAt ?? envelope.createdAt,
      maxAttempts: options.maxAttempts,
      phase: options.phase ?? "apply",
      state: options.state,
      result: options.result,
      dedupeKey: options.dedupeKey ?? envelope.idempotencyKey ?? null,
    }))

    void emitRuntimeMutationEvent(this.eventBus, "runtime.mutation_created", envelope, {
      relatedJobId: result.jobId,
      observedAt: Date.now(),
    })

    return result
  }
}

export function createMutationRuntimeJobBridge(
  db: AppDb,
  options: MutationRuntimeJobBridgeOptions = {},
): MutationRuntimeJobBridge {
  return new MutationRuntimeJobBridge(db, options)
}
