import { createHash } from "node:crypto";

import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { AppDb, DbExecutor } from "../../db/client.js";
import { floors, promptRuntimeInjections } from "../../db/schema.js";
import { OwnedSessionRepository } from "../owned-resource-repositories.js";
import type {
  OperationLogActor,
} from "../operation-log-service.js";
import { OperationLogService } from "../operation-log-service.js";
import type {
  PromptRuntimeInjectionBuilderInput,
  PromptRuntimeInjectionPlacementParams,
  PromptRuntimeInjectionPromptMode,
  PromptRuntimeInjectionScope,
} from "../prompt-runtime-injection-types.js";
import {
  PROMPT_RUNTIME_INJECTION_LIMITS,
  getPromptRuntimeInjectionScopeLimit,
} from "./injection-governance.js";
import { VcDiffService } from "../vc-diff-service.js";

export type PromptRuntimeInjectionServiceDb = AppDb | DbExecutor;

export type PromptRuntimeInjectionOperationLogContext = OperationLogActor & {
  requestId?: string | null;
  operationGroupId?: string | null;
  sourceType: string;
  route: string;
};

export type PromptRuntimeInjectionServiceErrorCode =
  | "session_not_found"
  | "branch_not_found"
  | "injection_not_found"
  | "invalid_injection_payload"
  | "injection_scope_quota_exceeded";

export interface PromptRuntimeInjectionRecord {
  id: string;
  sessionId: string;
  branchId: string | null;
  scope: Exclude<PromptRuntimeInjectionScope, "request">;
  sourceKind: string;
  title: string;
  content: string;
  placement: string;
  placementParams: PromptRuntimeInjectionPlacementParams | null;
  order: number;
  enabled: boolean;
  modeScope: PromptRuntimeInjectionPromptMode | null;
  ttlMs: number | null;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface PromptRuntimeInjectionWriteInput {
  sourceKind: "client_injection" | "agent_injection";
  title: string;
  content: string;
  placement: string;
  placementParams?: PromptRuntimeInjectionPlacementParams | null;
  order?: number;
  enabled?: boolean;
  modeScope?: PromptRuntimeInjectionPromptMode | null;
  ttlMs?: number | null;
}

export interface PromptRuntimeInjectionPatchInput {
  sourceKind?: "client_injection";
  title?: string;
  content?: string;
  placement?: string;
  placementParams?: PromptRuntimeInjectionPlacementParams | null;
  order?: number;
  enabled?: boolean;
  modeScope?: PromptRuntimeInjectionPromptMode | null;
  ttlMs?: number| null;
}

export interface PromptRuntimeInjectionScopeSummary {
  total: number;
  enabled: number;
}

export interface PromptRuntimeInjectionResolvedStateSummary {
  session: PromptRuntimeInjectionScopeSummary;
  branch: PromptRuntimeInjectionScopeSummary;
}

export class PromptRuntimeInjectionServiceError extends Error {
  constructor(
    public readonly statusCode: 400 | 404,
    public readonly code: PromptRuntimeInjectionServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PromptRuntimeInjectionServiceError";
  }
}

export class PromptRuntimeInjectionService {
  constructor(private readonly db: PromptRuntimeInjectionServiceDb) {}

  listSessionInjections(sessionId: string, accountId: string): PromptRuntimeInjectionRecord[] {
    this.requireOwnedSession(accountId, sessionId);
    return this.listByScope(sessionId, null);
  }

  listBranchInjections(
    sessionId: string,
    branchId: string,
    accountId: string,
  ): PromptRuntimeInjectionRecord[] {
    this.requireOwnedSession(accountId, sessionId);
    this.requireMaterializedBranch(accountId, sessionId, branchId);
    return this.listByScope(sessionId, branchId);
  }

