import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import type { DbExecutor } from "../db/client.js";
import {
  OperationLogService,
  type OperationLogActor,
  type OperationLogRecord,
} from "../services/operation-log-service.js";
import { VcDiffService } from "../services/vc-diff-service.js";
import type {
  SessionStateLiveHeadEnvelope,
  SessionStateMutationPayload,
  SessionStateMutationView,
  SessionStateNamespace,
  SessionStateNamespaceRegistrationRecord,
  SessionStateVisibilityMode,
} from "./session-state-types.js";

export type SessionStateOperationLogContext = OperationLogActor & {
  requestId?: string | null;
  operationGroupId?: string | null;
  sourceType: string;
  route: string;
};

export type SessionStateValueOperationRefInput = {
  sessionId: string;
  branchId: string;
  namespace: SessionStateNamespace;
  slot: string;
  visibilityMode: SessionStateVisibilityMode;
  schemaVersion: number;
  liveHead?: SessionStateLiveHeadEnvelope | null;
  mutation?: SessionStateMutationView | null;
  payload?: SessionStateMutationPayload | null;
};

export type AppendSessionStateOperationLogInput = SessionStateOperationLogContext & {
  accountId: string;
  action: string;
  status?: "succeeded" | "failed" | "denied" | "cancelled";
  sessionId: string;
  branchId?: string | null;
  floorId?: string | null;
  runId?: string | null;
  targetType: string;
  targetId?: string | null;
  beforeRef?: unknown;
  afterRef?: unknown;
  metadata?: Record<string, unknown>;
  createdAt?: number;
};

export function appendSessionStateOperationLog(
  tx: DbExecutor,
  input: AppendSessionStateOperationLogInput,
): OperationLogRecord {
  const beforeRef = input.beforeRef ?? null;
  const afterRef = input.afterRef ?? null;

  return new OperationLogService(tx).append({
    accountId: input.accountId,
    actorType: input.actorType,
    actorId: input.actorId,
    operationGroupId: input.operationGroupId,
    requestId: input.requestId,
    sourceType: input.sourceType,
    action: input.action,
    status: input.status ?? "succeeded",
    sessionId: input.sessionId,
    branchId: input.branchId,
    floorId: input.floorId,
    runId: input.runId,
    targetType: input.targetType,
    targetId: input.targetId,
    beforeRef,
    afterRef,
    diff: new VcDiffService().diff(beforeRef, afterRef),
    metadata: {
      route: input.route,
      ...(input.metadata ?? {}),
    },
    createdAt: input.createdAt,
  });
}

export function buildSessionStateNamespaceTargetId(sessionId: string, namespace: SessionStateNamespace): string {
  return `${sessionId}:${namespace}`;
}

export function buildSessionStateValueTargetId(
  sessionId: string,
  branchId: string,
  namespace: SessionStateNamespace,
  slot: string,
): string {
  return `${sessionId}:${branchId}:${namespace}:${slot}`;
}

export function toSessionStateNamespaceOperationRef(
  registration: SessionStateNamespaceRegistrationRecord,
): Record<string, unknown> {
  return {
    session_id: registration.sessionId,
    namespace: registration.namespace,
    registration_id: registration.id,
    domain_id: registration.domainId,
    logical_owner_type: registration.logicalOwnerType,
    logical_owner_id: registration.logicalOwnerId,
    default_visibility_mode: registration.defaultSlotTemplate.defaultVisibilityMode,
    default_write_mode: registration.defaultSlotTemplate.defaultWriteMode,
    default_replay_safety: registration.defaultSlotTemplate.defaultReplaySafety,
    client_writable: registration.defaultSlotTemplate.clientWritable,
    allowed_write_modes: [...registration.defaultSlotTemplate.allowedWriteModes],
    supports_snapshot: registration.defaultSlotTemplate.supportsSnapshot,
    supports_diff: registration.defaultSlotTemplate.supportsDiff,
    replay_policy_source: registration.defaultSlotTemplate.replayPolicySource,
    created_at: registration.createdAt,
    updated_at: registration.updatedAt,
  };
}

export function toSessionStateValueOperationRef(
  input: SessionStateValueOperationRefInput,
): Record<string, unknown> {
  return {
    session_id: input.sessionId,
    branch_id: input.branchId,
    namespace: input.namespace,
    slot: input.slot,
    visibility_mode: input.visibilityMode,
    schema_version: input.schemaVersion,
    live_head: summarizeLiveHead(input.liveHead),
    mutation: summarizeMutation(input.mutation, input.payload),
  };
}

export function summarizeSessionStateValue(value: unknown): Record<string, unknown> {
  const serialized = stableStringify(value);
  return {
    value_type: describeJsonType(value),
    value_hash: `sha256:${createHash("sha256").update(serialized).digest("hex")}`,
    value_size_bytes: Buffer.byteLength(serialized, "utf-8"),
    ...(typeof value === "string" ? { value_string_length: value.length } : {}),
    ...(Array.isArray(value) ? { value_array_length: value.length } : {}),
    ...(isPlainObject(value) ? { value_object_key_count: Object.keys(value).length } : {}),
  };
}

function summarizeLiveHead(liveHead: SessionStateLiveHeadEnvelope | null | undefined): Record<string, unknown> {
  if (!liveHead) {
    return {
      present: false,
      value_present: false,
      value_summary: null,
      last_mutation_id: null,
      source_floor_id: null,
      updated_at: null,
    };
  }

  return {
    present: true,
    branch_id: liveHead.branchId,
    value_present: liveHead.present,
    value_summary: summarizeSessionStateValue(liveHead.value),
    last_mutation_id: liveHead.lastMutationId,
    source_floor_id: liveHead.sourceFloorId,
    updated_at: liveHead.updatedAt,
  };
}

function summarizeMutation(
  mutation: SessionStateMutationView | null | undefined,
  payload: SessionStateMutationPayload | null | undefined,
): Record<string, unknown> | null {
  if (!mutation) return null;
  const effectivePayload = payload ?? mutation.payload;

  return {
    mutation_id: mutation.id,
    domain_id: mutation.domainId,
    source_floor_id: mutation.sourceFloorId,
    source_snapshot_floor_id: mutation.sourceSnapshotFloorId,
    target_slot: mutation.targetSlot,
    visibility_mode: mutation.visibilityMode,
    write_mode: mutation.writeMode,
    replay_safety: mutation.replaySafety,
    status: mutation.status,
    request_id: mutation.requestId,
    run_id: mutation.runId,
    live_head_key_present: typeof mutation.liveHeadKey === "string" && mutation.liveHeadKey.length > 0,
    discard_reason: mutation.discardReason,
    blocked_reason: mutation.blockedReason,
    payload_present: effectivePayload.present,
    payload_value_summary: summarizeSessionStateValue(effectivePayload.value),
    created_at: mutation.createdAt,
    updated_at: mutation.updatedAt,
    applied_at: mutation.appliedAt,
  };
}

function describeJsonType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function stableStringify(value: unknown): string {
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (isPlainObject(value)) {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(",")}}`;
  }

  return JSON.stringify(value) ?? String(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value === "object" && value !== null && !Array.isArray(value);
}
