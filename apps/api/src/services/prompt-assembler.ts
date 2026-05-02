import { createHash } from "node:crypto";

import { normalizePositiveInt } from "../lib/utils.js";
import { parseSessionCharacterSnapshot, type SessionCharacterSnapshot } from "../lib/character-snapshot.js";
import {
  buildPromptRuntimeGovernanceSeed,
  compilePromptGraph,
  MessageBuilder,
  type ChatMessage,
  type MemoryInjectionResult,
  type PromptRunIntent,
  type PromptGraphWorldbookEntry,
  type PromptSnapshotWorldbookActivation,
  type PromptSnapshotRecord,
  type PromptRuntimeBudgetTrace as CorePromptRuntimeBudgetTrace,
  type PromptRuntimeDeliveryDegradeReason,
  type PromptRuntimeDeliveryTrace as CorePromptRuntimeDeliveryTrace,
  type PromptRuntimeMemoryTrace as CorePromptRuntimeMemoryTrace,
  type PromptRuntimePresetTrace as CorePromptRuntimePresetTrace,
  type PromptRuntimeStructureTrace as CorePromptRuntimeStructureTrace,
  type PromptSourceExclusionReason as CorePromptSourceExclusionReason,
  type PromptRuntimeSourceSelectionTrace as CorePromptRuntimeSourceSelectionTrace,
  type PromptTrimReason as CorePromptTrimReason,
  type PromptRuntimeTrace as CorePromptRuntimeTrace,
  type PromptRuntimeGovernanceSeed as CorePromptRuntimeGovernanceSeed,
  type PromptRuntimeVisibilityTrace as CorePromptRuntimeVisibilityTrace,
  type PromptRuntimeWorldbookTrace as CorePromptRuntimeWorldbookTrace,
  type TokenCounter,
} from "@tavern/core";
import {
  assembleCompat,
  assembleCompatPlus,
  buildImportedPresetPromptGraph,
  parseWorldBook,
  type ActivationTrace,
  type TriggerContext,
  type TriggerFirstMatch,
  type TriggerMatchSourceKind,
  type TriggerResult,
  triggerWorldBook,
  REGEX_PLACEMENT,
  type STRegexScript,
  type STWorldBook,
  type STWorldBookEntry,
} from "@tavern/adapters-sillytavern";

import type { AppDb } from "../db/client.js";
import type { PromptRuntimeHistoryNormalizationSummary } from "./chat/conversation-history-normalizer.js";
import {
  PromptResourceLoader,
  type LoadedPromptPreset,
  type LoadedPromptRegexProfile,
  type LoadedPromptWorldbook,
} from "./prompt-resource-loader.js";
import { VariableService } from "./variables/variable-service.js";
import {
  type StMacroEvalResult,
  type StMacroJsonValue,
  type StMacroMutationPreview,
  type StMacroStagedMutation,
  type StMacroTraceEntry,
  type StMacroVariableSnapshot,
  type StMacroWarning,
} from "./st-macros/index.js";
import { stringifyStMacroValue } from "./st-macros/variable-path.js";
import {
  buildStMacroValues as buildStMacroValuesFromContextBuilder,
  buildVisibleRecentMacroMessages as buildVisibleRecentMacroMessagesFromContextBuilder,
  buildPromptRuntimeMacroTrace as buildPromptRuntimeMacroTraceFromProjector,
  evaluatePromptMacroValues as evaluatePromptMacroValuesFromFacade,
  shouldIncludeCurrentUserMessageInRecentMacros as shouldIncludeCurrentUserMessageInRecentMacrosFromContextBuilder,
} from "./prompt-runtime/macro/index.js";
import {
  buildPromptRuntimeRegexTrace,
  buildRegexSubstitutionContext,
  buildReservedWorldInfoRegexPhase,
  collectRegexRuleNames as collectRegexRuleNamesFromSupportMatrix,
  createRegexMacroSubstituter as createRegexMacroSubstituterFromFacade,
  executePromptRuntimeRegexPhase,
  listRuntimeRegexReservedPlacements,
  PROMPT_RUNTIME_REGEX_SUBSTITUTION_MODE,
  type PromptRuntimeRegexPhaseRuntimeResult,
} from "./prompt-runtime/regex/index.js";
import { buildPromptRuntimeMemoryTrace } from "./memory/shared/index.js";

import {
  resolvePromptSourceGates,
  applyMemorySourceGate,
  type PromptSourceResolution,
} from "./prompt-runtime-source-resolution.js";
import { buildPromptAssetManifestForAssembly } from "./prompt-assets/index.js";
import {
  buildCharacterBookAssetScopeId,
  buildSessionWorldbookAssetScopeId,
  buildWorldbookActivationKey,
} from "./prompt-assets/worldbook/index.js";

export interface SessionPromptInfo {
  presetId: string | null;
  worldbookProfileId: string | null;
  regexProfileId: string | null;
  metadataJson: string | null;
  characterSnapshotJson: string | null;
  characterId?: string | null;
  characterVersionId?: string | null;
  promptMode?: PromptMode | null;
  userSnapshotJson?: string | null;
}

export type PromptMode = "compat_strict" | "compat_plus" | "native";

export type PromptMacroRunKind = "dry_run" | "respond" | "regenerate" | "retry";
export type CharacterSnapshot = SessionCharacterSnapshot;

export interface PersonaInfo {
  name?: string;
  description?: string;
}

export interface UserSnapshot {
  name?: string;
  description?: string;
}

export interface SessionMetadata {
  persona?: PersonaInfo;
  promptMode?: PromptMode;
  prompt_mode?: PromptMode;
  model?: string;
  [key: string]: unknown;
}

const RESERVED_PROMPT_ALIAS_KEYS = ["char", "user"] as const;
type ReservedPromptAlias = (typeof RESERVED_PROMPT_ALIAS_KEYS)[number];

/**
 * Assembly-phase snapshot preview.
 *
 * Records what actually entered the prompt assembly step: preset / worldbook / regex provenance,
 * activated worldbook entries, applied regex rule names, prompt mode, digest, and token estimate.
 *
 * This is NOT a delivery-phase snapshot. It does not describe materialized send messages, structure
 * merges, assistant-prefill rewrites, or final delivery trace. Those belong to delivery-phase
 * artifacts (for example `materializePromptRuntimeMessages` output and turn outcome records).
 *
 * Persisted into the `prompt_snapshot` table by `turn-commit-service` after a floor commits.
 */
export interface PromptSnapshotPreview {
  presetId: string | null;
  presetUpdatedAt: number | null;
  presetVersion: number | null;
  worldbookId: string | null;
  worldbookUpdatedAt: number | null;
  worldbookVersion: number | null;
  regexProfileId: string | null;
  regexProfileUpdatedAt: number | null;
  regexProfileVersion: number | null;
  characterId?: string | null;
  characterVersionId?: string | null;
  characterImportedFormat?: string | null;
  characterContentHash?: string | null;
  worldbookActivatedEntryUids: number[];
  worldbookActivatedEntries?: PromptSnapshotWorldbookActivation[];
  regexPreRuleNames: string[];
  regexPostRuleNames: string[];
  promptMode: PromptMode;
  assetManifestDigest?: string | null;
  promptDigest: string;
  tokenEstimate: number;
}

/**
 * Full assembly-phase snapshot carried within one run.
 *
 * Extends {@link PromptSnapshotPreview} with the raw resources that assembled the prompt.
 * Consumed in-memory; only the preview subset is persisted.
 *
 * Phase: `assembly` — records what went INTO prompt assembly, not what was sent to the provider.
 */
export interface PromptAssemblySnapshot extends PromptSnapshotPreview {
  createdAt: number;
  preset: LoadedPromptPreset | null;
  worldbook: LoadedPromptWorldbook | null;
  regexProfile: LoadedPromptRegexProfile | null;
  metadata: SessionMetadata;
  character?: CharacterSnapshot;
  userSnapshot?: UserSnapshot;
  persona?: PersonaInfo;
  characterId: string | null;
  characterVersionId: string | null;
  characterImportedFormat: string | null;
  characterContentHash: string | null;
  worldbookActivatedEntries: PromptSnapshotWorldbookActivation[];
  assetManifestDigest: string | null;
  variables: Record<string, unknown>;
}

export interface WorldbookMatchSource {
  kind: "session_worldbook" | "character_book";
  worldbookId: string | null;
  worldbookName: string;
  assetScopeId: string;
}

export interface WorldbookMatchInsertion {
  position:
    | "before"
    | "after"
    | "an_top"
    | "an_bottom"
    | "em_top"
    | "em_bottom"
    | "at_depth"
    | "outlet";
  depth?: number;
  role?: ChatMessage["role"];
  outletName?: string;
}

export interface WorldbookFirstMatch {
  sourceKind: TriggerMatchSourceKind;
  messageIndexFromLatest?: number;
  injectionIndex?: number;
  matchedKey: string;
  matchedKeyScope: "primary" | "secondary";
  matchedKeyType: "plain" | "regex";
  charStart: number;
  charEnd: number;
  excerpt: string;
}

export interface WorldbookMatchActivation {
  mode: "constant" | "triggered";
  recursionLevel: number;
  firstMatch: WorldbookFirstMatch | null;
}

export interface WorldbookMatchDetail {
  uid: number;
  activationKey: string;
  assetScopeId: string;
  comment: string;
  contentPreview: string;
  order: number;
  source: WorldbookMatchSource;
  insertion: WorldbookMatchInsertion;
  activation: WorldbookMatchActivation;
}

interface SourcedWorldbook {
  worldbook: STWorldBook;
  source: WorldbookMatchSource;
}

interface PromptWorldbookEntryActivation {
  entry: STWorldBookEntry;
  activationKey: string;
  source: WorldbookMatchSource;
  activation?: ActivationTrace;
}

interface PromptWorldbookDepthActivation {
  activation: PromptWorldbookEntryActivation;
  depth: number;
  role: number;
}

interface PromptWorldbookTriggerResult extends TriggerResult {
  activatedDetails: PromptWorldbookEntryActivation[];
  beforeDetails: PromptWorldbookEntryActivation[];
  afterDetails: PromptWorldbookEntryActivation[];
  anTopDetails: PromptWorldbookEntryActivation[];
  anBottomDetails: PromptWorldbookEntryActivation[];
  emTopDetails: PromptWorldbookEntryActivation[];
  emBottomDetails: PromptWorldbookEntryActivation[];
  atDepthDetails: PromptWorldbookDepthActivation[];
  outletEntryDetails: Record<string, PromptWorldbookEntryActivation[]>;
}

export interface PromptVariableContextInput {
  sessionId: string;
  branchId?: string;
  floorId?: string;
  pageId?: string;
}

export interface PromptSendDirectives {
  assistantPrefill?: string;
}

export type AssistantPrefillExecutionStrategy =
  | "provider_native"
  | "assistant_message_fallback"
  | "transcript_append"
  | "unsupported"
  | "none";

export type PromptRuntimePresetTrace = CorePromptRuntimePresetTrace;

export type PromptRuntimeWorldbookTrace = CorePromptRuntimeWorldbookTrace<WorldbookMatchDetail>;

export type PromptRuntimeRegexPhaseId =
  | "persist.user_input"
  | "prompt.user_input"
  | "persist.ai_output"
  | "prompt.world_info.reserved";

export type PromptRuntimeRegexPhaseStatus = "executed" | "reserved";

export type PromptRuntimeRegexSkipReason =
  | "channel_filtered"
  | "depth_filtered"
  | "invalid_regex"
  | "no_match"
  | "reserved_non_executable";

