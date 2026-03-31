import type { CoreEventBus } from "@tavern/core"

import type { AppDb } from "../db/client.js"
import { MutationApplierRegistry } from "./mutation-applier-registry.js"
import {
  DefaultMutationBatch,
  applyMutationWithHandler,
  assertMutationPhase,
  createMutationBatchApplyResult,
} from "./mutation-batch.js"
import {
  RuntimeMutationAsyncBridgeUnavailableError,
  RuntimeMutationBatchApplyError,
} from "./runtime-mutation-errors.js"
import type {
  MutationApplyContextInput,
  MutationApplyHandler,
  MutationAsyncBridge,
  MutationAsyncEnqueueOptions,
  MutationBatch,
  MutationRuntime,
  RuntimeMutationEnvelope,
} from "./runtime-mutation-types.js"

export interface MutationRuntimeOptions {
  registry?: MutationApplierRegistry
  eventBus?: CoreEventBus
  now?: () => number
  asyncBridge?: MutationAsyncBridge
}

function normalizeInlineArgs<TPayload, TResult>(
  handlerOrContext?: MutationApplyHandler<TPayload, TResult> | MutationApplyContextInput,
  context?: MutationApplyContextInput,
): {
  handler?: MutationApplyHandler<TPayload, TResult>
  context?: MutationApplyContextInput
} {
  if (typeof handlerOrContext === "function") {
    return {
      handler: handlerOrContext,
      context,
    }
  }

  return {
    context: handlerOrContext,
  }
}

export class DefaultMutationRuntime implements MutationRuntime {
  private readonly registry: MutationApplierRegistry
  private readonly eventBus?: CoreEventBus
  private readonly now: () => number
  private readonly asyncBridge?: MutationAsyncBridge

  constructor(
    private readonly db: AppDb,
    options: MutationRuntimeOptions = {},
  ) {
    this.registry = options.registry ?? new MutationApplierRegistry()
    this.eventBus = options.eventBus
    this.now = options.now ?? Date.now
    this.asyncBridge = options.asyncBridge
  }

  beginBatch(): MutationBatch {
    return new DefaultMutationBatch(this.db, this.registry, {
      eventBus: this.eventBus,
      now: this.now,
    })
  }

  async applyInline<TPayload = unknown, TResult = unknown>(
    envelope: RuntimeMutationEnvelope<TPayload>,
    handlerOrContext?: MutationApplyHandler<TPayload, TResult> | MutationApplyContextInput,
    context?: MutationApplyContextInput,
  ): Promise<TResult | undefined> {
    assertMutationPhase(envelope, ["inline"], "apply inline runtime mutation")

    const args = normalizeInlineArgs(handlerOrContext, context)
    const handler = args.handler ?? ((request) => this.registry.get<TPayload, TResult>(envelope.kind).apply(request))

    const applied = this.db.transaction((tx) => {
      try {
        return applyMutationWithHandler({
          db: this.db,
          tx,
          envelope,
          handler,
          contextInput: args.context,
          eventBus: this.eventBus,
          now: this.now,
        })
      } catch (error) {
        if (error instanceof Error) {
          throw error
        }

        throw new RuntimeMutationBatchApplyError(
          { id: envelope.id, kind: envelope.kind },
          { cause: error },
        )
      }
    })

    const result = createMutationBatchApplyResult([applied.mutation], applied.afterCommit)
    await result.runAfterCommit()
    return applied.mutation.result as TResult | undefined
  }

  async enqueueAsync<TPayload = unknown>(
    envelope: RuntimeMutationEnvelope<TPayload>,
    options: MutationAsyncEnqueueOptions<TPayload> = {},
  ) {
    assertMutationPhase(envelope, ["async"], "enqueue async runtime mutation")

    if (!this.asyncBridge) {
      throw new RuntimeMutationAsyncBridgeUnavailableError(envelope.kind)
    }

    return this.asyncBridge.enqueue(envelope, options)
  }
}

export function createMutationRuntime(
  db: AppDb,
  options: MutationRuntimeOptions = {},
): DefaultMutationRuntime {
  return new DefaultMutationRuntime(db, options)
}
