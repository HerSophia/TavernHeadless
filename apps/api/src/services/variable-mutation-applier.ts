import { and, asc, eq } from "drizzle-orm"
import { nanoid } from "nanoid"
import type { VariableEntry, VariableScope } from "@tavern/shared"

import { messagePages, variables } from "../db/schema.js"
import { MutationApplierRegistry } from "./mutation-applier-registry.js"
import { RuntimeMutationError } from "./runtime-mutation-errors.js"
import type {
  RuntimeMutationApplier,
  RuntimeMutationApplyRequest,
} from "./runtime-mutation-types.js"
import { VariableServiceError } from "./variable-service-errors.js"

export const VARIABLE_MUTATION_KINDS = {
  set: "variable.set",
  delete: "variable.delete",
  promotePageToFloor: "variable.promote_page_to_floor",
} as const

export type VariableMutationKind = (typeof VARIABLE_MUTATION_KINDS)[keyof typeof VARIABLE_MUTATION_KINDS]
export type VariablePromotionPolicy = "replace" | "ifAbsent"

type VariableRow = typeof variables.$inferSelect

export interface VariableCommitInput {
  accountId?: string
  pageId?: string
  floorId: string
  sessionId: string
  policy?: VariablePromotionPolicy
  committedAt?: number
}

export interface VariableCommitResult {
  pageId?: string
  floorId: string
  sessionId: string
  fromScope: "page"
  toScope: "floor"
  policy: VariablePromotionPolicy
  scannedCount: number
  promotedCount: number
  skippedCount: number
  promotedVariables: VariableEntry[]
}

export interface VariableSetMutationItem {
  index?: number
  id?: string
  accountId?: string
  scope: VariableScope
  scopeId: string
  key: string
  valueJson: string
  updatedAt: number
  sessionId?: string
  branchId?: string
}

export interface VariableSetMutationPayload {
  items: VariableSetMutationItem[]
  emitEvents?: boolean
}

export interface VariableSetMutationResultItem {
  index: number
  action: "created" | "updated"
  variable: VariableEntry
  sessionId?: string
  branchId?: string
}

export interface VariableSetMutationResult {
  results: VariableSetMutationResultItem[]
  meta: {
    total: number
    created: number
    updated: number
  }
}

export interface VariableDeleteMutationPayload {
  id: string
  accountId?: string
  scope: VariableScope
  scopeId?: string
  key: string
  sessionId?: string
  branchId?: string
  emitEvent?: boolean
}

export interface VariableDeleteMutationResult {
  id: string
  deleted: true
}

export type VariablePromotePageToFloorMutationPayload = VariableCommitInput

function toVariableEntry(row: VariableRow): VariableEntry {
  return {
    id: row.id,
    scope: row.scope,
    scopeId: row.scopeId,
    key: row.key,
    value: JSON.parse(row.valueJson),
    updatedAt: row.updatedAt,
  }
}