export type PromptRuntimeRegexSubstitutionMode = "bare_variable_only";

export interface PromptRuntimeRegexSkippedRule {
  ruleName: string;
  reason: PromptRuntimeRegexSkipReason;
}

export interface PromptRuntimeRegexPhaseTrace {
  phaseId: PromptRuntimeRegexPhaseId;
  placement: number;
  channel: "persist" | "prompt" | "display" | "edit" | null;
  status: PromptRuntimeRegexPhaseStatus;
  changed: boolean;
  depth: number | null;
  inputTextHash: string | null;
  outputTextHash: string | null;
  candidateRuleNames: string[];
  matchedRuleNames: string[];
  skippedRules: PromptRuntimeRegexSkippedRule[];
}

export interface PromptRuntimeRegexTrace {
  userInputRules: string[];
  aiOutputRules: string[];
  preprocessedUserMessage?: string;
  phases?: PromptRuntimeRegexPhaseTrace[];
  reservedPlacements?: number[];
  substitutionMode?: PromptRuntimeRegexSubstitutionMode;
}

export type PromptRuntimeBudgetTrace = CorePromptRuntimeBudgetTrace;

export type PromptRuntimeMemoryTrace = CorePromptRuntimeMemoryTrace;

export type PromptTrimReason = CorePromptTrimReason;

export type PromptSourceExclusionReason = CorePromptSourceExclusionReason;

export type PromptRuntimeSourceSelectionTrace = CorePromptRuntimeSourceSelectionTrace;

export type PromptRuntimeGovernanceSeed = CorePromptRuntimeGovernanceSeed;

export type PromptStructureMode = "default" | "strict_alternating" | "no_assistant" | "flattened";

export type PromptStructureAssistantRewriteStrategy = "to_system" | "to_user_transcript";

export interface PromptStructurePolicy {
  mode: PromptStructureMode;
  mergeAdjacentSameRole?: boolean;
  assistantRewriteStrategy?: PromptStructureAssistantRewriteStrategy;
  preserveSystemMessages?: boolean;
}

export type PromptRuntimeStructureTrace = CorePromptRuntimeStructureTrace;

export interface PromptDeliveryPolicy {
  allowAssistantPrefill?: boolean;
  requireLastUser?: boolean;
  noAssistant?: boolean;
}

export interface PromptBudgetPolicy {
  maxInputTokens?: number;
  reservedCompletionTokens?: number;
}

export interface PromptBudgetGroupPolicy {
  group: string;
  minTokens?: number;
  maxTokens?: number;
  targetTokens?: number;
  weight?: number;
  pruneOrder?: number;
}

export interface PromptBudgetPolicyV5 extends PromptBudgetPolicy {
  groups?: PromptBudgetGroupPolicy[];
}

export interface EffectivePromptBudget {
  maxInputTokens: number;
  reservedCompletionTokens: number;
}

export interface PromptSourceSelectionPolicy {
  history?: { mode?: "full" | "windowed"; maxMessages?: number };
  memory?: { enabled?: boolean };
  worldbook?: { enabled?: boolean };
  examples?: { enabled?: boolean };
}

export type PromptDeliveryDegradeReason = PromptRuntimeDeliveryDegradeReason;

export type PromptRuntimeDeliveryTrace = CorePromptRuntimeDeliveryTrace;

export type PromptRuntimeVisibilityTrace = CorePromptRuntimeVisibilityTrace;

export interface PromptRuntimeMacroTrace {
  warnings: Array<{
    code: string;
    message: string;
    macroName?: string;
    rawText?: string;
  }>;
  usedNames: string[];
  mutationPreview: Array<{
    kind: "set" | "delete";
    scope: "branch" | "global";
    key: string;
    value?: string;
  }>;
  stagedMutations: Array<{
    kind: "set" | "delete";
    scope: "branch" | "global";
    key: string;
    value?: string;
    sourceMacro: string;
  }>;
  traces: Array<{
    macroName: string;
    rawText: string;
    resolvedText: string;
    phase?: string;
    sourceKind?: string;
    selectedBranch?: string;
  }>;
}

export interface PromptRuntimeTrace extends CorePromptRuntimeTrace<WorldbookMatchDetail> {
  regex?: PromptRuntimeRegexTrace;
  macro?: PromptRuntimeMacroTrace;
  historyNormalization?: PromptRuntimeHistoryNormalizationSummary;
}

export type PromptRuntimePreviewTrace = Pick<PromptRuntimeTrace, "macro" | "sourceSelection" | "visibility" | "historyNormalization">;

export interface PromptRuntimeTraceSeed {
  worldbookHits: number;
  regexPreRules: string[];
  regexPostRules: string[];
  memoryRuntimeTrace?: Omit<CorePromptRuntimeMemoryTrace, "summaryInjected">;
  memorySummaryInjected: boolean;
  selectedPromptOrderCharacterId: number | null;
  ignoredPromptOrderCharacterIds: number[];
  unsupportedPresetFields: string[];
  ignoredPresetFields: string[];
  unresolvedPresetMarkers: string[];
  presetWarnings: string[];
  continueNudgeApplied: boolean;
  continueNudgeText?: string;
  namesBehaviorApplied: "off" | "always";
  triggerFilteredEntryIds: string[];
  inChatInsertedEntryIds: string[];
  worldbookMatches?: WorldbookMatchDetail[];
  regexPhases?: PromptRuntimeRegexTrace["phases"];
  regexReservedPlacements?: PromptRuntimeRegexTrace["reservedPlacements"];
  regexSubstitutionMode?: PromptRuntimeRegexTrace["substitutionMode"];
  regexPromptUserInputText?: string;
  macroWarnings?: StMacroWarning[];
  macroUsedNames?: string[];
  macroMutationPreview?: StMacroMutationPreview[];
  macroStagedMutations?: StMacroStagedMutation[];
  macroTraces?: StMacroTraceEntry[];
}

export interface PromptAssemblyCompatSeed {
  mode: "preset" | "fallback";
  promptIntent: PromptRunIntent;
  assistantPrefillApplied: boolean;
  assistantPrefillStrategy: AssistantPrefillExecutionStrategy;
  presetUsed: boolean;
  reservedVariableCollisions: ReservedPromptAlias[];
}

export interface AssembleDebugInfo extends PromptRuntimeTraceSeed, PromptAssemblyCompatSeed {}

export interface AssembleResult {
  messages: ChatMessage[];
  sendDirectives: PromptSendDirectives;
  preProcess?: (messages: ChatMessage[]) => ChatMessage[];
  postProcess?: (text: string) => string;
  tokenUsage: {
    total: number;
    availableForReply: number;
    bySection?: Record<string, number>;
    byGroup?: Record<string, number>;
    prunedByGroup?: Record<string, number>;
    allocator?: {
      estimatedByGroup: Record<string, number>;
      allocatedByGroup: Record<string, number>;
      trimReasons: PromptTrimReason[];
    };
  };
  runtimeTraceSeed: PromptRuntimeTraceSeed;
  assemblyCompatSeed: PromptAssemblyCompatSeed;
  governance?: PromptRuntimeGovernanceSeed;
  debug?: AssembleDebugInfo;
  promptSnapshot: PromptAssemblySnapshot;
}

/**
 * dry-run 对外 `assembly` 兼容层。
 *
 * 这层继续保留既有 preset / dry-run 摘要字段，供旧调用方和调试面读取。
 * 如果同一事实已经在 `runtimeTrace` 中以更结构化的形式出现，应优先消费 `runtimeTrace`。
 */
export interface PromptAssemblyCompat {
  mode: "preset" | "fallback";
  promptIntent: PromptRunIntent;
  assistantPrefillApplied: boolean;
  assistantPrefillStrategy: AssistantPrefillExecutionStrategy;
  presetUsed: boolean;
  worldbookHits: number;
  regexPreRules: string[];
  regexPostRules: string[];
  memorySummaryInjected: boolean;
  reservedVariableCollisions: ReservedPromptAlias[];
  selectedPromptOrderCharacterId: number | null;
  ignoredPromptOrderCharacterIds: number[];
  unsupportedPresetFields: string[];
  ignoredPresetFields: string[];
  unresolvedPresetMarkers: string[];
  presetWarnings: string[];
  continueNudgeApplied: boolean;
  continueNudgeText?: string;
  namesBehaviorApplied: "off" | "always";
  triggerFilteredEntryIds: string[];
  inChatInsertedEntryIds: string[];
  preprocessedUserMessage?: string;
  worldbookMatches?: WorldbookMatchDetail[];
}

export function buildPromptAssemblyCompat(args: {
  compatSeed: PromptAssemblyCompatSeed;
  traceSeed: PromptRuntimeTraceSeed;
  preprocessedUserMessage?: string;
  runtimeTrace?: PromptRuntimeTrace;
}): PromptAssemblyCompat {
  const preset = args.runtimeTrace?.preset;
  const worldbook = args.runtimeTrace?.worldbook;
  const regex = args.runtimeTrace?.regex;
  const memory = args.runtimeTrace?.memory;
  const delivery = args.runtimeTrace?.delivery;

  return {
    mode: args.compatSeed.mode,
    promptIntent: args.compatSeed.promptIntent,
    assistantPrefillApplied: delivery?.assistantPrefillApplied ?? args.compatSeed.assistantPrefillApplied,
    assistantPrefillStrategy: delivery?.assistantPrefillStrategy ?? args.compatSeed.assistantPrefillStrategy,
    presetUsed: args.compatSeed.presetUsed,
    worldbookHits: worldbook?.hitCount ?? args.traceSeed.worldbookHits,
    regexPreRules: regex?.userInputRules ?? args.traceSeed.regexPreRules,
    regexPostRules: regex?.aiOutputRules ?? args.traceSeed.regexPostRules,
    memorySummaryInjected: memory?.summaryInjected ?? args.traceSeed.memorySummaryInjected,
    reservedVariableCollisions: args.compatSeed.reservedVariableCollisions,
    selectedPromptOrderCharacterId: preset?.selectedPromptOrderCharacterId ?? args.traceSeed.selectedPromptOrderCharacterId,
    ignoredPromptOrderCharacterIds: preset?.ignoredPromptOrderCharacterIds ?? args.traceSeed.ignoredPromptOrderCharacterIds,
    unsupportedPresetFields: preset?.unsupportedFields ?? args.traceSeed.unsupportedPresetFields,
    ignoredPresetFields: preset?.ignoredFields ?? args.traceSeed.ignoredPresetFields,
    unresolvedPresetMarkers: preset?.unresolvedMarkers ?? args.traceSeed.unresolvedPresetMarkers,
    presetWarnings: preset?.warnings ?? args.traceSeed.presetWarnings,
    continueNudgeApplied: preset?.continueNudgeApplied ?? args.traceSeed.continueNudgeApplied,
    continueNudgeText: preset?.continueNudgeText ?? args.traceSeed.continueNudgeText,
    namesBehaviorApplied: preset?.namesBehaviorApplied ?? args.traceSeed.namesBehaviorApplied,
    triggerFilteredEntryIds: preset?.triggerFilteredEntryIds ?? args.traceSeed.triggerFilteredEntryIds,
    inChatInsertedEntryIds: preset?.inChatInsertedEntryIds ?? args.traceSeed.inChatInsertedEntryIds,
    preprocessedUserMessage: regex?.preprocessedUserMessage ?? args.preprocessedUserMessage,
    ...(worldbook?.matches !== undefined
      ? { worldbookMatches: worldbook.matches }
      : args.traceSeed.worldbookMatches !== undefined
        ? { worldbookMatches: args.traceSeed.worldbookMatches }
        : {}),
  };
}

