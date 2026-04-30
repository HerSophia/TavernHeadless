import { and, asc, desc, eq } from "drizzle-orm";
import { createEventBus, type CoreEventBus, VariableResolver } from "@tavern/core";
import { nanoid } from "nanoid";
import {
  buildBranchVariableScopeId,
  parseBranchVariableScopeId,
  type BranchVariableScopeRef,
  type VariableEntry,
  type VariableScope,
} from "@tavern/shared";

import type { AppDb, DbExecutor } from "../../db/client.js";
import { parseJsonField, stringifyJsonField } from "../../lib/http.js";
import { variables } from "../../db/schema.js";
import { DrizzleVariableRepository } from "../../adapters/drizzle-variable-repository.js";
import { DEFAULT_GLOBAL_SCOPE_ID, VariableHostService, type VariableTarget } from "./host/variable-host-service.js";
import { VariableServiceError } from "../variable-service-errors.js";
import { createDefaultMutationRuntime } from "../default-mutation-runtime.js";
import type { MutationRuntime } from "../runtime-mutation-types.js";
import {
  VARIABLE_MUTATION_KINDS,
  type VariableDeleteMutationPayload,
  type VariableSetMutationPayload,
  type VariableSetMutationResult,
} from "../variable-mutation-applier.js";

export interface VariableRecord {
  id: string;
  scope: VariableScope;
  scopeId: string;
  scopeRef?: BranchVariableScopeRef;
  key: string;
  value: unknown;
  updatedAt: number;
}

export interface VariableListOptions {
  accountId: string;
  limit: number;
  offset: number;
  sortBy: "updated_at" | "key";
  sortOrder: "asc" | "desc";
  scope?: VariableScope;
  scopeId?: string;
  sessionId?: string;
  branchId?: string;
  key?: string;
}

export interface VariableUpsertInput {
  accountId: string;
  scope: VariableScope;
  scopeId: string;
  key: string;
  value: unknown;
}

export interface VariableUpsertResult {
  action: "created" | "updated";
  variable: VariableRecord;
}

export interface VariableBatchUpsertResult {
  results: Array<{
    index: number;
    action: "created" | "updated";
    variable: VariableRecord;
  }>;
  meta: {
    total: number;
    created: number;
    updated: number;
  };
}

export interface ResolvedVariableRecord {
  key: string;
  value: unknown;
  sourceScope: VariableScope;
  sourceScopeId: string;
  sourceScopeRef?: BranchVariableScopeRef;
  updatedAt: number;
}

export interface VariableLayerSnapshot {
  scope: VariableScope;
  scopeId: string;
  scopeRef?: BranchVariableScopeRef;
  items: VariableRecord[];
}

export interface ResolvedVariablesSnapshot {
  context: {
    accountId: string;
    sessionId?: string;
    branchId?: string;
    floorId?: string;
    pageId?: string;
    globalScopeId: string;
  };
  resolved: ResolvedVariableRecord[];
  layers?: Partial<Record<VariableScope, VariableLayerSnapshot>>;
}

interface PreparedVariableWrite {
  index: number;
  key: string;
  valueJson: string;
  target: VariableTarget;
}

interface PreparedRestoredVariableWrite extends PreparedVariableWrite {
  updatedAt: number;
}

interface VariableServiceOptions {
  eventBus?: CoreEventBus;
  now?: () => number;
  mutationRuntime?: MutationRuntime;
}

export class VariableService {
  private readonly eventBus: CoreEventBus;
  private readonly now: () => number;
  private readonly mutationRuntime?: MutationRuntime;
  private readonly hostService: VariableHostService;
  private readonly variableRepo: DrizzleVariableRepository;
  private readonly variableResolver: VariableResolver;

