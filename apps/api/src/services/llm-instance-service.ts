import { and, eq, isNull, or } from "drizzle-orm";

import type { AppDb } from "../db/client";
import { llmInstanceConfigs, sessions } from "../db/schema";
import {
  parseLlmInstanceCapabilitiesJson,
  resolveLlmInstanceCapabilities,
  normalizeLlmInstanceCapabilities,
  type LlmInstanceCapabilities,
} from "../lib/llm-capabilities.js";
import {
  normalizeBindingParams,
  parseBindingParamsJson,
  type LlmBindingGenerationParams,
} from "../lib/llm-params";
import { createDefaultMutationRuntime } from "./default-mutation-runtime.js";
import type { MutationRuntime } from "./runtime-mutation-types.js";
import {
  CONFIG_MUTATION_KINDS,
  ConfigMutationError,
  type DeleteLlmInstanceConfigMutationPayload,
  type LlmInstanceConfigItemMutationResult,
  type UpsertLlmInstanceConfigMutationPayload,
} from "./config-mutation-applier.js";
import { WorkspaceScopeService } from "./workspace-scope-service.js";

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
  /**
   * @deprecated LI11-3：提示词预设覆盖（指向 `preset` 表），**不是 LLM Profile id**。
   * 选 Profile 走 `llm_profile_binding`（activate / resolveActiveProfiles）。配方走图后废弃，
   * 新写入请走楼层模板图 Narrator 节点 `config.presetRef`，勿扩展本字段用途。
   */
  presetId: string | null;
  modelIdOverride: string | null;
  enabled: boolean;
  params: LlmBindingGenerationParams | null;
  capabilities: LlmInstanceCapabilities | null;
  createdAt: number;
  updatedAt: number;
}

export interface ResolvedInstanceSlot {
  slot: string;
  source: "session_config" | "global_config" | "default";
  scope: LlmInstanceScope | null;
  configId: string | null;
  /** @deprecated LI11-3：提示词预设覆盖（非 Profile id）。配方走图后废弃，新写入走 Narrator 节点 `config.presetRef`；Profile 解析见 `/llm-profiles/runtime`。 */
  presetId: string | null;
  modelIdOverride: string | null;
   enabled: boolean;
  params: LlmBindingGenerationParams | null;
  capabilities: LlmInstanceCapabilities;
}

export interface UpsertInstanceConfigInput {
  /** @deprecated LI11-3：提示词预设覆盖（非 Profile id）。配方走图后废弃，新写入走 Narrator 节点 `config.presetRef`；新客户端勿用它选 Profile，应走 profile binding。 */
  presetId?: string | null;
  modelIdOverride?: string | null;
  enabled?: boolean;
  params?: LlmBindingGenerationParams | null;
  capabilities?: LlmInstanceCapabilities | null;
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

function llmInstanceWorkspaceClause(workspaceId: string) {
  return or(eq(llmInstanceConfigs.workspaceId, workspaceId), isNull(llmInstanceConfigs.workspaceId))!;
}

export class LlmInstanceService {
  private db: AppDb;
  private now: () => number;
  private readonly mutationRuntime: MutationRuntime;

  constructor(db: AppDb, options?: { now?: () => number; mutationRuntime?: MutationRuntime }) {
    this.db = db;
    this.now = options?.now ?? (() => Date.now());
    this.mutationRuntime = options?.mutationRuntime ?? createDefaultMutationRuntime(db, {
      now: this.now,
    });
  }

