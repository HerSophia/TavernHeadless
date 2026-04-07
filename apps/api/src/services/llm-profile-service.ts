import { and, desc, eq, inArray, ne, or } from "drizzle-orm";
import type { DbExecutor } from "../db/client";
import type { InstanceSlot, ProviderType } from "@tavern/core";

import type { AccountContextOptions } from "../accounts/account-context";
import { resolveAccountIdOrThrow } from "../accounts/account-context";
import type { AppDb } from "../db/client";
import { llmProfileBindings, llmProfiles, sessions } from "../db/schema";
import { decryptSecret, SecretFormatError } from "../lib/secrets";
import { normalizeBindingParams, parseBindingParamsJson, type LlmBindingGenerationParams } from "../lib/llm-params";
import { createDefaultMutationRuntime } from "./default-mutation-runtime.js";
import type { MutationRuntime } from "./runtime-mutation-types.js";
import {
  CONFIG_MUTATION_KINDS,
  ConfigMutationError,
  type ActivateLlmProfileMutationPayload,
  type CreateLlmProfileMutationPayload,
  type DeleteLlmProfileMutationPayload,
  type LlmProfileListItemMutationResult,
  type UnbindLlmProfileMutationPayload,
  type UpdateLlmProfileMutationPayload,
} from "./config-mutation-applier.js";
export type { LlmBindingGenerationParams };

const GLOBAL_SCOPE_ID = "global";

export type LlmProfileScope = "global" | "session";
export type LlmProfileStatus = "active" | "disabled" | "deleted";

