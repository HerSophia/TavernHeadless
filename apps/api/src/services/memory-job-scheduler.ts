import { nanoid } from "nanoid";
import { z } from "zod";
import {
  MEMORY_SCOPES,
  type MemoryJobType,
  type MemoryScope,
} from "@tavern/shared";

import type { DbExecutor } from "../db/client.js";
import { memoryJobs } from "../db/schema.js";
import type { MemoryMaintenancePolicy } from "./memory-maintenance-service.js";

const memoryScopeSchema = z.enum(MEMORY_SCOPES);

const memoryMaintenancePolicySchema = z.object({
  summaryMaxAgeMs: z.number().int().positive().optional(),
  openLoopMaxAgeMs: z.number().int().positive().optional(),
  deprecatedPurgeAgeMs: z.number().int().positive().optional(),
});

const memoryIngestTurnJobPayloadSchema = z.object({
  accountId: z.string().min(1),
  sessionId: z.string().min(1),
  floorId: z.string().min(1),
  floorNo: z.number().int().nonnegative(),
  assistantMessageId: z.string().min(1),
  userInputDigest: z.string().min(1),
  committedAt: z.number().int(),
  summaries: z.array(z.string()).default([]),
  enableConsolidation: z.boolean().default(false),
});

const memoryCompactMacroJobPayloadSchema = z.object({
  accountId: z.string().min(1),
  scope: memoryScopeSchema,
  scopeId: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  sourceMicroIds: z.array(z.string().min(1)).min(1),
  coverageStartFloorNo: z.number().int().nonnegative().optional(),
  coverageEndFloorNo: z.number().int().nonnegative().optional(),
  triggerFloorId: z.string().min(1).optional(),
  committedAt: z.number().int(),
  force: z.boolean().default(false),
});

const memoryMaintenanceJobPayloadSchema = z.object({
  accountId: z.string().min(1),
  scope: memoryScopeSchema,
  scopeId: z.string().min(1),
  scheduleBucket: z.number().int().nonnegative(),
  scheduledAt: z.number().int(),
  batchSize: z.number().int().positive().optional(),
  dryRun: z.boolean().default(false),
  policy: memoryMaintenancePolicySchema.optional(),
});

const memoryRebuildScopeJobPayloadSchema = z.object({
  accountId: z.string().min(1),
  scope: memoryScopeSchema,
  scopeId: z.string().min(1),
  triggerFloorId: z.string().min(1).optional(),
  committedAt: z.number().int(),
  forceCompaction: z.boolean().default(true),
});

export type MemoryIngestTurnJobPayload = z.infer<typeof memoryIngestTurnJobPayloadSchema>;
export type MemoryCompactMacroJobPayload = z.infer<typeof memoryCompactMacroJobPayloadSchema>;
export type MemoryMaintenanceJobPayload = z.infer<typeof memoryMaintenanceJobPayloadSchema>;
export type MemoryRebuildScopeJobPayload = z.infer<typeof memoryRebuildScopeJobPayloadSchema>;

export interface EnqueueIngestTurnJobInput extends MemoryIngestTurnJobPayload {
  maxAttempts?: number;
}

export interface EnqueueCompactMacroJobInput extends MemoryCompactMacroJobPayload {
  maxAttempts?: number;
}

export interface EnqueueMaintenanceJobInput extends MemoryMaintenanceJobPayload {
  maxAttempts?: number;
}

export interface EnqueueRebuildScopeJobInput extends MemoryRebuildScopeJobPayload {
  maxAttempts?: number;
  seed?: string;
}

export interface EnqueueMemoryJobResult {
  jobId: string;
  created: boolean;
}

export class MemoryJobPayloadParseError extends Error {
  constructor(
    public readonly jobId: string,
    public readonly jobType: MemoryJobType,
    public readonly issues: string[],
  ) {
    super(`Invalid payload for memory job '${jobId}' (${jobType}): ${issues.join("; ")}`);
    this.name = "MemoryJobPayloadParseError";
  }
}

export function makeIngestTurnJobId(floorId: string): string {
  return `memory-job:ingest_turn:${floorId}`;
}