  createSessionInjection(
    sessionId: string,
    accountId: string,
    input: PromptRuntimeInjectionWriteInput,
    createdBy?: string | null,
    operationLog?: PromptRuntimeInjectionOperationLogContext,
  ): PromptRuntimeInjectionRecord {
    this.requireOwnedSession(accountId, sessionId);
    return this.db.transaction((tx) => {
      const service = new PromptRuntimeInjectionService(tx);
      service.assertScopeQuotaAvailable(sessionId, null, "session");
      const created = service.insertRecord({
        sessionId,
        branchId: null,
        input,
        createdBy,
      });
      if (operationLog) {
        service.appendOperationLog({
          accountId,
          action: "create_prompt_runtime_injection",
          sessionId,
          branchId: null,
          recordId: created.id,
          beforeRecord: null,
          afterRecord: created,
          operationLog,
          requestFields: ["sourceKind", "title", "content", "placement", "placementParams", "order", "enabled", "modeScope", "ttlMs"],
        });
      }
      return created;
    });
  }

  createBranchInjection(
    sessionId: string,
    branchId: string,
    accountId: string,
    input: PromptRuntimeInjectionWriteInput,
    createdBy?: string | null,
    operationLog?: PromptRuntimeInjectionOperationLogContext,
  ): PromptRuntimeInjectionRecord {
    this.requireOwnedSession(accountId, sessionId);
    this.requireMaterializedBranch(accountId, sessionId, branchId);
    return this.db.transaction((tx) => {
      const service = new PromptRuntimeInjectionService(tx);
      service.assertScopeQuotaAvailable(sessionId, branchId, "branch");
      const created = service.insertRecord({
        sessionId,
        branchId,
        input,
        createdBy,
      });
      if (operationLog) {
        service.appendOperationLog({
          accountId,
          action: "create_prompt_runtime_branch_injection",
          sessionId,
          branchId,
          recordId: created.id,
          beforeRecord: null,
          afterRecord: created,
        operationLog,
        requestFields: ["sourceKind", "title", "content", "placement", "placementParams", "order", "enabled", "modeScope", "ttlMs"],
        });
      }
      return created;
    });
  }

  updateSessionInjection(
    sessionId: string,
    injectionId: string,
    accountId: string,
    patch: PromptRuntimeInjectionPatchInput,
    updatedBy?: string | null,
    operationLog?: PromptRuntimeInjectionOperationLogContext,
  ): PromptRuntimeInjectionRecord {
    this.requireOwnedSession(accountId, sessionId);
    return this.db.transaction((tx) => {
      const service = new PromptRuntimeInjectionService(tx);
      const existing = service.requireInjection(sessionId, null, injectionId);
      const updated = service.updateRecord(existing, patch, updatedBy);
      if (operationLog) {
        service.appendOperationLog({
          accountId,
          action: "update_prompt_runtime_injection",
          sessionId,
          branchId: null,
          recordId: updated.id,
          beforeRecord: existing,
          afterRecord: updated,
          operationLog,
          requestFields: listPatchFieldNames(patch),
        });
      }
      return updated;
    });
  }

  updateBranchInjection(
    sessionId: string,
    branchId: string,
    injectionId: string,
    accountId: string,
    patch: PromptRuntimeInjectionPatchInput,
    updatedBy?: string | null,
    operationLog?: PromptRuntimeInjectionOperationLogContext,
  ): PromptRuntimeInjectionRecord {
    this.requireOwnedSession(accountId, sessionId);
    this.requireMaterializedBranch(accountId, sessionId, branchId);
    return this.db.transaction((tx) => {
      const service = new PromptRuntimeInjectionService(tx);
      const existing = service.requireInjection(sessionId, branchId, injectionId);
      const updated = service.updateRecord(existing, patch, updatedBy);
      if (operationLog) {
        service.appendOperationLog({
          accountId,
          action: "update_prompt_runtime_branch_injection",
          sessionId,
          branchId,
          recordId: updated.id,
          beforeRecord: existing,
          afterRecord: updated,
          operationLog,
          requestFields: listPatchFieldNames(patch),
        });
      }
      return updated;
    });
  }

