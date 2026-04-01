import type { CoreEventBus } from "@tavern/core"

import type { AppDb } from "../db/client.js"
import { MutationApplierRegistry } from "./mutation-applier-registry.js"
import { applyMutationWithHandler } from "./mutation-batch.js"
import { emitRuntimeMutationEvent, toRuntimeMutationErrorFields } from "./runtime-mutation-events.js"
import { createMutationRuntimeJobCatalog, MUTATION_RUNTIME_JOB_TYPES, type MutationApplyJobPayload } from "./mutation-runtime-job-definitions.js"
import { RuntimeJobProcessorRegistry } from "./runtime-job-processor-registry.js"
import type {
  RuntimeJobCommitContext,
  RuntimeJobPrepareContext,
  RuntimeJobProcessor,
} from "./runtime-job-types.js"

export interface MutationRuntimeJobProcessorDependencies {
  db: AppDb
  registry: MutationApplierRegistry
  eventBus?: CoreEventBus
  now?: () => number
}

class MutationApplyJobProcessor implements RuntimeJobProcessor<MutationApplyJobPayload, MutationApplyJobPayload, unknown> {
  private readonly now: () => number

  constructor(private readonly deps: MutationRuntimeJobProcessorDependencies) {
    this.now = deps.now ?? Date.now
  }

  async prepare(context: RuntimeJobPrepareContext<MutationApplyJobPayload>): Promise<MutationApplyJobPayload> {
    return context.payload
  }

  commit(context: RuntimeJobCommitContext<MutationApplyJobPayload, MutationApplyJobPayload>) {
    const envelope = context.prepared.envelope as import("./runtime-mutation-types.js").RuntimeMutationEnvelope<unknown>
    const applier = this.deps.registry.get(envelope.kind)

    const applied = (() => {
      try {
        return applyMutationWithHandler({
          db: context.db,
          tx: context.tx,
          envelope,
          handler: (request) => applier.apply(request),
          contextInput: {
            actor: { type: "worker", id: context.workerId },
            requestId: context.job.id,
          },
          eventBus: this.deps.eventBus,
          now: this.now,
        })
      } catch (error) {
        const errorFields = toRuntimeMutationErrorFields(error)
        void emitRuntimeMutationEvent(this.deps.eventBus, "runtime.mutation_failed", envelope, {
          actor: { type: "worker", id: context.workerId },
          requestId: context.job.id,
          relatedJobId: context.job.id,
          outcome: "failed",
          observedAt: this.now(),
          ...errorFields,
        })
        throw error
      }
    })()

    return {
      phase: "applied",
      result: applied.mutation.result,
      progressCurrent: 1,
      progressTotal: 1,
      progressMessage: "mutation applied",
      scopeMutation: "changed" as const,
      lastProcessedAt: context.completedAt,
      afterCommit: applied.afterCommit.length > 0 || this.deps.eventBus
        ? async () => {
          for (const hook of applied.afterCommit) {
            await hook()
          }

          await emitRuntimeMutationEvent(
            this.deps.eventBus,
            applied.mutation.outcome === "skipped"
              ? "runtime.mutation_skipped"
              : "runtime.mutation_applied",
            applied.mutation.envelope,
            {
              actor: { type: "worker", id: context.workerId },
              requestId: context.job.id,
              relatedJobId: context.job.id,
              outcome: applied.mutation.outcome,
              skipReason: applied.mutation.skipReason ?? null,
              observedAt: this.now(),
            },
          )
        }
        : undefined,
    }
  }
}

export function createMutationRuntimeJobProcessorRegistry(
  deps: MutationRuntimeJobProcessorDependencies,
): RuntimeJobProcessorRegistry {
  const registry = new RuntimeJobProcessorRegistry()
  registry.register(
    MUTATION_RUNTIME_JOB_TYPES.apply,
    new MutationApplyJobProcessor(deps),
  )
  return registry
}

export { createMutationRuntimeJobCatalog }
