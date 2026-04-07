import type { BufferedToolVariableMutation, CoreEventBus } from "@tavern/core"

import type { AccountContextOptions } from "../accounts/account-context.js"
import { resolveAccountIdOrThrow } from "../accounts/account-context.js"
import type { AppDb, DbExecutor } from "../db/client.js"
import { MutationApplierRegistry } from "./mutation-applier-registry.js"
import { DefaultMutationBatch } from "./mutation-batch.js"
import type { MutationBatch, MutationRuntime } from "./runtime-mutation-types.js"
import {
  VARIABLE_MUTATION_KINDS,
  registerVariableMutationAppliers,
  type VariableCommitInput,
  type VariableCommitResult,
  type VariablePromotePageToFloorMutationPayload,
  type VariablePromotionPolicy,
  type VariableSetMutationPayload,
} from "./variable-mutation-applier.js"

export type { VariableCommitInput, VariableCommitResult, VariablePromotionPolicy }

export interface VariableCommitServiceOptions {
  db?: AppDb
  mutationRuntime?: MutationRuntime
  eventBus?: CoreEventBus
  now?: () => number
}

function createEmptyResult(
  input: VariableCommitInput,
  policy: VariablePromotionPolicy,
): VariableCommitResult {
  return {
    pageId: input.pageId,
    floorId: input.floorId,
    sessionId: input.sessionId,
    fromScope: "page",
    toScope: "floor",
    policy,
    scannedCount: 0,
    promotedCount: 0,
    skippedCount: 0,
    promotedVariables: [],
  }
}

function buildBufferedMutationEnvelopeId(mutation: BufferedToolVariableMutation): string {
  return `variable-set:${mutation.runId}:${mutation.generationAttemptNo}:${mutation.scope}:${mutation.scopeId}:${mutation.key}`
}

function buildPromotionEnvelopeId(input: VariableCommitInput): string {
  return `variable-promote:${input.floorId}:${input.pageId ?? "none"}`
}

export class VariableCommitService {
  private readonly mutationRuntime?: MutationRuntime
  private readonly registry: MutationApplierRegistry
  private readonly eventBus?: CoreEventBus
  private readonly now: () => number
  private readonly db?: AppDb
  private readonly accountContext: AccountContextOptions

  constructor(options: VariableCommitServiceOptions & AccountContextOptions = {}) {
    this.mutationRuntime = options.mutationRuntime
    this.registry = new MutationApplierRegistry()
    registerVariableMutationAppliers(this.registry)
    this.eventBus = options.eventBus
    this.now = options.now ?? Date.now
    this.db = options.db
    this.accountContext = {
      accountMode: options.accountMode,
      defaultAccountId: options.defaultAccountId,
    }
  }

  beginBatch(): MutationBatch {
    if (this.mutationRuntime) {
      return this.mutationRuntime.beginBatch()
    }

    if (!this.db) {
      throw new Error("VariableCommitService.beginBatch requires an AppDb or mutationRuntime")
    }

    return new DefaultMutationBatch(this.db, this.registry, {
      eventBus: this.eventBus,
      now: this.now,
    })
  }

  stageBufferedMutations(
    batch: MutationBatch,
    args: {
      mutations: BufferedToolVariableMutation[] | undefined
      committedAt: number
      accountId?: string
    },
  ): void {
    for (const mutation of args.mutations ?? []) {
      const accountId = resolveAccountIdOrThrow(mutation.accountId ?? args.accountId, this.accountContext)
      const payload: VariableSetMutationPayload = {
        items: [{
          scope: mutation.scope,
          scopeId: mutation.scopeId,
          key: mutation.key,
          valueJson: JSON.stringify(mutation.value),
          updatedAt: args.committedAt,
          accountId,
        }],
        emitEvents: false,
      }

      batch.stage({
        id: buildBufferedMutationEnvelopeId(mutation),
        kind: VARIABLE_MUTATION_KINDS.set,
        source: "tool",
        accountId,
        scopeType: "variable",
        scopeKey: `${mutation.scope}:${mutation.scopeId}`,
        applyPhase: "commit",
        durability: "transactional",
        replaySafety: "safe",
        conflictPolicy: "replace",
        payload,
        createdAt: args.committedAt,
      })
    }
  }

  stagePromotion(batch: MutationBatch, input: VariableCommitInput): void {
    const accountId = resolveAccountIdOrThrow(input.accountId, this.accountContext)
    const payload: VariablePromotePageToFloorMutationPayload = {
      accountId,
      pageId: input.pageId,
      floorId: input.floorId,
      sessionId: input.sessionId,
      policy: input.policy,
      committedAt: input.committedAt,
    }
    const conflictPolicy = input.policy === "ifAbsent"
      ? "if_absent"
      : "replace"

    batch.stage({
      id: buildPromotionEnvelopeId(input),
      kind: VARIABLE_MUTATION_KINDS.promotePageToFloor,
      source: "system",
      accountId,
      sessionId: input.sessionId,
      floorId: input.floorId,
      pageId: input.pageId,
      scopeType: "variable",
      scopeKey: `floor:${input.floorId}`,
      applyPhase: "commit",
      durability: "transactional",
      replaySafety: "safe",
      conflictPolicy,
      payload,
      createdAt: input.committedAt ?? this.now(),
    })
  }

  flushBufferedMutations(
    mutations: BufferedToolVariableMutation[] | undefined,
    tx: DbExecutor,
    committedAt: number,
    accountId?: string,
  ): void {
    const resolvedAccountId = resolveAccountIdOrThrow(accountId, this.accountContext)
    const batch = this.createTransactionBatch(tx)
    this.stageBufferedMutations(batch, {
      mutations,
      committedAt,
      accountId: resolvedAccountId,
    })
    batch.applyInTransaction(tx)
  }

  promoteAll(input: VariableCommitInput, tx: DbExecutor): VariableCommitResult {
    const batch = this.createTransactionBatch(tx)
    this.stagePromotion(batch, input)
    const applied = batch.applyInTransaction(tx)
    const result = applied.mutations[0]?.result as VariableCommitResult | undefined
    return result ?? createEmptyResult(input, input.policy ?? "replace")
  }

  private createTransactionBatch(tx: DbExecutor): MutationBatch {
    if (this.mutationRuntime) {
      return this.mutationRuntime.beginBatch()
    }

    return new DefaultMutationBatch(tx as unknown as AppDb, this.registry, {
      eventBus: this.eventBus,
      now: this.now,
    })
  }
}
