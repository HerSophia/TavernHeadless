import { rmSync } from "node:fs";

import Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const runtimeWiringState = vi.hoisted(() => ({
  lastChatServiceOptions: null as Record<string, unknown> | null,
}));

vi.mock("../src/services/chat/chat-service", async () => {
  const actual = await vi.importActual<typeof import("../src/services/chat/chat-service")>("../src/services/chat/chat-service");

  class MockChatService {
    constructor(
      _db: unknown,
      _orchestrator: unknown,
      _tokenCounter: unknown,
      options: Record<string, unknown> = {},
    ) {
      runtimeWiringState.lastChatServiceOptions = options;
    }

    async respond() {
      throw new Error("MockChatService.respond should not be called in llm-runtime-wiring tests");
    }

    async regenerate() {
      throw new Error("MockChatService.regenerate should not be called in llm-runtime-wiring tests");
    }

    async dryRun() {
      throw new Error("MockChatService.dryRun should not be called in llm-runtime-wiring tests");
    }

    async retryFloor() {
      throw new Error("MockChatService.retryFloor should not be called in llm-runtime-wiring tests");
    }

    async editAndRegenerate() {
      throw new Error("MockChatService.editAndRegenerate should not be called in llm-runtime-wiring tests");
    }
  }

  return {
    ...actual,
    ChatService: MockChatService,
  };
});

import { buildApp } from "../src/app";

