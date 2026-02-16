import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app";
import { registerOpenApi } from "../src/plugins/openapi";
import { registerChatRoutes } from "../src/routes/chat";
import type { ChatService as ChatServiceType } from "../src/services/chat-service";

type OpenApiDocument = {
  openapi: string;
  info: { title: string; description?: string };
  components?: { securitySchemes?: Record<string, unknown> };
  security?: Array<Record<string, string[]>>;
  paths: Record<string, unknown>;
};

type OpenApiOperation = {
  operationId?: string;
  summary?: string;
  description?: string;
  requestBody?: { content?: Record<string, { schema?: { example?: unknown } }> };
  parameters?: Array<{ name?: string }>;
  responses?: Record<string, unknown>;
  security?: Array<Record<string, string[]>>;
};

describe("OpenAPI integration", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    ({ app } = await buildApp({ databasePath: ":memory:", logger: false }));
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it("serves OpenAPI JSON with key routes", async () => {
    const res = await app.inject({ method: "GET", url: "/openapi.json" });

    expect(res.statusCode).toBe(200);

    const body = res.json<OpenApiDocument>();
    expect(body.openapi).toMatch(/^3\./);
    expect(body.info.title).toBe("TavernHeadless API");
    expect(Object.keys(body.paths)).toContain("/health");
    expect(Object.keys(body.paths)).toContain("/sessions");
    expect(Object.keys(body.paths)).toContain("/floors");
    expect(Object.keys(body.paths)).toContain("/memories");
    expect(Object.keys(body.paths)).toContain("/memories/stats");
    expect(Object.keys(body.paths)).toContain("/characters");
    expect(Object.keys(body.paths)).toContain("/sessions/{id}/character/sync");
    expect(Object.keys(body.paths)).toContain("/llm-profiles");
    expect(Object.keys(body.paths)).toContain("/llm-profiles/models/discover");
    expect(Object.keys(body.paths)).toContain("/llm-profiles/models/test");
  });

  it("supports Chinese localization via lang query", async () => {
    const res = await app.inject({ method: "GET", url: "/openapi.json?lang=zh" });

    expect(res.statusCode).toBe(200);

    const body = res.json<OpenApiDocument>();
    expect(body.info.title).toBe("TavernHeadless API 文档");

    const sessionsPath = body.paths["/sessions"] as {
      post?: OpenApiOperation;
    };
    expect(sessionsPath.post?.summary).toBe("创建会话");
    expect(body.info.description).toBe("TavernHeadless 核心引擎后端 API");
  });

  it("uses docs referer language for Swagger JSON", async () => {
    const res = await app.inject({ method: "GET", url: "/docs/json", headers: { referer: "http://localhost/docs/?lang=zh" } });
    expect(res.statusCode).toBe(200);
    expect(res.json<OpenApiDocument>().info.title).toBe("TavernHeadless API 文档");
  });

  it("exposes request/response schemas for core CRUD routes", async () => {
    const res = await app.inject({ method: "GET", url: "/openapi.json" });
    expect(res.statusCode).toBe(200);

    const body = res.json<OpenApiDocument>();

    const sessionsPath = body.paths["/sessions"] as {
      post?: { requestBody?: unknown; responses?: Record<string, unknown> };
      get?: { parameters?: unknown[]; responses?: Record<string, unknown> };
    };
    expect(sessionsPath.post?.requestBody).toBeDefined();
    expect(sessionsPath.post?.responses).toHaveProperty("201");
    expect(Array.isArray(sessionsPath.get?.parameters)).toBe(true);

    const memoriesPath = body.paths["/memories"] as {
      get?: { parameters?: Array<{ name?: string }>; responses?: Record<string, unknown> };
    };
    expect(memoriesPath.get?.responses).toHaveProperty("200");
    expect(memoriesPath.get?.parameters?.some((parameter) => parameter.name === "created_from")).toBe(true);

    const memoryStatsPath = body.paths["/memories/stats"] as {
      get?: { responses?: Record<string, unknown> };
    };
    expect(memoryStatsPath.get?.responses).toHaveProperty("200");

    const sessionBranchesPath = body.paths["/sessions/{id}/branches"] as {
      get?: { parameters?: Array<{ name?: string }>; responses?: Record<string, unknown> };
    };
    expect(sessionBranchesPath.get?.responses).toHaveProperty("200");
    expect(sessionBranchesPath.get?.parameters?.some((parameter) => parameter.name === "sort_by")).toBe(true);

    const sessionBranchesDiffPath = body.paths["/sessions/{id}/branches/diff"] as {
      get?: { parameters?: Array<{ name?: string }>; responses?: Record<string, unknown> };
    };
    expect(sessionBranchesDiffPath.get?.responses).toHaveProperty("200");
    expect(sessionBranchesDiffPath.get?.parameters?.some((parameter) => parameter.name === "target_branch_id")).toBe(true);

    const sessionTimelinePath = body.paths["/sessions/{id}/timeline"] as {
      get?: { parameters?: Array<{ name?: string }>; responses?: Record<string, unknown> };
    };
    expect(sessionTimelinePath.get?.responses).toHaveProperty("200");
    expect(sessionTimelinePath.get?.parameters?.some((parameter) => parameter.name === "branch_id")).toBe(true);

    const floorBranchPath = body.paths["/floors/{id}/branch"] as {
      post?: { requestBody?: unknown; responses?: Record<string, unknown> };
    };
    expect(floorBranchPath.post?.requestBody).toBeDefined();
    expect(floorBranchPath.post?.responses).toHaveProperty("201");

    const deleteBranchPath = body.paths["/branches/{id}"] as {
      delete?: { parameters?: Array<{ name?: string }>; responses?: Record<string, unknown> };
    };
    expect(deleteBranchPath.delete?.responses).toHaveProperty("200");
    expect(deleteBranchPath.delete?.parameters?.some((parameter) => parameter.name === "session_id")).toBe(true);

    const sessionCharacterSyncPath = body.paths["/sessions/{id}/character/sync"] as {
      post?: { parameters?: Array<{ name?: string }>; responses?: Record<string, unknown> };
    };
    expect(sessionCharacterSyncPath.post?.responses).toHaveProperty("200");
    expect(sessionCharacterSyncPath.post?.responses).toHaveProperty("409");

    const messagesPath = body.paths["/messages"] as {
      post?: OpenApiOperation;
      get?: OpenApiOperation;
    };
    expect(messagesPath.post?.operationId).toBe("createMessage");
    expect(messagesPath.post?.requestBody).toBeDefined();
    expect(messagesPath.post?.responses).toHaveProperty("201");
    expect(messagesPath.get?.operationId).toBe("listMessages");

    const messageByIdPath = body.paths["/messages/{id}"] as {
      patch?: OpenApiOperation;
      delete?: OpenApiOperation;
    };
    expect(messageByIdPath.patch?.operationId).toBe("updateMessage");
    expect(messageByIdPath.delete?.operationId).toBe("deleteMessage");

    const variablesPath = body.paths["/variables"] as {
      put?: OpenApiOperation;
      get?: OpenApiOperation;
    };
    expect(variablesPath.put?.operationId).toBe("upsertVariable");
    expect(variablesPath.put?.responses).toHaveProperty("201");
    expect(variablesPath.get?.parameters?.some((parameter) => parameter.name === "scope_id")).toBe(true);

    const pagesActivatePath = body.paths["/pages/{id}/activate"] as {
      patch?: OpenApiOperation;
    };
    expect(pagesActivatePath.patch?.operationId).toBe("activatePage");
    expect(pagesActivatePath.patch?.responses).toHaveProperty("200");
    expect(pagesActivatePath.patch?.responses).toHaveProperty("404");

    const importCharacterPath = body.paths["/import/character"] as {
      post?: OpenApiOperation;
    };
    expect(importCharacterPath.post?.operationId).toBe("importCharacter");
    expect(importCharacterPath.post?.responses).toHaveProperty("201");
    expect(importCharacterPath.post?.responses).toHaveProperty("413");

    const importedPresetPath = body.paths["/presets/{id}"] as {
      get?: OpenApiOperation;
      delete?: OpenApiOperation;
    };
    expect(importedPresetPath.get?.operationId).toBe("getImportedPreset");
    expect(importedPresetPath.delete?.operationId).toBe("deleteImportedPreset");

    const charactersPath = body.paths["/characters"] as {
      get?: OpenApiOperation;
    };
    expect(charactersPath.get?.operationId).toBe("listCharacters");
    expect(charactersPath.get?.parameters?.some((parameter) => parameter.name === "status")).toBe(true);

    const characterRollbackPath = body.paths["/characters/{id}/versions/{versionId}/rollback"] as {
      post?: OpenApiOperation;
    };
    expect(characterRollbackPath.post?.operationId).toBe("rollbackCharacterVersion");

    const llmProfilesPath = body.paths["/llm-profiles"] as {
      post?: OpenApiOperation;
      get?: OpenApiOperation;
    };
    expect(llmProfilesPath.post?.operationId).toBe("createLlmProfile");
    expect(llmProfilesPath.get?.operationId).toBe("listLlmProfiles");

    const llmProfileActivatePath = body.paths["/llm-profiles/{id}/activate"] as { post?: OpenApiOperation };
    expect(llmProfileActivatePath.post?.operationId).toBe("activateLlmProfile");

    const llmModelDiscoverPath = body.paths["/llm-profiles/models/discover"] as { post?: OpenApiOperation };
    expect(llmModelDiscoverPath.post?.operationId).toBe("discoverLlmProfileModels");

    const llmModelTestPath = body.paths["/llm-profiles/models/test"] as { post?: OpenApiOperation };
    expect(llmModelTestPath.post?.operationId).toBe("testLlmProfileModel");
  });

  it("includes chat route schemas when chat routes are registered", async () => {
    const chatApp = Fastify({ logger: false });
    try {
      await registerOpenApi(chatApp);

      const chatService = {
        respond: vi.fn(),
        regenerate: vi.fn(),
        dryRun: vi.fn(),
      } as unknown as ChatServiceType;

      await registerChatRoutes(chatApp, chatService, { enableSseChat: true, enablePromptDryRun: true });

      const res = await chatApp.inject({ method: "GET", url: "/openapi.json" });
      expect(res.statusCode).toBe(200);

      const body = res.json<OpenApiDocument>();
      expect(Object.keys(body.paths)).toContain("/sessions/{id}/respond");
      expect(Object.keys(body.paths)).toContain("/sessions/{id}/respond/stream");
      expect(Object.keys(body.paths)).toContain("/sessions/{id}/respond/dry-run");
      expect(Object.keys(body.paths)).toContain("/sessions/{id}/regenerate");
      expect(Object.keys(body.paths)).toContain("/floors/{id}/retry");
      expect(Object.keys(body.paths)).toContain("/messages/{id}/edit-and-regenerate");

      const dryRunPath = body.paths["/sessions/{id}/respond/dry-run"] as {
        post?: { responses?: Record<string, unknown> };
      };
      expect(dryRunPath.post?.responses).toHaveProperty("200");
      expect(dryRunPath.post?.responses).toHaveProperty("400");
    } finally {
      await chatApp.close();
    }
  });

  it("serves Swagger UI page", async () => {
    const res = await app.inject({ method: "GET", url: "/docs/" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
  });

  it("provides quick language redirect routes", async () => {
    const zhRes = await app.inject({ method: "GET", url: "/docs-zh" });
    expect(zhRes.statusCode).toBe(302);
    expect(zhRes.headers.location).toBe("/docs/?lang=zh");

    const enRes = await app.inject({ method: "GET", url: "/docs-en" });
    expect(enRes.statusCode).toBe(302);
    expect(enRes.headers.location).toBe("/docs/?lang=en");
  });

  it("declares auth security schemes when auth mode is enabled", async () => {
    const authAppResult = await buildApp({
      databasePath: ":memory:",
      logger: false,
      auth: { mode: "api_key", apiKeys: ["dev-key"] },
    });

    try {
      const res = await authAppResult.app.inject({ method: "GET", url: "/openapi.json" });
      expect(res.statusCode).toBe(200);

      const body = res.json<OpenApiDocument>();
      expect(body.components?.securitySchemes).toHaveProperty("ApiKeyAuth");
      expect(body.components?.securitySchemes).toHaveProperty("BearerAuth");
      expect(body.security).toEqual([{ ApiKeyAuth: [] }]);

      const healthPath = body.paths["/health"] as { get?: OpenApiOperation };
      expect(healthPath.get?.security).toEqual([]);
    } finally {
      await authAppResult.app.close();
    }
  });
});
