import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { AppDb, DbExecutor } from "../../../db/client.js";
import { sessionBranches } from "../../../db/schema.js";

export interface SessionBranchAssetBindingState {
  presetId: string | null;
  regexProfileId: string | null;
  worldbookProfileId: string | null;
  deepBinding: boolean;
  presetVersionId: string | null;
  regexProfileVersionId: string | null;
  worldbookVersionId: string | null;
}

export interface SessionBranchRegistryRecord {
  id: string;
  accountId: string;
  sessionId: string;
  branchId: string;
  sourceFloorId: string | null;
  sourceBranchId: string | null;
  assetBinding: SessionBranchAssetBindingState | null;
  createdAt: number;
  updatedAt: number;
}

export class SessionBranchRegistryService {
  constructor(private readonly db: AppDb | DbExecutor) {}

  get(accountId: string, sessionId: string, branchId: string): SessionBranchRegistryRecord | null {
    const row = this.db
      .select()
      .from(sessionBranches)
      .where(
        and(
          eq(sessionBranches.accountId, accountId),
          eq(sessionBranches.sessionId, sessionId),
          eq(sessionBranches.branchId, branchId),
        ),
      )
      .limit(1)
      .all()[0];

    return row ? toSessionBranchRegistryRecord(row) : null;
  }

  listBySession(accountId: string, sessionId: string): SessionBranchRegistryRecord[] {
    return this.db
      .select()
      .from(sessionBranches)
      .where(
        and(
          eq(sessionBranches.accountId, accountId),
          eq(sessionBranches.sessionId, sessionId),
        ),
      )
      .all()
      .map(toSessionBranchRegistryRecord)
      .sort((left, right) => left.branchId.localeCompare(right.branchId) || left.createdAt - right.createdAt);
  }

  listByBranchId(
    accountId: string,
    branchId: string,
    sessionIds?: readonly string[],
  ): SessionBranchRegistryRecord[] {
    const conditions = [
      eq(sessionBranches.accountId, accountId),
      eq(sessionBranches.branchId, branchId),
    ];

    if (sessionIds && sessionIds.length > 0) {
      conditions.push(inArray(sessionBranches.sessionId, Array.from(new Set(sessionIds))));
    }

    return this.db
      .select()
      .from(sessionBranches)
      .where(and(...conditions))
      .all()
      .map(toSessionBranchRegistryRecord);
  }

  ensure(input: {
    accountId: string;
    sessionId: string;
    branchId: string;
    sourceFloorId?: string | null;
    sourceBranchId?: string | null;
    assetBinding?: SessionBranchAssetBindingState | null;
    createdAt?: number;
    updatedAt?: number;
  }): SessionBranchRegistryRecord {
    const createdAt = input.createdAt ?? Date.now();
    const updatedAt = input.updatedAt ?? createdAt;
    const existing = this.get(input.accountId, input.sessionId, input.branchId);

    if (!existing) {
      const inserted = this.db
        .insert(sessionBranches)
        .values({
          id: nanoid(),
          accountId: input.accountId,
          sessionId: input.sessionId,
          branchId: input.branchId,
          sourceFloorId: input.sourceFloorId ?? null,
          sourceBranchId: input.sourceBranchId ?? null,
          ...toSessionBranchAssetBindingColumns(input.assetBinding ?? null),
          createdAt,
          updatedAt,
        })
        .returning()
        .all()[0];

      if (!inserted) {
        throw new Error("Failed to create session branch registry row");
      }

      return toSessionBranchRegistryRecord(inserted);
    }

    const nextSourceFloorId = existing.sourceFloorId ?? input.sourceFloorId ?? null;
    const nextSourceBranchId = existing.sourceBranchId ?? input.sourceBranchId ?? null;
    const nextAssetBinding = input.assetBinding === undefined ? existing.assetBinding : input.assetBinding;
    const nextCreatedAt = Math.min(existing.createdAt, createdAt);
    const nextUpdatedAt = Math.max(existing.updatedAt, updatedAt);

    if (
      existing.sourceFloorId === nextSourceFloorId
      && existing.sourceBranchId === nextSourceBranchId
      && existing.createdAt === nextCreatedAt
      && existing.updatedAt === nextUpdatedAt
      && areSessionBranchAssetBindingsEqual(existing.assetBinding, nextAssetBinding)
    ) {
      return existing;
    }

    const updated = this.db
      .update(sessionBranches)
      .set({
        sourceFloorId: nextSourceFloorId,
        sourceBranchId: nextSourceBranchId,
        createdAt: nextCreatedAt,
        ...toSessionBranchAssetBindingColumns(nextAssetBinding),
        updatedAt: nextUpdatedAt,
      })
      .where(eq(sessionBranches.id, existing.id))
      .returning()
      .all()[0];

    if (!updated) {
      throw new Error("Failed to update session branch registry row");
    }

    return toSessionBranchRegistryRecord(updated);
  }