export type LlmProfileListItem = {
  id: string;
  presetName: string;
  provider: ProviderType;
  modelId: string;
  baseUrl: string | null;
  apiKeyName: string | null;
  apiKeyMasked: string;
  status: LlmProfileStatus;
  lastUsedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type LlmProfileResolved = {
  source: "session" | "global";
  profileId: string;
  presetName: string;
  provider: ProviderType;
  modelId: string;
  baseUrl: string | null;
  apiKey: string;
  params: LlmBindingGenerationParams;
};

export type CreateLlmProfileInput = {
  presetName: string;
  provider: ProviderType;
  modelId: string;
  baseUrl?: string | null;
  apiKeyName?: string | null;
  apiKey: string;
};

export type UpdateLlmProfileInput = {
  presetName?: string;
  provider?: ProviderType;
  modelId?: string;
  baseUrl?: string | null;
  apiKeyName?: string | null;
  apiKey?: string;
  status?: Exclude<LlmProfileStatus, "deleted">;
};

export class LlmProfileServiceError extends Error {
  constructor(
    public readonly code:
      | "binding_not_found"
      | "invalid_params"
      | "profile_conflict"
      | "profile_in_use"
      | "profile_inactive"
      | "profile_not_found"
      | "secret_unavailable"
      | "secret_invalid_format"
      | "session_scope_not_found",
    message: string
  ) {
    super(message);
    this.name = "LlmProfileServiceError";
  }
}

type ServiceOptions = {
  masterKey?: string;
  now?: () => number;
  mutationRuntime?: MutationRuntime;
} & AccountContextOptions;

/** Internal row shape returned by loadAllBindings */
type BindingRow = {
  scope: LlmProfileScope;
  scopeId: string;
  instanceSlot: string;
  profileId: string;
  presetName: string;
  provider: ProviderType;
  modelId: string;
  baseUrl: string | null;
  apiKeyEncrypted: string;
  paramsJson: string | null;
};

export class LlmProfileService {
  private readonly db: AppDb;
  private readonly now: () => number;
  private readonly masterKey: string;
  private readonly mutationRuntime: MutationRuntime;
  private readonly accountContext: AccountContextOptions;

  constructor(db: AppDb, options: ServiceOptions = {}) {
    this.db = db;
    this.now = options.now ?? Date.now;
    this.masterKey = options.masterKey ?? process.env.APP_SECRETS_MASTER_KEY ?? "";
    this.mutationRuntime = options.mutationRuntime ?? createDefaultMutationRuntime(db, {
      now: this.now,
      masterKey: this.masterKey,
    });
    this.accountContext = {
      accountMode: options.accountMode,
      defaultAccountId: options.defaultAccountId,
    };
  }

  async createProfile(
    input: CreateLlmProfileInput,
    accountId?: string,
  ): Promise<LlmProfileListItem> {
    accountId = this.resolveAccountId(accountId);
    try {
      const result = await this.mutationRuntime.applyInline<
        CreateLlmProfileMutationPayload,
        LlmProfileListItemMutationResult
      >({
        id: `llm-profile-create:${input.presetName}:${this.now()}`,
        kind: CONFIG_MUTATION_KINDS.llmProfileCreate,
        source: "api",
        accountId,
        scopeType: "config.llm_profile",
        scopeKey: `account:${accountId}`,
        applyPhase: "inline",
        durability: "transactional",
        replaySafety: "confirm_on_replay",
        payload: input,
        createdAt: this.now(),
      });

      return requireProfile(result ?? null, "created-profile");
    } catch (error) {
      throw this.mapWriteError(error, input.presetName);
    }
  }

  async listProfiles(options: { includeDeleted?: boolean; accountId?: string } = {}): Promise<LlmProfileListItem[]> {
    const accountId = this.resolveAccountId(options.accountId);
    const whereClause = options.includeDeleted
      ? eq(llmProfiles.accountId, accountId)
      : and(eq(llmProfiles.accountId, accountId), ne(llmProfiles.status, "deleted"));
    const rows = await this.db.select().from(llmProfiles).where(whereClause).orderBy(desc(llmProfiles.updatedAt));
    return rows.map((row) => this.toListItem(row));
  }

  async getProfile(id: string, accountId?: string): Promise<LlmProfileListItem | null> {
    accountId = this.resolveAccountId(accountId);
    const row = await this.db.select().from(llmProfiles).where(and(eq(llmProfiles.id, id), eq(llmProfiles.accountId, accountId))).limit(1);
    const profile = row[0];
    return profile ? this.toListItem(profile) : null;
  }

  async updateProfile(id: string, patch: UpdateLlmProfileInput, accountId?: string): Promise<LlmProfileListItem> {
    accountId = this.resolveAccountId(accountId);
    try {
      const result = await this.mutationRuntime.applyInline<
        UpdateLlmProfileMutationPayload,
        LlmProfileListItemMutationResult
      >({
        id: `llm-profile-update:${id}:${this.now()}`,
        kind: CONFIG_MUTATION_KINDS.llmProfileUpdate,
        source: "api",
        accountId,
        scopeType: "config.llm_profile",
        scopeKey: `profile:${id}`,
        applyPhase: "inline",
        durability: "transactional",
        replaySafety: "confirm_on_replay",
        payload: { id, patch },
        createdAt: this.now(),
      });

      return requireProfile(result ?? null, id);
    } catch (error) {
      throw this.mapWriteError(error, patch.presetName);
    }
  }

  async deleteProfile(id: string, accountId?: string): Promise<LlmProfileListItem> {
    accountId = this.resolveAccountId(accountId);
    try {
      const result = await this.mutationRuntime.applyInline<
        DeleteLlmProfileMutationPayload,
        LlmProfileListItemMutationResult
      >({
        id: `llm-profile-delete:${id}:${this.now()}`,
        kind: CONFIG_MUTATION_KINDS.llmProfileDelete,
        source: "api",
        accountId,
        scopeType: "config.llm_profile",
        scopeKey: `profile:${id}`,
        applyPhase: "inline",
        durability: "transactional",
        replaySafety: "confirm_on_replay",
        payload: { id },
        createdAt: this.now(),
      });

      return requireProfile(result ?? null, id);
    } catch (error) {
      throw this.mapWriteError(error);
    }
  }

  async activateProfile(
    scope: LlmProfileScope,
    scopeId: string,
    profileId: string,
    instanceSlot: string = '*',
    params?: LlmBindingGenerationParams | null,
    accountId?: string,
  ): Promise<void> {
    accountId = this.resolveAccountId(accountId);
    try {
      const payload: ActivateLlmProfileMutationPayload = {
        scope,
        scopeId,
        profileId,
        instanceSlot: instanceSlot as ActivateLlmProfileMutationPayload["instanceSlot"],
        ...(params !== undefined ? { params } : {}),
      };

      await this.mutationRuntime.applyInline<ActivateLlmProfileMutationPayload, void>({
        id: `llm-profile-activate:${profileId}:${scope}:${scopeId}:${instanceSlot}:${this.now()}`,
        kind: CONFIG_MUTATION_KINDS.llmProfileActivate,
        source: "api",
        accountId,
        sessionId: scope === "session" ? scopeId : undefined,
        scopeType: "config.llm_profile_binding",
        scopeKey: `${scope}:${scopeId}:${instanceSlot}`,
        applyPhase: "inline",
        durability: "transactional",
        replaySafety: "confirm_on_replay",
        payload,
        createdAt: this.now(),
      });
    } catch (error) {
      throw this.mapWriteError(error);
    }
  }

  async unbindProfile(
    scope: LlmProfileScope,
    scopeId: string,
    instanceSlot: string = '*',
    accountId?: string,
  ): Promise<void> {
    accountId = this.resolveAccountId(accountId);
    try {
      await this.mutationRuntime.applyInline<UnbindLlmProfileMutationPayload, void>({
        id: `llm-profile-unbind:${scope}:${scopeId}:${instanceSlot}:${this.now()}`,
        kind: CONFIG_MUTATION_KINDS.llmProfileUnbind,
        source: "api",
        accountId,
        sessionId: scope === "session" ? scopeId : undefined,
        scopeType: "config.llm_profile_binding",
        scopeKey: `${scope}:${scopeId}:${instanceSlot}`,
        applyPhase: "inline",
        durability: "transactional",
        replaySafety: "confirm_on_replay",
        payload: {
          scope,
          scopeId,
          instanceSlot: instanceSlot as UnbindLlmProfileMutationPayload["instanceSlot"],
        },
        createdAt: this.now(),
      });
    } catch (error) {
      throw this.mapWriteError(error);
    }
  }

  async resolveActiveProfile(
    sessionId?: string,
    accountId?: string,
  ): Promise<LlmProfileResolved | null> {
    accountId = this.resolveAccountId(accountId);
    // 向后兼容：等价于解析 '*' 通配槽位
    return this.resolveForSlot(sessionId, '*', accountId);
  }

  /**
   * 按 instance slot 粒度解析所有活跃 Profile。
   *
   * 解析优先级（每个 slot 独立解析）：
   *   session slot X → global slot X → session '*' → global '*' → null (env fallback)
   *
   * @returns 部分映射：只包含实际有绑定的 slot。
   */
  async resolveActiveProfiles(
    sessionId?: string,
    accountId?: string,
  ): Promise<Partial<Record<InstanceSlot | '*', LlmProfileResolved>>> {
    accountId = this.resolveAccountId(accountId);
    const ALL_SLOTS: (InstanceSlot | '*')[] = ['*', 'narrator', 'director', 'verifier', 'memory'];
    const result: Partial<Record<InstanceSlot | '*', LlmProfileResolved>> = {};

    // 批量加载所有相关 bindings（最多 2 个 scope × 5 个 slot = 10 条）
    const bindings = await this.loadAllBindings(sessionId, accountId);

    for (const slot of ALL_SLOTS) {
      const resolved = this.pickBinding(bindings, sessionId, slot);
      if (resolved) {
        result[slot] = resolved;
      }
    }

    return result;
  }

  async touchLastUsed(profileId: string, accountId?: string): Promise<void> {
    accountId = this.resolveAccountId(accountId);
    await this.db
      .update(llmProfiles)
      .set({
        lastUsedAt: this.now(),
      })
      .where(and(eq(llmProfiles.id, profileId), eq(llmProfiles.accountId, accountId)));
  }

  /**
   * 解析单个 slot 的有效 profile（兼容旧 API）。
   * 优先级：session slot → global slot → session '*' → global '*' → null
   */
  private async resolveForSlot(
    sessionId: string | undefined,
    slot: string,
    accountId: string
  ): Promise<LlmProfileResolved | null> {
    const bindings = await this.loadAllBindings(sessionId, accountId);
    return this.pickBinding(bindings, sessionId, slot);
  }

  private pickBinding(
    bindings: BindingRow[],
    sessionId: string | undefined,
    slot: string,
  ): LlmProfileResolved | null {
    // 按优先级搜索
    const candidates: { scope: LlmProfileScope; scopeId: string; slot: string }[] = [];
    if (sessionId) {
      candidates.push({ scope: 'session', scopeId: sessionId, slot });
    }
    candidates.push({ scope: 'global', scopeId: GLOBAL_SCOPE_ID, slot });
    if (slot !== '*') {
      // fallback 到通配
      if (sessionId) {
        candidates.push({ scope: 'session', scopeId: sessionId, slot: '*' });
      }
      candidates.push({ scope: 'global', scopeId: GLOBAL_SCOPE_ID, slot: '*' });
    }

    for (const c of candidates) {
      const found = bindings.find(
        (b) => b.scope === c.scope && b.scopeId === c.scopeId && b.instanceSlot === c.slot,
      );
      if (found) {
        return {
          source: found.scope,
          profileId: found.profileId,
          presetName: found.presetName,
          provider: found.provider,
          modelId: found.modelId,
          baseUrl: found.baseUrl,
          apiKey: this.decrypt(found.apiKeyEncrypted),
          params: normalizeBindingParams(parseBindingParamsJson(found.paramsJson), false) ?? {},
        };
      }
    }

    return null;
  }

  private async loadAllBindings(sessionId: string | undefined, accountId: string): Promise<BindingRow[]> {
    const scopeFilter = sessionId
      ? or(
          and(eq(llmProfileBindings.scope, 'session'), eq(llmProfileBindings.scopeId, sessionId)),
          and(eq(llmProfileBindings.scope, 'global'), eq(llmProfileBindings.scopeId, GLOBAL_SCOPE_ID)),
        )
      : and(eq(llmProfileBindings.scope, 'global'), eq(llmProfileBindings.scopeId, GLOBAL_SCOPE_ID));

    return this.db
      .select({
        scope: llmProfileBindings.scope,
        scopeId: llmProfileBindings.scopeId,
        instanceSlot: llmProfileBindings.instanceSlot,
        profileId: llmProfiles.id,
        presetName: llmProfiles.presetName,
        provider: llmProfiles.provider,
        modelId: llmProfiles.modelId,
        baseUrl: llmProfiles.baseUrl,
        apiKeyEncrypted: llmProfiles.apiKeyEncrypted,
        paramsJson: llmProfileBindings.paramsJson,
      })
      .from(llmProfileBindings)
      .innerJoin(llmProfiles, eq(llmProfileBindings.profileId, llmProfiles.id))
      .where(
        and(
          eq(llmProfiles.status, "active"),
          scopeFilter,
          eq(llmProfileBindings.accountId, accountId),
          eq(llmProfiles.accountId, accountId),
        )
      );
  }

  private toListItem(row: typeof llmProfiles.$inferSelect): LlmProfileListItem {
    return {
      id: row.id,
      presetName: row.presetName,
      provider: row.provider,
      modelId: row.modelId,
      baseUrl: row.baseUrl,
      apiKeyName: row.apiKeyName,
      apiKeyMasked: row.apiKeyMasked,
      status: row.status,
      lastUsedAt: row.lastUsedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private async findProfileById(id: string, accountId: string): Promise<typeof llmProfiles.$inferSelect | null> {
    const rows = await this.db
      .select()
      .from(llmProfiles)
      .where(and(eq(llmProfiles.id, id), eq(llmProfiles.accountId, accountId)))
      .limit(1);
    return rows[0] ?? null;
  }

  private async findProfileByName(name: string, accountId: string): Promise<typeof llmProfiles.$inferSelect | null> {
    const rows = await this.db.select().from(llmProfiles).where(and(eq(llmProfiles.presetName, name), eq(llmProfiles.accountId, accountId))).limit(1);
    return rows[0] ?? null;
  }

  private ensureSessionScopeExists(tx: DbExecutor, sessionId: string, accountId: string): void {
    const session = tx
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.accountId, accountId)))
      .limit(1)
      .get();

    if (!session) {
      throw new LlmProfileServiceError("session_scope_not_found", `Session not found for session-scoped binding: ${sessionId}`);
    }
  }

  private cleanupStaleSessionBindingsForProfile(tx: DbExecutor, profileId: string, accountId: string): void {
    const sessionBindings = tx
      .select({ id: llmProfileBindings.id, scopeId: llmProfileBindings.scopeId })
      .from(llmProfileBindings)
      .where(and(
        eq(llmProfileBindings.profileId, profileId),
        eq(llmProfileBindings.accountId, accountId),
        eq(llmProfileBindings.scope, "session"),
      ))
      .all();

    if (sessionBindings.length === 0) {
      return;
    }

    const scopeIds = sessionBindings.map((binding) => binding.scopeId);
    const existingSessions = new Set(
      tx
        .select({ id: sessions.id })
        .from(sessions)
        .where(and(eq(sessions.accountId, accountId), inArray(sessions.id, scopeIds)))
        .all()
        .map((row) => row.id),
    );

    const staleBindingIds = sessionBindings
      .filter((binding) => !existingSessions.has(binding.scopeId))
      .map((binding) => binding.id);

    if (staleBindingIds.length === 0) {
      return;
    }

    tx.delete(llmProfileBindings)
      .where(and(
        eq(llmProfileBindings.accountId, accountId),
        inArray(llmProfileBindings.id, staleBindingIds),
      ))
      .run();
  }

  private resolveAccountId(accountId?: string): string {
    return resolveAccountIdOrThrow(accountId, this.accountContext);
  }

  private mapWriteError(error: unknown, presetName?: string): LlmProfileServiceError {
    if (error instanceof LlmProfileServiceError) {
      return error;
    }

    if (error instanceof ConfigMutationError) {
      return new LlmProfileServiceError(error.code as LlmProfileServiceError["code"], error.message);
    }

    const code = typeof error === "object" && error !== null ? (error as { code?: string }).code : undefined;
    if (typeof code === "string" && code.startsWith("SQLITE_CONSTRAINT")) {
      return new LlmProfileServiceError(
        "profile_conflict",
        presetName ? `Profile name already exists: ${presetName}` : "Profile name already exists",
      );
    }

    throw error;
  }

  private decrypt(value: string): string {
    try {
      if (!this.masterKey || this.masterKey.trim().length === 0) {
        throw new LlmProfileServiceError("secret_unavailable", "APP_SECRETS_MASTER_KEY is required for profile decryption");
      }

      return decryptSecret(value, this.masterKey);
    } catch (error) {
      if (error instanceof LlmProfileServiceError) {
        throw error;
      }
      if (error instanceof SecretFormatError) {
        throw new LlmProfileServiceError("secret_invalid_format", "Stored profile secret cannot be decrypted. Check APP_SECRETS_MASTER_KEY or data integrity.");
      }
      throw error;
    }
  }
}

function requireProfile(profile: LlmProfileListItem | null, profileId: string): LlmProfileListItem {
  if (!profile) {
    throw new LlmProfileServiceError("profile_not_found", `Profile not found: ${profileId}`);
  }

  return profile;
}
