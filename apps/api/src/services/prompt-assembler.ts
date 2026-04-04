/**
 * Prompt Assembler
 *
 * 从 DB 加载预设/世界书/正则 → 编排 Prompt IR → 裁剪 → 输出可发送的 ChatMessage[]。
 *
 * 这是 ChatService 与 SillyTavern 兼容层之间的桥梁。
 *
 * 完整链路：
 * Session (presetId, worldbookProfileId, regexProfileId)
 *   ↓ 从 DB 加载
 * STPreset + STWorldBookEntry[] + STRegexScript[]
 *   ↓ 世界书触发
 * triggerWorldBook(entries, context)
 *   ↓ Prompt 编排
 * assembleCompat(...) / assembleNativePrompt(...)
 *   ↓ Token 裁剪
 * MessageBuilder.build(promptIR)
 *   ↓ 正则挂载
 * { messages, preProcess, postProcess }
 */

import { createHash } from "node:crypto";

import { normalizePositiveInt } from "../lib/utils.js";
import { parseSessionCharacterSnapshot, type SessionCharacterSnapshot } from "../lib/character-snapshot.js";
import {
  assembleNativePrompt,
  MessageBuilder,
  type ChatMessage,
  type NativeWorldbookEntry,
  type PromptSnapshotRecord,
  type TokenCounter,
} from "@tavern/core";
import {
  assembleCompat,
  parseWorldBook,
  type TriggerContext,
  type TriggerResult,
  triggerWorldBook,
  applyRegexScripts,
  REGEX_PLACEMENT,
  type STPreset,
  type STWorldBook,
} from "@tavern/adapters-sillytavern";

import type { AppDb } from "../db/client.js";
import {
  PromptResourceLoader,
  type LoadedPromptPreset,
  type LoadedPromptRegexProfile,
  type LoadedPromptWorldbook,
} from "./prompt-resource-loader.js";
import { VariableService } from "./variable-service.js";

// ── 类型 ──────────────────────────────────────────────

/** Session 中与 Prompt 编排相关的字段 */
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

/** 会话冻结角色快照（从 session.characterSnapshotJson 解析） */
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
  [key: string]: unknown;
}

const RESERVED_PROMPT_ALIAS_KEYS = ["char", "user"] as const;
type ReservedPromptAlias = (typeof RESERVED_PROMPT_ALIAS_KEYS)[number];
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

/**
 * 单轮 Prompt 组装快照。
 *
 * 该对象在组装开始时冻结本轮使用的 prompt 资源与解析结果，
 * 后续组装逻辑只消费这份内存快照，不再回源读取 DB。
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
  variables: Record<string, unknown>;
}

export interface PromptVariableContextInput {
  sessionId: string;
  branchId?: string;
  floorId?: string;
  pageId?: string;
}

/** 编排结果 */
export interface AssembleResult {
  /** 裁剪后的最终消息数组 */
  messages: ChatMessage[];
  /** 前处理函数（正则 USER_INPUT）- 对每条用户消息的 content 进行处理 */
  preProcess?: (messages: ChatMessage[]) => ChatMessage[];
  /** 后处理函数（正则 AI_OUTPUT） */
  postProcess?: (text: string) => string;
  /** Token 使用统计 */
  tokenUsage: {
    total: number;
    availableForReply: number;
  };
  /** 调试元信息（dry-run 场景可选） */
  debug?: AssembleDebugInfo;
  /** 本轮冻结的 prompt 快照 */
  promptSnapshot: PromptAssemblySnapshot;
}

export interface AssembleDebugInfo {
  /** 编排模式 */
  mode: "preset" | "fallback";
  /** 是否启用了预设 */
  presetUsed: boolean;
  /** 世界书命中条目数 */
  worldbookHits: number;
  /** 用户输入正则规则名称 */
  regexPreRules: string[];
  /** AI 输出正则规则名称 */
  regexPostRules: string[];
  /** 是否注入了记忆摘要 */
  memorySummaryInjected: boolean;
  /** 被系统别名覆盖的持久化变量 key */
  reservedVariableCollisions: ReservedPromptAlias[];
}

