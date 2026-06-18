import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { SimpleTokenCounter } from "@tavern/core";

import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../../accounts/constants.js";
import { createDatabase, type DatabaseConnection } from "../../../db/client.js";
import { presets } from "../../../db/schema.js";
import {
  assemblePrompt,
  buildPromptRuntimeTrace,
  materializePromptRuntimeMessages,
  type SessionPromptInfo,
} from "../../prompt-assembler.js";
import { PromptRuntimeInjectionContributorBuilder } from "../../chat/prompt-runtime-injection-contributor-builder.js";
import {
  buildPromptRuntimeExecutionTrace,
  buildPromptRuntimePreviewTrace,
} from "../../prompt-runtime-execution.js";
import type { PromptRuntimeInspectionResult } from "../../prompt-runtime-control-service.js";

const SAMPLE_PRESET_DATA = {
  prompts: [
    {
      identifier: "main",
      name: "Main Prompt",
      role: "system",
      content: "Base system prompt.",
    },
    {
      identifier: "chatHistory",
      name: "Chat History",
      marker: true,
    },
  ],
  prompt_order: [
    {
      character_id: 100000,
      order: [
        { identifier: "main", enabled: true },
        { identifier: "chatHistory", enabled: true },
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
  assistant_prefill: "Prefill fragment",
  wi_format: "{0}",
  names_behavior: 0,
  stream_openai: true,
};

const INJECTION_CONTENT = "Keep the north pass in focus.";

function createInspectionResult(
  overrides: Partial<PromptRuntimeInspectionResult> = {},
): PromptRuntimeInspectionResult {
  return {
    scope: {
      sessionId: "session-1",
      targetBranchId: "main",
      branchExists: true,
      sourceFloorId: null,
      historySourceBranchId: "main",
      historySourceMode: "existing_branch",
    },
    assets: {
      preset: null,
      characterCard: null,
      worldbook: null,
      regexProfile: null,
    },
    resolvedPolicy: {
      structure: {
        mode: "default",
        mergeAdjacentSameRole: true,
        preserveSystemMessages: true,
      },
      delivery: {
        allowAssistantPrefill: true,
        requireLastUser: false,
        noAssistant: false,
      },
      debug: {
        includePromptSnapshot: false,
        includeRuntimeTrace: false,
        includeWorldbookMatches: false,
      },
      budget: {},
      visibility: { mode: "allow_all_except_hidden" },
      sourceSelection: {
        history: { mode: "full" },
        memory: { enabled: true },
        worldbook: { enabled: true },
        examples: { enabled: true },
      },
    },
    sourceMap: {},
    diagnostics: [],
    trimReasons: [],
    excludedSources: [],
    sectionStats: [],
    limitations: [],
    ...overrides,
  } as PromptRuntimeInspectionResult;
}

describe("prompt runtime injection contract", () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = createDatabase(":memory:");
  });

  afterEach(() => {
    database.close();
  });

  it("keeps injection items visible through execution and preview trace projections", () => {
    const injectionItems = [{
      requestIndex: 0,
      sourceKind: "client_injection",
      visibility: "client" as const,
      scope: "request" as const,
      placementRequested: "before_history",
      orderRequested: 30,
      title: "Client guide",
      contentLength: INJECTION_CONTENT.length,
      applied: true,
      placementResolved: "history.before",
    }];

    const executionTrace = buildPromptRuntimeExecutionTrace({
      inspection: createInspectionResult({
        injections: injectionItems,
      }),
    });

    expect(executionTrace?.injection).toEqual({
      items: injectionItems,
      requestedCount: 1,
      appliedCount: 1,
      rejectedCount: 0,
    });
    expect(buildPromptRuntimePreviewTrace(executionTrace)).toEqual({
      injection: {
        items: injectionItems,
        requestedCount: 1,
        appliedCount: 1,
        rejectedCount: 0,
      },
    });
  });

  it("marks missing semantic anchors as prompt_section_absent during assembly", async () => {
    const presetId = await insertPreset(database);
    const injectionBuild = new PromptRuntimeInjectionContributorBuilder().build({
      promptMode: "compat_strict",
      injections: [{
        sourceKind: "client_injection",
        title: "Persona guard",
        content: "Should not render.",
        placement: "before_persona",
      }],
    });

    const assembled = await assemblePrompt(
      database.db,
      DEFAULT_ADMIN_ACCOUNT_ID,
      createSessionInfo(presetId),
      [],
      "Hello",
      new SimpleTokenCounter(),
      undefined,
      {
        contributors: injectionBuild.renderables,
        injectionItems: injectionBuild.items,
      },
    );

    const traceItems = assembled.runtimeTraceSeed.injectionItems ?? [];
    expect(traceItems).toMatchObject([{
      title: "Persona guard",
      placementRequested: "before_persona",
      placementResolved: "persona.before",
      applied: false,
      notAppliedReason: "prompt_section_absent",
    }]);
    expect(assembled.messages.some((message) => message.content.includes("Should not render."))).toBe(false);
  });

  it("keeps before_output_instruction injections ahead of post-history instructions", async () => {
    const presetId = await insertPreset(database);
    const injectionBuild = new PromptRuntimeInjectionContributorBuilder().build({
      promptMode: "compat_strict",
      injections: [{
        sourceKind: "client_injection",
        title: "Output guard",
        content: "Resolve before instruction.",
        placement: "before_output_instruction",
      }],
    });

    const assembled = await assemblePrompt(
      database.db,
      DEFAULT_ADMIN_ACCOUNT_ID,
      createSessionInfo(presetId, {
        characterSnapshotJson: JSON.stringify({
          name: "Knight",
          postHistoryInstructions: "Character post-history instructions.",
        }),
      }),
      [],
      "Hello",
      new SimpleTokenCounter(),
      undefined,
      {
        contributors: injectionBuild.renderables,
        injectionItems: injectionBuild.items,
      },
    );

    const joinedMessages = assembled.messages.map((message) => message.content).join("\n<<>>\n");
    const injectedText = "[Output guard]\nResolve before instruction.";

    expect(joinedMessages.indexOf(injectedText)).toBeGreaterThan(-1);
    expect(joinedMessages.indexOf("Character post-history instructions.")).toBeGreaterThan(-1);
    expect(joinedMessages.indexOf(injectedText)).toBeLessThan(
      joinedMessages.indexOf("Character post-history instructions."),
    );

    const runtimeTrace = buildPromptRuntimeTrace({
      traceSeed: assembled.runtimeTraceSeed,
    });
    expect(runtimeTrace.injection?.items).toMatchObject([{
      title: "Output guard",
      placementRequested: "before_output_instruction",
      placementResolved: "output_instruction.before",
      applied:true,
    }]);
  });

  it("materializes before_assistant_prefill injections ahead of assistant fallback", async () => {
    const presetId = await insertPreset(database);
    const injectionBuild = new PromptRuntimeInjectionContributorBuilder().build({
      promptMode: "compat_strict",
      injections: [{
        sourceKind: "client_injection",
        title: "Prefill guard",
        content: "Before the assistant prefill.",
        placement: "before_assistant_prefill",
      }],
    });

    const assembled = await assemblePrompt(
      database.db,
      DEFAULT_ADMIN_ACCOUNT_ID,
      createSessionInfo(presetId),
      [],
      "Hello",
      new SimpleTokenCounter(),
      undefined,
      {
        intent: "continue",
        contributors: injectionBuild.renderables,
        injectionItems: injectionBuild.items,
      },
    );

    const materialized = materializePromptRuntimeMessages({
      messages: assembled.messages,
      sendDirectives: assembled.sendDirectives,
      assistantPrefillStrategy: "assistant_message_fallback",
      materializeAssistantPrefillFallback: true,
    });
    const joinedMessages = materialized.messages.map((message) => message.content).join("\n<<>>\n");
    const injectedText = "[Prefill guard]\nBefore the assistant prefill.";

    expect(joinedMessages.indexOf(injectedText)).toBeGreaterThan(-1);
    expect(joinedMessages.indexOf(injectedText)).toBeLessThan(
      joinedMessages.indexOf("Prefill fragment"),
    );
    expect(materialized.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "Prefill fragment",
    });
    expect(assembled.runtimeTraceSeed.injectionItems).toMatchObject([{
      title: "Prefill guard",
      placementRequested: "before_assistant_prefill",
      placementResolved: "assistant_prefill.before",
      applied: true,
    }]);
  });
});

async function insertPreset(database: DatabaseConnection): Promise<string> {
  const presetId = nanoid();
  const now = Date.now();

  await database.db.insert(presets).values({
    id: presetId,
    name: "Prompt Runtime Injection Preset",
    source: "sillytavern",
    accountId: DEFAULT_ADMIN_ACCOUNT_ID,
    dataJson: JSON.stringify(SAMPLE_PRESET_DATA),
    createdAt: now,
    updatedAt: now,
  });

  return presetId;
}

function createSessionInfo(
  presetId: string,
  overrides: Partial<SessionPromptInfo> = {},
): SessionPromptInfo {
  return {
    presetId,
    worldbookProfileId: null,
    regexProfileId: null,
    metadataJson: null,
    characterSnapshotJson: JSON.stringify({ name: "Knight" }),
    promptMode: "compat_strict",
    userSnapshotJson: JSON.stringify({ name: "Traveler" }),
    ...overrides,
  };
}
