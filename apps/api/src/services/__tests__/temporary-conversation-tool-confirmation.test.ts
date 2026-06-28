import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid }from "nanoid";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { createTestSessionWithScope } from "../../__tests__/helpers/workspace-project.js";
import { floors, messagePages, messages } from "../../db/schema.js";
import type { ChatService } from "../chat/chat-service.js";
import { GraphAssistantToolConfirmationService } from "../graph-assistant-tool-confirmation-service.js";
import { TemporaryConversationError } from "../temporary-conversation-errors.js";
import { TemporaryConversationService } from "../temporary-conversation-service.js";

const ACCOUNT_ID = "tctc-owner";

/**
 * 模拟 ChatService：把 draft 楼层直接提交为 committed，并写入一条 assistant 输出。
 *
 * 与临时对话集成测试保持同一行为，便于校验 approve 续跑会驱动既有 respond 管线。
 */
function createMockChatService(db: DatabaseConnection["db"]): {
chatService:ChatService;
  respond: ReturnType<typeof vi.fn>;
} {
  const respond = vi.fn(async (input: {
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

    await db.insert(messagePages).values({
      id: outputPageId,
      floorId: input.floorId,
      pageNo: 1,
      pageKind: "output",
      isActive: true,
      version:1,
      checksum: null,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(messages).values({
      id: assistantMessageId,
      pageId: outputPageId,
     seq: 0,
      role: "assistant",
      content: generatedText,
      contentFormat: "text",
      tokenCount: generatedText.length,
      isHidden:false,
      source: "temporary_conversation",
      createdAt: now,
    });
    await db.update(floors).set({
      state: "committed",
      tokenIn: 12,
      tokenOut: 8,
      updatedAt: now,
    }).where(eq(floors.id,input.floorId));

    return {
      floorId: input.floorId,
      floorNo: input.floorNo,
      outputPageId,
      assistantMessageId,
      generatedText,
 summaries: [],
      totalUsage: { promptTokens: 12, completionTokens: 8, totalTokens: 20 },
      finalState: "committed",
    };
  });

  return { chatService: { respondFromPreparedDraftFloor: respond } as unknown as ChatService, respond };
}

describe("TemporaryConversationService graph-assistant tool confirmation", () => {
  let database: DatabaseConnection;
  let service: TemporaryConversationService;
  let confirmationService: GraphAssistantToolConfirmationService;
  let respond: ReturnType<typeof vi.fn>;
  let scope: { accountId: string; workspaceId: string; projectId: string; sessionId: string };

  beforeEach(() => {
    database = createDatabase(":memory:");
    scope = createTestSessionWithScope(database.db, {
      accountId: ACCOUNT_ID,
      id: "sess_tctc",
      values: { kind: "temporary", purpose: "graph-assistant", status: "active" },
    });
    const mock = createMockChatService(database.db);
 respond = mock.respond;
    service = new TemporaryConversationService(database.db, mock.chatService);
    confirmationService = new GraphAssistantToolConfirmationService(database.db);
  });

  afterEach(() => {
    database.close();
  });

  function seedPending(callId = "call_1") {
    return confirmationService.createPending({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      accountId: scope.accountId,
      conversationId: scope.sessionId,
      branchId: "main",
      floorId: "floor_1",
      callId,
      toolName: "nodegraph.graph.create",
      args: { name: "demo" },
      sideEffectLevel: "sandbox",
      conversationMessages: [
        { role: "user", content: "建一张图" },
        { role: "assistant", content: "<tool_call>...</tool_call>" },
      ],
      agentSteps: 1,
    });
  }

  it("listPendingToolCalls returns pending records for the conversation", async () =>{
    seedPending("call_a");
seedPending("call_b");

    const pending = await service.listPendingToolCalls({
      accountId: ACCOUNT_ID,
      conversationId: scope.sessionId,
    });
    expect(pending.map((row) => row.callId)).toEqual(["call_a", "call_b"]);
  });

  it("reject marks the record rejected, injects a transcript messageand doesnot resume", async () => {
    const record = seedPending();

  const result = await service.resolveToolConfirmation({
      accountId: ACCOUNT_ID,
      conversationId: scope.sessionId,
      confirmationId: record.id,
      decision: "reject",
    });

    expect(result.decision).toBe("rejected");
    expect(confirmationService.getById(record.id)?.status).toBe("rejected");
    expect(respond).not.toHaveBeenCalled();

    // 拒绝说明消息已落入 transcript。
    const transcript = await service.readTranscript({
      accountId: ACCOUNT_ID,
      conversationId: scope.sessionId,
    });
    const allMessages = transcript.floors.flatMap((floor) =>
      floor.pages.flatMap((page) => page.messages),
    );
    expect(allMessages.some((message) =>
      message.role === "system" && message.content.includes("nodegraph.graph.create"),
    )).toBe(true);
});

  it("approve marks the record approved and drives a resume respond", async () => {
    const record = seedPending();

    const result = await service.resolveToolConfirmation({
      accountId: ACCOUNT_ID,
conversationId: scope.sessionId,
      confirmationId: record.id,
      decision: "approve",
    });

    expect(result.decision).toBe("approved");
    expect(confirmationService.getById(record.id)?.status).toBe("approved");
    expect(respond).toHaveBeenCalledTimes(1);
 if (result.decision === "approved") {
      expect(result.result.text).toContain("reply:");
    }
  });

  it("throws not_found for an unknown confirmation id", async () => {
    await expect(service.resolveToolConfirmation({
      accountId: ACCOUNT_ID,
      conversationId: scope.sessionId,
      confirmationId: "gaptc_missing",
      decision: "approve",
    })).rejects.toMatchObject({ code: "pending_tool_call_not_found" });
  });

  it("throws not_pending when the record was already resolved", async () => {
    const record = seedPending();
    confirmationService.reject(record.id);

    await expect(service.resolveToolConfirmation({
      accountId: ACCOUNT_ID,
      conversationId: scope.sessionId,
      confirmationId: record.id,
      decision: "approve",
    })).rejects.toBeInstanceOf(TemporaryConversationError);
  });
});
