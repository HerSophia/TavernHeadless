import { and, count, eq, inArray } from "drizzle-orm"
import { nanoid } from "nanoid"
import type { ProviderType } from "@tavern/core"

import { llmInstanceConfigs, llmProfileBindings, llmProfiles, sessions } from "../db/schema.js"
import { normalizeBindingParams, parseBindingParamsJson, LlmParamsValidationError, type LlmBindingGenerationParams } from "../lib/llm-params.js"
import { encryptSecret, maskSecret } from "../lib/secrets.js"
import { MutationApplierRegistry } from "./mutation-applier-registry.js"
import { RuntimeMutationError } from "./runtime-mutation-errors.js"
import type { RuntimeMutationApplier, RuntimeMutationApplyRequest } from "./runtime-mutation-types.js"

const GLOBAL_SCOPE_ID = "global"
const VALID_INSTANCE_SLOTS = new Set(["*", "narrator", "director", "verifier", "memory"])

export const CONFIG_MUTATION_KINDS = {
  llmProfileCreate: "config.llm_profile.create",
  llmProfileUpdate: "config.llm_profile.update",
  llmProfileDelete: "config.llm_profile.delete",
  llmProfileActivate: "config.llm_profile.activate",
  llmProfileUnbind: "config.llm_profile.unbind",
  llmInstanceUpsert: "config.instance_slot.upsert",
  llmInstanceDelete: "config.instance_slot.delete",
} as const

export type LlmProfileScope = "global" | "session"
export type LlmProfileStatus = "active" | "disabled" | "deleted"
export type LlmInstanceScope = "global" | "session"
export type LlmInstanceSlot = "*" | "narrator" | "director" | "verifier" | "memory"

export type ConfigMutationErrorCode =
  | "binding_not_found"
  | "config_not_found"
  | "invalid_params"
  | "invalid_slot"
  | "missing_session_id"
  | "profile_conflict"
  | "profile_in_use"
  | "profile_inactive"
  | "profile_not_found"
  | "secret_unavailable"
  | "session_scope_not_found"

export class ConfigMutationError extends Error {
  constructor(public readonly code: ConfigMutationErrorCode, message: string) {
    super(message)
    this.name = "ConfigMutationError"
  }
}

export interface LlmProfileListItemMutationResult {
  id: string
  presetName: string
  provider: ProviderType
  modelId: string
  baseUrl: string | null
  apiKeyName: string | null
  apiKeyMasked: string
  status: LlmProfileStatus
  lastUsedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface LlmInstanceConfigItemMutationResult {
  id: string
  scope: LlmInstanceScope
  scopeId: string
  instanceSlot: LlmInstanceSlot
  presetId: string | null
  enabled: boolean
  params: LlmBindingGenerationParams | null
  createdAt: number
  updatedAt: number
}

export interface CreateLlmProfileMutationPayload {
  presetName: string
  provider: ProviderType
  modelId: string
  baseUrl?: string | null
  apiKeyName?: string | null
  apiKey: string
}

export interface UpdateLlmProfileMutationPayload {
  id: string
  patch: {
    presetName?: string
    provider?: ProviderType
    modelId?: string
    baseUrl?: string | null
    apiKeyName?: string | null
    apiKey?: string
    status?: Exclude<LlmProfileStatus, "deleted">
  }
}

export interface DeleteLlmProfileMutationPayload {
  id: string
}

export interface ActivateLlmProfileMutationPayload {
  scope: LlmProfileScope
  scopeId: string
  profileId: string
  instanceSlot: LlmInstanceSlot
  params?: LlmBindingGenerationParams | null
}

export interface UnbindLlmProfileMutationPayload {
  scope: LlmProfileScope
  scopeId: string
  instanceSlot: LlmInstanceSlot
}

export interface UpsertLlmInstanceConfigMutationPayload {
  scope: LlmInstanceScope
  scopeId: string
  slot: LlmInstanceSlot
  input: {
    presetId?: string | null
    enabled?: boolean
    params?: LlmBindingGenerationParams | null
  }
}

export interface DeleteLlmInstanceConfigMutationPayload {
  scope: LlmInstanceScope
  scopeId: string
  slot: LlmInstanceSlot
}

function isMutationKind<TPayload>(
  request: RuntimeMutationApplyRequest<unknown>,
  kind: string,
): request is RuntimeMutationApplyRequest<TPayload> {
  return request.envelope.kind === kind
}

function requireSecretMasterKey(masterKey: string): string {
  if (!masterKey || masterKey.trim().length === 0) {
    throw new ConfigMutationError(
      "secret_unavailable",
      "APP_SECRETS_MASTER_KEY is required for profile encryption",
    )
  }

  return masterKey
}

function toProfileListItem(row: typeof llmProfiles.$inferSelect): LlmProfileListItemMutationResult {
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
  }
}

