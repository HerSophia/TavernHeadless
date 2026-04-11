import { and, eq } from "drizzle-orm";
import { z } from "zod";

import type { AppDb } from "../db/client.js";
import { characters, presets, regexProfiles, sessions, worldbooks } from "../db/schema.js";
import { parseJsonField, stringifyJsonField } from "../lib/http.js";
import type {
  PromptDeliveryPolicy,
  PromptStructureAssistantRewriteStrategy,
  PromptStructureMode,
  PromptStructurePolicy,
} from "./prompt-assembler.js";

export const PROMPT_RUNTIME_SUPPORTED_STRUCTURE_MODES = ["default", "strict_alternating", "no_assistant"] as const satisfies readonly PromptStructureMode[];
export const PROMPT_RUNTIME_SUPPORTED_ASSISTANT_REWRITE_STRATEGIES = ["to_system", "to_user_transcript"] as const satisfies readonly PromptStructureAssistantRewriteStrategy[];
export const PROMPT_RUNTIME_UNSUPPORTED_ROUTES = [
  "/sessions/:id/prompt-runtime/run",
  "/sessions/:id/prompt-runtime/macros",
  "/floors/:id/prompt-runtime",
  "/messages/:id/prompt-runtime",
] as const;
export const PROMPT_RUNTIME_POLICY_SOURCES = ["system_default", "asset_default", "session_policy", "request_override", "provider_constraint"] as const;
export const INVALID_PROMPT_RUNTIME_POLICY_WARNING = "Session metadata contains an invalid prompt_runtime.policy object. The control plane ignored it.";
export const DERIVED_NO_ASSISTANT_STRUCTURE_WARNING = "delivery.noAssistant forced the resolved structure.mode to no_assistant.";

const promptStructurePolicySchema = z.object({
  mode: z.enum(PROMPT_RUNTIME_SUPPORTED_STRUCTURE_MODES),
  mergeAdjacentSameRole: z.boolean().optional(),
  assistantRewriteStrategy: z.enum(PROMPT_RUNTIME_SUPPORTED_ASSISTANT_REWRITE_STRATEGIES).optional(),
  preserveSystemMessages: z.boolean().optional(),
}).strict();

const promptDeliveryPolicySchema = z.object({
  allowAssistantPrefill: z.boolean().optional(),
  requireLastUser: z.boolean().optional(),
  noAssistant: z.boolean().optional(),
}).strict();

const promptRuntimePersistentPolicySchema = z.object({
  structure: promptStructurePolicySchema.optional(),
  delivery: promptDeliveryPolicySchema.optional(),
}).strict();

export interface PromptRuntimeAssetSummary {
  id: string;
  name: string | null;
}

export interface PromptRuntimeAssetsView {
  preset: PromptRuntimeAssetSummary | null;
  characterCard: PromptRuntimeAssetSummary | null;
  worldbook: PromptRuntimeAssetSummary | null;
  regexProfile: PromptRuntimeAssetSummary | null;
}

export interface PromptRuntimePersistentPolicy {
  structure?: PromptStructurePolicy;
  delivery?: PromptDeliveryPolicy;
}

export interface PromptRuntimePersistentPolicyPatch {
  structure?: PromptStructurePolicy | null;
  delivery?: PromptDeliveryPolicy | null;
}

export interface PromptRuntimeDebugPolicy {
  includePromptSnapshot: boolean;
  includeRuntimeTrace: boolean;
  includeWorldbookMatches: boolean;
}

export interface ResolvedPromptStructurePolicy {
  mode: PromptStructureMode;
  mergeAdjacentSameRole: boolean;
  preserveSystemMessages: boolean;
  assistantRewriteStrategy?: PromptStructureAssistantRewriteStrategy;
}

export interface ResolvedPromptDeliveryPolicy {
  allowAssistantPrefill: boolean;
  requireLastUser: boolean;
  noAssistant: boolean;
}

export interface ResolvedPromptRuntimePolicy {
  structure: ResolvedPromptStructurePolicy;
  delivery: ResolvedPromptDeliveryPolicy;
  debug: PromptRuntimeDebugPolicy;
}

