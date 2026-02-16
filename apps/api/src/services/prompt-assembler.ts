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

import { eq } from "drizzle-orm";
import {
  assembleNativePrompt,
  MessageBuilder,
  type ChatMessage,
  type NativeWorldbookEntry,
  type TokenCounter,
} from "@tavern/core";
import {
  assembleCompat,
  type TriggerResult,
  triggerWorldBook,
  applyRegexScripts,
  parsePreset,
  parseWorldBook,
  parseRegexScripts,
  REGEX_PLACEMENT,
  type STPreset,
  type STWorldBook,
  type STRegexScript,
} from "@tavern/adapters-sillytavern";

import type { AppDb } from "../db/client.js";
import { presets, worldbooks, regexProfiles } from "../db/schema.js";

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
export interface CharacterSnapshot {
  name?: string;
  description?: string;
  personality?: string;
  scenario?: string;
  exampleDialogue?: string;
  greeting?: string;
}

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
}

export interface AssemblePromptOptions {
  /**
   * 是否返回调试元信息。
   * 默认 false，用于常规 respond/regenerate 场景减少开销。
   */
  includeDebug?: boolean;
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
 * @param session - Session 的编排相关字段
 * @param chatHistory - 已加载的聊天历史（不含当前用户消息）
 * @param userMessage - 当前用户消息
 * @param tokenCounter - Token 计数器
 * @param memorySummary - 可选的记忆摘要文本（由 MemoryStore 提供）
 * @returns 编排结果
 */
export async function assemblePrompt(
  db: AppDb,
  session: SessionPromptInfo,
  chatHistory: ChatMessage[],
  userMessage: string,
  tokenCounter: TokenCounter,
  memorySummary?: string,
  options: AssemblePromptOptions = {}
): Promise<AssembleResult> {
  // ── 1. 加载资源 ──
  const [preset, worldbookEntries, regexScriptList] = await Promise.all([
    loadPreset(db, session.presetId),
    loadWorldbookData(db, session.worldbookProfileId),
    loadRegexScripts(db, session.regexProfileId),
  ]);

  // ── 2. 解析 metadata（角色卡信息）──
  const metadata = parseSessionMetadata(session.metadataJson);
  const character = parseCharacterSnapshot(session.characterSnapshotJson);
  const userSnapshot = parseUserSnapshot(session.userSnapshotJson ?? null);
  const persona = userSnapshot ?? metadata.persona;

  // ── 3. 模板变量 ──
  const variables: Record<string, string> = {
    char: character?.name ?? "Assistant",
    user: persona?.name ?? "User",
  };

  // ── 3b. 编排模式 ──
  const promptMode = resolvePromptMode(session, metadata);

  // ── 4. 准备聊天历史（含当前用户消息）──
  const fullHistory: { role: "user" | "assistant"; content: string }[] = [
    ...chatHistory
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    { role: "user" as const, content: userMessage },
  ];

  // ── 5. 编排 ──
  let messages: ChatMessage[];
  let tokenUsage = { total: 0, availableForReply: DEFAULT_MAX_TOKENS };
  let mode: AssembleDebugInfo["mode"] = "fallback";
  let worldbookHits = 0;
  let usedNativePipeline = false;

  if (preset) {
    // 5a. 世界书触发
    let worldBookResults;
    if (worldbookEntries && worldbookEntries.entries.length > 0) {
      const triggerMessages = fullHistory
        .map((m) => m.content)
        .reverse(); // 从新到旧

      worldBookResults = triggerWorldBook(worldbookEntries.entries, {
        messages: triggerMessages,
        scanDepth: worldbookEntries.scanDepth,
        caseSensitive: false,
        matchWholeWords: false,
      });
    }

    worldbookHits = worldBookResults?.activated.length ?? 0;

    const useNativePipeline = promptMode === "native";
    usedNativePipeline = useNativePipeline;

    const promptIR = useNativePipeline
      ? assembleNativePrompt({
        systemPrompt: buildNativeSystemPrompt(preset, character, persona),
        chatHistory: fullHistory,
        worldbookEntries: toNativeWorldbookEntries(worldBookResults),
        variables,
        memorySummary,
        maxTokens: preset.maxContext,
        reservedForReply: preset.maxTokens,
        tokenCounter,
      })
      : assembleCompat({
        preset,
        worldBookResults,
        chatHistory: fullHistory,
        characterDescription: character?.description,
        characterPersonality: character?.personality,
        scenario: character?.scenario,
        exampleDialogue: character?.exampleDialogue,
        personaDescription: persona?.description,
        variables,
      });

    // 5c. Token 裁剪
    const builder = new MessageBuilder(tokenCounter, {
      mergeAdjacentSameRole: true,
    });
    const assembled = builder.build(promptIR);

    messages = assembled.messages;
    tokenUsage = {
      total: assembled.tokenUsage.total,
      availableForReply: assembled.tokenUsage.availableForReply,
    };
    mode = "preset";
  } else {
    // 无预设：使用默认 system prompt + 历史 + 用户消息
    messages = buildFallbackMessages(fullHistory, character, persona);
    tokenUsage = {
      total: messages.reduce((sum, m) => sum + tokenCounter.count(m.content), 0),
      availableForReply: DEFAULT_MAX_TOKENS,
    };
  }

  // ── 5d. 记忆摘要注入 ──
  if (memorySummary && !usedNativePipeline) {
    messages = injectMemorySummary(messages, memorySummary);
  }

  // ── 6. 正则处理函数 ──
  let preProcess: AssembleResult["preProcess"];
  let postProcess: AssembleResult["postProcess"];
  const enabledRegexScripts = regexScriptList.filter((script) => !script.disabled);
  const memorySummaryInjected = typeof memorySummary === "string" && memorySummary.trim().length > 0;

  if (enabledRegexScripts.length > 0) {
    // 前处理：对用户消息应用 USER_INPUT 正则
    preProcess = (msgs: ChatMessage[]): ChatMessage[] => {
      return msgs.map((msg) => {
        if (msg.role === "user") {
          return {
            ...msg,
            content: applyRegexScripts(
              msg.content,
              enabledRegexScripts,
              REGEX_PLACEMENT.USER_INPUT
            ),
          };
        }
        return msg;
      });
    };

    // 后处理：对 AI 输出应用 AI_OUTPUT 正则
    postProcess = (text: string): string => {
      return applyRegexScripts(
        text,
        enabledRegexScripts,
        REGEX_PLACEMENT.AI_OUTPUT
      );
    };
  }

  const debug = options.includeDebug ? {
    mode,
    presetUsed: preset !== null,
    worldbookHits,
    regexPreRules: enabledRegexScripts
      .filter((script) => script.placement.includes(REGEX_PLACEMENT.USER_INPUT))
      .map((script) => script.scriptName || script.id),
    regexPostRules: enabledRegexScripts
      .filter((script) => script.placement.includes(REGEX_PLACEMENT.AI_OUTPUT))
      .map((script) => script.scriptName || script.id),
    memorySummaryInjected,
  } : undefined;

  return { messages, preProcess, postProcess, tokenUsage, debug };
}

// ── DB 加载函数 ────────────────────────────────────────

/**
 * 从 DB 加载预设并解析为 STPreset。
 * 如果 presetId 为空或找不到记录，返回 null。
 */
async function loadPreset(
  db: AppDb,
  presetId: string | null
): Promise<STPreset | null> {
  if (!presetId) return null;

  const [row] = await db
    .select({ dataJson: presets.dataJson })
    .from(presets)
    .where(eq(presets.id, presetId))
    .limit(1);

  if (!row) return null;

  try {
    const rawData = JSON.parse(row.dataJson);
    return parsePreset(rawData);
  } catch {
    // 解析失败，降级为无预设
    return null;
  }
}

/**
 * 从 DB 加载世界书并解析为 STWorldBookEntry[]。
 * 如果 worldbookProfileId 为空或找不到记录，返回空数组。
 */
async function loadWorldbookData(
  db: AppDb,
  worldbookProfileId: string | null
): Promise<STWorldBook | null> {
  if (!worldbookProfileId) return null;

  const [row] = await db
    .select({ dataJson: worldbooks.dataJson })
    .from(worldbooks)
    .where(eq(worldbooks.id, worldbookProfileId))
    .limit(1);

  if (!row) return null;

  try {
    const rawData = JSON.parse(row.dataJson);
    return parseWorldBook(rawData);
  } catch {
    return null;
  }
}

/**
 * 从 DB 加载正则脚本列表并解析为 STRegexScript[]。
 * 如果 regexProfileId 为空或找不到记录，返回空数组。
 */
async function loadRegexScripts(
  db: AppDb,
  regexProfileId: string | null
): Promise<STRegexScript[]> {
  if (!regexProfileId) return [];

  const [row] = await db
    .select({ dataJson: regexProfiles.dataJson })
    .from(regexProfiles)
    .where(eq(regexProfiles.id, regexProfileId))
    .limit(1);

  if (!row) return [];

  try {
    const rawData = JSON.parse(row.dataJson);
    return parseRegexScripts(rawData);
  } catch {
    return [];
  }
}

// ── 工具函数 ──────────────────────────────────────────

function parseCharacterSnapshot(snapshotJson: string | null): CharacterSnapshot | undefined {
  if (!snapshotJson) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(snapshotJson) as Record<string, unknown>;
    if (typeof parsed !== "object" || parsed === null) {
      return undefined;
    }

    return parsed as CharacterSnapshot;
  } catch {
    return undefined;
  }
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
  const mainPrompt = preset.prompts
    .find((entry) => entry.identifier === "main")
    ?.content?.trim();

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

  return [...before, ...after];
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

  // System prompt
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

  // Chat history
  for (const msg of chatHistory) {
    messages.push({ role: msg.role, content: msg.content });
  }

  return messages;
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

  // 在第一条 system 消息之后插入
  const firstSystemIdx = messages.findIndex((m) => m.role === "system");
  const insertAt = firstSystemIdx >= 0 ? firstSystemIdx + 1 : 0;

  const result = [...messages];
  result.splice(insertAt, 0, memoryMessage);
  return result;
}
