import { buildAccountHeaders, type AccountIdHint, type TransportClient } from "../client/transport.js";
import {
  mapPromptRuntimePreviewTracePayload,
  type PromptRuntimePreviewTrace,
  type PromptRuntimeSourceKind,
  type PromptRuntimeTrace,
  type PromptRuntimeVisibilityRange,
  type PromptSourceExclusionReasonCode,
  type PromptTrimReasonCode,
} from "../prompt-runtime.js";
import {
  compactObject,
  readArray,
  readBoolean,
  readNullableNumber,
  readNullableString,
  readNumber,
  readOptionalString,
  readRecord,
  readString,
} from "./utils.js";

export type PromptRuntimeStructureMode = "default" | "strict_alternating" | "no_assistant" | "flattened";
export type PromptRuntimeAssistantRewriteStrategy = "to_system" | "to_user_transcript";
export type PromptRuntimePolicySource =
  | "system_default"
  | "asset_default"
  | "session_policy"
  | "branch_policy"
  | "request_override"
  | "provider_constraint";
export type PromptRuntimeGovernedPolicyField = "structure" | "delivery" | "budget" | "sourceSelection" | "visibility";
export type PromptRuntimeStreamPromptDebugPayloadMode = "done_only" | "unsupported";
export type PromptRuntimeMacroDiagnosticsSurface = "unified_observability";
export type PromptRuntimeHistorySourceMode = "existing_branch" | "source_floor_branch" | "main_fallback";
export type PromptRuntimeDiagnosticSeverity = "info" | "warning" | "error";
export type PromptRuntimeDiagnosticSource = "policy" | "branch" | "macro" | "budget" | "source_selection" | "provider_constraint";
export type PromptRuntimeDiagnosticPhase = "preview" | "dry_run" | "assemble" | "commit_consume" | "explain";

export type PromptRuntimePersistentStructurePolicy = {
  assistantRewriteStrategy?: PromptRuntimeAssistantRewriteStrategy;
  mergeAdjacentSameRole?: boolean;
  mode: PromptRuntimeStructureMode;
  preserveSystemMessages?: boolean;
};

export type PromptRuntimePersistentDeliveryPolicy = {
  allowAssistantPrefill?: boolean;
  noAssistant?: boolean;
  requireLastUser?: boolean;
};

export type PromptRuntimeBudgetPolicy = {
  maxInputTokens?: number;
  reservedCompletionTokens?: number;
};

export type PromptRuntimeVisibilityMode = "allow_all_except_hidden" | "deny_all_except_visible";

export type PromptRuntimeVisibilityPolicy = {
  hiddenFloorIds?: string[];
  hiddenFloorRanges?: PromptRuntimeVisibilityRange[];
  mode?: PromptRuntimeVisibilityMode;
  visibleFloorRanges?: PromptRuntimeVisibilityRange[];
};

export type PromptRuntimeResolvedVisibilityPolicy = PromptRuntimeVisibilityPolicy & {
  mode: PromptRuntimeVisibilityMode;
};

export type PromptRuntimeSourceSelectionPolicy = {
  examples?: { enabled?: boolean };
  history?: { maxMessages?: number; mode?: "full" | "windowed" };
  memory?: { enabled?: boolean };
  worldbook?: { enabled?: boolean };
};

export type PromptRuntimeResolvedBudgetPolicy = PromptRuntimeBudgetPolicy;

export type PromptRuntimeResolvedSourceSelectionPolicy = {
  examples: { enabled: boolean };
  history: { maxMessages?: number; mode: "full" | "windowed" };
  memory: { enabled: boolean };
  worldbook: { enabled: boolean };
};

export type PromptRuntimePersistentPolicy = {
  budget?: PromptRuntimeBudgetPolicy;
  delivery?: PromptRuntimePersistentDeliveryPolicy;
  sourceSelection?: PromptRuntimeSourceSelectionPolicy;
  visibility?: PromptRuntimeVisibilityPolicy;
  structure?: PromptRuntimePersistentStructurePolicy;
};

export type PromptRuntimePersistedPolicyEnvelope = {
  updatedAt: number;
  updatedBy?: string | null;
  value: PromptRuntimePersistentPolicy;
  version: number;
};

export type PromptRuntimeDebugPolicy = {
  includePromptSnapshot: boolean;
  includeRuntimeTrace: boolean;
  includeWorldbookMatches: boolean;
};

export type PromptRuntimeResolvedStructurePolicy = {
  assistantRewriteStrategy?: PromptRuntimeAssistantRewriteStrategy;
  mergeAdjacentSameRole: boolean;
  mode: PromptRuntimeStructureMode;
  preserveSystemMessages: boolean;
};

export type PromptRuntimeResolvedDeliveryPolicy = {
  allowAssistantPrefill: boolean;
  noAssistant: boolean;
  requireLastUser: boolean;
};

export type PromptRuntimeResolvedPolicy = {
  debug: PromptRuntimeDebugPolicy;
  budget: PromptRuntimeResolvedBudgetPolicy;
  delivery: PromptRuntimeResolvedDeliveryPolicy;
  sourceSelection: PromptRuntimeResolvedSourceSelectionPolicy;
  visibility: PromptRuntimeResolvedVisibilityPolicy;
  structure: PromptRuntimeResolvedStructurePolicy;
};

export type PromptRuntimeSourceMap = {
  debug?: {
    includePromptSnapshot?: PromptRuntimePolicySource;
    includeRuntimeTrace?: PromptRuntimePolicySource;
    includeWorldbookMatches?: PromptRuntimePolicySource;
  };
  budget?: {
    maxInputTokens?: PromptRuntimePolicySource;
    reservedCompletionTokens?: PromptRuntimePolicySource;
  };
  delivery?: {
    allowAssistantPrefill?: PromptRuntimePolicySource;
    noAssistant?: PromptRuntimePolicySource;
    requireLastUser?: PromptRuntimePolicySource;
  };
  sourceSelection?: {
    examples?: { enabled?: PromptRuntimePolicySource };
    history?: { maxMessages?: PromptRuntimePolicySource; mode?: PromptRuntimePolicySource };
    memory?: { enabled?: PromptRuntimePolicySource };
    worldbook?: { enabled?: PromptRuntimePolicySource };
  };
  visibility?: {
    hiddenFloorIds?: PromptRuntimePolicySource;
    hiddenFloorRanges?: PromptRuntimePolicySource;
    mode?: PromptRuntimePolicySource;
    visibleFloorRanges?: PromptRuntimePolicySource;
  };
  structure?: {
    assistantRewriteStrategy?: PromptRuntimePolicySource;
    mergeAdjacentSameRole?: PromptRuntimePolicySource;
    mode?: PromptRuntimePolicySource;
    preserveSystemMessages?: PromptRuntimePolicySource;
  };
  history?: {
    sourceBranchId?: string;
    sourceMode?: PromptRuntimeHistorySourceMode;
  };
};

export type PromptRuntimeScopeRef = {
  branchExists: boolean;
  historySourceBranchId: string;
  historySourceMode: PromptRuntimeHistorySourceMode;
  sessionId: string;
  sourceFloorId?: string | null;
  targetBranchId: string;
};

export type PromptRuntimeDiagnostic = { code: string; message: string; severity: PromptRuntimeDiagnosticSeverity; source?: PromptRuntimeDiagnosticSource; fieldPath?: string; phase?: PromptRuntimeDiagnosticPhase; };

export type PromptRuntimeAssetSummary = {
  id: string;
  name: string | null;
};

export type PromptRuntimeAssetsView = {
  characterCard: PromptRuntimeAssetSummary | null;
  preset: PromptRuntimeAssetSummary | null;
  regexProfile: PromptRuntimeAssetSummary | null;
  worldbook: PromptRuntimeAssetSummary | null;
};

export type PromptRuntimeResolvedState = {
  assets: PromptRuntimeAssetsView;
  branchPersistentPolicyEnvelope?: PromptRuntimePersistedPolicyEnvelope | null;
  branchPersistentPolicy?: PromptRuntimePersistentPolicy | null;
  diagnostics?: PromptRuntimeDiagnostic[];
  limitations?: string[];
  persistentPolicyEnvelope?: PromptRuntimePersistedPolicyEnvelope | null;
  persistentPolicy?: PromptRuntimePersistentPolicy;
  scope: PromptRuntimeScopeRef;
  policy: PromptRuntimeResolvedPolicy;
  sourceMap?: PromptRuntimeSourceMap;
  warnings: string[];
};

