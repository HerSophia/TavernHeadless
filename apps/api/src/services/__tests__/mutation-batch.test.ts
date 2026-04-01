import { createEventBus } from "@tavern/core"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createDatabase, type DatabaseConnection } from "../../db/client.js"
import { accounts, variables } from "../../db/schema.js"
import { MutationApplierRegistry } from "../mutation-applier-registry.js"
import { DefaultMutationBatch } from "../mutation-batch.js"
import {
  RuntimeMutationApplierNotFoundError,
  RuntimeMutationBatchAlreadyAppliedError,
  RuntimeMutationInvalidPhaseError,
} from "../runtime-mutation-errors.js"
import type { RuntimeMutationEnvelope } from "../runtime-mutation-types.js"

const DEFAULT_ACCOUNT_ID = "default-admin"

type TestVariablePayload = {
  scopeId: string
  key: string
  value: unknown
}

function createCommitEnvelope(args: {
  id: string
  scopeKey: string
  payload: TestVariablePayload
}): RuntimeMutationEnvelope<TestVariablePayload> {
  return {
    id: args.id,
    kind: "test.variable_set",
    source: "system",
    accountId: DEFAULT_ACCOUNT_ID,
    sessionId: args.payload.scopeId,
    scopeType: "variable",
    scopeKey: args.scopeKey,
    applyPhase: "commit",
    durability: "transactional",
    replaySafety: "safe",
    conflictPolicy: "replace",
    payload: args.payload,
    createdAt: 1_736_200_000_000,
  }
}

describe("DefaultMutationBatch", () => {
  let database: DatabaseConnection
  let registry: MutationApplierRegistry
  let afterCommitCalls: string[]

  beforeEach(async () => {
    database = createDatabase(":memory:")
    afterCommitCalls = []
    await database.db.insert(accounts).values({
      id: DEFAULT_ACCOUNT_ID,
      name: DEFAULT_ACCOUNT_ID,
      createdAt: 1_736_200_000_000,
      updatedAt: 1_736_200_000_000,
    }).onConflictDoNothing().run()

    registry = new MutationApplierRegistry()
    registry.register<TestVariablePayload, { variableId: string }>("test.variable_set", {
      apply: ({ envelope, context }) => {
        const insertedId = `${envelope.id}:row`
        const row = context.tx
          .insert(variables)
          .values({
            id: insertedId,
            accountId: envelope.accountId,
            scope: "chat",
            scopeId: envelope.payload.scopeId,
            key: envelope.payload.key,
            valueJson: JSON.stringify(envelope.payload.value),
            updatedAt: context.now(),
          })
          .onConflictDoUpdate({
            target: [variables.accountId, variables.scope, variables.scopeId, variables.key],
            set: {
              valueJson: JSON.stringify(envelope.payload.value),
              updatedAt: context.now(),
            },
          })
          .returning()
          .all()[0]

        if (!row) {
          throw new Error("Failed to write variable during mutation batch test")
        }

        return {
          result: { variableId: row.id },
          afterCommit: [() => {
            afterCommitCalls.push(`${envelope.id}:${envelope.payload.key}`)
          }],
        }
      },
    })
  })

  afterEach(() => {
    database.close()
  })

  it("stages commit mutations in order and applies them inside one transaction", async () => {
    const eventBus = createEventBus()
    const createdEvents: string[] = []
    const appliedEvents: string[] = []
    eventBus.on("runtime.mutation_created", (event) => {
      createdEvents.push(event.mutationId)
    })
    eventBus.on("runtime.mutation_applied", (event) => {
      appliedEvents.push(event.mutationId)
    })
    const batch = new DefaultMutationBatch(database.db, registry, {
      now: () => 1_736_200_000_500,
      eventBus,
    })

    batch.stage(createCommitEnvelope({
      id: "mutation-1",
      scopeKey: "chat:session-a",
      payload: { scopeId: "session-a", key: "mood", value: "calm" },
    }))
    batch.stage(createCommitEnvelope({
      id: "mutation-2",
      scopeKey: "chat:session-a",
      payload: { scopeId: "session-a", key: "hp", value: 42 },
    }))

    await Promise.resolve()
    await Promise.resolve()

    expect(batch.list().map((envelope) => envelope.id)).toEqual(["mutation-1", "mutation-2"])

    const result = database.db.transaction((tx) => batch.applyInTransaction(tx, {
      requestId: "req-batch-1",
    }))

    expect(result.appliedCount).toBe(2)
    expect(result.mutations.map((item) => item.envelope.id)).toEqual(["mutation-1", "mutation-2"])
    expect(result.mutations).toEqual([
      expect.objectContaining({
        envelope: expect.objectContaining({ id: "mutation-1" }),
        result: { variableId: "mutation-1:row" },
      }),
      expect.objectContaining({
        envelope: expect.objectContaining({ id: "mutation-2" }),
        result: { variableId: "mutation-2:row" },
      }),
    ])
    expect(afterCommitCalls).toEqual([])
    expect(createdEvents).toEqual(["mutation-1", "mutation-2"])

    const rowsBeforeAfterCommit = await database.db
      .select()
      .from(variables)

    expect(rowsBeforeAfterCommit).toHaveLength(2)

    await result.runAfterCommit()
    await result.runAfterCommit()

    expect(afterCommitCalls).toEqual(["mutation-1:mood", "mutation-2:hp"])

    await Promise.resolve()
    await Promise.resolve()
    expect(appliedEvents).toEqual(["mutation-1", "mutation-2"])
  })

  it("rejects invalid phases, missing appliers, and reusing an applied batch", () => {
    const batch = new DefaultMutationBatch(database.db, registry)

    expect(() => batch.stage({
      ...createCommitEnvelope({
        id: "mutation-inline",
        scopeKey: "chat:session-a",
        payload: { scopeId: "session-a", key: "mood", value: "calm" },
      }),
      applyPhase: "inline",
    })).toThrow(RuntimeMutationInvalidPhaseError)

    const missingApplierBatch = new DefaultMutationBatch(database.db, new MutationApplierRegistry())
    missingApplierBatch.stage(createCommitEnvelope({
      id: "mutation-missing",
      scopeKey: "chat:session-a",
      payload: { scopeId: "session-a", key: "mood", value: "calm" },
    }))

    expect(() => database.db.transaction((tx) => missingApplierBatch.applyInTransaction(tx))).toThrow(
      RuntimeMutationApplierNotFoundError,
    )

    const appliedBatch = new DefaultMutationBatch(database.db, registry)
    appliedBatch.stage(createCommitEnvelope({
      id: "mutation-applied",
      scopeKey: "chat:session-a",
      payload: { scopeId: "session-a", key: "topic", value: "campfire" },
    }))

    database.db.transaction((tx) => appliedBatch.applyInTransaction(tx))

    expect(() => database.db.transaction((tx) => appliedBatch.applyInTransaction(tx))).toThrow(
      RuntimeMutationBatchAlreadyAppliedError,
    )
  })
})
