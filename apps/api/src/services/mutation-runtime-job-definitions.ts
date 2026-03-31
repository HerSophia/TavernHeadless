import { z } from "zod"

import { RuntimeJobCatalog } from "./runtime-job-catalog.js"
import {
  MUTATION_APPLY_PHASES,
  MUTATION_CONFLICT_POLICIES,
  MUTATION_DURABILITIES,
  MUTATION_REPLAY_SAFETIES,
  MUTATION_SOURCES,
} from "./runtime-mutation-types.js"

export const MUTATION_RUNTIME_JOB_TYPES = {
  apply: "mutation.apply",
} as const

export const runtimeMutationEnvelopeSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  source: z.enum(MUTATION_SOURCES),
  accountId: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  floorId: z.string().min(1).optional(),
  pageId: z.string().min(1).optional(),
  scopeType: z.string().min(1),
  scopeKey: z.string().min(1),
  applyPhase: z.enum(MUTATION_APPLY_PHASES),
  durability: z.enum(MUTATION_DURABILITIES),
  replaySafety: z.enum(MUTATION_REPLAY_SAFETIES),
  conflictPolicy: z.enum(MUTATION_CONFLICT_POLICIES).optional(),
  idempotencyKey: z.string().min(1).optional(),
  payload: z.unknown(),
  createdAt: z.number().int(),
})

export const mutationApplyJobPayloadSchema = z.object({
  envelope: runtimeMutationEnvelopeSchema,
})

export type MutationApplyJobPayload = z.infer<typeof mutationApplyJobPayloadSchema>

export function createMutationRuntimeJobCatalog(): RuntimeJobCatalog {
  const catalog = new RuntimeJobCatalog()

  catalog.register<MutationApplyJobPayload>({
    jobType: MUTATION_RUNTIME_JOB_TYPES.apply,
    payloadSchema: mutationApplyJobPayloadSchema,
    defaultMaxAttempts: 5,
    initialPhase: "apply",
    createJobId({ payload }) {
      return `mutation-job:${payload.envelope.kind}:${payload.envelope.id}`
    },
  })

  return catalog
}