export type PromptRuntimePolicyView = {
  persistentPolicyEnvelope?: PromptRuntimePersistedPolicyEnvelope | null;
  persistentPolicy?: PromptRuntimePersistentPolicy;
  resolvedPolicy: PromptRuntimeResolvedPolicy;
  warnings: string[];
};

export type PromptRuntimeCapabilities = {
  delivery: {
    defaults: PromptRuntimeResolvedDeliveryPolicy;
  };
  budget: {
    defaults: PromptRuntimeResolvedBudgetPolicy;
    persistentPatchSupported: boolean;
    requestOverrideSupported: boolean;
    supportedFields: string[];
    trimReasonCodes: PromptTrimReasonCode[];
  };
  compare: {
    committedFloorsOnly: boolean;
    enabled: boolean;
    limitationsInsteadOfRecompute: boolean;
    mixedPreviewSupported: boolean;
  };
  governance: {
    branch: {
      envelopeMetadata: boolean;
      materializedBranchesOnly: boolean;
      nullClearsField: boolean;
      objectPatch: "deep_merge";
      supportedFields: PromptRuntimeGovernedPolicyField[];
    };
    session: {
      envelopeMetadata: boolean;
      nullClearsField: boolean;
      objectPatch: "deep_merge";
      supportedFields: PromptRuntimeGovernedPolicyField[];
    };
  };
  macro: {
    builtInReadOnlyValuesPersistable: boolean;
    dedicatedMacrosRoute: boolean;
    diagnosticsSurface: PromptRuntimeMacroDiagnosticsSurface;
    recentMessageRespectsVisibility: boolean;
    runKindPersistable: boolean;
    stCompatibilitySnapshotsPersistable: boolean;
  };
  observability: {
    dryRun: {
      enabled: boolean;
      includeWorldbookMatches: boolean;
      returnsAssembly: boolean;
      returnsRuntimeTrace: boolean;
      supportsVisibility: boolean;
    };
    live: {
      defaultOff: boolean;
      enabled: boolean;
      includePromptSnapshot: boolean;
      includeRuntimeTrace: boolean;
      includeWorldbookMatches: boolean;
      requestScopedOnly: boolean;
      visibilityRequestSupported: boolean;
      worldbookMatchesRequiresOptIn: boolean;
      worldbookMatchesRequiresRuntimeTrace: boolean;
    };
    preview: {
      commitsSideEffects: boolean;
      createsFloor: boolean;
      enabled: boolean;
      llmCall: boolean;
      returnsRuntimeTrace: boolean;
      singleTextOnly: boolean;
      supportsVisibility: boolean;
      writesPromptSnapshot: boolean;
    };
    explain: {
      enabled: boolean;
      legacyFloorFallback: boolean;
      persistedTruthOnly: boolean;
      readOnly: boolean;
      recompute: boolean;
      requiresCommittedFloor: boolean;
      snapshotAvailabilityField: "snapshot_available";
      snapshotSupported: boolean;
    };
    stream: {
      enabled: boolean;
      newSseEventFamily: boolean;
      promptDebugPayload: PromptRuntimeStreamPromptDebugPayloadMode;
    };
  };
  sourceSelection: {
    defaults: PromptRuntimeResolvedSourceSelectionPolicy;
    exclusionReasonCodes: PromptSourceExclusionReasonCode[];
    historyModes: Array<"full" | "windowed">;
    persistentPatchSupported: boolean;
    requestOverrideSupported: boolean;
    supportedSources: Array<Extract<PromptRuntimeSourceKind, "history" | "memory" | "worldbook" | "examples">>;
  };
  structure: {
    defaults: PromptRuntimeResolvedStructurePolicy;
    modes: PromptRuntimeStructureMode[];
  };
  unsupported: string[];
};

export type PromptRuntimeGetSessionOptions = {
  accountId?: AccountIdHint;
  sessionId: string;
};

export type PromptRuntimeGetResolvedStateOptions = PromptRuntimeGetSessionOptions & {
  branchId?: string;
};

export type PromptRuntimeGetPolicyOptions = PromptRuntimeGetSessionOptions;
export type PromptRuntimeGetAssetsOptions = PromptRuntimeGetSessionOptions;
export type PromptRuntimeGetBranchPolicyOptions = PromptRuntimeGetSessionOptions & { branchId: string };
export type PromptRuntimeGetCapabilitiesOptions = {
  accountId?: AccountIdHint;
};

export type PromptRuntimePreviewVisibilityMode = PromptRuntimeVisibilityMode;

export type PromptRuntimePreviewVisibility = PromptRuntimeVisibilityPolicy;

export type PromptRuntimePreviewOptions = PromptRuntimeGetSessionOptions & {
  branchId?: string;
  budget?: PromptRuntimeBudgetPolicy;
  delivery?: PromptRuntimePersistentDeliveryPolicy;
  sourceSelection?: PromptRuntimeSourceSelectionPolicy;
  sourceFloorId?: string;
  structure?: PromptRuntimePersistentStructurePolicy;
  text: string;
  visibility?: PromptRuntimePreviewVisibility;
};

export type PromptRuntimePreviewResult = {
  diagnostics?: PromptRuntimeDiagnostic[];
  limitations?: string[];
  policy: PromptRuntimeResolvedPolicy;
  runtimeTrace: PromptRuntimePreviewTrace;
  scope: PromptRuntimeScopeRef;
  sourceMap?: PromptRuntimeSourceMap;
  text: string;
};

export type PromptRuntimeHistoricalExplainFloor = {
  branchId: string;
  committedAt: number;
  floorNo: number;
  id: string;
  parentFloorId: string | null;
  promptSnapshotCreatedAt: number;
  sessionId: string;
  state: "committed";
};

export type PromptRuntimeHistoricalExplainCommittedResult = {
  assistantMessageId: string;
  committedAt: number;
  generatedText: string;
  outputPageId: string;
  summaries: string[];
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  verifier?: { status: string; suggestion?: string | null; issues?: Array<{ description: string; severity: "warning" | "error" }> | null } | null;
};

export type PromptRuntimeHistoricalExplain = {
  assets: PromptRuntimeAssetsView | null;
  diagnostics?: PromptRuntimeDiagnostic[];
  excludedSources: NonNullable<PromptRuntimeTrace["sourceSelection"]>["excludedSources"] | null;
  floor: PromptRuntimeHistoricalExplainFloor;
  limitations?: string[];
  promptSnapshot: { presetId: string | null; presetUpdatedAt: number | null; presetVersion: number | null; worldbookId: string | null; worldbookUpdatedAt: number | null; worldbookVersion: number | null; regexProfileId: string | null; regexProfileUpdatedAt: number | null; regexProfileVersion: number | null; worldbookActivatedEntryUids: number[]; regexPreRuleNames: string[]; regexPostRuleNames: string[]; promptMode: "compat_strict" | "compat_plus" | "native"; promptDigest: string; tokenEstimate: number; };
  resolvedPolicy: PromptRuntimeResolvedPolicy | null;
  result: PromptRuntimeHistoricalExplainCommittedResult;
  sectionStats: Array<{ sectionName: string; tokenCount: number }> | null;
  snapshotAvailable: boolean;
  scope: PromptRuntimeScopeRef;
  sourceMap?: PromptRuntimeSourceMap;
  trimReasons: NonNullable<NonNullable<PromptRuntimeTrace["budgets"]>["trimReasons"]> | null;
};

export type PromptRuntimePatchPolicyOptions = PromptRuntimeGetSessionOptions & {
  budget?: PromptRuntimeBudgetPolicy | null;
  delivery?: PromptRuntimePersistentDeliveryPolicy | null;
  sourceSelection?: PromptRuntimeSourceSelectionPolicy | null;
  visibility?: PromptRuntimeVisibilityPolicy | null;
  structure?: PromptRuntimePersistentStructurePolicy | null;
};

export type PromptRuntimePatchBranchPolicyOptions = PromptRuntimeGetBranchPolicyOptions & {
  budget?: PromptRuntimeBudgetPolicy | null;
  delivery?: PromptRuntimePersistentDeliveryPolicy | null;
  sourceSelection?: PromptRuntimeSourceSelectionPolicy | null;
  visibility?: PromptRuntimeVisibilityPolicy | null;
  structure?: PromptRuntimePersistentStructurePolicy | null;
};

export type PromptRuntimeDiffEntry = {
  changeType: "added" | "removed" | "changed";
  left?: unknown;
  path: string;
  right?: unknown;
};