  constructor(private readonly db: AppDb | DbExecutor, options: VariableServiceOptions = {}) {
    this.eventBus = options.eventBus ?? createEventBus();
    this.now = options.now ?? Date.now;
    this.mutationRuntime = options.mutationRuntime
      ?? (hasTransaction(this.db)
        ? createDefaultMutationRuntime(this.db, {
          eventBus: this.eventBus,
          now: this.now,
        })
        : undefined);
    this.hostService = new VariableHostService(db);
    this.variableRepo = new DrizzleVariableRepository(db);
    this.variableResolver = new VariableResolver(this.variableRepo);
  }

  async upsert(input: VariableUpsertInput): Promise<VariableUpsertResult> {
    const result = await this.upsertMany({ accountId: input.accountId, items: [input] });
    const item = result.results[0];

    if (!item) {
      throw new Error("Variable upsert returned an empty result set");
    }

    return {
      action: item.action,
      variable: item.variable,
    };
  }

  async upsertMany(input: {
    accountId: string;
    items: VariableUpsertInput[];
  }): Promise<VariableBatchUpsertResult> {
    const preparedItems: PreparedVariableWrite[] = [];

    for (const [index, item] of input.items.entries()) {
      preparedItems.push(await this.prepareWrite(index, item));
    }

    ensureNoDuplicateTargets(preparedItems);

    const mutationRuntime = this.requireMutationRuntime();
    const mutationResult = await mutationRuntime.applyInline<VariableSetMutationPayload, VariableSetMutationResult>(
      this.createSetMutationEnvelope(input.accountId, preparedItems, this.now()),
    );

    if (!mutationResult) {
      throw new Error("Variable upsert returned an empty mutation result");
    }

    return {
      results: mutationResult.results.map((item) => ({
        index: item.index,
        action: item.action,
        variable: toVariableRecordFromEntry(item.variable),
      })),
      meta: mutationResult.meta,
    };
  }

  restoreMany(input: {
    accountId: string;
    items: Array<{
      scope: VariableScope;
      scopeId: string;
      key: string;
      value: unknown;
      updatedAt: number;
    }>;
  }): VariableRecord[] {
    const preparedItems = input.items.map((item, index) => prepareRestoredWrite(input.accountId, index, item));
    ensureNoDuplicateTargets(preparedItems);

    return this.executeInTransactionIfAvailable((executor) => {
      return preparedItems.map((item) => {
        const insertedId = nanoid();
        const row = executor
          .insert(variables)
          .values({
            id: insertedId,
            accountId: item.target.accountId,
            scope: item.target.scope,
            scopeId: item.target.scopeId,
            key: item.key,
            valueJson: item.valueJson,
            updatedAt: item.updatedAt,
          })
          .onConflictDoUpdate({
            target: [variables.accountId, variables.scope, variables.scopeId, variables.key],
            set: {
              valueJson: item.valueJson,
              updatedAt: item.updatedAt,
            },
          })
          .returning()
          .all()[0];

        if (!row) {
          throw new Error("Failed to restore variable");
        }

        return toVariableRecord(row);
      });
    });
  }

  listByTargets(input: {
    accountId: string;
    targets: Array<{
      scope: VariableScope;
      scopeId: string;
    }>;
  }): VariableRecord[] {
    const orderedTargets: Array<{ scope: VariableScope; scopeId: string }> = [];
    const targetRows = new Map<string, VariableRecord[]>();

    for (const target of input.targets) {
      const normalizedScopeId = normalizeStoredScopeId(target.scope, target.scopeId);
      const identity = buildScopeIdentity(target.scope, normalizedScopeId);

      if (targetRows.has(identity)) {
        continue;
      }

      orderedTargets.push({ scope: target.scope, scopeId: normalizedScopeId });

      const rows = this.db
        .select()
        .from(variables)
        .where(
          and(
            eq(variables.accountId, input.accountId),
            eq(variables.scope, target.scope),
            eq(variables.scopeId, normalizedScopeId),
          ),
        )
        .all();

      targetRows.set(identity, rows.map(toVariableRecord));
    }

    return orderedTargets.flatMap((target) => {
      return targetRows.get(buildScopeIdentity(target.scope, target.scopeId)) ?? [];
    });
  }

