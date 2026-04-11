import { and, eq } from "drizzle-orm";
import { buildBranchVariableScopeId, type VariableScope } from "@tavern/shared";

import type { AppDb, DbExecutor } from "../db/client.js";
import { branchLocalVariableSnapshots, variables } from "../db/schema.js";
import { parseJsonField } from "../lib/http.js";
import { VariableService } from "./variable-service.js";

type BranchLocalVariableSnapshotRow = typeof branchLocalVariableSnapshots.$inferSelect;

export interface BranchLocalVariableSnapshotRecord {
  floorId: string;
  accountId: string;
  sessionId: string;
  branchId: string;
  values: Record<string, unknown>;
  createdAt: number;
}

export interface ResolvedSourceFloorLocalValues {
  source: "snapshot" | "legacy_fallback";
  values: Record<string, unknown>;
}

export interface MaterializeBranchLocalVariableSnapshotResult {
  source: "snapshot" | "legacy_fallback";
  targetScopeId: string;
  restoredCount: number;
  restoredKeys: string[];
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseSnapshotValuesJson(valueJson: string): Record<string, unknown> {
  const parsed = parseJsonField(valueJson);
  return isPlainRecord(parsed) ? parsed : {};
}

function toSnapshotRecord(row: BranchLocalVariableSnapshotRow): BranchLocalVariableSnapshotRecord {
  return {
    floorId: row.floorId,
    accountId: row.accountId,
    sessionId: row.sessionId,
    branchId: row.branchId,
    values: parseSnapshotValuesJson(row.valuesJson),
    createdAt: row.createdAt,
  };
}

/**
 * 保存并回放分支 local 兼容变量快照。
 *
 * 这个服务只处理 branch/chat 两层的可见视图，
 * 用于历史分支点的 local 继承与 legacy fallback。
 */
export class BranchLocalVariableSnapshotService {
  constructor(private readonly db: AppDb | DbExecutor) {}

  persistFloorLocalSnapshot(input: {
    accountId: string;
    floorId: string;
    sessionId: string;
    branchId: string;
    createdAt: number;
  }): BranchLocalVariableSnapshotRecord {
    const values = this.resolveVisibleLocalValues({
      accountId: input.accountId,
      sessionId: input.sessionId,
      branchId: input.branchId,
    });
    const row: typeof branchLocalVariableSnapshots.$inferInsert = {
      floorId: input.floorId,
      accountId: input.accountId,
      sessionId: input.sessionId,
      branchId: input.branchId,
      valuesJson: JSON.stringify(values),
      createdAt: input.createdAt,
    };

    this.db
      .insert(branchLocalVariableSnapshots)
      .values(row)
      .onConflictDoUpdate({
        target: branchLocalVariableSnapshots.floorId,
        set: {
          accountId: row.accountId,
          sessionId: row.sessionId,
          branchId: row.branchId,
          valuesJson: row.valuesJson,
          createdAt: row.createdAt,
        },
      })
      .run();

    return {
      floorId: input.floorId,
      accountId: input.accountId,
      sessionId: input.sessionId,
      branchId: input.branchId,
      values,
      createdAt: input.createdAt,
    };
  }

  getFloorLocalSnapshot(input: {
    accountId: string;
    floorId: string;
  }): BranchLocalVariableSnapshotRecord | null {
    const row = this.db
      .select()
      .from(branchLocalVariableSnapshots)
      .where(and(
        eq(branchLocalVariableSnapshots.accountId, input.accountId),
        eq(branchLocalVariableSnapshots.floorId, input.floorId),
      ))
      .limit(1)
      .all()[0];

    return row ? toSnapshotRecord(row) : null;
  }

  resolveSourceFloorLocalValues(input: {
    accountId: string;
    sessionId: string;
    sourceFloorId: string;
    sourceBranchId: string;
  }): ResolvedSourceFloorLocalValues {
    const storedSnapshot = this.getFloorLocalSnapshot({
      accountId: input.accountId,
      floorId: input.sourceFloorId,
    });

    return storedSnapshot
      ? { source: "snapshot", values: storedSnapshot.values }
      : {
          source: "legacy_fallback",
          values: this.resolveVisibleLocalValues({
            accountId: input.accountId,
            sessionId: input.sessionId,
            branchId: input.sourceBranchId,
          }),
        };
  }

  materializeFromSourceFloor(input: {
    accountId: string;
    sessionId: string;
    sourceFloorId: string;
    sourceBranchId: string;
    targetBranchId: string;
    createdAt: number;
  }): MaterializeBranchLocalVariableSnapshotResult {
    const resolvedSource = this.resolveSourceFloorLocalValues({
      accountId: input.accountId,
      sessionId: input.sessionId,
      sourceFloorId: input.sourceFloorId,
      sourceBranchId: input.sourceBranchId,
    });
    const values = resolvedSource.values;
    const targetScopeId = buildBranchVariableScopeId(input.sessionId, input.targetBranchId);
    const restoredKeys = Object.keys(values).sort((left, right) => left.localeCompare(right));

    if (restoredKeys.length > 0) {
      const variableService = new VariableService(this.db);
      variableService.restoreMany({
        accountId: input.accountId,
        items: restoredKeys.map((key) => ({
          scope: "branch" as const,
          scopeId: targetScopeId,
          key,
          value: values[key],
          updatedAt: input.createdAt,
        })),
      });
    }

    return {
      source: resolvedSource.source,
      targetScopeId,
      restoredCount: restoredKeys.length,
      restoredKeys,
    };
  }

  private resolveVisibleLocalValues(input: {
    accountId: string;
    sessionId: string;
    branchId: string;
  }): Record<string, unknown> {
    const chatValues = this.listScopeValues({
      accountId: input.accountId,
      scope: "chat",
      scopeId: input.sessionId,
    });
    const branchValues = this.listScopeValues({
      accountId: input.accountId,
      scope: "branch",
      scopeId: buildBranchVariableScopeId(input.sessionId, input.branchId),
    });

    return {
      ...chatValues,
      ...branchValues,
    };
  }

  private listScopeValues(input: {
    accountId: string;
    scope: VariableScope;
    scopeId: string;
  }): Record<string, unknown> {
    const rows = this.db
      .select({
        key: variables.key,
        valueJson: variables.valueJson,
      })
      .from(variables)
      .where(and(
        eq(variables.accountId, input.accountId),
        eq(variables.scope, input.scope),
        eq(variables.scopeId, input.scopeId),
      ))
      .all()
      .sort((left, right) => left.key.localeCompare(right.key));

    return Object.fromEntries(rows.map((row) => [row.key, parseJsonField(row.valueJson)]));
  }
}