export interface AssemblePromptOptions {
  includeDebug?: boolean;
  maxContextTokensOverride?: number;
  maxOutputTokensOverride?: number;
  variableContext?: PromptVariableContextInput;
  intent?: PromptRunIntent;
  assistantPrefillStrategy?: AssistantPrefillExecutionStrategy;
  includeWorldbookMatchTrace?: boolean;
  runKind?: PromptMacroRunKind;
  budget?: PromptBudgetPolicyV5;
  sourceSelection?: PromptSourceSelectionPolicy;
  memoryRuntimeTrace?: Omit<CorePromptRuntimeMemoryTrace, "summaryInjected">;
}

const DEFAULT_SYSTEM_PROMPT = "You are a helpful assistant.";
const DEFAULT_MAX_TOKENS = 1000;

export function resolveEffectivePromptBudget(args: {
  budget?: PromptBudgetPolicy;
  maxContextTokensOverride?: number;
  maxOutputTokensOverride?: number;
  defaultMaxContextTokens?: number;
  defaultReservedCompletionTokens?: number;
}): EffectivePromptBudget {
  const policyMaxInputTokens = normalizePositiveInt(args.budget?.maxInputTokens);
  const baseMaxContextTokens = normalizePositiveInt(args.maxContextTokensOverride)
    ?? normalizePositiveInt(args.defaultMaxContextTokens)
    ?? DEFAULT_MAX_TOKENS;
  const rawReservedCompletionTokens = normalizePositiveInt(args.budget?.reservedCompletionTokens)
    ?? normalizePositiveInt(args.maxOutputTokensOverride)
    ?? normalizePositiveInt(args.defaultReservedCompletionTokens)
    ?? 0;

  if (policyMaxInputTokens !== undefined) {
    return {
      maxInputTokens: policyMaxInputTokens,
      reservedCompletionTokens: rawReservedCompletionTokens,
    };
  }

  const reservedCompletionTokens = Math.min(rawReservedCompletionTokens, baseMaxContextTokens);
  return {
    maxInputTokens: Math.max(0, baseMaxContextTokens - reservedCompletionTokens),
    reservedCompletionTokens,
  };
}

function resolveExplicitPromptBudgetGroupPolicies(
  budget?: PromptBudgetPolicyV5,
): PromptBudgetGroupPolicy[] | undefined {
  const groups = budget?.groups;
  if (!groups || groups.length === 0) {
    return undefined;
  }

  // Budget allocator 仍保持显式启用，避免在默认运行路径中悄然引入新的保留策略。
  return groups;
}

