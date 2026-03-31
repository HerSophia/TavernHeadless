import type { CoreEventBus } from "@tavern/core"

import type { AppDb, DbExecutor } from "../db/client.js"
import type { EnqueueRuntimeJobResult } from "./runtime-job-types.js"

export const MUTATION_APPLY_PHASES = ["inline", "commit", "async"] as const
export type MutationApplyPhase = (typeof MUTATION_APPLY_PHASES)[number]

export const MUTATION_DURABILITIES = ["ephemeral", "transactional", "durable_job"] as const
export type MutationDurability = (typeof MUTATION_DURABILITIES)[number]

export const MUTATION_REPLAY_SAFETIES = [
  "safe",
  "confirm_on_replay",
  "never_auto_replay",
  "uncertain",
] as const
export type MutationReplaySafety = (typeof MUTATION_REPLAY_SAFETIES)[number]

export const MUTATION_CONFLICT_POLICIES = [
  "replace",
  "if_absent",
  "compare_and_swap",
  "merge",
] as const
export type MutationConflictPolicy = (typeof MUTATION_CONFLICT_POLICIES)[number]

export const MUTATION_SOURCES = ["api", "tool", "system", "worker", "maintenance"] as const
export type MutationSource = (typeof MUTATION_SOURCES)[number]

export interface MutationActor {
  type: MutationSource
  id?: string
}

export interface RuntimeMutationEnvelope<TPayload = unknown> {
  id: string
  kind: string
  source: MutationSource
  accountId: string
  sessionId?: string
  floorId?: string
  pageId?: string
  scopeType: string
  scopeKey: string
  applyPhase: MutationApplyPhase
  durability: MutationDurability
  replaySafety: MutationReplaySafety
  conflictPolicy?: MutationConflictPolicy
  idempotencyKey?: string
  payload: TPayload
  createdAt: number
}

export interface MutationApplyContextInput {
  actor?: MutationActor
  requestId?: string
  eventBus?: CoreEventBus
}

export interface MutationApplyContext extends MutationApplyContextInput {
  accountId: string
  db: AppDb
  tx: DbExecutor
  now: () => number
}

export type MutationAfterCommitHook = () => void | Promise<void>

export interface RuntimeMutationApplyRequest<TPayload = unknown> {
  envelope: RuntimeMutationEnvelope<TPayload>
  context: MutationApplyContext
}

export interface RuntimeMutationApplyResult<TResult = unknown> {
  result?: TResult
  afterCommit?: MutationAfterCommitHook[]
}

export interface RuntimeMutationApplier<TPayload = unknown, TResult = unknown> {
  apply(request: RuntimeMutationApplyRequest<TPayload>): RuntimeMutationApplyResult<TResult>
}

export type MutationApplyHandler<TPayload = unknown, TResult = unknown> = (
  request: RuntimeMutationApplyRequest<TPayload>,
) => RuntimeMutationApplyResult<TResult>

export interface AppliedRuntimeMutation<TResult = unknown> {
  envelope: RuntimeMutationEnvelope
  result?: TResult
}

export interface MutationBatchApplyResult {
  appliedCount: number
  mutations: AppliedRuntimeMutation[]
  runAfterCommit(): Promise<void>
}

export interface MutationBatch {
  stage<TPayload>(envelope: RuntimeMutationEnvelope<TPayload>): void
  list(): RuntimeMutationEnvelope[]
  applyInTransaction(tx: DbExecutor, context?: MutationApplyContextInput): MutationBatchApplyResult
}

export interface MutationAsyncEnqueueOptions<TPayload = unknown> {
  jobType?: string
  payload?: TPayload
  availableAt?: number
  maxAttempts?: number
  phase?: string | null
  state?: unknown
  result?: unknown
  dedupeKey?: string | null
  sessionId?: string | null
  floorId?: string | null
  pageId?: string | null
}

export interface MutationAsyncBridge {
  enqueue<TPayload>(
    envelope: RuntimeMutationEnvelope<TPayload>,
    options: MutationAsyncEnqueueOptions<TPayload>,
  ): Promise<EnqueueRuntimeJobResult>
}

export interface MutationRuntime {
  beginBatch(): MutationBatch
  applyInline<TPayload = unknown, TResult = unknown>(
    envelope: RuntimeMutationEnvelope<TPayload>,
    handlerOrContext?: MutationApplyHandler<TPayload, TResult> | MutationApplyContextInput,
    context?: MutationApplyContextInput,
  ): Promise<TResult | undefined>
  enqueueAsync<TPayload = unknown>(
    envelope: RuntimeMutationEnvelope<TPayload>,
    options?: MutationAsyncEnqueueOptions<TPayload>,
  ): Promise<EnqueueRuntimeJobResult>
}