export interface AssemblePromptOptions {
  /**
   * 是否返回调试元信息。
   * 默认 false，用于常规 respond/regenerate 场景减少开销。
   */
  includeDebug?: boolean;
  /** narrator 上下文预算覆盖（来自 slot binding / request override） */
  maxContextTokensOverride?: number;
  /** 当前回合可见变量的解析上下文 */
  variableContext?: PromptVariableContextInput;
}

// ── 默认 System Prompt ────────────────────────────────

const DEFAULT_SYSTEM_PROMPT = "You are a helpful assistant.";

/** 无预设时的最小 PromptIR 配置 */
const DEFAULT_MAX_TOKENS = 1000;

// ── 主函数 ────────────────────────────────────────────

/**
 * 从 DB 加载资源并编排 Prompt。
 *
 * @param db - 数据库实例
 * @param accountId - 当前账号 ID，用于 prompt 资源 ownership 校验
 * @param session - Session 的编排相关字段
 * @param chatHistory - 已加载的聊天历史（不含当前用户消息）
 * @param userMessage - 当前用户消息
 * @param tokenCounter - Token 计数器
 * @param memorySummary - 可选的记忆摘要文本（由 MemoryStore 提供）
 * @returns 编排结果
 */
export async function assemblePrompt(
  db: AppDb,
  accountId: string,
  session: SessionPromptInfo,
  chatHistory: ChatMessage[],
  userMessage: string,
  tokenCounter: TokenCounter,
  memorySummary?: string,
  options: AssemblePromptOptions = {}
): Promise<AssembleResult> {
  const resourceLoader = new PromptResourceLoader(db);

  // ── 1. 加载资源并冻结本轮快照 ──
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
  const {
    variables,
    reservedVariableCollisions,
  } = await resolvePromptVariables({
    db,
    accountId,
    character,
    persona,
    context: options.variableContext,
  });

  const promptSnapshot: PromptAssemblySnapshot = {
    createdAt: Date.now(),
    preset,
    worldbook,
    regexProfile,
    metadata,
    character,
    userSnapshot,
    persona,
    variables,
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

  // ── 2. 准备聊天历史（含当前用户消息）──
  const fullHistory: { role: "user" | "assistant"; content: string }[] = [
    ...chatHistory
      .filter((message) => message.role === "user" || message.role === "assistant")
      .map((message) => ({
        role: message.role as "user" | "assistant",
        content: message.content,
      })),
    { role: "user", content: userMessage },
  ];
  const enabledRegexScripts = (promptSnapshot.regexProfile?.scripts ?? []).filter(
    (script) => !script.disabled
  );

  // ── 3. 编排 ──
  let messages: ChatMessage[];
  let maxPromptTokens = normalizePositiveInt(options.maxContextTokensOverride) ?? DEFAULT_MAX_TOKENS;
  let mode: AssembleDebugInfo["mode"] = "fallback";
  let worldbookHits = 0;
  let usedNativePipeline = false;

  const presetData = promptSnapshot.preset?.preset ?? null;

  if (presetData) {
    let worldBookResults: TriggerResult | undefined;
    const worldbookData = promptSnapshot.worldbook?.worldbook;
    const runtimeWorldbooks = collectPromptWorldbooks(worldbookData, character);

    if (runtimeWorldbooks.length > 0) {
      const triggerMessages = fullHistory.map((message) => message.content).reverse();

      worldBookResults = triggerPromptWorldbooks(runtimeWorldbooks, {
        messages: triggerMessages,
        scanSources: {
          personaDescription: persona?.description,
          characterDescription: character?.description,
          characterPersonality: character?.personality,
          scenario: character?.scenario,
          creatorNotes: character?.creatorNotes,
        },
      });
      worldBookResults = applyWorldInfoRegexRules(worldBookResults, enabledRegexScripts, promptSnapshot.variables);
    }

    promptSnapshot.worldbookActivatedEntryUids = collectActivatedEntryUids(worldBookResults);
    worldbookHits = promptSnapshot.worldbookActivatedEntryUids.length;

    const useNativePipeline = promptSnapshot.promptMode === "native";
    usedNativePipeline = useNativePipeline;

    const promptIR = useNativePipeline
      ? assembleNativePrompt({
          systemPrompt: buildNativeSystemPrompt(presetData, character, persona),
          chatHistory: fullHistory,
          worldbookEntries: toNativeWorldbookEntries(worldBookResults),
          variables,
          memorySummary,
          maxTokens: normalizePositiveInt(options.maxContextTokensOverride) ?? presetData.maxContext,
          reservedForReply: presetData.maxTokens,
          tokenCounter,
        })
      : assembleCompat({
          preset: presetData,
          worldBookResults,
          chatHistory: fullHistory,
          characterDescription: character?.description,
          characterPersonality: character?.personality,
          scenario: character?.scenario,
          exampleDialogue: character?.exampleDialogue,
          personaDescription: persona?.description,
          variables,
        });

    const builder = new MessageBuilder(tokenCounter, {
      mergeAdjacentSameRole: true,
    });
    const assembled = builder.build(promptIR);

    messages = assembled.messages;
    maxPromptTokens = promptIR.metadata.maxTokens;
    mode = "preset";
  } else {
    maxPromptTokens = normalizePositiveInt(options.maxContextTokensOverride) ?? DEFAULT_MAX_TOKENS;
    messages = buildFallbackMessages(fullHistory, character, persona);
  }

  // ── 4. 记忆摘要注入 ──
  if (memorySummary && !usedNativePipeline) {
    messages = injectMemorySummary(messages, memorySummary);
  }
  messages = injectCharacterSystemPrompt(messages, character);
  messages = injectCharacterPostHistoryInstructions(messages, character);

  // ── 5. 正则处理函数 ──
  promptSnapshot.regexPreRuleNames = collectRegexRuleNames(
    enabledRegexScripts,
    REGEX_PLACEMENT.USER_INPUT
  );
  promptSnapshot.regexPostRuleNames = collectRegexRuleNames(
    enabledRegexScripts,
    REGEX_PLACEMENT.AI_OUTPUT
  );

  let preProcess: AssembleResult["preProcess"];
  let postProcess: AssembleResult["postProcess"];
  const substituteRegexParams = createRegexMacroSubstituter(promptSnapshot.variables);
  const regexContextBase = { substituteFindParams: substituteRegexParams, substituteReplaceParams: substituteRegexParams };

  if (enabledRegexScripts.length > 0) {
    preProcess = (candidateMessages: ChatMessage[]): ChatMessage[] => {
      return candidateMessages.map((message) => {
        if (message.role === "user") {
          return {
            ...message,
            content: applyRegexScripts(
              message.content,
              enabledRegexScripts,
              REGEX_PLACEMENT.USER_INPUT,
              {
                ...regexContextBase,
                channel: "prompt",
              }
            ),
          };
        }

        if (message.role === "assistant") {
          return {
            ...message,
            content: applyRegexScripts(
              message.content,
              enabledRegexScripts,
              REGEX_PLACEMENT.AI_OUTPUT,
              {
                ...regexContextBase,
                channel: "prompt",
              }
            ),
          };
        }

        return message;
      });
    };

    postProcess = (text: string): string => {
      return applyRegexScripts(text, enabledRegexScripts, REGEX_PLACEMENT.AI_OUTPUT, {
        ...regexContextBase,
        channel: "persist",
      });
    };
  }

  const effectiveMessages = previewPromptMessages(messages, preProcess);
  const tokenUsage = buildPromptTokenUsage(effectiveMessages, tokenCounter, maxPromptTokens);
  promptSnapshot.promptDigest = computePromptDigest(effectiveMessages);
  promptSnapshot.tokenEstimate = tokenUsage.total;

  const memorySummaryInjected =
    typeof memorySummary === "string" && memorySummary.trim().length > 0;

  const debug = options.includeDebug
    ? {
        mode,
        presetUsed: promptSnapshot.preset !== null,
        worldbookHits,
        regexPreRules: promptSnapshot.regexPreRuleNames,
        regexPostRules: promptSnapshot.regexPostRuleNames,
        memorySummaryInjected,
        reservedVariableCollisions,
      }
    : undefined;

  return {
    messages,
    preProcess,
    postProcess,
    tokenUsage,
    debug,
    promptSnapshot,
  };
}

export function buildPromptSnapshotPreview(
  snapshot: PromptAssemblySnapshot
): PromptSnapshotPreview {
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
    worldbookActivatedEntryUids: [...snapshot.worldbookActivatedEntryUids],
    regexPreRuleNames: [...snapshot.regexPreRuleNames],
    regexPostRuleNames: [...snapshot.regexPostRuleNames],
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
  const preview = buildPromptSnapshotPreview(args.snapshot);

  return {
    floorId: args.floorId,
    sessionId: args.sessionId,
    presetId: preview.presetId,
    presetUpdatedAt: preview.presetUpdatedAt,
    presetVersion: preview.presetVersion,
    worldbookId: preview.worldbookId,
    worldbookUpdatedAt: preview.worldbookUpdatedAt,
    worldbookVersion: preview.worldbookVersion,
    regexProfileId: preview.regexProfileId,
    regexProfileUpdatedAt: preview.regexProfileUpdatedAt,
    regexProfileVersion: preview.regexProfileVersion,
    worldbookActivatedEntryUids: preview.worldbookActivatedEntryUids,
    regexPreRuleNames: preview.regexPreRuleNames,
    regexPostRuleNames: preview.regexPostRuleNames,
    promptMode: preview.promptMode,
    promptDigest: preview.promptDigest,
    tokenEstimate: preview.tokenEstimate,
    createdAt: args.snapshot.createdAt,
  };
}

// ── 工具函数 ──────────────────────────────────────────

function parseCharacterSnapshot(snapshotJson: string | null): CharacterSnapshot | undefined {
  if (!snapshotJson) {
    return undefined;
  }

  return parseSessionCharacterSnapshot(snapshotJson);
}

function parseUserSnapshot(snapshotJson: string | null): UserSnapshot | undefined {
  if (!snapshotJson) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(snapshotJson) as Record<string, unknown>;
    if (typeof parsed !== "object" || parsed === null) {
      return undefined;
    }

    return parsed as UserSnapshot;
  } catch {
    return undefined;
  }
}

