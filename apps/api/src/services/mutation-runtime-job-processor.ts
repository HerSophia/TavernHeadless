import type { CoreEventBus } from "@tavern/core"

import type { AppDb } from "../db/client.js"
import { MutationApplierRegistry } from "./mutation-applier-registry.js"
import { applyMutationWithHandler } from "./mutation-batch.js"
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
    const applied = applyMutationWithHandler({
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

    return {
      phase: "applied",
      result: applied.mutation.result,
      progressCurrent: 1,
      progressTotal: 1,
      progressMessage: "mutation applied",
      scopeMutation: "changed" as const,
      lastProcessedAt: context.completedAt,
      afterCommit: applied.afterCommit.length > 0
        ? async () => {
          for (const hook of applied.afterCommit) {
            await hook()
          }
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
