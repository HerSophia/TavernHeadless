import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { SimpleTokenCounter } from "@tavern/core";

import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../accounts/constants.js";
import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { presets } from "../../db/schema.js";
import {
  assemblePrompt,
  materializePromptRuntimeMessages,
  type PromptMode,
  type SessionPromptInfo,
} from "../prompt-assembler.js";
import { PromptRuntimeInjectionContributorBuilder } from "../chat/prompt-runtime-injection-contributor-builder.js";
import type { PromptRuntimeInjectionPlacement } from "../prompt-runtime-injection-types.js";

const BASE_SYSTEM_PROMPT = "You are Knight.";
const CHARACTER_DESCRIPTION = "Character description.";
const CHARACTER_SCENARIO = "Character scenario.";
const PERSONA_DESCRIPTION = "Persona description.";
const WORLD_INFO = "Character book lore.";
const MEMORY_SUMMARY = "Memory summary.";
const EXAMPLE_DIALOGUE = "Example dialogue block.";
const HISTORY_USER = "Earlier user asks about the north pass.";
const HISTORY_ASSISTANT = "Earlier assistant points to the gate.";
const CURRENT_INPUT = "Current user input.";
const OUTPUT_INSTRUCTION = "Character post-history instructions.";
const PREFILL_TEXT = "Prefill fragment";

const SAMPLE_PRESET_DATA = {
  prompts: [
    {
      identifier: "main",
      name: "Main Prompt",
      role: "system",
      content: "You are {{char}}.",
    },
    {
      identifier: "nsfw",
      name: "NSFW",
      role: "system",
      content: "",
    },
    {
      identifier: "jailbreak",
      name: "Jailbreak",
      role: "system",
      content: "Be creative.",
    },
    {
      identifier: "chatHistory",
      name: "Chat History",
      marker: true,
    },
    {
      identifier: "worldInfoBefore",
      name:"WI Before",
      marker: true,
    },
    {
      identifier: "worldInfoAfter",
      name: "WI After",
      marker: true,
    },
    {
      identifier: "charDescription",
      name: "Char Desc",
      marker: true,
    },
    {
      identifier: "charPersonality",
      name: "Char Personality",
      marker: true,
    },
    {
      identifier: "scenario",
      name: "Scenario",
      marker: true,
    },
    {
      identifier: "personaDescription",
      name: "Persona",
      marker: true,
    },
    {
      identifier: "dialogueExamples",
      name: "Examples",
      marker: true,
    },
  ],
  prompt_order: [
    {
      character_id: 100000,
      order: [
        { identifier: "main", enabled: true },
        { identifier: "worldInfoBefore", enabled: true },
        { identifier: "charDescription", enabled: true },
        { identifier: "charPersonality", enabled: true },
        { identifier: "scenario", enabled: true },
        { identifier: "personaDescription", enabled: true },
        { identifier: "nsfw", enabled: true },
        { identifier: "worldInfoAfter", enabled: true },
        { identifier: "dialogueExamples", enabled: true },
        { identifier: "chatHistory", enabled: true },
        { identifier: "jailbreak", enabled: true },
      ],
    },
  ],
  openai_max_context: 4096,
  openai_max_tokens: 256,
  temperature: 0.7,
  top_p: 0.9,
  top_k: 40,
  min_p: 0,
  frequency_penalty: 0,
  presence_penalty: 0,
  repetition_penalty: 1,
  new_chat_prompt: "",
  new_example_chat_prompt: "",
  continue_nudge_prompt: "Continue the response.",
  assistant_prefill: PREFILL_TEXT,
  wi_format: "{0}",
  names_behavior: 0,
  stream_openai: true,
};

const MODES = ["compat_strict", "compat_plus", "native"] as const satisfies readonly PromptMode[];