export type PromptRuntimeExplainDiff = {
  assetChanges: PromptRuntimeDiffEntry[];
  diagnosticsChanges: PromptRuntimeDiffEntry[];
  exclusionChanges: PromptRuntimeDiffEntry[];
  left: { floorId: string; snapshotAvailable: boolean };
  limitations: string[];
  policyChanges: PromptRuntimeDiffEntry[];
  right: { floorId: string; snapshotAvailable: boolean };
  scopeChanges: PromptRuntimeDiffEntry[];
  trimChanges: PromptRuntimeDiffEntry[];
};

export type PromptRuntimeCompareOptions = PromptRuntimeGetSessionOptions & {
  leftFloorId: string;
  rightFloorId: string;
};

export type PromptRuntimeGetFloorExplainOptions = { accountId?: AccountIdHint; floorId: string };

export type PromptRuntimeResource = {
  compare(options: PromptRuntimeCompareOptions): Promise<PromptRuntimeExplainDiff>;
  getAssets(options: PromptRuntimeGetAssetsOptions): Promise<PromptRuntimeAssetsView>;
  getBranchPolicy(options: PromptRuntimeGetBranchPolicyOptions): Promise<PromptRuntimePolicyView>;
  getCapabilities(options?: PromptRuntimeGetCapabilitiesOptions): Promise<PromptRuntimeCapabilities>;
  getPolicy(options: PromptRuntimeGetPolicyOptions): Promise<PromptRuntimePolicyView>;
  getSession(options: PromptRuntimeGetResolvedStateOptions): Promise<PromptRuntimeResolvedState>;
  getFloorExplain(options: PromptRuntimeGetFloorExplainOptions): Promise<PromptRuntimeHistoricalExplain>;
  patchBranchPolicy(options: PromptRuntimePatchBranchPolicyOptions): Promise<PromptRuntimePolicyView>;
  patchPolicy(options: PromptRuntimePatchPolicyOptions): Promise<PromptRuntimePolicyView>;
  previewText(options: PromptRuntimePreviewOptions): Promise<PromptRuntimePreviewResult>;
};

export function createPromptRuntimeResource(client: TransportClient): PromptRuntimeResource {
  return {
    async compare(options): Promise<PromptRuntimeExplainDiff> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/sessions/${encodeURIComponent(options.sessionId)}/prompt-runtime/compare`,
        {
          body: {
            left: { floor_id: options.leftFloorId },
            right: { floor_id: options.rightFloorId },
          },
          headers: buildAccountHeaders(options.accountId),
          method: "POST",
        },
      );

      const payload = mapPromptRuntimeExplainDiff(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Prompt Runtime compare payload is missing");
      }

      return payload;
    },
    async getAssets(options): Promise<PromptRuntimeAssetsView> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/sessions/${encodeURIComponent(options.sessionId)}/prompt-runtime/assets`,
        {
          headers: buildAccountHeaders(options.accountId),
          method: "GET",
        },
      );

      const payload = mapPromptRuntimeAssetsView(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Prompt Runtime assets payload is missing");
      }

      return payload;
    },
    async getBranchPolicy(options): Promise<PromptRuntimePolicyView> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/sessions/${encodeURIComponent(options.sessionId)}/prompt-runtime/branches/${encodeURIComponent(options.branchId)}/policy`,
        {
          headers: buildAccountHeaders(options.accountId),
          method: "GET",
        },
      );

      const payload = mapPromptRuntimePolicyView(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Prompt Runtime branch policy payload is missing");
      }

      return payload;
    },
    async getCapabilities(options: PromptRuntimeGetCapabilitiesOptions = {}): Promise<PromptRuntimeCapabilities> {
      const response = await client.fetchJson<Record<string, unknown>>("/prompt-runtime/capabilities", {
        headers: buildAccountHeaders(options.accountId),
        method: "GET",
      });

      const payload = mapPromptRuntimeCapabilities(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Prompt Runtime capabilities payload is missing");
      }

      return payload;
    },
    async getPolicy(options): Promise<PromptRuntimePolicyView> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/sessions/${encodeURIComponent(options.sessionId)}/prompt-runtime/policy`,
        {
          headers: buildAccountHeaders(options.accountId),
          method: "GET",
        },
      );

      const payload = mapPromptRuntimePolicyView(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Prompt Runtime policy payload is missing");
      }

      return payload;
    },
    async getSession(options): Promise<PromptRuntimeResolvedState> {
      const query = new URLSearchParams();
      if (options.branchId) {
        query.set("branch_id", options.branchId);
      }
      const response = await client.fetchJson<Record<string, unknown>>(
        `/sessions/${encodeURIComponent(options.sessionId)}/prompt-runtime${query.size > 0 ? `?${query.toString()}` : ""}`,
        {
          headers: buildAccountHeaders(options.accountId),
          method: "GET",
        },
      );

      const payload = mapPromptRuntimeResolvedState(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Prompt Runtime resolved state payload is missing");
      }

      return payload;
    },
    async getFloorExplain(options): Promise<PromptRuntimeHistoricalExplain> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/floors/${encodeURIComponent(options.floorId)}/prompt-runtime/explain`,
        {
          headers: buildAccountHeaders(options.accountId),
          method: "GET",
        },
      );

      const payload = mapPromptRuntimeHistoricalExplain(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Prompt Runtime historical explain payload is missing");
      }

      return payload;
    },
    async patchBranchPolicy(options): Promise<PromptRuntimePolicyView> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/sessions/${encodeURIComponent(options.sessionId)}/prompt-runtime/branches/${encodeURIComponent(options.branchId)}/policy`,
        {
          body: compactObject({
            budget: mapPromptRuntimeBudgetPolicyRequest(options.budget),
            delivery: mapPromptRuntimePersistentDeliveryPolicyRequest(options.delivery),
            source_selection: mapPromptRuntimeSourceSelectionPolicyRequest(options.sourceSelection),
            visibility: mapPromptRuntimeVisibilityPolicyRequest(options.visibility),
            structure: mapPromptRuntimePersistentStructurePolicyRequest(options.structure),
          }),
          headers: buildAccountHeaders(options.accountId),
          method: "PATCH",
        },
      );

      const payload = mapPromptRuntimePolicyView(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Prompt Runtime branch policy patch payload is missing");
      }

      return payload;
    },
    async patchPolicy(options): Promise<PromptRuntimePolicyView> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/sessions/${encodeURIComponent(options.sessionId)}/prompt-runtime/policy`,
        {
          body: compactObject({
            budget: mapPromptRuntimeBudgetPolicyRequest(options.budget),
            delivery: mapPromptRuntimePersistentDeliveryPolicyRequest(options.delivery),
            source_selection: mapPromptRuntimeSourceSelectionPolicyRequest(options.sourceSelection),
            visibility: mapPromptRuntimeVisibilityPolicyRequest(options.visibility),
            structure: mapPromptRuntimePersistentStructurePolicyRequest(options.structure),
          }),
          headers: buildAccountHeaders(options.accountId),
          method: "PATCH",
        },
      );

      const payload = mapPromptRuntimePolicyView(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Prompt Runtime policy patch payload is missing");
      }

      return payload;
    },
    async previewText(options): Promise<PromptRuntimePreviewResult> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/sessions/${encodeURIComponent(options.sessionId)}/prompt-runtime/preview`,
        {
          body: compactObject({
            text: options.text,
            branch_id: options.branchId,
            budget: mapPromptRuntimeBudgetPolicyRequest(options.budget),
            structure: mapPromptRuntimePersistentStructurePolicyRequest(options.structure),
            delivery: mapPromptRuntimePersistentDeliveryPolicyRequest(options.delivery),
            source_selection: mapPromptRuntimeSourceSelectionPolicyRequest(options.sourceSelection),
            source_floor_id: options.sourceFloorId,
            visibility: mapPromptRuntimeVisibilityPolicyRequest(options.visibility),
          }),
          headers: buildAccountHeaders(options.accountId),
          method: "POST",
        },
      );

      const payload = mapPromptRuntimePreviewResult(readRecord(response.body)?.data);
      if (!payload) {
        throw new Error("Prompt Runtime preview payload is missing");
      }

      return payload;
    },
  };
}

