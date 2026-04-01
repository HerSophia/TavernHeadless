import type { CoreEventBus, CoreEventMap } from "@tavern/core";

import type {
  MutationActor,
  RuntimeMutationEnvelope,
  RuntimeMutationOutcome,
} from "./runtime-mutation-types.js";

type RuntimeMutationEventName =
  | "runtime.mutation_created"
  | "runtime.mutation_applied"
  | "runtime.mutation_skipped"
  | "runtime.mutation_failed";

export interface RuntimeMutationEventOverrides {
  actor?: MutationActor;
  requestId?: string;
  relatedJobId?: string | null;
  outcome?: RuntimeMutationOutcome | "failed";
  skipReason?: string | null;
  errorCode?: string | null;
  errorClass?: string | null;
  errorMessage?: string | null;
  observedAt?: number;
}

export interface RuntimeMutationErrorFields {
  errorCode: string | null;
  errorClass: string;
  errorMessage: string;
}

export function toRuntimeMutationErrorFields(error: unknown): RuntimeMutationErrorFields {
  const normalized = error instanceof Error ? error : new Error(String(error));
  const errorCodeValue = (normalized as { code?: unknown }).code
  const errorCode = typeof errorCodeValue === "string"
    ? errorCodeValue
    : null;

  return {
    errorCode,
    errorClass: normalized.constructor?.name ?? "Error",
    errorMessage: normalized.message,
  };
}

export function buildRuntimeMutationEventPayload(
  envelope: RuntimeMutationEnvelope,
  overrides: RuntimeMutationEventOverrides = {},
): CoreEventMap[RuntimeMutationEventName] {
  return {
    mutationId: envelope.id,
    kind: envelope.kind,
    source: envelope.source,
    accountId: envelope.accountId,
    sessionId: envelope.sessionId,
    floorId: envelope.floorId,
    pageId: envelope.pageId,
    scopeType: envelope.scopeType,
    scopeKey: envelope.scopeKey,
    applyPhase: envelope.applyPhase,
    durability: envelope.durability,
    replaySafety: envelope.replaySafety,
    actorType: overrides.actor?.type,
    actorId: overrides.actor?.id,
    requestId: overrides.requestId,
    relatedJobId: overrides.relatedJobId ?? undefined,
    outcome: overrides.outcome,
    skipReason: overrides.skipReason ?? undefined,
    errorCode: overrides.errorCode ?? undefined,
    errorClass: overrides.errorClass ?? undefined,
    errorMessage: overrides.errorMessage ?? undefined,
    createdAt: envelope.createdAt,
    observedAt: overrides.observedAt ?? Date.now(),
  };
}

export async function emitRuntimeMutationEvent(
  eventBus: CoreEventBus | undefined,
  name: RuntimeMutationEventName,
  envelope: RuntimeMutationEnvelope,
  overrides: RuntimeMutationEventOverrides = {},
): Promise<void> {
  if (!eventBus) {
    return;
  }

  try {
    const payload = buildRuntimeMutationEventPayload(envelope, overrides);
    await eventBus.emit(name as never, payload as never);
  } catch {
    // Runtime mutation 观测事件使用 best-effort 语义，不反向影响主流程。
  }
}
