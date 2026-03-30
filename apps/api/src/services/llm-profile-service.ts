import { and, count, desc, eq, inArray, ne, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { DbExecutor } from "../db/client";
import type { InstanceSlot, ProviderType } from "@tavern/core";

import type { AppDb } from "../db/client";
import { llmProfileBindings, llmProfiles, sessions } from "../db/schema";
import { decryptSecret, encryptSecret, maskSecret } from "../lib/secrets";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../accounts/constants";
import { normalizeBindingParams, parseBindingParamsJson, LlmParamsValidationError, type LlmBindingGenerationParams } from "../lib/llm-params";
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
};

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

  constructor(db: AppDb, options: ServiceOptions = {}) {
    this.db = db;
    this.now = options.now ?? Date.now;
    this.masterKey = options.masterKey ?? process.env.APP_SECRETS_MASTER_KEY ?? "";
  }

  async createProfile(
    input: CreateLlmProfileInput,
    accountId: string = DEFAULT_ADMIN_ACCOUNT_ID
  ): Promise<LlmProfileListItem> {
    try {
      return this.db.transaction((tx) => {
        const existingByName = tx
          .select()
          .from(llmProfiles)
          .where(and(eq(llmProfiles.presetName, input.presetName), eq(llmProfiles.accountId, accountId)))
          .limit(1)
          .get();
        if (existingByName) {
          throw new LlmProfileServiceError("profile_conflict", `Profile name already exists: ${input.presetName}`);
        }

        const now = this.now();
        const id = nanoid();
        const apiKeyEncrypted = this.encrypt(input.apiKey);

        tx.insert(llmProfiles).values({
          id,
          presetName: input.presetName,
          accountId,
          provider: input.provider,
          modelId: input.modelId,
          baseUrl: input.baseUrl ?? null,
          apiKeyName: input.apiKeyName ?? null,
          apiKeyEncrypted,
          apiKeyMasked: maskSecret(input.apiKey),
          status: "active",
          lastUsedAt: null,
          createdAt: now,
          updatedAt: now,
        }).run();

        const profile = tx
          .select()
          .from(llmProfiles)
          .where(and(eq(llmProfiles.id, id), eq(llmProfiles.accountId, accountId)))
          .limit(1)
          .get();

        return requireProfile(profile ? this.toListItem(profile) : null, id);
      });
    } catch (error) {
      throw this.mapWriteError(error, input.presetName);
    }
  }

  async listProfiles(options: { includeDeleted?: boolean; accountId?: string } = {}): Promise<LlmProfileListItem[]> {
    const accountId = options.accountId ?? DEFAULT_ADMIN_ACCOUNT_ID;
    const whereClause = options.includeDeleted
      ? eq(llmProfiles.accountId, accountId)
      : and(eq(llmProfiles.accountId, accountId), ne(llmProfiles.status, "deleted"));
    const rows = await this.db.select().from(llmProfiles).where(whereClause).orderBy(desc(llmProfiles.updatedAt));
    return rows.map((row) => this.toListItem(row));
  }

  async getProfile(id: string, accountId: string = DEFAULT_ADMIN_ACCOUNT_ID): Promise<LlmProfileListItem | null> {
    const row = await this.db.select().from(llmProfiles).where(and(eq(llmProfiles.id, id), eq(llmProfiles.accountId, accountId))).limit(1);
    const profile = row[0];
    return profile ? this.toListItem(profile) : null;
  }

  async updateProfile(id: string, patch: UpdateLlmProfileInput, accountId: string = DEFAULT_ADMIN_ACCOUNT_ID): Promise<LlmProfileListItem> {
    try {
      return this.db.transaction((tx) => {
        const current = tx
          .select()
          .from(llmProfiles)
          .where(and(eq(llmProfiles.id, id), eq(llmProfiles.accountId, accountId)))
          .limit(1)
          .get();
        if (!current) {
          throw new LlmProfileServiceError("profile_not_found", `Profile not found: ${id}`);
        }

        if (current.status === "deleted") {
          throw new LlmProfileServiceError("profile_inactive", `Profile already deleted: ${id}`);
        }

        if (patch.presetName && patch.presetName !== current.presetName) {
          const existingByName = tx
            .select()
            .from(llmProfiles)
            .where(and(eq(llmProfiles.presetName, patch.presetName), eq(llmProfiles.accountId, accountId)))
            .limit(1)
            .get();
          if (existingByName && existingByName.id !== id) {
            throw new LlmProfileServiceError("profile_conflict", `Profile name already exists: ${patch.presetName}`);
          }
        }

        const update: Partial<typeof llmProfiles.$inferInsert> = {
          updatedAt: this.now(),
        };

        if (patch.presetName !== undefined) {
          update.presetName = patch.presetName;
        }

        if (patch.provider !== undefined) {
          update.provider = patch.provider;
        }

        if (patch.modelId !== undefined) {
          update.modelId = patch.modelId;
        }

        if (patch.baseUrl !== undefined) {
          update.baseUrl = patch.baseUrl;
        }

        if (patch.apiKeyName !== undefined) {
          update.apiKeyName = patch.apiKeyName;
        }

        if (patch.status !== undefined) {
          update.status = patch.status;
        }

        if (patch.apiKey !== undefined) {
          update.apiKeyEncrypted = this.encrypt(patch.apiKey);
          update.apiKeyMasked = maskSecret(patch.apiKey);
        }

        tx.update(llmProfiles)
          .set(update)
          .where(and(eq(llmProfiles.id, id), eq(llmProfiles.accountId, accountId)))
          .run();

        const profile = tx
          .select()
          .from(llmProfiles)
          .where(and(eq(llmProfiles.id, id), eq(llmProfiles.accountId, accountId)))
          .limit(1)
          .get();

        return requireProfile(profile ? this.toListItem(profile) : null, id);
      });
    } catch (error) {
      throw this.mapWriteError(error, patch.presetName);
    }
  }

  async deleteProfile(id: string, accountId: string = DEFAULT_ADMIN_ACCOUNT_ID): Promise<LlmProfileListItem> {
    return this.db.transaction((tx) => {
      const profile = tx
        .select()
        .from(llmProfiles)
        .where(and(eq(llmProfiles.id, id), eq(llmProfiles.accountId, accountId)))
        .limit(1)
        .get();
      if (!profile) {
        throw new LlmProfileServiceError("profile_not_found", `Profile not found: ${id}`);
      }

      this.cleanupStaleSessionBindingsForProfile(tx, id, accountId);

      const bindingCountRow = tx
        .select({ total: count() })
        .from(llmProfileBindings)
        .where(and(eq(llmProfileBindings.profileId, id), eq(llmProfileBindings.accountId, accountId)))
        .get();
      const totalBindings = Number(bindingCountRow?.total ?? 0);

      if (totalBindings > 0) {
        throw new LlmProfileServiceError("profile_in_use", `Profile is currently bound and cannot be deleted: ${id}`);
      }

      const now = this.now();
      tx.update(llmProfiles)
        .set({
          status: "deleted",
          updatedAt: now,
        })
        .where(and(eq(llmProfiles.id, id), eq(llmProfiles.accountId, accountId)))
        .run();

      const updated = tx
        .select()
        .from(llmProfiles)
        .where(and(eq(llmProfiles.id, id), eq(llmProfiles.accountId, accountId)))
        .limit(1)
        .get();

      return requireProfile(updated ? this.toListItem(updated) : null, id);
    });
  }

  async activateProfile(
    scope: LlmProfileScope,
    scopeId: string,
    profileId: string,
    instanceSlot: string = '*',
    params?: LlmBindingGenerationParams | null,
    accountId: string = DEFAULT_ADMIN_ACCOUNT_ID
  ): Promise<void> {
    let normalizedParams: LlmBindingGenerationParams | undefined;
    try {
      normalizedParams = normalizeBindingParams(params, true);
    } catch (e) {
      if (e instanceof LlmParamsValidationError) {
        throw new LlmProfileServiceError("invalid_params", e.message);
      }
      throw e;
    }

    this.db.transaction((tx) => {
      const profile = tx
        .select()
        .from(llmProfiles)
        .where(and(eq(llmProfiles.id, profileId), eq(llmProfiles.accountId, accountId)))
        .limit(1)
        .get();
      if (!profile) {
        throw new LlmProfileServiceError("profile_not_found", `Profile not found: ${profileId}`);
      }

      if (profile.status !== "active") {
        throw new LlmProfileServiceError("profile_inactive", `Profile is not active: ${profileId}`);
      }

      const now = this.now();
      const bindingScopeId = scope === "global" ? GLOBAL_SCOPE_ID : scopeId;
      if (scope === "session") {
        this.ensureSessionScopeExists(tx, bindingScopeId, accountId);
      }
      const paramsJson = normalizedParams ? JSON.stringify(normalizedParams) : null;

      const conflictSet: Partial<typeof llmProfileBindings.$inferInsert> = {
        profileId,
        updatedAt: now,
      };
      if (params !== undefined) {
        conflictSet.paramsJson = paramsJson;
      }

      tx.insert(llmProfileBindings)
        .values({
          id: nanoid(),
          scope,
          accountId,
          scopeId: bindingScopeId,
          instanceSlot,
          profileId,
          paramsJson,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [llmProfileBindings.accountId, llmProfileBindings.scope, llmProfileBindings.scopeId, llmProfileBindings.instanceSlot],
          set: conflictSet,
        })
        .run();
    });
  }

  async unbindProfile(
    scope: LlmProfileScope,
    scopeId: string,
    instanceSlot: string = '*',
    accountId: string = DEFAULT_ADMIN_ACCOUNT_ID,
  ): Promise<void> {
    this.db.transaction((tx) => {
      const bindingScopeId = scope === "global" ? GLOBAL_SCOPE_ID : scopeId;
      if (scope === "session") {
        this.ensureSessionScopeExists(tx, bindingScopeId, accountId);
      }

      const deleted = tx.delete(llmProfileBindings)
        .where(and(
          eq(llmProfileBindings.accountId, accountId),
          eq(llmProfileBindings.scope, scope),
          eq(llmProfileBindings.scopeId, bindingScopeId),
          eq(llmProfileBindings.instanceSlot, instanceSlot),
        ))
        .returning({ id: llmProfileBindings.id })
        .all();

      if (deleted.length === 0) {
        throw new LlmProfileServiceError(
          "binding_not_found",
          `Profile binding not found for scope=${scope} scopeId=${bindingScopeId} slot=${instanceSlot}`,
        );
      }
    });
  }

  async resolveActiveProfile(
    sessionId?: string,
    accountId: string = DEFAULT_ADMIN_ACCOUNT_ID
  ): Promise<LlmProfileResolved | null> {
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
    accountId: string = DEFAULT_ADMIN_ACCOUNT_ID,
  ): Promise<Partial<Record<InstanceSlot | '*', LlmProfileResolved>>> {
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

  async touchLastUsed(profileId: string, accountId: string = DEFAULT_ADMIN_ACCOUNT_ID): Promise<void> {
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

  private mapWriteError(error: unknown, presetName?: string): LlmProfileServiceError {
    if (error instanceof LlmProfileServiceError) {
      return error;
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

  private encrypt(value: string): string {
    if (!this.masterKey || this.masterKey.trim().length === 0) {
      throw new LlmProfileServiceError("secret_unavailable", "APP_SECRETS_MASTER_KEY is required for profile encryption");
    }

    return encryptSecret(value, this.masterKey);
  }

  private decrypt(value: string): string {
    if (!this.masterKey || this.masterKey.trim().length === 0) {
      throw new LlmProfileServiceError("secret_unavailable", "APP_SECRETS_MASTER_KEY is required for profile decryption");
    }

    return decryptSecret(value, this.masterKey);
  }
}

function requireProfile(profile: LlmProfileListItem | null, profileId: string): LlmProfileListItem {
  if (!profile) {
    throw new LlmProfileServiceError("profile_not_found", `Profile not found: ${profileId}`);
  }

  return profile;
}