/**
 * 解析 session.metadataJson 为 SessionMetadata。
 * 解析失败返回空对象。
 */
function parseSessionMetadata(metadataJson: string | null): SessionMetadata {
  if (!metadataJson) return {};

  try {
    const parsed = JSON.parse(metadataJson);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

async function resolvePromptVariables(args: {
  db: AppDb;
  accountId: string;
  character?: CharacterSnapshot;
  persona?: PersonaInfo;
  context?: PromptVariableContextInput;
}): Promise<{
  variables: Record<string, unknown>;
  reservedVariableCollisions: ReservedPromptAlias[];
}> {
  const variables = Object.create(null) as Record<string, unknown>;

  if (args.context) {
    const variableService = new VariableService(args.db);
    const snapshot = await variableService.resolveSnapshot({
      accountId: args.accountId,
      sessionId: args.context.sessionId,
      branchId: args.context.branchId,
      floorId: args.context.floorId,
      pageId: args.context.pageId,
    });

    for (const entry of snapshot.resolved) {
      variables[entry.key] = entry.value;
    }
  }

  const reservedVariableCollisions = RESERVED_PROMPT_ALIAS_KEYS.filter((key) =>
    Object.prototype.hasOwnProperty.call(variables, key)
  );

  variables.char = args.character?.name ?? "Assistant";
  variables.user = args.persona?.name ?? "User";

  return {
    variables,
    reservedVariableCollisions,
  };
}

export function createRegexMacroSubstituter(variables: Record<string, unknown>): (text: string) => string {
  return (text: string) => text.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    const normalizedKey = String(key).trim();
    if (!normalizedKey) {
      return match;
    }

    if (!Object.prototype.hasOwnProperty.call(variables, normalizedKey)) {
      return match;
    }

    const value = variables[normalizedKey];
    return value === null || value === undefined ? '' : String(value);
  });
}

