import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";

import { DEFAULT_ADMIN_ACCOUNT_ID } from "../src/accounts/constants.js";
import { registerChatRoutes } from "../src/routes/chat";
import { ChatService, ChatServiceError, type ChatService as ChatServiceType, type DryRunResult } from "../src/services/chat/chat-service";
import { createDatabase, type DatabaseConnection } from "../src/db/client";
import {
  accounts,
  floors,
  messagePages,
  messages as messageTable,
  presets,
  promptSnapshots,
  regexProfiles,
  sessions,
  worldbookEntries,
  variables,
  worldbooks,
} from "../src/db/schema";
import { SimpleTokenCounter, type TurnOrchestrator } from "@tavern/core";
import { buildBranchVariableScopeId } from "@tavern/shared";
import { registerDevelopmentTestAuth } from "./helpers/register-test-auth";
import { SessionBranchRegistryService } from "../src/services/variables/host/session-branch-registry-service.js";

interface ChatServiceStub {
  respond: ReturnType<typeof vi.fn>;
  regenerate: ReturnType<typeof vi.fn>;
  dryRun: ReturnType<typeof vi.fn>;
  retryFloor: ReturnType<typeof vi.fn>;
  editAndRegenerate: ReturnType<typeof vi.fn>;
}

function createRouteChatService(overrides: Partial<ChatServiceStub> = {}): ChatServiceStub {
  return {
    respond: vi.fn(),
    regenerate: vi.fn(),
    dryRun: vi.fn(),
    retryFloor: vi.fn(),
    editAndRegenerate: vi.fn(),
    ...overrides,
  };
}

