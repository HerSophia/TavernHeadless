import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { AppDb } from "../db/client";
import { llmInstanceConfigs } from "../db/schema";
import {
  normalizeBindingParams,
  parseBindingParamsJson,
  LlmParamsValidationError,
  type LlmBindingGenerationParams,
} from "../lib/llm-params";

const GLOBAL_SCOPE_ID = "global";

export type LlmInstanceScope = "global" | "session";
export type LlmInstanceSlot = "*" | "narrator" | "director" | "verifier" | "memory";

const NAMED_SLOTS: LlmInstanceSlot[] = ["narrator", "director", "verifier", "memory"];
const ALL_SLOTS: LlmInstanceSlot[] = ["*", ...NAMED_SLOTS];
const VALID_SLOTS = new Set<string>(ALL_SLOTS);

export interface LlmInstanceConfigItem {
  id: string;
  scope: LlmInstanceScope;
  scopeId: string;
  instanceSlot: LlmInstanceSlot;
  presetId: string | null;
  enabled: boolean;
  params: LlmBindingGenerationParams | null;
  createdAt: number;
  updatedAt: number;
}

export interface ResolvedInstanceSlot {
  slot: string;
  source: "session_config" | "global_config" | "default";
  scope: LlmInstanceScope | null;
  configId: string | null;
  presetId: string | null;
  enabled: boolean;
  params: LlmBindingGenerationParams | null;
}

export interface UpsertInstanceConfigInput {
  presetId?: string | null;
  enabled?: boolean;
  params?: LlmBindingGenerationParams | null;
}

export class LlmInstanceServiceError extends Error {
  constructor(
    public readonly code:
      | "config_not_found"
      | "invalid_params"
      | "invalid_slot"
      | "missing_session_id",
    message: string
  ) {
    super(message);
    this.name = "LlmInstanceServiceError";
  }
}

export class LlmInstanceService {
  private db: AppDb;
  private now: () => number;

  constructor(db: AppDb, options?: { now?: () => number }) {
    this.db = db;
    this.now = options?.now ?? (() => Date.now());
  }

  async listConfigs(
    accountId: string,
    scope?: LlmInstanceScope,
    scopeId?: string,
  ): Promise<LlmInstanceConfigItem[]> {
    const conditions = [eq(llmInstanceConfigs.accountId, accountId)];

    if (scope) {
      conditions.push(eq(llmInstanceConfigs.scope, scope));
    }
    if (scopeId) {
      conditions.push(eq(llmInstanceConfigs.scopeId, scopeId));
    }

    const rows = await this.db
      .select()
      .from(llmInstanceConfigs)
      .where(and(...conditions));

    return rows.map(toConfigItem);
  }

  async getConfigsBySlot(
    accountId: string,
    slot: LlmInstanceSlot,
    scope?: LlmInstanceScope,
    scopeId?: string,
  ): Promise<LlmInstanceConfigItem[]> {
    validateSlot(slot);

    const conditions = [
      eq(llmInstanceConfigs.accountId, accountId),
      eq(llmInstanceConfigs.instanceSlot, slot),
    ];

    if (scope) {
      conditions.push(eq(llmInstanceConfigs.scope, scope));
    }
    if (scopeId) {
      conditions.push(eq(llmInstanceConfigs.scopeId, scopeId));
    }

    const rows = await this.db
      .select()
      .from(llmInstanceConfigs)
      .where(and(...conditions));

    return rows.map(toConfigItem);
  }

  async upsertConfig(
    accountId: string,
    scope: LlmInstanceScope,
    scopeId: string,
    slot: LlmInstanceSlot,
    input: UpsertInstanceConfigInput,
  ): Promise<LlmInstanceConfigItem> {
    validateSlot(slot);

    const now = this.now();
    const effectiveScopeId = scope === "global" ? GLOBAL_SCOPE_ID : scopeId;

    // Normalize params
    let normalizedParams: LlmBindingGenerationParams | undefined;
    if (input.params !== undefined && input.params !== null) {
      try {
        normalizedParams = normalizeBindingParams(input.params, true);
      } catch (e) {
        if (e instanceof LlmParamsValidationError) {
          throw new LlmInstanceServiceError("invalid_params", e.message);
        }
        throw e;
      }
    }

    // Compute paramsJson: undefined = don't touch, null = clear, string = set
    let paramsJson: string | null | undefined;
    if (input.params === undefined) {
      paramsJson = undefined;
    } else if (input.params === null) {
      paramsJson = null;
    } else {
      paramsJson = normalizedParams ? JSON.stringify(normalizedParams) : null;
    }

    // Build conflict update set (only includes fields that were provided)
    const conflictSet: Partial<typeof llmInstanceConfigs.$inferInsert> = {
      updatedAt: now,
    };
    if (input.presetId !== undefined) {
      conflictSet.presetId = input.presetId;
    }
    if (input.enabled !== undefined) {
      conflictSet.enabled = input.enabled ? 1 : 0;
    }
    if (paramsJson !== undefined) {
      conflictSet.paramsJson = paramsJson;
    }

    await this.db
      .insert(llmInstanceConfigs)
      .values({
        id: nanoid(),
        accountId,
        scope,
        scopeId: effectiveScopeId,
        instanceSlot: slot,
        presetId: input.presetId ?? null,
        enabled: input.enabled === false ? 0 : 1,
        paramsJson: paramsJson ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          llmInstanceConfigs.accountId,
          llmInstanceConfigs.scope,
          llmInstanceConfigs.scopeId,
          llmInstanceConfigs.instanceSlot,
        ],
        set: conflictSet,
      });