function requireProfileRow(
  row: typeof llmProfiles.$inferSelect | undefined,
  profileId: string,
): typeof llmProfiles.$inferSelect {
  if (!row) {
    throw new ConfigMutationError("profile_not_found", `Profile not found: ${profileId}`)
  }

  return row
}

function validateInstanceSlot(slot: string): asserts slot is LlmInstanceSlot {
  if (!VALID_INSTANCE_SLOTS.has(slot)) {
    throw new ConfigMutationError(
      "invalid_slot",
      `Invalid instance slot: ${slot}. Must be one of: ${[...VALID_INSTANCE_SLOTS].join(", ")}`,
    )
  }
}

function toInstanceConfigItem(
  row: typeof llmInstanceConfigs.$inferSelect,
): LlmInstanceConfigItemMutationResult {
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
  }
}

export class ConfigMutationApplier implements RuntimeMutationApplier<unknown, unknown> {
  private readonly masterKey: string

  constructor(options: { masterKey?: string } = {}) {
    this.masterKey = options.masterKey ?? process.env.APP_SECRETS_MASTER_KEY ?? ""
  }

  apply(request: RuntimeMutationApplyRequest<unknown>) {
    if (isMutationKind<CreateLlmProfileMutationPayload>(request, CONFIG_MUTATION_KINDS.llmProfileCreate)) {
      return this.applyCreateLlmProfile(request)
    }

    if (isMutationKind<UpdateLlmProfileMutationPayload>(request, CONFIG_MUTATION_KINDS.llmProfileUpdate)) {
      return this.applyUpdateLlmProfile(request)
    }

    if (isMutationKind<DeleteLlmProfileMutationPayload>(request, CONFIG_MUTATION_KINDS.llmProfileDelete)) {
      return this.applyDeleteLlmProfile(request)
    }

    if (isMutationKind<ActivateLlmProfileMutationPayload>(request, CONFIG_MUTATION_KINDS.llmProfileActivate)) {
      return this.applyActivateLlmProfile(request)
    }

    if (isMutationKind<UnbindLlmProfileMutationPayload>(request, CONFIG_MUTATION_KINDS.llmProfileUnbind)) {
      return this.applyUnbindLlmProfile(request)
    }

    if (isMutationKind<UpsertLlmInstanceConfigMutationPayload>(request, CONFIG_MUTATION_KINDS.llmInstanceUpsert)) {
      return this.applyUpsertLlmInstanceConfig(request)
    }

    if (isMutationKind<DeleteLlmInstanceConfigMutationPayload>(request, CONFIG_MUTATION_KINDS.llmInstanceDelete)) {
      return this.applyDeleteLlmInstanceConfig(request)
    }

    throw new RuntimeMutationError(`Unsupported config mutation kind: ${request.envelope.kind}`)
  }

