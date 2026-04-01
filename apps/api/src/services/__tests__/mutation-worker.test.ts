
import { createEventBus } from "@tavern/core"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createDatabase, type DatabaseConnection } from "../../db/client.js"
import { accounts, runtimeJobs, sessions, variables } from "../../db/schema.js"
import { createDefaultMutationApplierRegistry } from "../default-mutation-runtime.js"
import { createMutationRuntimeJobBridge } from "../mutation-runtime-job-bridge.js"
import { MutationWorker } from "../mutation-worker.js"
import { VARIABLE_MUTATION_KINDS, type VariableSetMutationPayload } from "../variable-mutation-applier.js"
import type { RuntimeMutationEnvelope } from "../runtime-mutation-types.js"

const DEFAULT_ACCOUNT_ID = "default-admin"

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe("MutationWorker", () => {
  let database: DatabaseConnection

  beforeEach(async () => {
    database = createDatabase(":memory:")
    await database.db.insert(accounts).values({
      id: DEFAULT_ACCOUNT_ID,
      name: DEFAULT_ACCOUNT_ID,
      createdAt: 1_736_300_100_000,
      updatedAt: 1_736_300_100_000,
    }).onConflictDoNothing().run()
    await database.db.insert(sessions).values({
      id: "session-async",
      title: "Mutation Worker Session",
      accountId: DEFAULT_ACCOUNT_ID,
      status: "active",
      createdAt: 1_736_300_100_000,
      updatedAt: 1_736_300_100_000,
    }).onConflictDoNothing().run()
  })

  afterEach(() => {
    database.close()
  })

  it("applies queued async mutations through RuntimeWorker", async () => {
    const eventBus = createEventBus()
    const createdEvents: string[] = []
    const appliedEvents: string[] = []
    eventBus.on("runtime.mutation_created", (event) => {
      createdEvents.push(event.mutationId)
    })
    eventBus.on("runtime.mutation_applied", (event) => {
      appliedEvents.push(event.mutationId)
    })

    const bridge = createMutationRuntimeJobBridge(database.db, { eventBus })
    const worker = new MutationWorker(database.db, createDefaultMutationApplierRegistry(), { eventBus })

    const envelope: RuntimeMutationEnvelope<VariableSetMutationPayload> = {
      id: "mutation:async:variable-set",
      kind: VARIABLE_MUTATION_KINDS.set,
      source: "worker",
      accountId: DEFAULT_ACCOUNT_ID,
      sessionId: "session-async",
      scopeType: "variable",
      scopeKey: "chat:session-async",
      applyPhase: "async",
      durability: "durable_job",
      replaySafety: "safe",
      conflictPolicy: "replace",
      payload: {
        items: [{
          scope: "chat",
          scopeId: "session-async",
          key: "mood",
          valueJson: JSON.stringify("steady"),
          updatedAt: 1_736_300_100_500,
          sessionId: "session-async",
        }],
        emitEvents: false,
      },
      createdAt: 1_736_300_100_500,
    }

    await bridge.enqueue(envelope)
    await flushMicrotasks()
    expect(createdEvents).toEqual(["mutation:async:variable-set"])

    const processed = await worker.processOneDueJob()
    expect(processed).toBe(true)

    const [variable] = await database.db
      .select()
      .from(variables)

    expect(variable).toMatchObject({
      accountId: DEFAULT_ACCOUNT_ID,
      scope: "chat",
      scopeId: "session-async",
      key: "mood",
      updatedAt: 1_736_300_100_500,
    })
    expect(JSON.parse(variable!.valueJson)).toBe("steady")

    const [job] = await database.db
      .select()
      .from(runtimeJobs)

    expect(job).toMatchObject({
      id: "mutation-job:variable.set:mutation:async:variable-set",
      status: "succeeded",
      attemptCount: 1,
      progressCurrent: 1,
      progressTotal: 1,
      progressMessage: "mutation applied",
    })

    await flushMicrotasks()
    expect(appliedEvents).toEqual(["mutation:async:variable-set"])
  })
})