describe("buildApp LLM runtime wiring", () => {
  let app: FastifyInstance;
  let originalMasterKey: string | undefined;
  let persistedDatabasePath: string | null;

  beforeEach(async () => {
    runtimeWiringState.lastChatServiceOptions = null;
    persistedDatabasePath = null;
    originalMasterKey = process.env.APP_SECRETS_MASTER_KEY;
    process.env.APP_SECRETS_MASTER_KEY = "test-master-key";

    ({ app } = await buildApp({
      databasePath: ":memory:",
      logger: false,
      enableWebSocket: false,
      orchestration: {
        providers: [
          {
            id: "default-openai",
            type: "openai-compatible",
            apiKey: "sk-default",
          },
        ],
        defaultModel: {
          providerId: "default-openai",
          modelId: "gpt-4o-mini",
        },
      },
    }));
  });

  afterEach(async () => {
    if (originalMasterKey === undefined) {
      delete process.env.APP_SECRETS_MASTER_KEY;
    } else {
      process.env.APP_SECRETS_MASTER_KEY = originalMasterKey;
    }

    if (app) {
      await app.close();
    }

    if (persistedDatabasePath) {
      rmSync(persistedDatabasePath, { force: true });
      persistedDatabasePath = null;
    }
  });

  async function createSession(): Promise<string> {
    const response = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { title: "Runtime Session" },
    });

    expect(response.statusCode).toBe(201);
    return (response.json() as { data: { id: string } }).data.id;
  }

  async function createProfile(payload: {
    preset_name: string;
    model_id: string;
    provider?: "openai-compatible";
    api_key?: string;
    base_url?: string;
  }): Promise<string> {
    const response = await app.inject({
      method: "POST",
      url: "/llm-profiles",
      payload: {
        provider: "openai-compatible",
        api_key: "sk-test-profile",
        ...payload,
      },
    });

    expect(response.statusCode).toBe(201);
    return (response.json() as { data: { id: string } }).data.id;
  }

  function getResolveTurnModels() {
    const options = runtimeWiringState.lastChatServiceOptions;
    expect(options).toBeTruthy();
    expect(options?.resolveTurnModels).toBeTypeOf("function");
    return options?.resolveTurnModels as (sessionId: string, accountId?: string) => Promise<Record<string, unknown>>;
  }

  it("merges profile params with instance params and surfaces preset override into ChatService runtime resolution", async () => {
    const sessionId = await createSession();
    const profileId = await createProfile({
      preset_name: "Merged Params Profile",
      model_id: "gpt-4o-mini",
    });

    const activateRes = await app.inject({
      method: "POST",
      url: `/llm-profiles/${profileId}/activate`,
      payload: {
        scope: "global",
        instance_slot: "narrator",
        params: {
          temperature: 0.45,
          max_retries: 3,
        },
      },
    });
    expect(activateRes.statusCode).toBe(200);

    const instanceRes = await app.inject({
      method: "PUT",
      url: "/llm-instances/narrator",
      payload: {
        scope: "session",
        session_id: sessionId,
        preset_id: "preset-override",
        enabled: true,
        params: {
          temperature: 0.9,
          timeout_ms: 12000,
        },
      },
    });
    expect(instanceRes.statusCode).toBe(200);

    const resolveTurnModels = getResolveTurnModels();
    const resolved = await resolveTurnModels(sessionId, "default-admin") as {
      narrator?: {
        enabled?: boolean;
        generationParams?: Record<string, unknown>;
        presetId?: string;
        profileId?: string;
        source?: string;
      };
    };

    expect(resolved.narrator).toMatchObject({
      enabled: true,
      presetId: "preset-override",
      profileId,
      source: "global_profile",
    });
    expect(resolved.narrator?.generationParams).toEqual(
      expect.objectContaining({
        temperature: 0.9,
        maxRetries: 3,
        timeoutMs: 12000,
      }),
    );
  });

  it("keeps instance params and preset override even when execution falls back to env model", async () => {
    const sessionId = await createSession();

    const instanceRes = await app.inject({
      method: "PUT",
      url: "/llm-instances/narrator",
      payload: {
        scope: "session",
        session_id: sessionId,
        preset_id: "preset-env-override",
        enabled: true,
        params: {
          temperature: 0.35,
          max_output_tokens: 256,
        },
      },
    });
    expect(instanceRes.statusCode).toBe(200);

    const resolveTurnModels = getResolveTurnModels();
    const resolved = await resolveTurnModels(sessionId, "default-admin") as {
      narrator?: {
        enabled?: boolean;
        generationParams?: Record<string, unknown>;
        model?: { providerId: string; modelId: string };
        presetId?: string;
        source?: string;
      };
    };

    expect(resolved.narrator).toMatchObject({
      enabled: true,
      presetId: "preset-env-override",
      source: "env",
    });
    expect(resolved.narrator?.model).toBeUndefined();
    expect(resolved.narrator?.generationParams).toEqual(
      expect.objectContaining({
        temperature: 0.35,
        maxOutputTokens: 256,
      }),
    );
  });

  it("creates turn-scoped provider handles instead of reusing a shared stable provider id", async () => {
    const sessionId = await createSession();
    const profileId = await createProfile({
      preset_name: "Turn Scoped Profile",
      model_id: "gpt-4o-mini",
      base_url: "https://proxy.one/v1",
    });

    const activateRes = await app.inject({
      method: "POST",
      url: `/llm-profiles/${profileId}/activate`,
      payload: {
        scope: "global",
        instance_slot: "narrator",
      },
    });
    expect(activateRes.statusCode).toBe(200);

    const resolveTurnModels = getResolveTurnModels();
    const first = await resolveTurnModels(sessionId, "default-admin") as {
      narrator?: { model?: { providerId: string; modelId: string; languageModel?: unknown } };
    };

    const updateRes = await app.inject({
      method: "PATCH",
      url: `/llm-profiles/${profileId}`,
      payload: {
        model_id: "gpt-4.1",
        base_url: "https://proxy.two/v1",
      },
    });
    expect(updateRes.statusCode).toBe(200);

    const second = await resolveTurnModels(sessionId, "default-admin") as {
      narrator?: { model?: { providerId: string; modelId: string; languageModel?: unknown } };
    };

    expect(first.narrator?.model).toMatchObject({ modelId: "gpt-4o-mini" });
    expect(second.narrator?.model).toMatchObject({ modelId: "gpt-4.1" });
    expect(first.narrator?.model?.providerId).toMatch(/^llm-profile-.*-turn-/);
    expect(second.narrator?.model?.providerId).toMatch(/^llm-profile-.*-turn-/);
    expect(first.narrator?.model?.providerId).not.toBe(second.narrator?.model?.providerId);
    expect(first.narrator?.model?.languageModel).toBeDefined();
    expect(second.narrator?.model?.languageModel).toBeDefined();
  });

  it(
    "falls back to env model when profile secret cannot be decrypted during turn model resolution",
    async () => {
    await app.close();
    persistedDatabasePath = `data/test-llm-runtime-secret-format-${Date.now()}.db`;

    process.env.APP_SECRETS_MASTER_KEY = "correct-master-key";
    ({ app } = await buildApp({
      databasePath: persistedDatabasePath,
      logger: false,
      enableWebSocket: false,
      orchestration: {
        providers: [
          {
            id: "default-openai",
            type: "openai-compatible",
            apiKey: "sk-default",
          },
        ],
        defaultModel: {
          providerId: "default-openai",
          modelId: "gpt-4o-mini",
        },
      },
    }));

    const sessionId = await createSession();
    const profileId = await createProfile({ preset_name: "Broken Turn Profile", model_id: "gpt-4o-mini" });

    const activateRes = await app.inject({
      method: "POST",
      url: `/llm-profiles/${profileId}/activate`,
      payload: { scope: "global", instance_slot: "narrator" },
    });
    expect(activateRes.statusCode).toBe(200);

    await app.close();

    process.env.APP_SECRETS_MASTER_KEY = "wrong-master-key";
    ({ app } = await buildApp({
      databasePath: persistedDatabasePath,
      logger: false,
      enableWebSocket: false,
      orchestration: {
        providers: [{ id: "default-openai", type: "openai-compatible", apiKey: "sk-default" }],
        defaultModel: { providerId: "default-openai", modelId: "gpt-4o-mini" },
      },
    }));

    const resolveTurnModels = getResolveTurnModels();
    const resolved = await resolveTurnModels(sessionId, "default-admin") as {
      narrator?: {
        enabled?: boolean;
        source?: string;
        profileId?: string;
        model?: { providerId: string; modelId: string };
      };
    };

    expect(resolved.narrator).toMatchObject({
      enabled: true,
      source: "env",
    });
    expect(resolved.narrator?.profileId).toBeUndefined();
    expect(resolved.narrator?.model).toBeUndefined();
    },
    15_000,
  );

  it(
    "skips a broken higher-priority profile and continues to a lower-priority healthy binding",
    async () => {
    await app.close();
    persistedDatabasePath = `data/test-llm-runtime-secret-priority-${Date.now()}.db`;

    process.env.APP_SECRETS_MASTER_KEY = "priority-master-key";
    ({ app } = await buildApp({
      databasePath: persistedDatabasePath,
      logger: false,
      enableWebSocket: false,
      orchestration: {
        providers: [{ id: "default-openai", type: "openai-compatible", apiKey: "sk-default" }],
        defaultModel: { providerId: "default-openai", modelId: "gpt-4o-mini" },
      },
    }));

    const sessionId = await createSession();
    const wildcardProfileId = await createProfile({ preset_name: "Healthy Wildcard Profile", model_id: "gpt-4o-mini" });
    const brokenNarratorProfileId = await createProfile({ preset_name: "Broken Narrator Profile", model_id: "gpt-4.1" });

    const activateWildcardRes = await app.inject({
      method: "POST",
      url: `/llm-profiles/${wildcardProfileId}/activate`,
      payload: { scope: "global", instance_slot: "*" },
    });
    expect(activateWildcardRes.statusCode).toBe(200);

    const activateBrokenRes = await app.inject({
      method: "POST",
      url: `/llm-profiles/${brokenNarratorProfileId}/activate`,
      payload: { scope: "global", instance_slot: "narrator" },
    });
    expect(activateBrokenRes.statusCode).toBe(200);

    await app.close();

    const sqlite = new Database(persistedDatabasePath);
    try {
      sqlite.prepare("UPDATE llm_profile SET api_key_encrypted = ? WHERE id = ?").run("not-a-valid-secret", brokenNarratorProfileId);
    } finally {
      sqlite.close();
    }

    ({ app } = await buildApp({
      databasePath: persistedDatabasePath,
      logger: false,
      enableWebSocket: false,
      orchestration: {
        providers: [{ id: "default-openai", type: "openai-compatible", apiKey: "sk-default" }],
        defaultModel: { providerId: "default-openai", modelId: "gpt-4o-mini" },
      },
    }));

    const resolveTurnModels = getResolveTurnModels();
    const resolved = await resolveTurnModels(sessionId, "default-admin") as {
      narrator?: {
        enabled?: boolean;
        source?: string;
        profileId?: string;
        model?: { providerId: string; modelId: string };
      };
    };

    expect(resolved.narrator).toMatchObject({
      enabled: true,
      source: "global_profile",
      profileId: wildcardProfileId,
      model: { modelId: "gpt-4o-mini" },
    });
    },
    15_000,
  );
});
