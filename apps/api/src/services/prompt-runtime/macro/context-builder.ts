import type { LoadedPromptPreset } from "../../prompt-resource-loader.js";
import type {
  StMacroJsonValue,
  StMacroVariableSnapshot,
  StMacroWarning,
} from "../../st-macros/index.js";
import { stringifyStMacroValue } from "../../st-macros/variable-path.js";
import type {
  CharacterSnapshot,
  PersonaInfo,
  PromptMacroRunKind,
  PromptMode,
  SessionMetadata,
  UserSnapshot,
} from "../../prompt-assembler.js";

const DEFAULT_SYSTEM_PROMPT = "You are a helpful assistant.";
const READONLY_PROMPT_MACRO_KEYS = [
  "userName",
  "assistantName",
  "description",
  "personality",
  "scenario",
  "persona",
  "systemPrompt",
  "defaultSystemPrompt",
  "charPrompt",
  "charInstruction",
  "charDepthPrompt",
  "mesExamples",
  "mesExamplesRaw",
  "charAuthorsNote",
  "authorsNote",
  "defaultAuthorsNote",
  "model",
  "runKind",
  "promptMode",
  "isodate",
  "isotime",
  "maxPrompt",
  "summary",
  "lastMessage",
  "lastUserMessage",
  "lastCharMessage",
  "lastGenerationType",
  "char",
  "user",
] as const;

export function buildVisibleRecentMacroMessages(args: {
  committedHistory: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  currentUserMessage?: string;
  includeCurrentUserMessage: boolean;
}): Array<{ role: "user" | "assistant"; content: string }> {
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

export function shouldIncludeCurrentUserMessageInRecentMacros(args: {
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

export function buildStMacroValues(args: {
  metadata: SessionMetadata;
  sessionPromptMode?: PromptMode | null;
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

  const metadataText = (key: string): string | undefined => {
    const value = args.metadata[key];
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

  const resolveOptionalMacroValue = (input: {
    macroName: string;
    value: string | undefined;
    warningMessage: string;
  }): string => {
    if (typeof input.value === "string" && input.value.length > 0) {
      return input.value;
    }

    warnings.push({
      code: "macro_value_missing",
      message: input.warningMessage,
      macroName: input.macroName,
    });
    return "";
  };

  const recentMessages = resolveRecentMessageMacroValues({
    visibleMessages: args.chatHistory,
  });
  const ordinaryStringVariables = Object.fromEntries(
    Object.entries(args.ordinaryVariables).map(([key, value]) => [key, stringifyPromptVariableValue(value)]),
  );
  const resolvedPromptMode = resolvePromptMode(args.sessionPromptMode, args.metadata);
  const macroNow = new Date();
  const resolvedUserName = args.userSnapshot?.name ?? args.persona?.name ?? ordinaryStringVariables.user ?? "";
  const resolvedAssistantName = args.character?.name ?? ordinaryStringVariables.char ?? "";
  const resolvedRunKind = args.runKind;

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
  const fallbackSessionModelName = typeof args.metadata.model === "string" && args.metadata.model.trim().length > 0
    ? args.metadata.model.trim()
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
    user: resolvedUserName,
    userName: resolvedUserName,
    char: resolvedAssistantName,
    assistantName: resolvedAssistantName,
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
      value: resolvedCharPrompt,
      warningMessage: "Macro charPrompt has no resolved value and fell back to empty string.",
    }),
    charInstruction: resolveOptionalMacroValue({
      macroName: "charInstruction",
      value: resolvedCharInstruction,
      warningMessage: "Macro charInstruction has no resolved value and fell back to empty string.",
    }),
    charDepthPrompt: resolveOptionalMacroValue({
      macroName: "charDepthPrompt",
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
    runKind: resolvedRunKind,
    promptMode: resolvedPromptMode,
    isodate: formatMacroIsoDate(macroNow),
    isotime: formatMacroIsoTime(macroNow),
    maxPrompt: String(args.maxPrompt),
    summary: args.memorySummary ?? "",
    lastMessage: recentMessages.lastMessage,
    lastUserMessage: recentMessages.lastUserMessage,
    lastCharMessage: recentMessages.lastCharMessage,
    lastGenerationType: resolvedRunKind,
  };

  const variableSnapshot: StMacroVariableSnapshot = {
    local: { ...args.variableSnapshot.local },
    global: { ...args.variableSnapshot.global },
    plain: { ...ordinaryStringVariables, ...readonlyValues },
  };

  const values = { ...ordinaryStringVariables, ...readonlyValues };

  return { values, variableSnapshot, warnings };
}

function stringifyPromptVariableValue(value: unknown): string {
  return stringifyStMacroValue(value as StMacroJsonValue);
}

function padDateTimeSegment(value: number): string {
  return value.toString().padStart(2, "0");
}

function formatMacroIsoDate(date: Date): string {
  return `${date.getFullYear()}-${padDateTimeSegment(date.getMonth() + 1)}-${padDateTimeSegment(date.getDate())}`;
}

function formatMacroIsoTime(date: Date): string {
  return `${padDateTimeSegment(date.getHours())}:${padDateTimeSegment(date.getMinutes())}`;
}

function resolvePromptMode(
  sessionPromptMode: PromptMode | null | undefined,
  metadata: SessionMetadata,
): PromptMode {
  const source = sessionPromptMode
    ?? metadata.promptMode
    ?? metadata.prompt_mode
    ?? "compat_strict";

  if (source === "compat_strict" || source === "compat_plus" || source === "native") {
    return source;
  }

  return "compat_strict";
}

function resolveRecentMessageMacroValues(args: {
  visibleMessages: Array<{ role: "user" | "assistant"; content: string }>;
}): {
  lastMessage: string;
  lastUserMessage: string;
  lastCharMessage: string;
} {
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