export interface PromptRuntimeSourceMap {
  structure?: {
    mode?: PromptRuntimePolicySource;
    mergeAdjacentSameRole?: PromptRuntimePolicySource;
    preserveSystemMessages?: PromptRuntimePolicySource;
    assistantRewriteStrategy?: PromptRuntimePolicySource;
  };
  delivery?: {
    allowAssistantPrefill?: PromptRuntimePolicySource;
    requireLastUser?: PromptRuntimePolicySource;
    noAssistant?: PromptRuntimePolicySource;
  };
  debug?: {
    includePromptSnapshot?: PromptRuntimePolicySource;
    includeRuntimeTrace?: PromptRuntimePolicySource;
    includeWorldbookMatches?: PromptRuntimePolicySource;
  };
}

export type PromptRuntimePolicySource = typeof PROMPT_RUNTIME_POLICY_SOURCES[number];

export interface PromptRuntimeResolvedState {
  policy: ResolvedPromptRuntimePolicy;
  persistentPolicy?: PromptRuntimePersistentPolicy;
  assets: PromptRuntimeAssetsView;
  sourceMap?: PromptRuntimeSourceMap;
  warnings: string[];
}

export interface PromptRuntimePolicyView {
  persistentPolicy?: PromptRuntimePersistentPolicy;
  resolvedPolicy: ResolvedPromptRuntimePolicy;
  warnings: string[];
}

export interface PromptRuntimeCapabilities {
  structure: {
    modes: readonly PromptStructureMode[];
    defaults: ResolvedPromptStructurePolicy;
  };
  delivery: {
    defaults: ResolvedPromptDeliveryPolicy;
  };
  observability: {
    live: {
      enabled: boolean;
      defaultOff: true;
      requestScopedOnly: true;
      includePromptSnapshot: true;
      includeRuntimeTrace: true;
      includeWorldbookMatches: true;
      worldbookMatchesRequiresRuntimeTrace: true;
      worldbookMatchesRequiresOptIn: true;
      visibilityRequestSupported: false;
    };
    dryRun: {
      enabled: boolean;
      returnsAssembly: true;
      returnsRuntimeTrace: true;
      supportsVisibility: true;
      includeWorldbookMatches: true;
    };
    preview: {
      enabled: boolean;
      returnsRuntimeTrace: true;
      supportsVisibility: true;
      singleTextOnly: true;
      llmCall: false;
      createsFloor: false;
      writesPromptSnapshot: false;
      commitsSideEffects: false;
    };
    stream: {
      enabled: boolean;
      promptDebugPayload: "done_only" | "unsupported";
      newSseEventFamily: false;
    };
  };
  macro: {
    builtInReadOnlyValuesPersistable: false;
    stCompatibilitySnapshotsPersistable: false;
    runKindPersistable: false;
    diagnosticsSurface: "unified_observability";
    dedicatedMacrosRoute: false;
    recentMessageRespectsVisibility: true;
  };
  unsupported: readonly string[];
}

export interface PromptRuntimeControlServiceOptions {
  enableLiveEndpoints?: boolean;
  enableDryRunEndpoint?: boolean;
  enablePreviewEndpoint?: boolean;
  enableStreamEndpoint?: boolean;
}

export const DEFAULT_RESOLVED_PROMPT_RUNTIME_DEBUG_POLICY: PromptRuntimeDebugPolicy = {
  includePromptSnapshot: false,
  includeRuntimeTrace: false,
  includeWorldbookMatches: false,
};

export const DEFAULT_RESOLVED_PROMPT_RUNTIME_DELIVERY_POLICY: ResolvedPromptDeliveryPolicy = {
  allowAssistantPrefill: true,
  requireLastUser: false,
  noAssistant: false,
};

export const DEFAULT_RESOLVED_PROMPT_RUNTIME_STRUCTURE_POLICY: ResolvedPromptStructurePolicy = {
  mode: "default",
  mergeAdjacentSameRole: false,
  preserveSystemMessages: true,
};

export class PromptRuntimeControlServiceError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PromptRuntimeControlServiceError";
  }
}