function createEmptyCommitResult(
  input: VariablePromotePageToFloorMutationPayload,
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

function buildPromotedRow(args: {
  sourceRow: VariableRow
  floorId: string
  committedAt: number
  existingId?: string
}): typeof variables.$inferInsert {
  return {
    id: args.existingId ?? nanoid(),
    accountId: args.sourceRow.accountId,
    scope: "floor",
    scopeId: args.floorId,
    key: args.sourceRow.key,
    valueJson: args.sourceRow.valueJson,
    updatedAt: args.committedAt,
  }
}

function isVariableSetRequest(
  request: RuntimeMutationApplyRequest<unknown>,
): request is RuntimeMutationApplyRequest<VariableSetMutationPayload> {
  return request.envelope.kind === VARIABLE_MUTATION_KINDS.set
}

function isVariableDeleteRequest(
  request: RuntimeMutationApplyRequest<unknown>,
): request is RuntimeMutationApplyRequest<VariableDeleteMutationPayload> {
  return request.envelope.kind === VARIABLE_MUTATION_KINDS.delete
}

function isVariablePromoteRequest(
  request: RuntimeMutationApplyRequest<unknown>,
): request is RuntimeMutationApplyRequest<VariablePromotePageToFloorMutationPayload> {
  return request.envelope.kind === VARIABLE_MUTATION_KINDS.promotePageToFloor
}

export class VariableMutationApplier implements RuntimeMutationApplier<unknown, unknown> {
  apply(request: RuntimeMutationApplyRequest<unknown>) {
    if (isVariableSetRequest(request)) {
      return this.applySet(request)
    }

    if (isVariableDeleteRequest(request)) {
      return this.applyDelete(request)
    }

    if (isVariablePromoteRequest(request)) {
      return this.applyPromotePageToFloor(request)
    }

    throw new RuntimeMutationError(`Unsupported variable mutation kind: ${request.envelope.kind}`)
  }

  private applySet(request: RuntimeMutationApplyRequest<VariableSetMutationPayload>) {
    let created = 0
    let updated = 0

    const results = request.envelope.payload.items.map((item, index) => {
      const insertedId = item.id ?? nanoid()
      const row = request.context.tx
        .insert(variables)
        .values({
          id: insertedId,
          accountId: item.accountId ?? request.envelope.accountId,
          scope: item.scope,
          scopeId: item.scopeId,
          key: item.key,
          valueJson: item.valueJson,
          updatedAt: item.updatedAt,
        })
        .onConflictDoUpdate({
          target: [variables.accountId, variables.scope, variables.scopeId, variables.key],
          set: {
            valueJson: item.valueJson,
            updatedAt: item.updatedAt,
          },
        })
        .returning()
        .all()[0]

      if (!row) {
        throw new RuntimeMutationError("Failed to upsert variable")
      }

      const action: VariableSetMutationResultItem["action"] = row.id === insertedId ? "created" : "updated"
      if (action === "created") {
        created += 1
      } else {
        updated += 1
      }

      return {
        index: item.index ?? index,
        action,
        variable: toVariableEntry(row),
        sessionId: item.sessionId,
        branchId: item.branchId,
      } satisfies VariableSetMutationResultItem
    })

    return {
      result: {
        results,
        meta: {
          total: results.length,
          created,
          updated,
        },
      } satisfies VariableSetMutationResult,
      afterCommit: request.envelope.payload.emitEvents && request.context.eventBus
        ? results.map((item) => async () => {
          await request.context.eventBus!.emit("variable.set", {
            ...(item.sessionId ? { sessionId: item.sessionId } : {}),
            ...(item.branchId ? { branchId: item.branchId } : {}),
            entry: item.variable,
            isNew: item.action === "created",
          })
        })
        : undefined,
    }
  }

  private applyDelete(request: RuntimeMutationApplyRequest<VariableDeleteMutationPayload>) {
    const deleted = request.context.tx
      .delete(variables)
      .where(and(
        eq(variables.scope, request.envelope.payload.scope),
        eq(variables.key, request.envelope.payload.key),
        eq(variables.accountId, request.envelope.payload.accountId ?? request.envelope.accountId),
        ...(request.envelope.payload.scopeId
          ? [eq(variables.scopeId, request.envelope.payload.scopeId)]
          : []),
      ))
      .returning({ id: variables.id })
      .all()

    if (deleted.length === 0) {
      throw new VariableServiceError(
        "variable_not_found",
        `Variable '${request.envelope.payload.scope}:${request.envelope.payload.scopeId ?? "*"}:${request.envelope.payload.key}' not found`,
      )
    }

    return {
      result: {
        id: request.envelope.payload.id,
        deleted: true,
      } satisfies VariableDeleteMutationResult,
      afterCommit: request.envelope.payload.emitEvent && request.context.eventBus
        ? [async () => {
          await request.context.eventBus!.emit("variable.deleted", {
            ...(request.envelope.payload.sessionId ? { sessionId: request.envelope.payload.sessionId } : {}),
            ...(request.envelope.payload.branchId ? { branchId: request.envelope.payload.branchId } : {}),
            id: request.envelope.payload.id,
            scope: request.envelope.payload.scope,
            key: request.envelope.payload.key,
          })
        }]
        : undefined,
    }
  }

  private applyPromotePageToFloor(
    request: RuntimeMutationApplyRequest<VariablePromotePageToFloorMutationPayload>,
  ) {
    const policy = request.envelope.payload.policy ?? "replace"
    if (!request.envelope.payload.pageId) {
      return {
        result: createEmptyCommitResult(request.envelope.payload, policy),
      }
    }

    const inputPage = request.context.tx
      .select({ id: messagePages.id })
      .from(messagePages)
      .where(and(
        eq(messagePages.id, request.envelope.payload.pageId),
        eq(messagePages.floorId, request.envelope.payload.floorId),
        eq(messagePages.pageKind, "input"),
      ))
      .limit(1)
      .all()[0]

    if (!inputPage) {
      throw new RuntimeMutationError(
        `Input page '${request.envelope.payload.pageId}' was not found on floor '${request.envelope.payload.floorId}'`,
      )
    }

    const sourceRows = request.context.tx
      .select()
      .from(variables)
      .where(and(
        eq(variables.scope, "page"),
        eq(variables.scopeId, request.envelope.payload.pageId),
      ))
      .orderBy(asc(variables.key), asc(variables.id))
      .all()

    if (sourceRows.length === 0) {
      return {
        result: createEmptyCommitResult(request.envelope.payload, policy),
      }
    }

    const targetRows = request.context.tx
      .select()
      .from(variables)
      .where(and(
        eq(variables.scope, "floor"),
        eq(variables.scopeId, request.envelope.payload.floorId),
      ))
      .all()

    const targetsByKey = new Map(targetRows.map((row) => [row.key, row]))
    const promotedVariables: VariableEntry[] = []
    let skippedCount = 0
    const committedAt = request.envelope.payload.committedAt ?? request.context.now()

    for (const sourceRow of sourceRows) {
      const existingTarget = targetsByKey.get(sourceRow.key)
      if (policy === "ifAbsent" && existingTarget) {
        skippedCount += 1
        continue
      }

      const promotedRow = buildPromotedRow({
        sourceRow,
        floorId: request.envelope.payload.floorId,
        committedAt,
        existingId: existingTarget?.id,
      })

      request.context.tx
        .insert(variables)
        .values(promotedRow)
        .onConflictDoUpdate({
          target: [variables.accountId, variables.scope, variables.scopeId, variables.key],
          set: {
            valueJson: promotedRow.valueJson,
            updatedAt: promotedRow.updatedAt,
          },
        })
        .run()

      targetsByKey.set(sourceRow.key, promotedRow as VariableRow)
      promotedVariables.push(toVariableEntry(promotedRow as VariableRow))
    }

    return {
      result: {
        pageId: request.envelope.payload.pageId,
        floorId: request.envelope.payload.floorId,
        sessionId: request.envelope.payload.sessionId,
        fromScope: "page",
        toScope: "floor",
        policy,
        scannedCount: sourceRows.length,
        promotedCount: promotedVariables.length,
        skippedCount,
        promotedVariables,
      } satisfies VariableCommitResult,
    }
  }
}

export function registerVariableMutationAppliers(
  registry: MutationApplierRegistry,
  applier: VariableMutationApplier = new VariableMutationApplier(),
): VariableMutationApplier {
  registry.register(VARIABLE_MUTATION_KINDS.set, applier as RuntimeMutationApplier<unknown, unknown>)
  registry.register(VARIABLE_MUTATION_KINDS.delete, applier as RuntimeMutationApplier<unknown, unknown>)
  registry.register(VARIABLE_MUTATION_KINDS.promotePageToFloor, applier as RuntimeMutationApplier<unknown, unknown>)
  return applier
}
