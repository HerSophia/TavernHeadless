import { and, eq } from "drizzle-orm";
import { buildBranchVariableScopeId, type VariableScope } from "@tavern/shared";

import type { AppDb, DbExecutor } from "../db/client.js";
import { branchLocalVariableSnapshots, variables } from "../db/schema.js";
import { parseJsonField } from "../lib/http.js";
import { VariableService } from "./variables/variable-service.js";

type BranchLocalVariableSnapshotRow = typeof branchLocalVariableSnapshots.$inferSelect;

/**
 * branch_local_variable_snapshot 的 payload 结构版本。
 *
 * - v1：只有 `valuesJson`，没有 provenance 元数据（旧行）
 * - v2：在保留 `valuesJson` 的同时，附带 `provenanceJson`，按 key 记录来源信息
 */
export const BRANCH_LOCAL_SNAPSHOT_SCHEMA_V1 = 1 as const;
export const BRANCH_LOCAL_SNAPSHOT_SCHEMA_V2 = 2 as const;

export type BranchLocalSnapshotSchemaVersion =
  | typeof BRANCH_LOCAL_SNAPSHOT_SCHEMA_V1
  | typeof BRANCH_LOCAL_SNAPSHOT_SCHEMA_V2;

/**
 * 单个 key 在快照中的来源元数据。
 *
 * `originKind`：
 * - `authored`：直接来自 `scope = branch` 的 branch-authored 写入
 * - `inherited`：来自 `scope = chat` 的会话级继承值
 * - `unknown`：v1 兼容读取时没有 provenance 可供判断
 */
export interface BranchLocalVariableProvenance {
  sourceScope: VariableScope;
  sourceScopeId: string;
  sourceVariableId?: string;
  sourceUpdatedAt?: number;
  inheritedFromFloorId?: string;
  inheritedFromBranchId?: string;
  originKind: "authored" | "inherited" | "unknown";
}

export type BranchLocalVariableProvenanceMap = Record<string, BranchLocalVariableProvenance>;

export interface BranchLocalVariableSnapshotRecord {
  floorId: string;
  accountId: string;
  sessionId: string;
  branchId: string;
  values: Record<string, unknown>;
  /** 快照结构版本，用于读取兼容 */
  schemaVersion: BranchLocalSnapshotSchemaVersion;
  /** 按 key 的 provenance 元数据；v1 旧行读作空对象 */
  provenance: BranchLocalVariableProvenanceMap;
  createdAt: number;
}

export interface ResolvedSourceFloorLocalValues {
  source: "snapshot";
  values: Record<string, unknown>;
  /** 伴随 values 的 provenance，v1 旧行为空对象 */
  provenance: BranchLocalVariableProvenanceMap;
  schemaVersion: BranchLocalSnapshotSchemaVersion;
}

export interface MaterializeBranchLocalVariableSnapshotResult {
  source: "snapshot";
  targetScopeId: string;
  restoredCount: number;
  restoredKeys: string[];
  /** materialize 过程中重新附加到目标 floor 快照上的 provenance 元数据 */
  provenance: BranchLocalVariableProvenanceMap;
}

export class BranchLocalSnapshotMissingError extends Error {
  readonly code = "branch_local_snapshot_missing";

  constructor(
    public readonly details: {
      accountId: string;
      sessionId: string;
      sourceFloorId: string;
      sourceBranchId: string;
    },
  ) {
    super(
      `Source floor '${details.sourceFloorId}' in branch '${details.sourceBranchId}' does not have a branch local snapshot`,
    );
    this.name = "BranchLocalSnapshotMissingError";
  }
}