export function makeCompactMacroJobId(scope: MemoryScope, scopeId: string, sourceSeed: string): string {
  if (scope === "chat") {
    return `memory-job:compact_macro:${scopeId}:${sourceSeed}`;
  }

  return `memory-job:compact_macro:${scope}:${scopeId}:${sourceSeed}`;
}

export function makeMaintenanceJobId(
  accountId: string,
  scope: MemoryScope,
  scopeId: string,
  scheduleBucket: number,
): string {
  return `memory-job:maintenance:${accountId}:${scope}:${scopeId}:${scheduleBucket}`;
}

export function makeRebuildScopeJobId(
  scope: MemoryScope,
  scopeId: string,
  seed: string,
): string {
  return `memory-job:rebuild_scope:${scope}:${scopeId}:${seed}`;
}

function insertJob(
  tx: DbExecutor,
  values: typeof memoryJobs.$inferInsert,
): EnqueueMemoryJobResult {
  const insertResult = tx.insert(memoryJobs)
    .values(values)
    .onConflictDoNothing()
    .run();

  return {
    jobId: values.id,
    created: insertResult.changes === 1,
  };
}

function parsePayload<T>(
  job: { id: string; jobType: MemoryJobType; payloadJson: string },
  schema: z.ZodTypeAny,
): T {
  let payload: unknown;
  try {
    payload = JSON.parse(job.payloadJson);
  } catch (error) {
    throw new MemoryJobPayloadParseError(
      job.id,
      job.jobType,
      [error instanceof Error ? error.message : String(error)],
    );
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new MemoryJobPayloadParseError(
      job.id,
      job.jobType,
      parsed.error.issues.map((issue) => `${issue.path.join(".") || "payload"}: ${issue.message}`),
    );
  }

  return parsed.data as T;
}

export class MemoryJobScheduler {
  enqueueIngestTurn(
    tx: DbExecutor,
    input: EnqueueIngestTurnJobInput,
  ): EnqueueMemoryJobResult {
    const payload = memoryIngestTurnJobPayloadSchema.parse(input);
    const jobId = makeIngestTurnJobId(payload.floorId);
    const timestamp = payload.committedAt;

    return insertJob(tx, {
      id: jobId,
      accountId: payload.accountId,
      scope: "chat",
      scopeId: payload.sessionId,
      jobType: "ingest_turn",
      status: "pending",
      floorId: payload.floorId,
      payloadJson: JSON.stringify(payload),
      attemptCount: 0,
      maxAttempts: input.maxAttempts ?? 5,
      availableAt: timestamp,
      leaseOwner: null,
      leaseUntil: null,
      lastError: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      finishedAt: null,
    });
  }

  enqueueCompactMacro(
    tx: DbExecutor,
    input: EnqueueCompactMacroJobInput,
  ): EnqueueMemoryJobResult {
    const payload = memoryCompactMacroJobPayloadSchema.parse(input);
    const sourceSeed = payload.sourceMicroIds[payload.sourceMicroIds.length - 1]!;
    const jobId = makeCompactMacroJobId(payload.scope, payload.scopeId, sourceSeed);
    const timestamp = payload.committedAt;

    return insertJob(tx, {
      id: jobId,
      accountId: payload.accountId,
      scope: payload.scope,
      scopeId: payload.scopeId,
      jobType: "compact_macro",
      status: "pending",
      floorId: payload.triggerFloorId ?? null,
      payloadJson: JSON.stringify(payload),
      attemptCount: 0,
      maxAttempts: input.maxAttempts ?? 5,
      availableAt: timestamp,
      leaseOwner: null,
      leaseUntil: null,
      lastError: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      finishedAt: null,
    });
  }

  enqueueMaintenance(
    tx: DbExecutor,
    input: EnqueueMaintenanceJobInput,
  ): EnqueueMemoryJobResult {
    const payload = memoryMaintenanceJobPayloadSchema.parse(input);
    const jobId = makeMaintenanceJobId(payload.accountId, payload.scope, payload.scopeId, payload.scheduleBucket);
    const timestamp = payload.scheduledAt;

    return insertJob(tx, {
      id: jobId,
      accountId: payload.accountId,
      scope: payload.scope,
      scopeId: payload.scopeId,
      jobType: "maintenance",
      status: "pending",
      floorId: null,
      payloadJson: JSON.stringify(payload),
      attemptCount: 0,
      maxAttempts: input.maxAttempts ?? 3,
      availableAt: timestamp,
      leaseOwner: null,
      leaseUntil: null,
      lastError: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      finishedAt: null,
    });
  }

