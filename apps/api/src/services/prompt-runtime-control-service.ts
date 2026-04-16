import { and, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";

import type { AppDb } from "../db/client.js";
import type { PromptVisibilityPolicy } from "./chat-history-loader.js";
import { characters, floorResultSnapshots, floors, presets, promptRuntimeExplainSnapshots, promptSnapshots, regexProfiles, sessions, worldbooks } from "../db/schema.js";
import { parseJsonField, stringifyJsonField } from "../lib/http.js";
import type {
  PromptBudgetPolicy,
  PromptDeliveryPolicy,
  PromptSnapshotPreview,
  PromptSourceExclusionReason,
  PromptSourceSelectionPolicy,
  PromptStructureAssistantRewriteStrategy,
  PromptStructureMode,
  PromptStructurePolicy,
  PromptTrimReason,
} from "./prompt-assembler.js";

export const PROMPT_RUNTIME_SUPPORTED_STRUCTURE_MODES = ["default", "strict_alternating", "no_assistant", "flattened"] as const satisfies readonly PromptStructureMode[];
export const PROMPT_RUNTIME_SUPPORTED_ASSISTANT_REWRITE_STRATEGIES = ["to_system", "to_user_transcript"] as const satisfies readonly PromptStructureAssistantRewriteStrategy[];
export const PROMPT_RUNTIME_UNSUPPORTED_ROUTES = [
  "/sessions/:id/prompt-runtime/run",
  "/sessions/:id/prompt-runtime/macros",
  "/floors/:id/prompt-runtime",
  "/messages/:id/prompt-runtime",
] as const;
export const PROMPT_RUNTIME_POLICY_SOURCES = ["system_default", "asset_default", "session_policy", "branch_policy", "request_override", "provider_constraint"] as const;
export const INVALID_PROMPT_RUNTIME_POLICY_WARNING = "Session metadata contains an invalid prompt_runtime.policy object. The control plane ignored it.";
export const INVALID_PROMPT_RUNTIME_BRANCH_POLICY_WARNING = "Session metadata contains an invalid prompt_runtime.branchPolicies entry for this branch. The control plane ignored it.";
export const DERIVED_NO_ASSISTANT_STRUCTURE_WARNING = "delivery.noAssistant forced the resolved structure.mode to no_assistant.";
export const PROMPT_RUNTIME_LIMITATIONS = [
  "Memory remains scoped to global / chat / floor. Branch isolation is not available.",
  "Variable commit remains page -> floor. Branch promotion is not automatic.",
] as const;
export const PROMPT_RUNTIME_PREVIEW_LIMITATIONS = [
  "Preview returns a macro_text_preview sub-view. It does not perform full prompt assembly, budget allocation, or delivery-time structure decisions.",
  "Preview exposes only macro, source_selection, and visibility traces. It does not return assembled messages, materialized delivery results, or executable prompt snapshot truth.",
] as const;
export const PROMPT_RUNTIME_HISTORICAL_EXPLAIN_LIMITATIONS = [
  "Historical explain reads persisted prompt snapshot and committed floor result only. It does not re-run prompt assembly, macro evaluation, or budget decisions.",
  "Older committed floors without a prompt_runtime_explain_snapshot may return resolved policy, policy source-map fields, trim reasons, excluded sources, and section stats as null.",
] as const;

export type PromptRuntimeHistorySourceMode = "existing_branch" | "source_floor_branch" | "main_fallback";
export type PromptRuntimeDiagnosticSeverity = "info" | "warning" | "error";
export type PromptRuntimeDiagnosticSource = "policy" | "branch" | "macro" | "budget" | "source_selection" | "provider_constraint";
export type PromptRuntimeDiagnosticPhase = "preview" | "dry_run" | "assemble" | "commit_consume" | "explain";
export const PROMPT_RUNTIME_SUPPORTED_SOURCE_SELECTION_HISTORY_MODES = ["full", "windowed"] as const;
export const PROMPT_RUNTIME_SUPPORTED_SOURCE_SELECTION_SOURCES = ["history", "memory", "worldbook", "examples"] as const;
export const PROMPT_RUNTIME_SUPPORTED_TRIM_REASON_CODES = ["budget_exceeded", "group_limit_exceeded", "provider_constraint", "policy_disabled"] as const;
export const PROMPT_RUNTIME_SUPPORTED_SOURCE_EXCLUSION_REASON_CODES = ["disabled_by_policy", "budget_trimmed", "provider_constraint", "visibility_filtered", "not_triggered"] as const;
export const PROMPT_RUNTIME_SUPPORTED_VISIBILITY_MODES = ["allow_all_except_hidden", "deny_all_except_visible"] as const;
export const PROMPT_RUNTIME_GOVERNED_POLICY_FIELDS = ["structure", "delivery", "budget", "sourceSelection", "visibility"] as const;
export type PromptRuntimeSourceSelectionHistoryMode = typeof PROMPT_RUNTIME_SUPPORTED_SOURCE_SELECTION_HISTORY_MODES[number];
export type PromptRuntimeVisibilityMode = typeof PROMPT_RUNTIME_SUPPORTED_VISIBILITY_MODES[number];

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

const promptBudgetPolicySchema = z.object({
  maxInputTokens: z.number().int().positive().optional(),
  reservedCompletionTokens: z.number().int().positive().optional(),
}).strict();

const floorVisibilityRangeSchema = z.object({
  startFloorNo: z.number().int(),
  endFloorNo: z.number().int(),
}).strict();

const promptVisibilityPolicySchema = z.object({
  hiddenFloorRanges: z.array(floorVisibilityRangeSchema).optional(),
  visibleFloorRanges: z.array(floorVisibilityRangeSchema).optional(),
  hiddenFloorIds: z.array(z.string().min(1)).optional(),
  mode: z.enum(PROMPT_RUNTIME_SUPPORTED_VISIBILITY_MODES).optional(),
}).strict();

const promptSourceSelectionPolicySchema = z.object({
  history: z.object({
    mode: z.enum(PROMPT_RUNTIME_SUPPORTED_SOURCE_SELECTION_HISTORY_MODES).optional(),
    maxMessages: z.number().int().positive().optional(),
  }).strict().optional(),
  memory: z.object({ enabled: z.boolean().optional() }).strict().optional(),
  worldbook: z.object({ enabled: z.boolean().optional() }).strict().optional(),
  examples: z.object({ enabled: z.boolean().optional() }).strict().optional(),
}).strict();

const promptRuntimePersistentPolicySchema = z.object({
  structure: promptStructurePolicySchema.optional(),
  delivery: promptDeliveryPolicySchema.optional(),
  budget: promptBudgetPolicySchema.optional(),
  sourceSelection: promptSourceSelectionPolicySchema.optional(),
  visibility: promptVisibilityPolicySchema.optional(),
}).strict();

const promptRuntimePersistedPolicyEnvelopeSchema = z.object({
  version: z.number().int().positive(),
  updatedAt: z.number().int().nonnegative(),
  updatedBy: z.string().min(1).nullable().optional(),
  value: promptRuntimePersistentPolicySchema,
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
  budget?: PromptBudgetPolicy;
  sourceSelection?: PromptSourceSelectionPolicy;
  visibility?: PromptVisibilityPolicy;
}

export type PromptRuntimeGovernedPolicy = PromptRuntimePersistentPolicy;

export interface PromptRuntimePersistedPolicyEnvelope {
  version: number;
  updatedAt: number;
  updatedBy?: string | null;
  value: PromptRuntimeGovernedPolicy;
}

export interface PromptRuntimePersistentPolicyPatch {
  structure?: PromptStructurePolicy | null;
  delivery?: PromptDeliveryPolicy | null;
  budget?: PromptBudgetPolicy | null;
  sourceSelection?: PromptSourceSelectionPolicy | null;
  visibility?: PromptVisibilityPolicy | null;
}

export interface PromptRuntimeDebugPolicy {
  includePromptSnapshot: boolean;
  includeRuntimeTrace: boolean;
  includeWorldbookMatches: boolean;
}

export interface ResolvedPromptBudgetPolicy {
  maxInputTokens?: number;
  reservedCompletionTokens?: number;
}

export interface ResolvedPromptSourceSelectionPolicy {
  history: { mode: PromptRuntimeSourceSelectionHistoryMode; maxMessages?: number };
  memory: { enabled: boolean };
  worldbook: { enabled: boolean };
  examples: { enabled: boolean };
}

export interface ResolvedPromptVisibilityPolicy extends Omit<PromptVisibilityPolicy, "mode"> {
  mode: PromptRuntimeVisibilityMode;
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
  budget: ResolvedPromptBudgetPolicy;
  sourceSelection: ResolvedPromptSourceSelectionPolicy;
  visibility: ResolvedPromptVisibilityPolicy;
}

export type ResolvedPromptRuntimePolicyV4 = ResolvedPromptRuntimePolicy;

export interface PromptRuntimeScopeRef {
  sessionId: string;
  targetBranchId: string;
  branchExists: boolean;
  sourceFloorId?: string | null;
  historySourceBranchId: string;
  historySourceMode: PromptRuntimeHistorySourceMode;
}

export interface PromptRuntimeDiagnostic {
  code: string;
  message: string;
  severity: PromptRuntimeDiagnosticSeverity;
  source?: PromptRuntimeDiagnosticSource;
  fieldPath?: string;
  phase?: PromptRuntimeDiagnosticPhase;
}

export interface PromptRuntimeSectionStat {
  sectionName: string;
  tokenCount: number;
}

export type PromptRuntimeDiffChangeType = "added" | "removed" | "changed";

export interface PromptRuntimeDiffEntry<TValue = unknown> {
  path: string;
  changeType: PromptRuntimeDiffChangeType;
  left?: TValue;
  right?: TValue;
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
  budget?: {
    maxInputTokens?: PromptRuntimePolicySource;
    reservedCompletionTokens?: PromptRuntimePolicySource;
  };
  sourceSelection?: {
    history?: {
      mode?: PromptRuntimePolicySource;
      maxMessages?: PromptRuntimePolicySource;
    };
    memory?: { enabled?: PromptRuntimePolicySource };
    worldbook?: { enabled?: PromptRuntimePolicySource };
    examples?: { enabled?: PromptRuntimePolicySource };
  };
  visibility?: {
    hiddenFloorRanges?: PromptRuntimePolicySource;
    visibleFloorRanges?: PromptRuntimePolicySource;
    hiddenFloorIds?: PromptRuntimePolicySource;
    mode?: PromptRuntimePolicySource;
  };
  history?: {
    sourceBranchId?: string;
    sourceMode?: PromptRuntimeHistorySourceMode;
  };
}

export type PromptRuntimePolicySource = typeof PROMPT_RUNTIME_POLICY_SOURCES[number];

export interface PromptRuntimeResolvedState {
  scope: PromptRuntimeScopeRef;
  policy: ResolvedPromptRuntimePolicy;
  persistentPolicy?: PromptRuntimePersistentPolicy;
  persistentPolicyEnvelope?: PromptRuntimePersistedPolicyEnvelope | null;
  branchPersistentPolicy: PromptRuntimePersistentPolicy | null;
  branchPersistentPolicyEnvelope?: PromptRuntimePersistedPolicyEnvelope | null;
  assets: PromptRuntimeAssetsView;
  sourceMap?: PromptRuntimeSourceMap;
  warnings: string[];
  diagnostics: PromptRuntimeDiagnostic[];
  limitations: string[];
}

export interface PromptRuntimeHistoricalExplainFloorRef {
  id: string;
  sessionId: string;
  floorNo: number;
  branchId: string;
  parentFloorId: string | null;
  state: "committed";
  promptSnapshotCreatedAt: number;
  committedAt: number;
}

export interface PromptRuntimeHistoricalExplainCommittedResult {
  outputPageId: string;
  assistantMessageId: string;
  generatedText: string;
  summaries: string[];
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  verifier: { status: string; suggestion?: string | null; issues?: Array<{ description: string; severity: "warning" | "error" }> | null } | null;
  committedAt: number;
}

export interface PromptRuntimeHistoricalExplain {
  floor: PromptRuntimeHistoricalExplainFloorRef;
  scope: PromptRuntimeScopeRef;
  snapshotAvailable: boolean;
  assets: PromptRuntimeAssetsView | null;
  promptSnapshot: PromptSnapshotPreview;
  resolvedPolicy: ResolvedPromptRuntimePolicy | null;
  sourceMap?: PromptRuntimeSourceMap;
  trimReasons: PromptTrimReason[] | null;
  excludedSources: PromptSourceExclusionReason[] | null;
  sectionStats: PromptRuntimeSectionStat[] | null;
  diagnostics: PromptRuntimeDiagnostic[];
  limitations: string[];
  result: PromptRuntimeHistoricalExplainCommittedResult;
}

export interface PromptRuntimeInspectionResult {
  scope: PromptRuntimeScopeRef;
  assets: PromptRuntimeAssetsView;
  resolvedPolicy: ResolvedPromptRuntimePolicyV4;
  sourceMap: PromptRuntimeSourceMap;
  diagnostics: PromptRuntimeDiagnostic[];
  trimReasons: PromptTrimReason[];
  excludedSources: PromptSourceExclusionReason[];
  sectionStats: PromptRuntimeSectionStat[];
  limitations: string[];
}

export interface PromptRuntimeInspectionSnapshotPayload {
  targetBranchId?: string | null;
  sourceFloorId?: string | null;
  historySourceBranchId?: string | null;
  historySourceMode: PromptRuntimeHistorySourceMode;
  assets: PromptRuntimeAssetsView;
  resolvedPolicy: ResolvedPromptRuntimePolicyV4;
  sourceMap: PromptRuntimeSourceMap;
  diagnostics: PromptRuntimeDiagnostic[];
  trimReasons: PromptTrimReason[];
  excludedSources: PromptSourceExclusionReason[];
  sectionStats: PromptRuntimeSectionStat[];
  snapshotVersion: 1;
}

export function buildPromptRuntimeInspectionSnapshotPayload(
  inspection: PromptRuntimeInspectionResult,
): PromptRuntimeInspectionSnapshotPayload {
  return {
    targetBranchId: inspection.scope.targetBranchId,
    sourceFloorId: inspection.scope.sourceFloorId ?? null,
    historySourceBranchId: inspection.scope.historySourceBranchId,
    historySourceMode: inspection.scope.historySourceMode,
    assets: inspection.assets,
    resolvedPolicy: inspection.resolvedPolicy,
    sourceMap: inspection.sourceMap,
    diagnostics: inspection.diagnostics,
    trimReasons: inspection.trimReasons,
    excludedSources: inspection.excludedSources,
    sectionStats: inspection.sectionStats,
    snapshotVersion: 1,
  };
}

export interface PromptRuntimeCommittedExplainSnapshot extends PromptRuntimeInspectionSnapshotPayload {
  floorId: string;
  sessionId: string;
  createdAt: number;
}

export function buildPromptRuntimeCommittedExplainSnapshot(args: {
  floorId: string;
  sessionId: string;
  createdAt: number;
  inspection: PromptRuntimeInspectionResult;
}): PromptRuntimeCommittedExplainSnapshot {
  const snapshotPayload = buildPromptRuntimeInspectionSnapshotPayload(args.inspection);

  return {
    floorId: args.floorId,
    sessionId: args.sessionId,
    createdAt: args.createdAt,
    ...snapshotPayload,
  };
}

export type PromptRuntimeScopeDiff = PromptRuntimeDiffEntry<unknown>;
export type PromptRuntimePolicyDiff = PromptRuntimeDiffEntry<unknown>;
export type PromptRuntimeAssetDiff = PromptRuntimeDiffEntry<unknown>;
export type PromptRuntimeDiagnosticDiff = PromptRuntimeDiffEntry<unknown>;
export type PromptRuntimeTrimDiff = PromptRuntimeDiffEntry<unknown>;
export type PromptRuntimeExclusionDiff = PromptRuntimeDiffEntry<unknown>;

export interface PromptRuntimeExplainDiff {
  left: {
    floorId: string;
    snapshotAvailable: boolean;
  };
  right: {
    floorId: string;
    snapshotAvailable: boolean;
  };
  scopeChanges: PromptRuntimeScopeDiff[];
  policyChanges: PromptRuntimePolicyDiff[];
  assetChanges: PromptRuntimeAssetDiff[];
  diagnosticsChanges: PromptRuntimeDiagnosticDiff[];
  trimChanges: PromptRuntimeTrimDiff[];
  exclusionChanges: PromptRuntimeExclusionDiff[];
  limitations: string[];
}

export interface PromptRuntimePolicyView {
  persistentPolicy?: PromptRuntimePersistentPolicy;
  persistentPolicyEnvelope?: PromptRuntimePersistedPolicyEnvelope | null;
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
  budget: {
    defaults: ResolvedPromptBudgetPolicy;
    requestOverrideSupported: true;
    persistentPatchSupported: true;
    supportedFields: readonly ["maxInputTokens", "reservedCompletionTokens"];
    trimReasonCodes: typeof PROMPT_RUNTIME_SUPPORTED_TRIM_REASON_CODES;
  };
  sourceSelection: {
    defaults: ResolvedPromptSourceSelectionPolicy;
    requestOverrideSupported: true;
    persistentPatchSupported: true;
    supportedSources: typeof PROMPT_RUNTIME_SUPPORTED_SOURCE_SELECTION_SOURCES;
    historyModes: typeof PROMPT_RUNTIME_SUPPORTED_SOURCE_SELECTION_HISTORY_MODES;
    exclusionReasonCodes: typeof PROMPT_RUNTIME_SUPPORTED_SOURCE_EXCLUSION_REASON_CODES;
  };
  governance: {
    session: {
      envelopeMetadata: true;
      nullClearsField: true;
      objectPatch: "deep_merge";
      supportedFields: typeof PROMPT_RUNTIME_GOVERNED_POLICY_FIELDS;
    };
    branch: {
      envelopeMetadata: true;
      materializedBranchesOnly: true;
      nullClearsField: true;
      objectPatch: "deep_merge";
      supportedFields: typeof PROMPT_RUNTIME_GOVERNED_POLICY_FIELDS;
    };
  };
  compare: {
    enabled: true;
    committedFloorsOnly: true;
    mixedPreviewSupported: false;
    limitationsInsteadOfRecompute: true;
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
      mode: "macro_text_preview";
      returnsRuntimeTrace: true;
      returnsAssemblyTruth: false;
      supportsVisibility: true;
      singleTextOnly: true;
      llmCall: false;
      createsFloor: false;
      writesPromptSnapshot: false;
      commitsSideEffects: false;
      traceSubset: readonly ("macro" | "source_selection" | "visibility")[];
    };
    explain: {
      enabled: boolean;
      readOnly: true;
      requiresCommittedFloor: true;
      persistedTruthOnly: true;
      recompute: false;
      snapshotSupported: true;
      legacyFloorFallback: true;
      snapshotAvailabilityField: "snapshot_available";
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

export const DEFAULT_RESOLVED_PROMPT_RUNTIME_BUDGET_POLICY: ResolvedPromptBudgetPolicy = {};

export const DEFAULT_RESOLVED_PROMPT_RUNTIME_VISIBILITY_POLICY: ResolvedPromptVisibilityPolicy = {
  mode: "allow_all_except_hidden",
};

export const DEFAULT_RESOLVED_PROMPT_RUNTIME_SOURCE_SELECTION_POLICY: ResolvedPromptSourceSelectionPolicy = {
  history: { mode: "full" },
  memory: { enabled: true },
  worldbook: { enabled: true },
  examples: { enabled: true },
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

  async getResolvedState(sessionId: string, accountId: string, branchId = "main"): Promise<PromptRuntimeResolvedState> {
    const session = await this.getOwnedSession(sessionId, accountId);
    const targetBranchId = normalizePromptRuntimeBranchId(branchId);
    await this.requireMaterializedBranch(session.id, targetBranchId);
    const assets = await this.buildAssetsView(session, accountId);
    const {
      persistentPolicy,
      envelope: persistentPolicyEnvelope,
      warnings,
    } = readPromptRuntimePersistentPolicy(session.metadataJson);
    const {
      persistentPolicy: branchPersistentPolicy,
      envelope: branchPersistentPolicyEnvelope,
      warnings: branchWarnings,
    } = readPromptRuntimeBranchPersistentPolicy(session.metadataJson, targetBranchId);
    const resolvedPolicy = buildResolvedPromptRuntimePolicy(persistentPolicy, branchPersistentPolicy ?? undefined);
    const effectivePersistentPolicy = mergePromptRuntimePersistentPolicies(persistentPolicy, branchPersistentPolicy ?? undefined);
    const controlPlaneWarnings = buildPromptRuntimeWarnings(effectivePersistentPolicy, [...warnings, ...branchWarnings]);

    return {
      scope: {
        sessionId,
        targetBranchId,
        branchExists: true,
        sourceFloorId: null,
        historySourceBranchId: targetBranchId,
        historySourceMode: "existing_branch",
      },
      policy: resolvedPolicy,
      ...(persistentPolicy ? { persistentPolicy } : {}),
      ...(persistentPolicyEnvelope !== undefined ? { persistentPolicyEnvelope } : {}),
      branchPersistentPolicy: branchPersistentPolicy ?? null,
      ...(branchPersistentPolicyEnvelope !== undefined ? { branchPersistentPolicyEnvelope } : {}),
      assets,
      sourceMap: buildPromptRuntimeSourceMap({
        sessionPolicy: persistentPolicy,
        branchPolicy: branchPersistentPolicy ?? undefined,
        resolvedPolicy,
        history: { sourceBranchId: targetBranchId, sourceMode: "existing_branch" },
      }),
      warnings: controlPlaneWarnings,
      diagnostics: buildPromptRuntimeDiagnostics(controlPlaneWarnings, { branchId: targetBranchId }),
      limitations: [...PROMPT_RUNTIME_LIMITATIONS],
    };
  }

  async getPolicy(sessionId: string, accountId: string): Promise<PromptRuntimePolicyView> {
    const session = await this.getOwnedSession(sessionId, accountId);
    const { persistentPolicy, envelope, warnings } = readPromptRuntimePersistentPolicy(session.metadataJson);
    const controlPlaneWarnings = buildPromptRuntimeWarnings(persistentPolicy, warnings);

    return {
      ...(persistentPolicy ? { persistentPolicy } : {}),
      ...(envelope !== undefined ? { persistentPolicyEnvelope: envelope } : {}),
      resolvedPolicy: buildResolvedPromptRuntimePolicy(persistentPolicy),
      warnings: controlPlaneWarnings,
    };
  }

  async getBranchPolicy(sessionId: string, branchId: string, accountId: string): Promise<PromptRuntimePolicyView> {
    const session = await this.getOwnedSession(sessionId, accountId);
    const targetBranchId = normalizePromptRuntimeBranchId(branchId);
    await this.requireMaterializedBranch(session.id, targetBranchId);
    const { persistentPolicy, warnings } = readPromptRuntimePersistentPolicy(session.metadataJson);
    const { persistentPolicy: branchPersistentPolicy, envelope, warnings: branchWarnings } = readPromptRuntimeBranchPersistentPolicy(session.metadataJson, targetBranchId);
    const effectivePersistentPolicy = mergePromptRuntimePersistentPolicies(persistentPolicy, branchPersistentPolicy ?? undefined);
    const controlPlaneWarnings = buildPromptRuntimeWarnings(effectivePersistentPolicy, [...warnings, ...branchWarnings]);

    return {
      ...(branchPersistentPolicy ? { persistentPolicy: branchPersistentPolicy } : {}),
      ...(envelope !== undefined ? { persistentPolicyEnvelope: envelope } : {}),
      resolvedPolicy: buildResolvedPromptRuntimePolicy(persistentPolicy, branchPersistentPolicy ?? undefined),
      warnings: controlPlaneWarnings,
    };
  }

  async getAssets(sessionId: string, accountId: string): Promise<PromptRuntimeAssetsView> {
    const session = await this.getOwnedSession(sessionId, accountId);
    return this.buildAssetsView(session, accountId);
  }

  async getHistoricalExplain(floorId: string, accountId: string): Promise<PromptRuntimeHistoricalExplain> {
    const floor = await this.getOwnedFloor(floorId, accountId);
    if (floor.state !== "committed") {
      throw new PromptRuntimeControlServiceError(409, "invalid_state", `Floor '${floor.id}' is not committed`);
    }

    const [[promptSnapshotRow], [floorResultRow], [snapshotRow]] = await Promise.all([
      this.db.select().from(promptSnapshots).where(eq(promptSnapshots.floorId, floor.id)).limit(1),
      this.db.select().from(floorResultSnapshots).where(eq(floorResultSnapshots.floorId, floor.id)).limit(1),
      this.db.select().from(promptRuntimeExplainSnapshots).where(eq(promptRuntimeExplainSnapshots.floorId, floor.id)).limit(1),
    ]);

    if (!promptSnapshotRow || !floorResultRow) {
      throw new PromptRuntimeControlServiceError(404, "prompt_runtime_explain_not_found", `Prompt Runtime explain not found for floor '${floor.id}'`);
    }

    const fallbackScope: PromptRuntimeScopeRef = {
      sessionId: floor.sessionId,
      targetBranchId: floor.branchId,
      branchExists: true,
      sourceFloorId: null,
      historySourceBranchId: floor.branchId,
      historySourceMode: "existing_branch",
    };

    if (snapshotRow) {
      const snapshot = mapPromptRuntimeExplainSnapshotRow(snapshotRow);
      return {
        floor: {
          id: floor.id,
          sessionId: floor.sessionId,
          floorNo: floor.floorNo,
          branchId: floor.branchId,
          parentFloorId: floor.parentFloorId,
          state: "committed",
          promptSnapshotCreatedAt: promptSnapshotRow.createdAt,
          committedAt: floorResultRow.committedAt,
        },
        scope: {
          sessionId: floor.sessionId,
          targetBranchId: snapshot.targetBranchId ?? floor.branchId,
          branchExists: true,
          sourceFloorId: snapshot.sourceFloorId ?? null,
          historySourceBranchId: snapshot.historySourceBranchId ?? floor.branchId,
          historySourceMode: snapshot.historySourceMode,
        },
        snapshotAvailable: true,
        assets: snapshot.assets,
        promptSnapshot: mapPromptSnapshotRowToPreview(promptSnapshotRow),
        resolvedPolicy: snapshot.resolvedPolicy,
        sourceMap: snapshot.sourceMap,
        trimReasons: snapshot.trimReasons,
        excludedSources: snapshot.excludedSources,
        sectionStats: snapshot.sectionStats,
        diagnostics: snapshot.diagnostics,
        limitations: [...PROMPT_RUNTIME_LIMITATIONS],
        result: mapFloorResultSnapshotRowToHistoricalExplainResult(floorResultRow),
      };
    }

    return {
      floor: {
        id: floor.id,
        sessionId: floor.sessionId,
        floorNo: floor.floorNo,
        branchId: floor.branchId,
        parentFloorId: floor.parentFloorId,
        state: "committed",
        promptSnapshotCreatedAt: promptSnapshotRow.createdAt,
        committedAt: floorResultRow.committedAt,
      },
      scope: fallbackScope,
      snapshotAvailable: false,
      assets: null,
      promptSnapshot: mapPromptSnapshotRowToPreview(promptSnapshotRow),
      resolvedPolicy: null,
      sourceMap: {
        history: {
          sourceBranchId: fallbackScope.historySourceBranchId,
          sourceMode: fallbackScope.historySourceMode,
        },
      },
      trimReasons: null,
      excludedSources: null,
      sectionStats: null,
      diagnostics: buildPromptRuntimeHistoricalExplainDiagnostics(),
      limitations: [...PROMPT_RUNTIME_LIMITATIONS, ...PROMPT_RUNTIME_HISTORICAL_EXPLAIN_LIMITATIONS],
      result: mapFloorResultSnapshotRowToHistoricalExplainResult(floorResultRow),
    };
  }

  async compareCommittedExplain(
    sessionId: string,
    leftFloorId: string,
    rightFloorId: string,
    accountId: string,
  ): Promise<PromptRuntimeExplainDiff> {
    await this.getOwnedSession(sessionId, accountId);

    const [leftFloor, rightFloor] = await Promise.all([
      this.getOwnedFloor(leftFloorId, accountId),
      this.getOwnedFloor(rightFloorId, accountId),
    ]);

    if (leftFloor.sessionId !== sessionId || rightFloor.sessionId !== sessionId) {
      throw new PromptRuntimeControlServiceError(404, "not_found", "Floor not found");
    }
    if (leftFloor.state !== "committed" || rightFloor.state !== "committed") {
      throw new PromptRuntimeControlServiceError(409, "invalid_state", "Prompt Runtime compare requires committed floors");
    }

    const snapshotRows = await this.db
      .select()
      .from(promptRuntimeExplainSnapshots)
      .where(or(
        eq(promptRuntimeExplainSnapshots.floorId, leftFloorId),
        eq(promptRuntimeExplainSnapshots.floorId, rightFloorId),
      ));

    const leftSnapshotRow = snapshotRows.find((row) => row.floorId === leftFloorId);
    const rightSnapshotRow = snapshotRows.find((row) => row.floorId === rightFloorId);

    return buildPromptRuntimeExplainDiff({
      leftFloorId,
      rightFloorId,
      leftSnapshot: leftSnapshotRow ? mapPromptRuntimeExplainSnapshotRow(leftSnapshotRow) : null,
      rightSnapshot: rightSnapshotRow ? mapPromptRuntimeExplainSnapshotRow(rightSnapshotRow) : null,
    });
  }

  async updatePolicy(
    sessionId: string,
    accountId: string,
    patch: PromptRuntimePersistentPolicyPatch,
    updatedBy?: string | null,
  ): Promise<PromptRuntimePolicyView> {
    const session = await this.getOwnedSession(sessionId, accountId);
    const metadata = parseMetadataRecord(session.metadataJson);
    const { persistentPolicy, envelope } = readPromptRuntimePersistentPolicy(session.metadataJson);
    const nextPersistentPolicy = applyPromptRuntimePersistentPolicyPatch(persistentPolicy, patch);
    const updatedAt = Date.now();
    const nextMetadata = writePromptRuntimePersistentPolicyToMetadata(metadata, nextPersistentPolicy, {
      currentEnvelope: envelope,
      updatedAt,
      updatedBy,
    });

    await this.db
      .update(sessions)
      .set({
        metadataJson: stringifyJsonField(nextMetadata),
        updatedAt,
      })
      .where(and(eq(sessions.id, sessionId), eq(sessions.accountId, accountId)));

    const nextEnvelope = nextPersistentPolicy
      ? createPromptRuntimePersistedPolicyEnvelope({
          currentEnvelope: envelope,
          policy: nextPersistentPolicy,
          updatedAt,
          updatedBy,
        })
      : undefined;

    return {
      ...(nextPersistentPolicy ? { persistentPolicy: nextPersistentPolicy } : {}),
      ...(nextEnvelope !== undefined ? { persistentPolicyEnvelope: nextEnvelope } : {}),
      resolvedPolicy: buildResolvedPromptRuntimePolicy(nextPersistentPolicy),
      warnings: buildPromptRuntimeWarnings(nextPersistentPolicy),
    };
  }

  async updateBranchPolicy(
    sessionId: string,
    branchId: string,
    accountId: string,
    patch: PromptRuntimePersistentPolicyPatch,
    updatedBy?: string | null,
  ): Promise<PromptRuntimePolicyView> {
    const session = await this.getOwnedSession(sessionId, accountId);
    const targetBranchId = normalizePromptRuntimeBranchId(branchId);
    await this.requireMaterializedBranch(session.id, targetBranchId);
    const metadata = parseMetadataRecord(session.metadataJson);
    const { persistentPolicy } = readPromptRuntimePersistentPolicy(session.metadataJson);
    const { persistentPolicy: currentBranchPolicy, envelope } = readPromptRuntimeBranchPersistentPolicy(session.metadataJson, targetBranchId);
    const nextBranchPersistentPolicy = applyPromptRuntimePersistentPolicyPatch(currentBranchPolicy, patch);
    const updatedAt = Date.now();
    const nextMetadata = writePromptRuntimeBranchPersistentPolicyToMetadata(metadata, targetBranchId, nextBranchPersistentPolicy, {
      currentEnvelope: envelope,
      updatedAt,
      updatedBy,
    });

    await this.db
      .update(sessions)
      .set({
        metadataJson: stringifyJsonField(nextMetadata),
        updatedAt,
      })
      .where(and(eq(sessions.id, sessionId), eq(sessions.accountId, accountId)));

    const effectivePersistentPolicy = mergePromptRuntimePersistentPolicies(persistentPolicy, nextBranchPersistentPolicy);
    const nextEnvelope = nextBranchPersistentPolicy
      ? createPromptRuntimePersistedPolicyEnvelope({
          currentEnvelope: envelope,
          policy: nextBranchPersistentPolicy,
          updatedAt,
          updatedBy,
        })
      : undefined;

    return {
      ...(nextBranchPersistentPolicy ? { persistentPolicy: nextBranchPersistentPolicy } : {}),
      ...(nextEnvelope !== undefined ? { persistentPolicyEnvelope: nextEnvelope } : {}),
      resolvedPolicy: buildResolvedPromptRuntimePolicy(persistentPolicy, nextBranchPersistentPolicy),
      warnings: buildPromptRuntimeWarnings(effectivePersistentPolicy),
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
      budget: {
        defaults: { ...DEFAULT_RESOLVED_PROMPT_RUNTIME_BUDGET_POLICY },
        requestOverrideSupported: true,
        persistentPatchSupported: true,
        supportedFields: ["maxInputTokens", "reservedCompletionTokens"],
        trimReasonCodes: PROMPT_RUNTIME_SUPPORTED_TRIM_REASON_CODES,
      },
      sourceSelection: {
        defaults: JSON.parse(JSON.stringify(DEFAULT_RESOLVED_PROMPT_RUNTIME_SOURCE_SELECTION_POLICY)) as ResolvedPromptSourceSelectionPolicy,
        requestOverrideSupported: true,
        persistentPatchSupported: true,
        supportedSources: PROMPT_RUNTIME_SUPPORTED_SOURCE_SELECTION_SOURCES,
        historyModes: PROMPT_RUNTIME_SUPPORTED_SOURCE_SELECTION_HISTORY_MODES,
        exclusionReasonCodes: PROMPT_RUNTIME_SUPPORTED_SOURCE_EXCLUSION_REASON_CODES,
      },
      governance: {
        session: {
          envelopeMetadata: true,
          nullClearsField: true,
          objectPatch: "deep_merge",
          supportedFields: PROMPT_RUNTIME_GOVERNED_POLICY_FIELDS,
        },
        branch: {
          envelopeMetadata: true,
          materializedBranchesOnly: true,
          nullClearsField: true,
          objectPatch: "deep_merge",
          supportedFields: PROMPT_RUNTIME_GOVERNED_POLICY_FIELDS,
        },
      },
      compare: {
        enabled: true,
        committedFloorsOnly: true,
        mixedPreviewSupported: false,
        limitationsInsteadOfRecompute: true,
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
          mode: "macro_text_preview",
          returnsRuntimeTrace: true,
          returnsAssemblyTruth: false,
          supportsVisibility: true,
          singleTextOnly: true,
          llmCall: false,
          createsFloor: false,
          writesPromptSnapshot: false,
          commitsSideEffects: false,
          traceSubset: ["macro", "source_selection", "visibility"],
        },
        explain: {
          enabled: true,
          readOnly: true,
          requiresCommittedFloor: true,
          persistedTruthOnly: true,
          recompute: false,
          snapshotSupported: true,
          legacyFloorFallback: true,
          snapshotAvailabilityField: "snapshot_available",
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

  private async getOwnedFloor(floorId: string, accountId: string) {
    const [row] = await this.db
      .select({ floor: floors })
      .from(floors)
      .innerJoin(sessions, eq(floors.sessionId, sessions.id))
      .where(and(eq(floors.id, floorId), eq(sessions.accountId, accountId)))
      .limit(1);

    if (!row?.floor) {
      throw new PromptRuntimeControlServiceError(404, "not_found", "Floor not found");
    }

    return row.floor;
  }

  private async requireMaterializedBranch(sessionId: string, branchId: string): Promise<void> {
    const [branch] = await this.db
      .select({ id: floors.id })
      .from(floors)
      .where(and(
        eq(floors.sessionId, sessionId),
        eq(floors.branchId, branchId),
        isNull(floors.supersededAt),
      ))
      .limit(1);

    if (!branch) {
      throw new PromptRuntimeControlServiceError(404, "branch_not_found", `Branch '${branchId}' not found in session`);
    }
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
  ...layers: Array<PromptRuntimePersistentPolicy | undefined>
): ResolvedPromptRuntimePolicy {
  const effectivePersistentPolicy = mergePromptRuntimePersistentPolicies(...layers);
  const delivery = resolvePromptRuntimeDeliveryPolicy(effectivePersistentPolicy?.delivery);

  return {
    structure: resolvePromptRuntimeStructurePolicy(effectivePersistentPolicy?.structure, delivery),
    delivery,
    debug: { ...DEFAULT_RESOLVED_PROMPT_RUNTIME_DEBUG_POLICY },
    budget: resolvePromptRuntimeBudgetPolicy(effectivePersistentPolicy?.budget),
    visibility: resolvePromptRuntimeVisibilityPolicy(effectivePersistentPolicy?.visibility),
    sourceSelection: resolvePromptRuntimeSourceSelectionPolicy(effectivePersistentPolicy?.sourceSelection),
  };
}

export function mergePromptRuntimePersistentPolicies(
  ...layers: Array<PromptRuntimePersistentPolicy | undefined>
): PromptRuntimePersistentPolicy | undefined {
  let structure: PromptStructurePolicy | undefined;
  let delivery: PromptDeliveryPolicy | undefined;
  let budget: PromptBudgetPolicy | undefined;
  let sourceSelection: PromptSourceSelectionPolicy | undefined;
  let visibility: PromptVisibilityPolicy | undefined;

  for (const layer of layers) {
    structure = mergePromptStructurePolicy(structure, layer?.structure);
    delivery = mergePromptDeliveryPolicy(delivery, layer?.delivery);
    budget = mergePromptBudgetPolicy(budget, layer?.budget);
    sourceSelection = mergePromptSourceSelectionPolicy(sourceSelection, layer?.sourceSelection);
    visibility = mergePromptVisibilityPolicy(visibility, layer?.visibility);
  }

  const merged: PromptRuntimePersistentPolicy = {};

  if (structure) {
    merged.structure = structure;
  }
  if (delivery) {
    merged.delivery = delivery;
  }
  if (budget) {
    merged.budget = budget;
  }
  if (sourceSelection) {
    merged.sourceSelection = sourceSelection;
  }
  if (visibility) {
    merged.visibility = visibility;
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
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

export function resolvePromptRuntimeBudgetPolicy(
  budgetPolicy?: PromptBudgetPolicy,
): ResolvedPromptBudgetPolicy {
  return {
    ...(budgetPolicy?.maxInputTokens !== undefined ? { maxInputTokens: budgetPolicy.maxInputTokens } : {}),
    ...(budgetPolicy?.reservedCompletionTokens !== undefined ? { reservedCompletionTokens: budgetPolicy.reservedCompletionTokens } : {}),
  };
}

export function resolvePromptRuntimeVisibilityPolicy(
  visibilityPolicy?: PromptVisibilityPolicy,
): ResolvedPromptVisibilityPolicy {
  const normalizedVisibilityPolicy = normalizePromptVisibilityPolicy(visibilityPolicy);

  return {
    ...(normalizedVisibilityPolicy?.hiddenFloorRanges ? { hiddenFloorRanges: normalizedVisibilityPolicy.hiddenFloorRanges } : {}),
    ...(normalizedVisibilityPolicy?.visibleFloorRanges ? { visibleFloorRanges: normalizedVisibilityPolicy.visibleFloorRanges } : {}),
    ...(normalizedVisibilityPolicy?.hiddenFloorIds ? { hiddenFloorIds: normalizedVisibilityPolicy.hiddenFloorIds } : {}),
    mode: normalizedVisibilityPolicy?.mode ?? DEFAULT_RESOLVED_PROMPT_RUNTIME_VISIBILITY_POLICY.mode,
  };
}

export function resolvePromptRuntimeSourceSelectionPolicy(
  sourceSelectionPolicy?: PromptSourceSelectionPolicy,
): ResolvedPromptSourceSelectionPolicy {
  return {
    history: {
      mode: sourceSelectionPolicy?.history?.mode ?? DEFAULT_RESOLVED_PROMPT_RUNTIME_SOURCE_SELECTION_POLICY.history.mode,
      ...(sourceSelectionPolicy?.history?.maxMessages !== undefined ? { maxMessages: sourceSelectionPolicy.history.maxMessages } : {}),
    },
    memory: {
      enabled: sourceSelectionPolicy?.memory?.enabled ?? DEFAULT_RESOLVED_PROMPT_RUNTIME_SOURCE_SELECTION_POLICY.memory.enabled,
    },
    worldbook: {
      enabled: sourceSelectionPolicy?.worldbook?.enabled ?? DEFAULT_RESOLVED_PROMPT_RUNTIME_SOURCE_SELECTION_POLICY.worldbook.enabled,
    },
    examples: {
      enabled: sourceSelectionPolicy?.examples?.enabled ?? DEFAULT_RESOLVED_PROMPT_RUNTIME_SOURCE_SELECTION_POLICY.examples.enabled,
    },
  };
}

export function mergePromptBudgetPolicy(
  base: PromptBudgetPolicy | undefined,
  override: PromptBudgetPolicy | undefined,
): PromptBudgetPolicy | undefined {
  if (!base && !override) {
    return undefined;
  }

  const merged: PromptBudgetPolicy = {
    ...(base ?? {}),
    ...(override ?? {}),
  };

  return Object.keys(merged).length > 0 ? merged : undefined;
}

export function mergePromptVisibilityPolicy(
  base: PromptVisibilityPolicy | undefined,
  override: PromptVisibilityPolicy | undefined,
): PromptVisibilityPolicy | undefined {
  if (!base && !override) {
    return undefined;
  }

  return normalizePromptVisibilityPolicy({
    ...(base ?? {}),
    ...(override ?? {}),
  });
}

function mergePromptSourceSelectionHistoryPolicy(
  base: PromptSourceSelectionPolicy["history"],
  override: PromptSourceSelectionPolicy["history"],
): PromptSourceSelectionPolicy["history"] {
  if (!base && !override) {
    return undefined;
  }

  const merged = {
    ...(base ?? {}),
    ...(override ?? {}),
  };

  return Object.keys(merged).length > 0 ? merged : undefined;
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

function mergePromptSourceSelectionTogglePolicy(
  base: { enabled?: boolean } | undefined,
  override: { enabled?: boolean } | undefined,
): { enabled?: boolean } | undefined {
  if (!base && !override) {
    return undefined;
  }

  const merged = {
    ...(base ?? {}),
    ...(override ?? {}),
  };

  return Object.keys(merged).length > 0 ? merged : undefined;
}

function normalizePromptVisibilityPolicy(
  visibility: PromptVisibilityPolicy | undefined,
): PromptVisibilityPolicy | undefined {
  if (!visibility) {
    return undefined;
  }

  const normalized: PromptVisibilityPolicy = {
    ...(visibility.hiddenFloorRanges && visibility.hiddenFloorRanges.length > 0
      ? {
          hiddenFloorRanges: visibility.hiddenFloorRanges.map((range) => ({
            startFloorNo: range.startFloorNo,
            endFloorNo: range.endFloorNo,
          })),
        }
      : {}),
    ...(visibility.visibleFloorRanges && visibility.visibleFloorRanges.length > 0
      ? {
          visibleFloorRanges: visibility.visibleFloorRanges.map((range) => ({
            startFloorNo: range.startFloorNo,
            endFloorNo: range.endFloorNo,
          })),
        }
      : {}),
    ...(visibility.hiddenFloorIds && visibility.hiddenFloorIds.length > 0
      ? { hiddenFloorIds: [...visibility.hiddenFloorIds] }
      : {}),
    ...(visibility.mode !== undefined ? { mode: visibility.mode } : {}),
  };

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function serializePromptVisibilityPolicy(
  visibility: PromptVisibilityPolicy,
): Record<string, unknown> {
  return {
    ...(visibility.hiddenFloorRanges && visibility.hiddenFloorRanges.length > 0
      ? {
          hiddenFloorRanges: visibility.hiddenFloorRanges.map((range) => ({
            startFloorNo: range.startFloorNo,
            endFloorNo: range.endFloorNo,
          })),
        }
      : {}),
    ...(visibility.visibleFloorRanges && visibility.visibleFloorRanges.length > 0
      ? {
          visibleFloorRanges: visibility.visibleFloorRanges.map((range) => ({
            startFloorNo: range.startFloorNo,
            endFloorNo: range.endFloorNo,
          })),
        }
      : {}),
    ...(visibility.hiddenFloorIds && visibility.hiddenFloorIds.length > 0
      ? { hiddenFloorIds: [...visibility.hiddenFloorIds] }
      : {}),
    ...(visibility.mode !== undefined ? { mode: visibility.mode } : {}),
  };
}

export function mergePromptSourceSelectionPolicy(
  base: PromptSourceSelectionPolicy | undefined,
  override: PromptSourceSelectionPolicy | undefined,
): PromptSourceSelectionPolicy | undefined {
  const history = mergePromptSourceSelectionHistoryPolicy(base?.history, override?.history);
  const memory = mergePromptSourceSelectionTogglePolicy(base?.memory, override?.memory);
  const worldbook = mergePromptSourceSelectionTogglePolicy(base?.worldbook, override?.worldbook);
  const examples = mergePromptSourceSelectionTogglePolicy(base?.examples, override?.examples);

  const merged: PromptSourceSelectionPolicy = {
    ...(history ? { history } : {}),
    ...(memory ? { memory } : {}),
    ...(worldbook ? { worldbook } : {}),
    ...(examples ? { examples } : {}),
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
  const nextBudget = patch.budget === undefined
    ? current?.budget
    : patch.budget === null
      ? undefined
      : mergePromptBudgetPolicy(current?.budget, patch.budget);
  const nextSourceSelection = patch.sourceSelection === undefined
    ? current?.sourceSelection
    : patch.sourceSelection === null
      ? undefined
      : mergePromptSourceSelectionPolicy(current?.sourceSelection, patch.sourceSelection);
  const nextVisibility = patch.visibility === undefined
    ? current?.visibility
    : patch.visibility === null
      ? undefined
      : mergePromptVisibilityPolicy(current?.visibility, patch.visibility);

  if (nextStructure) {
    next.structure = nextStructure;
  }
  if (nextDelivery) {
    next.delivery = nextDelivery;
  }
  if (nextBudget) {
    next.budget = nextBudget;
  }
  if (nextSourceSelection) {
    next.sourceSelection = nextSourceSelection;
  }
  if (nextVisibility) {
    next.visibility = nextVisibility;
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

export function resolvePromptRuntimeStructurePolicy(
  structurePolicy: PromptStructurePolicy | undefined,
  deliveryPolicy?: PromptDeliveryPolicy | ResolvedPromptDeliveryPolicy,
): ResolvedPromptStructurePolicy {
  let effectiveStructurePolicy = structurePolicy;

  if (deliveryPolicy?.noAssistant === true && structurePolicy?.mode !== "no_assistant" && structurePolicy?.mode !== "flattened") {
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

export function buildPromptRuntimeSourceMap(args: {
  sessionPolicy?: PromptRuntimePersistentPolicy;
  branchPolicy?: PromptRuntimePersistentPolicy;
  requestPolicy?: PromptRuntimePersistentPolicy;
  resolvedPolicy?: ResolvedPromptRuntimePolicy;
  history?: {
    sourceBranchId?: string;
    sourceMode?: PromptRuntimeHistorySourceMode;
  };
}): PromptRuntimeSourceMap | undefined {
  const effectivePolicy = mergePromptRuntimePersistentPolicies(
    args.sessionPolicy,
    args.branchPolicy,
    args.requestPolicy,
  );
  const resolvedPolicy = args.resolvedPolicy
    ?? buildResolvedPromptRuntimePolicy(args.sessionPolicy, args.branchPolicy, args.requestPolicy);
  const structureModeSource = selectPromptRuntimePolicySource({
    session: args.sessionPolicy?.structure?.mode,
    branch: args.branchPolicy?.structure?.mode,
    request: args.requestPolicy?.structure?.mode,
  });
  const structureMergeAdjacentSource = selectPromptRuntimePolicySource({
    session: args.sessionPolicy?.structure?.mergeAdjacentSameRole,
    branch: args.branchPolicy?.structure?.mergeAdjacentSameRole,
    request: args.requestPolicy?.structure?.mergeAdjacentSameRole,
  });
  const structurePreserveSystemSource = selectPromptRuntimePolicySource({
    session: args.sessionPolicy?.structure?.preserveSystemMessages,
    branch: args.branchPolicy?.structure?.preserveSystemMessages,
    request: args.requestPolicy?.structure?.preserveSystemMessages,
  });
  const structureAssistantRewriteSource = selectPromptRuntimePolicySource({
    session: args.sessionPolicy?.structure?.assistantRewriteStrategy,
    branch: args.branchPolicy?.structure?.assistantRewriteStrategy,
    request: args.requestPolicy?.structure?.assistantRewriteStrategy,
  });
  const budgetMaxInputTokensSource = selectPromptRuntimePolicySource({
    session: args.sessionPolicy?.budget?.maxInputTokens,
    branch: args.branchPolicy?.budget?.maxInputTokens,
    request: args.requestPolicy?.budget?.maxInputTokens,
  });
  const budgetReservedCompletionTokensSource = selectPromptRuntimePolicySource({
    session: args.sessionPolicy?.budget?.reservedCompletionTokens,
    branch: args.branchPolicy?.budget?.reservedCompletionTokens,
    request: args.requestPolicy?.budget?.reservedCompletionTokens,
  });
  const deliveryAllowAssistantPrefillSource = selectPromptRuntimePolicySource({
    session: args.sessionPolicy?.delivery?.allowAssistantPrefill,
    branch: args.branchPolicy?.delivery?.allowAssistantPrefill,
    request: args.requestPolicy?.delivery?.allowAssistantPrefill,
  });
  const deliveryRequireLastUserSource = selectPromptRuntimePolicySource({
    session: args.sessionPolicy?.delivery?.requireLastUser,
    branch: args.branchPolicy?.delivery?.requireLastUser,
    request: args.requestPolicy?.delivery?.requireLastUser,
  });
  const deliveryNoAssistantSource = selectPromptRuntimePolicySource({
    session: args.sessionPolicy?.delivery?.noAssistant,
    branch: args.branchPolicy?.delivery?.noAssistant,
    request: args.requestPolicy?.delivery?.noAssistant,
  });
  const sourceSelectionHistoryModeSource = selectPromptRuntimePolicySource({
    session: args.sessionPolicy?.sourceSelection?.history?.mode,
    branch: args.branchPolicy?.sourceSelection?.history?.mode,
    request: args.requestPolicy?.sourceSelection?.history?.mode,
  });
  const sourceSelectionHistoryMaxMessagesSource = selectPromptRuntimePolicySource({
    session: args.sessionPolicy?.sourceSelection?.history?.maxMessages,
    branch: args.branchPolicy?.sourceSelection?.history?.maxMessages,
    request: args.requestPolicy?.sourceSelection?.history?.maxMessages,
  });
  const sourceSelectionMemoryEnabledSource = selectPromptRuntimePolicySource({
    session: args.sessionPolicy?.sourceSelection?.memory?.enabled,
    branch: args.branchPolicy?.sourceSelection?.memory?.enabled,
    request: args.requestPolicy?.sourceSelection?.memory?.enabled,
  });
  const sourceSelectionWorldbookEnabledSource = selectPromptRuntimePolicySource({
    session: args.sessionPolicy?.sourceSelection?.worldbook?.enabled,
    branch: args.branchPolicy?.sourceSelection?.worldbook?.enabled,
    request: args.requestPolicy?.sourceSelection?.worldbook?.enabled,
  });
  const sourceSelectionExamplesEnabledSource = selectPromptRuntimePolicySource({
    session: args.sessionPolicy?.sourceSelection?.examples?.enabled,
    branch: args.branchPolicy?.sourceSelection?.examples?.enabled,
    request: args.requestPolicy?.sourceSelection?.examples?.enabled,
  });
  const visibilityHiddenFloorRangesSource = selectPromptRuntimePolicySource({
    session: args.sessionPolicy?.visibility?.hiddenFloorRanges,
    branch: args.branchPolicy?.visibility?.hiddenFloorRanges,
    request: args.requestPolicy?.visibility?.hiddenFloorRanges,
  });
  const visibilityVisibleFloorRangesSource = selectPromptRuntimePolicySource({
    session: args.sessionPolicy?.visibility?.visibleFloorRanges,
    branch: args.branchPolicy?.visibility?.visibleFloorRanges,
    request: args.requestPolicy?.visibility?.visibleFloorRanges,
  });
  const visibilityHiddenFloorIdsSource = selectPromptRuntimePolicySource({
    session: args.sessionPolicy?.visibility?.hiddenFloorIds,
    branch: args.branchPolicy?.visibility?.hiddenFloorIds,
    request: args.requestPolicy?.visibility?.hiddenFloorIds,
  });
  const visibilityModeSource = selectPromptRuntimePolicySource({
    session: args.sessionPolicy?.visibility?.mode,
    branch: args.branchPolicy?.visibility?.mode,
    request: args.requestPolicy?.visibility?.mode,
  });
  const structureModeDerivedFromDelivery = resolvedPolicy.delivery.noAssistant === true
    && effectivePolicy?.structure?.mode !== "no_assistant"
    && effectivePolicy?.structure?.mode !== "flattened";
  const effectiveStructureModeSource = structureModeDerivedFromDelivery
    ? deliveryNoAssistantSource ?? structureModeSource ?? "system_default"
    : structureModeSource ?? "system_default";
  const effectiveStructureMergeAdjacentSource = structureMergeAdjacentSource
    ?? (structureModeDerivedFromDelivery
      ? deliveryNoAssistantSource ?? structureModeSource ?? "system_default"
      : effectivePolicy?.structure?.mode === "strict_alternating"
        ? structureModeSource ?? "system_default"
        : "system_default");
  const assistantRewriteStrategySource = resolvedPolicy.structure.assistantRewriteStrategy
    ? structureAssistantRewriteSource ?? "system_default"
    : undefined;

  const sourceMap: PromptRuntimeSourceMap = {
    structure: {
      mode: effectiveStructureModeSource,
      mergeAdjacentSameRole: effectiveStructureMergeAdjacentSource,
      preserveSystemMessages: structurePreserveSystemSource ?? "system_default",
      ...(assistantRewriteStrategySource
        ? { assistantRewriteStrategy: assistantRewriteStrategySource }
        : {}),
    },
    ...(resolvedPolicy.budget.maxInputTokens !== undefined || resolvedPolicy.budget.reservedCompletionTokens !== undefined
      ? {
          budget: {
            ...(resolvedPolicy.budget.maxInputTokens !== undefined ? { maxInputTokens: budgetMaxInputTokensSource ?? "system_default" } : {}),
            ...(resolvedPolicy.budget.reservedCompletionTokens !== undefined ? { reservedCompletionTokens: budgetReservedCompletionTokensSource ?? "system_default" } : {}),
          },
        }
      : {}),
    sourceSelection: {
      history: {
        mode: sourceSelectionHistoryModeSource ?? "system_default",
        ...(resolvedPolicy.sourceSelection.history.maxMessages !== undefined ? { maxMessages: sourceSelectionHistoryMaxMessagesSource ?? "system_default" } : {}),
      },
      memory: { enabled: sourceSelectionMemoryEnabledSource ?? "system_default" },
      worldbook: { enabled: sourceSelectionWorldbookEnabledSource ?? "system_default" },
      examples: { enabled: sourceSelectionExamplesEnabledSource ?? "system_default" },
    },
    delivery: {
      allowAssistantPrefill: deliveryAllowAssistantPrefillSource ?? "system_default",
      requireLastUser: deliveryRequireLastUserSource ?? "system_default",
      noAssistant: deliveryNoAssistantSource ?? "system_default",
    },
    visibility: {
      mode: visibilityModeSource ?? "system_default",
      ...(resolvedPolicy.visibility.hiddenFloorRanges ? { hiddenFloorRanges: visibilityHiddenFloorRangesSource ?? "system_default" } : {}),
      ...(resolvedPolicy.visibility.visibleFloorRanges ? { visibleFloorRanges: visibilityVisibleFloorRangesSource ?? "system_default" } : {}),
      ...(resolvedPolicy.visibility.hiddenFloorIds ? { hiddenFloorIds: visibilityHiddenFloorIdsSource ?? "system_default" } : {}),
    },
    ...(args.history && (args.history.sourceBranchId || args.history.sourceMode)
      ? {
          history: {
            ...(args.history.sourceBranchId ? { sourceBranchId: args.history.sourceBranchId } : {}),
            ...(args.history.sourceMode ? { sourceMode: args.history.sourceMode } : {}),
          },
        }
      : {}),
  };

  return prunePromptRuntimeSourceMap(sourceMap);
}

export function buildPromptRuntimeWarnings(
  effectivePolicy?: PromptRuntimePersistentPolicy,
  metadataWarnings: string[] = [],
): string[] {
  const warnings = [...metadataWarnings];

  if (
    effectivePolicy?.delivery?.noAssistant === true
    && effectivePolicy?.structure?.mode !== "no_assistant"
    && effectivePolicy?.structure?.mode !== "flattened"
  ) {
    warnings.push(DERIVED_NO_ASSISTANT_STRUCTURE_WARNING);
  }

  return warnings;
}

export function buildPromptRuntimeDiagnostics(
  warnings: string[],
  options: { branchId?: string; phase?: PromptRuntimeDiagnosticPhase } = {},
): PromptRuntimeDiagnostic[] {
  return warnings.map((warning) => {
    switch (warning) {
      case INVALID_PROMPT_RUNTIME_POLICY_WARNING:
        return {
          code: "invalid_prompt_runtime_policy",
          message: warning,
          severity: "warning",
          source: "policy",
          fieldPath: "prompt_runtime.policy",
          ...(options.phase ? { phase: options.phase } : {}),
        } satisfies PromptRuntimeDiagnostic;
      case INVALID_PROMPT_RUNTIME_BRANCH_POLICY_WARNING:
        return {
          code: "invalid_prompt_runtime_branch_policy",
          message: warning,
          severity: "warning",
          source: "policy",
          fieldPath: options.branchId ? `prompt_runtime.branchPolicies.${options.branchId}` : "prompt_runtime.branchPolicies",
          ...(options.phase ? { phase: options.phase } : {}),
        } satisfies PromptRuntimeDiagnostic;
      case DERIVED_NO_ASSISTANT_STRUCTURE_WARNING:
        return {
          code: "derived_no_assistant_structure",
          message: warning,
          severity: "warning",
          source: "policy",
          fieldPath: "policy.structure.mode",
          ...(options.phase ? { phase: options.phase } : {}),
        } satisfies PromptRuntimeDiagnostic;
      default:
        return { code: "prompt_runtime_warning", message: warning, severity: "warning", ...(options.phase ? { phase: options.phase } : {}) };
    }
  });
}

export function buildPromptRuntimeHistoricalExplainDiagnostics(): PromptRuntimeDiagnostic[] {
  return [
    {
      code: "historical_snapshot_unavailable",
      message: "Committed prompt runtime explain snapshot is unavailable for this floor. Historical explain falls back to minimal persisted truth only.",
      severity: "info",
      source: "policy",
      fieldPath: "snapshot_available",
      phase: "explain",
    },
    {
      code: "historical_resolved_policy_unavailable",
      message: "This floor has no committed prompt runtime explain snapshot, so historical explain returns resolved_policy as null instead of recomputing it.",
      severity: "info",
      source: "policy",
      fieldPath: "resolved_policy",
      phase: "explain",
    },
    {
      code: "historical_source_map_partial",
      message: "This floor has no committed prompt runtime explain snapshot, so historical explain can only return source_map.history from committed floor truth.",
      severity: "info",
      source: "policy",
      fieldPath: "source_map",
      phase: "explain",
    },
    {
      code: "historical_trim_reasons_unavailable",
      message: "This floor has no committed prompt runtime explain snapshot, so explain returns trim_reasons as null instead of recomputing budget decisions.",
      severity: "info",
      source: "budget",
      fieldPath: "trim_reasons",
      phase: "explain",
    },
    {
      code: "historical_excluded_sources_unavailable",
      message: "This floor has no committed prompt runtime explain snapshot, so explain returns excluded_sources as null instead of recomputing source selection.",
      severity: "info",
      source: "source_selection",
      fieldPath: "excluded_sources",
      phase: "explain",
    },
  ];
}

function parseStringArrayJson(value: string | null | undefined): string[] {
  const parsed = parseJsonField(value ?? null);
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
}

function parseNumberArrayJson(value: string | null | undefined): number[] {
  const parsed = parseJsonField(value ?? null);
  return Array.isArray(parsed)
    ? parsed.filter((item): item is number => typeof item === "number" && Number.isFinite(item))
    : [];
}

function mapPromptSnapshotRowToPreview(row: typeof promptSnapshots.$inferSelect): PromptSnapshotPreview {
  return {
    presetId: row.presetId,
    presetUpdatedAt: row.presetUpdatedAt,
    presetVersion: row.presetVersion,
    worldbookId: row.worldbookId,
    worldbookUpdatedAt: row.worldbookUpdatedAt,
    worldbookVersion: row.worldbookVersion,
    regexProfileId: row.regexProfileId,
    regexProfileUpdatedAt: row.regexProfileUpdatedAt,
    regexProfileVersion: row.regexProfileVersion,
    worldbookActivatedEntryUids: parseNumberArrayJson(row.worldbookActivatedEntryUidsJson),
    regexPreRuleNames: parseStringArrayJson(row.regexPreRuleNamesJson),
    regexPostRuleNames: parseStringArrayJson(row.regexPostRuleNamesJson),
    promptMode: row.promptMode,
    promptDigest: row.promptDigest,
    tokenEstimate: row.tokenEstimate,
  };
}

function mapFloorResultSnapshotRowToHistoricalExplainResult(
  row: typeof floorResultSnapshots.$inferSelect,
): PromptRuntimeHistoricalExplainCommittedResult {
  const usage = parseJsonField(row.usageJson);
  const verifier = parseJsonField(row.verifierJson);
  const usageRecord = usage && typeof usage === "object" && !Array.isArray(usage)
    ? usage as Record<string, unknown>
    : null;
  const verifierRecord = verifier && typeof verifier === "object" && !Array.isArray(verifier)
    ? verifier as Record<string, unknown>
    : null;
  return {
    outputPageId: row.outputPageId,
    assistantMessageId: row.assistantMessageId,
    generatedText: row.generatedText,
    summaries: parseStringArrayJson(row.summariesJson),
    usage: {
      promptTokens: typeof usageRecord?.promptTokens === "number" ? usageRecord.promptTokens : 0,
      completionTokens: typeof usageRecord?.completionTokens === "number" ? usageRecord.completionTokens : 0,
      totalTokens: typeof usageRecord?.totalTokens === "number" ? usageRecord.totalTokens : 0,
    },
    verifier: verifierRecord
      ? {
          status: typeof verifierRecord.status === "string" ? verifierRecord.status : "unknown",
          ...(verifierRecord.suggestion === null || typeof verifierRecord.suggestion === "string" ? { suggestion: verifierRecord.suggestion ?? null } : {}),
          ...(Array.isArray(verifierRecord.issues)
            ? {
                issues: verifierRecord.issues
                  .filter((item): item is { description: string; severity: "warning" | "error" } => (
                    !!item
                    && typeof item === "object"
                    && "description" in item
                    && "severity" in item
                    && typeof item.description === "string"
                    && (item.severity === "warning" || item.severity === "error")
                  )),
              }
            : {}),
        }
      : null,
    committedAt: row.committedAt,
  };
}

function parseJsonObjectField<TValue extends object>(
  value: string | null | undefined,
  fallback: TValue,
): TValue {
  const parsed = parseJsonField(value ?? null);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as TValue
    : fallback;
}

function parseJsonArrayField<TValue>(
  value: string | null | undefined,
  fallback: TValue[] = [],
): TValue[] {
  const parsed = parseJsonField(value ?? null);
  return Array.isArray(parsed) ? parsed as TValue[] : fallback;
}

function mapPromptRuntimeExplainSnapshotRow(
  row: typeof promptRuntimeExplainSnapshots.$inferSelect,
): PromptRuntimeCommittedExplainSnapshot {
  return {
    floorId: row.floorId,
    sessionId: row.sessionId,
    targetBranchId: row.targetBranchId,
    sourceFloorId: row.sourceFloorId,
    historySourceBranchId: row.historySourceBranchId,
    historySourceMode: row.historySourceMode,
    assets: parseJsonObjectField<PromptRuntimeAssetsView>(row.assetsJson, {
      preset: null,
      characterCard: null,
      worldbook: null,
      regexProfile: null,
    }),
    resolvedPolicy: parseJsonObjectField<ResolvedPromptRuntimePolicy>(row.resolvedPolicyJson, buildResolvedPromptRuntimePolicy()),
    sourceMap: parseJsonObjectField<PromptRuntimeSourceMap>(row.sourceMapJson, {}),
    diagnostics: parseJsonArrayField<PromptRuntimeDiagnostic>(row.diagnosticsJson),
    trimReasons: parseJsonArrayField<PromptTrimReason>(row.trimReasonsJson),
    excludedSources: parseJsonArrayField<PromptSourceExclusionReason>(row.excludedSourcesJson),
    sectionStats: parseJsonArrayField<PromptRuntimeSectionStat>(row.sectionStatsJson),
    snapshotVersion: row.snapshotVersion === 1 ? 1 : 1,
    createdAt: row.createdAt,
  };
}

function buildPromptRuntimeExplainDiff(args: {
  leftFloorId: string;
  rightFloorId: string;
  leftSnapshot: PromptRuntimeCommittedExplainSnapshot | null;
  rightSnapshot: PromptRuntimeCommittedExplainSnapshot | null;
}): PromptRuntimeExplainDiff {
  const leftSnapshotAvailable = args.leftSnapshot !== null;
  const rightSnapshotAvailable = args.rightSnapshot !== null;
  const limitations: string[] = [];

  if (!leftSnapshotAvailable) {
    limitations.push(`Left floor '${args.leftFloorId}' has no committed prompt runtime snapshot. Compare skipped recomputation and returned limitations only.`);
  }
  if (!rightSnapshotAvailable) {
    limitations.push(`Right floor '${args.rightFloorId}' has no committed prompt runtime snapshot. Compare skipped recomputation and returned limitations only.`);
  }

  if (!args.leftSnapshot || !args.rightSnapshot) {
    return {
      left: { floorId: args.leftFloorId, snapshotAvailable: leftSnapshotAvailable },
      right: { floorId: args.rightFloorId, snapshotAvailable: rightSnapshotAvailable },
      scopeChanges: [],
      policyChanges: [],
      assetChanges: [],
      diagnosticsChanges: [],
      trimChanges: [],
      exclusionChanges: [],
      limitations,
    };
  }

  return {
    left: { floorId: args.leftFloorId, snapshotAvailable: true },
    right: { floorId: args.rightFloorId, snapshotAvailable: true },
    scopeChanges: buildPromptRuntimeDiffEntries("scope", toPromptRuntimeSnapshotScope(args.leftSnapshot), toPromptRuntimeSnapshotScope(args.rightSnapshot)),
    policyChanges: buildPromptRuntimeDiffEntries(
      "policy",
      { resolvedPolicy: args.leftSnapshot.resolvedPolicy, sourceMap: args.leftSnapshot.sourceMap },
      { resolvedPolicy: args.rightSnapshot.resolvedPolicy, sourceMap: args.rightSnapshot.sourceMap },
    ),
    assetChanges: buildPromptRuntimeDiffEntries("assets", args.leftSnapshot.assets, args.rightSnapshot.assets),
    diagnosticsChanges: buildPromptRuntimeDiffEntries(
      "diagnostics",
      normalizePromptRuntimeCollectionForDiff(args.leftSnapshot.diagnostics),
      normalizePromptRuntimeCollectionForDiff(args.rightSnapshot.diagnostics),
    ),
    trimChanges: buildPromptRuntimeDiffEntries(
      "trimReasons",
      normalizePromptRuntimeCollectionForDiff(args.leftSnapshot.trimReasons),
      normalizePromptRuntimeCollectionForDiff(args.rightSnapshot.trimReasons),
    ),
    exclusionChanges: buildPromptRuntimeDiffEntries(
      "excludedSources",
      normalizePromptRuntimeCollectionForDiff(args.leftSnapshot.excludedSources),
      normalizePromptRuntimeCollectionForDiff(args.rightSnapshot.excludedSources),
    ),
    limitations,
  };
}

function toPromptRuntimeSnapshotScope(snapshot: PromptRuntimeCommittedExplainSnapshot): PromptRuntimeScopeRef {
  return {
    sessionId: snapshot.sessionId,
    targetBranchId: snapshot.targetBranchId ?? "main",
    branchExists: true,
    sourceFloorId: snapshot.sourceFloorId ?? null,
    historySourceBranchId: snapshot.historySourceBranchId ?? snapshot.targetBranchId ?? "main",
    historySourceMode: snapshot.historySourceMode,
  };
}

function normalizePromptRuntimeCollectionForDiff<TValue>(items: TValue[]): TValue[] {
  return [...items].sort((left, right) => stablePromptRuntimeStringify(left).localeCompare(stablePromptRuntimeStringify(right)));
}

function buildPromptRuntimeDiffEntries(
  path: string,
  left: unknown,
  right: unknown,
): PromptRuntimeDiffEntry<unknown>[] {
  if (stablePromptRuntimeStringify(left) === stablePromptRuntimeStringify(right)) {
    return [];
  }

  if (isPromptRuntimePlainObject(left) && isPromptRuntimePlainObject(right)) {
    const changes: PromptRuntimeDiffEntry<unknown>[] = [];
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of Array.from(keys).sort()) {
      changes.push(...buildPromptRuntimeDiffEntries(`${path}.${key}`, left[key], right[key]));
    }
    return changes;
  }

  return [{
    path,
    changeType: resolvePromptRuntimeDiffChangeType(left, right),
    ...(left !== undefined ? { left } : {}),
    ...(right !== undefined ? { right } : {}),
  }];
}

function resolvePromptRuntimeDiffChangeType(
  left: unknown,
  right: unknown,
): PromptRuntimeDiffEntry<unknown>["changeType"] {
  if (left === undefined) {
    return "added";
  }
  if (right === undefined) {
    return "removed";
  }
  return "changed";
}

function stablePromptRuntimeStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stablePromptRuntimeStringify(item)).join(",")}]`;
  }
  if (isPromptRuntimePlainObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stablePromptRuntimeStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function isPromptRuntimePlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function readPromptRuntimePersistentPolicy(
  metadataJson: string | null,
): { persistentPolicy?: PromptRuntimePersistentPolicy; envelope?: PromptRuntimePersistedPolicyEnvelope; warnings: string[] } {
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

  return parsePromptRuntimePolicyPayload(policy, INVALID_PROMPT_RUNTIME_POLICY_WARNING);
}

export function readPromptRuntimeBranchPersistentPolicy(
  metadataJson: string | null,
  branchId: string,
): { persistentPolicy?: PromptRuntimePersistentPolicy; envelope?: PromptRuntimePersistedPolicyEnvelope; warnings: string[] } {
  const metadata = parseJsonField(metadataJson);
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return { warnings: [] };
  }

  const namespace = (metadata as Record<string, unknown>).prompt_runtime;
  if (namespace === undefined || namespace === null) {
    return { warnings: [] };
  }

  if (typeof namespace !== "object" || Array.isArray(namespace)) {
    return { warnings: [] };
  }

  const branchPolicies = (namespace as Record<string, unknown>).branchPolicies;
  if (branchPolicies === undefined || branchPolicies === null) {
    return { warnings: [] };
  }

  if (typeof branchPolicies !== "object" || Array.isArray(branchPolicies)) {
    return { warnings: [INVALID_PROMPT_RUNTIME_BRANCH_POLICY_WARNING] };
  }

  const branchPolicy = (branchPolicies as Record<string, unknown>)[branchId];
  if (branchPolicy === undefined || branchPolicy === null) {
    return { warnings: [] };
  }

  return parsePromptRuntimePolicyPayload(branchPolicy, INVALID_PROMPT_RUNTIME_BRANCH_POLICY_WARNING);
}

function parsePromptRuntimePolicyPayload(
  value: unknown,
  invalidWarning: string,
): { persistentPolicy?: PromptRuntimePersistentPolicy; envelope?: PromptRuntimePersistedPolicyEnvelope; warnings: string[] } {
  const envelopeParsed = promptRuntimePersistedPolicyEnvelopeSchema.safeParse(value);
  if (envelopeParsed.success) {
    const normalizedEnvelope = normalizePersistedPolicyEnvelope(envelopeParsed.data);
    return normalizedEnvelope
      ? { persistentPolicy: normalizedEnvelope.value, envelope: normalizedEnvelope, warnings: [] }
      : { warnings: [] };
  }

  const parsed = promptRuntimePersistentPolicySchema.safeParse(value);
  if (!parsed.success) {
    return { warnings: [invalidWarning] };
  }

  const normalized = normalizePersistentPolicy(parsed.data);
  return normalized
    ? { persistentPolicy: normalized, warnings: [] }
    : { warnings: [] };
}

function normalizePersistedPolicyEnvelope(
  envelope: z.infer<typeof promptRuntimePersistedPolicyEnvelopeSchema>,
): PromptRuntimePersistedPolicyEnvelope | undefined {
  const normalizedValue = normalizePersistentPolicy(envelope.value);
  if (!normalizedValue) {
    return undefined;
  }

  return {
    version: envelope.version,
    updatedAt: envelope.updatedAt,
    ...(envelope.updatedBy !== undefined ? { updatedBy: envelope.updatedBy } : {}),
    value: normalizedValue,
  };
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

  if (value.budget) {
    const budget = resolvePromptRuntimeBudgetPolicy(value.budget);
    if (Object.keys(budget).length > 0) {
      normalized.budget = budget;
    }
  }

  if (value.sourceSelection) {
    const sourceSelection = mergePromptSourceSelectionPolicy(undefined, {
      ...(value.sourceSelection.history ? { history: { ...value.sourceSelection.history } } : {}),
      ...(value.sourceSelection.memory ? { memory: { ...value.sourceSelection.memory } } : {}),
      ...(value.sourceSelection.worldbook ? { worldbook: { ...value.sourceSelection.worldbook } } : {}),
      ...(value.sourceSelection.examples ? { examples: { ...value.sourceSelection.examples } } : {}),
    });
    if (sourceSelection) {
      normalized.sourceSelection = sourceSelection;
    }
  }

  if (value.visibility) {
    const visibility = normalizePromptVisibilityPolicy(value.visibility);
    if (visibility) {
      normalized.visibility = visibility;
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

  if (policy.budget) {
    serialized.budget = {
      ...(policy.budget.maxInputTokens !== undefined ? { maxInputTokens: policy.budget.maxInputTokens } : {}),
      ...(policy.budget.reservedCompletionTokens !== undefined ? { reservedCompletionTokens: policy.budget.reservedCompletionTokens } : {}),
    };
  }

  if (policy.sourceSelection) {
    serialized.sourceSelection = {
      ...(policy.sourceSelection.history ? { history: policy.sourceSelection.history } : {}),
      ...(policy.sourceSelection.memory ? { memory: policy.sourceSelection.memory } : {}),
      ...(policy.sourceSelection.worldbook ? { worldbook: policy.sourceSelection.worldbook } : {}),
      ...(policy.sourceSelection.examples ? { examples: policy.sourceSelection.examples } : {}),
    };
  }
  if (policy.visibility) {
    serialized.visibility = serializePromptVisibilityPolicy(policy.visibility);
  }

  return serialized;
}

function serializePromptRuntimePersistedPolicyEnvelope(
  envelope: PromptRuntimePersistedPolicyEnvelope,
): Record<string, unknown> {
  return {
    version: envelope.version,
    updatedAt: envelope.updatedAt,
    ...(envelope.updatedBy !== undefined ? { updatedBy: envelope.updatedBy } : {}),
    value: serializePromptRuntimePersistentPolicy(envelope.value),
  };
}

function createPromptRuntimePersistedPolicyEnvelope(args: {
  currentEnvelope?: PromptRuntimePersistedPolicyEnvelope;
  policy: PromptRuntimePersistentPolicy;
  updatedAt: number;
  updatedBy?: string | null;
}): PromptRuntimePersistedPolicyEnvelope {
  return {
    version: (args.currentEnvelope?.version ?? 0) + 1,
    updatedAt: args.updatedAt,
    ...(args.updatedBy !== undefined ? { updatedBy: args.updatedBy } : {}),
    value: args.policy,
  };
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
  options: {
    currentEnvelope?: PromptRuntimePersistedPolicyEnvelope;
    updatedAt: number;
    updatedBy?: string | null;
  },
): Record<string, unknown> | undefined {
  const nextMetadata = { ...metadata };
  const existingNamespace = nextMetadata.prompt_runtime;
  const nextNamespace = existingNamespace && typeof existingNamespace === "object" && !Array.isArray(existingNamespace)
    ? { ...(existingNamespace as Record<string, unknown>) }
    : {};

  if (policy) {
    nextNamespace.policy = serializePromptRuntimePersistedPolicyEnvelope(
      createPromptRuntimePersistedPolicyEnvelope({
        currentEnvelope: options.currentEnvelope,
        policy,
        updatedAt: options.updatedAt,
        updatedBy: options.updatedBy,
      }),
    );
    nextMetadata.prompt_runtime = nextNamespace;
  } else {
    delete nextNamespace.policy;
    if (Object.keys(nextNamespace).length > 0) nextMetadata.prompt_runtime = nextNamespace;
    else delete nextMetadata.prompt_runtime;
  }

  return Object.keys(nextMetadata).length > 0 ? nextMetadata : undefined;
}

function writePromptRuntimeBranchPersistentPolicyToMetadata(
  metadata: Record<string, unknown>,
  branchId: string,
  policy: PromptRuntimePersistentPolicy | undefined,
  options: {
    currentEnvelope?: PromptRuntimePersistedPolicyEnvelope;
    updatedAt: number;
    updatedBy?: string | null;
  },
): Record<string, unknown> | undefined {
  const nextMetadata = { ...metadata };
  const existingNamespace = nextMetadata.prompt_runtime;
  const nextNamespace = existingNamespace && typeof existingNamespace === "object" && !Array.isArray(existingNamespace)
    ? { ...(existingNamespace as Record<string, unknown>) }
    : {};
  const existingBranchPolicies = nextNamespace.branchPolicies;
  const nextBranchPolicies = existingBranchPolicies && typeof existingBranchPolicies === "object" && !Array.isArray(existingBranchPolicies)
    ? { ...(existingBranchPolicies as Record<string, unknown>) }
    : {};

  if (policy) {
    nextBranchPolicies[branchId] = serializePromptRuntimePersistedPolicyEnvelope(
      createPromptRuntimePersistedPolicyEnvelope({
        currentEnvelope: options.currentEnvelope,
        policy,
        updatedAt: options.updatedAt,
        updatedBy: options.updatedBy,
      }),
    );
    nextNamespace.branchPolicies = nextBranchPolicies;
  } else {
    delete nextBranchPolicies[branchId];
    if (Object.keys(nextBranchPolicies).length > 0) nextNamespace.branchPolicies = nextBranchPolicies;
    else delete nextNamespace.branchPolicies;
  }

  if (Object.keys(nextNamespace).length > 0) nextMetadata.prompt_runtime = nextNamespace;
  else delete nextMetadata.prompt_runtime;
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

function normalizePromptRuntimeBranchId(value: string): string {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : "main";
}

function selectPromptRuntimePolicySource(args: {
  session: unknown;
  branch: unknown;
  request: unknown;
}): Extract<PromptRuntimePolicySource, "session_policy" | "branch_policy" | "request_override"> | undefined {
  if (args.request !== undefined) {
    return "request_override";
  }

  if (args.branch !== undefined) {
    return "branch_policy";
  }

  if (args.session !== undefined) {
    return "session_policy";
  }

  return undefined;
}

function prunePromptRuntimeSourceMap(sourceMap: PromptRuntimeSourceMap): PromptRuntimeSourceMap | undefined {
  const nextSourceMap: PromptRuntimeSourceMap = {
    ...(sourceMap.structure && Object.keys(sourceMap.structure).length > 0
      ? { structure: sourceMap.structure }
      : {}),
    ...(sourceMap.delivery && Object.keys(sourceMap.delivery).length > 0
      ? { delivery: sourceMap.delivery }
      : {}),
    ...(sourceMap.debug && Object.keys(sourceMap.debug).length > 0
      ? { debug: sourceMap.debug }
      : {}),
    ...(sourceMap.budget && Object.keys(sourceMap.budget).length > 0
      ? { budget: sourceMap.budget }
      : {}),
    ...(sourceMap.sourceSelection && Object.keys(sourceMap.sourceSelection).length > 0
      ? { sourceSelection: sourceMap.sourceSelection }
      : {}),
    ...(sourceMap.visibility && Object.keys(sourceMap.visibility).length > 0
      ? { visibility: sourceMap.visibility }
      : {}),
    ...(sourceMap.history && Object.keys(sourceMap.history).length > 0
      ? { history: sourceMap.history }
      : {}),
  };

  return Object.keys(nextSourceMap).length > 0 ? nextSourceMap : undefined;
}

