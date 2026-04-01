import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app";
import { registerOpenApi } from "../src/plugins/openapi";
import { registerChatRoutes } from "../src/routes/chat";
import type { ChatService as ChatServiceType } from "../src/services/chat-service";

type OpenApiDocument = {
  openapi: string;
  info: { title: string; description?: string };
  tags?: Array<{ name?: string; description?: string }>;
  components?: { securitySchemes?: Record<string, unknown> };
  security?: Array<Record<string, string[]>>;
  paths: Record<string, unknown>;
};

type OpenApiExampleObject = {
  value?: unknown;
};

type OpenApiSchemaObject = {
  example?: unknown;
};

type OpenApiMediaTypeObject = {
  example?: unknown;
  examples?: Record<string, OpenApiExampleObject>;
  schema?: OpenApiSchemaObject;
};

type OpenApiContentContainer = {
  content?: Record<string, OpenApiMediaTypeObject>;
};

type OpenApiOperation = {
  operationId?: string;
  summary?: string;
  description?: string;
  requestBody?: OpenApiContentContainer;
  parameters?: Array<{ name?: string }>;
  responses?: Record<string, OpenApiContentContainer>;
  security?: Array<Record<string, string[]>>;
};

function getOpenApiMediaExample(media: OpenApiMediaTypeObject | undefined): unknown {
  if (!media) {
    return undefined;
  }

  return media.example ?? Object.values(media.examples ?? {})[0]?.value ?? media.schema?.example;
}

function getOpenApiSchemaExample(container: OpenApiContentContainer | undefined): unknown {
  const firstContent = container?.content ? Object.values(container.content)[0] : undefined;
  return getOpenApiMediaExample(firstContent);
}

