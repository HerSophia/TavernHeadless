import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../accounts/constants.js";
import { characters, floorResultSnapshots, floors, messagePages, messages, presets, promptRuntimeExplainSnapshots, promptSnapshots, regexProfiles, sessions, worldbooks } from "../../db/schema.js";
import {
  DEFAULT_RESOLVED_PROMPT_RUNTIME_DEBUG_POLICY,
  DEFAULT_RESOLVED_PROMPT_RUNTIME_BUDGET_POLICY,
  DEFAULT_RESOLVED_PROMPT_RUNTIME_DELIVERY_POLICY,
  DEFAULT_RESOLVED_PROMPT_RUNTIME_SOURCE_SELECTION_POLICY,
  DEFAULT_RESOLVED_PROMPT_RUNTIME_STRUCTURE_POLICY,
  DERIVED_NO_ASSISTANT_STRUCTURE_WARNING,
  INVALID_PROMPT_RUNTIME_BRANCH_POLICY_WARNING,
  INVALID_PROMPT_RUNTIME_POLICY_WARNING,
  PROMPT_RUNTIME_LIMITATIONS,
  PromptRuntimeControlService,
  PROMPT_RUNTIME_HISTORICAL_EXPLAIN_LIMITATIONS,
  PROMPT_RUNTIME_HISTORICAL_EXPLAIN_COMMON_LIMITATIONS,
  PromptRuntimeControlServiceError,
} from "../prompt-runtime-control-service.js";

const DEFAULT_EXPECTED_SOURCE_SELECTION_SOURCE_MAP = {
  history: { mode: "system_default" },
  memory: { enabled: "system_default" },
  worldbook: { enabled: "system_default" },
  examples: { enabled: "system_default" },
} as const;

const DEFAULT_EXPECTED_RESOLVED_SOURCE_SELECTION = {
  ...DEFAULT_RESOLVED_PROMPT_RUNTIME_SOURCE_SELECTION_POLICY,
} as const;

const DEFAULT_EXPECTED_RESOLVED_VISIBILITY = {
  mode: "allow_all_except_hidden",
} as const;

const DEFAULT_EXPECTED_VISIBILITY_SOURCE_MAP = {
  mode: "system_default",
} as const;