  remove(accountId: string, sessionId: string, branchId: string): SessionBranchRegistryRecord | null {
    const deleted = this.db
      .delete(sessionBranches)
      .where(
        and(
          eq(sessionBranches.accountId, accountId),
          eq(sessionBranches.sessionId, sessionId),
          eq(sessionBranches.branchId, branchId),
        ),
      )
      .returning()
      .all()[0];

    return deleted ? toSessionBranchRegistryRecord(deleted) : null;
  }
}

function toSessionBranchRegistryRecord(
  row: typeof sessionBranches.$inferSelect,
): SessionBranchRegistryRecord {
  return {
    id: row.id,
    accountId: row.accountId,
    sessionId: row.sessionId,
    branchId: row.branchId,
    sourceFloorId: row.sourceFloorId,
    sourceBranchId: row.sourceBranchId,
    assetBinding: toSessionBranchAssetBindingState(row),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toSessionBranchAssetBindingState(
  row: typeof sessionBranches.$inferSelect,
): SessionBranchAssetBindingState | null {
  if (
    row.assetBindingDeepBinding === null
    && row.assetBindingPresetId === null
    && row.assetBindingPresetVersionId === null
    && row.assetBindingWorldbookProfileId === null
    && row.assetBindingWorldbookVersionId === null
    && row.assetBindingRegexProfileId === null
    && row.assetBindingRegexProfileVersionId === null
  ) {
    return null;
  }

  return {
    presetId: row.assetBindingPresetId,
    presetVersionId: row.assetBindingPresetVersionId,
    regexProfileId: row.assetBindingRegexProfileId,
    regexProfileVersionId: row.assetBindingRegexProfileVersionId,
    worldbookProfileId: row.assetBindingWorldbookProfileId,
    worldbookVersionId: row.assetBindingWorldbookVersionId,
    deepBinding: row.assetBindingDeepBinding ?? false,
  };
}

function toSessionBranchAssetBindingColumns(
  assetBinding: SessionBranchAssetBindingState | null | undefined,
): Pick<
  typeof sessionBranches.$inferInsert,
  | "assetBindingDeepBinding"
  | "assetBindingPresetId"
  | "assetBindingPresetVersionId"
  | "assetBindingWorldbookProfileId"
  | "assetBindingWorldbookVersionId"
  | "assetBindingRegexProfileId"
  | "assetBindingRegexProfileVersionId"
> {
  return {
    assetBindingDeepBinding: assetBinding?.deepBinding ?? null,
    assetBindingPresetId: assetBinding?.presetId ?? null,
    assetBindingPresetVersionId: assetBinding?.presetVersionId ?? null,
    assetBindingWorldbookProfileId: assetBinding?.worldbookProfileId ?? null,
    assetBindingWorldbookVersionId: assetBinding?.worldbookVersionId ?? null,
    assetBindingRegexProfileId: assetBinding?.regexProfileId ?? null,
    assetBindingRegexProfileVersionId: assetBinding?.regexProfileVersionId ?? null,
  };
}

function areSessionBranchAssetBindingsEqual(
  left: SessionBranchAssetBindingState | null | undefined,
  right: SessionBranchAssetBindingState | null | undefined,
): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}
