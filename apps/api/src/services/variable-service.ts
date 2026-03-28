import { and, asc, count, desc, eq } from "drizzle-orm";
import { createEventBus, type CoreEventBus, VariableResolver } from "@tavern/core";
import { nanoid } from "nanoid";
import type { VariableEntry, VariableScope } from "@tavern/shared";

import type { AppDb, DbExecutor } from "../db/client.js";
import { parseJsonField, stringifyJsonField } from "../lib/http.js";
import { variables } from "../db/schema.js";
import { DrizzleVariableRepository } from "../adapters/drizzle-variable-repository.js";
import { DEFAULT_GLOBAL_SCOPE_ID, VariableHostService, type VariableTarget } from "./variable-host-service.js";
import { VariableServiceError } from "./variable-service-errors.js";

export interface VariableRecord {
  id: string;
  scope: VariableScope;
  scopeId: string;
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
  updatedAt: number;
}

export interface VariableLayerSnapshot {
  scope: VariableScope;
  scopeId: string;
  items: VariableRecord[];
}

export interface ResolvedVariablesSnapshot {
  context: {
    accountId: string;
    sessionId?: string;
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
}

export class VariableService {
  private readonly eventBus: CoreEventBus;
  private readonly now: () => number;
  private readonly hostService: VariableHostService;
  private readonly variableRepo: DrizzleVariableRepository;
  private readonly variableResolver: VariableResolver;

  constructor(private readonly db: AppDb | DbExecutor, options: VariableServiceOptions = {}) {
    this.eventBus = options.eventBus ?? createEventBus();
    this.now = options.now ?? Date.now;
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

    const now = this.now();
    const pendingEvents: Array<{ entry: VariableEntry; isNew: boolean; sessionId?: string }> = [];

    const batchResult = this.requireTransactionalDb().transaction((tx) => {
      let created = 0;
      let updated = 0;

      const results = preparedItems.map((item) => {
        const insertedId = nanoid();
        const row = tx
          .insert(variables)
          .values({
            id: insertedId,
            accountId: item.target.accountId,
            scope: item.target.scope,
            scopeId: item.target.scopeId,
            key: item.key,
            valueJson: item.valueJson,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [variables.accountId, variables.scope, variables.scopeId, variables.key],
            set: {
              valueJson: item.valueJson,
              updatedAt: now,
            },
          })
          .returning()
          .all()[0];

        if (!row) {
          throw new Error("Failed to upsert variable");
        }

        const action: VariableUpsertResult["action"] = row.id === insertedId ? "created" : "updated";
        const entry = toVariableEntry(row);

        if (action === "created") {
          created += 1;
        } else {
          updated += 1;
        }

        pendingEvents.push({
          entry,
          isNew: action === "created",
          sessionId: item.target.sessionId,
        });

        return {
          index: item.index,
          action,
          variable: toVariableRecord(row),
        };
      });

      return {
        results,
        meta: {
          total: results.length,
          created,
          updated,
        },
      };
    });

    for (const event of pendingEvents) {
      await this.eventBus.emit("variable.set", {
        sessionId: event.sessionId,
        entry: event.entry,
        isNew: event.isNew,
      });
    }

    return batchResult;
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
      const normalizedScopeId = target.scope === "global" ? DEFAULT_GLOBAL_SCOPE_ID : target.scopeId;
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

    if (input.scopeId !== undefined) {
      const normalizedScopeId = input.scope === "global" ? DEFAULT_GLOBAL_SCOPE_ID : input.scopeId;
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
      .limit(input.limit)
      .offset(input.offset);

    const totalRows = await this.db
      .select({ total: count() })
      .from(variables)
      .where(whereClause);

    return {
      items: rows.map(toVariableRecord),
      total: Number(totalRows[0]?.total ?? 0),
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

    const target = await this.hostService.resolveTarget(accountId, record.scope, record.scopeId);
    this.hostService.assertWritableTarget(target);

    const deleted = await this.db
      .delete(variables)
      .where(and(eq(variables.id, id), eq(variables.accountId, accountId)))
      .returning({ id: variables.id });

    if (deleted.length === 0) {
      throw new VariableServiceError("variable_not_found", `Variable '${id}' not found`);
    }

    await this.eventBus.emit("variable.deleted", {
      sessionId: target.sessionId,
      id: record.id,
      scope: record.scope,
      key: record.key,
    });
  }

  async resolveSnapshot(input: {
    accountId: string;
    sessionId: string;
    floorId?: string;
    pageId?: string;
    includeLayers?: boolean;
  }): Promise<ResolvedVariablesSnapshot> {
    const context = await this.hostService.resolveContext(input.accountId, {
      sessionId: input.sessionId,
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
        updatedAt: entry.updatedAt,
      }))
      .sort((left, right) => left.key.localeCompare(right.key));

    const snapshot: ResolvedVariablesSnapshot = {
      context: {
        accountId: input.accountId,
        sessionId: context.sessionId,
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

  private async buildLayers(context: {
    accountId?: string;
    sessionId?: string;
    floorId?: string;
    pageId?: string;
    globalScopeId?: string;
  }): Promise<Partial<Record<VariableScope, VariableLayerSnapshot>>> {
    const accountId = context.accountId;

    if (!accountId) {
      return {};
    }

    const layers: Partial<Record<VariableScope, VariableLayerSnapshot>> = {};
    const scopePairs: Array<{ scope: VariableScope; scopeId?: string }> = [
      { scope: "global", scopeId: context.globalScopeId ?? DEFAULT_GLOBAL_SCOPE_ID },
      { scope: "chat", scopeId: context.sessionId },
      { scope: "floor", scopeId: context.floorId },
      { scope: "page", scopeId: context.pageId },
    ];

    for (const pair of scopePairs) {
      if (!pair.scopeId) {
        continue;
      }

      const items = await this.variableRepo.findAllByScope(pair.scope, pair.scopeId, { accountId });
      items.sort((left, right) => left.key.localeCompare(right.key));

      layers[pair.scope] = {
        scope: pair.scope,
        scopeId: pair.scopeId,
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

  private executeInTransactionIfAvailable<T>(action: (executor: AppDb | DbExecutor) => T): T {
    if (hasTransaction(this.db)) {
      return this.db.transaction((tx) => action(tx));
    }

    return action(this.db);
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

  const scopeId = item.scope === "global" ? DEFAULT_GLOBAL_SCOPE_ID : item.scopeId;

  return {
    index,
    key: item.key,
    valueJson,
    updatedAt: item.updatedAt,
    target: createRestoredTarget(accountId, item.scope, scopeId),
  };
}

function toVariableRecord(row: typeof variables.$inferSelect): VariableRecord {
  return {
    id: row.id,
    scope: row.scope,
    scopeId: row.scopeId,
    key: row.key,
    value: parseJsonField(row.valueJson),
    updatedAt: row.updatedAt,
  };
}

function toVariableRecordFromEntry(entry: VariableEntry): VariableRecord {
  return {
    id: entry.id,
    scope: entry.scope,
    scopeId: entry.scopeId,
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
  return {
    accountId,
    scope,
    scopeId,
    context: {
      accountId,
      ...(scope === "chat" ? { sessionId: scopeId } : {}),
      ...(scope === "floor" ? { floorId: scopeId } : {}),
      ...(scope === "page" ? { pageId: scopeId } : {}),
      globalScopeId: DEFAULT_GLOBAL_SCOPE_ID,
    },
  };
}

function hasTransaction(db: AppDb | DbExecutor): db is AppDb {
  return "transaction" in db;
}
