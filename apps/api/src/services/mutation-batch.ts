import type { CoreEventBus } from "@tavern/core"

import type { AppDb, DbExecutor } from "../db/client.js"
import { MutationApplierRegistry } from "./mutation-applier-registry.js"
import {
  RuntimeMutationBatchAlreadyAppliedError,
  RuntimeMutationBatchApplyError,
  RuntimeMutationInvalidPhaseError,
} from "./runtime-mutation-errors.js"
import type {
  AppliedRuntimeMutation,
  MutationApplyContext,
  MutationApplyContextInput,
  MutationApplyHandler,
  MutationBatch,
  MutationBatchApplyResult,
  RuntimeMutationApplyResult,
  RuntimeMutationEnvelope,
} from "./runtime-mutation-types.js"

export interface DefaultMutationBatchOptions {
  eventBus?: CoreEventBus
  now?: () => number
}

export function assertMutationPhase(
  envelope: RuntimeMutationEnvelope,
  expectedPhases: readonly RuntimeMutationEnvelope["applyPhase"][],
  operation: string,
): void {
  if (expectedPhases.includes(envelope.applyPhase)) {
    return
  }

  throw new RuntimeMutationInvalidPhaseError({
    mutationId: envelope.id,
    kind: envelope.kind,
    actualPhase: envelope.applyPhase,
    expectedPhases,
    operation,
  })
}

export function createMutationApplyContext(args: {
  db: AppDb
  tx: DbExecutor
  envelope: RuntimeMutationEnvelope
  contextInput?: MutationApplyContextInput
  eventBus?: CoreEventBus
  now: () => number
}): MutationApplyContext {
  return {
    accountId: args.envelope.accountId,
    actor: args.contextInput?.actor,
    requestId: args.contextInput?.requestId,
    eventBus: args.contextInput?.eventBus ?? args.eventBus,
    db: args.db,
    tx: args.tx,
    now: args.now,
  }
}

function normalizeMutationApplyResult<TResult>(
  result: RuntimeMutationApplyResult<TResult>,
): Required<Pick<RuntimeMutationApplyResult<TResult>, "afterCommit">> &
  Pick<RuntimeMutationApplyResult<TResult>, "result"> {
  return {
    result: result.result,
    afterCommit: [...(result.afterCommit ?? [])],
  }
}

export function createMutationBatchApplyResult(
  mutations: AppliedRuntimeMutation[],
  afterCommit: Array<() => Promise<void> | void>,
): MutationBatchApplyResult {
  let executed = false

  return {
    appliedCount: mutations.length,
    mutations,
    async runAfterCommit() {
      if (executed) {
        return
      }

      executed = true
      for (const hook of afterCommit) {
        await hook()
      }
    },
  }
}

export function applyMutationWithHandler<TPayload, TResult>(args: {
  db: AppDb
  tx: DbExecutor
  envelope: RuntimeMutationEnvelope<TPayload>
  handler: MutationApplyHandler<TPayload, TResult>
  contextInput?: MutationApplyContextInput
  eventBus?: CoreEventBus
  now: () => number
}): {
  mutation: AppliedRuntimeMutation<TResult>
  afterCommit: Array<() => Promise<void> | void>
} {
  const context = createMutationApplyContext({
    db: args.db,
    tx: args.tx,
    envelope: args.envelope,
    contextInput: args.contextInput,
    eventBus: args.eventBus,
    now: args.now,
  })

  const normalized = normalizeMutationApplyResult(
    args.handler({
      envelope: args.envelope,
      context,
    }),
  )

  return {
    mutation: {
      envelope: { ...args.envelope },
      result: normalized.result,
    },
    afterCommit: normalized.afterCommit,
  }
}

export class DefaultMutationBatch implements MutationBatch {
  private readonly staged: RuntimeMutationEnvelope[] = []
  private readonly eventBus?: CoreEventBus
  private readonly now: () => number
  private applied = false

  constructor(
    private readonly db: AppDb,
    private readonly registry: MutationApplierRegistry,
    options: DefaultMutationBatchOptions = {},
  ) {
    this.eventBus = options.eventBus
    this.now = options.now ?? Date.now
  }

  stage<TPayload>(envelope: RuntimeMutationEnvelope<TPayload>): void {
    if (this.applied) {
      throw new RuntimeMutationBatchAlreadyAppliedError()
    }

    assertMutationPhase(envelope, ["commit"], "stage runtime mutation batch")
    this.staged.push({ ...envelope })
  }

  list(): RuntimeMutationEnvelope[] {
    return this.staged.map((envelope) => ({ ...envelope }))
  }

  applyInTransaction(tx: DbExecutor, context?: MutationApplyContextInput): MutationBatchApplyResult {
    if (this.applied) {
      throw new RuntimeMutationBatchAlreadyAppliedError()
    }

    const appliedMutations: AppliedRuntimeMutation[] = []
    const afterCommit: Array<() => Promise<void> | void> = []

    for (const envelope of this.staged) {
      assertMutationPhase(envelope, ["commit"], "apply runtime mutation batch")
      const applier = this.registry.get(envelope.kind)

      try {
        const applied = applyMutationWithHandler({
          db: this.db,
          tx,
          envelope,
          handler: (request) => applier.apply(request),
          contextInput: context,
          eventBus: this.eventBus,
          now: this.now,
        })

        appliedMutations.push(applied.mutation)
        afterCommit.push(...applied.afterCommit)
      } catch (error) {
        if (error instanceof Error) {
          throw error
        }

        throw new RuntimeMutationBatchApplyError(
          { id: envelope.id, kind: envelope.kind },
          { cause: error },
        )
      }
    }

    this.applied = true
    return createMutationBatchApplyResult(appliedMutations, afterCommit)
  }
}