  deleteSessionInjection(
    sessionId: string,
    injectionId: string,
    accountId: string,
    operationLog?: PromptRuntimeInjectionOperationLogContext,
  ): PromptRuntimeInjectionRecord {
    this.requireOwnedSession(accountId, sessionId);
    return this.db.transaction((tx) => {
      const service = new PromptRuntimeInjectionService(tx);
      const existing = service.requireInjection(sessionId, null, injectionId);
      const deleted = service.deleteRecord(existing.id);
      if (!deleted) {
        throw new PromptRuntimeInjectionServiceError(
          404,
          "injection_not_found",
          `Prompt runtime injection '${injectionId}' not found`,
        );
      }
      if (operationLog) {
        service.appendOperationLog({
          accountId,
          action: "delete_prompt_runtime_injection",
          sessionId,
          branchId: null,
          recordId: deleted.id,
          beforeRecord: existing,
          afterRecord: null,
          operationLog,
          requestFields: [],
        });
      }
      return deleted;
    });
  }

  deleteBranchInjection(
    sessionId: string,
    branchId: string,
    injectionId: string,
    accountId: string,
    operationLog?: PromptRuntimeInjectionOperationLogContext,
  ): PromptRuntimeInjectionRecord {
    this.requireOwnedSession(accountId, sessionId);
    this.requireMaterializedBranch(accountId, sessionId, branchId);
    return this.db.transaction((tx) => {
      const service = new PromptRuntimeInjectionService(tx);
      const existing = service.requireInjection(sessionId, branchId, injectionId);
      const deleted = service.deleteRecord(existing.id);
      if (!deleted) {
        throw new PromptRuntimeInjectionServiceError(
          404,
          "injection_not_found",
          `Prompt runtime injection '${injectionId}' not found`,
        );
      }
      if (operationLog) {
        service.appendOperationLog({
          accountId,
          action: "delete_prompt_runtime_branch_injection",
          sessionId,
          branchId,
          recordId: deleted.id,
          beforeRecord: existing,
          afterRecord: null,
          operationLog,
          requestFields: [],
        });
      }
      return deleted;
    });
  }

  listPersistentInputsForPrompt(
    sessionId: string,
    branchId: string,
    accountId: string,
  ): PromptRuntimeInjectionBuilderInput[] {
    this.requireOwnedSession(accountId, sessionId);
    this.requireMaterializedBranch(accountId, sessionId, branchId);

    const now = Date.now();
    return [
      ...this.listByScope(sessionId, null).filter((record) => !isExpiredRecord(record, now)).map((record) => toBuilderInput(record)),
      ...this.listByScope(sessionId, branchId).filter((record) => !isExpiredRecord(record, now)).map((record) => toBuilderInput(record)),
    ];
  }

  getResolvedStateSummary(
    sessionId: string,
    branchId: string,
    accountId: string,
  ): PromptRuntimeInjectionResolvedStateSummary {
    const sessionInjections = this.listSessionInjections(sessionId, accountId);
    const branchInjections = this.listBranchInjections(sessionId, branchId, accountId);
    return {
      session: buildScopeSummary(sessionInjections),
      branch: buildScopeSummary(branchInjections),
    };
  }

  deleteBranchScopeInjections(sessionId: string, branchId: string): number {
    const deleted = this.db
      .delete(promptRuntimeInjections)
      .where(and(eq(promptRuntimeInjections.sessionId, sessionId), eq(promptRuntimeInjections.branchId, branchId)))
      .returning({ id: promptRuntimeInjections.id })
      .all();
    return deleted.length;
  }

