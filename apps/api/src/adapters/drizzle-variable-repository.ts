import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { VariableScope, VariableEntry } from "@tavern/shared";
import type { VariableRepository, VariableRepositoryOptions } from "@tavern/core";

import type { AppDb, DbExecutor } from "../db/client.js";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../accounts/constants.js";
import { variables } from "../db/schema.js";

type VariableRow = typeof variables.$inferSelect;

function resolveAccountId(options?: VariableRepositoryOptions): string {
  return options?.accountId ?? DEFAULT_ADMIN_ACCOUNT_ID;
}

function toEntry(row: VariableRow): VariableEntry {
  return {
    id: row.id,
    scope: row.scope as VariableScope,
    scopeId: row.scopeId,
    key: row.key,
    value: JSON.parse(row.valueJson),
    updatedAt: row.updatedAt,
  };
}

export class DrizzleVariableRepository implements VariableRepository {
  constructor(private readonly db: AppDb | DbExecutor) {}

  async findByKey(
    scope: VariableScope,
    scopeId: string,
    key: string,
    options?: VariableRepositoryOptions,
  ): Promise<VariableEntry | null> {
    const accountId = resolveAccountId(options);

    const [row] = await this.db
      .select()
      .from(variables)
      .where(
        and(
          eq(variables.accountId, accountId),
          eq(variables.scope, scope),
          eq(variables.scopeId, scopeId),
          eq(variables.key, key),
        ),
      );

    return row ? toEntry(row) : null;
  }

  async findAllByScope(
    scope: VariableScope,
    scopeId: string,
    options?: VariableRepositoryOptions,
  ): Promise<VariableEntry[]> {
    const accountId = resolveAccountId(options);

    const rows = await this.db
      .select()
      .from(variables)
      .where(
        and(
          eq(variables.accountId, accountId),
          eq(variables.scope, scope),
          eq(variables.scopeId, scopeId),
        ),
      );

    return rows.map(toEntry);
  }

  async upsert(
    scope: VariableScope,
    scopeId: string,
    key: string,
    value: unknown,
    options?: VariableRepositoryOptions,
  ): Promise<VariableEntry> {
    const accountId = resolveAccountId(options);
    const now = Date.now();
    const valueJson = JSON.stringify(value);

    const [row] = await this.db
      .insert(variables)
      .values({
        id: nanoid(),
        accountId,
        scope,
        scopeId,
        key,
        valueJson,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [variables.accountId, variables.scope, variables.scopeId, variables.key],
        set: { valueJson, updatedAt: now },
      })
      .returning();

    if (!row) {
      throw new Error("Failed to upsert variable");
    }

    return toEntry(row);
  }

  async deleteById(id: string, options?: VariableRepositoryOptions): Promise<boolean> {
    const accountId = resolveAccountId(options);

    const deleted = await this.db
      .delete(variables)
      .where(and(eq(variables.id, id), eq(variables.accountId, accountId)))
      .returning();

    return deleted.length > 0;
  }

  async deleteByKey(
    scope: VariableScope,
    scopeId: string,
    key: string,
    options?: VariableRepositoryOptions,
  ): Promise<boolean> {
    const accountId = resolveAccountId(options);

    const deleted = await this.db
      .delete(variables)
      .where(
        and(
          eq(variables.accountId, accountId),
          eq(variables.scope, scope),
          eq(variables.scopeId, scopeId),
          eq(variables.key, key),
        ),
      )
      .returning();

    return deleted.length > 0;
  }
}