export function isBranchLocalSnapshotMissingError(error: unknown): error is {
  code: "branch_local_snapshot_missing";
  message: string;
  details?: BranchLocalSnapshotMissingError["details"];
} {
  return error instanceof BranchLocalSnapshotMissingError
    || (
      isPlainRecord(error)
      && error["code"] === "branch_local_snapshot_missing"
      && typeof error["message"] === "string"
    );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseSnapshotValuesJson(valueJson: string): Record<string, unknown> {
  const parsed = parseJsonField(valueJson);
  return isPlainRecord(parsed) ? parsed : {};
}

function isVariableScope(value: unknown): value is VariableScope {
  return value === "page"
    || value === "floor"
    || value === "branch"
    || value === "chat"
    || value === "global";
}

function isOriginKind(value: unknown): value is BranchLocalVariableProvenance["originKind"] {
  return value === "authored" || value === "inherited" || value === "unknown";
}

/**
 * 读取旧/新快照中的 provenance 字段；对 v1 行或结构不正确的 payload 返回 {}。
 */
function parseProvenanceJson(
  provenanceJson: string | null,
): BranchLocalVariableProvenanceMap {
  if (!provenanceJson) {
    return {};
  }

  const parsed = parseJsonField(provenanceJson);
  if (!isPlainRecord(parsed)) {
    return {};
  }

  const result: BranchLocalVariableProvenanceMap = {};
  for (const [key, rawEntry] of Object.entries(parsed)) {
    if (!isPlainRecord(rawEntry)) {
      continue;
    }

    const sourceScope = rawEntry["sourceScope"];
    const sourceScopeId = rawEntry["sourceScopeId"];
    if (!isVariableScope(sourceScope) || typeof sourceScopeId !== "string") {
      continue;
    }

    const originKindRaw = rawEntry["originKind"];
    const originKind = isOriginKind(originKindRaw) ? originKindRaw : "unknown";
    const sourceVariableIdRaw = rawEntry["sourceVariableId"];
    const sourceUpdatedAtRaw = rawEntry["sourceUpdatedAt"];
    const inheritedFromFloorIdRaw = rawEntry["inheritedFromFloorId"];
    const inheritedFromBranchIdRaw = rawEntry["inheritedFromBranchId"];

    result[key] = {
      sourceScope,
      sourceScopeId,
      originKind,
      ...(typeof sourceVariableIdRaw === "string" ? { sourceVariableId: sourceVariableIdRaw } : {}),
      ...(typeof sourceUpdatedAtRaw === "number" && Number.isFinite(sourceUpdatedAtRaw)
        ? { sourceUpdatedAt: sourceUpdatedAtRaw }
        : {}),
      ...(typeof inheritedFromFloorIdRaw === "string" ? { inheritedFromFloorId: inheritedFromFloorIdRaw } : {}),
      ...(typeof inheritedFromBranchIdRaw === "string" ? { inheritedFromBranchId: inheritedFromBranchIdRaw } : {}),
    };
  }

  return result;
}

function normalizeSchemaVersion(value: number | null | undefined): BranchLocalSnapshotSchemaVersion {
  return value === BRANCH_LOCAL_SNAPSHOT_SCHEMA_V2
    ? BRANCH_LOCAL_SNAPSHOT_SCHEMA_V2
    : BRANCH_LOCAL_SNAPSHOT_SCHEMA_V1;
}

function toSnapshotRecord(row: BranchLocalVariableSnapshotRow): BranchLocalVariableSnapshotRecord {
  return {
    floorId: row.floorId,
    accountId: row.accountId,
    sessionId: row.sessionId,
    branchId: row.branchId,
    values: parseSnapshotValuesJson(row.valuesJson),
    schemaVersion: normalizeSchemaVersion(row.snapshotVersion),
    provenance: parseProvenanceJson(row.provenanceJson),
    createdAt: row.createdAt,
  };
}

/**
 * persistFloorLocalSnapshot 所使用的内部 materialize 载荷。
 */
interface PersistedSnapshotPayload {
  values: Record<string, unknown>;
  provenance: BranchLocalVariableProvenanceMap;
}

/**
 * 保存并回放分支 local 兼容变量快照。
 *
 * 从 Phase 2 起，快照除 `valuesJson` 外还附带 `provenanceJson`：
 * - `valuesJson` 仍保留完整可见值视图，用于旧消费方与兼容读取
 * - `provenanceJson` 记录每个 key 的来源 scope / scopeId / sourceVariableId /
 *   sourceUpdatedAt / inheritedFromFloorId / inheritedFromBranchId / originKind，
 *   用于 explainability 与后续精确 runtime 恢复
 *
 * 旧 v1 行在读取时 provenance 字段为空对象、`schemaVersion` 视为 `1`。
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
    const payload = this.resolveVisibleLocalPayload({
      accountId: input.accountId,
      sessionId: input.sessionId,
      branchId: input.branchId,
    });

    return this.writeSnapshot({
      accountId: input.accountId,
      floorId: input.floorId,
      sessionId: input.sessionId,
      branchId: input.branchId,
      createdAt: input.createdAt,
      payload,
    });
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

  tryGetSourceFloorLocalValues(input: {
    accountId: string;
    sessionId: string;
    sourceFloorId: string;
    sourceBranchId: string;
  }): ResolvedSourceFloorLocalValues | null {
    const storedSnapshot = this.getFloorLocalSnapshot({
      accountId: input.accountId,
      floorId: input.sourceFloorId,
    });

    if (!storedSnapshot) {
      return null;
    }

    return {
      source: "snapshot",
      values: storedSnapshot.values,
      provenance: storedSnapshot.provenance,
      schemaVersion: storedSnapshot.schemaVersion,
    };
  }

  requireSourceFloorLocalValues(input: {
    accountId: string;
    sessionId: string;
    sourceFloorId: string;
    sourceBranchId: string;
  }): ResolvedSourceFloorLocalValues {
    const resolved = this.tryGetSourceFloorLocalValues(input);

    if (!resolved) {
      throw new BranchLocalSnapshotMissingError({
        accountId: input.accountId,
        sessionId: input.sessionId,
        sourceFloorId: input.sourceFloorId,
        sourceBranchId: input.sourceBranchId,
      });
    }

    return resolved;
  }

  materializeFromSourceFloor(input: {
    accountId: string;
    sessionId: string;
    sourceFloorId: string;
    sourceBranchId: string;
    targetBranchId: string;
    createdAt: number;
  }): MaterializeBranchLocalVariableSnapshotResult {
    const resolvedSource = this.requireSourceFloorLocalValues({
      accountId: input.accountId,
      sessionId: input.sessionId,
      sourceFloorId: input.sourceFloorId,
      sourceBranchId: input.sourceBranchId,
    });
    const values = resolvedSource.values;
    const sourceProvenance = resolvedSource.provenance;
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

    // materialize 之后，把 source 快照的 provenance 传递到目标 branch 的后续快照上。
    // 目标 floor 的快照将由 TurnCommitService 在 commit 时重新 persist；
    // 这里返回的 provenance 供上游与测试观察。
    const materializedProvenance: BranchLocalVariableProvenanceMap = {};
    for (const key of restoredKeys) {
      const origin = sourceProvenance[key];
      materializedProvenance[key] = origin
        ? {
            ...origin,
            inheritedFromFloorId: input.sourceFloorId,
            inheritedFromBranchId: input.sourceBranchId,
            // 继承到新 branch 后，按 inherited 处理；若源是 authored，则标记为 inherited（来自旧 branch）。
            originKind: "inherited",
          }
        : {
            sourceScope: "branch",
            sourceScopeId: buildBranchVariableScopeId(input.sessionId, input.sourceBranchId),
            inheritedFromFloorId: input.sourceFloorId,
            inheritedFromBranchId: input.sourceBranchId,
            originKind: resolvedSource.schemaVersion === BRANCH_LOCAL_SNAPSHOT_SCHEMA_V1
              ? "unknown"
              : "inherited",
          };
    }

    return {
      source: resolvedSource.source,
      targetScopeId,
      restoredCount: restoredKeys.length,
      restoredKeys,
      provenance: materializedProvenance,
    };
  }

  /**
   * 导入/恢复路径专用：直接按已知 payload 写入快照，并保持 provenance 与 schemaVersion 透传。
   *
   * - 若 `schemaVersion` 为 v1，`provenance` 会被忽略并以空对象落库；
   * - 若 `schemaVersion` 为 v2，`provenance` 必须由调用方给出。
   *
   * 该方法主要供 `chat-import-publisher` 在导入时使用。
   */
  restoreSnapshot(input: {
    accountId: string;
    floorId: string;
    sessionId: string;
    branchId: string;
    createdAt: number;
    values: Record<string, unknown>;
    provenance?: BranchLocalVariableProvenanceMap;
    schemaVersion?: BranchLocalSnapshotSchemaVersion;
  }): BranchLocalVariableSnapshotRecord {
    const schemaVersion = input.schemaVersion ?? BRANCH_LOCAL_SNAPSHOT_SCHEMA_V2;
    const provenance = schemaVersion === BRANCH_LOCAL_SNAPSHOT_SCHEMA_V2
      ? input.provenance ?? {}
      : {};

    return this.writeSnapshot({
      accountId: input.accountId,
      floorId: input.floorId,
      sessionId: input.sessionId,
      branchId: input.branchId,
      createdAt: input.createdAt,
      payload: {
        values: input.values,
        provenance,
      },
      schemaVersion,
    });
  }

  /**
   * 内部：把 payload 持久化为一行 branch_local_variable_snapshot。
   */
  private writeSnapshot(input: {
    accountId: string;
    floorId: string;
    sessionId: string;
    branchId: string;
    createdAt: number;
    payload: PersistedSnapshotPayload;
    schemaVersion?: BranchLocalSnapshotSchemaVersion;
  }): BranchLocalVariableSnapshotRecord {
    const schemaVersion = input.schemaVersion ?? BRANCH_LOCAL_SNAPSHOT_SCHEMA_V2;
    const provenance = schemaVersion === BRANCH_LOCAL_SNAPSHOT_SCHEMA_V2
      ? input.payload.provenance
      : {};

    const row: typeof branchLocalVariableSnapshots.$inferInsert = {
      floorId: input.floorId,
      accountId: input.accountId,
      sessionId: input.sessionId,
      branchId: input.branchId,
      valuesJson: JSON.stringify(input.payload.values),
      snapshotVersion: schemaVersion,
      provenanceJson: schemaVersion === BRANCH_LOCAL_SNAPSHOT_SCHEMA_V2
        ? JSON.stringify(provenance)
        : null,
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
          snapshotVersion: row.snapshotVersion,
          provenanceJson: row.provenanceJson,
          createdAt: row.createdAt,
        },
      })
      .run();

    return {
      floorId: input.floorId,
      accountId: input.accountId,
      sessionId: input.sessionId,
      branchId: input.branchId,
      values: input.payload.values,
      schemaVersion,
      provenance,
      createdAt: input.createdAt,
    };
  }

  /**
   * 把 chat-level 与 branch-level 变量合并为一份可见视图，
   * 同时为每个 key 附带 provenance。
   *
   * merge 语义维持 `{ ...chatValues, ...branchValues }`：
   * - branch 层存在则标记 originKind = authored，sourceScope = branch
   * - 仅 chat 层存在则标记 originKind = inherited，sourceScope = chat
   */
  private resolveVisibleLocalPayload(input: {
    accountId: string;
    sessionId: string;
    branchId: string;
  }): PersistedSnapshotPayload {
    const chatRows = this.listScopeRows({
      accountId: input.accountId,
      scope: "chat",
      scopeId: input.sessionId,
    });
    const branchRows = this.listScopeRows({
      accountId: input.accountId,
      scope: "branch",
      scopeId: buildBranchVariableScopeId(input.sessionId, input.branchId),
    });

    const values: Record<string, unknown> = {};
    const provenance: BranchLocalVariableProvenanceMap = {};

    for (const row of chatRows) {
      values[row.key] = row.value;
      provenance[row.key] = {
        sourceScope: "chat",
        sourceScopeId: input.sessionId,
        sourceVariableId: row.id,
        sourceUpdatedAt: row.updatedAt,
        originKind: "inherited",
      };
    }

    for (const row of branchRows) {
      values[row.key] = row.value;
      provenance[row.key] = {
        sourceScope: "branch",
        sourceScopeId: buildBranchVariableScopeId(input.sessionId, input.branchId),
        sourceVariableId: row.id,
        sourceUpdatedAt: row.updatedAt,
        originKind: "authored",
      };
    }

    return { values, provenance };
  }

  private listScopeRows(input: {
    accountId: string;
    scope: VariableScope;
    scopeId: string;
  }): Array<{ id: string; key: string; value: unknown; updatedAt: number }> {
    const rows = this.db
      .select({
        id: variables.id,
        key: variables.key,
        valueJson: variables.valueJson,
        updatedAt: variables.updatedAt,
      })
      .from(variables)
      .where(and(
        eq(variables.accountId, input.accountId),
        eq(variables.scope, input.scope),
        eq(variables.scopeId, input.scopeId),
      ))
      .all()
      .sort((left, right) => left.key.localeCompare(right.key));

    return rows.map((row) => ({
      id: row.id,
      key: row.key,
      value: parseJsonField(row.valueJson),
      updatedAt: row.updatedAt,
    }));
  }
}