  async list(input: VariableListOptions): Promise<{ items: VariableRecord[]; total: number }> {
    const filters = [eq(variables.accountId, input.accountId)];

    if (input.scope !== undefined) {
      filters.push(eq(variables.scope, input.scope));
    }

    const normalizedScopeId = resolveListScopeId(input);
    if (normalizedScopeId !== undefined) {
      filters.push(eq(variables.scopeId, normalizedScopeId));
    }

    if (input.key !== undefined) {
      filters.push(eq(variables.key, input.key));
    }

    const whereClause = and(...filters);
    const sortColumn = input.sortBy === "key" ? variables.key : variables.updatedAt;
    const orderBy = input.sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn);

    const rows = await this.db
      .select()
      .from(variables)
      .where(whereClause)
      .orderBy(orderBy)
      .all();

    const visibleRows = await this.filterVisibleVariableRows(rows, input.accountId);
    const pagedRows = visibleRows.slice(input.offset, input.offset + input.limit);

    return {
      items: pagedRows.map(toVariableRecord),
      total: visibleRows.length,
    };
  }

  async getDetail(id: string, accountId: string): Promise<VariableRecord> {
    const row = await this.db
      .select()
      .from(variables)
      .where(and(eq(variables.id, id), eq(variables.accountId, accountId)))
      .limit(1);

    const record = row[0];

    if (!record) {
      throw new VariableServiceError("variable_not_found", `Variable '${id}' not found`);
    }

    if (!(await this.isVariableRowVisible(record, accountId))) {
      throw new VariableServiceError("variable_not_found", `Variable '${id}' not found`);
    }

    return toVariableRecord(record);
  }

  async remove(id: string, accountId: string): Promise<void> {
    const row = await this.db
      .select()
      .from(variables)
      .where(and(eq(variables.id, id), eq(variables.accountId, accountId)))
      .limit(1);

    const record = row[0];

    if (!record) {
      throw new VariableServiceError("variable_not_found", `Variable '${id}' not found`);
    }

    let target: VariableTarget | undefined;
    try {
      target = await this.hostService.resolveTarget(accountId, record.scope, record.scopeId);
      this.hostService.assertWritableTarget(target);
    } catch (error) {
      if (!(error instanceof VariableServiceError) || error.code !== "variable_host_not_found") {
        throw error;
      }
    }

    const mutationRuntime = this.requireMutationRuntime();
    await mutationRuntime.applyInline<VariableDeleteMutationPayload, { id: string; deleted: true }>(
      this.createDeleteMutationEnvelope(
        accountId,
        toVariableRecord(record),
        target?.sessionId,
        target?.branchId,
      ),
    );
  }

  async resolveSnapshot(input: {
    accountId: string;
    sessionId: string;
    branchId?: string;
    floorId?: string;
    pageId?: string;
    includeLayers?: boolean;
  }): Promise<ResolvedVariablesSnapshot> {
    const context = await this.hostService.resolveContext(input.accountId, {
      sessionId: input.sessionId,
      branchId: input.branchId,
      floorId: input.floorId,
      pageId: input.pageId,
      globalScopeId: DEFAULT_GLOBAL_SCOPE_ID,
    });

    const resolved = Array.from((await this.variableResolver.resolveAll(context)).values())
      .map<ResolvedVariableRecord>((entry) => ({
        key: entry.key,
        value: entry.value,
        sourceScope: entry.scope,
        sourceScopeId: entry.scopeId,
        ...(toBranchScopeRef(entry.scope, entry.scopeId) ? { sourceScopeRef: toBranchScopeRef(entry.scope, entry.scopeId) } : {}),
        updatedAt: entry.updatedAt,
      }))
      .sort((left, right) => left.key.localeCompare(right.key));

    const snapshot: ResolvedVariablesSnapshot = {
      context: {
        accountId: input.accountId,
        sessionId: context.sessionId,
        branchId: context.branchId,
        floorId: context.floorId,
        pageId: context.pageId,
        globalScopeId: context.globalScopeId ?? DEFAULT_GLOBAL_SCOPE_ID,
      },
      resolved,
    };

    if (input.includeLayers) {
      snapshot.layers = await this.buildLayers(context);
    }

    return snapshot;
  }

  private async prepareWrite(index: number, input: VariableUpsertInput): Promise<PreparedVariableWrite> {
    const valueJson = stringifyJsonField(input.value);

    if (valueJson === null) {
      throw new VariableServiceError("invalid_variable_value", "Variable value cannot be undefined");
    }

    const target = await this.hostService.resolveTarget(input.accountId, input.scope, input.scopeId);
    this.hostService.assertWritableTarget(target);

    return {
      index,
      key: input.key,
      valueJson,
      target,
    };
  }

  private createSetMutationEnvelope(
    accountId: string,
    items: PreparedVariableWrite[],
    updatedAt: number,
  ) {
    const first = items[0];
    const sameScope = first !== undefined
      && items.every((item) => item.target.scope === first.target.scope && item.target.scopeId === first.target.scopeId);

    return {
      id: `variable-set:${nanoid()}`,
      kind: VARIABLE_MUTATION_KINDS.set,
      source: "api" as const,
      accountId,
      sessionId: sameScope ? first?.target.sessionId : undefined,
      scopeType: "variable",
      scopeKey: sameScope && first
        ? `${first.target.scope}:${first.target.scopeId}`
        : `account:${accountId}`,
      applyPhase: "inline" as const,
      durability: "transactional" as const,
      replaySafety: "safe" as const,
      conflictPolicy: "replace" as const,
      payload: {
        items: items.map((item) => ({
          index: item.index,
          scope: item.target.scope,
          scopeId: item.target.scopeId,
          key: item.key,
          valueJson: item.valueJson,
          updatedAt,
          sessionId: item.target.sessionId,
          branchId: item.target.branchId,
        })),
        emitEvents: true,
      } satisfies VariableSetMutationPayload,
      createdAt: updatedAt,
    };
  }

  private createDeleteMutationEnvelope(
    accountId: string,
    record: VariableRecord,
    sessionId?: string,
    branchId?: string,
  ) {
    return {
      id: `variable-delete:${record.id}`,
      kind: VARIABLE_MUTATION_KINDS.delete,
      source: "api" as const,
      accountId,
      sessionId,
      scopeType: "variable",
      scopeKey: `${record.scope}:${record.scopeId}`,
      applyPhase: "inline" as const,
      durability: "transactional" as const,
      replaySafety: "safe" as const,
      payload: {
        id: record.id,
        scope: record.scope,
        scopeId: record.scopeId,
        key: record.key,
        sessionId,
        branchId,
        emitEvent: true,
      } satisfies VariableDeleteMutationPayload,
      createdAt: this.now(),
    };
  }

  private async buildLayers(context: {
    accountId?: string;
    sessionId?: string;
    branchId?: string;
    floorId?: string;
    pageId?: string;
    globalScopeId?: string;
  }): Promise<Partial<Record<VariableScope, VariableLayerSnapshot>>> {
    const accountId = context.accountId;

    if (!accountId) {
      return {};
    }

    const branchScopeId = context.sessionId && context.branchId
      ? buildBranchVariableScopeId(context.sessionId, context.branchId)
      : undefined;

    const layers: Partial<Record<VariableScope, VariableLayerSnapshot>> = {};
    const scopePairs: Array<{ scope: VariableScope; scopeId?: string }> = [
      { scope: "global", scopeId: context.globalScopeId ?? DEFAULT_GLOBAL_SCOPE_ID },
      { scope: "chat", scopeId: context.sessionId },
      { scope: "branch", scopeId: branchScopeId },
      { scope: "floor", scopeId: context.floorId },
      { scope: "page", scopeId: context.pageId },
    ];

    for (const pair of scopePairs) {
      if (!pair.scopeId) {
        continue;
      }

      const items = await this.variableRepo.findAllByScope(pair.scope, pair.scopeId, { accountId });
      items.sort((left, right) => left.key.localeCompare(right.key));

      const scopeRef = toBranchScopeRef(pair.scope, pair.scopeId);
      layers[pair.scope] = {
        scope: pair.scope,
        scopeId: pair.scopeId,
        ...(scopeRef ? { scopeRef } : {}),
        items: items.map(toVariableRecordFromEntry),
      };
    }

    return layers;
  }

  private requireTransactionalDb(): AppDb {
    if (!hasTransaction(this.db)) {
      throw new Error("VariableService operation requires AppDb transaction support");
    }

    return this.db;
  }

  private requireMutationRuntime(): MutationRuntime {
    if (!this.mutationRuntime) {
      throw new Error("VariableService write operation requires mutationRuntime or AppDb transaction support");
    }

    return this.mutationRuntime;
  }

  private executeInTransactionIfAvailable<T>(action: (executor: AppDb | DbExecutor) => T): T {
    if (hasTransaction(this.db)) {
      return this.db.transaction((tx) => action(tx));
    }

    return action(this.db);
  }

  private async filterVisibleVariableRows(
    rows: Array<typeof variables.$inferSelect>,
    accountId: string,
  ): Promise<Array<typeof variables.$inferSelect>> {
    const hostVisibility = new Map<string, boolean>();
    const visibleRows: Array<typeof variables.$inferSelect> = [];

    for (const row of rows) {
      if (await this.isVariableRowVisible(row, accountId, hostVisibility)) {
        visibleRows.push(row);
      }
    }

    return visibleRows;
  }

  private async isVariableRowVisible(
    row: typeof variables.$inferSelect,
    accountId: string,
    hostVisibility = new Map<string, boolean>(),
  ): Promise<boolean> {
    if (row.scope === "global") {
      return true;
    }

    const identity = buildScopeIdentity(row.scope, row.scopeId);
    const cached = hostVisibility.get(identity);
    if (cached !== undefined) {
      return cached;
    }

    try {
      await this.hostService.resolveTarget(accountId, row.scope, row.scopeId);
      hostVisibility.set(identity, true);
      return true;
    } catch (error) {
      if (error instanceof VariableServiceError && error.code === "variable_host_not_found") {
        hostVisibility.set(identity, false);
        return false;
      }

      throw error;
    }
  }
}

