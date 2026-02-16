import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { VariableScope, VariableEntry } from "@tavern/shared";
import type { VariableRepository } from "@tavern/core";

import type { AppDb } from "../db/client.js";
import { variables } from "../db/schema.js";

// ── 内部映射 ──────────────────────────────────────────

type VariableRow = typeof variables.$inferSelect;

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

// ── Adapter ───────────────────────────────────────────

export class DrizzleVariableRepository implements VariableRepository {
  constructor(private readonly db: AppDb) {}

  async findByKey(
    scope: VariableScope,
    scopeId: string,
    key: string,
  ): Promise<VariableEntry | null> {
    const [row] = await this.db
      .select()
      .from(variables)
      .where(
        and(
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
  ): Promise<VariableEntry[]> {
    const rows = await this.db
      .select()
      .from(variables)
      .where(
        and(
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
  ): Promise<VariableEntry> {
    const now = Date.now();
    const valueJson = JSON.stringify(value);

    const [row] = await this.db
      .insert(variables)
      .values({
        id: nanoid(),
        scope,
        scopeId,
        key,
        valueJson,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [variables.scope, variables.scopeId, variables.key],
        set: { valueJson, updatedAt: now },
      })
      .returning();

    return toEntry(row!);
  }

  async deleteById(id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(variables)
      .where(eq(variables.id, id))
      .returning();

    return deleted.length > 0;
  }

  async deleteByKey(
    scope: VariableScope,
    scopeId: string,
    key: string,
  ): Promise<boolean> {
    const deleted = await this.db
      .delete(variables)
      .where(
        and(
          eq(variables.scope, scope),
          eq(variables.scopeId, scopeId),
          eq(variables.key, key),
        ),
      )
      .returning();

    return deleted.length > 0;
  }
}
