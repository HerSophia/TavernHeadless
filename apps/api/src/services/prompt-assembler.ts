import { createHash } from "node:crypto";

import { normalizePositiveInt } from "../lib/utils.js";
import { parseSessionCharacterSnapshot, type SessionCharacterSnapshot } from "../lib/character-snapshot.js";
import {
  compilePromptGraph,
  MessageBuilder,
  type ChatMessage,
  type MemoryInjectionResult,
  type PromptRunIntent,
  type PromptGraphWorldbookEntry,
  type PromptSnapshotRecord,
  type PromptRuntimeBudgetTrace as CorePromptRuntimeBudgetTrace,
  type PromptRuntimeDeliveryDegradeReason,
  type PromptRuntimeDeliveryTrace as CorePromptRuntimeDeliveryTrace,
  type PromptRuntimeMemoryTrace as CorePromptRuntimeMemoryTrace,
  type PromptRuntimePresetTrace as CorePromptRuntimePresetTrace,
  type PromptRuntimeRegexTrace as CorePromptRuntimeRegexTrace,
  type PromptRuntimeStructureTrace as CorePromptRuntimeStructureTrace,
  type PromptRuntimeTrace as CorePromptRuntimeTrace,
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
  applyRegexScripts,
  REGEX_PLACEMENT,
  type STRegexScript,
  type STWorldBook,
  type STWorldBookEntry,
} from "@tavern/adapters-sillytavern";

import type { AppDb } from "../db/client.js";
import {
  PromptResourceLoader,
  type LoadedPromptPreset,
  type LoadedPromptRegexProfile,
  type LoadedPromptWorldbook,
} from "./prompt-resource-loader.js";
import { VariableService } from "./variable-service.js";
import {
  evaluateStMacros,
  type StMacroEvalResult,
  type StMacroMutationPreview,
  type StMacroStagedMutation,
  type StMacroTraceEntry,
  type StMacroJsonValue,
  type StMacroVariableSnapshot,
  type StMacroWarning,
} from "./st-macros/index.js";
import { stringifyStMacroValue } from "./st-macros/variable-path.js";

export interface SessionPromptInfo {
  presetId: string | null;
  worldbookProfileId: string | null;
  regexProfileId: string | null;
  metadataJson: string | null;
  characterSnapshotJson: string | null;
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

const READONLY_PROMPT_MACRO_KEYS = [
  "systemPrompt",
  "authorsNote",
  "defaultAuthorsNote",
  "charPrompt",
  "charInstruction",
  "charDepthPrompt",
  "mesExamples",
  "mesExamplesRaw",
  "model",
  "summary",
  "lastMessage",
  "lastUserMessage",
  "lastCharMessage",
  "lastGenerationType",
] as const;

type ReadonlyPromptMacroKey = (typeof READONLY_PROMPT_MACRO_KEYS)[number];

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
  worldbookActivatedEntryUids: number[];
  regexPreRuleNames: string[];
  regexPostRuleNames: string[];
  promptMode: PromptMode;
  promptDigest: string;
  tokenEstimate: number;
}

export interface PromptAssemblySnapshot extends PromptSnapshotPreview {
  createdAt: number;
  preset: LoadedPromptPreset | null;
  worldbook: LoadedPromptWorldbook | null;
  regexProfile: LoadedPromptRegexProfile | null;
  metadata: SessionMetadata;
  character?: CharacterSnapshot;
  userSnapshot?: UserSnapshot;
  persona?: PersonaInfo;
  variables: Record<string, unknown>;
  macroWarnings?: StMacroWarning[];
  macroUsedNames: string[];
  macroMutationPreview?: StMacroMutationPreview[];
  macroStagedMutations?: StMacroStagedMutation[];
  macroTraces?: StMacroTraceEntry[];
}

export interface WorldbookMatchSource {
  kind: "session_worldbook" | "character_book";
  worldbookId: string | null;
  worldbookName: string;
}

