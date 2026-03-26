import { and, asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { VariableEntry } from "@tavern/shared";

import type { DbExecutor } from "../db/client.js";
import { messagePages, variables } from "../db/schema.js";

type VariableRow = typeof variables.$inferSelect;

export type VariablePromotionPolicy = "replace" | "ifAbsent";

export interface VariableCommitInput {
  pageId?: string;
  floorId: string;
  sessionId: string;
  policy?: VariablePromotionPolicy;
  committedAt?: number;
}

export interface VariableCommitResult {
  pageId?: string;
  floorId: string;
  sessionId: string;
  fromScope: "page";
  toScope: "floor";
  policy: VariablePromotionPolicy;
  scannedCount: number;
  promotedCount: number;
  skippedCount: number;
  promotedVariables: VariableEntry[];
}

function toVariableEntry(row: VariableRow): VariableEntry {
  return {
    id: row.id,
    scope: row.scope,
    scopeId: row.scopeId,
    key: row.key,
    value: JSON.parse(row.valueJson),
    updatedAt: row.updatedAt,
  };
}

function createEmptyResult(
  input: VariableCommitInput,
  policy: VariablePromotionPolicy
): VariableCommitResult {
  return {
    pageId: input.pageId,
    floorId: input.floorId,
    sessionId: input.sessionId,
    fromScope: "page",
    toScope: "floor",
    policy,
    scannedCount: 0,
    promotedCount: 0,
    skippedCount: 0,
    promotedVariables: [],
  };
}

function buildPromotedRow(args: {
  sourceRow: VariableRow;
  floorId: string;
  committedAt: number;
  existingId?: string;
}): VariableRow {
  return {
    id: args.existingId ?? nanoid(),
    scope: "floor",
    scopeId: args.floorId,
    key: args.sourceRow.key,
    valueJson: args.sourceRow.valueJson,
    updatedAt: args.committedAt,
  };
}

export class VariableCommitService {
  promoteAll(input: VariableCommitInput, tx: DbExecutor): VariableCommitResult {
    const policy = input.policy ?? "replace";
    if (!input.pageId) {
      return createEmptyResult(input, policy);
    }

    const inputPage = tx
      .select({ id: messagePages.id })
      .from(messagePages)
      .where(
        and(
          eq(messagePages.id, input.pageId),
          eq(messagePages.floorId, input.floorId),
          eq(messagePages.pageKind, "input")
        )
      )
      .limit(1)
      .all()[0];

    if (!inputPage) {
      throw new Error(
        `Input page '${input.pageId}' was not found on floor '${input.floorId}'`
      );
    }

    const sourceRows = tx
      .select()
      .from(variables)
      .where(and(eq(variables.scope, "page"), eq(variables.scopeId, input.pageId)))
      .orderBy(asc(variables.key), asc(variables.id))
      .all();

    if (sourceRows.length === 0) {
      return createEmptyResult(input, policy);
    }

    const targetRows = tx
      .select()
      .from(variables)
      .where(and(eq(variables.scope, "floor"), eq(variables.scopeId, input.floorId)))
      .all();

    const targetsByKey = new Map(targetRows.map((row) => [row.key, row]));
    const promotedVariables: VariableEntry[] = [];
    let skippedCount = 0;
    const committedAt = input.committedAt ?? Date.now();

    for (const sourceRow of sourceRows) {
      const existingTarget = targetsByKey.get(sourceRow.key);
      if (policy === "ifAbsent" && existingTarget) {
        skippedCount += 1;
        continue;
      }

      const promotedRow = buildPromotedRow({
        sourceRow,
        floorId: input.floorId,
        committedAt,
        existingId: existingTarget?.id,
      });

      tx.insert(variables)
        .values(promotedRow)
        .onConflictDoUpdate({
          target: [variables.scope, variables.scopeId, variables.key],
          set: {
            valueJson: promotedRow.valueJson,
            updatedAt: promotedRow.updatedAt,
          },
        })
        .run();

      targetsByKey.set(sourceRow.key, promotedRow);
      promotedVariables.push(toVariableEntry(promotedRow));
    }

    return {
      pageId: input.pageId,
      floorId: input.floorId,
      sessionId: input.sessionId,
      fromScope: "page",
      toScope: "floor",
      policy,
      scannedCount: sourceRows.length,
      promotedCount: promotedVariables.length,
      skippedCount,
      promotedVariables,
    };
  }
}