function resolvePromptMode(
  session: SessionPromptInfo,
  metadata: SessionMetadata
): PromptMode {
  const source = session.promptMode ?? metadata.promptMode ?? metadata.prompt_mode;
  if (source === "native") {
    return "native";
  }

  if (source === "compat_plus") {
    return "compat_plus";
  }

  return "compat_strict";
}

function buildNativeSystemPrompt(
  preset: STPreset,
  character?: CharacterSnapshot,
  persona?: PersonaInfo
): string {
  const mainPrompt = preset.prompts.find((entry) => entry.identifier === "main")?.content?.trim();

  const parts: string[] = [];

  if (mainPrompt) {
    parts.push(mainPrompt);
  }

  if (character?.description) {
    parts.push(character.description);
  }

  if (character?.personality) {
    parts.push(`Personality: ${character.personality}`);
  }

  if (character?.scenario) {
    parts.push(`Scenario: ${character.scenario}`);
  }

  if (persona?.description) {
    parts.push(`The user is ${persona.name ?? "User"}: ${persona.description}`);
  }

  if (parts.length === 0) {
    return DEFAULT_SYSTEM_PROMPT;
  }

  return parts.join("\n\n");
}

function parseCharacterBookWorldbook(character?: CharacterSnapshot): STWorldBook | null {
  if (!character?.characterBook) {
    return null;
  }

  try {
    const parsed = parseWorldBook(character.characterBook, `${character.name ?? "Character"} Character Book`);

    return {
      ...parsed,
      entries: parsed.entries.map((entry, index) => ({
        ...entry,
        uid: -1_000_000 - index,
      })),
    };
  } catch {
    return null;
  }
}

