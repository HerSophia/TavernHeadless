import type { CoreEventBus } from "@tavern/core";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { MemoryJobType, MemoryScope } from "@tavern/shared";

import type { DbExecutor } from "../db/client.js";
import { RuntimeJobScheduler } from "./runtime-job-scheduler.js";
import {
  MEMORY_RUNTIME_SCOPE_TYPE,
  MEMORY_RUNTIME_JOB_TYPES,
  type MemoryCompactMacroJobPayload,
  type MemoryIngestTurnJobPayload,
  type MemoryMaintenanceJobPayload,
  type MemoryRebuildScopeJobPayload,
  buildMemoryRuntimeScopeKey,
  createMemoryRuntimeJobCatalog,
  makeCompactMacroJobId,
  makeIngestTurnJobId,
  makeMaintenanceJobId,
  makeRebuildScopeJobId,
  memoryCompactMacroJobPayloadSchema,
  memoryIngestTurnJobPayloadSchema,
  memoryMaintenanceJobPayloadSchema,
  memoryRebuildScopeJobPayloadSchema,
} from "./memory-runtime-job-definitions.js";
import type { MemoryMaintenancePolicy } from "./memory-maintenance-service.js";

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

function parsePayload<T>(
  job: { id: string; jobType: string; payloadJson: string },
  jobType: MemoryJobType,
  schema: z.ZodTypeAny,
): T {
  let payload: unknown;
  try {
    payload = JSON.parse(job.payloadJson);
  } catch (error) {
    throw new MemoryJobPayloadParseError(
      job.id,
      jobType,
      [error instanceof Error ? error.message : String(error)],
    );
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new MemoryJobPayloadParseError(
      job.id,
      jobType,
      parsed.error.issues.map((issue) => `${issue.path.join(".") || "payload"}: ${issue.message}`),
    );
  }

  return parsed.data as T;
}

export interface MemoryJobSchedulerOptions {
  catalog?: ReturnType<typeof createMemoryRuntimeJobCatalog>;
  eventBus?: CoreEventBus;
}

export function createMemoryRuntimeScheduler(options: MemoryJobSchedulerOptions = {}): RuntimeJobScheduler {
  return new RuntimeJobScheduler(options.catalog ?? createMemoryRuntimeJobCatalog(), {
    eventBus: options.eventBus,
  });
}

export class MemoryJobScheduler {
  private readonly runtimeScheduler: RuntimeJobScheduler;

  constructor(options: MemoryJobSchedulerOptions = {}) {
    this.runtimeScheduler = createMemoryRuntimeScheduler(options);
  }

  enqueueIngestTurn(
    tx: DbExecutor,
    input: EnqueueIngestTurnJobInput,
  ): EnqueueMemoryJobResult {
    const payload = memoryIngestTurnJobPayloadSchema.parse(input);
    const result = this.runtimeScheduler.enqueue(tx, {
      jobType: MEMORY_RUNTIME_JOB_TYPES.ingest_turn,
      accountId: payload.accountId,
      scopeType: MEMORY_RUNTIME_SCOPE_TYPE,
      scopeKey: buildMemoryRuntimeScopeKey("chat", payload.sessionId),
      floorId: payload.floorId,
      payload,
      availableAt: payload.committedAt,
      maxAttempts: input.maxAttempts,
    });

    return {
      jobId: result.jobId,
      created: result.created,
    };
  }

  enqueueCompactMacro(
    tx: DbExecutor,
    input: EnqueueCompactMacroJobInput,
  ): EnqueueMemoryJobResult {
    const payload = memoryCompactMacroJobPayloadSchema.parse(input);
    const result = this.runtimeScheduler.enqueue(tx, {
      jobType: MEMORY_RUNTIME_JOB_TYPES.compact_macro,
      accountId: payload.accountId,
      scopeType: MEMORY_RUNTIME_SCOPE_TYPE,
      scopeKey: buildMemoryRuntimeScopeKey(payload.scope, payload.scopeId),
      floorId: payload.triggerFloorId ?? null,
      payload,
      availableAt: payload.committedAt,
      maxAttempts: input.maxAttempts,
    });

    return {
      jobId: result.jobId,
      created: result.created,
    };
  }

  enqueueMaintenance(
    tx: DbExecutor,
    input: EnqueueMaintenanceJobInput,
  ): EnqueueMemoryJobResult {
    const payload = memoryMaintenanceJobPayloadSchema.parse(input);
    const result = this.runtimeScheduler.enqueue(tx, {
      jobType: MEMORY_RUNTIME_JOB_TYPES.maintenance,
      accountId: payload.accountId,
      scopeType: MEMORY_RUNTIME_SCOPE_TYPE,
      scopeKey: buildMemoryRuntimeScopeKey(payload.scope, payload.scopeId),
      payload,
      availableAt: payload.scheduledAt,
      maxAttempts: input.maxAttempts,
    });

    return {
      jobId: result.jobId,
      created: result.created,
    };
  }

  enqueueRebuildScope(
    tx: DbExecutor,
    input: EnqueueRebuildScopeJobInput,
  ): EnqueueMemoryJobResult {
    const payload = memoryRebuildScopeJobPayloadSchema.parse(input);
    const seed = input.seed ?? `${payload.committedAt}`;
    const result = this.runtimeScheduler.enqueue(tx, {
      jobId: makeRebuildScopeJobId(payload.scope, payload.scopeId, seed),
      jobType: MEMORY_RUNTIME_JOB_TYPES.rebuild_scope,
      accountId: payload.accountId,
      scopeType: MEMORY_RUNTIME_SCOPE_TYPE,
      scopeKey: buildMemoryRuntimeScopeKey(payload.scope, payload.scopeId),
      floorId: payload.triggerFloorId ?? null,
      payload,
      availableAt: payload.committedAt,
      maxAttempts: input.maxAttempts,
    });

    return {
      jobId: result.jobId,
      created: result.created,
    };
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

  parseIngestTurnPayload(job: { id: string; jobType: string; payloadJson: string }): MemoryIngestTurnJobPayload {
    return parsePayload<MemoryIngestTurnJobPayload>(job, "ingest_turn", memoryIngestTurnJobPayloadSchema);
  }

  parseCompactMacroPayload(job: { id: string; jobType: string; payloadJson: string }): MemoryCompactMacroJobPayload {
    return parsePayload<MemoryCompactMacroJobPayload>(job, "compact_macro", memoryCompactMacroJobPayloadSchema);
  }

  parseMaintenancePayload(job: { id: string; jobType: string; payloadJson: string }): MemoryMaintenanceJobPayload {
    return parsePayload<MemoryMaintenanceJobPayload>(job, "maintenance", memoryMaintenanceJobPayloadSchema);
  }

  parseRebuildScopePayload(job: { id: string; jobType: string; payloadJson: string }): MemoryRebuildScopeJobPayload {
    return parsePayload<MemoryRebuildScopeJobPayload>(job, "rebuild_scope", memoryRebuildScopeJobPayloadSchema);
  }
}

export type { MemoryMaintenancePolicy };