  async listConfigs(
    accountId: string,
    scope?: LlmInstanceScope,
    scopeId?: string,
  ): Promise<LlmInstanceConfigItem[]> {
    const workspaceId = await this.resolveWorkspaceIdForRead(accountId, scope === "session" ? scopeId : undefined);
    const conditions = [
      eq(llmInstanceConfigs.accountId, accountId),
      llmInstanceWorkspaceClause(workspaceId),
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

  async getConfigsBySlot(
    accountId: string,
    slot: LlmInstanceSlot,
    scope?: LlmInstanceScope,
    scopeId?: string,
  ): Promise<LlmInstanceConfigItem[]> {
    validateSlot(slot);
    const workspaceId = await this.resolveWorkspaceIdForRead(accountId, scope === "session" ? scopeId : undefined);

    const conditions = [
      eq(llmInstanceConfigs.accountId, accountId),
      llmInstanceWorkspaceClause(workspaceId),
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

    try {
      const result = await this.mutationRuntime.applyInline<
        UpsertLlmInstanceConfigMutationPayload,
        LlmInstanceConfigItemMutationResult
      >({
        id: `llm-instance-upsert:${accountId}:${scope}:${scopeId}:${slot}:${this.now()}`,
        kind: CONFIG_MUTATION_KINDS.llmInstanceUpsert,
        source: "api",
        accountId,
        sessionId: scope === "session" ? scopeId : undefined,
        scopeType: "config.llm_instance",
        scopeKey: `${scope}:${scopeId}:${slot}`,
        applyPhase: "inline",
        durability: "transactional",
        replaySafety: "confirm_on_replay",
        payload: { scope, scopeId, slot, input },
        createdAt: this.now(),
      })

      return result ?? (() => { throw new Error("LLM instance upsert returned an empty result"); })();
    } catch (error) {
      throw this.mapMutationError(error);
    }
  }

  async deleteConfig(
    accountId: string,
    scope: LlmInstanceScope,
    scopeId: string,
    slot: LlmInstanceSlot,
  ): Promise<void> {
    validateSlot(slot);

    try {
      await this.mutationRuntime.applyInline<DeleteLlmInstanceConfigMutationPayload, void>({
        id: `llm-instance-delete:${accountId}:${scope}:${scopeId}:${slot}:${this.now()}`,
        kind: CONFIG_MUTATION_KINDS.llmInstanceDelete,
        source: "api",
        accountId,
        sessionId: scope === "session" ? scopeId : undefined,
        scopeType: "config.llm_instance",
        scopeKey: `${scope}:${scopeId}:${slot}`,
        applyPhase: "inline",
        durability: "transactional",
        replaySafety: "confirm_on_replay",
        payload: { scope, scopeId, slot },
        createdAt: this.now(),
      });
    } catch (error) {
      throw this.mapMutationError(error);
    }
  }

  private mapMutationError(error: unknown): LlmInstanceServiceError {
    if (error instanceof LlmInstanceServiceError) {
      return error
    }
    if (error instanceof ConfigMutationError) {
      return new LlmInstanceServiceError(error.code as LlmInstanceServiceError["code"], error.message)
    }
    throw error
  }

  async resolveConfigs(
    accountId: string,
    sessionId?: string,
  ): Promise<ResolvedInstanceSlot[]> {
    const workspaceId = await this.resolveWorkspaceIdForRead(accountId, sessionId);
    const allConfigs = await this.db
      .select()
      .from(llmInstanceConfigs)
      .where(and(
        eq(llmInstanceConfigs.accountId, accountId),
        llmInstanceWorkspaceClause(workspaceId),
      ));

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
      modelIdOverride: null,
      enabled: true,
      params: null,
      capabilities: resolveLlmInstanceCapabilities(undefined),
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
        const capabilities = resolveLlmInstanceCapabilities(parseLlmInstanceCapabilitiesJson(found.capabilitiesJson));
        return {
          slot,
          source: found.scope === "session" ? "session_config" : "global_config",
          scope: found.scope as LlmInstanceScope,
          configId: found.id,
          presetId: found.presetId,
          modelIdOverride: found.modelIdOverride,
          enabled: found.enabled === 1,
          params,
          capabilities,
        };
      }
    }

    return defaultResult;
  }

  private resolveDefaultWorkspaceId(accountId: string): string {
    return new WorkspaceScopeService(this.db).getDefaultWorkspace(accountId).id;
  }

  private async resolveWorkspaceIdForRead(accountId: string, sessionId?: string): Promise<string> {
    if (!sessionId) {
      return this.resolveDefaultWorkspaceId(accountId);
    }

    const [session] = await this.db
      .select({ workspaceId: sessions.workspaceId })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.accountId, accountId)))
      .limit(1);

    return session?.workspaceId ?? this.resolveDefaultWorkspaceId(accountId);
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
    modelIdOverride: row.modelIdOverride,
    enabled: row.enabled === 1,
    params: normalizeBindingParams(parseBindingParamsJson(row.paramsJson), false) ?? null,
    capabilities: normalizeLlmInstanceCapabilities(parseLlmInstanceCapabilitiesJson(row.capabilitiesJson)) ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
