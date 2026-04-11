import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../accounts/constants.js";
import { characters, presets, regexProfiles, sessions, worldbooks } from "../../db/schema.js";
import {
  DEFAULT_RESOLVED_PROMPT_RUNTIME_DEBUG_POLICY,
  DEFAULT_RESOLVED_PROMPT_RUNTIME_DELIVERY_POLICY,
  DEFAULT_RESOLVED_PROMPT_RUNTIME_STRUCTURE_POLICY,
  INVALID_PROMPT_RUNTIME_POLICY_WARNING,
  PromptRuntimeControlService,
} from "../prompt-runtime-control-service.js";

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
        },
        delivery: {
          requireLastUser: "session_policy",
          noAssistant: "system_default",
        },
      },
      warnings: [],
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
      },
      delivery: {
        requireLastUser: "system_default",
        noAssistant: "session_policy",
      },
    });
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
        debug: {
          includePromptSnapshot: false,
          includeRuntimeTrace: false,
          includeWorldbookMatches: false,
        },
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
      prompt_runtime: {
        policy: {
          structure: {
            mode: "strict_alternating",
            preserveSystemMessages: true,
          },
          delivery: {
            requireLastUser: true,
            noAssistant: true,
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
        debug: DEFAULT_RESOLVED_PROMPT_RUNTIME_DEBUG_POLICY,
      },
      warnings: [],
    });

    const [sessionRow] = await database.db
      .select({ metadataJson: sessions.metadataJson })
      .from(sessions)
      .where(eq(sessions.id, sessionId));

    expect(JSON.parse(sessionRow!.metadataJson!)).toEqual({
      prompt_runtime: {
        policy: {
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
    expect(state.policy).toEqual({
      structure: DEFAULT_RESOLVED_PROMPT_RUNTIME_STRUCTURE_POLICY,
      delivery: DEFAULT_RESOLVED_PROMPT_RUNTIME_DELIVERY_POLICY,
      debug: DEFAULT_RESOLVED_PROMPT_RUNTIME_DEBUG_POLICY,
    });
    expect(state.warnings).toEqual([INVALID_PROMPT_RUNTIME_POLICY_WARNING]);
  });
});