export class PromptRuntimeControlService {
  private readonly enableLiveEndpoints: boolean;
  private readonly enableDryRunEndpoint: boolean;
  private readonly enableStreamEndpoint: boolean;
  private readonly enablePreviewEndpoint: boolean;

  constructor(
    private readonly db: AppDb,
    options: PromptRuntimeControlServiceOptions = {},
  ) {
    this.enableLiveEndpoints = options.enableLiveEndpoints === true;
    this.enableDryRunEndpoint = options.enableDryRunEndpoint === true;
    this.enablePreviewEndpoint = options.enablePreviewEndpoint === true;
    this.enableStreamEndpoint = options.enableStreamEndpoint === true;
  }

  async getResolvedState(sessionId: string, accountId: string): Promise<PromptRuntimeResolvedState> {
    const session = await this.getOwnedSession(sessionId, accountId);
    const assets = await this.buildAssetsView(session, accountId);
    const { persistentPolicy, warnings } = readPromptRuntimePersistentPolicy(session.metadataJson);
    const resolvedPolicy = buildResolvedPromptRuntimePolicy(persistentPolicy);
    const controlPlaneWarnings = buildPromptRuntimeWarnings(persistentPolicy, warnings);

    return {
      policy: resolvedPolicy,
      ...(persistentPolicy ? { persistentPolicy } : {}),
      assets,
      sourceMap: buildPromptRuntimeSourceMap(persistentPolicy, resolvedPolicy),
      warnings: controlPlaneWarnings,
    };
  }

  async getPolicy(sessionId: string, accountId: string): Promise<PromptRuntimePolicyView> {
    const session = await this.getOwnedSession(sessionId, accountId);
    const { persistentPolicy, warnings } = readPromptRuntimePersistentPolicy(session.metadataJson);
    const controlPlaneWarnings = buildPromptRuntimeWarnings(persistentPolicy, warnings);

    return {
      ...(persistentPolicy ? { persistentPolicy } : {}),
      resolvedPolicy: buildResolvedPromptRuntimePolicy(persistentPolicy),
      warnings: controlPlaneWarnings,
    };
  }

  async getAssets(sessionId: string, accountId: string): Promise<PromptRuntimeAssetsView> {
    const session = await this.getOwnedSession(sessionId, accountId);
    return this.buildAssetsView(session, accountId);
  }

  async updatePolicy(
    sessionId: string,
    accountId: string,
    patch: PromptRuntimePersistentPolicyPatch,
  ): Promise<PromptRuntimePolicyView> {
    const session = await this.getOwnedSession(sessionId, accountId);
    const metadata = parseMetadataRecord(session.metadataJson);
    const { persistentPolicy } = readPromptRuntimePersistentPolicy(session.metadataJson);
    const nextPersistentPolicy = applyPromptRuntimePersistentPolicyPatch(persistentPolicy, patch);
    const nextMetadata = writePromptRuntimePersistentPolicyToMetadata(metadata, nextPersistentPolicy);
    const updatedAt = Date.now();

    await this.db
      .update(sessions)
      .set({
        metadataJson: stringifyJsonField(nextMetadata),
        updatedAt,
      })
      .where(and(eq(sessions.id, sessionId), eq(sessions.accountId, accountId)));

    return {
      ...(nextPersistentPolicy ? { persistentPolicy: nextPersistentPolicy } : {}),
      resolvedPolicy: buildResolvedPromptRuntimePolicy(nextPersistentPolicy),
      warnings: buildPromptRuntimeWarnings(nextPersistentPolicy),
    };
  }

