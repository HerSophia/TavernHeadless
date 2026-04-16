import { nanoid } from "nanoid";
import { z } from "zod";
import {
  MEMORY_SCOPES,
  type MemoryJobType,
  type MemoryScope,
} from "@tavern/shared";

import { RuntimeJobCatalog } from "./runtime-job-catalog.js";
import type { RuntimeJobDefinition } from "./runtime-job-types.js";
import type { MemoryMaintenancePolicy } from "./memory-maintenance-service.js";

export const MEMORY_RUNTIME_SCOPE_TYPE = "memory";

export const MEMORY_RUNTIME_JOB_TYPES = {
  ingest_turn: "memory.ingest_turn",
  compact_macro: "memory.compact_macro",
  maintenance: "memory.maintenance",
  rebuild_scope: "memory.rebuild_scope",
} as const;

export type MemoryRuntimeJobType = (typeof MEMORY_RUNTIME_JOB_TYPES)[MemoryJobType];

const memoryScopeSchema = z.enum(MEMORY_SCOPES);

const memoryMaintenancePolicySchema = z.object({
  summaryMaxAgeMs: z.number().int().positive().optional(),
  openLoopMaxAgeMs: z.number().int().positive().optional(),
  deprecatedPurgeAgeMs: z.number().int().positive().optional(),
});

export const memoryIngestTurnJobPayloadSchema = z.object({
  accountId: z.string().min(1),
  sessionId: z.string().min(1),
  floorId: z.string().min(1),
  floorNo: z.number().int().nonnegative(),
  assistantMessageId: z.string().min(1),
  branchId: z.string().min(1).optional(),
  userInputDigest: z.string().min(1),
  committedAt: z.number().int(),
  summaries: z.array(z.string()).default([]),
  enableConsolidation: z.boolean().default(false),
});

export const memoryCompactMacroJobPayloadSchema = z.object({
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

export const memoryMaintenanceJobPayloadSchema = z.object({
  accountId: z.string().min(1),
  scope: memoryScopeSchema,
  scopeId: z.string().min(1),
  scheduleBucket: z.number().int().nonnegative(),
  scheduledAt: z.number().int(),
  batchSize: z.number().int().positive().optional(),
  dryRun: z.boolean().default(false),
  policy: memoryMaintenancePolicySchema.optional(),
});

export const memoryRebuildScopeJobPayloadSchema = z.object({
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

export interface MemoryRuntimeScopeMetadata {
  lastProcessedFloorNo?: number | null;
  lastCompactionAt?: number | null;
}

export function toMemoryRuntimeJobType(jobType: MemoryJobType): MemoryRuntimeJobType {
  return MEMORY_RUNTIME_JOB_TYPES[jobType];
}

export function fromMemoryRuntimeJobType(jobType: string): MemoryJobType {
  switch (jobType) {
    case MEMORY_RUNTIME_JOB_TYPES.ingest_turn:
      return "ingest_turn";
    case MEMORY_RUNTIME_JOB_TYPES.compact_macro:
      return "compact_macro";
    case MEMORY_RUNTIME_JOB_TYPES.maintenance:
      return "maintenance";
    case MEMORY_RUNTIME_JOB_TYPES.rebuild_scope:
      return "rebuild_scope";
    default:
      throw new Error(`Unknown memory runtime job type: ${jobType}`);
  }
}

export function buildMemoryRuntimeScopeKey(scope: MemoryScope, scopeId: string): string {
  return `${scope}:${scopeId}`;
}

export function parseMemoryRuntimeScopeKey(scopeKey: string): { scope: MemoryScope; scopeId: string } {
  const separatorIndex = scopeKey.indexOf(":");
  if (separatorIndex <= 0) {
    return { scope: "chat", scopeId: scopeKey };
  }

  const scope = scopeKey.slice(0, separatorIndex);
  const scopeId = scopeKey.slice(separatorIndex + 1);
  const normalizedScope = MEMORY_SCOPES.includes(scope as MemoryScope) ? scope as MemoryScope : "chat";
  return {
    scope: normalizedScope,
    scopeId,
  };
}

export function readMemoryRuntimeScopeMetadata(value: string | null | undefined): MemoryRuntimeScopeMetadata {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return {
      lastProcessedFloorNo: typeof parsed.lastProcessedFloorNo === "number" ? parsed.lastProcessedFloorNo : null,
      lastCompactionAt: typeof parsed.lastCompactionAt === "number" ? parsed.lastCompactionAt : null,
    };
  } catch {
    return {};
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

function createDefinition<TPayload>(definition: RuntimeJobDefinition<TPayload>): RuntimeJobDefinition<TPayload> {
  return definition;
}

export function createMemoryRuntimeJobCatalog(): RuntimeJobCatalog {
  const catalog = new RuntimeJobCatalog();

  catalog.register(createDefinition<MemoryIngestTurnJobPayload>({
    jobType: MEMORY_RUNTIME_JOB_TYPES.ingest_turn,
    payloadSchema: memoryIngestTurnJobPayloadSchema,
    defaultMaxAttempts: 5,
    createJobId({ payload }) {
      return makeIngestTurnJobId(payload.floorId);
    },
  }));

  catalog.register(createDefinition<MemoryCompactMacroJobPayload>({
    jobType: MEMORY_RUNTIME_JOB_TYPES.compact_macro,
    payloadSchema: memoryCompactMacroJobPayloadSchema,
    defaultMaxAttempts: 5,
    createJobId({ payload }) {
      const sourceSeed = payload.sourceMicroIds[payload.sourceMicroIds.length - 1] ?? nanoid();
      return makeCompactMacroJobId(payload.scope, payload.scopeId, sourceSeed);
    },
  }));

  catalog.register(createDefinition<MemoryMaintenanceJobPayload>({
    jobType: MEMORY_RUNTIME_JOB_TYPES.maintenance,
    payloadSchema: memoryMaintenanceJobPayloadSchema,
    defaultMaxAttempts: 3,
    createJobId({ payload }) {
      return makeMaintenanceJobId(payload.accountId, payload.scope, payload.scopeId, payload.scheduleBucket);
    },
  }));

  catalog.register(createDefinition<MemoryRebuildScopeJobPayload>({
    jobType: MEMORY_RUNTIME_JOB_TYPES.rebuild_scope,
    payloadSchema: memoryRebuildScopeJobPayloadSchema,
    defaultMaxAttempts: 5,
    createJobId({ payload }) {
      return makeRebuildScopeJobId(payload.scope, payload.scopeId, `${payload.committedAt}`);
    },
  }));

  return catalog;
}

export type { MemoryMaintenancePolicy };