export async function assemblePrompt(
  db: AppDb,
  accountId: string,
  session: SessionPromptInfo,
  chatHistory: ChatMessage[],
  userMessage: string,
  tokenCounter: TokenCounter,
  memorySummary?: string,
  options: AssemblePromptOptions = {},
): Promise<AssembleResult> {
  const resourceLoader = new PromptResourceLoader(db);
  const { preset, worldbook, regexProfile } = await resourceLoader.loadPromptResourceBundle(accountId, {
    presetId: session.presetId,
    worldbookProfileId: session.worldbookProfileId,
    regexProfileId: session.regexProfileId,
  });

  const metadata = parseSessionMetadata(session.metadataJson);

  // ── Source Resolution：在进入组装前统一解析所有 source 的准入状态 ──
  const sourceResolution = resolvePromptSourceGates(options.sourceSelection);
  const effectiveMemorySummary = applyMemorySourceGate(memorySummary, sourceResolution.gates.memory);

  const character = parseCharacterSnapshot(session.characterSnapshotJson);
  const userSnapshot = parseUserSnapshot(session.userSnapshotJson ?? null);
  const characterContentHash = session.characterSnapshotJson
    ? createHash("sha256").update(session.characterSnapshotJson).digest("hex")
    : null;
  const persona = userSnapshot ?? metadata.persona;
  const promptMode = resolvePromptMode(session, metadata);
  const { ordinaryVariables, variableSnapshot, reservedVariableCollisions } = await resolvePromptVariables({
    db,
    accountId,
    character,
    persona,
    context: options.variableContext,
  });
  const runKind = resolvePromptRunKind(options);
  const effectiveBudget = resolveEffectivePromptBudget({
    budget: options.budget,
    maxContextTokensOverride: options.maxContextTokensOverride,
    maxOutputTokensOverride: options.maxOutputTokensOverride,
    defaultMaxContextTokens: preset?.preset.maxContext,
    defaultReservedCompletionTokens: preset?.preset.maxTokens,
  });

  const fullHistory = buildFullHistory(chatHistory, userMessage);
  const compatHistory = fullHistory.filter((message) => message.role === "user" || message.role === "assistant");
  const recentMacroVisibleMessages = buildVisibleRecentMacroMessages({
    committedHistory: chatHistory,
    currentUserMessage: userMessage,
    includeCurrentUserMessage: shouldIncludeCurrentUserMessageInRecentMacros({ runKind, currentUserMessage: userMessage }),
  });
  const macroValueBuild = buildStMacroValues({
    session,
    preset,
    chatHistory: recentMacroVisibleMessages,
    character,
    persona,
    userSnapshot,
    ordinaryVariables,
    variableSnapshot,
    memorySummary: effectiveMemorySummary,
    maxPrompt: effectiveBudget.maxInputTokens,
    runKind,
  });
  const macroPhase = runKind === "dry_run" ? "dry_run" : "assemble";
  const promptVariables = macroValueBuild.values;
  const aggregatedMacroWarnings = [...macroValueBuild.warnings];
  const aggregatedMacroUsedNames: string[] = [];
  const aggregatedMacroMutationPreview: StMacroMutationPreview[] = [];
  const aggregatedMacroStagedMutations: StMacroStagedMutation[] = [];
  const aggregatedMacroTraces: StMacroTraceEntry[] = [];

  const collectMacroDiagnostics = (result: StMacroEvalResult): StMacroEvalResult => {
    aggregatedMacroWarnings.push(...result.warnings);
    appendUniqueStrings(aggregatedMacroUsedNames, result.usedMacros);
    aggregatedMacroMutationPreview.push(...result.mutationPreview);
    aggregatedMacroStagedMutations.push(...result.stagedMutations);
    aggregatedMacroTraces.push(...result.traces);
    return result;
  };

  const evaluateRuntimeMacro = (args: {
    phase: "dry_run" | "assemble" | "commit_consume";
    values: Record<string, string>;
    sampleText: string;
  }): StMacroEvalResult => {
    return collectMacroDiagnostics(evaluatePromptMacroValues({
      phase: args.phase,
      values: args.values,
      variableSnapshot: macroValueBuild.variableSnapshot,
      sampleText: args.sampleText,
    }));
  };

  const evaluatedCharacterSystemPrompt = character?.systemPrompt?.trim()
    ? evaluateRuntimeMacro({
        phase: macroPhase,
        values: promptVariables,
        sampleText: character.systemPrompt,
      }).text
    : undefined;

  const promptSnapshot: PromptAssemblySnapshot = {
    createdAt: Date.now(),
    preset,
    worldbook,
    regexProfile,
    metadata,
    character: character
      ? {
          ...character,
          ...(evaluatedCharacterSystemPrompt !== undefined
            ? {
                systemPrompt: evaluatedCharacterSystemPrompt,
              }
            : {}),
        }
      : undefined,
    userSnapshot,
    persona,
    variables: promptVariables,
    characterId: session.characterId ?? null,
    characterVersionId: session.characterVersionId ?? null,
    characterImportedFormat: character?.importedFormat ?? null,
    characterContentHash,
    worldbookActivatedEntries: [],
    assetManifestDigest: buildPromptAssetManifestForAssembly({
      generatedAt: Date.now(),
      preset,
      worldbook,
      regexProfile,
      character,
      characterId: session.characterId ?? null,
      characterVersionId: session.characterVersionId ?? null,
      characterContentHash,
    }).digest,
    presetId: preset?.id ?? null,
    presetUpdatedAt: preset?.updatedAt ?? null,
    presetVersion: preset?.version ?? null,
    worldbookId: worldbook?.id ?? null,
    worldbookUpdatedAt: worldbook?.updatedAt ?? null,
    worldbookVersion: worldbook?.version ?? null,
    regexProfileId: regexProfile?.id ?? null,
    regexProfileUpdatedAt: regexProfile?.updatedAt ?? null,
    regexProfileVersion: regexProfile?.version ?? null,
    worldbookActivatedEntryUids: [],
    regexPreRuleNames: [],
    regexPostRuleNames: [],
    promptMode,
    promptDigest: "",
    tokenEstimate: 0,
  };

  const enabledRegexScripts = promptSnapshot.regexProfile?.scripts ?? [];

  let messages: ChatMessage[];
  let maxPromptTokens = effectiveBudget.maxInputTokens + effectiveBudget.reservedCompletionTokens;
  const promptIntent = options.intent ?? "normal";
  let mode: PromptAssemblyCompatSeed["mode"] = "fallback";
  let worldbookHits = 0;
  let worldBookResults: PromptWorldbookTriggerResult | undefined;
  let worldbookMatches: WorldbookMatchDetail[] | undefined;
  let characterOverridesHandledInPromptIR = false;
  let tokenUsageBySection: Record<string, number> | undefined;
  let tokenUsageByGroup: Record<string, number> | undefined;
  let prunedTokenUsageByGroup: Record<string, number> | undefined;
  let allocatorTokenUsage: AssembleResult["tokenUsage"]["allocator"] | undefined;
  let governance: PromptRuntimeGovernanceSeed | undefined;
  let memorySummaryHandledInPromptIR = false;

  const presetData = promptSnapshot.preset?.preset ?? null;
  const sendDirectives = buildPromptSendDirectives(presetData, promptIntent);
  const assistantPrefillRequested = typeof sendDirectives.assistantPrefill === "string"
    && sendDirectives.assistantPrefill.trim().length > 0;
  const assistantPrefillStrategy = assistantPrefillRequested
    ? (options.assistantPrefillStrategy ?? "unsupported")
    : "none";

  if (presetData) {
    const runtimeWorldbooks = collectPromptWorldbooks(promptSnapshot.worldbook, promptSnapshot.character, {
      characterId: promptSnapshot.characterId,
      characterVersionId: promptSnapshot.characterVersionId,
    });

    // sourceSelection.worldbook.enabled = false 时，跳过世界书触发与注入。
    const worldbookGateEnabled = sourceResolution.gates.worldbook.enabled;
    if (runtimeWorldbooks.length > 0 && worldbookGateEnabled) {
      const triggerMessages = fullHistory.map((message) => message.content).reverse();

      worldBookResults = triggerPromptWorldbooks(runtimeWorldbooks, {
        messages: triggerMessages,
        scanDepth: promptSnapshot.worldbook?.worldbook.scanDepth ?? 0,
        caseSensitive: promptSnapshot.worldbook?.worldbook.caseSensitive ?? false,
        matchWholeWords: promptSnapshot.worldbook?.worldbook.matchWholeWords ?? false,
        recursive: promptSnapshot.worldbook?.worldbook.recursive,
        maxRecursionSteps: promptSnapshot.worldbook?.worldbook.maxRecursionSteps,
        scanSources: {
          personaDescription: persona?.description,
          characterDescription: promptSnapshot.character?.description,
          characterPersonality: promptSnapshot.character?.personality,
          scenario: promptSnapshot.character?.scenario,
          creatorNotes: promptSnapshot.character?.creatorNotes,
          characterDepthPrompt: promptSnapshot.character?.postHistoryInstructions,
        },
        traceEnabled: options.includeWorldbookMatchTrace,
      });
      worldBookResults = applyWorldInfoRegexRules(worldBookResults, enabledRegexScripts, promptSnapshot.variables);
    }

    promptSnapshot.worldbookActivatedEntryUids = collectActivatedEntryUids(worldBookResults);
    promptSnapshot.worldbookActivatedEntries = buildPromptSnapshotWorldbookActivations(worldBookResults);
    worldbookHits = promptSnapshot.worldbookActivatedEntryUids.length;

    const compatInput = {
      preset: presetData,
      worldBookResults,
      chatHistory: compatHistory as Array<{ role: "user" | "assistant"; content: string }>,
      characterDescription: promptSnapshot.character?.description,
      characterPersonality: promptSnapshot.character?.personality,
      scenario: promptSnapshot.character?.scenario,
      // sourceSelection.examples.enabled = false 时，不传入示例对话。
      exampleDialogue: sourceResolution.gates.examples.enabled
        ? promptSnapshot.character?.exampleDialogue
        : undefined,
      personaDescription: persona?.description,
      intent: promptIntent,
      namesBehavior: resolveNamesBehavior(presetData.namesBehavior),
      userName: userSnapshot?.name ?? persona?.name,
      assistantName: promptSnapshot.character?.name,
      variables: promptVariables,
      macroRuntime: ({ phase, values, sampleText }: { phase: "assemble"; values: Record<string, string>; sampleText: string }) =>
      {
        return evaluateRuntimeMacro({
          phase,
          values,
          sampleText,
        });
      },
    };
    const useNativePipeline = promptSnapshot.promptMode === "native";
    const useCompatPlusPipeline = promptSnapshot.promptMode === "compat_plus";
    const compatPlusMemoryInjection = useCompatPlusPipeline
      ? createCompatPlusMemoryInjection(effectiveMemorySummary, tokenCounter)
      : undefined;
    characterOverridesHandledInPromptIR = useNativePipeline;
    memorySummaryHandledInPromptIR = useNativePipeline || compatPlusMemoryInjection !== undefined;

    const promptIR = useNativePipeline
      ? compilePromptGraph(
          buildImportedPresetPromptGraph(presetData, {
            artifactId: promptSnapshot.presetId ?? undefined,
            depthLevels: collectWorldbookDepthLevels(worldBookResults),
            outletNames: collectWorldbookOutletNames(worldBookResults),
          }),
          {
            intent: promptIntent,
            variables: promptVariables,
            character: {
              name: promptSnapshot.character?.name,
              description: promptSnapshot.character?.description,
              personality: promptSnapshot.character?.personality,
              scenario: promptSnapshot.character?.scenario,
              systemPrompt: promptSnapshot.character?.systemPrompt,
              postHistoryInstructions: promptSnapshot.character?.postHistoryInstructions,
            },
            persona: persona ? { name: persona.name, description: persona.description } : undefined,
            chatHistory: fullHistory,
            worldbookEntries: toPromptGraphWorldbookEntries(worldBookResults),
            exampleDialogue: sourceResolution.gates.examples.enabled
              ? promptSnapshot.character?.exampleDialogue
              : undefined,
            memorySummary: effectiveMemorySummary,
            maxTokens: effectiveBudget.maxInputTokens + effectiveBudget.reservedCompletionTokens,
            reservedForReply: effectiveBudget.reservedCompletionTokens,
            tokenCounter,
          },
        )
      : useCompatPlusPipeline
        ? assembleCompatPlus({
            ...compatInput,
            chatHistory: compatHistory as Array<{ role: "user" | "assistant"; content: string }>,
            memoryInjection: compatPlusMemoryInjection,
          })
        : assembleCompat({ ...compatInput, chatHistory: compatHistory as Array<{ role: "user" | "assistant"; content: string }> });

    const builder = new MessageBuilder(tokenCounter, {
      mergeAdjacentSameRole: true,
    });
    const budgetedPromptIr = {
      ...promptIR,
      metadata: {
        ...promptIR.metadata,
        maxTokens: effectiveBudget.maxInputTokens + effectiveBudget.reservedCompletionTokens,
        reservedForReply: effectiveBudget.reservedCompletionTokens,
      },
    };
    const explicitBudgetGroupPolicies = resolveExplicitPromptBudgetGroupPolicies(options.budget);
    const assembled = builder.build(budgetedPromptIr, {
      groupPolicies: explicitBudgetGroupPolicies,
    });
    const assembledBudgetUsage = assembled.tokenUsage as typeof assembled.tokenUsage & {
      byGroup?: Record<string, number>;
      prunedByGroup?: Record<string, number>;
    };

    messages = assembled.messages;
    maxPromptTokens = budgetedPromptIr.metadata.maxTokens;
    tokenUsageBySection = assembledBudgetUsage.bySection;
    tokenUsageByGroup = assembledBudgetUsage.byGroup;
    prunedTokenUsageByGroup = assembledBudgetUsage.prunedByGroup;
    governance = buildPromptRuntimeGovernanceSeed({
      sections: budgetedPromptIr.sections,
      retainedByGroup: assembledBudgetUsage.byGroup,
      prunedByGroup: assembledBudgetUsage.prunedByGroup,
    });
    allocatorTokenUsage = assembledBudgetUsage.allocator;
    mode = "preset";
  } else {
    maxPromptTokens = effectiveBudget.maxInputTokens + effectiveBudget.reservedCompletionTokens;
    messages = buildFallbackMessages(fullHistory, promptSnapshot.character, persona);
  }

  if (options.includeWorldbookMatchTrace) {
    worldbookMatches = buildWorldbookMatchDetails(worldBookResults);
  }

  if (effectiveMemorySummary && !memorySummaryHandledInPromptIR) {
    messages = injectMemorySummary(messages, effectiveMemorySummary);
  }
  if (!characterOverridesHandledInPromptIR) {
    messages = injectCharacterSystemPrompt(messages, promptSnapshot.character, presetForbidsCharacterSystemPrompt(presetData));
    messages = injectCharacterPostHistoryInstructions(messages, promptSnapshot.character);
  }

  promptSnapshot.regexPreRuleNames = collectRegexRuleNames(enabledRegexScripts, REGEX_PLACEMENT.USER_INPUT);
  promptSnapshot.regexPostRuleNames = collectRegexRuleNames(enabledRegexScripts, REGEX_PLACEMENT.AI_OUTPUT);

  let preProcess: AssembleResult["preProcess"];
  let postProcess: AssembleResult["postProcess"];
  const regexSubstitutionContext = buildRegexSubstitutionContext(promptSnapshot.variables);
  const regexReservedPlacements = enabledRegexScripts.length > 0
    ? listRuntimeRegexReservedPlacements(enabledRegexScripts)
    : [];
  const regexPhases: PromptRuntimeRegexPhaseRuntimeResult[] = [];
  let regexPromptUserInputText: string | undefined;

  if (enabledRegexScripts.length > 0) {
    const currentUserPromptRegexPhase = buildCurrentUserPromptRegexPhase({
      candidateMessages: messages,
      scripts: enabledRegexScripts,
      substitutionContext: regexSubstitutionContext,
    });
    const reservedWorldInfoRegexPhase = buildReservedWorldInfoRegexPhase(enabledRegexScripts);

    if (currentUserPromptRegexPhase) {
      regexPhases.push(currentUserPromptRegexPhase);
      regexPromptUserInputText = currentUserPromptRegexPhase.text;
    }

    if (reservedWorldInfoRegexPhase) {
      regexPhases.push(reservedWorldInfoRegexPhase);
    }

    preProcess = (candidateMessages: ChatMessage[]): ChatMessage[] => {
      const depthByMessageIndex = buildRegexDepthByMessageIndex(candidateMessages);

      return candidateMessages.map((message, index) => {
        if (message.role === "user") {
          const result = executePromptRuntimeRegexPhase({
            phaseId: "prompt.user_input",
            text: message.content,
            scripts: enabledRegexScripts,
            depth: depthByMessageIndex[index] ?? 0,
            substitutionContext: regexSubstitutionContext,
          });

          return {
            ...message,
            content: result.text,
          };
        }

        return message;
      });
    };

    postProcess = (text: string): string => {
      return executePromptRuntimeRegexPhase({
        phaseId: "persist.ai_output",
        text,
        scripts: enabledRegexScripts,
        depth: 0,
        substitutionContext: regexSubstitutionContext,
      }).text;
    };
  }

  const tokenEstimate = messages.reduce((sum, message) => sum + tokenCounter.count(message.content), 0);
  const availableForReply = Math.max(0, maxPromptTokens - tokenEstimate);
  promptSnapshot.promptDigest = createPromptDigest(messages);
  promptSnapshot.tokenEstimate = tokenEstimate;

  const runtimeTraceSeed: PromptRuntimeTraceSeed = {
    worldbookHits,
    regexPreRules: promptSnapshot.regexPreRuleNames,
    regexPostRules: promptSnapshot.regexPostRuleNames,
    // 反映真实执行状态：effectiveMemorySummary 是经过 source gate 过滤后的值
    memorySummaryInjected: Boolean(effectiveMemorySummary),
    ...(options.memoryRuntimeTrace ? { memoryRuntimeTrace: options.memoryRuntimeTrace } : {}),
    selectedPromptOrderCharacterId: null,
    ignoredPromptOrderCharacterIds: [],
    unsupportedPresetFields: [],
    ignoredPresetFields: [],
    unresolvedPresetMarkers: [],
    presetWarnings: [],
    continueNudgeApplied: false,
    continueNudgeText: undefined,
    namesBehaviorApplied: resolveNamesBehavior(presetData?.namesBehavior),
    triggerFilteredEntryIds: presetData ? collectTriggerFilteredEntryIds(presetData, promptIntent) : [],
    inChatInsertedEntryIds: presetData ? collectInChatInsertedEntryIds(presetData, promptIntent) : [],
    ...(regexPhases.length > 0 ? { regexPhases } : {}),
    ...(regexReservedPlacements.length > 0 ? { regexReservedPlacements } : {}),
    ...(enabledRegexScripts.length > 0
      ? { regexSubstitutionMode: PROMPT_RUNTIME_REGEX_SUBSTITUTION_MODE }
      : {}),
    regexPromptUserInputText,
    ...(worldbookMatches ? { worldbookMatches } : {}),
    macroWarnings: aggregatedMacroWarnings,
    macroUsedNames: aggregatedMacroUsedNames,
    macroMutationPreview: aggregatedMacroMutationPreview,
    macroStagedMutations: aggregatedMacroStagedMutations,
    macroTraces: aggregatedMacroTraces,
  };

  const assemblyCompatSeed: PromptAssemblyCompatSeed = {
    mode,
    promptIntent,
    assistantPrefillApplied: shouldMarkAssistantPrefillApplied(assistantPrefillStrategy),
    assistantPrefillStrategy,
    presetUsed: presetData !== null,
    reservedVariableCollisions,
  };

  const debug: AssembleDebugInfo | undefined = options.includeDebug
    ? {
        ...runtimeTraceSeed,
        ...assemblyCompatSeed,
      }
    : undefined;

  return {
    messages,
    sendDirectives,
    preProcess,
    postProcess,
    tokenUsage: {
      total: tokenEstimate,
      ...(tokenUsageBySection ? { bySection: tokenUsageBySection } : {}),
      ...(tokenUsageByGroup ? { byGroup: tokenUsageByGroup } : {}),
      ...(prunedTokenUsageByGroup ? { prunedByGroup: prunedTokenUsageByGroup } : {}),
      ...(allocatorTokenUsage ? { allocator: allocatorTokenUsage } : {}),
      availableForReply,
    },
    runtimeTraceSeed,
    assemblyCompatSeed,
    ...(governance ? { governance } : {}),
    debug,
    promptSnapshot,
  };
}