  private applyCreateLlmProfile(request: RuntimeMutationApplyRequest<CreateLlmProfileMutationPayload>) {
    const existingByName = request.context.tx
      .select()
      .from(llmProfiles)
      .where(and(
        eq(llmProfiles.presetName, request.envelope.payload.presetName),
        eq(llmProfiles.accountId, request.envelope.accountId),
      ))
      .limit(1)
      .get()

    if (existingByName) {
      throw new ConfigMutationError(
        "profile_conflict",
        `Profile name already exists: ${request.envelope.payload.presetName}`,
      )
    }

    const now = request.context.now()
    const id = nanoid()
    const apiKeyEncrypted = encryptSecret(
      request.envelope.payload.apiKey,
      requireSecretMasterKey(this.masterKey),
    )

    request.context.tx.insert(llmProfiles).values({
      id,
      presetName: request.envelope.payload.presetName,
      accountId: request.envelope.accountId,
      provider: request.envelope.payload.provider,
      modelId: request.envelope.payload.modelId,
      baseUrl: request.envelope.payload.baseUrl ?? null,
      apiKeyName: request.envelope.payload.apiKeyName ?? null,
      apiKeyEncrypted,
      apiKeyMasked: maskSecret(request.envelope.payload.apiKey),
      status: "active",
      lastUsedAt: null,
      createdAt: now,
      updatedAt: now,
    }).run()

    const profile = request.context.tx
      .select()
      .from(llmProfiles)
      .where(and(eq(llmProfiles.id, id), eq(llmProfiles.accountId, request.envelope.accountId)))
      .limit(1)
      .get()

    return {
      result: toProfileListItem(requireProfileRow(profile, id)),
    }
  }

  private applyUpdateLlmProfile(request: RuntimeMutationApplyRequest<UpdateLlmProfileMutationPayload>) {
    const { id, patch } = request.envelope.payload
    const current = request.context.tx
      .select()
      .from(llmProfiles)
      .where(and(eq(llmProfiles.id, id), eq(llmProfiles.accountId, request.envelope.accountId)))
      .limit(1)
      .get()

    if (!current) {
      throw new ConfigMutationError("profile_not_found", `Profile not found: ${id}`)
    }

    if (current.status === "deleted") {
      throw new ConfigMutationError("profile_inactive", `Profile already deleted: ${id}`)
    }

    if (patch.presetName && patch.presetName !== current.presetName) {
      const existingByName = request.context.tx
        .select()
        .from(llmProfiles)
        .where(and(
          eq(llmProfiles.presetName, patch.presetName),
          eq(llmProfiles.accountId, request.envelope.accountId),
        ))
        .limit(1)
        .get()

      if (existingByName && existingByName.id !== id) {
        throw new ConfigMutationError("profile_conflict", `Profile name already exists: ${patch.presetName}`)
      }
    }

    const update: Partial<typeof llmProfiles.$inferInsert> = {
      updatedAt: request.context.now(),
    }

    if (patch.presetName !== undefined) {
      update.presetName = patch.presetName
    }
    if (patch.provider !== undefined) {
      update.provider = patch.provider
    }
    if (patch.modelId !== undefined) {
      update.modelId = patch.modelId
    }
    if (patch.baseUrl !== undefined) {
      update.baseUrl = patch.baseUrl
    }
    if (patch.apiKeyName !== undefined) {
      update.apiKeyName = patch.apiKeyName
    }
    if (patch.status !== undefined) {
      update.status = patch.status
    }
    if (patch.apiKey !== undefined) {
      update.apiKeyEncrypted = encryptSecret(patch.apiKey, requireSecretMasterKey(this.masterKey))
      update.apiKeyMasked = maskSecret(patch.apiKey)
    }

    request.context.tx.update(llmProfiles)
      .set(update)
      .where(and(eq(llmProfiles.id, id), eq(llmProfiles.accountId, request.envelope.accountId)))
      .run()

    const profile = request.context.tx
      .select()
      .from(llmProfiles)
      .where(and(eq(llmProfiles.id, id), eq(llmProfiles.accountId, request.envelope.accountId)))
      .limit(1)
      .get()

    return {
      result: toProfileListItem(requireProfileRow(profile, id)),
    }
  }