function mapPromptRuntimeResolvedState(value: unknown): PromptRuntimeResolvedState | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const policy = mapPromptRuntimeResolvedPolicy(record.policy);
  const assets = mapPromptRuntimeAssetsView(record.assets);
  const scope = mapPromptRuntimeScopeRef(record.scope);
  if (!policy || !assets) {
    return null;
  }

  const persistentPolicy = mapPromptRuntimePersistentPolicy(record.persistent_policy);
  const branchPersistentPolicy = mapPromptRuntimePersistentPolicy(record.branch_persistent_policy);
  const persistentPolicyEnvelope = mapPromptRuntimePersistentPolicyEnvelope(record.persistent_policy_envelope);
  const branchPersistentPolicyEnvelope = mapPromptRuntimePersistentPolicyEnvelope(record.branch_persistent_policy_envelope);
  const sourceMap = mapPromptRuntimeSourceMap(record.source_map);

  return {
    assets,
    ...(record.branch_persistent_policy_envelope !== undefined ? { branchPersistentPolicyEnvelope: branchPersistentPolicyEnvelope ?? null } : {}),
    ...(record.branch_persistent_policy !== undefined ? { branchPersistentPolicy: branchPersistentPolicy ?? null } : {}),
    ...(record.diagnostics !== undefined ? { diagnostics: mapPromptRuntimeDiagnostics(record.diagnostics) } : {}),
    ...(record.limitations !== undefined ? { limitations: mapStringArray(record.limitations) } : {}),
    ...(record.persistent_policy_envelope !== undefined ? { persistentPolicyEnvelope: persistentPolicyEnvelope ?? null } : {}),
    ...(persistentPolicy ? { persistentPolicy } : {}),
    scope: scope ?? {
      sessionId: "",
      targetBranchId: "main",
      branchExists: true,
      historySourceBranchId: "main",
      historySourceMode: "existing_branch",
    },
    policy,
    ...(sourceMap ? { sourceMap } : {}),
    warnings: mapStringArray(record.warnings),
  };
}

function mapPromptRuntimePolicyView(value: unknown): PromptRuntimePolicyView | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const resolvedPolicy = mapPromptRuntimeResolvedPolicy(record.resolved_policy);
  if (!resolvedPolicy) {
    return null;
  }

  const persistentPolicy = mapPromptRuntimePersistentPolicy(record.persistent_policy);
  const persistentPolicyEnvelope = mapPromptRuntimePersistentPolicyEnvelope(record.persistent_policy_envelope);

  return {
    ...(record.persistent_policy_envelope !== undefined ? { persistentPolicyEnvelope: persistentPolicyEnvelope ?? null } : {}),
    ...(persistentPolicy ? { persistentPolicy } : {}),
    resolvedPolicy,
    warnings: mapStringArray(record.warnings),
  };
}

function mapPromptRuntimePersistentPolicyEnvelope(value: unknown): PromptRuntimePersistedPolicyEnvelope | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const persistedPolicy = mapPromptRuntimePersistentPolicy(record.value);
  if (!persistedPolicy) {
    return null;
  }

  return {
    updatedAt: readNumber(record.updated_at),
    ...(record.updated_by !== undefined ? { updatedBy: readNullableString(record.updated_by) } : {}),
    value: persistedPolicy,
    version: readNumber(record.version),
  };
}

function mapPromptRuntimeCapabilities(value: unknown): PromptRuntimeCapabilities | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const budget = readRecord(record.budget);
  const sourceSelection = readRecord(record.source_selection);
  const structure = readRecord(record.structure);
  const delivery = readRecord(record.delivery);
  const observability = readRecord(record.observability);
  const macro = readRecord(record.macro);
  const governance = readRecord(record.governance);
  const compare = readRecord(record.compare);
  const live = readRecord(observability?.live);
  const dryRun = readRecord(observability?.dry_run);
  const preview = readRecord(observability?.preview);
  const stream = readRecord(observability?.stream);
  const explain = readRecord(observability?.explain);
  const sessionGovernance = readRecord(governance?.session);
  const branchGovernance = readRecord(governance?.branch);
  const defaultsBudget = mapPromptRuntimeResolvedBudgetPolicy(budget?.defaults);
  const defaultsStructure = mapPromptRuntimeResolvedStructurePolicy(structure?.defaults);
  const defaultsDelivery = mapPromptRuntimeResolvedDeliveryPolicy(delivery?.defaults);
  const defaultsSourceSelection = mapPromptRuntimeResolvedSourceSelectionPolicy(sourceSelection?.defaults);

  if (!budget || !sourceSelection || !structure || !delivery || !observability || !macro || !governance || !compare || !live || !dryRun || !preview || !stream || !explain || !sessionGovernance || !branchGovernance || !defaultsBudget || !defaultsStructure || !defaultsDelivery || !defaultsSourceSelection) {
    return null;
  }

  return {
    budget: {
      defaults: defaultsBudget,
      persistentPatchSupported: readBoolean(budget.persistent_patch_supported),
      requestOverrideSupported: readBoolean(budget.request_override_supported, true),
      supportedFields: mapStringArray(budget.supported_fields),
      trimReasonCodes: mapStringArray(budget.trim_reason_codes)
        .filter((item): item is PromptTrimReasonCode => item === "budget_exceeded"
          || item === "group_limit_exceeded"
          || item === "provider_constraint"
          || item === "policy_disabled"),
    },
    compare: {
      committedFloorsOnly: readBoolean(compare.committed_floors_only, true),
      enabled: readBoolean(compare.enabled, true),
      limitationsInsteadOfRecompute: readBoolean(compare.limitations_instead_of_recompute, true),
      mixedPreviewSupported: readBoolean(compare.mixed_preview_supported),
    },
    structure: {
      defaults: defaultsStructure,
      modes: mapPromptRuntimeStructureModes(structure.modes),
    },
    delivery: {
      defaults: defaultsDelivery,
    },
    governance: {
      branch: {
        envelopeMetadata: readBoolean(branchGovernance.envelope_metadata, true),
        materializedBranchesOnly: readBoolean(branchGovernance.materialized_branches_only, true),
        nullClearsField: readBoolean(branchGovernance.null_clears_field, true),
        objectPatch: "deep_merge",
        supportedFields: mapStringArray(branchGovernance.supported_fields).filter((item): item is PromptRuntimeGovernedPolicyField => item === "structure" || item === "delivery" || item === "budget" || item === "sourceSelection" || item === "visibility"),
      },
      session: {
        envelopeMetadata: readBoolean(sessionGovernance.envelope_metadata, true),
        nullClearsField: readBoolean(sessionGovernance.null_clears_field, true),
        objectPatch: "deep_merge",
        supportedFields: mapStringArray(sessionGovernance.supported_fields).filter((item): item is PromptRuntimeGovernedPolicyField => item === "structure" || item === "delivery" || item === "budget" || item === "sourceSelection" || item === "visibility"),
      },
    },
    sourceSelection: {
      defaults: defaultsSourceSelection,
      exclusionReasonCodes: mapStringArray(sourceSelection.exclusion_reason_codes)
        .filter((item): item is PromptSourceExclusionReasonCode => item === "disabled_by_policy"
          || item === "budget_trimmed"
          || item === "provider_constraint"
          || item === "visibility_filtered"
          || item === "not_triggered"),
      historyModes: mapStringArray(sourceSelection.history_modes).filter((item): item is "full" | "windowed" => item === "full" || item === "windowed"),
      persistentPatchSupported: readBoolean(sourceSelection.persistent_patch_supported),
      requestOverrideSupported: readBoolean(sourceSelection.request_override_supported, true),
      supportedSources: mapStringArray(sourceSelection.supported_sources)
        .filter((item): item is Extract<PromptRuntimeSourceKind, "history" | "memory" | "worldbook" | "examples"> => item === "history"
          || item === "memory"
          || item === "worldbook"
          || item === "examples"),
    },
    observability: {
      live: {
        defaultOff: readBoolean(live.default_off, true),
        enabled: readBoolean(live.enabled),
        includePromptSnapshot: readBoolean(live.include_prompt_snapshot, true),
        includeRuntimeTrace: readBoolean(live.include_runtime_trace, true),
        includeWorldbookMatches: readBoolean(live.include_worldbook_matches, true),
        requestScopedOnly: readBoolean(live.request_scoped_only, true),
        visibilityRequestSupported: readBoolean(live.visibility_request_supported),
        worldbookMatchesRequiresOptIn: readBoolean(live.worldbook_matches_requires_opt_in, true),
        worldbookMatchesRequiresRuntimeTrace: readBoolean(live.worldbook_matches_requires_runtime_trace, true),
      },
      dryRun: {
        enabled: readBoolean(dryRun.enabled),
        includeWorldbookMatches: readBoolean(dryRun.include_worldbook_matches, true),
        returnsAssembly: readBoolean(dryRun.returns_assembly, true),
        returnsRuntimeTrace: readBoolean(dryRun.returns_runtime_trace, true),
        supportsVisibility: readBoolean(dryRun.supports_visibility, true),
      },
      preview: {
        commitsSideEffects: readBoolean(preview.commits_side_effects),
        createsFloor: readBoolean(preview.creates_floor),
        enabled: readBoolean(preview.enabled),
        llmCall: readBoolean(preview.llm_call),
        returnsRuntimeTrace: readBoolean(preview.returns_runtime_trace, true),
        singleTextOnly: readBoolean(preview.single_text_only, true),
        supportsVisibility: readBoolean(preview.supports_visibility, true),
        writesPromptSnapshot: readBoolean(preview.writes_prompt_snapshot),
      },
      explain: {
        enabled: readBoolean(explain.enabled, true),
        legacyFloorFallback: readBoolean(explain.legacy_floor_fallback, true),
        persistedTruthOnly: readBoolean(explain.persisted_truth_only, true),
        readOnly: readBoolean(explain.read_only, true),
        recompute: readBoolean(explain.recompute),
        requiresCommittedFloor: readBoolean(explain.requires_committed_floor, true),
        snapshotAvailabilityField: "snapshot_available",
        snapshotSupported: readBoolean(explain.snapshot_supported, true),
      },
      stream: {
        enabled: readBoolean(stream.enabled),
        newSseEventFamily: readBoolean(stream.new_sse_event_family),
        promptDebugPayload: readPromptRuntimeStreamPromptDebugPayloadMode(stream.prompt_debug_payload),
      },
    },
    macro: {
      builtInReadOnlyValuesPersistable: readBoolean(macro.built_in_read_only_values_persistable),
      dedicatedMacrosRoute: readBoolean(macro.dedicated_macros_route),
      diagnosticsSurface: readPromptRuntimeMacroDiagnosticsSurface(macro.diagnostics_surface),
      recentMessageRespectsVisibility: readBoolean(macro.recent_message_respects_visibility, true),
      runKindPersistable: readBoolean(macro.run_kind_persistable),
      stCompatibilitySnapshotsPersistable: readBoolean(macro.st_compatibility_snapshots_persistable),
    },
    unsupported: mapStringArray(record.unsupported),
  };
}