function ensureNoDuplicateTargets(items: PreparedVariableWrite[]): void {
  const seen = new Map<string, number>();

  for (const item of items) {
    const identity = buildTargetIdentity(item.target.scope, item.target.scopeId, item.key);
    const firstIndex = seen.get(identity);

    if (firstIndex !== undefined) {
      throw new VariableServiceError(
        "duplicate_variable_target",
        `Duplicate variable target also appears at items.${firstIndex}`
      );
    }

    seen.set(identity, item.index);
  }
}

function buildTargetIdentity(scope: VariableScope, scopeId: string, key: string): string {
  return `${scope}\u0000${scopeId}\u0000${key}`;
}

function buildScopeIdentity(scope: VariableScope, scopeId: string): string {
  return `${scope}\u0000${scopeId}`;
}

function prepareRestoredWrite(
  accountId: string,
  index: number,
  item: {
    scope: VariableScope;
    scopeId: string;
    key: string;
    value: unknown;
    updatedAt: number;
  }
): PreparedRestoredVariableWrite {
  const valueJson = stringifyJsonField(item.value);

  if (valueJson === null) {
    throw new VariableServiceError("invalid_variable_value", "Variable value cannot be undefined");
  }

  const scopeId = normalizeStoredScopeId(item.scope, item.scopeId);

  return {
    index,
    key: item.key,
    valueJson,
    updatedAt: item.updatedAt,
    target: createRestoredTarget(accountId, item.scope, scopeId),
  };
}

