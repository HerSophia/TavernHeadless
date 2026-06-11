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
