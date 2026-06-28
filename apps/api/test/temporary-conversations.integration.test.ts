import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { buildApp } from "../src/app";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../src/accounts/constants.js";
import type { DatabaseConnection } from "../src/db/client.js";
import {
  floors,
  messagePages,
  messages,
  pageStagedWrites,
  projects,
  sessions,
  workspaces,
} from "../src/db/schema.js";
import { registerTemporaryConversationRoutes } from "../src/routes/temporary-conversations.js";
import type { ChatService } from "../src/services/chat/chat-service.js";
import { TemporaryConversationService } from "../src/services/temporary-conversation-service.js";
import { GraphAssistantToolConfirmationService } from "../src/services/graph-assistant-tool-confirmation-service.js";
import { SessionBranchRegistryService } from "../src/services/variables/host/session-branch-registry-service.js";

describe("temporary conversation routes", () => {
  let app: FastifyInstance;
  let database: DatabaseConnection["db"];
  let temporaryConversationService: TemporaryConversationService;

  beforeEach(async () => {
    const built = await buildApp({
      databasePath: ":memory:",
      logger: false,
    });
    app = built.app;
    database = built.database;

    const chatService = createMockChatService(database);
    temporaryConversationService = new TemporaryConversationService(database, chatService);
    await registerTemporaryConversationRoutes(app, { db: database } as DatabaseConnection, {
      temporaryConversationService,
      cors: { origins: true, credentials: false },
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it("creates a client-visible temporary conversation from a source session, reads detail, transcript, and finalizes it", async () => {
    const sourceSessionId = await seedSession(database, {
      title: "Source Session",
      metadataJson: JSON.stringify({
        tool_permissions: {
          allow_irreversible: true,
        },
      }),
    });

    const createResponse = await app.inject({
      method:"POST",
      url: `/sessions/${sourceSessionId}/temporary-conversations`,
      payload: {
        purpose: "draft",
        retention_policy: "delete_on_finalize",
      },
    });
    expect(createResponse.statusCode,createResponse.body).toBe(201);
    const created = createResponse.json<{ data: Record<string, unknown> }>().data;
    const conversationId = String(created.id);
    expect(created.visibility).toBe("client_visible");
    expect(created.source_session_id).toBe(sourceSessionId);
    expect(created.status).toBe("active");

    const detailResponse = await app.inject({
      method: "GET",
      url: `/temporary-conversations/${conversationId}`,
    });
    expect(detailResponse.statusCode, detailResponse.body).toBe(200);
    expect(detailResponse.json<{ data: Record<string, unknown> }>().data.id).toBe(conversationId);

    const respondResponse = await app.inject({
      method: "POST",
      url: `/temporary-conversations/${conversationId}/respond`,
      payload: {
        input_message: {
          role: "user",
          content: "Need a draft answer",
        },
      },
    });
    expect(respondResponse.statusCode, respondResponse.body).toBe(200);
    const respondData = respondResponse.json<{ data: Record<string, unknown> }>().data;
    expect(respondData.generated_text).toBe("reply:Need a draft answer");

    const transcriptResponse = await app.inject({
      method: "GET",
      url: `/temporary-conversations/${conversationId}/transcript`,
    });
    expect(transcriptResponse.statusCode, transcriptResponse.body).toBe(200);
    const transcript = transcriptResponse.json<{
      data: {
        floors: Array<{
          state: string;
          pages: Array<{
            page_kind: string;
            messages: Array<{ role: string; content: string }>;
          }>;
        }>;
      };
    }>().data;
    expect(transcript.floors).toHaveLength(1);
    expect(transcript.floors[0]?.state).toBe("committed");
    expect(transcript.floors[0]?.pages[0]?.messages[0]).toMatchObject({
      role: "user",
      content: "Need a draft answer",
    });
    expect(transcript.floors[0]?.pages[1]?.messages[0]).toMatchObject({
      role: "assistant",
      content: "reply:Need a draft answer",
    });

    const finalizeResponse = await app.inject({
      method: "POST",
      url: `/temporary-conversations/${conversationId}/finalize`,
    });
    expect(finalizeResponse.statusCode, finalizeResponse.body).toBe(200);
    expect(finalizeResponse.json<{ data: Record<string, unknown> }>().data.status).toBe("finalized");

    const appendAfterFinalize = await app.inject({
      method: "POST",
      url: `/temporary-conversations/${conversationId}/messages`,
      payload: {
        role: "user",
        content: "one more thing",
      },
    });
    expect(appendAfterFinalize.statusCode, appendAfterFinalize.body).toBe(409);
    expect(appendAfterFinalize.json<{ error: { code: string } }>().error.code).toBe("conversation_not_active");
  });

  it("streams respond events and exports the latest output to page_staged_write", async () => {
    const sourceSessionId = await seedSession(database, {
   title: "Route Stream Source",
    });
    const targetSessionId = await seedSession(database, {
      title: "Target Session",
    });
    const targetPageId = await seedPageForSession(database, targetSessionId);

    const createResponse = await app.inject({
      method: "POST",
      url: `/sessions/${sourceSessionId}/temporary-conversations`,
      payload: {
        purpose: "rewrite",
      },
    });
    expect(createResponse.statusCode, createResponse.body).toBe(201);
    const conversationId = String(createResponse.json<{ data: Record<string, unknown> }>().data.id);

    const streamResponse = await app.inject({
      method: "POST",
      url: `/temporary-conversations/${conversationId}/respond`,
      headers: {
        accept: "text/event-stream",
      },
      payload: {
        input_message: {
       role: "user",
          content: "Give me a short rewrite",
        },
      },
    });
    expect(streamResponse.statusCode, streamResponse.body).toBe(200);
    expect(streamResponse.headers["content-type"]).toContain("text/event-stream");
    expect(streamResponse.body).toContain("event: start");
    expect(streamResponse.body).toContain("event: chunk");
    expect(streamResponse.body).toContain("event: done");
    expect(streamResponse.body).toContain("reply:Give me a short rewrite");

    const exportResponse = await app.inject({
      method: "POST",
      url: `/temporary-conversations/${conversationId}/export`,
      payload: {
        target: "page_staged_write",
        target_page_id: targetPageId,
        reason: "assistant draft",
      },
    });
    expect(exportResponse.statusCode, exportResponse.body).toBe(200);
    const exported = exportResponse.json<{ data: Record<string, unknown> }>().data;
    expect(exported.target).toBe("page_staged_write");
    expect(exported.target_page_id).toBe(targetPageId);

    const stagedWrites = await database
      .select()
      .from(pageStagedWrites)
      .where(eq(pageStagedWrites.pageId, targetPageId));
    expect(stagedWrites).toHaveLength(1);
    expect(stagedWrites[0]).toMatchObject({
      pageId: targetPageId,
      sourceKind: "temporary_conversation",
      reason: "assistant draft",
      status: "staged",
      content: "reply:Give me a short rewrite",
    });
  });

  it("creates from project and lazily expires ttl conversations while keeping internal ones hidden", async () => {
    const projectId = await seedProject(database, "Project Temp");

    const createResponse = await app.inject({
      method: "POST",
      url: `/projects/${projectId}/temporary-conversations`,
      payload: {
        purpose:"analysis",
        retention_policy: "ttl",
        ttl_seconds: 60,
      },
    });
    expect(createResponse.statusCode, createResponse.body).toBe(201);
    const conversationId = String(createResponse.json<{ data: Record<string, unknown> }>().data.id);

    await database.update(sessions).set({
      expiresAt: Date.now() - 1,
    }).where(eq(sessions.id, conversationId));

    const detailResponse = await app.inject({
      method: "GET",
      url: `/temporary-conversations/${conversationId}`,
    });
    expect(detailResponse.statusCode, detailResponse.body).toBe(200);
    expect(detailResponse.json<{ data: Record<string, unknown> }>().data.status).toBe("expired");

    const writeAfterExpire = await app.inject({
      method: "POST",
      url: `/temporary-conversations/${conversationId}/messages`,
      payload: {
        role: "user",
        content: "late write",
      },
    });
    expect(writeAfterExpire.statusCode, writeAfterExpire.body).toBe(409);
    expect(writeAfterExpire.json<{ error: { code: string } }>().error.code).toBe("conversation_not_active");

    const internalConversation = await temporaryConversationService.create({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      sourceSessionId: await seedSession(database, { title: "Internal Source" }),
      purpose: "internal-only",
    });
    const hiddenResponse = await app.inject({
      method: "GET",
      url: `/temporary-conversations/${internalConversation.conversationId}`,
    });
    expect(hiddenResponse.statusCode, hiddenResponse.body).toBe(404);
    expect(hiddenResponse.json<{ error: { code: string } }>().error.code).toBe("conversation_not_found");
  });

  it("inspects a client-visible temporary conversation with transcript, exports, and cleanup state", async () => {
    const sourceSessionId = await seedSession(database, { title: "Inspect Source" });
    const targetSessionId = await seedSession(database, { title: "Inspect Target" });
    const targetPageId = await seedPageForSession(database, targetSessionId);

    const createResponse = await app.inject({
      method: "POST",
      url: `/sessions/${sourceSessionId}/temporary-conversations`,
      payload: { purpose: "inspect" },
    });
    expect(createResponse.statusCode, createResponse.body).toBe(201);
    const conversationId = String(createResponse.json<{ data: Record<string, unknown> }>().data.id);

    await app.inject({
      method: "POST",
      url: `/temporary-conversations/${conversationId}/respond`,
      payload: { input_message: { role: "user", content: "inspect me" } },
    });
    await app.inject({
      method: "POST",
      url: `/temporary-conversations/${conversationId}/export`,
      payload: { target: "page_staged_write", target_page_id: targetPageId, reason: "inspect export" },
    });

    const inspectResponse = await app.inject({
      method: "GET",
      url: `/temporary-conversations/${conversationId}/inspect`,
    });
    expect(inspectResponse.statusCode, inspectResponse.body).toBe(200);
    const inspect = inspectResponse.json<{
      data: {
        agent_private: boolean;
        transcript_restricted: boolean;
        source_snapshot: { source_session_id: string | null };
        cleanup: { cleaned: boolean; cleaned_at: number | null };
        transcript: { floors: Array<{ pages: Array<{ messages: Array<{ content: string | null; restricted: boolean }> }> }> };
        exports: Array<Record<string, unknown>>;
      };
    }>().data;

    expect(inspect.agent_private).toBe(false);
    expect(inspect.transcript_restricted).toBe(false);
    expect(inspect.source_snapshot.source_session_id).toBe(sourceSessionId);
    expect(inspect.cleanup.cleaned).toBe(false);
    expect(inspect.cleanup.cleaned_at).toBeNull();
    expect(inspect.transcript.floors[0]?.pages[0]?.messages[0]).toMatchObject({
      content: "inspect me",
      restricted: false,
    });
    expect(inspect.exports).toHaveLength(1);
    expect(inspect.exports[0]).toMatchObject({
      delivery_target: "page_staged_write",
      target_page_id: targetPageId,
      status: "staged",
    });
  });

  it("redacts agent-private transcript by default and reveals it with include_agent_private", async () => {
    const sourceSessionId = await seedSession(database, { title: "Agent Private Source" });
    const conversation = await temporaryConversationService.create({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      sourceSessionId,
      purpose: "agent-private",
    });
    await temporaryConversationService.appendMessage({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      conversationId: conversation.conversationId,
      role: "user",
      content: "agent private body",
    });

    const hiddenDetail = await app.inject({
      method: "GET",
      url: `/temporary-conversations/${conversation.conversationId}`,
    });
    expect(hiddenDetail.statusCode).toBe(404);

    const redacted = await app.inject({
      method: "GET",
      url: `/temporary-conversations/${conversation.conversationId}/inspect`,
    });
    expect(redacted.statusCode, redacted.body).toBe(200);
    const redactedData = redacted.json<{
      data: {
        agent_private: boolean;
        transcript_restricted: boolean;
        transcript: { floors: Array<{ pages: Array<{ messages: Array<{ content: string | null; restricted: boolean; content_length: number }> }> }> };
      };
    }>().data;
    expect(redactedData.agent_private).toBe(true);
    expect(redactedData.transcript_restricted).toBe(true);
    const redactedMessage = redactedData.transcript.floors[0]?.pages[0]?.messages[0];
    expect(redactedMessage?.content).toBeNull();
    expect(redactedMessage?.restricted).toBe(true);
    expect(redactedMessage?.content_length).toBeGreaterThan(0);

    const revealed = await app.inject({
      method: "GET",
      url: `/temporary-conversations/${conversation.conversationId}/inspect?include_agent_private=true`,
    });
    expect(revealed.statusCode, revealed.body).toBe(200);
    const revealedData = revealed.json<{
      data: {
        transcript_restricted: boolean;
        transcript: { floors: Array<{ pages: Array<{ messages: Array<{ content: string | null; restricted: boolean }> }> }> };
      };
    }>().data;
    expect(revealedData.transcript_restricted).toBe(false);
    expect(revealedData.transcript.floors[0]?.pages[0]?.messages[0]).toMatchObject({
      content: "agent private body",
      restricted: false,
    });
  });

    it("lists pending tool calls and resolves them via approve/reject routes", async () => {
    const { conversationId, scope } = await seedGraphAssistantConversation(app, database, "Pending Project");

    const confirmationService = new GraphAssistantToolConfirmationService(database);
    const approveRecord = confirmationService.createPending({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      conversationId,
      branchId: "main",
      floorId: "floor_pending",
      callId: "call_approve",
      toolName: "nodegraph.graph.create",
      args: { name: "demo" },
      sideEffectLevel: "sandbox",
      conversationMessages: [{ role: "user", content: "建图" }],
      agentSteps: 1,
    });
    const rejectRecord = confirmationService.createPending({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      conversationId,
      branchId: "main",
      floorId: "floor_pending",
      callId: "call_reject",
      toolName: "nodegraph.node.add",
      args: { id: "n1" },
      sideEffectLevel: "sandbox",
      conversationMessages: [{ role: "user", content: "加节点" }],
      agentSteps: 1,
    });

    const listResponse = await app.inject({
      method: "GET",
      url: `/temporary-conversations/${conversationId}/pending-tool-calls`,
    });
    expect(listResponse.statusCode, listResponse.body).toBe(200);
    const listed = listResponse.json<{ items: Array<{ id: string; tool_name: string; call_id: string }> }>().items;
    expect(listed.map((item) => item.call_id)).toEqual(["call_approve", "call_reject"]);

    const rejectResponse =await app.inject({
      method: "POST",
    url: `/temporary-conversations/${conversationId}/pending-tool-calls/${rejectRecord.id}`,
      payload: { decision: "reject" },
    });
    expect(rejectResponse.statusCode, rejectResponse.body).toBe(200);
    expect(rejectResponse.json<{ data: { decision: string } }>().data.decision).toBe("rejected");
    expect(confirmationService.getById(rejectRecord.id)?.status).toBe("rejected");

   const approveResponse = await app.inject({
      method: "POST",
      url: `/temporary-conversations/${conversationId}/pending-tool-calls/${approveRecord.id}`,
 payload: { decision: "approve" },
    });
    expect(approveResponse.statusCode, approveResponse.body).toBe(200);
    const approveData = approveResponse.json<{ data: { decision: string; result: { generated_text: string } } }>().data;
    expect(approveData.decision).toBe("approved");
    expect(approveData.result.generated_text).toContain("reply:");
    expect(confirmationService.getById(approveRecord.id)?.status).toBe("approved");
  });

  it("returns 404 for unknown pending tool call and 409 for already-resolved ones", async () => {
  const { conversationId, scope } = await seedGraphAssistantConversation(app, database, "Pending Error Project");

    const notFound = await app.inject({
      method: "POST",
      url: `/temporary-conversations/${conversationId}/pending-tool-calls/gaptc_missing`,
      payload: { decision: "approve" },
    });
    expect(notFound.statusCode, notFound.body).toBe(404);
    expect(notFound.json<{ error: { code: string } }>().error.code).toBe("pending_tool_call_not_found");

    const confirmationService = new GraphAssistantToolConfirmationService(database);
    const record = confirmationService.createPending({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      conversationId,
      branchId: "main",
        floorId: "floor_pending",
      callId: "call_done",
      toolName: "nodegraph.graph.create",
      args: {},
      sideEffectLevel: "sandbox",
      conversationMessages: [{ role: "user", content: "x" }],
      agentSteps: 1,
    });
    confirmationService.reject(record.id);

    const conflict = await app.inject({
      method: "POST",
      url: `/temporary-conversations/${conversationId}/pending-tool-calls/${record.id}`,
      payload: { decision: "approve" },
    });
    expect(conflict.statusCode, conflict.body).toBe(409);
    expect(conflict.json<{ error: { code: string } }>().error.code).toBe("pending_tool_call_not_pending");
  });

});

function createMockChatService(database: DatabaseConnection["db"]): ChatService {
  return {
    respondFromPreparedDraftFloor: vi.fn(async (input: {
      floorId: string;
      floorNo: number;
      branchId?: string;
      rawUserMessage: string;
      runtimeOptions?: {
        onStart?: (payload: { floorId: string; floorNo: number; branchId: string }) => void;
        onChunk?: (chunk: string) => void;
      };
    }) => {
      const now = Date.now();
      const outputPageId = nanoid();
      const assistantMessageId = nanoid();
      const generatedText = `reply:${input.rawUserMessage}`;

      input.runtimeOptions?.onStart?.({
        floorId: input.floorId,
        floorNo: input.floorNo,
        branchId: input.branchId ?? "main",
      });
      input.runtimeOptions?.onChunk?.(generatedText);

      await database.insert(messagePages).values({
        id: outputPageId,
        floorId: input.floorId,
        pageNo: 1,
        pageKind: "output",
        isActive: true,
        version: 1,
        checksum: null,
        createdAt: now,
        updatedAt: now,
      });
      await database.insert(messages).values({
        id: assistantMessageId,
        pageId: outputPageId,
        seq: 0,
        role: "assistant",
        content: generatedText,
        contentFormat: "text",
        tokenCount: generatedText.length,
        isHidden: false,
        source: "temporary_conversation",
        createdAt: now,
      });
      await database.update(floors).set({
        state: "committed",
        tokenIn: 12,
        tokenOut: 8,
        updatedAt: now,
      }).where(eq(floors.id, input.floorId));

      return {
        floorId: input.floorId,
        floorNo: input.floorNo,
        outputPageId,
        assistantMessageId,
        generatedText,
        summaries: [],
        totalUsage: {
          promptTokens: 12,
          completionTokens: 8,
          totalTokens: 20,
        },
        finalState: "committed",
      };
    }),
  } as unknown as ChatService;
}

/**
 * 创建一个挂在真实 project 作用域下的图助手临时对话。
 *
 * 待确认表的 workspace_id / project_id 带外键约束，所以需要真实的作用域 ID。
 * 返回会话 ID 与其作用域，供登记待确认记录使用。
 */
async function seedGraphAssistantConversation(
  app: FastifyInstance,
  database: DatabaseConnection["db"],
  name: string,
): Promise<{
  conversationId: string;
  scope: { workspaceId: string; projectId: string };
}> {
  const projectId = await seedProject(database, name);
  const projectRow = await database
    .select({ workspaceId: projects.workspaceId })
    .from(projects)
    .where(eq(projects.id, projectId));
  const workspaceId = String(projectRow[0]?.workspaceId);

  const createResponse = await app.inject({
    method: "POST",
    url: `/projects/${projectId}/temporary-conversations`,
    payload: {purpose: "graph-assistant" },
  });
  expect(createResponse.statusCode, createResponse.body).toBe(201);
  const conversationId = String(createResponse.json<{ data: Record<string, unknown> }>().data.id);

  return { conversationId, scope: { workspaceId,projectId } };
}

async function seedSession(
  db: DatabaseConnection["db"],
  input: {
       title: string;
    metadataJson?: string | null;
  },
): Promise<string> {
  const sessionId = nanoid();
  const now = Date.now();
  await db.insert(sessions).values({
    id: sessionId,
    accountId: DEFAULT_ADMIN_ACCOUNT_ID,
    title: input.title,
    status: "active",
    promptMode: "native",
    metadataJson: input.metadataJson ?? null,
    createdAt: now,
  updatedAt: now,
    lastActivityAt: now,
  });
  new SessionBranchRegistryService(db).ensure({
    accountId: DEFAULT_ADMIN_ACCOUNT_ID,
    sessionId,
    branchId: "main",
    sourceFloorId: null,
    sourceBranchId: "main",
    assetBinding: null,
    createdAt: now,
    updatedAt: now,
  });
  return sessionId;
}

async function seedPageForSession(
  db: DatabaseConnection["db"],
  sessionId: string,
): Promise<string> {
  const floorId =nanoid();
  const pageId = nanoid();
  const now = Date.now();
  await db.insert(floors).values({
    id: floorId,
    sessionId,
    floorNo: 1,
    branchId: "main",
    parentFloorId: null,
    state: "committed",
metadataJson: null,
    tokenIn: 0,
    tokenOut: 0,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(messagePages).values({
    id: pageId,
    floorId,
    pageNo: 0,
    pageKind: "mixed",
    isActive: true,
    version: 1,
    checksum: null,
    createdAt: now,
    updatedAt: now,
  });
  return pageId;
}

async function seedProject(db: DatabaseConnection["db"], name: string): Promise<string> {
  const workspaceId = nanoid();
  const projectId = nanoid();
  const now = Date.now();
  await db.insert(workspaces).values({
    id: workspaceId,
    accountId: DEFAULT_ADMIN_ACCOUNT_ID,
    name: `${name} Workspace`,
    kind: "default",
    isDefault: false,
    status: "active",
    settingsJson: "{}",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(projects).values({
    id: projectId,
    accountId: DEFAULT_ADMIN_ACCOUNT_ID,
    workspaceId,
    name,
    description: null,
    kind: "manual",
    status: "active",
    settingsOverrideJson: "{}",
    createdAt: now,
    updatedAt: now,
  });
  return projectId;
}