function mapPromptRuntimePersistentPolicy(value: unknown): PromptRuntimePersistentPolicy | undefined {
  const record = readRecord(value);
  if (!record) {
    return undefined;
  }

  const structure = mapPromptRuntimePersistentStructurePolicy(record.structure);
  const delivery = mapPromptRuntimePersistentDeliveryPolicy(record.delivery);
  const budget = mapPromptRuntimeBudgetPolicy(record.budget);
  const sourceSelection = mapPromptRuntimeSourceSelectionPolicy(record.source_selection);
  const visibility = mapPromptRuntimeVisibilityPolicy(record.visibility);
  const policy: PromptRuntimePersistentPolicy = {};

  if (structure) {
    policy.structure = structure;
  }
  if (delivery) {
    policy.delivery = delivery;
  }
  if (budget) {
    policy.budget = budget;
  }
  if (sourceSelection) {
    policy.sourceSelection = sourceSelection;
  }
  if (visibility) {
    policy.visibility = visibility;
  }

  return Object.keys(policy).length > 0 ? policy : undefined;
}

function mapPromptRuntimePersistentStructurePolicy(value: unknown): PromptRuntimePersistentStructurePolicy | undefined {
  const record = readRecord(value);
  if (!record) {
    return undefined;
  }

  return {
    mode: readPromptRuntimeStructureMode(record.mode),
    ...(readPromptRuntimeAssistantRewriteStrategy(record.assistant_rewrite_strategy)
      ? { assistantRewriteStrategy: readPromptRuntimeAssistantRewriteStrategy(record.assistant_rewrite_strategy) }
      : {}),
    ...(record.merge_adjacent_same_role !== undefined
      ? { mergeAdjacentSameRole: readBoolean(record.merge_adjacent_same_role) }
      : {}),
    ...(record.preserve_system_messages !== undefined
      ? { preserveSystemMessages: readBoolean(record.preserve_system_messages) }
      : {}),
  };
}

function mapPromptRuntimePersistentDeliveryPolicy(value: unknown): PromptRuntimePersistentDeliveryPolicy | undefined {
  const record = readRecord(value);
  if (!record) {
    return undefined;
  }

  return {
    ...(record.allow_assistant_prefill !== undefined
      ? { allowAssistantPrefill: readBoolean(record.allow_assistant_prefill) }
      : {}),
    ...(record.require_last_user !== undefined
      ? { requireLastUser: readBoolean(record.require_last_user) }
      : {}),
    ...(record.no_assistant !== undefined
      ? { noAssistant: readBoolean(record.no_assistant) }
      : {}),
  };
}

function mapPromptRuntimeBudgetPolicy(value: unknown): PromptRuntimeBudgetPolicy | undefined {
  const record = readRecord(value);
  if (!record) {
    return undefined;
  }

  const policy: PromptRuntimeBudgetPolicy = {
    ...(record.max_input_tokens !== undefined ? { maxInputTokens: readNumber(record.max_input_tokens) } : {}),
    ...(record.reserved_completion_tokens !== undefined ? { reservedCompletionTokens: readNumber(record.reserved_completion_tokens) } : {}),
  };

  return Object.keys(policy).length > 0 ? policy : undefined;
}

function mapPromptRuntimeSourceSelectionPolicy(value: unknown): PromptRuntimeSourceSelectionPolicy | undefined {
  const record = readRecord(value);
  if (!record) {
    return undefined;
  }

  const history = readRecord(record.history);
  const memory = readRecord(record.memory);
  const worldbook = readRecord(record.worldbook);
  const examples = readRecord(record.examples);

  const policy: PromptRuntimeSourceSelectionPolicy = {
    ...(history ? { history: { ...(history.mode !== undefined ? { mode: readString(history.mode) as "full" | "windowed" } : {}), ...(history.max_messages !== undefined ? { maxMessages: readNumber(history.max_messages) } : {}) } } : {}),
    ...(memory ? { memory: { ...(memory.enabled !== undefined ? { enabled: readBoolean(memory.enabled) } : {}) } } : {}),
    ...(worldbook ? { worldbook: { ...(worldbook.enabled !== undefined ? { enabled: readBoolean(worldbook.enabled) } : {}) } } : {}),
    ...(examples ? { examples: { ...(examples.enabled !== undefined ? { enabled: readBoolean(examples.enabled) } : {}) } } : {}),
  };

  return Object.keys(policy).length > 0 ? policy : undefined;
}

function mapPromptRuntimeVisibilityPolicy(value: unknown): PromptRuntimeVisibilityPolicy | undefined {
  const record = readRecord(value);
  if (!record) {
    return undefined;
  }

  const mode = readOptionalString(record.mode);
  const policy: PromptRuntimeVisibilityPolicy = {
    ...(record.hidden_floor_ids !== undefined ? { hiddenFloorIds: mapStringArray(record.hidden_floor_ids) } : {}),
    ...(record.hidden_floor_ranges !== undefined
      ? {
          hiddenFloorRanges: readArray(record.hidden_floor_ranges)
            .map((item) => item && typeof item === "object" ? item as Record<string, unknown> : null)
            .filter((item): item is Record<string, unknown> => item !== null)
            .map((item) => ({ startFloorNo: readNumber(item.start_floor_no), endFloorNo: readNumber(item.end_floor_no) })),
        }
      : {}),
    ...(record.visible_floor_ranges !== undefined
      ? {
          visibleFloorRanges: readArray(record.visible_floor_ranges).map((item) => item && typeof item === "object" ? item as Record<string, unknown> : null).filter((item): item is Record<string, unknown> => item !== null).map((item) => ({ startFloorNo: readNumber(item.start_floor_no), endFloorNo: readNumber(item.end_floor_no) })),
        }
      : {}),
    ...(mode === "allow_all_except_hidden" || mode === "deny_all_except_visible"
      ? { mode }
      : {}),
  };

  return Object.keys(policy).length > 0 ? policy : undefined;
}

function mapPromptRuntimeResolvedPolicy(value: unknown): PromptRuntimeResolvedPolicy | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const structure = mapPromptRuntimeResolvedStructurePolicy(record.structure);
  const delivery = mapPromptRuntimeResolvedDeliveryPolicy(record.delivery);
  const budget = mapPromptRuntimeResolvedBudgetPolicy(record.budget);
  const sourceSelection = mapPromptRuntimeResolvedSourceSelectionPolicy(record.source_selection);
  const visibility = mapPromptRuntimeResolvedVisibilityPolicy(record.visibility);
  const debug = mapPromptRuntimeDebugPolicy(record.debug);

  if (!structure || !delivery || !budget || !sourceSelection || !visibility || !debug) {
    return null;
  }

  return {
    budget,
    debug,
    delivery,
    sourceSelection,
    visibility,
    structure,
  };
}