function collectPromptWorldbooks(worldbookData: STWorldBook | null | undefined, character?: CharacterSnapshot): STWorldBook[] {
  const result: STWorldBook[] = [];

  if (worldbookData && worldbookData.entries.length > 0) {
    result.push(worldbookData);
  }

  const characterBookWorldbook = parseCharacterBookWorldbook(character);
  if (characterBookWorldbook && characterBookWorldbook.entries.length > 0) {
    result.push(characterBookWorldbook);
  }

  return result;
}

function triggerPromptWorldbooks(
  worldbooks: STWorldBook[],
  baseContext: Pick<TriggerContext, "messages" | "scanSources">,
): TriggerResult | undefined {
  const results = worldbooks.map((worldbook) => triggerWorldBook(worldbook.entries, {
    messages: baseContext.messages,
    scanDepth: worldbook.scanDepth,
    caseSensitive: worldbook.caseSensitive,
    matchWholeWords: worldbook.matchWholeWords,
    recursive: worldbook.recursive,
    maxRecursionSteps: worldbook.maxRecursionSteps,
    scanSources: baseContext.scanSources,
  }));

  if (results.length === 0) {
    return undefined;
  }

  const activated = results.flatMap((result) => result.activated).sort((a, b) => b.order - a.order);
  const before = results.flatMap((result) => result.before).sort((a, b) => b.order - a.order);
  const after = results.flatMap((result) => result.after).sort((a, b) => b.order - a.order);
  const atDepth = results.flatMap((result) => result.atDepth).sort((a, b) => b.entry.order - a.entry.order);
  const outletEntries = Object.fromEntries(Object.entries(results.reduce<Record<string, typeof results[number]["activated"]>>((acc, result) => {
    for (const [outletName, entries] of Object.entries(result.outletEntries ?? {})) {
      acc[outletName] = [...(acc[outletName] ?? []), ...entries].sort((a, b) => b.order - a.order);
    }
    return acc;
  }, {})).map(([outletName, entries]) => [outletName, entries]));

  return { activated, before, after, atDepth, ...(Object.keys(outletEntries).length > 0 ? { outletEntries } : {}) };
}