function parseSessionMetadata(raw: string | null | undefined): SessionMetadata {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as SessionMetadata;
    }
  } catch {
    // ignore invalid metadata
  }
  return {};
}

function parseCharacterSnapshot(raw: string | null | undefined): CharacterSnapshot | undefined {
  return parseSessionCharacterSnapshot(raw ?? null);
}

function parseUserSnapshot(raw: string | null | undefined): UserSnapshot | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as UserSnapshot;
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  } catch {
    // ignore invalid snapshot
  }
  return undefined;
}

async function resolvePromptVariables(args: {
  db: AppDb;
  accountId: string;
  character?: CharacterSnapshot;
  persona?: PersonaInfo;
  context?: PromptVariableContextInput;
}): Promise<{
  ordinaryVariables: Record<string, unknown>;
  variableSnapshot: StMacroVariableSnapshot;
  reservedVariableCollisions: ReservedPromptAlias[];
}> {
  const reservedVariableCollisions: ReservedPromptAlias[] = [];
  const variableService = new VariableService(args.db);
  const snapshot = args.context
    ? await variableService.resolveSnapshot({
        accountId: args.accountId,
        sessionId: args.context.sessionId,
        branchId: args.context.branchId,
        floorId: args.context.floorId,
        pageId: args.context.pageId,
        includeLayers: true,
      })
    : undefined;
  const ordinaryVariables: Record<string, unknown> = snapshot
    ? Object.fromEntries(snapshot.resolved.map((item) => [item.key, item.value]))
    : {};

  const reservedValues: Record<ReservedPromptAlias, unknown> = {
    char: args.character?.name,
    user: args.persona?.name,
  };

  for (const key of RESERVED_PROMPT_ALIAS_KEYS) {
    const reservedValue = reservedValues[key];
    if (reservedValue !== undefined && reservedValue !== null && String(reservedValue).length > 0) {
      if (Object.prototype.hasOwnProperty.call(ordinaryVariables, key)) {
        reservedVariableCollisions.push(key);
      }
    }
  }

  const localLayer = snapshot?.layers?.branch ?? snapshot?.layers?.chat;
  const variableSnapshot: StMacroVariableSnapshot = {
    local: mapScopedVariableItemsToValues(localLayer?.items),
    global: mapScopedVariableItemsToValues(snapshot?.layers?.global?.items),
    plain: Object.fromEntries(
      Object.entries(ordinaryVariables).map(([key, value]) => [key, stringifyPromptVariableValue(value)]),
    ),
  };

  return { ordinaryVariables, variableSnapshot, reservedVariableCollisions };
}

function stringifyPromptVariableValue(value: unknown): string {
  return stringifyStMacroValue(value);
}

function mapScopedVariableItemsToValues(
  items: Array<{ key: string; value: unknown }> | undefined,
): Record<string, StMacroJsonValue> {
  if (!items || items.length === 0) {
    return {};
  }

  return Object.fromEntries(items.map((item) => [item.key, item.value as StMacroJsonValue]));
}

function appendUniqueStrings(target: string[], values: string[]): void {
  for (const value of values) {
    if (!target.includes(value)) {
      target.push(value);
    }
  }
}

function buildFallbackMessages(
  fullHistory: Array<{ role: "user" | "assistant" | "system"; content: string }>,
  character?: CharacterSnapshot,
  persona?: PersonaInfo,
): ChatMessage[] {
  const systemParts = [character?.description, character?.personality, persona?.description]
    .filter((value): value is string => Boolean(value && value.trim().length > 0));
  const systemPrompt = systemParts.length > 0 ? systemParts.join("\n\n") : DEFAULT_SYSTEM_PROMPT;

  return [
    { role: "system", content: systemPrompt },
    ...fullHistory.map((message) => ({ role: message.role, content: message.content })),
  ];
}

function presetForbidsCharacterSystemPrompt(preset: LoadedPromptPreset["preset"] | null): boolean {
  if (!preset) {
    return false;
  }

  return preset.prompts.some((prompt) => {
    if (prompt.behavior?.semantics?.forbidOverrides !== true) {
      return false;
    }
    return prompt.identifier === "main" || prompt.behavior.semantics.systemPrompt === true;
  });
}

function injectCharacterSystemPrompt(
  messages: ChatMessage[],
  character: CharacterSnapshot | undefined,
  forbidOverrides: boolean,
): ChatMessage[] {
  if (!character?.systemPrompt?.trim()) {
    return messages;
  }
  if (forbidOverrides) {
    return messages;
  }

  const nextMessages = [...messages];
  nextMessages.splice(1, 0, { role: "system", content: character.systemPrompt });
  return nextMessages;
}

function injectCharacterPostHistoryInstructions(messages: ChatMessage[], character?: CharacterSnapshot): ChatMessage[] {
  if (!character?.postHistoryInstructions?.trim()) {
    return messages;
  }

  return [
    ...messages,
    { role: "system", content: character.postHistoryInstructions },
  ];
}

/**
 * compat 路径的 memory 后置注入。
 *
 * 与 `compat_plus` 和 `native` 路径不同，本函数直接把 memory summary 以裸
 * `ChatMessage` 形式插入到消息数组的第 1 位（第一条 system 之后），不会产生
 * 带 `source` / `budgetGroup` 归因的 IR section。
 *
 * Limitation: compat 路径下 memory 不参与 section 级 token budget 治理，
 * 也不会进入 runtimeTrace 的 section stats。`runtimeTrace.memory.summaryInjected`
 * 仍能正确反映 memory 是否真正进入 prompt。如果需要 section 级归因，
 * 请将 `promptMode` 切换到 `compat_plus` 或 `native`。
 *
 * 三条路径的 memory 接入点对比：
 *
 * | 路径 | 接入方式 | section name | message source |
 * | ---- | ---- | ---- | ---- |
 * | compat | `injectMemorySummary()` 后置 | 无 section | 无 source 标签 |
 * | compat_plus | `assembleCompatPlus` IR section | `PROMPT_MEMORY_SECTION_NAME` = `"memory"` | `PROMPT_MEMORY_MESSAGE_SOURCE` = `"memory"` |
 * | native | `MemoryInjectNode` IR section | `PROMPT_MEMORY_SECTION_NAME` = `"memory"` | `PROMPT_MEMORY_MESSAGE_SOURCE` = `"memory"` |
 */
function injectMemorySummary(messages: ChatMessage[], memorySummary: string): ChatMessage[] {
  if (!memorySummary.trim()) {
    return messages;
  }

  const nextMessages = [...messages];
  nextMessages.splice(1, 0, { role: "system", content: memorySummary });
  return nextMessages;
}

function createCompatPlusMemoryInjection(
  memorySummary: string | undefined,
  tokenCounter: TokenCounter,
): MemoryInjectionResult | undefined {
  if (!memorySummary?.trim()) {
    return undefined;
  }

  return {
    items: [],
    formattedText: memorySummary,
    tokenCount: tokenCounter.count(memorySummary),
  };
}

function collectRegexRuleNames(scripts: STRegexScript[], placement: number): string[] {
  return collectRegexRuleNamesFromSupportMatrix(scripts, placement);
}

function createPromptDigest(messages: ChatMessage[]): string {
  const hash = createHash("sha256");
  for (const message of messages) {
    hash.update(message.role);
    hash.update("\u0000");
    hash.update(message.content);
    hash.update("\u0001");
  }
  return hash.digest("hex");
}

function buildStMacroValues(args: {
  session: SessionPromptInfo;
  preset: LoadedPromptPreset | null;
  chatHistory: { role: "user" | "assistant"; content: string }[];
  character?: CharacterSnapshot;
  persona?: PersonaInfo;
  userSnapshot?: UserSnapshot;
  ordinaryVariables: Record<string, unknown>;
  variableSnapshot: StMacroVariableSnapshot;
  memorySummary?: string;
  maxPrompt: number;
  runKind: PromptMacroRunKind;
}): { values: Record<string, string>; variableSnapshot: StMacroVariableSnapshot; warnings: StMacroWarning[] } {
  return buildStMacroValuesFromContextBuilder({
    metadata: parseSessionMetadata(args.session.metadataJson),
    sessionPromptMode: args.session.promptMode,
    preset: args.preset,
    chatHistory: args.chatHistory,
    character: args.character,
    persona: args.persona,
    userSnapshot: args.userSnapshot,
    ordinaryVariables: args.ordinaryVariables,
    variableSnapshot: args.variableSnapshot,
    memorySummary: args.memorySummary,
    maxPrompt: args.maxPrompt,
    runKind: args.runKind,
  });
}

function resolvePromptRunKind(options: AssemblePromptOptions): PromptMacroRunKind {
  return options.runKind ?? (options.includeDebug ? "dry_run" : "respond");
}

function shouldIncludeCurrentUserMessageInRecentMacros(args: {
  runKind: PromptMacroRunKind;
  currentUserMessage?: string;
}): boolean {
  return shouldIncludeCurrentUserMessageInRecentMacrosFromContextBuilder(args);
}

function buildVisibleRecentMacroMessages(args: {
  committedHistory: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  currentUserMessage?: string;
  includeCurrentUserMessage: boolean;
}): Array<{ role: "user" | "assistant"; content: string }> {
  return buildVisibleRecentMacroMessagesFromContextBuilder(args);
}

export function evaluatePromptMacroValues(args: {
  phase: "preview" | "dry_run" | "assemble" | "commit_consume";
  values: Record<string, string>;
  variableSnapshot?: StMacroVariableSnapshot;
  sampleText: string;
}): StMacroEvalResult {
  return evaluatePromptMacroValuesFromFacade(args);
}

export function previewPromptMacroText(args: {
  session: SessionPromptInfo;
  text: string;
  chatHistory: Array<{ role: "user" | "assistant"; content: string }>;
  ordinaryVariables: Record<string, unknown>;
  localValues: Record<string, StMacroJsonValue>;
  globalValues: Record<string, StMacroJsonValue>;
  memorySummary?: string;
  maxPrompt?: number;
  runKind?: PromptMacroRunKind;
}): {
  text: string;
  runtimeTrace: PromptRuntimeTrace;
} {
  const metadata = parseSessionMetadata(args.session.metadataJson);
  const character = parseCharacterSnapshot(args.session.characterSnapshotJson);
  const userSnapshot = parseUserSnapshot(args.session.userSnapshotJson ?? null);
  const persona = userSnapshot ?? metadata.persona;

  const macroValueBuild = buildStMacroValues({
    session: args.session,
    preset: null,
    chatHistory: args.chatHistory,
    character,
    persona,
    userSnapshot,
    ordinaryVariables: args.ordinaryVariables,
    variableSnapshot: {
      local: { ...args.localValues },
      global: { ...args.globalValues },
      plain: Object.fromEntries(
        Object.entries(args.ordinaryVariables).map(([key, value]) => [key, stringifyPromptVariableValue(value)]),
      ),
    },
    memorySummary: args.memorySummary,
    maxPrompt: normalizePositiveInt(args.maxPrompt) ?? DEFAULT_MAX_TOKENS,
    runKind: args.runKind ?? "dry_run",
  });
  const evaluated = evaluatePromptMacroValues({
    phase: "preview",
    values: macroValueBuild.values,
    variableSnapshot: macroValueBuild.variableSnapshot,
    sampleText: args.text,
  });
  const macroTrace = buildPromptRuntimeMacroTrace({
    warnings: [...macroValueBuild.warnings, ...evaluated.warnings],
    usedNames: evaluated.usedMacros,
    mutationPreview: evaluated.mutationPreview,
    stagedMutations: [],
    traces: evaluated.traces,
  });

  return {
    text: evaluated.text,
    runtimeTrace: {
      ...(macroTrace ? { macro: macroTrace } : {}),
    },
  };
}