export interface WorldbookMatchInsertion {
  position: "before" | "after" | "at_depth" | "outlet";
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

interface PromptWorldbookTriggerResult extends TriggerResult {
  sourceByUid: Map<number, WorldbookMatchSource>;
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
  | "unsupported"
  | "none";

export type PromptRuntimePresetTrace = CorePromptRuntimePresetTrace;

export type PromptRuntimeWorldbookTrace = CorePromptRuntimeWorldbookTrace<WorldbookMatchDetail>;

export type PromptRuntimeRegexTrace = CorePromptRuntimeRegexTrace;

export type PromptRuntimeBudgetTrace = CorePromptRuntimeBudgetTrace;

export type PromptRuntimeMemoryTrace = CorePromptRuntimeMemoryTrace;

export type PromptStructureMode = "default" | "strict_alternating" | "no_assistant";

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
  macro?: PromptRuntimeMacroTrace;
}

export interface AssembleResult {
  messages: ChatMessage[];
  sendDirectives: PromptSendDirectives;
  preProcess?: (messages: ChatMessage[]) => ChatMessage[];
  postProcess?: (text: string) => string;
  tokenUsage: {
    total: number;
    availableForReply: number;
    byGroup?: Record<string, number>;
    prunedByGroup?: Record<string, number>;
  };
  debug?: AssembleDebugInfo;
  promptSnapshot: PromptAssemblySnapshot;
}

export interface AssembleDebugInfo {
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
  worldbookMatches?: WorldbookMatchDetail[];
  macroWarnings?: StMacroWarning[];
  macroUsedNames?: string[];
  macroMutationPreview?: StMacroMutationPreview[];
  macroStagedMutations?: StMacroStagedMutation[];
  macroTraces?: StMacroTraceEntry[];
  runtimeTrace?: PromptRuntimeTrace;
}

export interface AssemblePromptOptions {
  includeDebug?: boolean;
  maxContextTokensOverride?: number;
  variableContext?: PromptVariableContextInput;
  intent?: PromptRunIntent;
  assistantPrefillStrategy?: AssistantPrefillExecutionStrategy;
  includeWorldbookMatchTrace?: boolean;
  runKind?: PromptMacroRunKind;
}

const DEFAULT_SYSTEM_PROMPT = "You are a helpful assistant.";
const DEFAULT_MAX_TOKENS = 1000;
const DEFAULT_MACRO_MAX_DEPTH = 16;
const DEFAULT_MACRO_MAX_STEPS = 256;
const DEFAULT_MACRO_MAX_EXPANDED_LENGTH = 32_768;
const DEFAULT_MACRO_MAX_MUTATION_COUNT = 128;

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
  const character = parseCharacterSnapshot(session.characterSnapshotJson);
  const userSnapshot = parseUserSnapshot(session.userSnapshotJson ?? null);
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
    memorySummary,
    maxPrompt: normalizePositiveInt(options.maxContextTokensOverride) ?? DEFAULT_MAX_TOKENS,
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
    macroUsedNames: aggregatedMacroUsedNames,
    macroWarnings: aggregatedMacroWarnings,
    macroMutationPreview: aggregatedMacroMutationPreview,
    macroStagedMutations: aggregatedMacroStagedMutations,
    macroTraces: aggregatedMacroTraces,
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
  let maxPromptTokens = normalizePositiveInt(options.maxContextTokensOverride) ?? DEFAULT_MAX_TOKENS;
  const promptIntent = options.intent ?? "normal";
  let mode: AssembleDebugInfo["mode"] = "fallback";
  let worldbookHits = 0;
  let worldBookResults: PromptWorldbookTriggerResult | undefined;
  let worldbookMatches: WorldbookMatchDetail[] | undefined;
  let characterOverridesHandledInPromptIR = false;
  let tokenUsageByGroup: Record<string, number> | undefined;
  let prunedTokenUsageByGroup: Record<string, number> | undefined;
  let memorySummaryHandledInPromptIR = false;

  const presetData = promptSnapshot.preset?.preset ?? null;
  const sendDirectives = buildPromptSendDirectives(presetData, promptIntent);
  const assistantPrefillRequested = typeof sendDirectives.assistantPrefill === "string"
    && sendDirectives.assistantPrefill.trim().length > 0;
  const assistantPrefillStrategy = assistantPrefillRequested
    ? (options.assistantPrefillStrategy ?? "unsupported")
    : "none";

