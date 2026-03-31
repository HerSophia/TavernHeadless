import { and, eq, isNull, lte, or } from "drizzle-orm";

import type { DbExecutor } from "../db/client.js";
import { runtimeScopeStates } from "../db/schema.js";
import { RuntimeJobLeaseLostError } from "./runtime-job-errors.js";
import type { RuntimeScopeRef, RuntimeScopeStateRecord, RuntimeScopeMutation } from "./runtime-job-types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseRuntimeScopeMetadata(json: string | null | undefined): Record<string, unknown> {
  if (!json) {
    return {};
  }

  try {
    const parsed = JSON.parse(json);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function mergeRuntimeScopeMetadata(
  current: Record<string, unknown>,
  next: Record<string, unknown> | null | undefined,
  mode: "replace" | "merge" = "merge",
): Record<string, unknown> {
  if (next === undefined) {
    return current;
  }

  if (next === null) {
    return {};
  }

  return mode === "replace"
    ? { ...next }
    : { ...current, ...next };
}

export class RuntimeScopeStateRepository {
  ensure(
    tx: DbExecutor,
    ref: RuntimeScopeRef,
    now: number,
  ): RuntimeScopeStateRecord {
    tx.insert(runtimeScopeStates)
      .values({
        accountId: ref.accountId,
        scopeType: ref.scopeType,
        scopeKey: ref.scopeKey,
        revision: 0,
        leaseOwner: null,
        leaseUntil: null,
        lastProcessedAt: null,
        lastSuccessJobId: null,
        metadataJson: "{}",
        updatedAt: now,
      })
      .onConflictDoNothing()
      .run();

    const row = tx
      .select()
      .from(runtimeScopeStates)
      .where(and(
        eq(runtimeScopeStates.accountId, ref.accountId),
        eq(runtimeScopeStates.scopeType, ref.scopeType),
        eq(runtimeScopeStates.scopeKey, ref.scopeKey),
      ))
      .limit(1)
      .all()[0];

    if (!row) {
      throw new Error(`Runtime scope state missing for ${ref.accountId}::${ref.scopeType}::${ref.scopeKey}`);
    }

    return row;
  }

  tryLease(
    tx: DbExecutor,
    ref: RuntimeScopeRef,
    workerId: string,
    now: number,
    leaseUntil: number,
  ): RuntimeScopeStateRecord | null {
    const current = this.ensure(tx, ref, now);
    const updateResult = tx.update(runtimeScopeStates)
      .set({
        leaseOwner: workerId,
        leaseUntil,
        updatedAt: now,
      })
      .where(and(
        eq(runtimeScopeStates.accountId, ref.accountId),
        eq(runtimeScopeStates.scopeType, ref.scopeType),
        eq(runtimeScopeStates.scopeKey, ref.scopeKey),
        or(
          isNull(runtimeScopeStates.leaseUntil),
          lte(runtimeScopeStates.leaseUntil, now),
          eq(runtimeScopeStates.leaseOwner, workerId),
        ),
      ))
      .run();

    if (updateResult.changes !== 1) {
      return null;
    }

    return {
      ...current,
      leaseOwner: workerId,
      leaseUntil,
      updatedAt: now,
    };
  }

  renewLease(
    tx: DbExecutor,
    ref: RuntimeScopeRef,
    workerId: string,
    now: number,
    leaseUntil: number,
  ): void {
    const updateResult = tx.update(runtimeScopeStates)
      .set({
        leaseUntil,
        updatedAt: now,
      })
      .where(and(
        eq(runtimeScopeStates.accountId, ref.accountId),
        eq(runtimeScopeStates.scopeType, ref.scopeType),
        eq(runtimeScopeStates.scopeKey, ref.scopeKey),
        eq(runtimeScopeStates.leaseOwner, workerId),
      ))
      .run();

    if (updateResult.changes !== 1) {
      throw new RuntimeJobLeaseLostError(
        `Failed to renew scope lease for ${ref.accountId}::${ref.scopeType}::${ref.scopeKey}`,
      );
    }
  }

  releaseLease(
    tx: DbExecutor,
    ref: RuntimeScopeRef,
    workerId: string,
    now: number,
  ): void {
    tx.update(runtimeScopeStates)
      .set({
        leaseOwner: null,
        leaseUntil: null,
        updatedAt: now,
      })
      .where(and(
        eq(runtimeScopeStates.accountId, ref.accountId),
        eq(runtimeScopeStates.scopeType, ref.scopeType),
        eq(runtimeScopeStates.scopeKey, ref.scopeKey),
        eq(runtimeScopeStates.leaseOwner, workerId),
      ))
      .run();
  }

  finalizeSuccess(
    tx: DbExecutor,
    input: {
      ref: RuntimeScopeRef;
      expectedRevision: number;
      workerId: string;
      completedAt: number;
      scopeMutation: RuntimeScopeMutation;
      scopeMetadata?: Record<string, unknown> | null;
      scopeMetadataMode?: "replace" | "merge";
      lastProcessedAt?: number | null;
      lastSuccessJobId: string;
    },
  ): void {
    const current = this.ensure(tx, input.ref, input.completedAt);
    const nextRevision = input.scopeMutation === "changed"
      ? input.expectedRevision + 1
      : input.expectedRevision;
    const mergedMetadata = mergeRuntimeScopeMetadata(
      parseRuntimeScopeMetadata(current.metadataJson),
      input.scopeMetadata,
      input.scopeMetadataMode ?? "merge",
    );

    const updateResult = tx.update(runtimeScopeStates)
      .set({
        revision: nextRevision,
        leaseOwner: null,
        leaseUntil: null,
        lastProcessedAt: input.lastProcessedAt ?? input.completedAt,
        lastSuccessJobId: input.lastSuccessJobId,
        metadataJson: JSON.stringify(mergedMetadata),
        updatedAt: input.completedAt,
      })
      .where(and(
        eq(runtimeScopeStates.accountId, input.ref.accountId),
        eq(runtimeScopeStates.scopeType, input.ref.scopeType),
        eq(runtimeScopeStates.scopeKey, input.ref.scopeKey),
        eq(runtimeScopeStates.revision, input.expectedRevision),
        eq(runtimeScopeStates.leaseOwner, input.workerId),
      ))
      .run();

    if (updateResult.changes !== 1) {
      throw new RuntimeJobLeaseLostError(
        `Failed to finalize scope lease for ${input.ref.accountId}::${input.ref.scopeType}::${input.ref.scopeKey}`,
      );
    }
  }
}