function buildFullHistory(
  chatHistory: ChatMessage[],
  userMessage: string,
): Array<{ role: "user" | "assistant" | "system"; content: string }> {
  // respond / dry-run 会把当前 userMessage 追加到可见消息集，供 recent message 宏读取。
  // regenerate / retry 调用方应传入对应历史视图，不应把尚未提交的 assistant 输出伪装为可见消息。
  // 这里不做额外过滤，只负责构造当前编排阶段可见的消息顺序。
  return [
    ...chatHistory
      .filter((message) => message.role === "user" || message.role === "assistant" || message.role === "system")
      .map((message) => ({
        role: message.role,
        content: message.content,
      })),
    { role: "user", content: userMessage },
  ];
}

export function createRegexMacroSubstituter(variables: Record<string, unknown>) {
  return createRegexMacroSubstituterFromFacade(variables);
}

function resolvePromptMode(session: SessionPromptInfo, metadata: SessionMetadata): PromptMode {
  const source = session.promptMode
    ?? metadata.promptMode
    ?? metadata.prompt_mode
    ?? "compat_strict";

  if (source === "compat_strict" || source === "compat_plus" || source === "native") {
    return source;
  }

  return "compat_strict";
}

function resolveNamesBehavior(value: unknown): "off" | "always" {
  return value === 1 || value === "always" ? "always" : "off";
}

function shouldApplyAssistantPrefill(intent: PromptRunIntent): boolean {
  return intent === "continue";
}

function buildPromptSendDirectives(
  presetData: LoadedPromptPreset["preset"] | null,
  promptIntent: PromptRunIntent,
): PromptSendDirectives {
  if (!presetData) {
    return {};
  }

  const assistantPrefill = typeof presetData.assistantPrefill === "string"
    && presetData.assistantPrefill.trim().length > 0
    && shouldApplyAssistantPrefill(promptIntent)
    ? presetData.assistantPrefill
    : undefined;

  return {
    assistantPrefill,
  };
}

export interface MaterializePromptRuntimeMessagesOptions {
  messages: ChatMessage[];
  sendDirectives: PromptSendDirectives;
  assistantPrefillStrategy: AssistantPrefillExecutionStrategy;
  structurePolicy?: PromptStructurePolicy;
  deliveryPolicy?: PromptDeliveryPolicy;
  materializeAssistantPrefillFallback?: boolean;
}

export interface MaterializePromptRuntimeMessagesResult {
  messages: ChatMessage[];
  structureTrace?: PromptRuntimeStructureTrace;
  deliveryTrace: PromptRuntimeDeliveryTrace;
  assistantPrefillApplied: boolean;
  assistantPrefillStrategy: AssistantPrefillExecutionStrategy;
}

export function applyPromptStructurePolicy(
  messages: ChatMessage[],
  policy: PromptStructurePolicy,
): { messages: ChatMessage[]; trace: PromptRuntimeStructureTrace } {
  const mergeAdjacentSameRole = policy.mergeAdjacentSameRole ?? policy.mode === "strict_alternating";
  const preserveSystemMessages = policy.preserveSystemMessages ?? true;
  const assistantRewriteStrategy = policy.assistantRewriteStrategy ?? "to_system";

  let assistantRewriteCount = 0;
  let nextMessages = preserveSystemMessages ? [...messages] : messages.filter((message) => message.role !== "system");

  if (policy.mode === "flattened") {
    const { messages: flattenedMessages, transcriptMessageCount } = flattenPromptStructureMessages(nextMessages, mergeAdjacentSameRole);
    return {
      messages: flattenedMessages,
      trace: {
        mode: policy.mode,
        mergeAdjacentSameRole,
        assistantRewriteCount,
        tailAssistantDetected: hasTrailingAssistantMessage(flattenedMessages),
        transcriptized: true,
        transcriptMessageCount,
        assistantPrefillTranscriptized: false,
      },
    };
  }

  if (policy.mode === "no_assistant") {
    nextMessages = nextMessages.map((message) => {
      if (message.role !== "assistant") {
        return message;
      }

      assistantRewriteCount += 1;
      return rewriteAssistantStructureMessage(message, assistantRewriteStrategy);
    });
  }

  if (mergeAdjacentSameRole) {
    nextMessages = mergeAdjacentPromptMessages(nextMessages);
  }

  return {
    messages: nextMessages,
    trace: {
      mode: policy.mode,
      mergeAdjacentSameRole,
      assistantRewriteCount,
      ...(policy.mode === "no_assistant" ? { assistantRewriteStrategy } : {}),
      tailAssistantDetected: hasTrailingAssistantMessage(nextMessages),
    },
  };
}

export function materializePromptRuntimeMessages(
  args: MaterializePromptRuntimeMessagesOptions,
): MaterializePromptRuntimeMessagesResult {
  const assistantPrefillRequested = typeof args.sendDirectives.assistantPrefill === "string"
    && args.sendDirectives.assistantPrefill.trim().length > 0;
  const deliveryPolicy = args.deliveryPolicy;
  const allowAssistantPrefill = deliveryPolicy?.allowAssistantPrefill ?? true;
  const requireLastUser = deliveryPolicy?.requireLastUser ?? false;
  const noAssistant = deliveryPolicy?.noAssistant ?? false;
  const degradeReasons: PromptDeliveryDegradeReason[] = [];
  const effectiveStructurePolicy = resolveEffectiveStructurePolicy(args.structurePolicy, deliveryPolicy);
  const flattenedTranscriptMode = effectiveStructurePolicy?.mode === "flattened";
  const structureSuppressesAssistantPrefill = effectiveStructurePolicy?.mode === "no_assistant";
  if (noAssistant && args.structurePolicy?.mode !== "no_assistant" && args.structurePolicy?.mode !== "flattened") {
    degradeReasons.push("no_assistant_override");
  }

  const structured = effectiveStructurePolicy
    ? applyPromptStructurePolicy(args.messages, effectiveStructurePolicy)
    : undefined;
  let effectiveAssistantPrefillStrategy: AssistantPrefillExecutionStrategy = assistantPrefillRequested
    ? args.assistantPrefillStrategy
    : "none";
  if (assistantPrefillRequested && flattenedTranscriptMode) {
    if (!allowAssistantPrefill) {
      degradeReasons.push("assistant_prefill_disabled");
      effectiveAssistantPrefillStrategy = "none";
    } else {
      effectiveAssistantPrefillStrategy = "transcript_append";
    }
  } else {
    if (assistantPrefillRequested && effectiveAssistantPrefillStrategy === "unsupported") {
      degradeReasons.push("assistant_prefill_unsupported");
    }
    if (assistantPrefillRequested && (structureSuppressesAssistantPrefill || noAssistant || !allowAssistantPrefill)) {
      if (!structureSuppressesAssistantPrefill && !noAssistant && !allowAssistantPrefill) {
        degradeReasons.push("assistant_prefill_disabled");
      }
      effectiveAssistantPrefillStrategy = "none";
    }
    if (assistantPrefillRequested && requireLastUser && effectiveAssistantPrefillStrategy === "assistant_message_fallback") {
      degradeReasons.push("require_last_user");
      effectiveAssistantPrefillStrategy = "none";
    }
  }
  const materializeAssistantPrefillFallback = args.materializeAssistantPrefillFallback ?? true;
  const baseMessages = structured?.messages ?? args.messages;
  const structureTrace = structured?.trace ? { ...structured.trace } : undefined;
  let messages = materializeAssistantPrefillFallback
    ? materializePromptSendMessages(baseMessages, args.sendDirectives, effectiveAssistantPrefillStrategy)
    : baseMessages.map((message) => ({ ...message }));
  if (assistantPrefillRequested && effectiveAssistantPrefillStrategy === "transcript_append") {
    messages = materializePromptTranscriptMessages(messages, args.sendDirectives);
    if (structureTrace?.mode === "flattened") {
      structureTrace.assistantPrefillTranscriptized = true;
      structureTrace.transcriptMessageCount = (structureTrace.transcriptMessageCount ?? 0) + 1;
    }
  }
  const lastMessageRole = resolveLastConversationRole(messages);
  const assistantPrefillApplied = assistantPrefillRequested
    && shouldMarkAssistantPrefillApplied(effectiveAssistantPrefillStrategy);

  return {
    messages,
    ...(structureTrace ? { structureTrace } : {}),
    deliveryTrace: {
      assistantPrefillRequested,
      assistantPrefillApplied,
      assistantPrefillStrategy: effectiveAssistantPrefillStrategy,
      allowAssistantPrefill,
      requireLastUser,
      noAssistant,
      lastMessageRole,
      endsWithUser: lastMessageRole === "user",
      degraded: degradeReasons.length > 0,
      degradeReasons,
    },
    assistantPrefillApplied,
    assistantPrefillStrategy: effectiveAssistantPrefillStrategy,
  };
}

export function materializePromptSendMessages(
  messages: ChatMessage[],
  sendDirectives: PromptSendDirectives,
  assistantPrefillStrategy: AssistantPrefillExecutionStrategy,
): ChatMessage[] {
  const assistantPrefill = sendDirectives.assistantPrefill?.trim();
  if (!assistantPrefill || assistantPrefillStrategy !== "assistant_message_fallback") {
    return messages;
  }

  return [
    ...messages,
    {
      role: "assistant",
      content: assistantPrefill,
    },
  ];
}

function flattenPromptStructureMessages(
  messages: ChatMessage[],
  mergeAdjacentSameRole: boolean,
): { messages: ChatMessage[]; transcriptMessageCount: number } {
  const systemMessages = messages
    .filter((message) => message.role === "system")
    .map((message) => ({ ...message }));
  const conversationMessages = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({ ...message }));
  const transcriptMessages = mergeAdjacentSameRole
    ? mergeAdjacentPromptMessages(conversationMessages)
    : conversationMessages;
  const transcriptText = buildFlattenedTranscriptText(transcriptMessages);

  return {
    messages: transcriptText.length > 0
      ? [...systemMessages, { role: "user", content: transcriptText }]
      : systemMessages,
    transcriptMessageCount: transcriptMessages.length,
  };
}

function buildFlattenedTranscriptText(messages: ChatMessage[]): string {
  return messages.map((message) => formatFlattenedTranscriptLine(message.role, message.content)).join("\n");
}

function formatFlattenedTranscriptLine(role: ChatMessage["role"], content: string): string {
  return `${role === "assistant" ? "Assistant" : "User"}: ${content}`;
}

function materializePromptTranscriptMessages(
  messages: ChatMessage[],
  sendDirectives: PromptSendDirectives,
): ChatMessage[] {
  const assistantPrefill = sendDirectives.assistantPrefill?.trim();
  if (!assistantPrefill) {
    return messages;
  }

  const nextMessages = messages.map((message) => ({ ...message }));
  const transcriptLine = formatFlattenedTranscriptLine("assistant", assistantPrefill);
  for (let index = nextMessages.length - 1; index >= 0; index -= 1) {
    if (nextMessages[index]?.role !== "user") {
      continue;
    }

    nextMessages[index] = {
      role: "user",
      content: nextMessages[index]!.content.length > 0
        ? `${nextMessages[index]!.content}\n${transcriptLine}`
        : transcriptLine,
    };
    return nextMessages;
  }

  return [...nextMessages, { role: "user", content: transcriptLine }];
}