function applyWorldInfoRegexRules(
  worldBookResults: TriggerResult | undefined,
  scripts: LoadedPromptRegexProfile["scripts"] | undefined,
  variables: Record<string, unknown>,
): TriggerResult | undefined {
  if (!worldBookResults || !scripts || scripts.length === 0) {
    return worldBookResults;
  }

  const worldInfoScripts = scripts.filter((script) => script.placement.includes(REGEX_PLACEMENT.WORLD_INFO));
  if (worldInfoScripts.length === 0) {
    return worldBookResults;
  }

  const substituteRegexParams = createRegexMacroSubstituter(variables);
  const regexContextBase = {
    substituteFindParams: substituteRegexParams,
    substituteReplaceParams: substituteRegexParams,
  };

  const transformContent = (content: string) => {
    const persistedContent = applyRegexScripts(content, worldInfoScripts, REGEX_PLACEMENT.WORLD_INFO, {
      ...regexContextBase,
      channel: "persist",
    });

    return applyRegexScripts(persistedContent, worldInfoScripts, REGEX_PLACEMENT.WORLD_INFO, {
      ...regexContextBase,
      channel: "prompt",
    });
  };

  const transformedContentByUid = new Map(
    worldBookResults.activated.map((entry) => [entry.uid, transformContent(entry.content)] as const)
  );
  const applyEntryContent = <T extends { uid: number; content: string }>(entry: T): T => ({
    ...entry,
    content: transformedContentByUid.get(entry.uid) ?? transformContent(entry.content),
  });

  return {
    activated: worldBookResults.activated.map(applyEntryContent),
    before: worldBookResults.before.map(applyEntryContent),
    after: worldBookResults.after.map(applyEntryContent),
    atDepth: worldBookResults.atDepth.map((depthEntry) => ({
      ...depthEntry,
      entry: applyEntryContent(depthEntry.entry),
    })),
    outletEntries: worldBookResults.outletEntries
      ? Object.fromEntries(
          Object.entries(worldBookResults.outletEntries).map(([name, entries]) => [
            name,
            entries.map(applyEntryContent),
          ])
        )
      : undefined,
  };
}

function worldbookRoleToChatRole(role: number): ChatMessage["role"] {
  switch (role) {
    case 1: return "user";
    case 2: return "assistant";
    default: return "system";
  }
}

function toNativeWorldbookEntries(
  worldBookResults: TriggerResult | undefined
): NativeWorldbookEntry[] {
  if (!worldBookResults) {
    return [];
  }

  const before = worldBookResults.before.map((entry) => ({
    id: `before:${entry.uid}`,
    content: entry.content,
    position: "before" as const,
  }));
  const after = worldBookResults.after.map((entry) => ({
    id: `after:${entry.uid}`,
    content: entry.content,
    position: "after" as const,
  }));
  const depth = worldBookResults.atDepth.map((depthEntry) => ({
    id: `depth:${depthEntry.entry.uid}`,
    content: depthEntry.entry.content,
    position: "depth" as const,
    depth: depthEntry.depth,
    role: worldbookRoleToChatRole(depthEntry.role),
  }));

  return [...before, ...after, ...depth];
}

/**
 * 无预设时的降级消息构建。
 * 生成一个简单的 system prompt + 聊天历史。
 */