  private applyDeleteLlmProfile(request: RuntimeMutationApplyRequest<DeleteLlmProfileMutationPayload>) {
    const { id } = request.envelope.payload
    const profile = request.context.tx
      .select()
      .from(llmProfiles)
      .where(and(eq(llmProfiles.id, id), eq(llmProfiles.accountId, request.envelope.accountId)))
      .limit(1)
      .get()

    if (!profile) {
      throw new ConfigMutationError("profile_not_found", `Profile not found: ${id}`)
    }

    this.cleanupStaleSessionBindingsForProfile(request, id)

    const bindingCountRow = request.context.tx
      .select({ total: count() })
      .from(llmProfileBindings)
      .where(and(
        eq(llmProfileBindings.profileId, id),
        eq(llmProfileBindings.accountId, request.envelope.accountId),
      ))
      .get()

    if (Number(bindingCountRow?.total ?? 0) > 0) {
      throw new ConfigMutationError(
        "profile_in_use",
        `Profile is currently bound and cannot be deleted: ${id}`,
      )
    }

    const now = request.context.now()
    request.context.tx.update(llmProfiles)
      .set({ status: "deleted", updatedAt: now })
      .where(and(eq(llmProfiles.id, id), eq(llmProfiles.accountId, request.envelope.accountId)))
      .run()

    const updated = request.context.tx
      .select()
      .from(llmProfiles)
      .where(and(eq(llmProfiles.id, id), eq(llmProfiles.accountId, request.envelope.accountId)))
      .limit(1)
      .get()

    return {
      result: toProfileListItem(requireProfileRow(updated, id)),
    }
  }

  private applyActivateLlmProfile(request: RuntimeMutationApplyRequest<ActivateLlmProfileMutationPayload>) {
    validateInstanceSlot(request.envelope.payload.instanceSlot)

    let normalizedParams: LlmBindingGenerationParams | undefined
    try {
      normalizedParams = normalizeBindingParams(request.envelope.payload.params, true)
    } catch (error) {
      if (error instanceof LlmParamsValidationError) {
        throw new ConfigMutationError("invalid_params", error.message)
      }
      throw error
    }

    const profile = request.context.tx
      .select()
      .from(llmProfiles)
      .where(and(
        eq(llmProfiles.id, request.envelope.payload.profileId),
        eq(llmProfiles.accountId, request.envelope.accountId),
      ))
      .limit(1)
      .get()

    if (!profile) {
      throw new ConfigMutationError(
        "profile_not_found",
        `Profile not found: ${request.envelope.payload.profileId}`,
      )
    }

    if (profile.status !== "active") {
      throw new ConfigMutationError(
        "profile_inactive",
        `Profile is not active: ${request.envelope.payload.profileId}`,
      )
    }

    const now = request.context.now()
    const bindingScopeId = request.envelope.payload.scope === "global"
      ? GLOBAL_SCOPE_ID
      : request.envelope.payload.scopeId

    if (request.envelope.payload.scope === "session") {
      this.ensureSessionScopeExists(request, bindingScopeId)
    }

    const hasParams = Object.prototype.hasOwnProperty.call(request.envelope.payload, "params")
    const paramsJson = normalizedParams ? JSON.stringify(normalizedParams) : null
    const conflictSet: Partial<typeof llmProfileBindings.$inferInsert> = {
      profileId: request.envelope.payload.profileId,
      updatedAt: now,
    }

    if (hasParams) {
      conflictSet.paramsJson = paramsJson
    }

    request.context.tx.insert(llmProfileBindings)
      .values({
        id: nanoid(),
        scope: request.envelope.payload.scope,
        accountId: request.envelope.accountId,
        scopeId: bindingScopeId,
        instanceSlot: request.envelope.payload.instanceSlot,
        profileId: request.envelope.payload.profileId,
        paramsJson,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          llmProfileBindings.accountId,
          llmProfileBindings.scope,
          llmProfileBindings.scopeId,
          llmProfileBindings.instanceSlot,
        ],
        set: conflictSet,
      })
      .run()