describe("PromptRuntimeControlService", () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = createDatabase(":memory:");
  });

  afterEach(() => {
    database.close();
  });

  async function insertSession(input: {
    metadata?: unknown;
    characterId?: string | null;
    characterSnapshot?: unknown;
    presetId?: string | null;
    worldbookId?: string | null;
    regexProfileId?: string | null;
  } = {}) {
    const now = Date.now();
    const sessionId = nanoid();

    await database.db.insert(sessions).values({
      id: sessionId,
      title: "Prompt Runtime Session",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      status: "active",
      characterId: input.characterId ?? null,
      characterSnapshotJson: input.characterSnapshot === undefined ? null : JSON.stringify(input.characterSnapshot),
      presetId: input.presetId ?? null,
      worldbookProfileId: input.worldbookId ?? null,
      regexProfileId: input.regexProfileId ?? null,
      metadataJson: input.metadata === undefined ? null : JSON.stringify(input.metadata),
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(floors).values({
      id: nanoid(),
      sessionId,
      floorNo: 0,
      branchId: "main",
      parentFloorId: null,
      state: "committed",
      metadataJson: null,
      tokenIn: 0,
      tokenOut: 0,
      createdAt: now,
      updatedAt: now,
    });

    return sessionId;
  }

  it("returns resolved state with persistent policy and prompt assets", async () => {
    const now = Date.now();
    const characterId = nanoid();
    const presetId = nanoid();
    const worldbookId = nanoid();
    const regexProfileId = nanoid();

    await database.db.insert(characters).values({
      id: characterId,
      name: "Hero",
      source: "sillytavern",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      status: "active",
      deletedAt: null,
      revision: 0,
      latestVersionNo: 0,
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(presets).values({
      id: presetId,
      name: "Story Preset",
      source: "sillytavern",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      dataJson: JSON.stringify({ prompts: [], prompt_order: [] }),
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(worldbooks).values({
      id: worldbookId,
      name: "Lorebook",
      source: "sillytavern",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      dataJson: JSON.stringify({ entries: [] }),
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(regexProfiles).values({
      id: regexProfileId,
      name: "Safety Regex",
      source: "sillytavern",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      dataJson: JSON.stringify([]),
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    const sessionId = await insertSession({
      characterId,
      characterSnapshot: { name: "Hero Snapshot" },
      presetId,
      worldbookId,
      regexProfileId,
      metadata: {
        prompt_runtime: {
          policy: {
            structure: {
              mode: "strict_alternating",
            },
            delivery: {
              requireLastUser: true,
            },
          },
        },
      },
    });

    const service = new PromptRuntimeControlService(database.db, {
      enableLiveEndpoints: true,
      enableDryRunEndpoint: true,
      enableStreamEndpoint: true,
    });

    const state = await service.getResolvedState(sessionId, DEFAULT_ADMIN_ACCOUNT_ID);

    expect(state).toEqual({
      scope: {
        sessionId,
        targetBranchId: "main",
        branchExists: true,
        sourceFloorId: null,
        historySourceBranchId: "main",
        historySourceMode: "existing_branch",
      },
      policy: {
        structure: {
          mode: "strict_alternating",
          mergeAdjacentSameRole: true,
          preserveSystemMessages: true,
        },
        delivery: {
          allowAssistantPrefill: true,
          requireLastUser: true,
          noAssistant: false,
        },
        budget: { ...DEFAULT_RESOLVED_PROMPT_RUNTIME_BUDGET_POLICY },
        sourceSelection: DEFAULT_EXPECTED_RESOLVED_SOURCE_SELECTION,
        visibility: DEFAULT_EXPECTED_RESOLVED_VISIBILITY,
        debug: {
          includePromptSnapshot: false,
          includeRuntimeTrace: false,
          includeWorldbookMatches: false,
        },
      },
      persistentPolicy: {
        structure: {
          mode: "strict_alternating",
        },
        delivery: {
          requireLastUser: true,
        },
      },
      branchPersistentPolicy: null,
      assets: {
        preset: {
          id: presetId,
          name: "Story Preset",
        },
        characterCard: {
          id: characterId,
          name: "Hero",
        },
        worldbook: {
          id: worldbookId,
          name: "Lorebook",
        },
        regexProfile: {
          id: regexProfileId,
          name: "Safety Regex",
        },
      },
      sourceMap: {
        structure: {
          mode: "session_policy",
          mergeAdjacentSameRole: "session_policy",
          preserveSystemMessages: "system_default",
        },
        delivery: {
          allowAssistantPrefill: "system_default",
          requireLastUser: "session_policy",
          noAssistant: "system_default",
        },
        sourceSelection: DEFAULT_EXPECTED_SOURCE_SELECTION_SOURCE_MAP,
        visibility: DEFAULT_EXPECTED_VISIBILITY_SOURCE_MAP,
        history: {
          sourceBranchId: "main",
          sourceMode: "existing_branch",
        },
      },
      warnings: [],
      diagnostics: [],
      limitations: [...PROMPT_RUNTIME_LIMITATIONS],
    });
  });

  it("surfaces source map entries for explicit structure and delivery session policy fields", async () => {
    const sessionId = await insertSession({
      metadata: {
        prompt_runtime: {
          policy: {
            structure: {
              mode: "no_assistant",
              mergeAdjacentSameRole: true,
              preserveSystemMessages: false,
              assistantRewriteStrategy: "to_user_transcript",
            },
            delivery: {
              allowAssistantPrefill: false,
              requireLastUser: true,
              noAssistant: true,
            },
          },
        },
      },
    });

    const service = new PromptRuntimeControlService(database.db);
    const state = await service.getResolvedState(sessionId, DEFAULT_ADMIN_ACCOUNT_ID);

    expect(state.sourceMap).toEqual({
      structure: {
        mode: "session_policy",
        mergeAdjacentSameRole: "session_policy",
        preserveSystemMessages: "session_policy",
        assistantRewriteStrategy: "session_policy",
      },
      delivery: {
        allowAssistantPrefill: "session_policy",
        requireLastUser: "session_policy",
        noAssistant: "session_policy",
      },
      sourceSelection: DEFAULT_EXPECTED_SOURCE_SELECTION_SOURCE_MAP,
      visibility: DEFAULT_EXPECTED_VISIBILITY_SOURCE_MAP,
      history: {
        sourceBranchId: "main",
        sourceMode: "existing_branch",
      },
    });
    expect(state.warnings).toEqual([]);
    expect(state.branchPersistentPolicy).toBeNull();
    expect(state.diagnostics).toEqual([]);
    expect(state.limitations).toEqual([...PROMPT_RUNTIME_LIMITATIONS]);
  });

  it("surfaces resolved visibility and source map entries for explicit session visibility policy fields", async () => {
    const sessionId = await insertSession({
      metadata: {
        prompt_runtime: {
          policy: {
            visibility: {
              mode: "deny_all_except_visible",
              visibleFloorRanges: [{ startFloorNo: 3, endFloorNo: 4 }],
            },
          },
        },
      },
    });

    const service = new PromptRuntimeControlService(database.db);
    const state = await service.getResolvedState(sessionId, DEFAULT_ADMIN_ACCOUNT_ID);

    expect(state.policy.visibility).toEqual({
      mode: "deny_all_except_visible",
      visibleFloorRanges: [{ startFloorNo: 3, endFloorNo: 4 }],
    });
    expect(state.sourceMap).toEqual({
      structure: {
        mode: "system_default",
        mergeAdjacentSameRole: "system_default",
        preserveSystemMessages: "system_default",
      },
      delivery: {
        allowAssistantPrefill: "system_default",
        requireLastUser: "system_default",
        noAssistant: "system_default",
      },
      sourceSelection: DEFAULT_EXPECTED_SOURCE_SELECTION_SOURCE_MAP,
      visibility: {
        mode: "session_policy",
        visibleFloorRanges: "session_policy",
      },
      history: {
        sourceBranchId: "main",
        sourceMode: "existing_branch",
      },
    });
  });

  it("surfaces source map entries when delivery.noAssistant derives the resolved structure mode", async () => {
    const sessionId = await insertSession({
      metadata: {
        prompt_runtime: {
          policy: {
            delivery: {
              noAssistant: true,
            },
          },
        },
      },
    });

    const service = new PromptRuntimeControlService(database.db);
    const state = await service.getResolvedState(sessionId, DEFAULT_ADMIN_ACCOUNT_ID);

    expect(state.sourceMap).toEqual({
      structure: {
        mode: "session_policy",
        mergeAdjacentSameRole: "session_policy",
        preserveSystemMessages: "system_default",
        assistantRewriteStrategy: "system_default",
      },
      delivery: {
        allowAssistantPrefill: "system_default",
        requireLastUser: "system_default",
        noAssistant: "session_policy",
      },
      sourceSelection: DEFAULT_EXPECTED_SOURCE_SELECTION_SOURCE_MAP,
      visibility: DEFAULT_EXPECTED_VISIBILITY_SOURCE_MAP,
      history: {
        sourceBranchId: "main",
        sourceMode: "existing_branch",
      },
    });
    expect(state.warnings).toEqual([DERIVED_NO_ASSISTANT_STRUCTURE_WARNING]);
    expect(state.diagnostics).toEqual([
      expect.objectContaining({
        code: "derived_no_assistant_structure",
        fieldPath: "policy.structure.mode",
      }),
    ]);
    expect(state.limitations).toEqual([...PROMPT_RUNTIME_LIMITATIONS]);
  });

  it("resolves delivery.noAssistant into a no_assistant structure default", async () => {
    const sessionId = await insertSession({
      metadata: {
        prompt_runtime: {
          policy: {
            delivery: {
              noAssistant: true,
            },
          },
        },
      },
    });

    const service = new PromptRuntimeControlService(database.db);
    const policy = await service.getPolicy(sessionId, DEFAULT_ADMIN_ACCOUNT_ID);

    expect(policy).toEqual({
      persistentPolicy: {
        delivery: {
          noAssistant: true,
        },
      },
      resolvedPolicy: {
        structure: {
          mode: "no_assistant",
          mergeAdjacentSameRole: false,
          preserveSystemMessages: true,
          assistantRewriteStrategy: "to_system",
        },
        delivery: {
          allowAssistantPrefill: true,
          requireLastUser: false,
          noAssistant: true,
        },
        budget: { ...DEFAULT_RESOLVED_PROMPT_RUNTIME_BUDGET_POLICY },
        sourceSelection: DEFAULT_EXPECTED_RESOLVED_SOURCE_SELECTION,
        visibility: DEFAULT_EXPECTED_RESOLVED_VISIBILITY,
        debug: {
          includePromptSnapshot: false,
          includeRuntimeTrace: false,
          includeWorldbookMatches: false,
        },
      },
      warnings: [DERIVED_NO_ASSISTANT_STRUCTURE_WARNING],
    });
  });

  it("keeps flattened structure mode when delivery.noAssistant is enabled", async () => {
    const sessionId = await insertSession({
      metadata: {
        prompt_runtime: {
          policy: {
            structure: {
              mode: "flattened",
            },
            delivery: {
              noAssistant: true,
            },
          },
        },
      },
    });

    const service = new PromptRuntimeControlService(database.db);
    const policy = await service.getPolicy(sessionId, DEFAULT_ADMIN_ACCOUNT_ID);

    expect(policy).toEqual({
      persistentPolicy: {
        structure: {
          mode: "flattened",
        },
        delivery: {
          noAssistant: true,
        },
      },
      resolvedPolicy: {
        structure: {
          mode: "flattened",
          mergeAdjacentSameRole: false,
          preserveSystemMessages: true,
        },
        delivery: {
          allowAssistantPrefill: true,
          requireLastUser: false,
          noAssistant: true,
        },
        budget: { ...DEFAULT_RESOLVED_PROMPT_RUNTIME_BUDGET_POLICY },
        sourceSelection: DEFAULT_EXPECTED_RESOLVED_SOURCE_SELECTION,
        visibility: DEFAULT_EXPECTED_RESOLVED_VISIBILITY,
        debug: { ...DEFAULT_RESOLVED_PROMPT_RUNTIME_DEBUG_POLICY },
      },
      warnings: [],
    });
  });

  it("updates prompt runtime policy in session metadata and reads it back", async () => {
    const sessionId = await insertSession({
      metadata: {
        source: "test",
        prompt_runtime: {
          policy: {
            delivery: {
              requireLastUser: true,
            },
          },
        },
      },
    });

    const service = new PromptRuntimeControlService(database.db);
    const updated = await service.updatePolicy(sessionId, DEFAULT_ADMIN_ACCOUNT_ID, {
      structure: {
        mode: "strict_alternating",
        preserveSystemMessages: true,
      },
      delivery: {
        noAssistant: true,
      },
      visibility: {
        mode: "allow_all_except_hidden",
        hiddenFloorRanges: [{ startFloorNo: 1, endFloorNo: 2 }],
      },
    });

    expect(updated).toEqual({
      persistentPolicy: {
        structure: {
          mode: "strict_alternating",
          preserveSystemMessages: true,
        },
        delivery: {
          requireLastUser: true,
          noAssistant: true,
        },
        visibility: {
          mode: "allow_all_except_hidden",
          hiddenFloorRanges: [{ startFloorNo: 1, endFloorNo: 2 }],
        },
      },
      resolvedPolicy: {
        structure: {
          mode: "no_assistant",
          mergeAdjacentSameRole: true,
          preserveSystemMessages: true,
          assistantRewriteStrategy: "to_system",
        },
        delivery: {
          allowAssistantPrefill: true,
          requireLastUser: true,
          noAssistant: true,
        },
        budget: { ...DEFAULT_RESOLVED_PROMPT_RUNTIME_BUDGET_POLICY },
        sourceSelection: DEFAULT_EXPECTED_RESOLVED_SOURCE_SELECTION,
        visibility: {
          mode: "allow_all_except_hidden",
          hiddenFloorRanges: [{ startFloorNo: 1, endFloorNo: 2 }],
        },
        debug: DEFAULT_RESOLVED_PROMPT_RUNTIME_DEBUG_POLICY,
      },
      persistentPolicyEnvelope: expect.objectContaining({
        version: 1,
        value: {
          structure: {
            mode: "strict_alternating",
            preserveSystemMessages: true,
          },
          delivery: {
            requireLastUser: true,
            noAssistant: true,
          },
          visibility: {
            mode: "allow_all_except_hidden",
            hiddenFloorRanges: [{ startFloorNo: 1, endFloorNo: 2 }],
          },
        },
      }),
      warnings: [DERIVED_NO_ASSISTANT_STRUCTURE_WARNING],
    });

    const persisted = await service.getPolicy(sessionId, DEFAULT_ADMIN_ACCOUNT_ID);
    expect(persisted).toEqual(updated);

    const [sessionRow] = await database.db
      .select({ metadataJson: sessions.metadataJson })
      .from(sessions)
      .where(eq(sessions.id, sessionId));

    expect(JSON.parse(sessionRow!.metadataJson!)).toEqual({
      source: "test",
      prompt_runtime: {
        policy: {
          version: 1,
          updatedAt: expect.any(Number),
          value: {
            structure: {
              mode: "strict_alternating",
              preserveSystemMessages: true,
            },
            delivery: {
              requireLastUser: true,
              noAssistant: true,
            },
            visibility: {
              mode: "allow_all_except_hidden",
              hiddenFloorRanges: [{ startFloorNo: 1, endFloorNo: 2 }],
            },
          },
        },
      },
    });
  });

  it("clears prompt runtime policy when both sections are explicitly nulled", async () => {
    const sessionId = await insertSession({
      metadata: {
        source: "test",
        prompt_runtime: {
          policy: {
            structure: {
              mode: "no_assistant",
              preserveSystemMessages: true,
            },
            delivery: {
              requireLastUser: true,
              noAssistant: true,
            },
          },
        },
      },
    });

    const service = new PromptRuntimeControlService(database.db);
    const updated = await service.updatePolicy(sessionId, DEFAULT_ADMIN_ACCOUNT_ID, {
      structure: null,
      delivery: null,
    });

    expect(updated).toEqual({
      resolvedPolicy: {
        structure: DEFAULT_RESOLVED_PROMPT_RUNTIME_STRUCTURE_POLICY,
        delivery: DEFAULT_RESOLVED_PROMPT_RUNTIME_DELIVERY_POLICY,
        budget: { ...DEFAULT_RESOLVED_PROMPT_RUNTIME_BUDGET_POLICY },
        sourceSelection: DEFAULT_EXPECTED_RESOLVED_SOURCE_SELECTION,
        visibility: DEFAULT_EXPECTED_RESOLVED_VISIBILITY,
        debug: DEFAULT_RESOLVED_PROMPT_RUNTIME_DEBUG_POLICY,
      },
      warnings: [],
    });

    const persisted = await service.getPolicy(sessionId, DEFAULT_ADMIN_ACCOUNT_ID);
    expect(persisted).toEqual(updated);

    const [sessionRow] = await database.db
      .select({ metadataJson: sessions.metadataJson })
      .from(sessions)
      .where(eq(sessions.id, sessionId));

    expect(JSON.parse(sessionRow!.metadataJson!)).toEqual({
      source: "test",
    });
  });

  it("merges partial policy patches without dropping existing sibling fields", async () => {
    const sessionId = await insertSession({
      metadata: {
        prompt_runtime: {
          policy: {
            structure: {
              mode: "no_assistant",
              preserveSystemMessages: true,
            },
            delivery: {
              requireLastUser: true,
            },
          },
        },
      },
    });

    const service = new PromptRuntimeControlService(database.db);
    const updated = await service.updatePolicy(sessionId, DEFAULT_ADMIN_ACCOUNT_ID, {
      structure: {
        mode: "no_assistant",
        assistantRewriteStrategy: "to_user_transcript",
      },
      delivery: {
        allowAssistantPrefill: false,
      },
    });

    expect(updated).toEqual({
      persistentPolicy: {
        structure: {
          mode: "no_assistant",
          preserveSystemMessages: true,
          assistantRewriteStrategy: "to_user_transcript",
        },
        delivery: {
          allowAssistantPrefill: false,
          requireLastUser: true,
        },
      },
      resolvedPolicy: {
        structure: {
          mode: "no_assistant",
          mergeAdjacentSameRole: false,
          preserveSystemMessages: true,
          assistantRewriteStrategy: "to_user_transcript",
        },
        delivery: {
          allowAssistantPrefill: false,
          requireLastUser: true,
          noAssistant: false,
        },
        budget: { ...DEFAULT_RESOLVED_PROMPT_RUNTIME_BUDGET_POLICY },
        sourceSelection: DEFAULT_EXPECTED_RESOLVED_SOURCE_SELECTION,
        visibility: DEFAULT_EXPECTED_RESOLVED_VISIBILITY,
        debug: DEFAULT_RESOLVED_PROMPT_RUNTIME_DEBUG_POLICY,
      },
      persistentPolicyEnvelope: expect.objectContaining({
        version: 1,
        value: {
          structure: {
            mode: "no_assistant",
            preserveSystemMessages: true,
            assistantRewriteStrategy: "to_user_transcript",
          },
          delivery: {
            allowAssistantPrefill: false,
            requireLastUser: true,
          },
        },
      }),

      warnings: [],
    });

    const [sessionRow] = await database.db
      .select({ metadataJson: sessions.metadataJson })
      .from(sessions)
      .where(eq(sessions.id, sessionId));

    expect(JSON.parse(sessionRow!.metadataJson!)).toEqual({
      prompt_runtime: {
        policy: {
          version: 1,
          updatedAt: expect.any(Number),
          value: {
            structure: {
              mode: "no_assistant",
              preserveSystemMessages: true,
              assistantRewriteStrategy: "to_user_transcript",
            },
            delivery: {
              allowAssistantPrefill: false,
              requireLastUser: true,
            },
          },
        },
      },
    });
  });

  it("ignores invalid prompt runtime policy metadata and returns defaults with a warning", async () => {
    const sessionId = await insertSession({
      metadata: {
        prompt_runtime: {
          policy: {
            structure: {
              mode: "invalid_mode",
            },
          },
        },
      },
    });

    const service = new PromptRuntimeControlService(database.db);
    const state = await service.getResolvedState(sessionId, DEFAULT_ADMIN_ACCOUNT_ID);

    expect(state.persistentPolicy).toBeUndefined();
    expect(state.branchPersistentPolicy).toBeNull();
    expect(state.policy).toEqual({
      structure: DEFAULT_RESOLVED_PROMPT_RUNTIME_STRUCTURE_POLICY,
      delivery: DEFAULT_RESOLVED_PROMPT_RUNTIME_DELIVERY_POLICY,
      budget: { ...DEFAULT_RESOLVED_PROMPT_RUNTIME_BUDGET_POLICY },
      sourceSelection: DEFAULT_EXPECTED_RESOLVED_SOURCE_SELECTION,
      visibility: DEFAULT_EXPECTED_RESOLVED_VISIBILITY,
      debug: DEFAULT_RESOLVED_PROMPT_RUNTIME_DEBUG_POLICY,
    });
    expect(state.warnings).toEqual([INVALID_PROMPT_RUNTIME_POLICY_WARNING]);
    expect(state.diagnostics).toEqual([
      expect.objectContaining({
        code: "invalid_prompt_runtime_policy",
        fieldPath: "prompt_runtime.policy",
      }),
    ]);
    expect(state.limitations).toEqual([...PROMPT_RUNTIME_LIMITATIONS]);
  });

  it("applies branch prompt runtime policy overlay in resolved state for a materialized branch", async () => {
    const now = Date.now();
    const sessionId = await insertSession({
      metadata: {
        prompt_runtime: {
          policy: {
            delivery: {
              requireLastUser: true,
            },
          },
          branchPolicies: {
            "alt-branch": {
              delivery: {
                noAssistant: true,
              },
            },
          },
        },
      },
    });

    await database.db.insert(floors).values({
      id: nanoid(),
      sessionId,
      floorNo: 1,
      branchId: "alt-branch",
      parentFloorId: null,
      state: "committed",
      metadataJson: null,
      tokenIn: 0,
      tokenOut: 0,
      createdAt: now,
      updatedAt: now,
    });

    const service = new PromptRuntimeControlService(database.db);
    const state = await service.getResolvedState(sessionId, DEFAULT_ADMIN_ACCOUNT_ID, "alt-branch");

    expect(state.scope).toEqual({
      sessionId,
      targetBranchId: "alt-branch",
      branchExists: true,
      sourceFloorId: null,
      historySourceBranchId: "alt-branch",
      historySourceMode: "existing_branch",
    });
    expect(state.branchPersistentPolicy).toEqual({
      delivery: {
        noAssistant: true,
      },
    });
    expect(state.policy).toEqual({
      structure: {
        mode: "no_assistant",
        mergeAdjacentSameRole: false,
        preserveSystemMessages: true,
        assistantRewriteStrategy: "to_system",
      },
      delivery: {
        allowAssistantPrefill: true,
        requireLastUser: true,
        noAssistant: true,
      },
      budget: { ...DEFAULT_RESOLVED_PROMPT_RUNTIME_BUDGET_POLICY },
      sourceSelection: DEFAULT_EXPECTED_RESOLVED_SOURCE_SELECTION,
      visibility: DEFAULT_EXPECTED_RESOLVED_VISIBILITY,
      debug: DEFAULT_RESOLVED_PROMPT_RUNTIME_DEBUG_POLICY,
    });
    expect(state.sourceMap).toEqual({
      structure: {
        mode: "branch_policy",
        mergeAdjacentSameRole: "branch_policy",
        preserveSystemMessages: "system_default",
        assistantRewriteStrategy: "system_default",
      },
      delivery: {
        allowAssistantPrefill: "system_default",
        requireLastUser: "session_policy",
        noAssistant: "branch_policy",
      },
      sourceSelection: DEFAULT_EXPECTED_SOURCE_SELECTION_SOURCE_MAP,
      visibility: DEFAULT_EXPECTED_VISIBILITY_SOURCE_MAP,
      history: {
        sourceBranchId: "alt-branch",
        sourceMode: "existing_branch",
      },
    });
    expect(state.warnings).toEqual([DERIVED_NO_ASSISTANT_STRUCTURE_WARNING]);
  });

  it("updates branch prompt runtime policy in session metadata and reads it back", async () => {
    const now = Date.now();
    const sessionId = await insertSession();
    await database.db.insert(floors).values({
      id: nanoid(),
      sessionId,
      floorNo: 1,
      branchId: "alt-branch",
      parentFloorId: null,
      state: "committed",
      metadataJson: null,
      tokenIn: 0,
      tokenOut: 0,
      createdAt: now,
      updatedAt: now,
    });

    const service = new PromptRuntimeControlService(database.db);
    const updated = await service.updateBranchPolicy(sessionId, "alt-branch", DEFAULT_ADMIN_ACCOUNT_ID, {
      structure: { mode: "strict_alternating" },
      delivery: { requireLastUser: true },
      visibility: {
        mode: "deny_all_except_visible",
        visibleFloorRanges: [{ startFloorNo: 3, endFloorNo: 4 }],
      },
    });

    expect(updated).toEqual({
      persistentPolicy: {
        structure: { mode: "strict_alternating" },
        delivery: { requireLastUser: true },
        visibility: {
          mode: "deny_all_except_visible",
          visibleFloorRanges: [{ startFloorNo: 3, endFloorNo: 4 }],
        },
      },
      resolvedPolicy: {
        structure: { mode: "strict_alternating", mergeAdjacentSameRole: true, preserveSystemMessages: true },
        delivery: { allowAssistantPrefill: true, requireLastUser: true, noAssistant: false },
        budget: { ...DEFAULT_RESOLVED_PROMPT_RUNTIME_BUDGET_POLICY },
        sourceSelection: DEFAULT_EXPECTED_RESOLVED_SOURCE_SELECTION,
        visibility: {
          mode: "deny_all_except_visible",
          visibleFloorRanges: [{ startFloorNo: 3, endFloorNo: 4 }],
        },
        debug: DEFAULT_RESOLVED_PROMPT_RUNTIME_DEBUG_POLICY,
      },
      persistentPolicyEnvelope: expect.objectContaining({
        version: 1,
        value: {
          structure: { mode: "strict_alternating" },
          delivery: { requireLastUser: true },
          visibility: {
            mode: "deny_all_except_visible",
            visibleFloorRanges: [{ startFloorNo: 3, endFloorNo: 4 }],
          },
        },
      }),

      warnings: [],
    });

    expect(await service.getBranchPolicy(sessionId, "alt-branch", DEFAULT_ADMIN_ACCOUNT_ID)).toEqual(updated);

    const [sessionRow] = await database.db.select({ metadataJson: sessions.metadataJson }).from(sessions).where(eq(sessions.id, sessionId));
    expect(JSON.parse(sessionRow!.metadataJson!)).toEqual({
      prompt_runtime: {
        branchPolicies: {
          "alt-branch": {
            version: 1,
            updatedAt: expect.any(Number),
            value: {
              structure: { mode: "strict_alternating" },
              delivery: { requireLastUser: true },
              visibility: {
                mode: "deny_all_except_visible",
                visibleFloorRanges: [{ startFloorNo: 3, endFloorNo: 4 }],
              },
            },
          },
        },
      },
    });
  });

  it("ignores invalid branch prompt runtime policy metadata and returns a branch warning", async () => {
    const now = Date.now();
    const sessionId = await insertSession({
      metadata: {
        prompt_runtime: {
          branchPolicies: {
            "alt-branch": {
              structure: {
                mode: "invalid_mode",
              },
            },
          },
        },
      },
    });
    await database.db.insert(floors).values({
      id: nanoid(),
      sessionId,
      floorNo: 1,
      branchId: "alt-branch",
      parentFloorId: null,
      state: "committed",
      metadataJson: null,
      tokenIn: 0,
      tokenOut: 0,
      createdAt: now,
      updatedAt: now,
    });

    const service = new PromptRuntimeControlService(database.db);
    const state = await service.getResolvedState(sessionId, DEFAULT_ADMIN_ACCOUNT_ID, "alt-branch");

    expect(state.branchPersistentPolicy).toBeNull();
    expect(state.warnings).toEqual([INVALID_PROMPT_RUNTIME_BRANCH_POLICY_WARNING]);
    expect(state.diagnostics).toEqual([
      expect.objectContaining({
        code: "invalid_prompt_runtime_branch_policy",
        fieldPath: "prompt_runtime.branchPolicies.alt-branch",
      }),
    ]);
  });

  it("returns branch_not_found when reading resolved state for an unmaterialized branch", async () => {
    const sessionId = await insertSession();
    const service = new PromptRuntimeControlService(database.db);

    await expect(service.getResolvedState(sessionId, DEFAULT_ADMIN_ACCOUNT_ID, "missing-branch")).rejects.toEqual(
      new PromptRuntimeControlServiceError(404, "branch_not_found", "Branch 'missing-branch' not found in session"),
    );
  });

  it("returns historical explain from persisted prompt snapshot truth without recomputing policy or trace", async () => {
    const sessionId = await insertSession();
    const [floor] = await database.db
      .select()
      .from(floors)
      .where(eq(floors.sessionId, sessionId))
      .limit(1);

    const outputPageId = nanoid();
    const assistantMessageId = nanoid();
    const now = Date.now();

    await database.db.insert(messagePages).values({
      id: outputPageId,
      floorId: floor!.id,
      pageNo: 1,
      pageKind: "output",
      isActive: true,
      version: 1,
      checksum: null,
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(messages).values({
      id: assistantMessageId,
      pageId: outputPageId,
      seq: 1,
      role: "assistant",
      content: "The firelight wavers as the next part of the story begins.",
      contentFormat: "text",
      tokenCount: 128,
      isHidden: false,
      source: "narrator",
      createdAt: now,
    });

    await database.db.insert(promptSnapshots).values({
      floorId: floor!.id,
      sessionId,
      presetId: null,
      presetUpdatedAt: null,
      presetVersion: null,
      worldbookId: null,
      worldbookUpdatedAt: null,
      worldbookVersion: null,
      regexProfileId: null,
      regexProfileUpdatedAt: null,
      regexProfileVersion: null,
      worldbookActivatedEntryUidsJson: JSON.stringify([7]),
      regexPreRuleNamesJson: JSON.stringify(["Input Rule"]),
      regexPostRuleNamesJson: JSON.stringify([]),
      promptMode: "compat_strict",
      promptDigest: "digest-1",
      tokenEstimate: 42,
      createdAt: now,
    });

    await database.db.insert(floorResultSnapshots).values({
      floorId: floor!.id,
      outputPageId,
      assistantMessageId,
      generatedText: "The firelight wavers as the next part of the story begins.",
      summariesJson: JSON.stringify(["The group resumes the campfire planning scene."]),
      usageJson: JSON.stringify({ promptTokens: 320, completionTokens: 128, totalTokens: 448 }),
      verifierJson: null,
      committedAt: now,
      updatedAt: now,
    });

    const service = new PromptRuntimeControlService(database.db);
    const explain = await service.getHistoricalExplain(floor!.id, DEFAULT_ADMIN_ACCOUNT_ID);

    expect(explain.floor).toEqual({
      id: floor!.id,
      sessionId,
      floorNo: 0,
      branchId: "main",
      parentFloorId: null,
      state: "committed",
      promptSnapshotCreatedAt: now,
      committedAt: now,
    });
    expect(explain.scope).toEqual({
      sessionId,
      targetBranchId: "main",
      branchExists: true,
      sourceFloorId: null,
      historySourceBranchId: "main",
      historySourceMode: "existing_branch",
    });
    expect(explain.snapshotAvailable).toBe(false);
    expect(explain.assets).toBeNull();
    expect(explain.promptSnapshot).toEqual({
      presetId: null,
      presetUpdatedAt: null,
      presetVersion: null,
      worldbookId: null,
      worldbookUpdatedAt: null,
      worldbookVersion: null,
      regexProfileId: null,
      regexProfileUpdatedAt: null,
      regexProfileVersion: null,
      worldbookActivatedEntryUids: [7],
      regexPreRuleNames: ["Input Rule"],
      regexPostRuleNames: [],
      promptMode: "compat_strict",
      promptDigest: "digest-1",
      tokenEstimate: 42,
    });
    expect(explain.resolvedPolicy).toBeNull();
    expect(explain.sourceMap).toEqual({ history: { sourceBranchId: "main", sourceMode: "existing_branch" } });
    expect(explain.trimReasons).toBeNull();
    expect(explain.excludedSources).toBeNull();
    expect(explain.sectionStats).toBeNull();
    expect(explain.result).toEqual({
      outputPageId,
      assistantMessageId,
      generatedText: "The firelight wavers as the next part of the story begins.",
      summaries: ["The group resumes the campfire planning scene."],
      usage: { promptTokens: 320, completionTokens: 128, totalTokens: 448 },
      verifier: null,
      committedAt: now,
    });
    expect(explain.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "historical_snapshot_unavailable", phase: "explain" }),
      expect.objectContaining({ code: "historical_resolved_policy_unavailable", phase: "explain" }),
      expect.objectContaining({ code: "historical_trim_reasons_unavailable", phase: "explain" }),
      expect.objectContaining({ code: "historical_excluded_sources_unavailable", phase: "explain" }),
    ]));
    expect(explain.limitations).toEqual([...PROMPT_RUNTIME_LIMITATIONS, ...PROMPT_RUNTIME_HISTORICAL_EXPLAIN_LIMITATIONS]);
  });

  it("returns snapshot-backed historical explain with persisted visibility and budget details", async () => {
    const sessionId = await insertSession();
    const [floor] = await database.db
      .select()
      .from(floors)
      .where(eq(floors.sessionId, sessionId))
      .limit(1);

    const outputPageId = nanoid();
    const assistantMessageId = nanoid();
    const now = Date.now();

    const resolvedPolicy = {
      structure: { ...DEFAULT_RESOLVED_PROMPT_RUNTIME_STRUCTURE_POLICY },
      delivery: { ...DEFAULT_RESOLVED_PROMPT_RUNTIME_DELIVERY_POLICY, noAssistant: true },
      budget: { maxInputTokens: 256, reservedCompletionTokens: 64 },
      sourceSelection: {
        ...DEFAULT_EXPECTED_RESOLVED_SOURCE_SELECTION,
        history: { mode: "windowed", maxMessages: 12 },
        examples: { enabled: false },
      },
      visibility: {
        mode: "deny_all_except_visible",
        visibleFloorRanges: [{ startFloorNo: 3, endFloorNo: 4 }],
      },
      debug: { ...DEFAULT_RESOLVED_PROMPT_RUNTIME_DEBUG_POLICY },
    };
    const sourceMap = {
      budget: { maxInputTokens: "request_override", reservedCompletionTokens: "request_override" },
      sourceSelection: {
        history: { mode: "request_override", maxMessages: "request_override" },
        memory: { enabled: "system_default" },
        worldbook: { enabled: "system_default" },
        examples: { enabled: "request_override" },
      },
      visibility: {
        mode: "session_policy",
        visibleFloorRanges: "session_policy",
      },
      history: {
        sourceBranchId: "main",
        sourceMode: "existing_branch",
      },
    };
    const trimReasons = [
      {
        group: "history",
        reason: "group_limit_exceeded",
        detail: "Budget allocator capped group 'history' at 0 tokens and retained 0 of 32 estimated tokens.",
        prunedTokenCount: 32,
      },
    ];
    const excludedSources = [
      {
        source: "history",
        reason: "visibility_filtered",
        detail: "Visibility filtered 1 floor(s) from the available history window.",
      },
    ];
    const diagnostics = [
      {
        code: "persisted_snapshot_loaded",
        message: "Committed explain snapshot loaded from persisted truth.",
        severity: "info" as const,
        phase: "explain" as const,
      },
    ];
    const sectionStats = [{ sectionName: "history", tokenCount: 128 }];

    await database.db.insert(messagePages).values({
      id: outputPageId,
      floorId: floor!.id,
      pageNo: 1,
      pageKind: "output",
      isActive: true,
      version: 1,
      checksum: null,
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(messages).values({
      id: assistantMessageId,
      pageId: outputPageId,
      seq: 1,
      role: "assistant",
      content: "The firelight wavers as the next part of the story begins.",
      contentFormat: "text",
      tokenCount: 128,
      isHidden: false,
      source: "narrator",
      createdAt: now,
    });

    await database.db.insert(promptSnapshots).values({
      floorId: floor!.id,
      sessionId,
      presetId: null,
      presetUpdatedAt: null,
      presetVersion: null,
      worldbookId: null,
      worldbookUpdatedAt: null,
      worldbookVersion: null,
      regexProfileId: null,
      regexProfileUpdatedAt: null,
      regexProfileVersion: null,
      worldbookActivatedEntryUidsJson: JSON.stringify([]),
      regexPreRuleNamesJson: JSON.stringify([]),
      regexPostRuleNamesJson: JSON.stringify([]),
      promptMode: "compat_strict",
      promptDigest: "digest-1",
      tokenEstimate: 42,
      createdAt: now,
    });

    await database.db.insert(floorResultSnapshots).values({
      floorId: floor!.id,
      outputPageId,
      assistantMessageId,
      generatedText: "The firelight wavers as the next part of the story begins.",
      summariesJson: JSON.stringify(["The group resumes the campfire planning scene."]),
      usageJson: JSON.stringify({ promptTokens: 320, completionTokens: 128, totalTokens: 448 }),
      verifierJson: null,
      committedAt: now,
      updatedAt: now,
    });

    await database.db.insert(promptRuntimeExplainSnapshots).values({
      id: nanoid(),
      floorId: floor!.id,
      sessionId,
      targetBranchId: "main",
      sourceFloorId: null,
      historySourceBranchId: "main",
      historySourceMode: "existing_branch",
      snapshotVersion: 1,
      assetsJson: JSON.stringify({ preset: null, characterCard: null, worldbook: null, regexProfile: null }),
      resolvedPolicyJson: JSON.stringify(resolvedPolicy),
      sourceMapJson: JSON.stringify(sourceMap),
      diagnosticsJson: JSON.stringify(diagnostics),
      trimReasonsJson: JSON.stringify(trimReasons),
      excludedSourcesJson: JSON.stringify(excludedSources),
      sectionStatsJson: JSON.stringify(sectionStats),
      createdAt: now,
    });

    const service = new PromptRuntimeControlService(database.db);
    const explain = await service.getHistoricalExplain(floor!.id, DEFAULT_ADMIN_ACCOUNT_ID);

    expect(explain.snapshotAvailable).toBe(true);
    expect(explain.scope).toEqual({
      sessionId,
      targetBranchId: "main",
      branchExists: true,
      sourceFloorId: null,
      historySourceBranchId: "main",
      historySourceMode: "existing_branch",
    });
    expect(explain.resolvedPolicy).toEqual(resolvedPolicy);
    expect(explain.governance).toBeNull();
    expect(explain.sourceMap).toEqual(sourceMap);
    expect(explain.trimReasons).toEqual(trimReasons);
    expect(explain.excludedSources).toEqual(excludedSources);
    expect(explain.sectionStats).toEqual(sectionStats);
    expect(explain.diagnostics).toEqual(diagnostics);
    expect(explain.limitations).toEqual([
      ...PROMPT_RUNTIME_LIMITATIONS,
      ...PROMPT_RUNTIME_HISTORICAL_EXPLAIN_COMMON_LIMITATIONS,
      "This historical explain snapshot predates governance capture, so governance is returned as null.",
    ]);
  });

  it("compares persisted visibility and budget fields from committed explain snapshots", async () => {
    const sessionId = await insertSession();
    const [leftFloor] = await database.db
      .select()
      .from(floors)
      .where(eq(floors.sessionId, sessionId))
      .limit(1);
    const rightFloorId = nanoid();
    const now = Date.now();

    await database.db.insert(floors).values({
      id: rightFloorId,
      sessionId,
      floorNo: 1,
      branchId: "main",
      parentFloorId: leftFloor!.id,
      state: "committed",
      metadataJson: null,
      tokenIn: 0,
      tokenOut: 0,
      createdAt: now,
      updatedAt: now,
    });

    await database.db.insert(promptRuntimeExplainSnapshots).values([
      {
        id: nanoid(),
        floorId: leftFloor!.id,
        sessionId,
        targetBranchId: "main",
        sourceFloorId: null,
        historySourceBranchId: "main",
        historySourceMode: "existing_branch",
        snapshotVersion: 2,
        assetsJson: JSON.stringify({ preset: null, characterCard: null, worldbook: null, regexProfile: null }),
        resolvedPolicyJson: JSON.stringify({
          structure: { ...DEFAULT_RESOLVED_PROMPT_RUNTIME_STRUCTURE_POLICY },
          delivery: { ...DEFAULT_RESOLVED_PROMPT_RUNTIME_DELIVERY_POLICY },
          budget: { maxInputTokens: 256, reservedCompletionTokens: 64 },
          sourceSelection: { ...DEFAULT_EXPECTED_RESOLVED_SOURCE_SELECTION },
          visibility: {
            mode: "allow_all_except_hidden",
            hiddenFloorRanges: [{ startFloorNo: 1, endFloorNo: 1 }],
          },
          debug: { ...DEFAULT_RESOLVED_PROMPT_RUNTIME_DEBUG_POLICY },
        }),
        sourceMapJson: JSON.stringify({
          sourceMap: {
            budget: { maxInputTokens: "session_policy", reservedCompletionTokens: "session_policy" },
            visibility: { mode: "session_policy", hiddenFloorRanges: "session_policy" },
            history: { sourceBranchId: "main", sourceMode: "existing_branch" },
          },
          governance: {
            entries: [
              {
                sourceKind: "history",
                declaredLevel: "budget_prunable",
                registered: true,
                effectiveRetention: "budget_prunable",
                pinned: false,
                prunable: true,
                budgetGroups: ["history"],
                sectionNames: ["chatHistory"],
                tokenCount: 128,
                retainedTokenCount: 96,
                prunedTokenCount: 32,
              },
            ],
            mismatches: [],
            limitations: [],
          },
        }),
        diagnosticsJson: JSON.stringify([]),
        trimReasonsJson: JSON.stringify([
          {
            group: "history",
            reason: "group_limit_exceeded",
            detail: "Left trim reason.",
            prunedTokenCount: 32,
          },
        ]),
        excludedSourcesJson: JSON.stringify([
          {
            source: "history",
            reason: "visibility_filtered",
            detail: "Left exclusion.",
          },
        ]),
        sectionStatsJson: JSON.stringify([{ sectionName: "history", tokenCount: 128 }]),
        createdAt: now,
      },
      {
        id: nanoid(),
        floorId: rightFloorId,
        sessionId,
        targetBranchId: "main",
        sourceFloorId: leftFloor!.id,
        historySourceBranchId: "main",
        historySourceMode: "existing_branch",
        snapshotVersion: 2,
        assetsJson: JSON.stringify({ preset: null, characterCard: null, worldbook: null, regexProfile: null }),
        resolvedPolicyJson: JSON.stringify({
          structure: { ...DEFAULT_RESOLVED_PROMPT_RUNTIME_STRUCTURE_POLICY },
          delivery: { ...DEFAULT_RESOLVED_PROMPT_RUNTIME_DELIVERY_POLICY },
          budget: { maxInputTokens: 512, reservedCompletionTokens: 96 },
          sourceSelection: { ...DEFAULT_EXPECTED_RESOLVED_SOURCE_SELECTION },
          visibility: {
            mode: "deny_all_except_visible",
            visibleFloorRanges: [{ startFloorNo: 2, endFloorNo: 4 }],
          },
          debug: { ...DEFAULT_RESOLVED_PROMPT_RUNTIME_DEBUG_POLICY },
        }),
        sourceMapJson: JSON.stringify({
          sourceMap: {
            budget: { maxInputTokens: "request_override", reservedCompletionTokens: "request_override" },
            visibility: { mode: "request_override", visibleFloorRanges: "request_override" },
            history: { sourceBranchId: "main", sourceMode: "existing_branch" },
          },
          governance: {
            entries: [
              {
                sourceKind: "history",
                declaredLevel: "budget_prunable",
                registered: true,
                effectiveRetention: "fixed",
                pinned: true,
                prunable: false,
                budgetGroups: ["history"],
                sectionNames: ["chatHistory"],
                tokenCount: 96,
                retainedTokenCount: 96,
                prunedTokenCount: 0,
              },
            ],
            mismatches: [],
            limitations: [],
          },
        }),
        diagnosticsJson: JSON.stringify([]),
        trimReasonsJson: JSON.stringify([
          {
            group: "history",
            reason: "group_limit_exceeded",
            detail: "Right trim reason.",
            prunedTokenCount: 64,
          },
        ]),
        excludedSourcesJson: JSON.stringify([
          {
            source: "examples",
            reason: "disabled_by_policy",
            detail: "Right exclusion.",
          },
        ]),
        sectionStatsJson: JSON.stringify([{ sectionName: "history", tokenCount: 96 }]),
        createdAt: now + 1,
      },
    ]);

    const service = new PromptRuntimeControlService(database.db);
    const diff = await service.compareCommittedExplain(sessionId, leftFloor!.id, rightFloorId, DEFAULT_ADMIN_ACCOUNT_ID);

    expect(diff.left).toEqual({ floorId: leftFloor!.id, snapshotAvailable: true });
    expect(diff.right).toEqual({ floorId: rightFloorId, snapshotAvailable: true });
    expect(diff.policyChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "policy.resolvedPolicy.budget.maxInputTokens", changeType: "changed", left: 256, right: 512 }),
      expect.objectContaining({ path: "policy.resolvedPolicy.visibility.mode", changeType: "changed", left: "allow_all_except_hidden", right: "deny_all_except_visible" }),
      expect.objectContaining({ path: "policy.sourceMap.visibility.mode", changeType: "changed", left: "session_policy", right: "request_override" }),
    ]));
    expect(diff.trimChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "trimReasons", changeType: "changed" }),
    ]));
    expect(diff.exclusionChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "excludedSources", changeType: "changed" }),
    ]));
    expect(diff.governanceChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "governance.entries", changeType: "changed" }),
    ]));
    expect(diff.limitations).toEqual([]);
  });


  it("exposes preview capabilities without restoring the preview route to unsupported", () => {
    const service = new PromptRuntimeControlService(database.db, {
      enableLiveEndpoints: true,
      enableDryRunEndpoint: true,
      enablePreviewEndpoint: true,
      enableStreamEndpoint: true,
    });

    expect(service.getCapabilities()).toEqual(expect.objectContaining({
      observability: expect.objectContaining({
        preview: expect.objectContaining({
          enabled: true,
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
        }),
        inspect: expect.objectContaining({
          enabled: true,
          mode: "prepared_turn",
          supportsBranch: true,
          supportsSourceFloor: true,
          supportsVisibility: true,
          returnsPreparedTurn: true,
          returnsGovernance: true,
          llmCall: false,
          createsFloor: false,
          writesPromptSnapshot: false,
          writesExplainSnapshot: false,
          commitsSideEffects: false,
        }),
        explain: expect.objectContaining({
          enabled: true,
          readOnly: true,
          returnsGovernance: true,
          requiresCommittedFloor: true,
          persistedTruthOnly: true,
          recompute: false,
          snapshotSupported: true,
          legacyFloorFallback: true,
          snapshotAvailabilityField: "snapshot_available",
        }),
      }),
      compare: expect.objectContaining({
        enabled: true,
        committedFloorsOnly: true,
        mixedPreviewSupported: false,
        limitationsInsteadOfRecompute: true,
      }),
      governance: expect.objectContaining({
        session: expect.objectContaining({
          envelopeMetadata: true,
          nullClearsField: true,
          objectPatch: "deep_merge",
          supportedFields: expect.arrayContaining(["visibility"]),
        }),
        branch: expect.objectContaining({
          envelopeMetadata: true,
          materializedBranchesOnly: true,
          supportedFields: expect.arrayContaining(["visibility"]),
        }),
      }),
      macro: expect.objectContaining({
        stCompatibilitySnapshotsPersistable: false,
      }),
    }));
    expect(service.getCapabilities().unsupported).not.toContain("/sessions/:id/prompt-runtime/preview");
    expect(service.getCapabilities().unsupported).toContain("/sessions/:id/prompt-runtime/macros");
  });
});