function mapPromptRuntimeResolvedStructurePolicy(value: unknown): PromptRuntimeResolvedStructurePolicy | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    mode: readPromptRuntimeStructureMode(record.mode),
    mergeAdjacentSameRole: readBoolean(record.merge_adjacent_same_role),
    preserveSystemMessages: readBoolean(record.preserve_system_messages, true),
    ...(readPromptRuntimeAssistantRewriteStrategy(record.assistant_rewrite_strategy)
      ? { assistantRewriteStrategy: readPromptRuntimeAssistantRewriteStrategy(record.assistant_rewrite_strategy) }
      : {}),
  };
}

function mapPromptRuntimeResolvedDeliveryPolicy(value: unknown): PromptRuntimeResolvedDeliveryPolicy | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    allowAssistantPrefill: readBoolean(record.allow_assistant_prefill, true),
    noAssistant: readBoolean(record.no_assistant),
    requireLastUser: readBoolean(record.require_last_user),
  };
}

function mapPromptRuntimeResolvedBudgetPolicy(value: unknown): PromptRuntimeResolvedBudgetPolicy | null {
  const policy = mapPromptRuntimeBudgetPolicy(value);
  return policy ?? {};
}

function mapPromptRuntimeResolvedSourceSelectionPolicy(value: unknown): PromptRuntimeResolvedSourceSelectionPolicy | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const history = readRecord(record.history);
  const memory = readRecord(record.memory);
  const worldbook = readRecord(record.worldbook);
  const examples = readRecord(record.examples);
  if (!history || !memory || !worldbook || !examples) {
    return null;
  }

  return {
    history: { mode: readString(history.mode) === "windowed" ? "windowed" : "full", ...(history.max_messages !== undefined ? { maxMessages: readNumber(history.max_messages) } : {}) },
    memory: { enabled: readBoolean(memory.enabled, true) },
    worldbook: { enabled: readBoolean(worldbook.enabled, true) },
    examples: { enabled: readBoolean(examples.enabled, true) },
  };
}

function mapPromptRuntimeResolvedVisibilityPolicy(value: unknown): PromptRuntimeResolvedVisibilityPolicy | null {
  const policy = mapPromptRuntimeVisibilityPolicy(value);
  return {
    ...(policy ?? {}),
    mode: policy?.mode === "deny_all_except_visible" ? "deny_all_except_visible" : "allow_all_except_hidden",
  };
}

function mapPromptRuntimeDebugPolicy(value: unknown): PromptRuntimeDebugPolicy | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    includePromptSnapshot: readBoolean(record.include_prompt_snapshot),
    includeRuntimeTrace: readBoolean(record.include_runtime_trace),
    includeWorldbookMatches: readBoolean(record.include_worldbook_matches),
  };
}

function mapPromptRuntimeVisibilityPolicyRequest(
  value?: PromptRuntimeVisibilityPolicy | null,
): Record<string, unknown> | null | undefined {
  if (!value) {
    if (value === null) {
      return null;
    }
    return undefined;
  }

  const mapped = compactObject({
    hidden_floor_ids: value.hiddenFloorIds,
    hidden_floor_ranges: value.hiddenFloorRanges?.map((range) => ({
      start_floor_no: range.startFloorNo,
      end_floor_no: range.endFloorNo,
    })),
    mode: value.mode,
    visible_floor_ranges: value.visibleFloorRanges?.map((range) => ({
      start_floor_no: range.startFloorNo,
      end_floor_no: range.endFloorNo,
    })),
  });

  return Object.keys(mapped).length > 0 ? mapped : undefined;
}

function mapPromptRuntimePreviewResult(value: unknown): PromptRuntimePreviewResult | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const runtimeTrace = mapPromptRuntimePreviewTracePayload(record.runtime_trace);
  if (runtimeTrace === undefined) {
    return null;
  }

  return {
    ...(record.diagnostics !== undefined ? { diagnostics: mapPromptRuntimeDiagnostics(record.diagnostics) } : {}),
    ...(record.limitations !== undefined ? { limitations: mapStringArray(record.limitations) } : {}),
    policy: mapPromptRuntimeResolvedPolicy(record.policy) ?? {
      structure: { mode: "default", mergeAdjacentSameRole: false, preserveSystemMessages: true },
      delivery: { allowAssistantPrefill: true, requireLastUser: false, noAssistant: false },
      budget: {},
      sourceSelection: { history: { mode: "full" }, memory: { enabled: true }, worldbook: { enabled: true }, examples: { enabled: true } },
      visibility: { mode: "allow_all_except_hidden" },
      debug: { includePromptSnapshot: false, includeRuntimeTrace: false, includeWorldbookMatches: false },
    },
    runtimeTrace,
    scope: mapPromptRuntimeScopeRef(record.scope) ?? { sessionId: "", targetBranchId: "main", branchExists: true, historySourceBranchId: "main", historySourceMode: "existing_branch" },
    ...(mapPromptRuntimeSourceMap(record.source_map) ? { sourceMap: mapPromptRuntimeSourceMap(record.source_map) } : {}),
    text: readString(record.text),
  };
}

function mapPromptRuntimeHistoricalExplain(value: unknown): PromptRuntimeHistoricalExplain | null {
  const record = readRecord(value);
  const floor = readRecord(record?.floor);
  const assets = readRecord(record?.assets);
  const snapshot = readRecord(record?.prompt_snapshot);
  const result = readRecord(record?.result);
  if (!record || !floor || !snapshot || !result) {
    return null;
  }

  return {
    assets: record.assets === null ? null : assets ? mapPromptRuntimeAssetsView(assets) : null,
    ...(record.diagnostics !== undefined ? { diagnostics: mapPromptRuntimeDiagnostics(record.diagnostics) } : {}),
    excludedSources: record.excluded_sources === null
      ? null
      : readArray(record.excluded_sources)
          .map((item) => readRecord(item))
          .filter((item): item is Record<string, unknown> => item !== null)
          .map((item) => ({ source: readString(item.source) as "history" | "memory" | "worldbook" | "examples", reason: readString(item.reason) as "disabled_by_policy" | "budget_trimmed" | "provider_constraint" | "visibility_filtered" | "not_triggered", ...(readOptionalString(item.detail) ? { detail: readOptionalString(item.detail) } : {}) })),
    floor: {
      branchId: readString(floor.branch_id),
      committedAt: readNumber(floor.committed_at),
      floorNo: readNumber(floor.floor_no),
      id: readString(floor.id),
      parentFloorId: readNullableString(floor.parent_floor_id),
      promptSnapshotCreatedAt: readNumber(floor.prompt_snapshot_created_at),
      sessionId: readString(floor.session_id),
      state: "committed",
    },
    ...(record.limitations !== undefined ? { limitations: mapStringArray(record.limitations) } : {}),
    promptSnapshot: {
      presetId: readNullableString(snapshot.preset_id),
      presetUpdatedAt: readNullableNumber(snapshot.preset_updated_at),
      presetVersion: readNullableNumber(snapshot.preset_version),
      worldbookId: readNullableString(snapshot.worldbook_id),
      worldbookUpdatedAt: readNullableNumber(snapshot.worldbook_updated_at),
      worldbookVersion: readNullableNumber(snapshot.worldbook_version),
      regexProfileId: readNullableString(snapshot.regex_profile_id),
      regexProfileUpdatedAt: readNullableNumber(snapshot.regex_profile_updated_at),
      regexProfileVersion: readNullableNumber(snapshot.regex_profile_version),
      worldbookActivatedEntryUids: readArray(snapshot.worldbook_activated_entry_uids).map((item) => readNumber(item)).filter((item) => Number.isFinite(item)),
      regexPreRuleNames: mapStringArray(snapshot.regex_pre_rule_names),
      regexPostRuleNames: mapStringArray(snapshot.regex_post_rule_names),
      promptMode: (readOptionalString(snapshot.prompt_mode) === "native" ? "native" : readOptionalString(snapshot.prompt_mode) === "compat_plus" ? "compat_plus" : "compat_strict"),
      promptDigest: readString(snapshot.prompt_digest),
      tokenEstimate: readNumber(snapshot.token_estimate),
    },
    resolvedPolicy: record.resolved_policy === null ? null : mapPromptRuntimeResolvedPolicy(record.resolved_policy),
    result: {
      assistantMessageId: readString(result.assistant_message_id),
      committedAt: readNumber(result.committed_at),
      generatedText: readString(result.generated_text),
      outputPageId: readString(result.output_page_id),
      summaries: mapStringArray(result.summaries),
      usage: { promptTokens: readNumber(readRecord(result.usage)?.prompt_tokens), completionTokens: readNumber(readRecord(result.usage)?.completion_tokens), totalTokens: readNumber(readRecord(result.usage)?.total_tokens) },
      ...(result.verifier !== undefined ? { verifier: readRecord(result.verifier) ? { status: readString(readRecord(result.verifier)?.status), suggestion: readNullableString(readRecord(result.verifier)?.suggestion), issues: readArray(readRecord(result.verifier)?.issues).map((item) => readRecord(item)).filter((item): item is Record<string, unknown> => item !== null).map((item) => ({ description: readString(item.description), severity: readString(item.severity) as "warning" | "error" })) } : null } : {}),
    },
    sectionStats: record.section_stats === null
      ? null
      : readArray(record.section_stats)
          .map((item) => readRecord(item))
          .filter((item): item is Record<string, unknown> => item !== null)
          .map((item) => ({ sectionName: readString(item.section_name), tokenCount: readNumber(item.token_count) })),
    snapshotAvailable: readBoolean(record.snapshot_available),
    scope: mapPromptRuntimeScopeRef(record.scope) ?? { sessionId: "", targetBranchId: "main", branchExists: true, historySourceBranchId: "main", historySourceMode: "existing_branch" },
    ...(mapPromptRuntimeSourceMap(record.source_map) ? { sourceMap: mapPromptRuntimeSourceMap(record.source_map) } : {}),
    trimReasons: record.trim_reasons === null ? null : readArray(record.trim_reasons).map((item) => readRecord(item)).filter((item): item is Record<string, unknown> => item !== null).map((item) => ({ group: readString(item.group), reason: readString(item.reason) as "budget_exceeded" | "group_limit_exceeded" | "provider_constraint" | "policy_disabled", ...(readOptionalString(item.detail) ? { detail: readOptionalString(item.detail) } : {}), ...(item.pruned_token_count !== undefined ? { prunedTokenCount: readNumber(item.pruned_token_count) } : {}) })),
  };
}