    return {
      result: undefined,
    }
  }

  private applyUnbindLlmProfile(request: RuntimeMutationApplyRequest<UnbindLlmProfileMutationPayload>) {
    validateInstanceSlot(request.envelope.payload.instanceSlot)

    const bindingScopeId = request.envelope.payload.scope === "global"
      ? GLOBAL_SCOPE_ID
      : request.envelope.payload.scopeId

    if (request.envelope.payload.scope === "session") {
      this.ensureSessionScopeExists(request, bindingScopeId)
    }

    const deleted = request.context.tx.delete(llmProfileBindings)
      .where(and(
        eq(llmProfileBindings.accountId, request.envelope.accountId),
        eq(llmProfileBindings.scope, request.envelope.payload.scope),
        eq(llmProfileBindings.scopeId, bindingScopeId),
        eq(llmProfileBindings.instanceSlot, request.envelope.payload.instanceSlot),
      ))
      .returning({ id: llmProfileBindings.id })
      .all()

    if (deleted.length === 0) {
      throw new ConfigMutationError(
        "binding_not_found",
        `Profile binding not found for scope=${request.envelope.payload.scope} scopeId=${bindingScopeId} slot=${request.envelope.payload.instanceSlot}`,
      )
    }

    return {
      result: undefined,
    }
  }

  private applyUpsertLlmInstanceConfig(
    request: RuntimeMutationApplyRequest<UpsertLlmInstanceConfigMutationPayload>,
  ) {
    validateInstanceSlot(request.envelope.payload.slot)

    let normalizedParams: LlmBindingGenerationParams | undefined
    if (request.envelope.payload.input.params !== undefined && request.envelope.payload.input.params !== null) {
      try {
        normalizedParams = normalizeBindingParams(request.envelope.payload.input.params, true)
      } catch (error) {
        if (error instanceof LlmParamsValidationError) {
          throw new ConfigMutationError("invalid_params", error.message)
        }
        throw error
      }
    }

    const now = request.context.now()
    const effectiveScopeId = request.envelope.payload.scope === "global"
      ? GLOBAL_SCOPE_ID
      : request.envelope.payload.scopeId

    let paramsJson: string | null | undefined
    if (!Object.prototype.hasOwnProperty.call(request.envelope.payload.input, "params")) {
      paramsJson = undefined
    } else if (request.envelope.payload.input.params === null) {
      paramsJson = null
    } else {
      paramsJson = normalizedParams ? JSON.stringify(normalizedParams) : null
    }

    const conflictSet: Partial<typeof llmInstanceConfigs.$inferInsert> = {
      updatedAt: now,
    }

    if (request.envelope.payload.input.presetId !== undefined) {
      conflictSet.presetId = request.envelope.payload.input.presetId
    }
    if (request.envelope.payload.input.enabled !== undefined) {
      conflictSet.enabled = request.envelope.payload.input.enabled ? 1 : 0
    }
    if (paramsJson !== undefined) {
      conflictSet.paramsJson = paramsJson
    }

    request.context.tx
      .insert(llmInstanceConfigs)
      .values({
        id: nanoid(),
        accountId: request.envelope.accountId,
        scope: request.envelope.payload.scope,
        scopeId: effectiveScopeId,
        instanceSlot: request.envelope.payload.slot,
        presetId: request.envelope.payload.input.presetId ?? null,
        enabled: request.envelope.payload.input.enabled === false ? 0 : 1,
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
      })
      .run()

    const row = request.context.tx
      .select()
      .from(llmInstanceConfigs)
      .where(and(
        eq(llmInstanceConfigs.accountId, request.envelope.accountId),
        eq(llmInstanceConfigs.scope, request.envelope.payload.scope),
        eq(llmInstanceConfigs.scopeId, effectiveScopeId),
        eq(llmInstanceConfigs.instanceSlot, request.envelope.payload.slot),
      ))
      .limit(1)
      .get()

    if (!row) {
      throw new RuntimeMutationError("Failed to read back LLM instance config")
    }

    return {
      result: toInstanceConfigItem(row),
    }
  }

  private applyDeleteLlmInstanceConfig(
    request: RuntimeMutationApplyRequest<DeleteLlmInstanceConfigMutationPayload>,
  ) {
    validateInstanceSlot(request.envelope.payload.slot)

    const effectiveScopeId = request.envelope.payload.scope === "global"
      ? GLOBAL_SCOPE_ID
      : request.envelope.payload.scopeId

    const existing = request.context.tx
      .select({ id: llmInstanceConfigs.id })
      .from(llmInstanceConfigs)
      .where(and(
        eq(llmInstanceConfigs.accountId, request.envelope.accountId),
        eq(llmInstanceConfigs.scope, request.envelope.payload.scope),
        eq(llmInstanceConfigs.scopeId, effectiveScopeId),
        eq(llmInstanceConfigs.instanceSlot, request.envelope.payload.slot),
      ))
      .all()

    if (existing.length === 0) {
      throw new ConfigMutationError(
        "config_not_found",
        `No config found for slot=${request.envelope.payload.slot} scope=${request.envelope.payload.scope} scopeId=${effectiveScopeId}`,
      )
    }

    request.context.tx
      .delete(llmInstanceConfigs)
      .where(eq(llmInstanceConfigs.id, existing[0]!.id))
      .run()

    return {
      result: undefined,
    }
  }

  private ensureSessionScopeExists(
    request: RuntimeMutationApplyRequest<unknown>,
    sessionId: string,
  ): void {
    const session = request.context.tx
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.accountId, request.envelope.accountId)))
      .limit(1)
      .get()

    if (!session) {
      throw new ConfigMutationError(
        "session_scope_not_found",
        `Session not found for session-scoped binding: ${sessionId}`,
      )
    }
  }

  private cleanupStaleSessionBindingsForProfile(
    request: RuntimeMutationApplyRequest<DeleteLlmProfileMutationPayload>,
    profileId: string,
  ) {
    const sessionBindings = request.context.tx
      .select({ id: llmProfileBindings.id, scopeId: llmProfileBindings.scopeId })
      .from(llmProfileBindings)
      .where(and(
        eq(llmProfileBindings.profileId, profileId),
        eq(llmProfileBindings.accountId, request.envelope.accountId),
        eq(llmProfileBindings.scope, "session"),
      ))
      .all()

    if (sessionBindings.length === 0) {
      return
    }

    const scopeIds = sessionBindings.map((binding) => binding.scopeId)
    const existingSessions = new Set(
      request.context.tx
        .select({ id: sessions.id })
        .from(sessions)
        .where(and(
          eq(sessions.accountId, request.envelope.accountId),
          inArray(sessions.id, scopeIds),
        ))
        .all()
        .map((row) => row.id),
    )

    const staleBindingIds = sessionBindings
      .filter((binding) => !existingSessions.has(binding.scopeId))
      .map((binding) => binding.id)

    if (staleBindingIds.length === 0) {
      return
    }

    request.context.tx.delete(llmProfileBindings)
      .where(and(
        eq(llmProfileBindings.accountId, request.envelope.accountId),
        inArray(llmProfileBindings.id, staleBindingIds),
      ))
      .run()
  }
}

export function registerConfigMutationAppliers(
  registry: MutationApplierRegistry,
  applier: ConfigMutationApplier = new ConfigMutationApplier(),
): ConfigMutationApplier {
  registry.register(CONFIG_MUTATION_KINDS.llmProfileCreate, applier as RuntimeMutationApplier<unknown, unknown>)
  registry.register(CONFIG_MUTATION_KINDS.llmProfileUpdate, applier as RuntimeMutationApplier<unknown, unknown>)
  registry.register(CONFIG_MUTATION_KINDS.llmProfileDelete, applier as RuntimeMutationApplier<unknown, unknown>)
  registry.register(CONFIG_MUTATION_KINDS.llmProfileActivate, applier as RuntimeMutationApplier<unknown, unknown>)
  registry.register(CONFIG_MUTATION_KINDS.llmProfileUnbind, applier as RuntimeMutationApplier<unknown, unknown>)
  registry.register(CONFIG_MUTATION_KINDS.llmInstanceUpsert, applier as RuntimeMutationApplier<unknown, unknown>)
  registry.register(CONFIG_MUTATION_KINDS.llmInstanceDelete, applier as RuntimeMutationApplier<unknown, unknown>)
  return applier
}