  enqueueRebuildScope(
    tx: DbExecutor,
    input: EnqueueRebuildScopeJobInput,
  ): EnqueueMemoryJobResult {
    const payload = memoryRebuildScopeJobPayloadSchema.parse(input);
    const seed = input.seed ?? `${payload.committedAt}`;
    const jobId = makeRebuildScopeJobId(payload.scope, payload.scopeId, seed);
    const timestamp = payload.committedAt;

    return insertJob(tx, {
      id: jobId,
      accountId: payload.accountId,
      scope: payload.scope,
      scopeId: payload.scopeId,
      jobType: "rebuild_scope",
      status: "pending",
      floorId: payload.triggerFloorId ?? null,
      payloadJson: JSON.stringify(payload),
      attemptCount: 0,
      maxAttempts: input.maxAttempts ?? 5,
      availableAt: timestamp,
      leaseOwner: null,
      leaseUntil: null,
      lastError: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      finishedAt: null,
    });
  }

  createJobId(jobType: MemoryJobType, seed?: string): string {
    if (jobType === "ingest_turn" && seed) {
      return makeIngestTurnJobId(seed);
    }

    if (jobType === "compact_macro" && seed) {
      const parts = seed.split(":");
      if (parts.length >= 3) {
        const [scope, scopeId, ...sourceSeedParts] = parts;
        return makeCompactMacroJobId(
          (scope === "global" || scope === "chat" || scope === "floor" ? scope : "chat") as MemoryScope,
          scopeId ?? "scope",
          sourceSeedParts.join(":") || seed,
        );
      }

      const [scopeId, sourceSeed] = seed.split(":", 2);
      return makeCompactMacroJobId("chat", scopeId ?? "scope", sourceSeed ?? seed);
    }

    if (jobType === "maintenance" && seed) {
      const [accountId, scope, scopeId, bucket] = seed.split(":", 4);
      return makeMaintenanceJobId(
        accountId ?? "default-admin",
        (scope === "global" || scope === "chat" || scope === "floor" ? scope : "chat") as MemoryScope,
        scopeId ?? "scope",
        Number(bucket ?? 0),
      );
    }

    if (jobType === "rebuild_scope" && seed) {
      const [scope, scopeId, ...seedParts] = seed.split(":");
      return makeRebuildScopeJobId(
        (scope === "global" || scope === "chat" || scope === "floor" ? scope : "chat") as MemoryScope,
        scopeId ?? "scope",
        seedParts.join(":") || seed,
      );
    }

    return `memory-job:${jobType}:${seed ?? nanoid()}`;
  }

  parseIngestTurnPayload(job: {
    id: string;
    jobType: MemoryJobType;
    payloadJson: string;
  }): MemoryIngestTurnJobPayload {
    return parsePayload<MemoryIngestTurnJobPayload>(job, memoryIngestTurnJobPayloadSchema);
  }

  parseCompactMacroPayload(job: {
    id: string;
    jobType: MemoryJobType;
    payloadJson: string;
  }): MemoryCompactMacroJobPayload {
    return parsePayload<MemoryCompactMacroJobPayload>(job, memoryCompactMacroJobPayloadSchema);
  }

  parseMaintenancePayload(job: {
    id: string;
    jobType: MemoryJobType;
    payloadJson: string;
  }): MemoryMaintenanceJobPayload {
    return parsePayload<MemoryMaintenanceJobPayload>(job, memoryMaintenanceJobPayloadSchema);
  }

  parseRebuildScopePayload(job: {
    id: string;
    jobType: MemoryJobType;
    payloadJson: string;
  }): MemoryRebuildScopeJobPayload {
    return parsePayload<MemoryRebuildScopeJobPayload>(job, memoryRebuildScopeJobPayloadSchema);
  }
}

export type { MemoryMaintenancePolicy };