function mapPromptRuntimeExplainDiff(value: unknown): PromptRuntimeExplainDiff | null {
  const record = readRecord(value);
  const left = readRecord(record?.left);
  const right = readRecord(record?.right);
  if (!record || !left || !right) {
    return null;
  }

  return {
    assetChanges: mapPromptRuntimeDiffEntries(record.asset_changes),
    diagnosticsChanges: mapPromptRuntimeDiffEntries(record.diagnostics_changes),
    exclusionChanges: mapPromptRuntimeDiffEntries(record.exclusion_changes),
    left: {
      floorId: readString(left.floor_id),
      snapshotAvailable: readBoolean(left.snapshot_available),
    },
    limitations: mapStringArray(record.limitations),
    policyChanges: mapPromptRuntimeDiffEntries(record.policy_changes),
    right: {
      floorId: readString(right.floor_id),
      snapshotAvailable: readBoolean(right.snapshot_available),
    },
    scopeChanges: mapPromptRuntimeDiffEntries(record.scope_changes),
    trimChanges: mapPromptRuntimeDiffEntries(record.trim_changes),
  };
}

function mapPromptRuntimeDiffEntries(value: unknown): PromptRuntimeDiffEntry[] {
  return readArray(value)
    .map((item) => readRecord(item))
    .filter((item): item is Record<string, unknown> => item !== null)
    .map((item) => ({
      path: readString(item.path),
      changeType: readString(item.change_type, "changed") === "added"
        ? "added"
        : readString(item.change_type, "changed") === "removed"
          ? "removed"
          : "changed",
      ...(item.left !== undefined ? { left: item.left } : {}),
      ...(item.right !== undefined ? { right: item.right } : {}),
    }));
}


function mapPromptRuntimeSourceMap(value: unknown): PromptRuntimeSourceMap | undefined {
  const record = readRecord(value);
  if (!record) {
    return undefined;
  }

  const sourceMap: PromptRuntimeSourceMap = {};
  const structure = readRecord(record.structure);
  const budget = readRecord(record.budget);
  const delivery = readRecord(record.delivery);
  const debug = readRecord(record.debug);
  const sourceSelection = readRecord(record.source_selection);

  if (structure) {
    const structureMap: NonNullable<PromptRuntimeSourceMap["structure"]> = {};
    const mode = readPromptRuntimePolicySource(structure.mode);
    const mergeAdjacentSameRole = readPromptRuntimePolicySource(structure.merge_adjacent_same_role);
    const preserveSystemMessages = readPromptRuntimePolicySource(structure.preserve_system_messages);
    const assistantRewriteStrategy = readPromptRuntimePolicySource(structure.assistant_rewrite_strategy);

    if (mode) {
      structureMap.mode = mode;
    }
    if (mergeAdjacentSameRole) {
      structureMap.mergeAdjacentSameRole = mergeAdjacentSameRole;
    }
    if (preserveSystemMessages) {
      structureMap.preserveSystemMessages = preserveSystemMessages;
    }
    if (assistantRewriteStrategy) {
      structureMap.assistantRewriteStrategy = assistantRewriteStrategy;
    }
    if (Object.keys(structureMap).length > 0) {
      sourceMap.structure = structureMap;
    }
  }

  if (delivery) {
    const deliveryMap: NonNullable<PromptRuntimeSourceMap["delivery"]> = {};
    const allowAssistantPrefill = readPromptRuntimePolicySource(delivery.allow_assistant_prefill);
    const requireLastUser = readPromptRuntimePolicySource(delivery.require_last_user);
    const noAssistant = readPromptRuntimePolicySource(delivery.no_assistant);

    if (allowAssistantPrefill) {
      deliveryMap.allowAssistantPrefill = allowAssistantPrefill;
    }
    if (requireLastUser) {
      deliveryMap.requireLastUser = requireLastUser;
    }
    if (noAssistant) {
      deliveryMap.noAssistant = noAssistant;
    }
    if (Object.keys(deliveryMap).length > 0) {
      sourceMap.delivery = deliveryMap;
    }
  }

  if (budget) {
    const budgetMap: NonNullable<PromptRuntimeSourceMap["budget"]> = {};
    const maxInputTokens = readPromptRuntimePolicySource(budget.max_input_tokens);
    const reservedCompletionTokens = readPromptRuntimePolicySource(budget.reserved_completion_tokens);
    if (maxInputTokens) {
      budgetMap.maxInputTokens = maxInputTokens;
    }
    if (reservedCompletionTokens) {
      budgetMap.reservedCompletionTokens = reservedCompletionTokens;
    }
    if (Object.keys(budgetMap).length > 0) {
      sourceMap.budget = budgetMap;
    }
  }

  if (sourceSelection) {
    const sourceSelectionMap: NonNullable<PromptRuntimeSourceMap["sourceSelection"]> = {};
    const history = readRecord(sourceSelection.history);
    const memory = readRecord(sourceSelection.memory);
    const worldbook = readRecord(sourceSelection.worldbook);
    const examples = readRecord(sourceSelection.examples);
    if (history) {
      sourceSelectionMap.history = {
        ...(readPromptRuntimePolicySource(history.mode) ? { mode: readPromptRuntimePolicySource(history.mode) } : {}),
        ...(readPromptRuntimePolicySource(history.max_messages) ? { maxMessages: readPromptRuntimePolicySource(history.max_messages) } : {}),
      };
    }
    if (memory) sourceSelectionMap.memory = { ...(readPromptRuntimePolicySource(memory.enabled) ? { enabled: readPromptRuntimePolicySource(memory.enabled) } : {}) };
    if (worldbook) sourceSelectionMap.worldbook = { ...(readPromptRuntimePolicySource(worldbook.enabled) ? { enabled: readPromptRuntimePolicySource(worldbook.enabled) } : {}) };
    if (examples) sourceSelectionMap.examples = { ...(readPromptRuntimePolicySource(examples.enabled) ? { enabled: readPromptRuntimePolicySource(examples.enabled) } : {}) };
    if (Object.keys(sourceSelectionMap).length > 0) {
      sourceMap.sourceSelection = sourceSelectionMap;
    }
  }

  if (debug) {
    const debugMap: NonNullable<PromptRuntimeSourceMap["debug"]> = {};
    const includePromptSnapshot = readPromptRuntimePolicySource(debug.include_prompt_snapshot);
    const includeRuntimeTrace = readPromptRuntimePolicySource(debug.include_runtime_trace);
    const includeWorldbookMatches = readPromptRuntimePolicySource(debug.include_worldbook_matches);

    if (includePromptSnapshot) {
      debugMap.includePromptSnapshot = includePromptSnapshot;
    }
    if (includeRuntimeTrace) {
      debugMap.includeRuntimeTrace = includeRuntimeTrace;
    }
    if (includeWorldbookMatches) {
      debugMap.includeWorldbookMatches = includeWorldbookMatches;
    }
    if (Object.keys(debugMap).length > 0) {
      sourceMap.debug = debugMap;
    }
  }

  const visibility = readRecord(record.visibility);
  if (visibility) {
    const visibilityMap: NonNullable<PromptRuntimeSourceMap["visibility"]> = {};
    if (readPromptRuntimePolicySource(visibility.hidden_floor_ids)) visibilityMap.hiddenFloorIds = readPromptRuntimePolicySource(visibility.hidden_floor_ids);
    if (readPromptRuntimePolicySource(visibility.hidden_floor_ranges)) visibilityMap.hiddenFloorRanges = readPromptRuntimePolicySource(visibility.hidden_floor_ranges);
    if (readPromptRuntimePolicySource(visibility.visible_floor_ranges)) visibilityMap.visibleFloorRanges = readPromptRuntimePolicySource(visibility.visible_floor_ranges);
    if (readPromptRuntimePolicySource(visibility.mode)) visibilityMap.mode = readPromptRuntimePolicySource(visibility.mode);
    if (Object.keys(visibilityMap).length > 0) sourceMap.visibility = visibilityMap;
  }

  const history = readRecord(record.history);
  if (history) {
    const historyMap: NonNullable<PromptRuntimeSourceMap["history"]> = {};
    const sourceBranchId = readOptionalString(history.source_branch_id);
    const sourceMode = readOptionalString(history.source_mode);
    if (sourceBranchId) historyMap.sourceBranchId = sourceBranchId;
    if (sourceMode === "existing_branch" || sourceMode === "source_floor_branch" || sourceMode === "main_fallback") historyMap.sourceMode = sourceMode;
    if (Object.keys(historyMap).length > 0) sourceMap.history = historyMap;
  }

  return Object.keys(sourceMap).length > 0 ? sourceMap : undefined;
}