function rewriteAssistantStructureMessage(
  message: ChatMessage,
  strategy: PromptStructureAssistantRewriteStrategy,
): ChatMessage {
  if (strategy === "to_user_transcript") {
    return {
      role: "user",
      content: `Assistant: ${message.content}`,
    };
  }

  return {
    role: "system",
    content: message.content,
  };
}

function mergeAdjacentPromptMessages(messages: ChatMessage[]): ChatMessage[] {
  const merged: ChatMessage[] = [];
  for (const message of messages) {
    const previous = merged[merged.length - 1];
    if (previous && previous.role === message.role) {
      previous.content = `${previous.content}\n\n${message.content}`;
      continue;
    }
    merged.push({ ...message });
  }
  return merged;
}

function resolveEffectiveStructurePolicy(
  structurePolicy: PromptStructurePolicy | undefined,
  deliveryPolicy: PromptDeliveryPolicy | undefined,
): PromptStructurePolicy | undefined {
  if (structurePolicy?.mode === "flattened" || structurePolicy?.mode === "no_assistant") {
    return structurePolicy;
  }
  if (deliveryPolicy?.noAssistant !== true) {
    return structurePolicy;
  }

  return {
    mode: "no_assistant",
    mergeAdjacentSameRole: structurePolicy?.mergeAdjacentSameRole ?? (structurePolicy?.mode === "strict_alternating" ? true : undefined),
    assistantRewriteStrategy: structurePolicy?.assistantRewriteStrategy,
    preserveSystemMessages: structurePolicy?.preserveSystemMessages,
  };
}

function hasTrailingAssistantMessage(messages: ChatMessage[]): boolean {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "system") {
      continue;
    }
    return messages[index]?.role === "assistant";
  }
  return false;
}

function resolveLastConversationRole(messages: ChatMessage[]): ChatMessage["role"] | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const role = messages[index]?.role;
    if (role && role !== "system") {
      return role;
    }
  }
  return null;
}

function shouldMarkAssistantPrefillApplied(strategy: AssistantPrefillExecutionStrategy): boolean {
  return strategy === "provider_native" || strategy === "assistant_message_fallback" || strategy === "transcript_append";
}

function shouldIncludePromptEntryForIntent(promptEntry: { behavior?: { triggers?: PromptRunIntent[] } } | undefined, intent: PromptRunIntent): boolean {
  const triggers = promptEntry?.behavior?.triggers;
  if (!triggers || triggers.length === 0) {
    return true;
  }
  return triggers.includes(intent);
}

function collectTriggerFilteredEntryIds(preset: LoadedPromptPreset["preset"], intent: PromptRunIntent): string[] {
  return preset.promptOrder.filter((identifier) => {
    const promptEntry = preset.prompts.find((entry) => entry.identifier === identifier);
    return !shouldIncludePromptEntryForIntent(promptEntry, intent);
  });
}

function collectInChatInsertedEntryIds(preset: LoadedPromptPreset["preset"], intent: PromptRunIntent): string[] {
  return preset.promptOrder.filter((identifier) => {
    const promptEntry = preset.prompts.find((entry) => entry.identifier === identifier);
    return shouldIncludePromptEntryForIntent(promptEntry, intent)
      && promptEntry?.behavior?.placement?.kind === "in_chat";
  });
}

function parseCharacterBookWorldbook(character?: CharacterSnapshot): STWorldBook | undefined {
  if (!character?.characterBook) {
    return undefined;
  }

  if (!Array.isArray((character.characterBook as { entries?: unknown }).entries)) {
    return undefined;
  }

  const parsed = parseWorldBook(character.characterBook);
  if (!parsed) {
    return undefined;
  }

  return {
    ...parsed,
    entries: parsed.entries.map((entry, index) => ({
      ...entry,
      uid: entry.uid ?? index + 1,
    })),
  };
}

function collectPromptWorldbooks(
  worldbook: LoadedPromptWorldbook | null,
  character?: CharacterSnapshot,
  characterBinding?: {
    characterId?: string | null;
    characterVersionId?: string | null;
  },
): SourcedWorldbook[] {
  const result: SourcedWorldbook[] = [];

  const worldbookData = worldbook?.worldbook;
  if (worldbookData) {
    const assetScopeId = buildSessionWorldbookAssetScopeId(worldbook);
    result.push({
      worldbook: worldbookData,
      source: {
        kind: "session_worldbook",
        worldbookId: worldbook?.id ?? null,
        worldbookName: worldbookData.name ?? "session worldbook",
        assetScopeId,
      },
    });
  }

  const characterBookWorldbook = parseCharacterBookWorldbook(character);
  if (characterBookWorldbook) {
    const assetScopeId = buildCharacterBookAssetScopeId(characterBinding?.characterId, characterBinding?.characterVersionId);
    result.push({
      worldbook: characterBookWorldbook,
      source: {
        kind: "character_book",
        worldbookId: null,
        worldbookName: characterBookWorldbook.name ?? "character book",
        assetScopeId,
      },
    });
  }

  return result;
}

function triggerPromptWorldbooks(
  worldbooks: SourcedWorldbook[],
  context: TriggerContext,
): PromptWorldbookTriggerResult | undefined {
  if (worldbooks.length === 0) {
    return undefined;
  }

  const merged: PromptWorldbookTriggerResult = {
    activated: [],
    before: [],
    after: [],
    atDepth: [],
    anTop: [],
    anBottom: [],
    emTop: [],
    emBottom: [],
    outletEntries: {},
    activatedDetails: [],
    beforeDetails: [],
    afterDetails: [],
    anTopDetails: [],
    anBottomDetails: [],
    emTopDetails: [],
    emBottomDetails: [],
    atDepthDetails: [],
    outletEntryDetails: {},
  };

  for (const item of worldbooks) {
    const result = triggerWorldBook(item.worldbook.entries, context);
    const decorateEntry = (entry: STWorldBookEntry): PromptWorldbookEntryActivation => ({
      entry,
      activationKey: buildWorldbookActivationKey(item.source.assetScopeId, entry.uid),
      source: item.source,
      activation: result.activationTraces?.get(entry.uid),
    });
    const activatedDetails = result.activated.map(decorateEntry);
    const beforeDetails = result.before.map(decorateEntry);
    const afterDetails = result.after.map(decorateEntry);
    const anTopDetails = result.anTop.map(decorateEntry);
    const anBottomDetails = result.anBottom.map(decorateEntry);
    const emTopDetails = result.emTop.map(decorateEntry);
    const emBottomDetails = result.emBottom.map(decorateEntry);
    const atDepthDetails = result.atDepth.map((entry) => ({
      activation: decorateEntry(entry.entry),
      depth: entry.depth,
      role: entry.role,
    }));

    merged.activated.push(...activatedDetails.map((entry) => entry.entry));
    merged.before.push(...beforeDetails.map((entry) => entry.entry));
    merged.after.push(...afterDetails.map((entry) => entry.entry));
    merged.anTop.push(...anTopDetails.map((entry) => entry.entry));
    merged.anBottom.push(...anBottomDetails.map((entry) => entry.entry));
    merged.emTop.push(...emTopDetails.map((entry) => entry.entry));
    merged.emBottom.push(...emBottomDetails.map((entry) => entry.entry));
    merged.atDepth.push(...atDepthDetails.map((entry) => ({
      entry: entry.activation.entry,
      depth: entry.depth,
      role: entry.role,
    })));
    merged.activatedDetails.push(...activatedDetails);
    merged.beforeDetails.push(...beforeDetails);
    merged.afterDetails.push(...afterDetails);
    merged.anTopDetails.push(...anTopDetails);
    merged.anBottomDetails.push(...anBottomDetails);
    merged.emTopDetails.push(...emTopDetails);
    merged.emBottomDetails.push(...emBottomDetails);
    merged.atDepthDetails.push(...atDepthDetails);

    const mergedOutletEntries = merged.outletEntries ?? (merged.outletEntries = {});
    const mergedOutletEntryDetails = merged.outletEntryDetails;
    for (const [name, entries] of Object.entries(result.outletEntries ?? {})) {
      const outletDetails = entries.map(decorateEntry);
      mergedOutletEntries[name] = [...(mergedOutletEntries[name] ?? []), ...outletDetails.map((entry) => entry.entry)];
      mergedOutletEntryDetails[name] = [...(mergedOutletEntryDetails[name] ?? []), ...outletDetails];
    }
  }

  return merged;
}

function applyWorldInfoRegexRules(
  results: PromptWorldbookTriggerResult | undefined,
  _scripts: STRegexScript[],
  _variables: Record<string, unknown>,
): PromptWorldbookTriggerResult | undefined {
  return results;
}

function collectActivatedEntryUids(result: PromptWorldbookTriggerResult | undefined): number[] {
  if (!result) {
    return [];
  }
  return result.activated.map((entry) => entry.uid);
}

function collectWorldbookDepthLevels(result: PromptWorldbookTriggerResult | undefined): number[] {
  if (!result) {
    return [];
  }
  return Array.from(new Set(result.atDepth.map((item) => item.depth))).sort((a, b) => a - b);
}

function collectWorldbookOutletNames(result: PromptWorldbookTriggerResult | undefined): string[] {
  if (!result) {
    return [];
  }
  return Object.keys(result.outletEntries ?? {}).sort();
}

function toPromptGraphWorldbookEntries(
  result: PromptWorldbookTriggerResult | undefined,
): PromptGraphWorldbookEntry[] {
  if (!result) {
    return [];
  }

  const beforeEntries = result.beforeDetails.map((entry) => ({
    id: entry.activationKey,
    content: entry.entry.content,
    position: "before" as const,
  }));
  const afterEntries = result.afterDetails.map((entry) => ({ id: entry.activationKey, content: entry.entry.content, position: "after" as const }));
  const anTopEntries = result.anTopDetails.map((entry) => ({ id: entry.activationKey, content: entry.entry.content, position: "an_top" as const }));
  const anBottomEntries = result.anBottomDetails.map((entry) => ({ id: entry.activationKey, content: entry.entry.content, position: "an_bottom" as const }));
  const emTopEntries = result.emTopDetails.map((entry) => ({ id: entry.activationKey, content: entry.entry.content, position: "em_top" as const }));
  const emBottomEntries = result.emBottomDetails.map((entry) => ({ id: entry.activationKey, content: entry.entry.content, position: "em_bottom" as const }));
  const depthEntries = result.atDepthDetails.map((entry) => ({
    id: entry.activation.activationKey,
    content: entry.activation.entry.content,
    position: "depth" as const,
    depth: entry.depth,
  }));
  const outletEntries = Object.entries(result.outletEntryDetails ?? {}).flatMap(([outletName, entries]) =>
    entries.map((entry) => ({
      id: entry.activationKey,
      content: entry.entry.content,
      position: "outlet" as const,
      outletName,
    })),
  );

  return [...beforeEntries, ...afterEntries, ...anTopEntries, ...anBottomEntries, ...emTopEntries, ...emBottomEntries, ...depthEntries, ...outletEntries];
}

function buildRegexDepthByMessageIndex(messages: ChatMessage[]): number[] {
  return messages.map((_message, index) => index);
}