function toVariableRecord(row: typeof variables.$inferSelect): VariableRecord {
  const scopeRef = toBranchScopeRef(row.scope, row.scopeId);
  return {
    id: row.id,
    scope: row.scope,
    scopeId: row.scopeId,
    ...(scopeRef ? { scopeRef } : {}),
    key: row.key,
    value: parseJsonField(row.valueJson),
    updatedAt: row.updatedAt,
  };
}

function toVariableRecordFromEntry(entry: VariableEntry): VariableRecord {
  const scopeRef = toBranchScopeRef(entry.scope, entry.scopeId);
  return {
    id: entry.id,
    scope: entry.scope,
    scopeId: entry.scopeId,
    ...(scopeRef ? { scopeRef } : {}),
    key: entry.key,
    value: entry.value,
    updatedAt: entry.updatedAt,
  };
}

function toVariableEntry(row: typeof variables.$inferSelect): VariableEntry {
  return {
    id: row.id,
    scope: row.scope,
    scopeId: row.scopeId,
    key: row.key,
    value: parseJsonField(row.valueJson),
    updatedAt: row.updatedAt,
  };
}

function createRestoredTarget(accountId: string, scope: VariableScope, scopeId: string): VariableTarget {
  const branchScopeRef = scope === "branch" ? parseBranchVariableScopeId(scopeId) : null;

  return {
    accountId,
    scope,
    scopeId,
    ...(branchScopeRef ? { sessionId: branchScopeRef.sessionId, branchId: branchScopeRef.branchId } : {}),
    context: {
      accountId,
      ...(scope === "chat" ? { sessionId: scopeId } : {}),
      ...(branchScopeRef ? { sessionId: branchScopeRef.sessionId, branchId: branchScopeRef.branchId } : {}),
      ...(scope === "floor" ? { floorId: scopeId } : {}),
      ...(scope === "page" ? { pageId: scopeId } : {}),
      globalScopeId: DEFAULT_GLOBAL_SCOPE_ID,
    },
  };
}

