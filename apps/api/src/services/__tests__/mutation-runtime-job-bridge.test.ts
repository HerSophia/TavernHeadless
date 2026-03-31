import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createDatabase, type DatabaseConnection } from "../../db/client.js"
import { accounts, runtimeJobs, sessions } from "../../db/schema.js"
import { createMutationRuntimeJobBridge } from "../mutation-runtime-job-bridge.js"
import { MUTATION_RUNTIME_JOB_TYPES } from "../mutation-runtime-job-definitions.js"
import type { RuntimeMutationEnvelope } from "../runtime-mutation-types.js"

const DEFAULT_ACCOUNT_ID = "default-admin"

describe("MutationRuntimeJobBridge", () => {
  let database: DatabaseConnection

  beforeEach(async () => {
    database = createDatabase(":memory:")
    await database.db.insert(accounts).values({
      id: DEFAULT_ACCOUNT_ID,
      name: DEFAULT_ACCOUNT_ID,
      createdAt: 1_736_300_000_000,
      updatedAt: 1_736_300_000_000,
    }).onConflictDoNothing().run()
    await database.db.insert(sessions).values({
      id: "session-a",
      title: "Mutation Bridge Session",
      accountId: DEFAULT_ACCOUNT_ID,
      status: "active",
      createdAt: 1_736_300_000_000,
      updatedAt: 1_736_300_000_000,
    }).onConflictDoNothing().run()
  })

  afterEach(() => {
    database.close()
  })

  it("enqueues async mutation envelopes into runtime_job", async () => {
    const bridge = createMutationRuntimeJobBridge(database.db)
    const envelope: RuntimeMutationEnvelope<{ value: string }> = {
      id: "mutation:async:bridge",
      kind: "test.async",
      source: "system",
      accountId: DEFAULT_ACCOUNT_ID,
      sessionId: "session-a",
      scopeType: "variable",
      scopeKey: "chat:session-a",
      applyPhase: "async",
      durability: "durable_job",
      replaySafety: "safe",
      payload: { value: "background" },
      createdAt: 1_736_300_000_500,
    }

    const result = await bridge.enqueue(envelope, {
      dedupeKey: "mutation:async:bridge:dedupe",
      phase: "apply",
    })

    expect(result).toEqual({
      jobId: "mutation-job:test.async:mutation:async:bridge",
      created: true,
      dedupeKey: "mutation:async:bridge:dedupe",
    })

    const [row] = await database.db
      .select()
      .from(runtimeJobs)

    expect(row).toMatchObject({
      id: "mutation-job:test.async:mutation:async:bridge",
      jobType: MUTATION_RUNTIME_JOB_TYPES.apply,
      accountId: DEFAULT_ACCOUNT_ID,
      scopeType: "variable",
      scopeKey: "chat:session-a",
      sessionId: "session-a",
      status: "pending",
      phase: "apply",
      dedupeKey: "mutation:async:bridge:dedupe",
    })
    expect(JSON.parse(row!.payloadJson)).toEqual({
      envelope,
    })
  })
})