  getCapabilities(): PromptRuntimeCapabilities {
    return {
      structure: {
        modes: PROMPT_RUNTIME_SUPPORTED_STRUCTURE_MODES,
        defaults: { ...DEFAULT_RESOLVED_PROMPT_RUNTIME_STRUCTURE_POLICY },
      },
      delivery: {
        defaults: { ...DEFAULT_RESOLVED_PROMPT_RUNTIME_DELIVERY_POLICY },
      },
      observability: {
        live: {
          enabled: this.enableLiveEndpoints,
          defaultOff: true,
          requestScopedOnly: true,
          includePromptSnapshot: true,
          includeRuntimeTrace: true,
          includeWorldbookMatches: true,
          worldbookMatchesRequiresRuntimeTrace: true,
          worldbookMatchesRequiresOptIn: true,
          visibilityRequestSupported: false,
        },
        dryRun: {
          enabled: this.enableDryRunEndpoint,
          returnsAssembly: true,
          returnsRuntimeTrace: true,
          supportsVisibility: true,
          includeWorldbookMatches: true,
        },
        preview: {
          enabled: this.enablePreviewEndpoint,
          returnsRuntimeTrace: true,
          supportsVisibility: true,
          singleTextOnly: true,
          llmCall: false,
          createsFloor: false,
          writesPromptSnapshot: false,
          commitsSideEffects: false,
        },
        stream: {
          enabled: this.enableStreamEndpoint,
          promptDebugPayload: this.enableStreamEndpoint ? "done_only" : "unsupported",
          newSseEventFamily: false,
        },
      },
      macro: {
        builtInReadOnlyValuesPersistable: false,
        stCompatibilitySnapshotsPersistable: false,
        runKindPersistable: false,
        diagnosticsSurface: "unified_observability",
        dedicatedMacrosRoute: false,
        recentMessageRespectsVisibility: true,
      },
      unsupported: PROMPT_RUNTIME_UNSUPPORTED_ROUTES,
    };
  }

  private async getOwnedSession(sessionId: string, accountId: string) {
    const [session] = await this.db
      .select({
        id: sessions.id,
        accountId: sessions.accountId,
        characterId: sessions.characterId,
        characterSnapshotJson: sessions.characterSnapshotJson,
        presetId: sessions.presetId,
        worldbookProfileId: sessions.worldbookProfileId,
        regexProfileId: sessions.regexProfileId,
        metadataJson: sessions.metadataJson,
      })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.accountId, accountId)))
      .limit(1);

    if (!session) {
      throw new PromptRuntimeControlServiceError(404, "not_found", "Session not found");
    }

    return session;
  }

  private async buildAssetsView(
    session: Awaited<ReturnType<PromptRuntimeControlService["getOwnedSession"]>>,
    accountId: string,
  ): Promise<PromptRuntimeAssetsView> {
    const characterSnapshotName = parseSnapshotName(session.characterSnapshotJson);
    const [characterName, presetName, worldbookName, regexProfileName] = await Promise.all([
      this.readCharacterName(accountId, session.characterId),
      this.readPresetName(accountId, session.presetId),
      this.readWorldbookName(accountId, session.worldbookProfileId),
      this.readRegexProfileName(accountId, session.regexProfileId),
    ]);

    return {
      preset: toAssetSummary(session.presetId, presetName),
      characterCard: session.characterId
        ? {
            id: session.characterId,
            name: characterName ?? characterSnapshotName,
          }
        : null,
      worldbook: toAssetSummary(session.worldbookProfileId, worldbookName),
      regexProfile: toAssetSummary(session.regexProfileId, regexProfileName),
    };
  }

  private async readCharacterName(accountId: string, characterId: string | null): Promise<string | null> {
    if (!characterId) {
      return null;
    }

    const [row] = await this.db
      .select({ name: characters.name })
      .from(characters)
      .where(and(eq(characters.id, characterId), eq(characters.accountId, accountId)))
      .limit(1);

    return row?.name ?? null;
  }

  private async readPresetName(accountId: string, presetId: string | null): Promise<string | null> {
    if (!presetId) {
      return null;
    }

    const [row] = await this.db
      .select({ name: presets.name })
      .from(presets)
      .where(and(eq(presets.id, presetId), eq(presets.accountId, accountId)))
      .limit(1);

    return row?.name ?? null;
  }

  private async readWorldbookName(accountId: string, worldbookId: string | null): Promise<string | null> {
    if (!worldbookId) {
      return null;
    }

    const [row] = await this.db
      .select({ name: worldbooks.name })
      .from(worldbooks)
      .where(and(eq(worldbooks.id, worldbookId), eq(worldbooks.accountId, accountId)))
      .limit(1);

    return row?.name ?? null;
  }

  private async readRegexProfileName(accountId: string, regexProfileId: string | null): Promise<string | null> {
    if (!regexProfileId) {
      return null;
    }

    const [row] = await this.db
      .select({ name: regexProfiles.name })
      .from(regexProfiles)
      .where(and(eq(regexProfiles.id, regexProfileId), eq(regexProfiles.accountId, accountId)))
      .limit(1);

    return row?.name ?? null;
  }
}