const SAMPLE_PRESET_DATA = {
  prompts: [
    {
      identifier: "main",
      name: "Main Prompt",
      role: "system",
      content: "Write {{char}}'s next response.",
    },
    { identifier: "chatHistory", name: "Chat History", marker: true },
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
  openai_max_context: 2048,
  openai_max_tokens: 300,
  temperature: 0.7,
  top_p: 1,
  top_k: 0,
  min_p: 0,
  frequency_penalty: 0,
  presence_penalty: 0,
  repetition_penalty: 1,
  new_chat_prompt: "",
  new_example_chat_prompt: "",
  continue_nudge_prompt: "",
  assistant_prefill: "",
  wi_format: "{0}",
  names_behavior: 0,
  stream_openai: true,
};

const SAMPLE_REGEX_DATA = [
  {
    id: "regex-1",
    scriptName: "Input Rule",
    findRegex: "/hello/g",
    replaceString: "HELLO",
    trimStrings: [],
    placement: [1],
    disabled: false,
    substituteRegex: 0,
    minDepth: 0,
    maxDepth: 0,
  },
];

describe("POST /sessions/:id/respond/dry-run", () => {
  let app: FastifyInstance;

  async function mountChatRoutes(
    chatService: ChatServiceStub,
    options: { enablePromptDryRun?: boolean; enableSseChat?: boolean } = {}
  ) {
    app = Fastify({ logger: false });
    await registerDevelopmentTestAuth(app);
    await registerChatRoutes(
      app,
      chatService as unknown as ChatServiceType,
      { enablePromptDryRun: true, enableSseChat: false, ...options }
    );
  }

  afterEach(async () => {
    vi.restoreAllMocks();
    if (app) {
      await app.close();
    }
  });

  it("returns 404 when dry-run endpoint is disabled", async () => {
    const chatService = createRouteChatService();

    await mountChatRoutes(chatService, { enablePromptDryRun: false });

    const response = await app.inject({
      method: "POST",
      url: "/sessions/s1/respond/dry-run",
      payload: { message: "hello" },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: {
        code: "not_found",
        message: "Dry-run endpoint is disabled",
      },
    });
  });

  it("returns assembled prompt debug payload when enabled", async () => {
    const result: DryRunResult = {
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "hello" },
      ],
      tokenEstimate: 42,
      availableForReply: 1000,
      memory: { summaryInjected: true },
      memorySummary: "[Memory] hello",
      promptSnapshot: {
        presetId: "preset-1",
        presetUpdatedAt: 1710000000000,
        presetVersion: 3,
        worldbookId: "worldbook-1",
        worldbookUpdatedAt: 1710000001000,
        worldbookVersion: 5,
        regexProfileId: "regex-1",
        regexProfileUpdatedAt: 1710000002000,
        regexProfileVersion: 2,
        characterId: null,
        characterVersionId: null,
        characterImportedFormat: null,
        characterContentHash: null,
        worldbookActivatedEntryUids: [7],
        worldbookActivatedEntries: [],
        regexPreRuleNames: ["Input Rule"],
        regexPostRuleNames: [],
        promptMode: "compat_strict",
        assetManifestDigest: null,
        promptDigest: "digest-1",
        tokenEstimate: 42,
      },
      assembly: {
        mode: "fallback",
        promptIntent: "continue",
        assistantPrefillApplied: true,
        assistantPrefillStrategy: "assistant_message_fallback",
        presetUsed: false,
        selectedPromptOrderCharacterId: 100000,
        ignoredPromptOrderCharacterIds: [200001],
        worldbookHits: 0,
        regexPreRules: ["Input Rule"],
        regexPostRules: [],
        memorySummaryInjected: true,
        reservedVariableCollisions: [],
        unsupportedPresetFields: [],
        ignoredPresetFields: ["top_level.openai_model"],
        unresolvedPresetMarkers: ["customMarker"],
        presetWarnings: [
          "检测到 2 条 prompt_order 上下文轨道；当前运行时只会使用 character_id=100000 的 active 轨道。",
        ],
        continueNudgeApplied: true,
        continueNudgeText: "[Continue]",
        namesBehaviorApplied: "always",
        triggerFilteredEntryIds: ["quietPrompt"],
        inChatInsertedEntryIds: ["continueHint"],
        worldbookMatches: [
          {
            uid: 7,
            comment: "Campfire Lore",
            contentPreview: "The northern pass is watched by old sentries.",
            order: 100,
            activationKey: "worldbook:worldbook-1:5:entry:7",
            assetScopeId: "worldbook:worldbook-1:5",
            source: {
              kind: "session_worldbook",
              worldbookId: "worldbook-1",
              worldbookName: "Campfire Worldbook",
              assetScopeId: "worldbook:worldbook-1:5",
            },
            insertion: {
              position: "before",
            },
            activation: {
              mode: "triggered",
              recursionLevel: 0,
              firstMatch: {
                sourceKind: "message",
                messageIndexFromLatest: 0,
                matchedKey: "campfire",
                matchedKeyScope: "primary",
                matchedKeyType: "plain",
                charStart: 20,
                charEnd: 28,
                excerpt: "Please continue the campfire scene.",
              },
            },
          },
        ],
        preprocessedUserMessage: "hello",
      },
      runtimeTrace: {
        preset: {
          selectedPromptOrderCharacterId: 100000,
          ignoredPromptOrderCharacterIds: [200001],
          unsupportedFields: [],
          ignoredFields: ["top_level.openai_model"],
          unresolvedMarkers: ["customMarker"],
          warnings: ["检测到 2 条 prompt_order 上下文轨道；当前运行时只会使用 character_id=100000 的 active 轨道。"],
          triggerFilteredEntryIds: ["quietPrompt"],
          inChatInsertedEntryIds: ["continueHint"],
          continueNudgeApplied: true,
          continueNudgeText: "[Continue]",
          namesBehaviorApplied: "always",
        },
        worldbook: {
          hitCount: 0,
          matches: [],
        },
        regex: {
          userInputRules: ["Input Rule"],
          aiOutputRules: [],
          preprocessedUserMessage: "hello",
        },
        budgets: {
          byGroup: [
            { group: "history", tokenCount: 24, estimatedTokenCount: 32, allocatedTokenCount: 24, prunedTokenCount: 8 },
            { group: "memory", tokenCount: 12 },
            { group: "worldbook", tokenCount: 16 },
            { group: "section:main", tokenCount: 20 },
          ],
        },
        structure: {
          mode: "no_assistant",
          mergeAdjacentSameRole: false,
          assistantRewriteCount: 1,
          assistantRewriteStrategy: "to_system",
          tailAssistantDetected: false,
        },
        memory: { summaryInjected: true },
        delivery: {
          assistantPrefillRequested: true,
          assistantPrefillApplied: true,
          assistantPrefillStrategy: "assistant_message_fallback",
          allowAssistantPrefill: true,
          requireLastUser: false,
          noAssistant: false,
          lastMessageRole: "user",
          endsWithUser: true,
          degraded: false,
          degradeReasons: [],
        },
        visibility: {
          hiddenFloorRanges: [{ startFloorNo: 1, endFloorNo: 2 }],
          filteredFloorNos: [1, 2],
        },
      },
    };

    const chatService = createRouteChatService({
      dryRun: vi.fn(async () => result),
    });

    await mountChatRoutes(chatService, { enablePromptDryRun: true });

    const response = await app.inject({
      method: "POST",
      url: "/sessions/s1/respond/dry-run",
      payload: {
        message: "hello",
        prompt_intent: "continue",
        debug_options: {
          include_worldbook_matches: true,
        },
        visibility: {
          hidden_floor_ranges: [
            { start_floor_no: 1, end_floor_no: 2 },
          ],
          hidden_floor_ids: ["floor-hidden"],
          mode: "allow_all_except_hidden",
        },
        structure: {
          mode: "no_assistant",
          merge_adjacent_same_role: false,
          assistant_rewrite_strategy: "to_system",
          preserve_system_messages: true,
        },
        delivery: {
          allow_assistant_prefill: false,
          require_last_user: true,
          no_assistant: false,
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(chatService.dryRun).toHaveBeenCalledOnce();
    expect(chatService.dryRun).toHaveBeenCalledWith("s1", {
      message: "hello",
      promptIntent: "continue",
      debugOptions: { includeWorldbookMatches: true },
      visibility: {
        hiddenFloorRanges: [{ startFloorNo: 1, endFloorNo: 2 }],
        hiddenFloorIds: ["floor-hidden"],
        mode: "allow_all_except_hidden",
      },
      structure: {
        mode: "no_assistant",
        mergeAdjacentSameRole: false,
        assistantRewriteStrategy: "to_system",
        preserveSystemMessages: true,
      },
      delivery: {
        allowAssistantPrefill: false,
        requireLastUser: true,
        noAssistant: false,
      },
    }, "default-admin");

    const body = response.json() as { data: Record<string, unknown> };
    expect(body.data.token_estimate).toBe(42);
    expect(body.data.available_for_reply).toBe(1000);
    expect(body.data.memory_summary).toBe("[Memory] hello");
    expect(body.data.messages).toEqual(result.messages);
    expect(body.data.prompt_snapshot).toEqual({
      preset_id: "preset-1",
      preset_updated_at: 1710000000000,
      preset_version: 3,
      preset_version_id: null,
      preset_content_hash: null,
      worldbook_id: "worldbook-1",
      worldbook_updated_at: 1710000001000,
      worldbook_version: 5,
      worldbook_version_id: null,
      worldbook_content_hash: null,
      regex_profile_id: "regex-1",
      regex_profile_updated_at: 1710000002000,
      regex_profile_version: 2,
      regex_profile_version_id: null,
      regex_profile_content_hash: null,
      character_id: null,
      character_version_id: null,
      character_imported_format: null,
      character_content_hash: null,
      worldbook_activated_entry_uids: [7],
      worldbook_activated_entries: [],
      regex_pre_rule_names: ["Input Rule"],
      regex_post_rule_names: [],
      prompt_mode: "compat_strict",
      asset_manifest_digest: null,
      prompt_digest: "digest-1",
      token_estimate: 42,
    });
    expect(body.data.assembly).toEqual({
      mode: "fallback",
      prompt_intent: "continue",
      assistant_prefill_applied: true,
      assistant_prefill_strategy: "assistant_message_fallback",
      preset_used: false,
      worldbook_hits: 0,
      selected_prompt_order_character_id: 100000,
      ignored_prompt_order_character_ids: [200001],
      regex_pre_rules: ["Input Rule"],
      regex_post_rules: [],
      memory_summary_injected: true,
      reserved_variable_collisions: [],
      unsupported_preset_fields: [],
      ignored_preset_fields: ["top_level.openai_model"],
      unresolved_preset_markers: ["customMarker"],
      preset_warnings: ["检测到 2 条 prompt_order 上下文轨道；当前运行时只会使用 character_id=100000 的 active 轨道。"],
      continue_nudge_applied: true,
      continue_nudge_text: "[Continue]",
      names_behavior_applied: "always",
      trigger_filtered_entry_ids: ["quietPrompt"],
      in_chat_inserted_entry_ids: ["continueHint"],
      worldbook_matches: [
        {
          uid: 7,
          comment: "Campfire Lore",
          content_preview: "The northern pass is watched by old sentries.",
          order: 100,
          activation_key: "worldbook:worldbook-1:5:entry:7",
          asset_scope_id: "worldbook:worldbook-1:5",
          source: {
            kind: "session_worldbook",
            worldbook_id: "worldbook-1",
            worldbook_name: "Campfire Worldbook",
            asset_scope_id: "worldbook:worldbook-1:5",
          },
          insertion: {
            position: "before",
          },
          activation: {
            mode: "triggered",
            recursion_level: 0,
            first_match: {
              source_kind: "message",
              message_index_from_latest: 0,
              matched_key: "campfire",
              matched_key_scope: "primary",
              matched_key_type: "plain",
              char_start: 20,
              char_end: 28,
              excerpt: "Please continue the campfire scene.",
            },
          },
        },
      ],
      preprocessed_user_message: "hello",
    });
    expect(body.data.runtime_trace).toMatchObject({
      preset: {
        selected_prompt_order_character_id: 100000,
        ignored_prompt_order_character_ids: [200001],
        unsupported_fields: [],
        ignored_fields: ["top_level.openai_model"],
        unresolved_markers: ["customMarker"],
        warnings: ["检测到 2 条 prompt_order 上下文轨道；当前运行时只会使用 character_id=100000 的 active 轨道。"],
        trigger_filtered_entry_ids: ["quietPrompt"],
        in_chat_inserted_entry_ids: ["continueHint"],
        continue_nudge_applied: true,
        continue_nudge_text: "[Continue]",
        names_behavior_applied: "always",
      },
      worldbook: {
        hit_count: 0,
        matches: [],
      },
      regex: {
        user_input_rules: ["Input Rule"],
        ai_output_rules: [],
        preprocessed_user_message: "hello",
      },
      budgets: {
        by_group: [
          { group: "history", token_count: 24, estimated_token_count: 32, allocated_token_count: 24, pruned_token_count: 8 },
          { group: "memory", token_count: 12 },
          { group: "worldbook", token_count: 16 },
          { group: "section:main", token_count: 20 },
        ],
      },
      structure: {
        mode: "no_assistant",
        merge_adjacent_same_role: false,
        assistant_rewrite_count: 1,
        assistant_rewrite_strategy: "to_system",
        tail_assistant_detected: false,
      },
      memory: {
        summary_injected: true,
      },
      delivery: {
        assistant_prefill_requested: true,
        assistant_prefill_applied: true,
        assistant_prefill_strategy: "assistant_message_fallback",
        allow_assistant_prefill: true,
        require_last_user: false,
        no_assistant: false,
        last_message_role: "user",
        ends_with_user: true,
        degraded: false,
        degrade_reasons: [],
      },
      visibility: {
        hidden_floor_ranges: [{ start_floor_no: 1, end_floor_no: 2 }],
        filtered_floor_nos: [1, 2],
      },
    });
  });

  it("returns null for optional debug fields when they are absent", async () => {
    const result: DryRunResult = {
      messages: [{ role: "user", content: "hello" }],
      tokenEstimate: 12,
      availableForReply: 256,
      memory: { summaryInjected: false },
      promptSnapshot: {
        presetId: null,
        presetUpdatedAt: null,
        presetVersion: null,
        worldbookId: null,
        worldbookUpdatedAt: null,
        worldbookVersion: null,
        regexProfileId: null,
        regexProfileUpdatedAt: null,
        regexProfileVersion: null,
        characterId: null,
        characterVersionId: null,
        characterImportedFormat: null,
        characterContentHash: null,
        worldbookActivatedEntryUids: [],
        worldbookActivatedEntries: [],
        regexPreRuleNames: [],
        regexPostRuleNames: ["Output Rule"],
        promptMode: "compat_strict",
        assetManifestDigest: null,
        promptDigest: "digest-2",
        tokenEstimate: 12,
      },
      assembly: {
        mode: "preset",
        promptIntent: "normal",
        assistantPrefillApplied: false,
        assistantPrefillStrategy: "none",
        presetUsed: true,
        selectedPromptOrderCharacterId: null,
        ignoredPromptOrderCharacterIds: [],
        worldbookHits: 1,
        regexPreRules: [],
        regexPostRules: ["Output Rule"],
        memorySummaryInjected: false,
        reservedVariableCollisions: [],
        unsupportedPresetFields: [],
        ignoredPresetFields: [],
        unresolvedPresetMarkers: [],
        presetWarnings: [],
        continueNudgeApplied: false,
        continueNudgeText: undefined,
        namesBehaviorApplied: "off",
        triggerFilteredEntryIds: [],
        inChatInsertedEntryIds: [],
      },
    };

    const chatService = createRouteChatService({
      dryRun: vi.fn(async () => result),
    });

    await mountChatRoutes(chatService, { enablePromptDryRun: true });

    const response = await app.inject({
      method: "POST",
      url: "/sessions/s1/respond/dry-run",
      payload: { message: "hello" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        messages: [{ role: "user", content: "hello" }],
        token_estimate: 12,


        available_for_reply: 256,
        memory: { summary_injected: false },
        prompt_snapshot: {
          preset_id: null,
          preset_updated_at: null,
          preset_version: null,
          preset_version_id: null,
          preset_content_hash: null,
          worldbook_id: null,
          worldbook_updated_at: null,
          worldbook_version: null,
          worldbook_version_id: null,
          worldbook_content_hash: null,
          regex_profile_id: null,
          regex_profile_updated_at: null,
          regex_profile_version: null,
          regex_profile_version_id: null,
          regex_profile_content_hash: null,
          character_id: null,
          character_version_id: null,
          character_imported_format: null,
          character_content_hash: null,
          worldbook_activated_entry_uids: [],
          worldbook_activated_entries: [],
          regex_pre_rule_names: [],
          regex_post_rule_names: ["Output Rule"],
          prompt_mode: "compat_strict",
          asset_manifest_digest: null,
          prompt_digest: "digest-2",
          token_estimate: 12,
        },
        assembly: {
          mode: "preset",
          prompt_intent: "normal",
          assistant_prefill_applied: false,
          assistant_prefill_strategy: "none",
          preset_used: true,
          selected_prompt_order_character_id: null,
          ignored_prompt_order_character_ids: [],
          worldbook_hits: 1,
          regex_pre_rules: [],
          regex_post_rules: ["Output Rule"],
          memory_summary_injected: false,
          reserved_variable_collisions: [],
          unsupported_preset_fields: [],
          ignored_preset_fields: [],
          unresolved_preset_markers: [],
          preset_warnings: [],
          continue_nudge_applied: false,
          continue_nudge_text: null,
          names_behavior_applied: "off",
          trigger_filtered_entry_ids: [],
          in_chat_inserted_entry_ids: [],
          preprocessed_user_message: null,
        },
        memory_summary: null,
      },
    });
  });

  it("maps chat service errors when enabled", async () => {
    const chatService = createRouteChatService({
      dryRun: vi.fn(async () => {
        throw new ChatServiceError("session_archived", "Cannot dry-run in an archived session");
      }),
    });

    await mountChatRoutes(chatService, { enablePromptDryRun: true });

    const response = await app.inject({
      method: "POST",
      url: "/sessions/s1/respond/dry-run",
      payload: { message: "hello" },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: {
        code: "session_archived",
        message: "Cannot dry-run in an archived session",


      },
    });
  });
  it("does not forward dry-run debug_options into the normal respond service request", async () => {
    const chatService = createRouteChatService({
      respond: vi.fn(async () => ({
        floorId: "floor-1",
        floorNo: 1,
        branchId: "main",
        generatedText: "ok",
        summaries: [],
        totalUsage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        finalState: "committed",
      })),
    });

    await mountChatRoutes(chatService, { enablePromptDryRun: true });

    const response = await app.inject({
      method: "POST",
      url: "/sessions/s1/respond",
      payload: {
        message: "hello",
        debug_options: {
          include_worldbook_matches: true,
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(chatService.respond).toHaveBeenCalledOnce();
    expect(chatService.respond).toHaveBeenCalledWith("s1", {
      message: "hello",
      config: undefined,
      generationParams: undefined,
      branchId: undefined,
      sourceFloorId: undefined,
      promptIntent: undefined,
      structure: undefined,
      delivery: undefined,
      sessionStateWrites: undefined,
      sessionStateOperationLog: undefined,
      turnOperationLog: {
        requestId: expect.any(String),
        route: "POST /sessions/:id/respond",
      },
      debugOptions: { includeWorldbookMatches: true },
    }, {}, "default-admin");
  });



});

describe("ChatService.dryRun", () => {
  let database: DatabaseConnection;
  let chatService: ChatService;
  let sessionId: string;
  let mockOrchestrator: TurnOrchestrator;

  beforeEach(async () => {
    database = createDatabase(":memory:");

    mockOrchestrator = {
      executeTurn: vi.fn(async () => {
        throw new Error("executeTurn should not be called in dry-run");
      }),
    } as unknown as TurnOrchestrator;

    chatService = new ChatService(database.db, mockOrchestrator, new SimpleTokenCounter());

    sessionId = nanoid();
    const now = Date.now();


    await database.db.insert(sessions).values({
      id: sessionId,
      title: "Dry Run Session",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    new SessionBranchRegistryService(database.db).ensure({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      sessionId,
      branchId: "main",
      createdAt: now,
      updatedAt: now,
    });

    const floorId = nanoid();
    await database.db.insert(floors).values({
      id: floorId,
      sessionId,
      floorNo: 0,
      branchId: "main",
      parentFloorId: null,
      state: "committed",
      tokenIn: 0,
      tokenOut: 0,
      createdAt: now,
      updatedAt: now,
    });

    const pageId = nanoid();
    await database.db.insert(messagePages).values({
      id: pageId,
      floorId,
      pageNo: 0,
      pageKind: "input",
      isActive: true,
      version: 1,
      checksum: null,
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(messageTable).values({
      id: nanoid(),
      pageId,
      seq: 0,
      role: "user",
      content: "history",
      contentFormat: "text",
      tokenCount: 1,
      isHidden: false,
      source: "api",
      createdAt: now,
    });
  });

  afterEach(() => {
    database.close();
  });

  it("does not call orchestrator and does not write floor/message side effects", async () => {
    const floorsBefore = await database.db.select().from(floors).where(eq(floors.sessionId, sessionId));
    const messagesBefore = await database.db.select().from(messageTable);
    const promptSnapshotsBefore = await database.db.select().from(promptSnapshots);

    const result = await chatService.dryRun(sessionId, { message: "hello dry run" });

    expect(result.messages[result.messages.length - 1]?.content).toBe("history\n\nhello dry run");
    expect(result.tokenEstimate).toBeGreaterThan(0);
    expect(result.promptSnapshot.presetId).toBeNull();
    expect(result.promptSnapshot.worldbookActivatedEntryUids).toEqual([]);
    expect(result.promptSnapshot.promptDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(mockOrchestrator.executeTurn).not.toHaveBeenCalled();

    const floorsAfter = await database.db.select().from(floors).where(eq(floors.sessionId, sessionId));


    const messagesAfter = await database.db.select().from(messageTable);
    const promptSnapshotsAfter = await database.db.select().from(promptSnapshots);

    expect(floorsAfter).toEqual(floorsBefore);
    expect(messagesAfter).toEqual(messagesBefore);
    expect(promptSnapshotsAfter).toEqual(promptSnapshotsBefore);
  });

  it("applies request budget to dry-run prompt totals", async () => {
    const result = await chatService.dryRun(sessionId, {
      message: "hello dry run",
      budget: {
        maxInputTokens: 256,
        reservedCompletionTokens: 32,
      },
    });

    expect(result.tokenEstimate + result.availableForReply).toBe(288);
  });

  it("surfaces allocator trim reasons when internal budget group policies are provided", async () => {
    const now = Date.now();
    const presetId = nanoid();

    await database.db.insert(presets).values({
      id: presetId,
      name: "Dry Run Budget Allocator Preset",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      source: "sillytavern",
      dataJson: JSON.stringify(SAMPLE_PRESET_DATA),
      createdAt: now,
      updatedAt: now,
    });

    await database.db
      .update(sessions)
      .set({ presetId, characterSnapshotJson: JSON.stringify({ name: "Knight" }), updatedAt: now })
      .where(eq(sessions.id, sessionId));

    const result = await chatService.dryRun(sessionId, {
      message: "hello dry run",
      budget: {
        maxInputTokens: 256,
        reservedCompletionTokens: 32,
        groups: [{ group: "history", maxTokens: 0 }],
      } as any,
    });

    expect(result.runtimeTrace?.budgets?.byGroup).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          group: "history",
          tokenCount: 0,
          estimatedTokenCount: expect.any(Number),
          allocatedTokenCount: 0,
          prunedTokenCount: expect.any(Number),
        }),
      ]),
    );
    expect(result.runtimeTrace?.budgets?.trimReasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ group: "history", reason: "group_limit_exceeded" }),
      ]),
    );
  });

  it("keeps allocator trace disabled when dry-run budget groups are absent", async () => {
    const now = Date.now();
    const presetId = nanoid();

    await database.db.insert(presets).values({
      id: presetId,
      name: "Dry Run Aggregate Budget Preset",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      source: "sillytavern",
      dataJson: JSON.stringify(SAMPLE_PRESET_DATA),
      createdAt: now,
      updatedAt: now,
    });

    await database.db
      .update(sessions)
      .set({ presetId, characterSnapshotJson: JSON.stringify({ name: "Knight" }), updatedAt: now })
      .where(eq(sessions.id, sessionId));

    const result = await chatService.dryRun(sessionId, {
      message: "hello dry run",
      budget: {
        maxInputTokens: 256,
        reservedCompletionTokens: 32,
      },
    });

    const historyGroup = result.runtimeTrace?.budgets?.byGroup.find((group) => group.group === "history");

    expect(historyGroup).toBeDefined();
    expect(historyGroup).not.toHaveProperty("estimatedTokenCount");
    expect(historyGroup).not.toHaveProperty("allocatedTokenCount");
    expect(result.runtimeTrace?.budgets?.trimReasons).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: "group_limit_exceeded" }),
      ]),
    );
  });

  it("returns visibility trace when dry-run visibility override is provided", async () => {
    const now = Date.now();
    let previousFloorId: string | null = null;
    for (let floorNo = 1; floorNo <= 2; floorNo += 1) {
      const floorId = nanoid();
      const pageId = nanoid();
      await database.db.insert(floors).values({
        id: floorId,
        sessionId,
        floorNo,
        branchId: "main",
        // ancestry 修复后 floor 身份由 parentFloorId 链决定；
        // 让 floor 2 的 parent 指向 floor 1，visibility filter 的 history
        // 才能完整覆盖这两层。
        parentFloorId: previousFloorId,
        state: "committed",
        tokenIn: 0,
        tokenOut: 0,
        createdAt: now + floorNo,
        updatedAt: now + floorNo,
      });
      await database.db.insert(messagePages).values({
        id: pageId,
        floorId,
        pageNo: 0,
        pageKind: "input",
        isActive: true,
        version: 1,
        checksum: null,
        createdAt: now + floorNo,
        updatedAt: now + floorNo,
      });
      previousFloorId = floorId;
    }

    const result = await chatService.dryRun(sessionId, {
      message: "hello dry run",
      visibility: { hiddenFloorRanges: [{ startFloorNo: 1, endFloorNo: 1 }] },
    });

    expect(result.runtimeTrace?.visibility).toEqual({ hiddenFloorRanges: [{ startFloorNo: 1, endFloorNo: 1 }], filteredFloorNos: [1] });
  });

  it("keeps recent message macros aligned with visibility-filtered history", async () => {
    const now = Date.now();
    const presetId = nanoid();
    const hiddenFloorId = nanoid();
    const hiddenPageId = nanoid();

    await database.db.insert(presets).values({
      id: presetId,
      name: "Dry Run Visibility Macro Preset",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      source: "sillytavern",
      dataJson: JSON.stringify({
        ...SAMPLE_PRESET_DATA,
        prompts: [
          {
            identifier: "main",
            name: "Main Prompt",
            role: "system",
            content: "last={{lastMessage}} | user={{lastUserMessage}} | char={{lastCharMessage}}",
          },
          { identifier: "chatHistory", name: "Chat History", marker: true },
        ],
      }),
      createdAt: now,
      updatedAt: now,
    });

    await database.db
      .update(sessions)
      .set({ presetId, characterSnapshotJson: JSON.stringify({ name: "Knight" }), updatedAt: now })
      .where(eq(sessions.id, sessionId));

    await database.db.insert(floors).values({
      id: hiddenFloorId,
      sessionId,
      floorNo: 1,
      branchId: "main",
      parentFloorId: null,
      state: "committed",
      tokenIn: 0,
      tokenOut: 0,
      createdAt: now + 1,
      updatedAt: now + 1,
    });
    await database.db.insert(messagePages).values({
      id: hiddenPageId,
      floorId: hiddenFloorId,
      pageNo: 0,
      pageKind: "output",
      isActive: true,
      version: 1,
      checksum: null,
      createdAt: now + 1,
      updatedAt: now + 1,
    });
    await database.db.insert(messageTable).values({
      id: nanoid(), pageId: hiddenPageId, seq: 0, role: "assistant", content: "hidden assistant", contentFormat: "text", tokenCount: 1, isHidden: false, source: "api", createdAt: now + 1,
    });

    const result = await chatService.dryRun(sessionId, {
      message: "visible request",
      visibility: { hiddenFloorRanges: [{ startFloorNo: 1, endFloorNo: 1 }] },
    });

    const systemMessage = result.messages.find((message) => message.role === "system");
    expect(systemMessage?.content).toContain("last=visible request");
    expect(systemMessage?.content).toContain("user=visible request");
    expect(systemMessage?.content).toContain("char=");
    expect(systemMessage?.content).not.toContain("hidden assistant");
  });

  it("returns delivery trace when dry-run delivery override is provided", async () => {
    const now = Date.now();
    const presetId = nanoid();

    await database.db.insert(presets).values({
      id: presetId,
      name: "Dry Run Delivery Preset",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      source: "sillytavern",
      dataJson: JSON.stringify({
        ...SAMPLE_PRESET_DATA,
        assistant_prefill: "Knight:",
      }),
      createdAt: now,
      updatedAt: now,
    });

    await database.db
      .update(sessions)
      .set({ presetId, characterSnapshotJson: JSON.stringify({ name: "Knight" }), updatedAt: now })
      .where(eq(sessions.id, sessionId));

    const result = await chatService.dryRun(sessionId, {
      message: "hello dry run",
      promptIntent: "continue",
      delivery: { requireLastUser: true },
    });

    expect(result.runtimeTrace?.delivery).toEqual({ assistantPrefillRequested: true, assistantPrefillApplied: false, assistantPrefillStrategy: "none", allowAssistantPrefill: true, requireLastUser: true, noAssistant: false, lastMessageRole: "user", endsWithUser: true, degraded: true, degradeReasons: ["require_last_user"] });
  });

  it("returns structure trace and normalized messages when dry-run structure override is provided", async () => {
    const now = Date.now();
    const floorId = nanoid();
    const pageId = nanoid();

    await database.db.insert(floors).values({
      id: floorId,
      sessionId,
      floorNo: 1,
      branchId: "main",
      parentFloorId: null,
      state: "committed",
      tokenIn: 0,
      tokenOut: 0,
      createdAt: now,
      updatedAt: now,
    });
    await database.db.insert(messagePages).values({
      id: pageId,
      floorId,
      pageNo: 0,
      pageKind: "output",
      isActive: true,
      version: 1,
      checksum: null,
      createdAt: now,
      updatedAt: now,
    });
    await database.db.insert(messageTable).values({
      id: nanoid(),
      pageId,
      seq: 0,
      role: "assistant",
      content: "history assistant",
      contentFormat: "text",
      tokenCount: 1,
      isHidden: false,
      source: "api",
      createdAt: now,
    });

    const result = await chatService.dryRun(sessionId, { message: "hello dry run", structure: { mode: "no_assistant" } });

    expect(result.messages.some((message) => message.role === "assistant")).toBe(false);
    expect(result.messages.some((message) => message.role === "system" && message.content === "history assistant")).toBe(true);
    expect(result.runtimeTrace?.structure).toEqual({ mode: "no_assistant", mergeAdjacentSameRole: false, assistantRewriteCount: 1, assistantRewriteStrategy: "to_system", tailAssistantDetected: false });
    expect(result.promptSnapshot.tokenEstimate).toBe(result.tokenEstimate);
    expect(result.promptSnapshot.promptDigest).toMatch(/^[a-f0-9]{64}$/);
  });
  it("applies session prompt runtime structure policy on dry-run when request override is absent", async () => {
    const now = Date.now();
    const floorId = nanoid();
    const pageId = nanoid();

    await database.db
      .update(sessions)
      .set({
        metadataJson: JSON.stringify({
          prompt_runtime: {
            policy: {
              structure: {
                mode: "no_assistant",
              },
            },
          },
        }),
        updatedAt: now,
      })
      .where(eq(sessions.id, sessionId));

    await database.db.insert(floors).values({
      id: floorId,
      sessionId,
      floorNo: 1,
      branchId: "main",
      parentFloorId: null,
      state: "committed",
      tokenIn: 0,
      tokenOut: 0,
      createdAt: now,
      updatedAt: now,
    });
    await database.db.insert(messagePages).values({
      id: pageId,
      floorId,
      pageNo: 0,
      pageKind: "output",
      isActive: true,
      version: 1,
      checksum: null,
      createdAt: now,
      updatedAt: now,
    });
    await database.db.insert(messageTable).values({
      id: nanoid(),
      pageId,
      seq: 0,
      role: "assistant",
      content: "history assistant",
      contentFormat: "text",
      tokenCount: 1,
      isHidden: false,
      source: "api",
      createdAt: now,
    });

    const result = await chatService.dryRun(sessionId, { message: "hello dry run" });

    expect(result.messages.some((message) => message.role === "assistant")).toBe(false);
    expect(result.messages.some((message) => message.role === "system" && message.content === "history assistant")).toBe(true);
    expect(result.runtimeTrace?.structure).toEqual({
      mode: "no_assistant",
      mergeAdjacentSameRole: false,
      assistantRewriteCount: 1,
      assistantRewriteStrategy: "to_system",
      tailAssistantDetected: false,
    });
  });



  it("returns prompt snapshot preview for loaded resources without persisting prompt_snapshot rows", async () => {
    const now = Date.now();
    const presetId = nanoid();
    const worldbookId = nanoid();
    const regexProfileId = nanoid();

    await database.db.insert(presets).values({
      id: presetId,
      name: "Dry Run Preset",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      source: "sillytavern",
      dataJson: JSON.stringify(SAMPLE_PRESET_DATA),
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(worldbooks).values({
      id: worldbookId,
      name: "Dry Run Worldbook",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      source: "sillytavern",
      dataJson: JSON.stringify({ scanDepth: 3 }),
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(worldbookEntries).values({
      id: nanoid(),
      worldbookId,
      uid: 7,
      comment: "Sword",
      content: "A blessed sword rests in the shrine.",
      keysJson: JSON.stringify(["sword"]),
      keysSecondaryJson: JSON.stringify([]),
      selective: false,
      selectiveLogic: 0,
      constant: false,
      position: 0,
      order: 100,
      depth: 4,
      role: 0,
      disable: false,
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(regexProfiles).values({
      id: regexProfileId,
      name: "Dry Run Regex",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      source: "sillytavern",
      dataJson: JSON.stringify(SAMPLE_REGEX_DATA),
      createdAt: now,
      updatedAt: now,
    });

    await database.db
      .update(sessions)
      .set({
        presetId,
        worldbookProfileId: worldbookId,
        regexProfileId,
        characterSnapshotJson: JSON.stringify({ name: "Knight" }),
        updatedAt: now,
      })
      .where(eq(sessions.id, sessionId));

    const result = await chatService.dryRun(sessionId, { message: "hello sword" });

    expect(result.promptSnapshot).toMatchObject({
      presetId,
      presetUpdatedAt: now,
      presetVersion: 1,
      worldbookId,
      worldbookUpdatedAt: now,
      worldbookVersion: 1,
      regexProfileId,
      regexProfileUpdatedAt: now,
      regexProfileVersion: 1,
      worldbookActivatedEntryUids: [7],
      regexPreRuleNames: ["Input Rule"],
      regexPostRuleNames: [],
      promptMode: "compat_strict",
      tokenEstimate: result.tokenEstimate,
    });
    expect(result.promptSnapshot.promptDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(await database.db.select().from(promptSnapshots)).toEqual([]);
  });

  it("reports assistant prefill runtime semantics without materializing it into dry-run message history", async () => {
    const now = Date.now();
    const presetId = nanoid();

    await database.db.insert(presets).values({
      id: presetId,
      name: "Dry Run Prefill Preset",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      source: "sillytavern",
      dataJson: JSON.stringify({
        ...SAMPLE_PRESET_DATA,
        assistant_prefill: "Knight:",
      }),
      createdAt: now,
      updatedAt: now,
    });

    await database.db
      .update(sessions)
      .set({
        presetId,
        characterSnapshotJson: JSON.stringify({ name: "Knight" }),
        updatedAt: now,
      })
      .where(eq(sessions.id, sessionId));

    const result = await chatService.dryRun(sessionId, { message: "hello prefill" });
    const visibleTokenCounter = new SimpleTokenCounter();
    const visibleTokenEstimate = result.messages.reduce((sum, message) => sum + visibleTokenCounter.count(message.content), 0);



    expect(result.messages.some((message) => message.role === "assistant" && message.content === "Knight:")).toBe(false);
    expect(result.messages.some((message) => message.role === "user" && message.content.includes("hello prefill"))).toBe(true);
    expect(typeof result.assembly.assistantPrefillApplied).toBe("boolean");
    expect(["assistant_message_fallback", "none"]).toContain(result.assembly.assistantPrefillStrategy);
    expect(result.assembly.unsupportedPresetFields).not.toContain("assistant_prefill");
    expect(result.tokenEstimate).toBeGreaterThanOrEqual(visibleTokenEstimate);
    expect(result.promptSnapshot.tokenEstimate).toBe(result.tokenEstimate);
  });

  it("transcriptizes assistant prefill on dry-run when structure sets flattened", async () => {
    const now = Date.now();
    const presetId = nanoid();

    await database.db.insert(presets).values({
      id: presetId,
      name: "Dry Run Flattened Prefill Preset",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      source: "sillytavern",
      dataJson: JSON.stringify({
        ...SAMPLE_PRESET_DATA,
        assistant_prefill: "Knight:",
      }),
      createdAt: now,
      updatedAt: now,
    });

    await database.db
      .update(sessions)
      .set({
        presetId,
        characterSnapshotJson: JSON.stringify({ name: "Knight" }),
        updatedAt: now,
      })
      .where(eq(sessions.id, sessionId));

    const result = await chatService.dryRun(sessionId, {
      message: "hello prefill",
      promptIntent: "continue",
      structure: { mode: "flattened" },
      delivery: { requireLastUser: true },
    });

    expect(result.messages.some((message) => message.role === "assistant")).toBe(false);
    expect(result.messages.some((message) => message.role === "user" && message.content.includes("hello prefill"))).toBe(true);
    expect(result.messages.some((message) => message.role === "user" && message.content.includes("Assistant: Knight:"))).toBe(true);
    expect(result.runtimeTrace?.structure).toMatchObject({ mode: "flattened", transcriptized: true, assistantPrefillTranscriptized: true });
    expect(result.runtimeTrace?.delivery).toMatchObject({ assistantPrefillRequested: true, assistantPrefillApplied: true, assistantPrefillStrategy: "transcript_append", requireLastUser: true, endsWithUser: true });
    expect(result.promptSnapshot.tokenEstimate).toBe(result.tokenEstimate);
  });

  it("injects persisted visible variables into dry-run prompt assembly and reports reserved alias collisions", async () => {
    const now = Date.now();
    const presetId = nanoid();

    const variablePresetData = {
      ...SAMPLE_PRESET_DATA,
      prompts: [
        {
          identifier: "main",
          name: "Main Prompt",
          role: "system",
          content: "Mood {{mood}} for {{char}} and {{user}}.",
        },
        { identifier: "chatHistory", name: "Chat History", marker: true },
      ],
    };

    await database.db.insert(presets).values({
      id: presetId,
      name: "Dry Run Variable Preset",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      source: "sillytavern",
      dataJson: JSON.stringify(variablePresetData),
      createdAt: now,
      updatedAt: now,
    });

    await database.db
      .update(sessions)
      .set({
        presetId,
        characterSnapshotJson: JSON.stringify({ name: "Knight" }),
        userSnapshotJson: JSON.stringify({ name: "Traveler" }),
        updatedAt: now,
      })
      .where(eq(sessions.id, sessionId));

    await database.db.insert(variables).values([
      { id: nanoid(), accountId: DEFAULT_ADMIN_ACCOUNT_ID, scope: "global", scopeId: "global", key: "mood", valueJson: JSON.stringify("calm"), updatedAt: now },
      { id: nanoid(), accountId: DEFAULT_ADMIN_ACCOUNT_ID, scope: "chat", scopeId: sessionId, key: "mood", valueJson: JSON.stringify("focused"), updatedAt: now + 1 },
      { id: nanoid(), accountId: DEFAULT_ADMIN_ACCOUNT_ID, scope: "global", scopeId: "global", key: "char", valueJson: JSON.stringify("Shadow"), updatedAt: now + 2 },
      { id: nanoid(), accountId: DEFAULT_ADMIN_ACCOUNT_ID, scope: "global", scopeId: "global", key: "user", valueJson: JSON.stringify("Stranger"), updatedAt: now + 3 },
    ]);

    const result = await chatService.dryRun(sessionId, { message: "hello variables" });
    const allContent = result.messages.map((message) => message.content).join("\n");

    expect(allContent).toContain("Mood focused for Knight and Traveler.");
    expect(result.assembly.reservedVariableCollisions).toEqual(["char", "user"]);
  });

  it("surfaces macro diagnostics from real dry-run assembly in runtime trace", async () => {
    const now = Date.now();
    const presetId = nanoid();

    await database.db.insert(presets).values({
      id: presetId,
      name: "Dry Run Macro Trace Preset",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      source: "sillytavern",
      dataJson: JSON.stringify({
        ...SAMPLE_PRESET_DATA,
        prompts: [
          {
            identifier: "main",
            name: "Main Prompt",
            role: "system",
            content: "kind={{lastGenerationType}} {{setvar::mood::happy}}{{if {{lastGenerationType}} == dry_run}}OK{{/if}}",
          },
          { identifier: "chatHistory", name: "Chat History", marker: true },
        ],
      }),
      createdAt: now,
      updatedAt: now,
    });

    await database.db
      .update(sessions)
      .set({
        presetId,
        characterSnapshotJson: JSON.stringify({ name: "Knight" }),
        updatedAt: now,
      })
      .where(eq(sessions.id, sessionId));

    const result = await chatService.dryRun(sessionId, { message: "hello macros" });
    const allContent = result.messages.map((message) => message.content).join("\n");

    expect(allContent).toContain("kind=dry_run");
    expect(allContent).toContain("OK");
    expect(result.assembly).not.toHaveProperty("macroWarnings");
    expect(result.assembly).not.toHaveProperty("macroUsedNames");
    expect(result.assembly).not.toHaveProperty("macroMutationPreview");
    expect(result.assembly).not.toHaveProperty("macroStagedMutations");
    expect(result.assembly).not.toHaveProperty("macroTraces");
    expect(result.runtimeTrace?.macro?.usedNames).toEqual(expect.arrayContaining(["if", "lastGenerationType", "setvar"]));
    expect(result.runtimeTrace?.macro?.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "macro_preview_side_effect_suppressed", macroName: "setvar" })]));
    expect(result.runtimeTrace?.macro?.mutationPreview).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "set", scope: "branch", key: "mood", value: "happy" })]));
    expect(result.runtimeTrace?.macro?.traces).toEqual(expect.arrayContaining([expect.objectContaining({ macroName: "lastGenerationType", resolvedText: "dry_run" })]));
  });

  it("supports richer if conditions in real dry-run assembly", async () => {
    const now = Date.now();
    const presetId = nanoid();

    await database.db.insert(presets).values({
      id: presetId,
      name: "Dry Run Rich If Preset",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      source: "sillytavern",
      dataJson: JSON.stringify({
        ...SAMPLE_PRESET_DATA,
        prompts: [
          {
            identifier: "main",
            name: "Main Prompt",
            role: "system",
            content: "{{if ({{lastGenerationType}} == dry_run) and ({{getvar::score}} >= 80)}}PASS{{else}}FAIL{{/if}}",
          },
          { identifier: "chatHistory", name: "Chat History", marker: true },
        ],
      }),
      createdAt: now,
      updatedAt: now,
    });

    await database.db
      .update(sessions)
      .set({
        presetId,
        characterSnapshotJson: JSON.stringify({ name: "Knight" }),
        updatedAt: now,
      })
      .where(eq(sessions.id, sessionId));

    await database.db.insert(variables).values({
      id: nanoid(),
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      scope: "branch",
      scopeId: buildBranchVariableScopeId(sessionId, "main"),
      key: "score",
      valueJson: JSON.stringify(88),
      updatedAt: now + 1,
    });

    const result = await chatService.dryRun(sessionId, { message: "hello rich macros" });
    const allContent = result.messages.map((message) => message.content).join("\n");

    expect(allContent).toContain("PASS");
    expect(result.runtimeTrace?.macro?.usedNames).toEqual(expect.arrayContaining(["if", "lastGenerationType", "getvar"]));
    expect(result.runtimeTrace?.macro?.warnings?.some((warning) => warning.code === "macro_condition_unsupported")).toBe(false);
    expect(result.runtimeTrace?.macro?.traces).toEqual(expect.arrayContaining([expect.objectContaining({ macroName: "if", selectedBranch: "then", resolvedText: "PASS" })]));
  });

  it("surfaces structured path reads and root mutation preview in real dry-run assembly", async () => {
    const now = Date.now();
    const presetId = nanoid();

    await database.db.insert(presets).values({
      id: presetId,
      name: "Dry Run Structured Path Preset",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      source: "sillytavern",
      dataJson: JSON.stringify({
        ...SAMPLE_PRESET_DATA,
        prompts: [
          {
            identifier: "main",
            name: "Main Prompt",
            role: "system",
            content: "gold={{getvar::资产.金币}} silver={{setvar::资产.银币::5}}{{getvar::资产.银币}}",
          },
          { identifier: "chatHistory", name: "Chat History", marker: true },
        ],
      }),
      createdAt: now,
      updatedAt: now,
    });

    await database.db
      .update(sessions)
      .set({
        presetId,
        characterSnapshotJson: JSON.stringify({ name: "Knight" }),
        updatedAt: now,
      })
      .where(eq(sessions.id, sessionId));

    await database.db.insert(variables).values({
      id: nanoid(),
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      scope: "branch",
      scopeId: buildBranchVariableScopeId(sessionId, "main"),
      key: "资产",
      valueJson: JSON.stringify({ 金币: 3 }),
      updatedAt: now + 1,
    });

    const result = await chatService.dryRun(sessionId, { message: "hello structured path macros" });
    const allContent = result.messages.map((message) => message.content).join("\n");

    expect(allContent).toContain("gold=3 silver=5");
    expect(result.runtimeTrace?.macro?.usedNames).toEqual(expect.arrayContaining(["getvar", "setvar"]));
    expect(result.runtimeTrace?.macro?.mutationPreview).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "set", scope: "branch", key: "资产", value: '{"金币":3,"银币":"5"}' }),
    ]));
    expect(result.runtimeTrace?.macro?.traces).toEqual(expect.arrayContaining([
      expect.objectContaining({ macroName: "getvar", resolvedText: "3" }),
      expect.objectContaining({ macroName: "getvar", resolvedText: "5" }),
    ]));
  });

  it("surfaces shorthand path writes, global shorthand writes, and canonical alias names in real dry-run assembly", async () => {
    const now = Date.now();
    const presetId = nanoid();

    await database.db.insert(presets).values({
      id: presetId,
      name: "Dry Run Shorthand Macro Preset",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      source: "sillytavern",
      dataJson: JSON.stringify({
        ...SAMPLE_PRESET_DATA,
        prompts: [
          {
            identifier: "main",
            name: "Main Prompt",
            role: "system",
            content: "local={{.资产.金币=3}}{{getvar::资产.金币}} global={{$账户.余额=5}}{{getglobalvar::账户.余额}} exists={{varexists::资产.金币}}",
          },
          { identifier: "chatHistory", name: "Chat History", marker: true },
        ],
      }),
      createdAt: now,
      updatedAt: now,
    });

    await database.db
      .update(sessions)
      .set({
        presetId,
        characterSnapshotJson: JSON.stringify({ name: "Knight" }),
        updatedAt: now,
      })
      .where(eq(sessions.id, sessionId));

    const result = await chatService.dryRun(sessionId, { message: "hello shorthand macros" });
    const allContent = result.messages.map((message) => message.content).join("\n");

    expect(allContent).toContain("local=3 global=5 exists=true");
    expect(result.runtimeTrace?.macro?.usedNames).toEqual(expect.arrayContaining([
      "setvar",
      "getvar",
      "setglobalvar",
      "getglobalvar",
      "hasvar",
    ]));
    expect(result.runtimeTrace?.macro?.mutationPreview).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "set", scope: "branch", key: "资产", value: '{"金币":"3"}' }),
      expect.objectContaining({ kind: "set", scope: "global", key: "账户", value: '{"余额":"5"}' }),
    ]));
    expect(result.runtimeTrace?.macro?.traces).toEqual(expect.arrayContaining([
      expect.objectContaining({ macroName: "setvar", rawText: "{{.资产.金币=3}}", resolvedText: "" }),
      expect.objectContaining({ macroName: "setglobalvar", rawText: "{{$账户.余额=5}}", resolvedText: "" }),
      expect.objectContaining({ macroName: "hasvar", rawText: "{{varexists::资产.金币}}", resolvedText: "true" }),
    ]));
  });

  it("prefers exact dotted keys, supports quoted-key path reads, and stringifies objects in real dry-run assembly", async () => {
    const now = Date.now();
    const presetId = nanoid();

    await database.db.insert(presets).values({
      id: presetId,
      name: "Dry Run Exact Dotted Key Preset",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      source: "sillytavern",
      dataJson: JSON.stringify({
        ...SAMPLE_PRESET_DATA,
        prompts: [
          {
            identifier: "main",
            name: "Main Prompt",
            role: "system",
            content: "flat={{getvar::资产.金币}} nested={{getvar::资产}} quoted={{getvar::装备[\"剑.名\"]}} has={{hasglobalvar::账户.余额}}/{{hasglobalvar::账户.透支}}",
          },
          { identifier: "chatHistory", name: "Chat History", marker: true },
        ],
      }),
      createdAt: now,
      updatedAt: now,
    });

    await database.db
      .update(sessions)
      .set({
        presetId,
        characterSnapshotJson: JSON.stringify({ name: "Knight" }),
        updatedAt: now,
      })
      .where(eq(sessions.id, sessionId));

    await database.db.insert(variables).values([
      {
        id: nanoid(),
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scope: "branch",
        scopeId: buildBranchVariableScopeId(sessionId, "main"),
        key: "资产.金币",
        valueJson: JSON.stringify("flat"),
        updatedAt: now + 1,
      },
      {
        id: nanoid(),
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scope: "branch",
        scopeId: buildBranchVariableScopeId(sessionId, "main"),
        key: "资产",
        valueJson: JSON.stringify({ 金币: "nested" }),
        updatedAt: now + 2,
      },
      {
        id: nanoid(),
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scope: "branch",
        scopeId: buildBranchVariableScopeId(sessionId, "main"),
        key: "装备",
        valueJson: JSON.stringify({ "剑.名": "霜刃" }),
        updatedAt: now + 3,
      },
      {
        id: nanoid(),
        accountId: DEFAULT_ADMIN_ACCOUNT_ID,
        scope: "global",
        scopeId: "global",
        key: "账户",
        valueJson: JSON.stringify({ 余额: 8 }),
        updatedAt: now + 4,
      },
    ]);

    const result = await chatService.dryRun(sessionId, { message: "hello exact dotted key macros" });
    const allContent = result.messages.map((message) => message.content).join("\n");

    expect(allContent).toContain('flat=flat nested={"金币":"nested"} quoted=霜刃 has=true/false');
    expect(result.runtimeTrace?.macro?.usedNames).toEqual(expect.arrayContaining(["getvar", "hasglobalvar"]));
    expect(result.runtimeTrace?.macro?.warnings?.some((warning) => warning.code === "macro_parse_failed")).toBe(false);
    expect(result.runtimeTrace?.macro?.warnings?.some((warning) => warning.code === "macro_arg_type_invalid")).toBe(false);
  });

  it("keeps invalid and type-invalid structured path reads raw in real dry-run assembly", async () => {
    const now = Date.now();
    const presetId = nanoid();

    await database.db.insert(presets).values({
      id: presetId,
      name: "Dry Run Invalid Path Preset",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      source: "sillytavern",
      dataJson: JSON.stringify({
        ...SAMPLE_PRESET_DATA,
        prompts: [
          {
            identifier: "main",
            name: "Main Prompt",
            role: "system",
            content: "bad={{getvar::资产..金币}} type={{getvar::资产.金币}}",
          },
          { identifier: "chatHistory", name: "Chat History", marker: true },
        ],
      }),
      createdAt: now,
      updatedAt: now,
    });

    await database.db
      .update(sessions)
      .set({
        presetId,
        characterSnapshotJson: JSON.stringify({ name: "Knight" }),
        updatedAt: now,
      })
      .where(eq(sessions.id, sessionId));

    await database.db.insert(variables).values({
      id: nanoid(),
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      scope: "branch",
      scopeId: buildBranchVariableScopeId(sessionId, "main"),
      key: "资产",
      valueJson: JSON.stringify("很多"),
      updatedAt: now + 1,
    });

    const result = await chatService.dryRun(sessionId, { message: "hello invalid path macros" });
    const allContent = result.messages.map((message) => message.content).join("\n");

    expect(allContent).toContain("bad={{getvar::资产..金币}} type={{getvar::资产.金币}}");
    expect(result.runtimeTrace?.macro?.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "macro_parse_failed", macroName: "getvar" }),
      expect.objectContaining({ code: "macro_arg_type_invalid", macroName: "getvar" }),
    ]));
  });

  it("does not load prompt resources owned by another account", async () => {
    const now = Date.now();
    const otherAccountId = "acc-other";
    const presetId = nanoid();
    const worldbookId = nanoid();
    const regexProfileId = nanoid();

    await database.db.insert(accounts).values({
      id: otherAccountId,
      name: "Other Account",
      role: "user",
      status: "active",
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(presets).values({
      id: presetId,
      name: "Foreign Preset",
      source: "sillytavern",
      accountId: otherAccountId,
      dataJson: JSON.stringify(SAMPLE_PRESET_DATA),
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(worldbooks).values({
      id: worldbookId,
      name: "Foreign Worldbook",
      source: "sillytavern",
      accountId: otherAccountId,
      dataJson: JSON.stringify({}),
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(worldbookEntries).values({
      id: nanoid(),
      worldbookId,
      uid: 9,
      comment: "Foreign entry",
      content: "Hidden foreign lore.",
      keysJson: JSON.stringify(["foreign"]),
      keysSecondaryJson: JSON.stringify([]),
      selective: false,
      selectiveLogic: 0,
      constant: true,
      position: 0,
      order: 100,
      depth: 4,
      role: 0,
      disable: false,
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(regexProfiles).values({
      id: regexProfileId,
      name: "Foreign Regex",
      source: "sillytavern",
      accountId: otherAccountId,
      dataJson: JSON.stringify(SAMPLE_REGEX_DATA),
      createdAt: now,
      updatedAt: now,
    });

    await database.db
      .update(sessions)
      .set({
        presetId,
        worldbookProfileId: worldbookId,
        regexProfileId,
        updatedAt: now,
      })
      .where(eq(sessions.id, sessionId));

    const result = await chatService.dryRun(sessionId, { message: "hello foreign" });

    expect(result.messages[0]).toEqual({ role: "system", content: "You are a helpful assistant." });
    expect(result.promptSnapshot).toMatchObject({
      presetId: null,
      worldbookId: null,
      regexProfileId: null,
      worldbookActivatedEntryUids: [],
      regexPreRuleNames: [],
      regexPostRuleNames: [],
    });
  });

  it("returns worldbook match details when requested and keeps contentPreview aligned with WORLD_INFO regex output", async () => {
    const now = Date.now();
    const presetId = nanoid();
    const worldbookId = nanoid();
    const regexProfileId = nanoid();
    const worldInfoRegexData = [
      {
        id: "regex-world-info-1",
        scriptName: "World Info Rule",
        findRegex: "/sword/g",
        replaceString: "blade",
        trimStrings: [],
        placement: [5],
        disabled: false,
        substituteRegex: 0,
        minDepth: 0,
        maxDepth: 0,
      },
    ];

    await database.db.insert(presets).values({
      id: presetId,
      name: "Dry Run Worldbook Match Preset",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      source: "sillytavern",
      dataJson: JSON.stringify(SAMPLE_PRESET_DATA),
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(worldbooks).values({
      id: worldbookId,
      name: "Dry Run Worldbook",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      source: "sillytavern",
      dataJson: JSON.stringify({ scanDepth: 3 }),
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(worldbookEntries).values({
      id: nanoid(),
      worldbookId,
      uid: 7,
      comment: "Sword",
      content: "A blessed sword rests in the shrine.",
      keysJson: JSON.stringify(["sword"]),
      keysSecondaryJson: JSON.stringify([]),
      selective: false,
      selectiveLogic: 0,
      constant: false,
      position: 0,
      order: 100,
      depth: 4,
      role: 0,
      disable: false,
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(regexProfiles).values({
      id: regexProfileId,
      name: "Dry Run World Info Regex",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      source: "sillytavern",
      dataJson: JSON.stringify(worldInfoRegexData),
      createdAt: now,
      updatedAt: now,
    });

    await database.db
      .update(sessions)
      .set({
        presetId,
        worldbookProfileId: worldbookId,
        regexProfileId,
        characterSnapshotJson: JSON.stringify({ name: "Knight" }),
        updatedAt: now,
      })
      .where(eq(sessions.id, sessionId));

    const result = await chatService.dryRun(sessionId, {
      message: "hello sword",
      debugOptions: { includeWorldbookMatches: true },
    });

    expect(result.assembly.worldbookMatches).toEqual([
      {
        uid: 7,
        comment: "Sword",
        contentPreview: "A blessed sword rests in the shrine.",
        order: 100,
        activationKey: `worldbook:${worldbookId}:1:entry:7`,
        assetScopeId: `worldbook:${worldbookId}:1`,
        source: {
          kind: "session_worldbook",
          worldbookId,
          worldbookName: "Dry Run Worldbook",
          assetScopeId: `worldbook:${worldbookId}:1`,
        },
        insertion: {
          position: "before",
        },
        activation: {
          mode: "triggered",
          recursionLevel: 0,
          firstMatch: {
            sourceKind: "message",
            messageIndexFromLatest: 0,
            matchedKey: "sword",
            matchedKeyScope: "primary",
            matchedKeyType: "plain",
            charStart: 15,
            charEnd: 20,
            excerpt: "history\n\nhello sword",
          },
        },
      },
    ]);
    expect(result.assembly.worldbookHits).toBe(1);
    expect(result.promptSnapshot.worldbookActivatedEntryUids).toEqual([7]);
  });
});