function mapPromptRuntimeAssetsView(value: unknown): PromptRuntimeAssetsView | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    characterCard: mapPromptRuntimeAssetSummary(record.character_card),
    preset: mapPromptRuntimeAssetSummary(record.preset),
    regexProfile: mapPromptRuntimeAssetSummary(record.regex_profile),
    worldbook: mapPromptRuntimeAssetSummary(record.worldbook),
  };
}

function mapPromptRuntimeAssetSummary(value: unknown): PromptRuntimeAssetSummary | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    id: readString(record.id),
    name: typeof record.name === "string" ? record.name : null,
  };
}

function mapPromptRuntimePersistentStructurePolicyRequest(
  value: PromptRuntimePersistentStructurePolicy | null | undefined,
): Record<string, unknown> | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }

  return compactObject({
    assistant_rewrite_strategy: value.assistantRewriteStrategy,
    merge_adjacent_same_role: value.mergeAdjacentSameRole,
    mode: value.mode,
    preserve_system_messages: value.preserveSystemMessages,
  });
}

function mapPromptRuntimePersistentDeliveryPolicyRequest(
  value: PromptRuntimePersistentDeliveryPolicy | null | undefined,
): Record<string, unknown> | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }

  return compactObject({
    allow_assistant_prefill: value.allowAssistantPrefill,
    no_assistant: value.noAssistant,
    require_last_user: value.requireLastUser,
  });
}

function mapPromptRuntimeBudgetPolicyRequest(
  value?: PromptRuntimeBudgetPolicy | null,
): Record<string, unknown> | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }

  const mapped = compactObject({
    max_input_tokens: value.maxInputTokens,
    reserved_completion_tokens: value.reservedCompletionTokens,
  });

  return Object.keys(mapped).length > 0 ? mapped : undefined;
}

function mapPromptRuntimeSourceSelectionPolicyRequest(
  value?: PromptRuntimeSourceSelectionPolicy | null,
): Record<string, unknown> | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }

  const mapped = compactObject({
    history: value.history ? compactObject({ mode: value.history.mode, max_messages: value.history.maxMessages }) : undefined,
    memory: value.memory ? compactObject({ enabled: value.memory.enabled }) : undefined,
    worldbook: value.worldbook ? compactObject({ enabled: value.worldbook.enabled }) : undefined,
    examples: value.examples ? compactObject({ enabled: value.examples.enabled }) : undefined,
  });
  return Object.keys(mapped).length > 0 ? mapped : undefined;
}

function mapPromptRuntimeStructureModes(value: unknown): PromptRuntimeStructureMode[] {
  return readArray(value)
    .map((item) => readOptionalString(item))
    .filter((item): item is PromptRuntimeStructureMode => isPromptRuntimeStructureMode(item));
}

function mapStringArray(value: unknown): string[] {
  return readArray(value)
    .map((item) => readOptionalString(item))
    .filter((item): item is string => item !== undefined);
}

function readPromptRuntimeStructureMode(value: unknown): PromptRuntimeStructureMode {
  const mode = readString(value, "default");
  return isPromptRuntimeStructureMode(mode) ? mode : "default";
}

function readPromptRuntimeAssistantRewriteStrategy(
  value: unknown,
): PromptRuntimeAssistantRewriteStrategy | undefined {
  const strategy = readOptionalString(value);
  return strategy === "to_system" || strategy === "to_user_transcript" ? strategy : undefined;
}

function readPromptRuntimePolicySource(value: unknown): PromptRuntimePolicySource | undefined {
  const source = readOptionalString(value);
  switch (source) {
    case "system_default":
    case "asset_default":
    case "session_policy":
    case "branch_policy":
    case "request_override":
    case "provider_constraint":
      return source;
    default:
      return undefined;
  }
}

function readPromptRuntimeStreamPromptDebugPayloadMode(
  value: unknown,
): PromptRuntimeStreamPromptDebugPayloadMode {
  const mode = readString(value, "unsupported");
  return mode === "done_only" ? "done_only" : "unsupported";
}

function readPromptRuntimeMacroDiagnosticsSurface(
  value: unknown,
): PromptRuntimeMacroDiagnosticsSurface {
  return readString(value, "unified_observability") === "unified_observability"
    ? "unified_observability"
    : "unified_observability";
}

function isPromptRuntimeStructureMode(value: string | undefined): value is PromptRuntimeStructureMode {
  return value === "default" || value === "strict_alternating" || value === "no_assistant" || value === "flattened";
}

function mapPromptRuntimeScopeRef(value: unknown): PromptRuntimeScopeRef | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return {
    branchExists: readBoolean(record.branch_exists),
    historySourceBranchId: readString(record.history_source_branch_id),
    historySourceMode: (readOptionalString(record.history_source_mode) === "source_floor_branch"
      ? "source_floor_branch"
      : readOptionalString(record.history_source_mode) === "main_fallback"
        ? "main_fallback"
        : "existing_branch"),
    sessionId: readString(record.session_id),
    ...(record.source_floor_id !== undefined ? { sourceFloorId: readOptionalString(record.source_floor_id) ?? null } : {}),
    targetBranchId: readString(record.target_branch_id),
  };
}

function mapPromptRuntimeDiagnostics(value: unknown): PromptRuntimeDiagnostic[] {
  return readArray(value)
    .map((item) => {
      const record = readRecord(item);
      if (!record) {
        return null;
      }

      return {
        code: readString(record.code),
        message: readString(record.message),
        severity: readOptionalString(record.severity) === "error" ? "error" : readOptionalString(record.severity) === "info" ? "info" : "warning",
        ...(readOptionalString(record.source) ? { source: readOptionalString(record.source) as PromptRuntimeDiagnosticSource } : {}),
        ...(readOptionalString(record.field_path) ? { fieldPath: readOptionalString(record.field_path) } : {}),
        ...(readOptionalString(record.phase) ? { phase: readOptionalString(record.phase) as PromptRuntimeDiagnosticPhase } : {}),
      } satisfies PromptRuntimeDiagnostic;
    })
    .filter((item): item is PromptRuntimeDiagnostic => item !== null);
}