function buildFallbackMessages(
  chatHistory: { role: "user" | "assistant"; content: string }[],
  character?: CharacterSnapshot,
  persona?: PersonaInfo
): ChatMessage[] {
  const messages: ChatMessage[] = [];

  let systemPrompt = DEFAULT_SYSTEM_PROMPT;

  if (character?.description || character?.personality) {
    const parts: string[] = [];
    if (character.name) {
      parts.push(`You are ${character.name}.`);
    }
    if (character.description) {
      parts.push(character.description);
    }
    if (character.personality) {
      parts.push(`Personality: ${character.personality}`);
    }
    if (character.scenario) {
      parts.push(`Scenario: ${character.scenario}`);
    }
    if (persona?.description) {
      parts.push(`The user is ${persona.name ?? "User"}: ${persona.description}`);
    }
    systemPrompt = parts.join("\n\n");
  }

  messages.push({ role: "system", content: systemPrompt });

  for (const message of chatHistory) {
    messages.push({ role: message.role, content: message.content });
  }

  return messages;
}

function injectCharacterSystemPrompt(
  messages: ChatMessage[],
  character?: CharacterSnapshot,
): ChatMessage[] {
  const systemPrompt = character?.systemPrompt?.trim();
  if (!systemPrompt) return messages;

  const insertAt = Math.max(messages.findIndex((message) => message.role === "system"), -1) + 1;
  const result = [...messages];
  result.splice(insertAt, 0, { role: "system", content: systemPrompt });
  return result;
}

function injectCharacterPostHistoryInstructions(
  messages: ChatMessage[],
  character?: CharacterSnapshot,
): ChatMessage[] {
  const postHistoryInstructions = character?.postHistoryInstructions?.trim();
  if (!postHistoryInstructions) return messages;

  return [...messages, { role: "system", content: postHistoryInstructions }];
}

/**
 * 将记忆摘要注入到消息数组中。
 *
 * 注入策略：
 * - 在第一条 system 消息之后插入一条 system 消息
 * - 如果没有 system 消息，插入到最前面
 * - 摘要文本以 [Memory Summary] 标记包裹
 *
 * @param messages - 原始消息数组
 * @param memorySummary - 记忆摘要文本
 * @returns 注入后的消息数组（新数组，不修改原数组）
 */
function injectMemorySummary(
  messages: ChatMessage[],
  memorySummary: string
): ChatMessage[] {
  const trimmed = memorySummary.trim();
  if (!trimmed) return messages;

  const memoryMessage: ChatMessage = {
    role: "system",
    content: `[Memory Summary]\n${trimmed}`,
  };

  const firstSystemIdx = messages.findIndex((message) => message.role === "system");
  const insertAt = firstSystemIdx >= 0 ? firstSystemIdx + 1 : 0;

  const result = [...messages];
  result.splice(insertAt, 0, memoryMessage);
  return result;
}

function collectActivatedEntryUids(worldBookResults: TriggerResult | undefined): number[] {
  if (!worldBookResults) {
    return [];
  }

  const uids = new Set<number>();
  for (const entry of worldBookResults.activated) {
    uids.add(entry.uid);
  }

  return [...uids].sort((left, right) => left - right);
}

function collectRegexRuleNames(scripts: { id: string; scriptName: string; placement: number[] }[], placement: number): string[] {
  return scripts
    .filter((script) => script.placement.includes(placement))
    .map((script) => script.scriptName || script.id);
}

function previewPromptMessages(
  messages: ChatMessage[],
  preProcess?: (messages: ChatMessage[]) => ChatMessage[]
): ChatMessage[] {
  if (!preProcess) {
    return [...messages];
  }

  try {
    return preProcess(messages);
  } catch {
    return [...messages];
  }
}

function buildPromptTokenUsage(
  messages: ChatMessage[],
  tokenCounter: TokenCounter,
  maxPromptTokens: number
): { total: number; availableForReply: number } {
  const total = messages.reduce((sum, message) => sum + tokenCounter.count(message.content), 0);

  return {
    total,
    availableForReply: Math.max(0, maxPromptTokens - total),
  };
}

function computePromptDigest(messages: ChatMessage[]): string {
  return createHash("sha256")
    .update(JSON.stringify(messages))
    .digest("hex");
}