  deleteExpired(now = Date.now()): number {
    const candidates = this.db
      .select({ id: promptRuntimeInjections.id, createdAt: promptRuntimeInjections.createdAt, ttlMs: promptRuntimeInjections.ttlMs })
      .from(promptRuntimeInjections)
      .all();

    const expiredIds = candidates
      .filter((candidate) => candidate.ttlMs !== null && candidate.createdAt + candidate.ttlMs <= now)
      .map((candidate) => candidate.id);

    if (expiredIds.length === 0) {
      return 0;
    }

    return this.db
      .delete(promptRuntimeInjections)
      .where(eq(promptRuntimeInjections.id, expiredIds[0]!))
      .returning({ id: promptRuntimeInjections.id })
      .all().length
      + deleteRemainingExpired(this.db, expiredIds.slice(1));
  }

  private assertScopeQuotaAvailable(
    sessionId: string,
    branchId: string | null,
    scope: Exclude<PromptRuntimeInjectionScope, "request">,
  ): void {
    const now = Date.now();
    const currentCount = this.countUnexpiredByScope(sessionId, branchId, now);
    const limit = getPromptRuntimeInjectionScopeLimit(PROMPT_RUNTIME_INJECTION_LIMITS, scope);
    if (currentCount >= limit) {
      throw new PromptRuntimeInjectionServiceError(
        400,
        "injection_scope_quota_exceeded",
        `Prompt runtime injection ${scope} scope limit exceeded: max ${limit}`,
      );
    }
  }

  private countUnexpiredByScope(sessionId: string, branchId: string | null, now: number): number {
    const rows = this.db
      .select({ id: promptRuntimeInjections.id })
      .from(promptRuntimeInjections)
      .where(
        and(
          eq(promptRuntimeInjections.sessionId, sessionId),
          branchId === null ? isNull(promptRuntimeInjections.branchId) : eq(promptRuntimeInjections.branchId, branchId),
          or(
            isNull(promptRuntimeInjections.ttlMs),
            sql`${promptRuntimeInjections.createdAt} + ${promptRuntimeInjections.ttlMs} > ${now}`,
          ),
        ),
      )
      .all();
    return rows.length;
  }

  private listByScope(sessionId: string, branchId: string | null): PromptRuntimeInjectionRecord[] {
    const rows = this.db
      .select()
      .from(promptRuntimeInjections)
      .where(
        branchId === null
          ? and(eq(promptRuntimeInjections.sessionId, sessionId), isNull(promptRuntimeInjections.branchId))
          : and(eq(promptRuntimeInjections.sessionId, sessionId), eq(promptRuntimeInjections.branchId, branchId))
      )
      .orderBy(
        asc(promptRuntimeInjections.order),
        asc(promptRuntimeInjections.createdAt),
        asc(promptRuntimeInjections.id),
      )
      .all();

    return rows.map((row) => toInjectionRecord(row));
  }

