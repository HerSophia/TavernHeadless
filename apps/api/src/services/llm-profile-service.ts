import { and, count, desc, eq, ne, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { GenerationParams, InstanceSlot, ProviderType } from "@tavern/core";

import type { AppDb } from "../db/client";
import { llmProfileBindings, llmProfiles } from "../db/schema";
import { decryptSecret, encryptSecret, maskSecret } from "../lib/secrets";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../accounts/constants";

const GLOBAL_SCOPE_ID = "global";

export type LlmProfileScope = "global" | "session";
export type LlmProfileStatus = "active" | "disabled" | "deleted";

export type LlmBindingGenerationParams = Partial<Pick<GenerationParams,
  | "maxContextTokens"
  | "maxOutputTokens"
  | "temperature"
  | "topP"
  | "topK"
  | "frequencyPenalty"
  | "presencePenalty"
  | "stream"
  | "timeoutMs"
  | "maxRetries"
  | "reasoningEffort"
>>;

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
      | "profile_not_found"
      | "profile_conflict"
      | "profile_in_use"
      | "profile_inactive"
      | "invalid_params"
      | "secret_unavailable",
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
    const existingByName = await this.findProfileByName(input.presetName, accountId);
    if (existingByName) {
      throw new LlmProfileServiceError("profile_conflict", `Profile name already exists: ${input.presetName}`);
    }

    const now = this.now();
    const id = nanoid();
    const apiKeyEncrypted = this.encrypt(input.apiKey);

    await this.db.insert(llmProfiles).values({
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
    });

    const profile = await this.getProfile(id, accountId);
    return requireProfile(profile, id);
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
    const current = await this.findProfileById(id, accountId);
    if (!current) {
      throw new LlmProfileServiceError("profile_not_found", `Profile not found: ${id}`);
    }

    if (current.status === "deleted") {
      throw new LlmProfileServiceError("profile_inactive", `Profile already deleted: ${id}`);
    }

    if (patch.presetName && patch.presetName !== current.presetName) {
      const existingByName = await this.findProfileByName(patch.presetName, accountId);
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

    await this.db.update(llmProfiles).set(update).where(and(eq(llmProfiles.id, id), eq(llmProfiles.accountId, accountId)));

    const profile = await this.getProfile(id, accountId);
    return requireProfile(profile, id);
  }

  async deleteProfile(id: string, accountId: string = DEFAULT_ADMIN_ACCOUNT_ID): Promise<LlmProfileListItem> {
    const profile = await this.findProfileById(id, accountId);
    if (!profile) {
      throw new LlmProfileServiceError("profile_not_found", `Profile not found: ${id}`);
    }

    const bindingCountRows = await this.db
      .select({ total: count() })
      .from(llmProfileBindings)
      .where(and(eq(llmProfileBindings.profileId, id), eq(llmProfileBindings.accountId, accountId)));
    const totalBindings = bindingCountRows[0]?.total ?? 0;

    if (totalBindings > 0) {
      throw new LlmProfileServiceError("profile_in_use", `Profile is currently bound and cannot be deleted: ${id}`);
    }


    const now = this.now();
    await this.db
      .update(llmProfiles)
      .set({
        status: "deleted",
        updatedAt: now,
      })
      .where(and(eq(llmProfiles.id, id), eq(llmProfiles.accountId, accountId)));

    const updated = await this.getProfile(id, accountId);
    return requireProfile(updated, id);
  }

  async activateProfile(
    scope: LlmProfileScope,
    scopeId: string,
    profileId: string,
    instanceSlot: string = '*',
    params?: LlmBindingGenerationParams | null,
    accountId: string = DEFAULT_ADMIN_ACCOUNT_ID
  ): Promise<void> {
    const profile = await this.findProfileById(profileId, accountId);
    if (!profile) {
      throw new LlmProfileServiceError("profile_not_found", `Profile not found: ${profileId}`);
    }

    if (profile.status !== "active") {
      throw new LlmProfileServiceError("profile_inactive", `Profile is not active: ${profileId}`);
    }

    const now = this.now();
    const bindingScopeId = scope === "global" ? GLOBAL_SCOPE_ID : scopeId;
    const normalizedParams = normalizeBindingParams(params, true);
    const paramsJson = normalizedParams ? JSON.stringify(normalizedParams) : null;

    const conflictSet: Partial<typeof llmProfileBindings.$inferInsert> = {
      profileId,
      updatedAt: now,
    };
    if (params !== undefined) {
      conflictSet.paramsJson = paramsJson;
    }

    await this.db
      .insert(llmProfileBindings)
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

function parseBindingParamsJson(value: string | null): unknown {
  if (!value) {
    return undefined;
  }

  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function normalizeBindingParams(input: unknown, strict: boolean): LlmBindingGenerationParams | undefined {
  if (input === null || input === undefined) {
    return undefined;
  }

  if (typeof input !== "object" || Array.isArray(input)) {
    if (strict) {
      throw new LlmProfileServiceError("invalid_params", "params must be an object");
    }
    return undefined;
  }

  const raw = input as Record<string, unknown>;
  const normalized: LlmBindingGenerationParams = {};

  const readNumber = (
    key: string,
    options: { int?: boolean; min?: number; max?: number } = {}
  ): number | undefined => {
    const value = raw[key];
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      if (strict) throw new LlmProfileServiceError("invalid_params", `params.${key} must be a number`);
      return undefined;
    }
    if (options.int && !Number.isInteger(value)) {
      if (strict) throw new LlmProfileServiceError("invalid_params", `params.${key} must be an integer`);
      return undefined;
    }
    if (options.min !== undefined && value < options.min) {
      if (strict) throw new LlmProfileServiceError("invalid_params", `params.${key} must be >= ${options.min}`);
      return undefined;
    }
    if (options.max !== undefined && value > options.max) {
      if (strict) throw new LlmProfileServiceError("invalid_params", `params.${key} must be <= ${options.max}`);
      return undefined;
    }
    return options.int ? Math.trunc(value) : value;
  };

  const maxContextTokens = readNumber("maxContextTokens", { int: true, min: 1 });
  if (maxContextTokens !== undefined) normalized.maxContextTokens = maxContextTokens;

  const maxOutputTokens = readNumber("maxOutputTokens", { int: true, min: 1 });
  if (maxOutputTokens !== undefined) normalized.maxOutputTokens = maxOutputTokens;

  const temperature = readNumber("temperature", { min: 0, max: 2 });
  if (temperature !== undefined) normalized.temperature = temperature;

  const topP = readNumber("topP", { min: 0, max: 1 });
  if (topP !== undefined) normalized.topP = topP;

  const topK = readNumber("topK", { int: true, min: 0 });
  if (topK !== undefined) normalized.topK = topK;

  const frequencyPenalty = readNumber("frequencyPenalty", { min: -2, max: 2 });
  if (frequencyPenalty !== undefined) normalized.frequencyPenalty = frequencyPenalty;

  const presencePenalty = readNumber("presencePenalty", { min: -2, max: 2 });
  if (presencePenalty !== undefined) normalized.presencePenalty = presencePenalty;

  const timeoutMs = readNumber("timeoutMs", { int: true, min: 1 });
  if (timeoutMs !== undefined) normalized.timeoutMs = timeoutMs;

  const maxRetries = readNumber("maxRetries", { int: true, min: 0, max: 10 });
  if (maxRetries !== undefined) normalized.maxRetries = maxRetries;

  const reasoningEffort = raw.reasoningEffort;
  if (reasoningEffort !== undefined && reasoningEffort !== null) {
    if (reasoningEffort !== "low" && reasoningEffort !== "medium" && reasoningEffort !== "high") {
      if (strict) {
        throw new LlmProfileServiceError("invalid_params", "params.reasoningEffort must be one of low, medium, high");
      }
    } else {
      normalized.reasoningEffort = reasoningEffort;
    }
  }

  const stream = raw.stream;
  if (stream !== undefined && stream !== null) {
    if (typeof stream !== "boolean") {
      if (strict) throw new LlmProfileServiceError("invalid_params", "params.stream must be boolean");
    } else {
      normalized.stream = stream;
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function requireProfile(profile: LlmProfileListItem | null, profileId: string): LlmProfileListItem {
  if (!profile) {
    throw new LlmProfileServiceError("profile_not_found", `Profile not found: ${profileId}`);
  }

  return profile;
}