function normalizeStoredScopeId(scope: VariableScope, scopeId: string): string {
  if (scope === "global") {
    return DEFAULT_GLOBAL_SCOPE_ID;
  }

  return scopeId;
}

function resolveListScopeId(input: VariableListOptions): string | undefined {
  if (input.scope === "branch") {
    if (input.branchId !== undefined && input.sessionId === undefined) {
      throw new VariableServiceError(
        "invalid_variable_context",
        "branch_id requires session_id when listing branch variables"
      );
    }

    if (input.scopeId !== undefined && input.sessionId !== undefined && input.branchId !== undefined) {
      const normalizedBranchScopeId = buildBranchVariableScopeId(input.sessionId, input.branchId);
      if (normalizedBranchScopeId !== input.scopeId) {
        throw new VariableServiceError(
          "invalid_variable_context",
          "scope_id does not match the provided session_id + branch_id"
        );
      }
    }

    if (input.scopeId !== undefined) {
      if (!parseBranchVariableScopeId(input.scopeId)) {
        throw new VariableServiceError(
          "invalid_variable_context",
          `Invalid branch scope_id '${input.scopeId}'`
        );
      }

      return input.scopeId;
    }

    if (input.sessionId !== undefined && input.branchId !== undefined) {
      return buildBranchVariableScopeId(input.sessionId, input.branchId);
    }

    return undefined;
  }

  if (input.sessionId !== undefined || input.branchId !== undefined) {
    throw new VariableServiceError(
      "invalid_variable_context",
      "session_id and branch_id are only supported when scope is 'branch'"
    );
  }

  if (input.scopeId !== undefined) {
    return input.scope === "global" ? DEFAULT_GLOBAL_SCOPE_ID : input.scopeId;
  }

  return undefined;
}

function toBranchScopeRef(scope: VariableScope, scopeId: string): BranchVariableScopeRef | undefined {
  if (scope !== "branch") {
    return undefined;
  }

  return parseBranchVariableScopeId(scopeId) ?? undefined;
}

function hasTransaction(db: AppDb | DbExecutor): db is AppDb {
  return "transaction" in db;
}