  private insertRecord(args: {
    sessionId: string;
    branchId: string | null;
    input: PromptRuntimeInjectionWriteInput;
    createdBy?: string | null;
  }): PromptRuntimeInjectionRecord {
    const now = Date.now();
    const normalized = normalizeWriteInput(args.input);
    const inserted = this.db
      .insert(promptRuntimeInjections)
      .values({
        id: nanoid(),
        sessionId: args.sessionId,
        branchId: args.branchId,
         sourceKind: normalized.sourceKind,
        title: normalized.title,
        content: normalized.content,
        placement: normalized.placement,
        placementParamsJson: serializePlacementParams(normalized.placementParams),
        order: normalized.order,
        enabled: normalized.enabled,
        modeScope: normalized.modeScope,
        ttlMs: normalized.ttlMs,
        createdBy: normalizeNullableString(args.createdBy),
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .all()[0];

    if (!inserted) {
      throw new Error("Failed to create prompt runtime injection");
    }

    return toInjectionRecord(inserted);
  }

  private updateRecord(
    existing: PromptRuntimeInjectionRecord,
    patch: PromptRuntimeInjectionPatchInput,
    updatedBy?: string | null,
  ): PromptRuntimeInjectionRecord {
    const normalized = normalizePatchInput(existing, patch);
    const updated = this.db
      .update(promptRuntimeInjections)
      .set({
        sourceKind: normalized.sourceKind,
       title: normalized.title,
        content: normalized.content,
        placement: normalized.placement,
        placementParamsJson: serializePlacementParams(normalized.placementParams),
        order: normalized.order,
        enabled: normalized.enabled,
        modeScope: normalized.modeScope,
        ttlMs: normalized.ttlMs,
        createdBy: existing.createdBy ?? normalizeNullableString(updatedBy),
        updatedAt: Date.now(),
      })
      .where(eq(promptRuntimeInjections.id, existing.id))
      .returning()
      .all()[0];

    if (!updated) {
      throw new Error("Failed to update prompt runtime injection");
    }

    return toInjectionRecord(updated);
  }

  private deleteRecord(id: string): PromptRuntimeInjectionRecord | null {
    const deleted = this.db
      .delete(promptRuntimeInjections)
      .where(eq(promptRuntimeInjections.id, id))
      .returning()
      .all()[0];

    return deleted ? toInjectionRecord(deleted) : null;
  }

  private requireOwnedSession(accountId: string, sessionId: string) {
    const session = new OwnedSessionRepository(this.db).getById(accountId, sessionId);
    if (!session) {
      throw new PromptRuntimeInjectionServiceError(
        404,
        "session_not_found",
        `Session '${sessionId}' not found`,
      );
    }
    return session;
  }

  private requireMaterializedBranch(_accountId: string, sessionId: string, branchId: string) {
    const branch = this.db
      .select({ id: floors.id })
      .from(floors)
      .where(and(
        eq(floors.sessionId, sessionId),
        eq(floors.branchId, branchId),
        isNull(floors.supersededAt),
      ))
      .limit(1)
      .all()[0];
    if (!branch) {
      throw new PromptRuntimeInjectionServiceError(
        404,
        "branch_not_found",
        `Branch '${branchId}' not found in session`,
      );
    }
    return branch;
  }

  private requireInjection(
    sessionId: string,
    branchId: string | null,
    injectionId: string,
  ): PromptRuntimeInjectionRecord {
    const row = this.db
      .select()
      .from(promptRuntimeInjections)
      .where(
        branchId === null
          ? and(
              eq(promptRuntimeInjections.id, injectionId),
              eq(promptRuntimeInjections.sessionId, sessionId),
              isNull(promptRuntimeInjections.branchId),
            )
          : and(
              eq(promptRuntimeInjections.id, injectionId),
              eq(promptRuntimeInjections.sessionId, sessionId),
              eq(promptRuntimeInjections.branchId, branchId),
            ),
      )
      .limit(1)
      .all()[0];

    if (!row) {
      throw new PromptRuntimeInjectionServiceError(
        404,
        "injection_not_found",
        `Prompt runtime injection '${injectionId}' not found`,
      );
    }

    return toInjectionRecord(row);
  }

  private appendOperationLog(args: {
    accountId: string;
    action: string;
    sessionId: string;
    branchId: string | null;
    recordId: string;
    beforeRecord: PromptRuntimeInjectionRecord | null;
    afterRecord: PromptRuntimeInjectionRecord | null;
    operationLog: PromptRuntimeInjectionOperationLogContext;
    requestFields: string[];
  }): void {
    new OperationLogService(this.db).append({
      accountId: args.accountId,
      actorType: args.operationLog.actorType,
      actorId: args.operationLog.actorId,
      operationGroupId: args.operationLog.operationGroupId,
      requestId: args.operationLog.requestId,
      sourceType: args.operationLog.sourceType,
      action: args.action,
      status: "succeeded",
      sessionId: args.sessionId,
      branchId: args.branchId,
      targetType: "prompt_runtime_injection",
      targetId: args.recordId,
      beforeRef: args.beforeRecord ? toOperationRef(args.beforeRecord) : null,
      afterRef: args.afterRecord ? toOperationRef(args.afterRecord) : null,
      diff: new VcDiffService().diff(
        args.beforeRecord ? toOperationRef(args.beforeRecord) : null,
        args.afterRecord ? toOperationRef(args.afterRecord) : null,
      ),
      metadata: {
        route: args.operationLog.route,
        scope: args.branchId ? "branch" : "session",
        session_id: args.sessionId,
        branch_id: args.branchId,
        request_fields: args.requestFields,
      },
    });
  }
}

function toInjectionRecord(
  row: typeof promptRuntimeInjections.$inferSelect,
): PromptRuntimeInjectionRecord {
  return {
    id: row.id,
    sessionId: row.sessionId,
    branchId: row.branchId,
    scope: row.branchId ? "branch" : "session",
    sourceKind: row.sourceKind,
    title: row.title,
    content: row.content,
    placement: row.placement,
    placementParams: deserializePlacementParams(row.placementParamsJson),
    order: row.order,
    enabled: row.enabled,
    modeScope: row.modeScope,
    ttlMs: row.ttlMs,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toBuilderInput(record: PromptRuntimeInjectionRecord): PromptRuntimeInjectionBuilderInput {
  return {
    sourceKind: record.sourceKind,
    title: record.title,
    content: record.content,
    placement: record.placement,
    ...(record.placementParams ? { placementParams: record.placementParams } : {}),
    order: record.order,
    scope: record.scope,
    injectionId: record.id,
    enabled: record.enabled,
    modeScope: record.modeScope,
    ttlMs: record.ttlMs,
    createdAt: record.createdAt,
  };
}

function buildScopeSummary(records: PromptRuntimeInjectionRecord[]): PromptRuntimeInjectionScopeSummary {
  return {
    total: records.length,
    enabled: records.filter((record) => record.enabled).length,
  };
}

function normalizeWriteInput(input: PromptRuntimeInjectionWriteInput): Required<PromptRuntimeInjectionWriteInput> {
  return {
    sourceKind: input.sourceKind,
    title: requireTrimmedText(input.title, "title", PROMPT_RUNTIME_INJECTION_LIMITS.titleMaxLength),
    content: requireTrimmedText(input.content, "content", PROMPT_RUNTIME_INJECTION_LIMITS.contentMaxLength),
    placement: requireTrimmedText(input.placement, "placement"),
    placementParams: normalizePlacementParams(input.placementParams),
    order: normalizeOrder(input.order),
    enabled: input.enabled ?? true,
    modeScope: input.modeScope ?? null,
    ttlMs: normalizeNullableTtl(input.ttlMs),
  };
}

function normalizePatchInput(
  existing: PromptRuntimeInjectionRecord,
  patch: PromptRuntimeInjectionPatchInput,
): Required<PromptRuntimeInjectionWriteInput> {
  return {
    sourceKind: patch.sourceKind ?? asClientInjectionSourceKind(existing.sourceKind),
    title: patch.title !== undefined ? requireTrimmedText(patch.title, "title", PROMPT_RUNTIME_INJECTION_LIMITS.titleMaxLength) : existing.title,
    content: patch.content !== undefined ? requireTrimmedText(patch.content, "content", PROMPT_RUNTIME_INJECTION_LIMITS.contentMaxLength) : existing.content,
    placement: patch.placement !== undefined ? requireTrimmedText(patch.placement, "placement") : existing.placement,
    placementParams: patch.placementParams !== undefined ? normalizePlacementParams(patch.placementParams) : existing.placementParams,
    order: patch.order !== undefined ? normalizeOrder(patch.order) : existing.order,
    enabled: patch.enabled ?? existing.enabled,
    modeScope: patch.modeScope !== undefined ? patch.modeScope : existing.modeScope,
    ttlMs: patch.ttlMs !== undefined ? normalizeNullableTtl(patch.ttlMs) : existing.ttlMs,
  };
}

/**
 * I3 placement_params 归一化。
 *
 * 只接受 floor_no / offset / depth 三个非负整数字段；空对象视为无参数并返回 null。
 * 被动列出字段，以免意外持久化未知键。
 */
function normalizePlacementParams(
  params: PromptRuntimeInjectionPlacementParams | null | undefined,
): PromptRuntimeInjectionPlacementParams | null {
  if (params === undefined || params === null) {
    return null;
  }
  const normalized: PromptRuntimeInjectionPlacementParams = {};
  if (params.floorNo !== undefined) {
    normalized.floorNo = requireNonNegativeInteger(params.floorNo, "floor_no");
  }
  if (params.offset !== undefined) {
    normalized.offset = requireNonNegativeInteger(params.offset, "offset");
  }
  if (params.depth !== undefined) {
    normalized.depth = requireNonNegativeInteger(params.depth, "depth");
  }
  return Object.keys(normalized).length > 0 ? normalized : null;
}

function requireNonNegativeInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new PromptRuntimeInjectionServiceError(
      400,
      "invalid_injection_payload",
      `Prompt runtime injection placement_params.${field} must be a non-negative integer`,
    );
  }
  return value;
}

function serializePlacementParams(
  params: PromptRuntimeInjectionPlacementParams | null,
): string | null {
  return params ? JSON.stringify(params) : null;
}

function deserializePlacementParams(
  raw: string | null,
): PromptRuntimeInjectionPlacementParams | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as PromptRuntimeInjectionPlacementParams;
    return normalizePlacementParams(parsed);
  } catch {
    return null;
  }
}

function asClientInjectionSourceKind(value: string): "client_injection" {
  if (value !== "client_injection") {
    throw new PromptRuntimeInjectionServiceError(
      400,
      "invalid_injection_payload",
      `Unsupported prompt runtime injection source_kind '${value}'`,
    );
  }
  return value;
}

function requireTrimmedText(value: string, field: string, maxLength?: number): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new PromptRuntimeInjectionServiceError(
      400,
      "invalid_injection_payload",
      `Prompt runtime injection ${field} must not be empty`,
    );
  }
  if (maxLength !== undefined && trimmed.length > maxLength) {
    throw new PromptRuntimeInjectionServiceError(
      400,
      "invalid_injection_payload",
      `Prompt runtime injection ${field} exceeds max length ${maxLength}`,
    );
  }
  return trimmed;
}