export function buildResolvedPromptRuntimePolicy(
  persistentPolicy?: PromptRuntimePersistentPolicy,
): ResolvedPromptRuntimePolicy {
  const delivery = resolvePromptRuntimeDeliveryPolicy(persistentPolicy?.delivery);

  return {
    structure: resolvePromptRuntimeStructurePolicy(persistentPolicy?.structure, delivery),
    delivery,
    debug: { ...DEFAULT_RESOLVED_PROMPT_RUNTIME_DEBUG_POLICY },
  };
}

export function resolvePromptRuntimeDeliveryPolicy(
  deliveryPolicy?: PromptDeliveryPolicy,
): ResolvedPromptDeliveryPolicy {
  return {
    allowAssistantPrefill: deliveryPolicy?.allowAssistantPrefill ?? true,
    requireLastUser: deliveryPolicy?.requireLastUser ?? false,
    noAssistant: deliveryPolicy?.noAssistant ?? false,
  };
}

export function mergePromptStructurePolicy(
  base: PromptStructurePolicy | undefined,
  override: PromptStructurePolicy | undefined,
): PromptStructurePolicy | undefined {
  if (!base && !override) {
    return undefined;
  }

  const merged = {
    ...(base ?? {}),
    ...(override ?? {}),
  } as Partial<PromptStructurePolicy>;

  if (!merged.mode) {
    return undefined;
  }

  return merged as PromptStructurePolicy;
}

export function mergePromptDeliveryPolicy(
  base: PromptDeliveryPolicy | undefined,
  override: PromptDeliveryPolicy | undefined,
): PromptDeliveryPolicy | undefined {
  if (!base && !override) {
    return undefined;
  }

  const merged: PromptDeliveryPolicy = {
    ...(base ?? {}),
    ...(override ?? {}),
  };

  return Object.keys(merged).length > 0 ? merged : undefined;
}