function getOpenApiResponseExample(operation: OpenApiOperation | undefined, statusCode: string): unknown {
  return getOpenApiSchemaExample(operation?.responses?.[statusCode]);
}

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
    expect(Object.keys(body.paths)).toContain("/memories/batch/status");
    expect(Object.keys(body.paths)).toContain("/memories/batch/delete");
    expect(Object.keys(body.paths)).toContain("/memories/stats");
    expect(Object.keys(body.paths)).toContain("/characters");
    expect(Object.keys(body.paths)).toContain("/messages/batch/visibility");
    expect(Object.keys(body.paths)).toContain("/messages/batch/delete");
    expect(Object.keys(body.paths)).toContain("/sessions/{id}/character/sync");
    expect(Object.keys(body.paths)).toContain("/llm-profiles");
    expect(Object.keys(body.paths)).toContain("/llm-profiles/models/discover");
    expect(Object.keys(body.paths)).toContain("/llm-profiles/models/test");
    expect(Object.keys(body.paths)).toContain("/import/chat/jobs");
    expect(Object.keys(body.paths)).toContain("/export/chat/{id}/jobs");
    expect(Object.keys(body.paths)).toContain("/chat-transfer-jobs");
    expect(Object.keys(body.paths)).toContain("/chat-transfer-jobs/{id}");
    expect(Object.keys(body.paths)).toContain("/chat-transfer-jobs/{id}/cancel");
    expect(Object.keys(body.paths)).toContain("/chat-transfer-jobs/{id}/retry");
    expect(Object.keys(body.paths)).toContain("/chat-transfer-jobs/{id}/file");
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

    const accountsTag = body.tags?.find((tag) => tag.name === "accounts");
    expect(accountsTag?.description).toBe("账号管理");

    const exportsTag = body.tags?.find((tag) => tag.name === "exports");
    expect(exportsTag?.description).toBe("资源导出与文件下载接口（含高级异步作业入口）");

    const chatTransferJobsTag = body.tags?.find((tag) => tag.name === "chat-transfer-jobs");
    expect(chatTransferJobsTag?.description).toBe("异步聊天导入导出作业观测与产物下载的高级开发接口");

    const usersPath = body.paths["/users"] as {
      post?: OpenApiOperation;
    };
    expect(usersPath.post?.summary).toBe("创建用户");

    const importChatJobsPath = body.paths["/import/chat/jobs"] as {
      post?: OpenApiOperation;
    };
    expect(importChatJobsPath.post?.summary).toBe("创建异步聊天导入作业");

    const exportChatJobsPath = body.paths["/export/chat/{id}/jobs"] as { post?: OpenApiOperation };
    expect(exportChatJobsPath.post?.summary).toBe("创建异步聊天导出作业");

    const llmDiscoverPath = body.paths["/llm-profiles/models/discover"] as { post?: OpenApiOperation };
    expect(llmDiscoverPath.post?.summary).toBe("发现 provider 模型列表");

    const variablesBatchPath = body.paths["/variables/batch"] as {
      put?: OpenApiOperation;
    };
    expect(variablesBatchPath.put?.summary).toBe("批量新增或更新变量");

    const memoriesBatchStatusPath = body.paths["/memories/batch/status"] as {
      patch?: OpenApiOperation;
    };
    expect(memoriesBatchStatusPath.patch?.summary).toBe("批量更新记忆条目状态");

    const messagesBatchVisibilityPath = body.paths["/messages/batch/visibility"] as {
      patch?: OpenApiOperation;
    };
    expect(messagesBatchVisibilityPath.patch?.summary).toBe("批量更新消息可见性");
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

    const messageBatchVisibilityPath = body.paths["/messages/batch/visibility"] as {
      patch?: OpenApiOperation;
    };
    expect(messageBatchVisibilityPath.patch?.operationId).toBe("batchUpdateMessageVisibility");
    expect(messageBatchVisibilityPath.patch?.responses).toHaveProperty("200");

    const messageBatchDeletePath = body.paths["/messages/batch/delete"] as {
      post?: OpenApiOperation;
    };
    expect(messageBatchDeletePath.post?.operationId).toBe("batchDeleteMessages");
    expect(messageBatchDeletePath.post?.responses).toHaveProperty("200");

    const memoriesBatchStatusPath = body.paths["/memories/batch/status"] as {
      patch?: OpenApiOperation;
    };
    expect(memoriesBatchStatusPath.patch?.operationId).toBe("batchUpdateMemoryItemStatus");

    const memoriesBatchDeletePath = body.paths["/memories/batch/delete"] as {
      post?: OpenApiOperation;
    };
    expect(memoriesBatchDeletePath.post?.operationId).toBe("batchDeleteMemoryItems");

    const variablesPath = body.paths["/variables"] as {
      put?: OpenApiOperation;
      get?: OpenApiOperation;
    };
    expect(variablesPath.put?.operationId).toBe("upsertVariable");
    expect(variablesPath.put?.responses).toHaveProperty("201");
    expect(variablesPath.get?.parameters?.some((parameter) => parameter.name === "scope_id")).toBe(true);

    const variablesBatchPath = body.paths["/variables/batch"] as {
      put?: OpenApiOperation;
    };
    expect(variablesBatchPath.put?.operationId).toBe("batchUpsertVariables");
    expect(variablesBatchPath.put?.responses).toHaveProperty("200");

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

    const llmInstancesListPath = body.paths["/llm-instances"] as { get?: OpenApiOperation };
    expect(llmInstancesListPath.get?.operationId).toBe("listLlmInstanceConfigs");

    const llmInstancesResolvedPath = body.paths["/llm-instances/resolved"] as { get?: OpenApiOperation };
    expect(llmInstancesResolvedPath.get?.operationId).toBe("getResolvedLlmInstanceConfigs");

    const llmInstancesSlotPath = body.paths["/llm-instances/{slot}"] as {
      get?: OpenApiOperation;
      put?: OpenApiOperation;
      delete?: OpenApiOperation;
    };
    expect(llmInstancesSlotPath.get?.operationId).toBe("getLlmInstanceConfigs");
    expect(llmInstancesSlotPath.put?.operationId).toBe("upsertLlmInstanceConfig");
    expect(llmInstancesSlotPath.delete?.operationId).toBe("deleteLlmInstanceConfig");

    const importChatJobsPath = body.paths["/import/chat/jobs"] as {
      post?: OpenApiOperation;
    };
    expect(importChatJobsPath.post?.operationId).toBe("createImportChatJob");
    expect(importChatJobsPath.post?.responses).toHaveProperty("202");

    const exportChatJobsPath = body.paths["/export/chat/{id}/jobs"] as {
      post?: OpenApiOperation;
    };
    expect(exportChatJobsPath.post?.operationId).toBe("createExportChatJob");
    expect(exportChatJobsPath.post?.responses).toHaveProperty("202");

    const chatTransferJobsPath = body.paths["/chat-transfer-jobs"] as { get?: OpenApiOperation };
    expect(chatTransferJobsPath.get?.operationId).toBe("listChatTransferJobs");

    const chatTransferJobByIdPath = body.paths["/chat-transfer-jobs/{id}"] as { get?: OpenApiOperation };
    expect(chatTransferJobByIdPath.get?.operationId).toBe("getChatTransferJob");

    const chatTransferJobCancelPath = body.paths["/chat-transfer-jobs/{id}/cancel"] as { post?: OpenApiOperation };
    expect(chatTransferJobCancelPath.post?.operationId).toBe("cancelChatTransferJob");

    const chatTransferJobRetryPath = body.paths["/chat-transfer-jobs/{id}/retry"] as { post?: OpenApiOperation };
    expect(chatTransferJobRetryPath.post?.operationId).toBe("retryChatTransferJob");

    const chatTransferJobFilePath = body.paths["/chat-transfer-jobs/{id}/file"] as { get?: OpenApiOperation };
    expect(chatTransferJobFilePath.get?.operationId).toBe("downloadChatTransferJobFile");
  });

  it("includes request/response examples for beta-hardening CRUD routes", async () => {
    const res = await app.inject({ method: "GET", url: "/openapi.json" });
    expect(res.statusCode).toBe(200);

    const body = res.json<OpenApiDocument>();

    const sessionsPath = body.paths["/sessions"] as {
      post?: OpenApiOperation;
      get?: OpenApiOperation;
    };
    expect(getOpenApiSchemaExample(sessionsPath.post?.requestBody)).toMatchObject({ title: "Campfire Planning" });
    expect(getOpenApiResponseExample(sessionsPath.post, "201")).toMatchObject({ data: { id: "sess_demo" } });
    expect(getOpenApiResponseExample(sessionsPath.get, "200")).toMatchObject({ data: [{ id: "sess_demo" }] });

    const sessionTimelinePath = body.paths["/sessions/{id}/timeline"] as { get?: OpenApiOperation };
    expect(getOpenApiResponseExample(sessionTimelinePath.get, "200")).toMatchObject({
      data: { branch_id: "main" },
      meta: { sort_by: "floor_no" },
    });

    const sessionCharacterSyncPath = body.paths["/sessions/{id}/character/sync"] as { post?: OpenApiOperation };
    expect(getOpenApiSchemaExample(sessionCharacterSyncPath.post?.requestBody)).toMatchObject({ force: true });

    const accountsPath = body.paths["/accounts"] as {
      post?: OpenApiOperation;
      get?: OpenApiOperation;
    };
    expect(getOpenApiSchemaExample(accountsPath.post?.requestBody)).toMatchObject({ name: "Demo Workspace" });
    expect(getOpenApiResponseExample(accountsPath.post, "201")).toMatchObject({ data: { id: "acc_demo" } });
    expect(getOpenApiResponseExample(accountsPath.get, "200")).toMatchObject({ data: [{ id: "acc_demo" }] });

    const usersPath = body.paths["/users"] as {
      post?: OpenApiOperation;
      get?: OpenApiOperation;
    };
    expect(getOpenApiSchemaExample(usersPath.post?.requestBody)).toMatchObject({ snapshot: { name: "Alice" } });
    expect(getOpenApiResponseExample(usersPath.post, "201")).toMatchObject({ data: { id: "usr_demo" } });
    expect(getOpenApiResponseExample(usersPath.get, "200")).toMatchObject({ data: [{ id: "usr_demo" }] });

    const variablesPath = body.paths["/variables"] as {
      put?: OpenApiOperation;
      get?: OpenApiOperation;
    };
    expect(getOpenApiSchemaExample(variablesPath.put?.requestBody)).toMatchObject({ key: "mood" });
    expect(getOpenApiResponseExample(variablesPath.put, "201")).toMatchObject({ data: { id: "var_mood" } });
    expect(getOpenApiResponseExample(variablesPath.get, "200")).toMatchObject({ data: expect.any(Array) });
    const variablesListExample = getOpenApiResponseExample(variablesPath.get, "200") as { data?: unknown };
    expect(variablesListExample.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "var_mood" }),
    ]));

    const variablesBatchPath = body.paths["/variables/batch"] as { put?: OpenApiOperation };
    expect(getOpenApiSchemaExample(variablesBatchPath.put?.requestBody)).toEqual(expect.objectContaining({
      items: expect.arrayContaining([expect.objectContaining({ key: "mood" })])
    }));
    expect(getOpenApiResponseExample(variablesBatchPath.put, "200")).toEqual(expect.objectContaining({
      data: expect.objectContaining({ meta: { total: 3, created: 2, updated: 1 } })
    }));

    const memoriesBatchStatusPath = body.paths["/memories/batch/status"] as { patch?: OpenApiOperation };
    expect(getOpenApiSchemaExample(memoriesBatchStatusPath.patch?.requestBody)).toMatchObject({ status: "deprecated" });
    expect(getOpenApiResponseExample(memoriesBatchStatusPath.patch, "200")).toEqual(expect.objectContaining({
      data: expect.objectContaining({ meta: { total: 2, updated: 1, not_found: 1, status: "deprecated" } })
    }));

    const memoriesBatchDeletePath = body.paths["/memories/batch/delete"] as { post?: OpenApiOperation };
    expect(getOpenApiSchemaExample(memoriesBatchDeletePath.post?.requestBody)).toEqual(expect.objectContaining({
      ids: ["mem_fact_1", "mem_missing"]
    }));
    expect(getOpenApiResponseExample(memoriesBatchDeletePath.post, "200")).toEqual(expect.objectContaining({
      data: expect.objectContaining({ meta: { total: 2, deleted: 1, not_found: 1 } })
    }));

    const messagesBatchVisibilityPath = body.paths["/messages/batch/visibility"] as { patch?: OpenApiOperation };
    expect(getOpenApiSchemaExample(messagesBatchVisibilityPath.patch?.requestBody)).toMatchObject({ is_hidden: true });
    expect(getOpenApiResponseExample(messagesBatchVisibilityPath.patch, "200")).toEqual(expect.objectContaining({
      data: expect.objectContaining({ meta: { total: 2, updated: 1, not_found: 1, is_hidden: true } })
    }));

    const messagesBatchDeletePath = body.paths["/messages/batch/delete"] as { post?: OpenApiOperation };
    expect(getOpenApiSchemaExample(messagesBatchDeletePath.post?.requestBody)).toEqual(expect.objectContaining({ ids: ["msg_21", "msg_missing"] }));
    expect(getOpenApiResponseExample(messagesBatchDeletePath.post, "200")).toEqual(expect.objectContaining({
      data: expect.objectContaining({ meta: { total: 2, deleted: 1, not_found: 1 } })
    }));

    const llmProfilesPath = body.paths["/llm-profiles"] as {
      post?: OpenApiOperation;
      get?: OpenApiOperation;
    };
    expect(getOpenApiSchemaExample(llmProfilesPath.post?.requestBody)).toMatchObject({ preset_name: "OpenAI Narrator" });
    expect(getOpenApiResponseExample(llmProfilesPath.post, "201")).toMatchObject({ data: { id: "lp_narrator" } });
    expect(getOpenApiResponseExample(llmProfilesPath.get, "200")).toMatchObject({ data: [{ id: "lp_narrator" }] });

    const llmDiscoverPath = body.paths["/llm-profiles/models/discover"] as { post?: OpenApiOperation };
    expect(getOpenApiSchemaExample(llmDiscoverPath.post?.requestBody)).toMatchObject({ provider: "openai" });
    expect(getOpenApiResponseExample(llmDiscoverPath.post, "200")).toMatchObject({
      data: expect.arrayContaining([
        expect.objectContaining({ id: "gpt-4o-mini" }),
      ]),
    });

    const llmActivatePath = body.paths["/llm-profiles/{id}/activate"] as { post?: OpenApiOperation };
    expect(getOpenApiSchemaExample(llmActivatePath.post?.requestBody)).toMatchObject({ scope: "session", instance_slot: "director" });
    expect(getOpenApiResponseExample(llmActivatePath.post, "200")).toMatchObject({ data: { activated: true } });

    const importPresetPath = body.paths["/import/preset"] as { post?: OpenApiOperation };
    expect(getOpenApiSchemaExample(importPresetPath.post?.requestBody)).toMatchObject({ name: "Story Preset" });
    expect(getOpenApiResponseExample(importPresetPath.post, "201")).toMatchObject({ data: { id: "preset_story" } });

    const importCharacterPath = body.paths["/import/character"] as { post?: OpenApiOperation };
    expect(getOpenApiSchemaExample(importCharacterPath.post?.requestBody)).toMatchObject({ title: "Luna Demo Session" });
    expect(getOpenApiResponseExample(importCharacterPath.post, "201")).toMatchObject({ data: { create_session: true } });

    const importChatJobsPath = body.paths["/import/chat/jobs"] as { post?: OpenApiOperation };
    expect(getOpenApiSchemaExample(importChatJobsPath.post?.requestBody)).toMatchObject({ title: "Imported Chat" });
    expect(getOpenApiResponseExample(importChatJobsPath.post, "202")).toMatchObject({
      data: { job_id: "ctj_import_demo", job_kind: "import_chat" },
    });

    const exportChatJobsPath = body.paths["/export/chat/{id}/jobs"] as { post?: OpenApiOperation };
    expect(getOpenApiSchemaExample(exportChatJobsPath.post?.requestBody)).toMatchObject({ format: "thchat" });
    expect(getOpenApiResponseExample(exportChatJobsPath.post, "202")).toMatchObject({
      data: { job_id: "ctj_export_demo", job_kind: "export_chat", requested_session_id: "sess_demo" },
    });

    const chatTransferJobsPath = body.paths["/chat-transfer-jobs"] as { get?: OpenApiOperation };
    expect(getOpenApiResponseExample(chatTransferJobsPath.get, "200")).toMatchObject({
      data: [expect.objectContaining({ id: "ctj_export_demo", status: "succeeded" })],
      meta: { sort_by: "created_at" },
    });

    const chatTransferJobByIdPath = body.paths["/chat-transfer-jobs/{id}"] as { get?: OpenApiOperation };
    expect(getOpenApiResponseExample(chatTransferJobByIdPath.get, "200")).toMatchObject({
      data: expect.objectContaining({ id: "ctj_export_demo", output_artifact_path: "data/chat-transfer-artifacts/ctj_export_demo.thchat" }),
    });

    const chatTransferJobCancelPath = body.paths["/chat-transfer-jobs/{id}/cancel"] as { post?: OpenApiOperation };
    expect(getOpenApiResponseExample(chatTransferJobCancelPath.post, "200")).toMatchObject({ data: { job_id: "ctj_export_demo" } });

    const chatTransferJobRetryPath = body.paths["/chat-transfer-jobs/{id}/retry"] as { post?: OpenApiOperation };
    expect(getOpenApiResponseExample(chatTransferJobRetryPath.post, "200")).toMatchObject({ data: { job_id: "ctj_export_demo" } });

    const instancesListPath = body.paths["/llm-instances"] as { get?: OpenApiOperation };
    expect(getOpenApiResponseExample(instancesListPath.get, "200")).toMatchObject({ data: [{ id: "ic_demo123" }] });

    const instancesSlotPath = body.paths["/llm-instances/{slot}"] as { put?: OpenApiOperation };
    expect(getOpenApiSchemaExample(instancesSlotPath.put?.requestBody)).toMatchObject({ scope: "global" });
    expect(getOpenApiResponseExample(instancesSlotPath.put, "200")).toMatchObject({ data: { id: "ic_demo123" } });

    const instancesResolvedPath = body.paths["/llm-instances/resolved"] as { get?: OpenApiOperation };
    expect(getOpenApiResponseExample(instancesResolvedPath.get, "200")).toMatchObject({
      data: { slots: [{ slot: "narrator" }] },
    });
  });

  it("includes chat route schemas and examples when chat routes are registered", async () => {
    const chatApp = Fastify({ logger: false });
    try {
      await registerOpenApi(chatApp);

      const chatService = {
        respond: vi.fn(),
        regenerate: vi.fn(),
        retryFloor: vi.fn(),
        dryRun: vi.fn(),
        editAndRegenerate: vi.fn(),
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

      const respondPath = body.paths["/sessions/{id}/respond"] as { post?: OpenApiOperation };
      expect(getOpenApiSchemaExample(respondPath.post?.requestBody)).toMatchObject({ message: "Please continue the campfire scene." });
      expect(getOpenApiResponseExample(respondPath.post, "200")).toMatchObject({ data: { branch_id: "main" } });

      const dryRunPath = body.paths["/sessions/{id}/respond/dry-run"] as {
        post?: OpenApiOperation;
      };
      expect(dryRunPath.post?.responses).toHaveProperty("200");
      expect(dryRunPath.post?.responses).toHaveProperty("400");
      expect(getOpenApiSchemaExample(dryRunPath.post?.requestBody)).toMatchObject({ message: "Please continue the campfire scene." });
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