function buildCurrentUserPromptRegexPhase(args: {
  candidateMessages: ChatMessage[];
  scripts: STRegexScript[];
  substitutionContext: ReturnType<typeof buildRegexSubstitutionContext>;
}): PromptRuntimeRegexPhaseRuntimeResult | undefined {
  if (args.scripts.length === 0) {
    return undefined;
  }

  const depthByMessageIndex = buildRegexDepthByMessageIndex(args.candidateMessages);
  for (let index = args.candidateMessages.length - 1; index >= 0; index -= 1) {
    const message = args.candidateMessages[index];
    if (message?.role !== "user") {
      continue;
    }

    return executePromptRuntimeRegexPhase({
      phaseId: "prompt.user_input",
      text: message.content,
      scripts: args.scripts,
      depth: depthByMessageIndex[index] ?? 0,
      substitutionContext: args.substitutionContext,
    });
  }

  return undefined;
}

function buildWorldbookMatchDetails(result: PromptWorldbookTriggerResult | undefined): WorldbookMatchDetail[] {
  if (!result) {
    return [];
  }

  const buildDetail = (
    activation: PromptWorldbookEntryActivation,
    insertion: WorldbookMatchInsertion,
  ): WorldbookMatchDetail => ({
    uid: activation.entry.uid,
    activationKey: activation.activationKey,
    assetScopeId: activation.source.assetScopeId,
    comment: activation.entry.comment,
    contentPreview: activation.entry.content,
    order: activation.entry.order,
    source: activation.source,
    insertion,
    activation: activation.activation ?? {
      mode: activation.entry.constant ? "constant" : "triggered",
      recursionLevel: 0,
      firstMatch: null,
    },
  });

  const details: WorldbookMatchDetail[] = [];
  details.push(...result.beforeDetails.map((entry) => buildDetail(entry, { position: "before" })));
  details.push(...result.afterDetails.map((entry) => buildDetail(entry, { position: "after" })));
  details.push(...result.anTopDetails.map((entry) => buildDetail(entry, { position: "an_top" })));
  details.push(...result.anBottomDetails.map((entry) => buildDetail(entry, { position: "an_bottom" })));
  details.push(...result.emTopDetails.map((entry) => buildDetail(entry, { position: "em_top" })));
  details.push(...result.emBottomDetails.map((entry) => buildDetail(entry, { position: "em_bottom" })));
  details.push(...result.atDepthDetails.map((item) => buildDetail(item.activation, {
    position: "at_depth",
    depth: item.depth,
    role: mapWorldbookRole(item.role),
  })));
  for (const [outletName, entries] of Object.entries(result.outletEntryDetails ?? {})) {
    details.push(...entries.map((entry) => buildDetail(entry, {
      position: "outlet",
      outletName,
    })));
  }

  return details;
}

function buildPromptSnapshotWorldbookActivations(
  result: PromptWorldbookTriggerResult | undefined,
): PromptSnapshotWorldbookActivation[] {
  if (!result) {
    return [];
  }

  const buildActivation = (
    activation: PromptWorldbookEntryActivation,
    insertion: PromptSnapshotWorldbookActivation["insertion"],
  ): PromptSnapshotWorldbookActivation => ({
    uid: activation.entry.uid,
    activationKey: activation.activationKey,
    source: {
      kind: activation.source.kind,
      worldbookId: activation.source.worldbookId,
      worldbookName: activation.source.worldbookName,
      assetScopeId: activation.source.assetScopeId,
    },
    insertion,
  });

  const activations: PromptSnapshotWorldbookActivation[] = [];
  activations.push(...result.beforeDetails.map((entry) => buildActivation(entry, { position: "before" })));
  activations.push(...result.afterDetails.map((entry) => buildActivation(entry, { position: "after" })));
  activations.push(...result.anTopDetails.map((entry) => buildActivation(entry, { position: "an_top" })));
  activations.push(...result.anBottomDetails.map((entry) => buildActivation(entry, { position: "an_bottom" })));
  activations.push(...result.emTopDetails.map((entry) => buildActivation(entry, { position: "em_top" })));
  activations.push(...result.emBottomDetails.map((entry) => buildActivation(entry, { position: "em_bottom" })));
  activations.push(...result.atDepthDetails.map((entry) => buildActivation(entry.activation, {
    position: "at_depth",
    depth: entry.depth,
    role: mapWorldbookRole(entry.role),
  })));
  for (const [outletName, entries] of Object.entries(result.outletEntryDetails ?? {})) {
    activations.push(...entries.map((entry) => buildActivation(entry, {
      position: "outlet",
      outletName,
    })));
  }

  return activations;
}

function mapWorldbookRole(role: number): ChatMessage["role"] {
  if (role === 1) {
    return "user";
  }
  if (role === 2) {
    return "assistant";
  }
  return "system";
}

export function buildPromptSnapshotPreview(snapshot: PromptAssemblySnapshot): PromptSnapshotPreview {
  return {
    presetId: snapshot.presetId,
    presetUpdatedAt: snapshot.presetUpdatedAt,
    presetVersion: snapshot.presetVersion,
    worldbookId: snapshot.worldbookId,
    worldbookUpdatedAt: snapshot.worldbookUpdatedAt,
    worldbookVersion: snapshot.worldbookVersion,
    regexProfileId: snapshot.regexProfileId,
    regexProfileUpdatedAt: snapshot.regexProfileUpdatedAt,
    regexProfileVersion: snapshot.regexProfileVersion,
    characterId: snapshot.characterId,
    characterVersionId: snapshot.characterVersionId,
    characterImportedFormat: snapshot.characterImportedFormat,
    characterContentHash: snapshot.characterContentHash,
    worldbookActivatedEntryUids: snapshot.worldbookActivatedEntryUids,
    worldbookActivatedEntries: snapshot.worldbookActivatedEntries,
    regexPreRuleNames: snapshot.regexPreRuleNames,
    regexPostRuleNames: snapshot.regexPostRuleNames,
    promptMode: snapshot.promptMode,
    assetManifestDigest: snapshot.assetManifestDigest,
    promptDigest: snapshot.promptDigest,
    tokenEstimate: snapshot.tokenEstimate,
  };
}

export function buildPromptSnapshotRecord(args: {
  floorId: string;
  sessionId: string;
  snapshot: PromptAssemblySnapshot;
}): PromptSnapshotRecord {
  return {
    floorId: args.floorId,
    sessionId: args.sessionId,
    presetId: args.snapshot.presetId,
    presetUpdatedAt: args.snapshot.presetUpdatedAt,
    presetVersion: args.snapshot.presetVersion,
    worldbookId: args.snapshot.worldbookId,
    worldbookUpdatedAt: args.snapshot.worldbookUpdatedAt,
    worldbookVersion: args.snapshot.worldbookVersion,
    regexProfileId: args.snapshot.regexProfileId,
    regexProfileUpdatedAt: args.snapshot.regexProfileUpdatedAt,
    regexProfileVersion: args.snapshot.regexProfileVersion,
    characterId: args.snapshot.characterId,
    characterVersionId: args.snapshot.characterVersionId,
    characterImportedFormat: args.snapshot.characterImportedFormat,
    characterContentHash: args.snapshot.characterContentHash,
    worldbookActivatedEntryUids: args.snapshot.worldbookActivatedEntryUids,
    worldbookActivatedEntries: args.snapshot.worldbookActivatedEntries,
    regexPreRuleNames: args.snapshot.regexPreRuleNames,
    regexPostRuleNames: args.snapshot.regexPostRuleNames,
    promptMode: args.snapshot.promptMode,
    assetManifestDigest: args.snapshot.assetManifestDigest,
    promptDigest: args.snapshot.promptDigest,
    tokenEstimate: args.snapshot.tokenEstimate,
    createdAt: args.snapshot.createdAt,
  };
}



export function buildPromptRuntimeBudgetTrace(args: {
  byGroup?: Record<string, number>;
  estimatedByGroup?: Record<string, number>;
  allocatedByGroup?: Record<string, number>;
  prunedByGroup?: Record<string, number>;
  trimReasons?: PromptTrimReason[];
}): PromptRuntimeBudgetTrace | undefined {
  const groups = new Set<string>([
    ...Object.keys(args.byGroup ?? {}),
    ...Object.keys(args.estimatedByGroup ?? {}),
    ...Object.keys(args.allocatedByGroup ?? {}),
    ...Object.keys(args.prunedByGroup ?? {}),
  ]);

  if (groups.size === 0) {
    return undefined;
  }

  return {
    ...(args.trimReasons && args.trimReasons.length > 0 ? { trimReasons: args.trimReasons } : {}),
    byGroup: Array.from(groups)
      .sort((left, right) => left.localeCompare(right))
      .map((group) => ({
        group,
        tokenCount: args.byGroup?.[group] ?? 0,
        ...(args.estimatedByGroup?.[group] !== undefined ? { estimatedTokenCount: args.estimatedByGroup[group] } : {}),
        ...(args.allocatedByGroup?.[group] !== undefined ? { allocatedTokenCount: args.allocatedByGroup[group] } : {}),
        ...(args.prunedByGroup?.[group] !== undefined ? { prunedTokenCount: args.prunedByGroup[group] } : {}),
      })),
  };
}

function buildPromptRuntimeMacroTrace(args: {
  warnings?: StMacroWarning[];
  usedNames?: string[];
  mutationPreview?: StMacroMutationPreview[];
  stagedMutations?: StMacroStagedMutation[];
  traces?: StMacroTraceEntry[];
}): PromptRuntimeTrace["macro"] {
  return buildPromptRuntimeMacroTraceFromProjector(args);
}

export function buildPromptRuntimeTrace(args: {
  traceSeed: PromptRuntimeTraceSeed;
  preprocessedUserMessage?: string;
}): PromptRuntimeTrace {
  const macro = buildPromptRuntimeMacroTrace({
    warnings: args.traceSeed.macroWarnings,
    usedNames: args.traceSeed.macroUsedNames,
    mutationPreview: args.traceSeed.macroMutationPreview,
    stagedMutations: args.traceSeed.macroStagedMutations,
    traces: args.traceSeed.macroTraces,
  });
  const regex = buildPromptRuntimeRegexTrace({
    userInputRules: args.traceSeed.regexPreRules,
    aiOutputRules: args.traceSeed.regexPostRules,
    preprocessedUserMessage: args.preprocessedUserMessage ?? args.traceSeed.regexPromptUserInputText,
    phases: args.traceSeed.regexPhases,
    reservedPlacements: args.traceSeed.regexReservedPlacements,
    substitutionMode: args.traceSeed.regexSubstitutionMode,
  });

  return {
    preset: {
      selectedPromptOrderCharacterId: args.traceSeed.selectedPromptOrderCharacterId,
      ignoredPromptOrderCharacterIds: args.traceSeed.ignoredPromptOrderCharacterIds,
      unsupportedFields: args.traceSeed.unsupportedPresetFields,
      ignoredFields: args.traceSeed.ignoredPresetFields,
      unresolvedMarkers: args.traceSeed.unresolvedPresetMarkers,
      warnings: args.traceSeed.presetWarnings,
      triggerFilteredEntryIds: args.traceSeed.triggerFilteredEntryIds,
      inChatInsertedEntryIds: args.traceSeed.inChatInsertedEntryIds,
      continueNudgeApplied: args.traceSeed.continueNudgeApplied,
      continueNudgeText: args.traceSeed.continueNudgeText,
      namesBehaviorApplied: args.traceSeed.namesBehaviorApplied,
    },
    worldbook: {
      hitCount: args.traceSeed.worldbookHits,
      ...(args.traceSeed.worldbookMatches ? { matches: args.traceSeed.worldbookMatches } : {}),
    },
    ...(regex ? { regex } : {}),
    memory: buildPromptRuntimeMemoryTrace({
      summaryInjected: args.traceSeed.memorySummaryInjected,
      memoryTrace: args.traceSeed.memoryRuntimeTrace,
    }),
    ...(macro ? { macro } : {}),
  };
}