export function applyPromptRuntimePersistentPolicyPatch(
  current: PromptRuntimePersistentPolicy | undefined,
  patch: PromptRuntimePersistentPolicyPatch,
): PromptRuntimePersistentPolicy | undefined {
  const next: PromptRuntimePersistentPolicy = {};

  const nextStructure = patch.structure === undefined
    ? current?.structure
    : patch.structure === null
      ? undefined
      : mergePromptStructurePolicy(current?.structure, patch.structure);
  const nextDelivery = patch.delivery === undefined
    ? current?.delivery
    : patch.delivery === null
      ? undefined
      : mergePromptDeliveryPolicy(current?.delivery, patch.delivery);

  if (nextStructure) {
    next.structure = nextStructure;
  }
  if (nextDelivery) {
    next.delivery = nextDelivery;
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

export function resolvePromptRuntimeStructurePolicy(
  structurePolicy: PromptStructurePolicy | undefined,
  deliveryPolicy?: PromptDeliveryPolicy | ResolvedPromptDeliveryPolicy,
): ResolvedPromptStructurePolicy {
  let effectiveStructurePolicy = structurePolicy;

  if (deliveryPolicy?.noAssistant === true && structurePolicy?.mode !== "no_assistant") {
    effectiveStructurePolicy = {
      mode: "no_assistant",
      mergeAdjacentSameRole: structurePolicy?.mergeAdjacentSameRole
        ?? (structurePolicy?.mode === "strict_alternating" ? true : undefined),
      assistantRewriteStrategy: structurePolicy?.assistantRewriteStrategy,
      preserveSystemMessages: structurePolicy?.preserveSystemMessages,
    };
  }

  const mode = effectiveStructurePolicy?.mode ?? DEFAULT_RESOLVED_PROMPT_RUNTIME_STRUCTURE_POLICY.mode;
  const mergeAdjacentSameRole = effectiveStructurePolicy?.mergeAdjacentSameRole ?? (mode === "strict_alternating");
  const preserveSystemMessages = effectiveStructurePolicy?.preserveSystemMessages ?? true;
  const assistantRewriteStrategy = mode === "no_assistant"
    ? effectiveStructurePolicy?.assistantRewriteStrategy ?? "to_system"
    : undefined;

  return {
    mode,
    mergeAdjacentSameRole,
    preserveSystemMessages,
    ...(assistantRewriteStrategy ? { assistantRewriteStrategy } : {}),
  };
}

function buildPromptRuntimeSourceMap(
  persistentPolicy?: PromptRuntimePersistentPolicy,
  resolvedPolicy?: ResolvedPromptRuntimePolicy,
): PromptRuntimeSourceMap {
  const structureModeFromSession = persistentPolicy?.structure?.mode !== undefined
    || persistentPolicy?.delivery?.noAssistant === true;
  const assistantRewriteStrategySource = resolvedPolicy?.structure.assistantRewriteStrategy
    ? persistentPolicy?.structure?.assistantRewriteStrategy !== undefined
      ? "session_policy"
      : "system_default"
    : undefined;

  return {
    structure: {
      mode: structureModeFromSession ? "session_policy" : "system_default",
      mergeAdjacentSameRole:
        persistentPolicy?.structure?.mergeAdjacentSameRole !== undefined || structureModeFromSession
          ? "session_policy"
          : "system_default",
      preserveSystemMessages:
        persistentPolicy?.structure?.preserveSystemMessages !== undefined
          ? "session_policy"
          : "system_default",
      ...(assistantRewriteStrategySource
        ? { assistantRewriteStrategy: assistantRewriteStrategySource }
        : {}),
    },
    delivery: {
      allowAssistantPrefill:
        persistentPolicy?.delivery?.allowAssistantPrefill !== undefined
          ? "session_policy"
          : "system_default",
      requireLastUser:
        persistentPolicy?.delivery?.requireLastUser !== undefined
          ? "session_policy"
          : "system_default",
      noAssistant:
        persistentPolicy?.delivery?.noAssistant !== undefined
          ? "session_policy"
          : "system_default",
    },
  };
}

function buildPromptRuntimeWarnings(
  persistentPolicy?: PromptRuntimePersistentPolicy,
  metadataWarnings: string[] = [],
): string[] {
  const warnings = [...metadataWarnings];

  if (
    persistentPolicy?.delivery?.noAssistant === true
    && persistentPolicy?.structure?.mode !== "no_assistant"
  ) {
    warnings.push(DERIVED_NO_ASSISTANT_STRUCTURE_WARNING);
  }

  return warnings;
}

export function readPromptRuntimePersistentPolicy(
  metadataJson: string | null,
): { persistentPolicy?: PromptRuntimePersistentPolicy; warnings: string[] } {
  const metadata = parseJsonField(metadataJson);
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return { warnings: [] };
  }

  const namespace = (metadata as Record<string, unknown>).prompt_runtime;
  if (namespace === undefined || namespace === null) {
    return { warnings: [] };
  }

  if (typeof namespace !== "object" || Array.isArray(namespace)) {
    return { warnings: [INVALID_PROMPT_RUNTIME_POLICY_WARNING] };
  }

  const policy = (namespace as Record<string, unknown>).policy;
  if (policy === undefined || policy === null) {
    return { warnings: [] };
  }

  const parsed = promptRuntimePersistentPolicySchema.safeParse(policy);
  if (!parsed.success) {
    return { warnings: [INVALID_PROMPT_RUNTIME_POLICY_WARNING] };
  }

  const normalized = normalizePersistentPolicy(parsed.data);
  return normalized
    ? { persistentPolicy: normalized, warnings: [] }
    : { warnings: [] };
}

function normalizePersistentPolicy(
  value: z.infer<typeof promptRuntimePersistentPolicySchema>,
): PromptRuntimePersistentPolicy | undefined {
  const normalized: PromptRuntimePersistentPolicy = {};

  if (value.structure) {
    normalized.structure = {
      mode: value.structure.mode,
      ...(value.structure.mergeAdjacentSameRole !== undefined
        ? { mergeAdjacentSameRole: value.structure.mergeAdjacentSameRole }
        : {}),
      ...(value.structure.assistantRewriteStrategy !== undefined
        ? { assistantRewriteStrategy: value.structure.assistantRewriteStrategy }
        : {}),
      ...(value.structure.preserveSystemMessages !== undefined
        ? { preserveSystemMessages: value.structure.preserveSystemMessages }
        : {}),
    };
  }

  if (value.delivery) {
    const delivery: PromptDeliveryPolicy = {
      ...(value.delivery.allowAssistantPrefill !== undefined
        ? { allowAssistantPrefill: value.delivery.allowAssistantPrefill }
        : {}),
      ...(value.delivery.requireLastUser !== undefined
        ? { requireLastUser: value.delivery.requireLastUser }
        : {}),
      ...(value.delivery.noAssistant !== undefined
        ? { noAssistant: value.delivery.noAssistant }
        : {}),
    };

    if (Object.keys(delivery).length > 0) {
      normalized.delivery = delivery;
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function serializePromptRuntimePersistentPolicy(
  policy: PromptRuntimePersistentPolicy,
): Record<string, unknown> {
  const serialized: Record<string, unknown> = {};

  if (policy.structure) {
    serialized.structure = {
      mode: policy.structure.mode,
      ...(policy.structure.mergeAdjacentSameRole !== undefined
        ? { mergeAdjacentSameRole: policy.structure.mergeAdjacentSameRole }
        : {}),
      ...(policy.structure.assistantRewriteStrategy !== undefined
        ? { assistantRewriteStrategy: policy.structure.assistantRewriteStrategy }
        : {}),
      ...(policy.structure.preserveSystemMessages !== undefined
        ? { preserveSystemMessages: policy.structure.preserveSystemMessages }
        : {}),
    };
  }

  if (policy.delivery) {
    serialized.delivery = {
      ...(policy.delivery.allowAssistantPrefill !== undefined
        ? { allowAssistantPrefill: policy.delivery.allowAssistantPrefill }
        : {}),
      ...(policy.delivery.requireLastUser !== undefined
        ? { requireLastUser: policy.delivery.requireLastUser }
        : {}),
      ...(policy.delivery.noAssistant !== undefined
        ? { noAssistant: policy.delivery.noAssistant }
        : {}),
    };
  }

  return serialized;
}

function parseMetadataRecord(metadataJson: string | null): Record<string, unknown> {
  const metadata = parseJsonField(metadataJson);
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }

  return { ...(metadata as Record<string, unknown>) };
}

function writePromptRuntimePersistentPolicyToMetadata(
  metadata: Record<string, unknown>,
  policy: PromptRuntimePersistentPolicy | undefined,
): Record<string, unknown> | undefined {
  const nextMetadata = { ...metadata };
  const existingNamespace = nextMetadata.prompt_runtime;
  const nextNamespace = existingNamespace && typeof existingNamespace === "object" && !Array.isArray(existingNamespace)
    ? { ...(existingNamespace as Record<string, unknown>) }
    : {};

  if (policy) {
    nextNamespace.policy = serializePromptRuntimePersistentPolicy(policy);
    nextMetadata.prompt_runtime = nextNamespace;
  } else {
    delete nextNamespace.policy;
    if (Object.keys(nextNamespace).length > 0) nextMetadata.prompt_runtime = nextNamespace;
    else delete nextMetadata.prompt_runtime;
  }

  return Object.keys(nextMetadata).length > 0 ? nextMetadata : undefined;
}

function parseSnapshotName(snapshotJson: string | null): string | null {
  const snapshot = parseJsonField(snapshotJson);
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return null;
  }

  const name = (snapshot as { name?: unknown }).name;
  return typeof name === "string" && name.trim().length > 0
    ? name.trim()
    : null;
}

function toAssetSummary(id: string | null, name: string | null): PromptRuntimeAssetSummary | null {
  if (!id) {
    return null;
  }

  return { id, name };
}