const PLACEMENT_CASES: Array<{
  placement: PromptRuntimeInjectionPlacement;
  appliedByMode: Record<PromptMode, boolean>;
  assertOrder: (joinedText: string, injectionText: string) => void;
}> = [
  {
    placement: "before_system_prompt",
    appliedByMode: appliedInAllModes(true),
    assertOrder: (joinedText, injectionText) => {
      expectBefore(joinedText, injectionText, BASE_SYSTEM_PROMPT);
    },
  },
  {
    placement: "after_system_prompt",
    appliedByMode: appliedInAllModes(true),
    assertOrder: (joinedText, injectionText) => {
      expectAfter(joinedText, injectionText, BASE_SYSTEM_PROMPT);
      expectBefore(joinedText, injectionText, CHARACTER_DESCRIPTION);
    },
  },
  {
    placement: "before_character",
    appliedByMode: appliedInAllModes(true),
    assertOrder: (joinedText, injectionText) => {
      expectBefore(joinedText, injectionText, CHARACTER_DESCRIPTION);
    },
  },
  {
    placement: "after_character",
    appliedByMode: appliedInAllModes(true),
    assertOrder: (joinedText, injectionText) => {
      expectAfter(joinedText, injectionText, CHARACTER_SCENARIO);
    },
  },
  {
    placement: "before_persona",
    appliedByMode: {
      compat_strict: true,
      compat_plus: true,
      native: false,
    },
    assertOrder: (joinedText, injectionText) => {
      expectBefore(joinedText, injectionText, PERSONA_DESCRIPTION);
    },
  },
  {
    placement: "after_persona",
    appliedByMode: {
      compat_strict: true,
      compat_plus: true,
      native: false,
    },
    assertOrder: (joinedText, injectionText) => {
      expectAfter(joinedText, injectionText, PERSONA_DESCRIPTION);
    },
  },
  {
    placement: "before_worldbook",
    appliedByMode: appliedInAllModes(true),
    assertOrder: (joinedText, injectionText) => {
      expectBefore(joinedText, injectionText, WORLD_INFO);
    },
  },
  {
    placement: "after_worldbook",
    appliedByMode: appliedInAllModes(true),
    assertOrder: (joinedText, injectionText) => {
      expectAfter(joinedText, injectionText, WORLD_INFO);
    },
  },
  {
    placement: "before_memory",
    appliedByMode: {
      compat_strict: false,
      compat_plus: false,
      native: true,
    },
    assertOrder: (joinedText, injectionText) => {
      expectBefore(joinedText, injectionText, MEMORY_SUMMARY);
    },
  },
  {
    placement: "after_memory",
    appliedByMode: {
      compat_strict: false,
      compat_plus: false,
      native: true,
    },
    assertOrder: (joinedText, injectionText) => {
      expectAfter(joinedText, injectionText, MEMORY_SUMMARY);
    },
  },
  {
    placement: "before_examples",
    appliedByMode: appliedInAllModes(true),
    assertOrder: (joinedText, injectionText) => {
      expectBefore(joinedText, injectionText, EXAMPLE_DIALOGUE);
    },
  },
  {
    placement: "after_examples",
    appliedByMode: appliedInAllModes(true),
    assertOrder: (joinedText,injectionText) => {
      expectAfter(joinedText, injectionText, EXAMPLE_DIALOGUE);
    },
  },
  {
    placement: "before_history",
    appliedByMode: appliedInAllModes(true),
    assertOrder: (joinedText, injectionText) => {
      expectBefore(joinedText, injectionText, HISTORY_USER);
    },
  },
  {
    placement: "after_history",
    appliedByMode: appliedInAllModes(true),
    assertOrder: (joinedText, injectionText) => {
      expectAfter(joinedText, injectionText, CURRENT_INPUT);
      expectBefore(joinedText, injectionText, OUTPUT_INSTRUCTION);
    },
  },
  {
    placement: "before_current_user_input",
    appliedByMode: appliedInAllModes(true),
    assertOrder: (joinedText, injectionText) => {
      expectAfter(joinedText, injectionText, HISTORY_ASSISTANT);
      expectBefore(joinedText, injectionText, CURRENT_INPUT);
    },
  },
  {
    placement: "after_current_user_input",
    appliedByMode: appliedInAllModes(true),
    assertOrder: (joinedText, injectionText) => {
      expectAfter(joinedText, injectionText, CURRENT_INPUT);
      expectBefore(joinedText, injectionText, OUTPUT_INSTRUCTION);
    },
  },
  {
    placement: "before_output_instruction",
    appliedByMode: appliedInAllModes(true),
    assertOrder: (joinedText, injectionText) => {
      expectBefore(joinedText, injectionText, OUTPUT_INSTRUCTION);
    },
  },
  {
    placement: "before_assistant_prefill",
    appliedByMode: appliedInAllModes(true),
    assertOrder: (joinedText, injectionText) => {
         expectBefore(joinedText, injectionText, PREFILL_TEXT);
    },
  },
];

describe("prompt runtime injection semantic placements", () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = createDatabase(":memory:");
  });

  afterEach(() => {
    database.close();
  });

  it.each(MODES)("realizes placement semantics across %s", async (promptMode) => {
    const presetId = await insertPreset(database);

    for (const placementCase of PLACEMENT_CASES) {
      const rendered = await renderPlacement({
        database,
        presetId,
        promptMode,
        placement: placementCase.placement,
      });

      const expectedApplied = placementCase.appliedByMode[promptMode];
      if (!expectedApplied) {
        expect(rendered.traceItems).toMatchObject([
          {
            placementRequested: placementCase.placement,
            title: rendered.title,
            applied: false,
            notAppliedReason: "prompt_section_absent",
          },
        ]);
        expect(rendered.joinedText).not.toContain(rendered.injectionText);
        continue;
      }

      expect(rendered.traceItems).toMatchObject([
        {
          placementRequested: placementCase.placement,
          title: rendered.title,
          applied: true,
        },
      ]);
      placementCase.assertOrder(rendered.joinedText, rendered.injectionText);
    }
  });
});