  if (presetData) {
    const runtimeWorldbooks = collectPromptWorldbooks(promptSnapshot.worldbook, promptSnapshot.character);

    if (runtimeWorldbooks.length > 0) {
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
    worldbookHits = promptSnapshot.worldbookActivatedEntryUids.length;

    const compatInput = {
      preset: presetData,
      worldBookResults,
      chatHistory: compatHistory as Array<{ role: "user" | "assistant"; content: string }>,
      characterDescription: promptSnapshot.character?.description,
      characterPersonality: promptSnapshot.character?.personality,
      scenario: promptSnapshot.character?.scenario,
      exampleDialogue: promptSnapshot.character?.exampleDialogue,
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
      ? createCompatPlusMemoryInjection(memorySummary, tokenCounter)
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
            exampleDialogue: promptSnapshot.character?.exampleDialogue,
            memorySummary,
            maxTokens: normalizePositiveInt(options.maxContextTokensOverride) ?? presetData.maxContext,
            reservedForReply: presetData.maxTokens,
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
    const assembled = builder.build(promptIR);
    const assembledBudgetUsage = assembled.tokenUsage as typeof assembled.tokenUsage & {
      byGroup?: Record<string, number>;
      prunedByGroup?: Record<string, number>;
    };

    messages = assembled.messages;
    maxPromptTokens = promptIR.metadata.maxTokens;
    tokenUsageByGroup = assembledBudgetUsage.byGroup;
    prunedTokenUsageByGroup = assembledBudgetUsage.prunedByGroup;
    mode = "preset";
  } else {
    maxPromptTokens = normalizePositiveInt(options.maxContextTokensOverride) ?? DEFAULT_MAX_TOKENS;
    messages = buildFallbackMessages(fullHistory, promptSnapshot.character, persona);
  }

  if (options.includeWorldbookMatchTrace) {
    worldbookMatches = buildWorldbookMatchDetails(worldBookResults);
  }

  if (memorySummary && !memorySummaryHandledInPromptIR) {
    messages = injectMemorySummary(messages, memorySummary);
  }
  if (!characterOverridesHandledInPromptIR) {
    messages = injectCharacterSystemPrompt(messages, promptSnapshot.character);
    messages = injectCharacterPostHistoryInstructions(messages, promptSnapshot.character);
  }

  promptSnapshot.regexPreRuleNames = collectRegexRuleNames(enabledRegexScripts, REGEX_PLACEMENT.USER_INPUT);
  promptSnapshot.regexPostRuleNames = collectRegexRuleNames(enabledRegexScripts, REGEX_PLACEMENT.AI_OUTPUT);

  let preProcess: AssembleResult["preProcess"];
  let postProcess: AssembleResult["postProcess"];
  const substituteRegexParams = createRegexMacroSubstituter(promptSnapshot.variables);
  const regexContextBase = {
    substituteFindParams: substituteRegexParams,
    substituteReplaceParams: substituteRegexParams,
  };

  if (enabledRegexScripts.length > 0) {
    preProcess = (candidateMessages: ChatMessage[]): ChatMessage[] => {
      const depthByMessageIndex = buildRegexDepthByMessageIndex(candidateMessages);

      return candidateMessages.map((message, index) => {
        if (message.role === "user") {
          return {
            ...message,
            content: applyRegexScripts(
              message.content,
              enabledRegexScripts,
              REGEX_PLACEMENT.USER_INPUT,
              {
                ...regexContextBase,
                depth: depthByMessageIndex[index] ?? 0,
              },
            ),
          };
        }

        return message;
      });
    };

    postProcess = (text: string): string => {
      return applyRegexScripts(text, enabledRegexScripts, REGEX_PLACEMENT.AI_OUTPUT, {
        ...regexContextBase,
        depth: 0,
      });
    };
  }

  const tokenEstimate = messages.reduce((sum, message) => sum + tokenCounter.count(message.content), 0);
  const availableForReply = Math.max(0, maxPromptTokens - tokenEstimate);
  promptSnapshot.promptDigest = createPromptDigest(messages);
  promptSnapshot.tokenEstimate = tokenEstimate;

  const debug: AssembleDebugInfo | undefined = options.includeDebug
    ? {
        mode,
        promptIntent,
        runtimeTrace: undefined,
        assistantPrefillApplied: shouldMarkAssistantPrefillApplied(assistantPrefillStrategy),
        assistantPrefillStrategy,
        presetUsed: presetData !== null,
        worldbookHits,
        regexPreRules: promptSnapshot.regexPreRuleNames,
        regexPostRules: promptSnapshot.regexPostRuleNames,
        memorySummaryInjected: Boolean(memorySummary),
        reservedVariableCollisions,
        selectedPromptOrderCharacterId: 100000,
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
        ...(worldbookMatches ? { worldbookMatches } : {}),
        macroWarnings: promptSnapshot.macroWarnings,
        macroUsedNames: promptSnapshot.macroUsedNames,
        macroMutationPreview: promptSnapshot.macroMutationPreview,
        macroStagedMutations: promptSnapshot.macroStagedMutations,
        macroTraces: promptSnapshot.macroTraces,
      }
    : undefined;

  return {
    messages,
    sendDirectives,
    preProcess,
    postProcess,
    tokenUsage: {
      total: tokenEstimate,
      ...(tokenUsageByGroup ? { byGroup: tokenUsageByGroup } : {}),
      ...(prunedTokenUsageByGroup ? { prunedByGroup: prunedTokenUsageByGroup } : {}),
      availableForReply,
    },
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

function injectCharacterSystemPrompt(messages: ChatMessage[], character?: CharacterSnapshot): ChatMessage[] {
  if (!character?.systemPrompt?.trim()) {
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
  return scripts
    .filter((script) => !script.disabled && script.placement.includes(placement))
    .map((script) => script.scriptName);
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
  const warnings: StMacroWarning[] = [];

  const metadata = parseSessionMetadata(args.session.metadataJson);
  const metadataText = (key: string): string | undefined => {
    const value = metadata[key];
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
  };

  const resolveFirstNonEmpty = (...candidates: Array<string | undefined>): string | undefined => {
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        return candidate.trim();
      }
    }
    return undefined;
  };

  const resolveOptionalMacroValue = (args: {
    macroName: string;
    value: string | undefined;
    warningMessage: string;
  }): string => {
    if (typeof args.value === "string" && args.value.length > 0) {
      return args.value;
    }

    warnings.push({
      code: "macro_value_missing",
      message: args.warningMessage,
      macroName: args.macroName,
    });
    return "";
  };

  const recentMessages = resolveRecentMessageMacroValues({
    visibleMessages: args.chatHistory,
  });
  const ordinaryStringVariables = Object.fromEntries(
    Object.entries(args.ordinaryVariables).map(([key, value]) => [key, stringifyPromptVariableValue(value)]),
  );

  const presetPromptByIdentifier = (identifier: string): string | undefined => {
    const prompt = args.preset?.preset.prompts.find((entry) => entry.identifier === identifier);
    return typeof prompt?.content === "string" && prompt.content.trim().length > 0 ? prompt.content.trim() : undefined;
  };
  const presetMainPrompt = presetPromptByIdentifier("main");
  const presetJailbreakPrompt = presetPromptByIdentifier("jailbreak");
  const presetNsfwPrompt = presetPromptByIdentifier("nsfw");
  const presetContinueNudgePrompt = typeof args.preset?.preset.continueNudgePrompt === "string"
    && args.preset.preset.continueNudgePrompt.trim().length > 0
    ? args.preset.preset.continueNudgePrompt.trim()
    : undefined;
  const presetNewChatPrompt = typeof args.preset?.preset.newChatPrompt === "string"
    && args.preset.preset.newChatPrompt.trim().length > 0
    ? args.preset.preset.newChatPrompt.trim()
    : undefined;
  const presetAssistantPrefill = typeof args.preset?.preset.assistantPrefill === "string"
    && args.preset.preset.assistantPrefill.trim().length > 0
    ? args.preset.preset.assistantPrefill.trim()
    : undefined;
  const presetAuthorsNoteCandidate = resolveFirstNonEmpty(
    presetJailbreakPrompt,
    presetNsfwPrompt,
  );
  const fallbackSessionModelName = typeof args.session.metadataJson === "string"
    ? (() => {
        const metadata = parseSessionMetadata(args.session.metadataJson);
        const sessionModel = metadata.model;
        return typeof sessionModel === "string" && sessionModel.trim().length > 0 ? sessionModel.trim() : undefined;
      })()
    : undefined;
  const resolvedModelName = fallbackSessionModelName;

  const resolvedSystemPrompt = resolveFirstNonEmpty(
    metadataText("systemPrompt"),
    metadataText("system_prompt"),
    presetMainPrompt,
    args.character?.systemPrompt,
  );
  const resolvedAuthorsNote = resolveFirstNonEmpty(
    metadataText("authorsNote"),
    metadataText("authors_note"),
    presetAuthorsNoteCandidate,
    args.character?.creatorNotes,
  );
  const resolvedDefaultAuthorsNote = resolveFirstNonEmpty(
    metadataText("defaultAuthorsNote"),
    metadataText("default_authors_note"),
  );
  const resolvedCharPrompt = resolveFirstNonEmpty(
    args.character?.systemPrompt,
    presetMainPrompt,
  );
  const resolvedCharInstruction = resolveFirstNonEmpty(
    args.character?.postHistoryInstructions,
    presetContinueNudgePrompt,
    presetAssistantPrefill,
  );
  const resolvedCharDepthPrompt = resolveFirstNonEmpty(
    args.character?.postHistoryInstructions,
    presetContinueNudgePrompt,
  );

  for (const key of READONLY_PROMPT_MACRO_KEYS) {
    if (Object.prototype.hasOwnProperty.call(ordinaryStringVariables, key)) {
      warnings.push({
        code: "macro_readonly_name_conflict",
        message: `Ordinary variable '${key}' collides with readonly macro '${key}'. The readonly macro value takes precedence.`,
        macroName: key,
      });
    }
  }

  const readonlyValues: Record<string, string> = {
    user: args.userSnapshot?.name ?? args.persona?.name ?? ordinaryStringVariables.user ?? "",
    char: args.character?.name ?? ordinaryStringVariables.char ?? "",
    description: args.character?.description ?? "",
    personality: args.character?.personality ?? "",
    scenario: args.character?.scenario ?? "",
    persona: args.persona?.description ?? args.userSnapshot?.description ?? presetNewChatPrompt ?? "",
    systemPrompt: resolveOptionalMacroValue({
      macroName: "systemPrompt",
      value: resolvedSystemPrompt,
      warningMessage: "Macro systemPrompt has no resolved value and fell back to empty string.",
    }),
    defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
    charPrompt: resolveOptionalMacroValue({
      macroName: "charPrompt",
      // 当前 Beta3 只做最小兼容：优先角色卡 systemPrompt，缺失时近似回退到 preset main prompt。
      value: resolvedCharPrompt,
      warningMessage: "Macro charPrompt has no resolved value and fell back to empty string.",
    }),
    charInstruction: resolveOptionalMacroValue({
      macroName: "charInstruction",
      // 当前数据模型没有与 ST 一一对应的独立 charInstruction 字段。
      // 因此先优先使用角色卡 postHistoryInstructions，再近似回退到 continue nudge / assistant prefill。
      value: resolvedCharInstruction,
      warningMessage: "Macro charInstruction has no resolved value and fell back to empty string.",
    }),
    charDepthPrompt: resolveOptionalMacroValue({
      macroName: "charDepthPrompt",
      // 当前数据模型没有独立 depth prompt 源，先优先使用角色卡 postHistoryInstructions，
      // 缺失时仅近似回退到 continue nudge，不伪造其他来源。
      value: resolvedCharDepthPrompt,
      warningMessage: "Macro charDepthPrompt has no resolved value and fell back to empty string.",
    }),
    mesExamples: resolveOptionalMacroValue({
      macroName: "mesExamples",
      value: args.character?.exampleDialogue,
      warningMessage: "Macro mesExamples has no resolved value and fell back to empty string.",
    }),
    mesExamplesRaw: resolveOptionalMacroValue({
      macroName: "mesExamplesRaw",
      value: args.character?.exampleDialogue,
      warningMessage: "Macro mesExamplesRaw has no resolved value and fell back to empty string.",
    }),
    charAuthorsNote: args.character?.creatorNotes ?? "",
    authorsNote: resolveOptionalMacroValue({
      macroName: "authorsNote",
      value: resolvedAuthorsNote,
      warningMessage: "Macro authorsNote has no resolved value and fell back to empty string.",
    }),
    defaultAuthorsNote: resolveOptionalMacroValue({
      macroName: "defaultAuthorsNote",
      value: resolvedDefaultAuthorsNote,
      warningMessage: "Macro defaultAuthorsNote has no resolved value and fell back to empty string.",
    }),
    model: resolveOptionalMacroValue({
      macroName: "model",
      value: resolvedModelName,
      warningMessage: "Macro model has no resolved value and fell back to empty string.",
    }),
    maxPrompt: String(args.maxPrompt),
    summary: args.memorySummary ?? "",
    lastMessage: recentMessages.lastMessage,
    lastUserMessage: recentMessages.lastUserMessage,
    lastCharMessage: recentMessages.lastCharMessage,
    lastGenerationType: args.runKind,
  };

  const variableSnapshot: StMacroVariableSnapshot = {
    local: { ...args.variableSnapshot.local },
    global: { ...args.variableSnapshot.global },
    plain: { ...ordinaryStringVariables, ...readonlyValues },
  };

  const values = { ...ordinaryStringVariables, ...readonlyValues };

  return { values, variableSnapshot, warnings };
}

function resolvePromptRunKind(options: AssemblePromptOptions): PromptMacroRunKind {
  return options.runKind ?? (options.includeDebug ? "dry_run" : "respond");
}

function shouldIncludeCurrentUserMessageInRecentMacros(args: {
  runKind: PromptMacroRunKind;
  currentUserMessage?: string;
}): boolean {
  if (!args.currentUserMessage || args.currentUserMessage.trim().length === 0) {
    return false;
  }

  return args.runKind === "dry_run"
    || args.runKind === "respond"
    || args.runKind === "regenerate"
    || args.runKind === "retry";
}

function buildVisibleRecentMacroMessages(args: {
  committedHistory: ChatMessage[];
  currentUserMessage?: string;
  includeCurrentUserMessage: boolean;
}): Array<{ role: "user" | "assistant"; content: string }> {
  // recent message 宏只消费“当前宏求值可见”的 user / assistant 消息。
  // 这里不负责从数据库加载历史，只负责把调用方已经选定的 committed history
  // 与当前入口可能附带的临时 user 输入组装成显式的可见消息集。
  // system message 不进入 recent message 候选。
  // respond / dry-run 会追加当前 user 输入；regenerate / retry 会把当前 turn 的 user 输入显式补回，
  // 但不会伪造尚未提交的 assistant 输出。
  const committedVisibleMessages = args.committedHistory
    .filter((message) => (message.role === "user" || message.role === "assistant") && message.content.trim().length > 0)
    .map((message) => ({
      role: message.role as "user" | "assistant",
      content: message.content,
    }));

  if (!args.includeCurrentUserMessage || !args.currentUserMessage || args.currentUserMessage.trim().length === 0) {
    return committedVisibleMessages;
  }

  return [
    ...committedVisibleMessages,
    { role: "user", content: args.currentUserMessage },
  ];
}

function resolveRecentMessageMacroValues(args: {
  visibleMessages: Array<{ role: "user" | "assistant"; content: string }>;
}): {
  lastMessage: string;
  lastUserMessage: string;
  lastCharMessage: string;
} {
  // 输入必须已经是 recent message 宏可见的消息集。
  // 该 helper 不再负责区分 committed / 当前输入，也不再处理 system/hidden/page/branch 过滤。
  const visibleMessages = args.visibleMessages.filter((message) => message.content.trim().length > 0);
  const lastMessage = [...visibleMessages].reverse()[0]?.content ?? "";
  const lastUserMessage = [...visibleMessages].reverse().find((message) => message.role === "user")?.content ?? "";
  const lastCharMessage = [...visibleMessages].reverse().find((message) => message.role === "assistant")?.content ?? "";
  return {
    lastMessage,
    lastUserMessage,
    lastCharMessage,
  };
}

export function evaluatePromptMacroValues(args: {
  phase: "dry_run" | "assemble" | "commit_consume";
  values: Record<string, string>;
  variableSnapshot?: StMacroVariableSnapshot;
  sampleText: string;
}): StMacroEvalResult {
  return evaluateStMacros(args.sampleText, {
    phase: args.phase,
    values: args.values,
    variableSnapshot: args.variableSnapshot,
    maxDepth: DEFAULT_MACRO_MAX_DEPTH,
    maxSteps: DEFAULT_MACRO_MAX_STEPS,
    maxExpandedLength: DEFAULT_MACRO_MAX_EXPANDED_LENGTH,
    maxMutationCount: DEFAULT_MACRO_MAX_MUTATION_COUNT,
  });
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
  return (text: string): string => text.replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, (_match, key: string) => {
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      return "";
    }

    if (!Object.prototype.hasOwnProperty.call(variables, normalizedKey)) {
      return `{{${normalizedKey}}}`;
    }

    const value = variables[normalizedKey];
    if (value === null || value === undefined) return "";
    return String(value);
  });
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
  const structureSuppressesAssistantPrefill = effectiveStructurePolicy?.mode === "no_assistant";
  if (noAssistant && args.structurePolicy?.mode !== "no_assistant") {
    degradeReasons.push("no_assistant_override");
  }

  const structured = effectiveStructurePolicy
    ? applyPromptStructurePolicy(args.messages, effectiveStructurePolicy)
    : undefined;
  let effectiveAssistantPrefillStrategy: AssistantPrefillExecutionStrategy = assistantPrefillRequested
    ? args.assistantPrefillStrategy
    : "none";
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
  const materializeAssistantPrefillFallback = args.materializeAssistantPrefillFallback ?? true;
  const baseMessages = structured?.messages ?? args.messages;
  const messages = materializeAssistantPrefillFallback
    ? materializePromptSendMessages(baseMessages, args.sendDirectives, effectiveAssistantPrefillStrategy)
    : baseMessages;
  const lastMessageRole = resolveLastConversationRole(messages);
  const assistantPrefillApplied = assistantPrefillRequested
    && shouldMarkAssistantPrefillApplied(effectiveAssistantPrefillStrategy);

  return {
    messages,
    ...(structured ? { structureTrace: structured.trace } : {}),
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
  return strategy === "provider_native" || strategy === "assistant_message_fallback";
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
): SourcedWorldbook[] {
  const result: SourcedWorldbook[] = [];

  const worldbookData = worldbook?.worldbook;
  if (worldbookData) {
    result.push({
      worldbook: worldbookData,
      source: {
        kind: "session_worldbook",
        worldbookId: worldbook?.id ?? null,
        worldbookName: worldbookData.name ?? "session worldbook",
      },
    });
  }

  const characterBookWorldbook = parseCharacterBookWorldbook(character);
  if (characterBookWorldbook) {
    result.push({
      worldbook: characterBookWorldbook,
      source: {
        kind: "character_book",
        worldbookId: null,
        worldbookName: characterBookWorldbook.name ?? "character book",
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
    outletEntries: {},
    sourceByUid: new Map(),
    ...(context.traceEnabled ? { activationTraces: new Map<number, ActivationTrace>() } : {}),
  };

  for (const item of worldbooks) {
    const result = triggerWorldBook(item.worldbook.entries, context);
    merged.activated.push(...result.activated);
    merged.before.push(...result.before);
    merged.after.push(...result.after);
    merged.atDepth.push(...result.atDepth);
    if (result.activationTraces) {
      const target = merged.activationTraces ?? (merged.activationTraces = new Map<number, ActivationTrace>());
      for (const [uid, trace] of result.activationTraces.entries()) {
        target.set(uid, trace);
      }
    }
    const mergedOutletEntries = merged.outletEntries ?? (merged.outletEntries = {});
    for (const [name, entries] of Object.entries(result.outletEntries ?? {})) {
      mergedOutletEntries[name] = [...(mergedOutletEntries[name] ?? []), ...entries];
    }
    for (const entry of result.activated) {
      merged.sourceByUid.set(entry.uid, item.source);
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

  const beforeEntries = result.before.map((entry) => ({ id: String(entry.uid), content: entry.content, position: "before" as const }));
  const afterEntries = result.after.map((entry) => ({ id: String(entry.uid), content: entry.content, position: "after" as const }));
  const depthEntries = result.atDepth.map((entry) => ({
    id: String(entry.entry.uid),
    content: entry.entry.content,
    position: "depth" as const,
    depth: entry.depth,
  }));
  const outletEntries = Object.entries(result.outletEntries ?? {}).flatMap(([outletName, entries]) =>
    entries.map((entry) => ({ id: String(entry.uid), content: entry.content, position: "outlet" as const, outletName })),
  );

  return [...beforeEntries, ...afterEntries, ...depthEntries, ...outletEntries];
}

function buildRegexDepthByMessageIndex(messages: ChatMessage[]): number[] {
  return messages.map((_message, index) => index);
}

function buildWorldbookMatchDetails(result: PromptWorldbookTriggerResult | undefined): WorldbookMatchDetail[] {
  if (!result) {
    return [];
  }

  const activationTraceByUid = result.activationTraces;

  const buildDetail = (
    entry: STWorldBookEntry,
    insertion: WorldbookMatchInsertion,
  ): WorldbookMatchDetail => ({
    uid: entry.uid,
    comment: entry.comment,
    contentPreview: entry.content,
    order: entry.order,
    source: result.sourceByUid.get(entry.uid) ?? {
      kind: "session_worldbook",
      worldbookId: null,
      worldbookName: "unknown",
    },
    insertion,
    activation: activationTraceByUid?.get(entry.uid) ?? {
      mode: entry.constant ? "constant" : "triggered",
      recursionLevel: 0,
      firstMatch: null,
    },
  });

  const details: WorldbookMatchDetail[] = [];
  details.push(...result.before.map((entry) => buildDetail(entry, { position: "before" })));
  details.push(...result.after.map((entry) => buildDetail(entry, { position: "after" })));
  details.push(...result.atDepth.map((item) => buildDetail(item.entry, {
    position: "at_depth",
    depth: item.depth,
    role: item.role === 1 ? "user" : item.role === 2 ? "assistant" : "system",
  })));
  for (const [outletName, entries] of Object.entries(result.outletEntries ?? {})) {
    details.push(...entries.map((entry) => buildDetail(entry, {
      position: "outlet",
      outletName,
    })));
  }

  return details;
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
    worldbookActivatedEntryUids: snapshot.worldbookActivatedEntryUids,
    regexPreRuleNames: snapshot.regexPreRuleNames,
    regexPostRuleNames: snapshot.regexPostRuleNames,
    promptMode: snapshot.promptMode,
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
    worldbookActivatedEntryUids: args.snapshot.worldbookActivatedEntryUids,
    regexPreRuleNames: args.snapshot.regexPreRuleNames,
    regexPostRuleNames: args.snapshot.regexPostRuleNames,
    promptMode: args.snapshot.promptMode,
    promptDigest: args.snapshot.promptDigest,
    tokenEstimate: args.snapshot.tokenEstimate,
    createdAt: args.snapshot.createdAt,
  };
}



export function buildPromptRuntimeBudgetTrace(args: {
  byGroup?: Record<string, number>;
  prunedByGroup?: Record<string, number>;
}): PromptRuntimeBudgetTrace | undefined {
  const groups = new Set<string>([
    ...Object.keys(args.byGroup ?? {}),
    ...Object.keys(args.prunedByGroup ?? {}),
  ]);

  if (groups.size === 0) {
    return undefined;
  }

  return {
    byGroup: Array.from(groups)
      .sort((left, right) => left.localeCompare(right))
      .map((group) => ({
        group,
        tokenCount: args.byGroup?.[group] ?? 0,
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
  const warnings = args.warnings ?? [];
  const usedNames = args.usedNames ?? [];
  const mutationPreview = args.mutationPreview ?? [];
  const stagedMutations = args.stagedMutations ?? [];
  const traces = args.traces ?? [];

  if (
    warnings.length === 0
    && usedNames.length === 0
    && mutationPreview.length === 0
    && stagedMutations.length === 0
    && traces.length === 0
  ) {
    return undefined;
  }

  const mappedWarnings = warnings.map((warning) => ({
    code: warning.code,
    message: warning.message,
    ...(warning.macroName ? { macroName: warning.macroName } : {}),
    ...(warning.rawText ? { rawText: warning.rawText } : {}),
  }));
  const mappedMutationPreview = mutationPreview.map((item) => ({
    kind: item.kind,
    scope: item.scope,
    key: item.key,
    ...(item.value !== undefined ? { value: stringifyPromptVariableValue(item.value) } : {}),
  }));
  const mappedStagedMutations = stagedMutations.map((item) => ({
    kind: item.kind,
    scope: item.scope,
    key: item.key,
    ...(item.value !== undefined ? { value: stringifyPromptVariableValue(item.value) } : {}),
    sourceMacro: item.sourceMacro,
  }));
  const mappedTraces = traces.map((trace) => ({
    macroName: trace.macroName,
    rawText: trace.rawText,
    resolvedText: trace.resolvedText,
    ...(trace.phase ? { phase: trace.phase } : {}),
    ...(trace.sourceKind ? { sourceKind: trace.sourceKind } : {}),
    ...(trace.selectedBranch ? { selectedBranch: trace.selectedBranch } : {}),
  }));

  return {
    warnings: mappedWarnings,
    usedNames,
    mutationPreview: mappedMutationPreview,
    stagedMutations: mappedStagedMutations,
    traces: mappedTraces,
  };
}


export function buildPromptRuntimeTrace(args: {
  debug: AssembleDebugInfo;
  preprocessedUserMessage?: string;
}): PromptRuntimeTrace {
  const macro = buildPromptRuntimeMacroTrace({
    warnings: args.debug.macroWarnings,
    usedNames: args.debug.macroUsedNames,
    mutationPreview: args.debug.macroMutationPreview,
    stagedMutations: args.debug.macroStagedMutations,
    traces: args.debug.macroTraces,
  });

  return {
    preset: {
      selectedPromptOrderCharacterId: args.debug.selectedPromptOrderCharacterId,
      ignoredPromptOrderCharacterIds: args.debug.ignoredPromptOrderCharacterIds,
      unsupportedFields: args.debug.unsupportedPresetFields,
      ignoredFields: args.debug.ignoredPresetFields,
      unresolvedMarkers: args.debug.unresolvedPresetMarkers,
      warnings: args.debug.presetWarnings,
      triggerFilteredEntryIds: args.debug.triggerFilteredEntryIds,
      inChatInsertedEntryIds: args.debug.inChatInsertedEntryIds,
      continueNudgeApplied: args.debug.continueNudgeApplied,
      continueNudgeText: args.debug.continueNudgeText,
      namesBehaviorApplied: args.debug.namesBehaviorApplied,
    },
    worldbook: {
      hitCount: args.debug.worldbookHits,
      ...(args.debug.worldbookMatches ? { matches: args.debug.worldbookMatches } : {}),
    },
    regex: {
      userInputRules: args.debug.regexPreRules,
      aiOutputRules: args.debug.regexPostRules,
      preprocessedUserMessage: args.preprocessedUserMessage,
    },
    memory: {
      summaryInjected: args.debug.memorySummaryInjected,
    },
    ...(macro ? { macro } : {}),
    delivery: {
      assistantPrefillRequested: args.debug.assistantPrefillStrategy !== "none",
      assistantPrefillApplied: args.debug.assistantPrefillApplied,
      assistantPrefillStrategy: args.debug.assistantPrefillStrategy,
      allowAssistantPrefill: true,
      requireLastUser: false,
      noAssistant: false,
      lastMessageRole: null,
      endsWithUser: false,
      degraded: false,
      degradeReasons: [],
    },
  };
}