function normalizeOrder(value: number | undefined): number {
  return value ?? 100;
}

function normalizeNullableTtl(value: number | null | undefined): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new PromptRuntimeInjectionServiceError(
      400,
      "invalid_injection_payload",
      "Prompt runtime injection ttl_ms must be a non-negative integer",
    );
  }
  return value;
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function listPatchFieldNames(patch: PromptRuntimeInjectionPatchInput): string[] {
  return Object.entries(patch)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key)
    .sort((left, right) => left.localeCompare(right));
}

function toOperationRef(record: PromptRuntimeInjectionRecord): Record<string, unknown> {
  return {
    scope: record.scope,
    session_id: record.sessionId,
    branch_id: record.branchId,
    source_kind: record.sourceKind,
    placement: record.placement,
    placement_params: record.placementParams,
    order: record.order,
    enabled: record.enabled,
    mode_scope: record.modeScope,
    ttl_ms: record.ttlMs,
    title_length: record.title.length,
    title_hash: hashText(record.title),
    content_length: record.content.length,
    content_hash: hashText(record.content),
    created_by: record.createdBy,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

function hashText(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function isExpiredRecord(record: PromptRuntimeInjectionRecord, now: number): boolean {
  return record.ttlMs !== null && record.createdAt + record.ttlMs <= now;
}

function deleteRemainingExpired(
  db: PromptRuntimeInjectionServiceDb,
  ids: string[],
): number {
  let deletedCount = 0;
  for (const id of ids) {
    deletedCount += db
      .delete(promptRuntimeInjections)
      .where(eq(promptRuntimeInjections.id, id))
      .returning({ id: promptRuntimeInjections.id })
      .all().length;
  }
  return deletedCount;
}
