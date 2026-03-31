import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createDatabase, type DatabaseConnection } from "../../db/client.js"
import { accounts, variables } from "../../db/schema.js"
import { MutationApplierRegistry } from "../mutation-applier-registry.js"
import { DefaultMutationRuntime } from "../mutation-runtime.js"
import {
  RuntimeMutationAsyncBridgeUnavailableError,
  RuntimeMutationInvalidPhaseError,
} from "../runtime-mutation-errors.js"
import type {
  MutationAsyncBridge,
  MutationAsyncEnqueueOptions,
  RuntimeMutationEnvelope,
} from "../runtime-mutation-types.js"

const DEFAULT_ACCOUNT_ID = "default-admin"

type InlineVariablePayload = {
  scopeId: string
  key: string
  value: unknown
}

function createInlineEnvelope(
  payload: InlineVariablePayload,
): RuntimeMutationEnvelope<InlineVariablePayload> {
  return {
    id: `mutation:${payload.key}`,
    kind: "test.variable_set",
    source: "api",
    accountId: DEFAULT_ACCOUNT_ID,
    sessionId: payload.scopeId,
    scopeType: "variable",
    scopeKey: `chat:${payload.scopeId}`,
    applyPhase: "inline",
    durability: "transactional",
    replaySafety: "safe",
    conflictPolicy: "replace",
    payload,
    createdAt: 1_736_210_000_000,
  }
}

function createAsyncEnvelope(): RuntimeMutationEnvelope<{ value: string }> {
  return {
    id: "mutation:async",
    kind: "test.async",
    source: "system",
    accountId: DEFAULT_ACCOUNT_ID,
    scopeType: "variable",
    scopeKey: "chat:session-a",
    applyPhase: "async",
    durability: "durable_job",
    replaySafety: "safe",
    payload: { value: "background" },
    createdAt: 1_736_210_000_000,
  }
}

describe("DefaultMutationRuntime", () => {
  let database: DatabaseConnection
  let registry: MutationApplierRegistry

  beforeEach(async () => {
    database = createDatabase(":memory:")
    await database.db.insert(accounts).values({
      id: DEFAULT_ACCOUNT_ID,
      name: DEFAULT_ACCOUNT_ID,
      createdAt: 1_736_210_000_000,
      updatedAt: 1_736_210_000_000,
    }).onConflictDoNothing().run()

    registry = new MutationApplierRegistry()
    registry.register<InlineVariablePayload, { variableId: string }>("test.variable_set", {
      apply: ({ envelope, context }) => {
        const row = context.tx
          .insert(variables)
          .values({
            id: `${envelope.id}:row`,
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
          throw new Error("Failed to write variable during inline mutation test")
        }

        return {
          result: { variableId: row.id },
          afterCommit: [async () => {
            const committedRows = await context.db
              .select()
              .from(variables)

            expect(committedRows.map((item) => item.key)).toContain(envelope.payload.key)
          }],
        }
      },
    })
  })

  afterEach(() => {
    database.close()
  })

  it("creates isolated commit batches from beginBatch", () => {
    const runtime = new DefaultMutationRuntime(database.db, { registry })

    const first = runtime.beginBatch()
    const second = runtime.beginBatch()

    first.stage({
      ...createInlineEnvelope({ scopeId: "session-a", key: "mood", value: "calm" }),
      id: "mutation:batch",
      applyPhase: "commit",
    })

    expect(first.list()).toHaveLength(1)
    expect(second.list()).toHaveLength(0)
  })

  it("applies inline mutations inside a transaction and runs after-commit hooks", async () => {
    const runtime = new DefaultMutationRuntime(database.db, {
      registry,
      now: () => 1_736_210_000_500,
    })

    const result = await runtime.applyInline<{ scopeId: string; key: string; value: unknown }, { variableId: string }>(
      createInlineEnvelope({
        scopeId: "session-a",
        key: "mood",
        value: "focused",
      }),
      { requestId: "req-inline-1" },
    )

    expect(result).toEqual({ variableId: "mutation:mood:row" })

    const rows = await database.db
      .select()
      .from(variables)

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      key: "mood",
      scope: "chat",
      scopeId: "session-a",
      updatedAt: 1_736_210_000_500,
    })
    expect(JSON.parse(rows[0]!.valueJson)).toBe("focused")
  })

  it("rejects invalid inline phases and requires an explicit async bridge", async () => {
    const runtime = new DefaultMutationRuntime(database.db, { registry })

    await expect(runtime.applyInline({
      ...createInlineEnvelope({ scopeId: "session-a", key: "mood", value: "calm" }),
      applyPhase: "commit",
    })).rejects.toBeInstanceOf(RuntimeMutationInvalidPhaseError)

    await expect(runtime.enqueueAsync(createAsyncEnvelope())).rejects.toBeInstanceOf(
      RuntimeMutationAsyncBridgeUnavailableError,
    )
  })

  it("delegates async enqueue to the configured bridge", async () => {
    const enqueueMock = vi.fn(async (
      envelope: RuntimeMutationEnvelope<unknown>,
      options: MutationAsyncEnqueueOptions<unknown>,
    ) => ({
      jobId: `${envelope.id}:job`,
      created: true,
      dedupeKey: options.dedupeKey ?? null,
    }))
    const bridge: MutationAsyncBridge = { enqueue: enqueueMock as MutationAsyncBridge["enqueue"] }
    const runtime = new DefaultMutationRuntime(database.db, {
      registry,
      asyncBridge: bridge,
    })

    const envelope = createAsyncEnvelope()
    const result = await runtime.enqueueAsync(envelope, {
      dedupeKey: "mutation:async:dedupe",
    })

    expect(enqueueMock).toHaveBeenCalledWith(envelope, {
      dedupeKey: "mutation:async:dedupe",
    })
    expect(result).toEqual({
      jobId: "mutation:async:job",
      created: true,
      dedupeKey: "mutation:async:dedupe",
    })
  })
})