    // Read back the upserted row
    const rows = await this.db
      .select()
      .from(llmInstanceConfigs)
      .where(
        and(
          eq(llmInstanceConfigs.accountId, accountId),
          eq(llmInstanceConfigs.scope, scope),
          eq(llmInstanceConfigs.scopeId, effectiveScopeId),
          eq(llmInstanceConfigs.instanceSlot, slot),
        )
      );

    return toConfigItem(rows[0]!);
  }

  async deleteConfig(
    accountId: string,
    scope: LlmInstanceScope,
    scopeId: string,
    slot: LlmInstanceSlot,
  ): Promise<void> {
    validateSlot(slot);

    const effectiveScopeId = scope === "global" ? GLOBAL_SCOPE_ID : scopeId;

    const existing = await this.db
      .select({ id: llmInstanceConfigs.id })
      .from(llmInstanceConfigs)
      .where(
        and(
          eq(llmInstanceConfigs.accountId, accountId),
          eq(llmInstanceConfigs.scope, scope),
          eq(llmInstanceConfigs.scopeId, effectiveScopeId),
          eq(llmInstanceConfigs.instanceSlot, slot),
        )
      );

    if (existing.length === 0) {
      throw new LlmInstanceServiceError(
        "config_not_found",
        `No config found for slot=${slot} scope=${scope} scopeId=${effectiveScopeId}`
      );
    }

    await this.db
      .delete(llmInstanceConfigs)
      .where(eq(llmInstanceConfigs.id, existing[0]!.id));
  }

  async resolveConfigs(
    accountId: string,
    sessionId?: string,
  ): Promise<ResolvedInstanceSlot[]> {
    const allConfigs = await this.db
      .select()
      .from(llmInstanceConfigs)
      .where(eq(llmInstanceConfigs.accountId, accountId));

    const results: ResolvedInstanceSlot[] = [];
    for (const slot of ALL_SLOTS) {
      results.push(this.resolveSlot(slot, allConfigs, sessionId));
    }
    return results;
  }

  private resolveSlot(
    slot: LlmInstanceSlot,
    allConfigs: (typeof llmInstanceConfigs.$inferSelect)[],
    sessionId?: string,
  ): ResolvedInstanceSlot {
    const defaultResult: ResolvedInstanceSlot = {
      slot,
      source: "default",
      scope: null,
      configId: null,
      presetId: null,
      enabled: true,
      params: null,
    };

    // Build priority list: session(slot) → session(*) → global(slot) → global(*)
    const candidates: Array<{ scope: LlmInstanceScope; scopeId: string; slot: LlmInstanceSlot }> = [];

    if (slot === "*") {
      if (sessionId) {
        candidates.push({ scope: "session", scopeId: sessionId, slot: "*" });
      }
      candidates.push({ scope: "global", scopeId: GLOBAL_SCOPE_ID, slot: "*" });
    } else {
      if (sessionId) {
        candidates.push({ scope: "session", scopeId: sessionId, slot });
        candidates.push({ scope: "session", scopeId: sessionId, slot: "*" });
      }
      candidates.push({ scope: "global", scopeId: GLOBAL_SCOPE_ID, slot });
      candidates.push({ scope: "global", scopeId: GLOBAL_SCOPE_ID, slot: "*" });
    }

    for (const c of candidates) {
      const found = allConfigs.find(
        (row) =>
          row.scope === c.scope &&
          row.scopeId === c.scopeId &&
          row.instanceSlot === c.slot
      );

      if (found) {
        const params = normalizeBindingParams(parseBindingParamsJson(found.paramsJson), false) ?? null;
        return {
          slot,
          source: found.scope === "session" ? "session_config" : "global_config",
          scope: found.scope as LlmInstanceScope,
          configId: found.id,
          presetId: found.presetId,
          enabled: found.enabled === 1,
          params,
        };
      }
    }

    return defaultResult;
  }
}

// ── Helpers ──

function validateSlot(slot: string): asserts slot is LlmInstanceSlot {
  if (!VALID_SLOTS.has(slot)) {
    throw new LlmInstanceServiceError(
      "invalid_slot",
      `Invalid instance slot: ${slot}. Must be one of: ${ALL_SLOTS.join(", ")}`
    );
  }
}

function toConfigItem(row: typeof llmInstanceConfigs.$inferSelect): LlmInstanceConfigItem {
  return {
    id: row.id,
    scope: row.scope as LlmInstanceScope,
    scopeId: row.scopeId,
    instanceSlot: row.instanceSlot as LlmInstanceSlot,
    presetId: row.presetId,
    enabled: row.enabled === 1,
    params: normalizeBindingParams(parseBindingParamsJson(row.paramsJson), false) ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