async function renderPlacement(args: {
  database: DatabaseConnection;
  presetId: string;
  promptMode: PromptMode;
  placement: PromptRuntimeInjectionPlacement;
}): Promise<{
  title: string;
  injectionText: string;
  joinedText: string;
  traceItems: Array<{
    placementRequested: string;
    title: string;
    applied: boolean;
    notAppliedReason?: string;
  }>;
}> {
  const title = `Placement ${args.placement}`;
  const content = `Injected ${args.placement}.`;
  const injectionText = `[${title}]\n${content}`;
  const injectionBuild = new PromptRuntimeInjectionContributorBuilder().build({
    promptMode: args.promptMode,
    injections: [{
      sourceKind: "client_injection",
      title,
      content,
      placement: args.placement,
    }],
  });

  const assembled = await assemblePrompt(
    args.database.db,
    DEFAULT_ADMIN_ACCOUNT_ID,
    createSessionInfo(args.presetId, args.promptMode),
    [
      { role: "user", content: HISTORY_USER },
      { role: "assistant", content: HISTORY_ASSISTANT },
    ],
    CURRENT_INPUT,
    new SimpleTokenCounter(),
    MEMORY_SUMMARY,
    {
      intent: "continue",
      contributors: injectionBuild.renderables,
      injectionItems: injectionBuild.items,
    },
  );

  const messages = args.placement === "before_assistant_prefill"
    ? materializePromptRuntimeMessages({
        messages: assembled.messages,
        sendDirectives: assembled.sendDirectives,
        assistantPrefillStrategy: "assistant_message_fallback",
        materializeAssistantPrefillFallback: true,
      }).messages
    : assembled.messages;

  return {
    title,
    injectionText,
    joinedText: messages.map((message) => message.content).join("\n<<>>\n"),
    traceItems: (assembled.runtimeTraceSeed.injectionItems ?? []).map((item) => ({
      placementRequested: item.placementRequested,
      title: item.title,
      applied: item.applied,
      ...(item.notAppliedReason ? { notAppliedReason: item.notAppliedReason } : {}),
    })),
  };
}

async function insertPreset(database: DatabaseConnection): Promise<string> {
  const presetId = nanoid();
  const now = Date.now();

  await database.db.insert(presets).values({
    id: presetId,
    name: "Prompt Runtime Injection Placement Preset",
    source: "sillytavern",
    accountId: DEFAULT_ADMIN_ACCOUNT_ID,
    dataJson: JSON.stringify(SAMPLE_PRESET_DATA),
    createdAt: now,
    updatedAt: now,
  });

  return presetId;
}

function createSessionInfo(presetId: string, promptMode: PromptMode): SessionPromptInfo {
  return {
    presetId,
    worldbookProfileId: null,
    regexProfileId: null,
    metadataJson: null,
    characterSnapshotJson: JSON.stringify({
      name: "Knight",
      description: CHARACTER_DESCRIPTION,
      personality: "Character personality.",
      scenario: CHARACTER_SCENARIO,
      postHistoryInstructions: OUTPUT_INSTRUCTION,
      exampleDialogue: EXAMPLE_DIALOGUE,
      characterBook: {
        entries: [{
          uid: 7,
          key: [],
          keysecondary: [],
          selective: true,
          selectiveLogic: 0,
          constant: true,
          content: WORLD_INFO,
          comment: "Character Lore",
          position: 1,
          order: 120,
          disable: false,
          excludeRecursion: false,
          preventRecursion: false,
        }],
      },
    }),
    promptMode,
    userSnapshotJson: JSON.stringify({
      name: "Traveler",
      description: PERSONA_DESCRIPTION,
    }),
  };
}

function appliedInAllModes(value: boolean): Record<PromptMode, boolean> {
  return {
    compat_strict: value,
    compat_plus: value,
    native: value,
  };
}

function expectBefore(text: string, left: string, right: string): void {
  const leftIndex = text.indexOf(left);
  const rightIndex = text.indexOf(right);
  expect(leftIndex).toBeGreaterThan(-1);
  expect(rightIndex).toBeGreaterThan(-1);
  expect(leftIndex).toBeLessThan(rightIndex);
}

function expectAfter(text: string, left: string, right: string): void {
  const leftIndex = text.indexOf(left);
  const rightIndex = text.indexOf(right);
  expect(leftIndex).toBeGreaterThan(-1);
  expect(rightIndex).toBeGreaterThan(-1);
  expect(leftIndex).toBeGreaterThan(rightIndex);
}
