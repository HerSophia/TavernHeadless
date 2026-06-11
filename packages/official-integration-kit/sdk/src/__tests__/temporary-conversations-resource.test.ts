import { describe, expect, it, vi } from "vitest";

import { createTavernClient } from "../index.js";

const baseUrl = "http://localhost:3000";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

const temporaryConversationPayload = {
  id: "tmp-1",
  workspace_id: "ws-1",
  project_id: "proj-1",
  source_session_id: "sess-1",
  branch_id: "main",
  kind: "temporary",
  title: "Draft Session",
  purpose: "draft",
  status: "active",
  retention_policy: "delete_on_finalize",
  visibility: "client_visible",
  created_at: 10,
  updated_at: 11,
  last_activity_at: 11,
  expires_at: null,
  finalized_at: null,
  discarded_at: null,
  cancelled_at: null,
};

describe("sdk temporary conversation resources", () => {
  it("creates temporary conversations from sessions and projects", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: temporaryConversationPayload }, 201))
      .mockResolvedValueOnce(jsonResponse({ data: { ...temporaryConversationPayload, id: "tmp-2", source_session_id: null } }, 201));
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.sessions.createTemporaryConversation({
      accountId: "acc-1",
      sessionId: "sess-1",
      input: {
        purpose: "draft",
        retentionPolicy: "delete_on_finalize",
      },
    })).resolves.toMatchObject({
      id: "tmp-1",
      sourceSessionId: "sess-1",
      visibility: "client_visible",
    });

    await expect(client.projects.createTemporaryConversation({
      accountId: "acc-1",
      projectId: "proj-1",
      input: {
        purpose: "analysis",
        retentionPolicy: "ttl",
        ttlSeconds: 300,
      },
    })).resolves.toMatchObject({
      id: "tmp-2",
      sourceSessionId: null,
      retentionPolicy: "delete_on_finalize",
    });

    expect(String(fetchImpl.mock.calls[0]![0])).toBe("http://localhost:3000/sessions/sess-1/temporary-conversations");
    expect(fetchImpl.mock.calls[0]![1]?.body).toBe(JSON.stringify({
      purpose: "draft",
      retention_policy: "delete_on_finalize",
    }));
    expect(String(fetchImpl.mock.calls[1]![0])).toBe("http://localhost:3000/projects/proj-1/temporary-conversations");
    expect(fetchImpl.mock.calls[1]![1]?.body).toBe(JSON.stringify({
      purpose: "analysis",
      retention_policy: "ttl",
      ttl_seconds: 300,
    }));
  });

  it("maps lifecycle, transcript, export, and stream operations", async () => {
    const stream = [
      "event: start\n",
      'data: {"branch_id":"main","floor_id":"floor-1","floor_no":2}\n\n',
      "event: chunk\n",
      'data: {"chunk":"reply:hello"}\n\n',
      "event: done\n",
      'data: {"conversation_id":"tmp-1","branch_id":"main","floor_id":"floor-1","floor_no":2,"page_id":"page-out-1","generated_text":"reply:hello","summaries":[],"total_usage":{"prompt_tokens":12,"completion_tokens":8,"total_tokens":20},"final_state":"committed"}\n\n',
    ].join("");

    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          conversation_id: "tmp-1",
          floor_id: "floor-1",
          page_id: "page-in-1",
          message_id: "msg-1",
          seq: 0,
          role: "user",
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          conversation_id: "tmp-1",
          branch_id: "main",
          floor_id: "floor-1",
          floor_no: 2,
          page_id: "page-out-1",
          generated_text: "reply:hello",
          total_usage: {
            prompt_tokens: 12,
            completion_tokens: 8,
            total_tokens: 20,
          },
          final_state: "committed",
        },
      }))
      .mockResolvedValueOnce(new Response(stream, {
        headers: { "content-type": "text/event-stream" },
        status: 200,
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          conversation_id: "tmp-1",
          branch_id: "main",
          floors: [
            {
              id: "floor-1",
              floor_no: 2,
              branch_id: "main",
              parent_floor_id: null,
              state: "committed",
              token_in: 12,
              token_out: 8,
              created_at: 10,
              updated_at: 20,
              pages: [
                {
                  id: "page-out-1",
                  page_no: 1,
                  page_kind: "output",
                  is_active: true,
                  version: 1,
                  checksum: null,
                  created_at: 10,
                  updated_at: 20,
                  messages: [
                    {
                      id: "msg-2",
                      seq: 0,
                      role: "assistant",
                      content: "reply:hello",
                      content_format: "text",
                      is_hidden: false,
                      source: "temporary_conversation",
                      created_at: 20,
                    },
                  ],
                },
              ],
            },
          ],
        },
      }))
      .mockResolvedValueOnce(jsonResponse({ data: { ...temporaryConversationPayload, status: "finalized", finalized_at: 30 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { ...temporaryConversationPayload, status: "discarded", discarded_at: 31 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { ...temporaryConversationPayload, status: "cancelled", cancelled_at: 32 } }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          conversation_id: "tmp-1",
          target: "page_staged_write",
          staged_write_id: "stage-1",
          target_page_id: "page-target-1",
          source_page_id: "page-out-1",
          created_at: 40,
          status: "staged",
        },
      }));
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.temporaryConversations.appendMessage({
      accountId: "acc-1",
      conversationId: "tmp-1",
      role: "user",
      content: "hello",
    })).resolves.toMatchObject({
      conversationId: "tmp-1",
      messageId: "msg-1",
      pageId: "page-in-1",
    });

    await expect(client.temporaryConversations.respond({
      accountId: "acc-1",
      conversationId: "tmp-1",
      inputMessage: {
        role: "user",
        content: "hello",
      },
    })).resolves.toMatchObject({
      conversationId: "tmp-1",
      pageId: "page-out-1",
      generatedText: "reply:hello",
      totalTokens: 20,
    });

    const chunks: string[] = [];
    await expect(client.temporaryConversations.respondStream({
      accountId: "acc-1",
      conversationId: "tmp-1",
      inputMessage: {
        role: "user",
        content: "hello",
      },
      onChunk: (payload) => chunks.push(payload.chunk),
    })).resolves.toMatchObject({
      conversationId: "tmp-1",
      pageId: "page-out-1",
      generatedText: "reply:hello",
      totalTokens: 20,
    });
    expect(chunks).toEqual(["reply:hello"]);

    await expect(client.temporaryConversations.getTranscript({
      accountId: "acc-1",
      conversationId: "tmp-1",
    })).resolves.toMatchObject({
      conversationId: "tmp-1",
      floors: [
        {
          id: "floor-1",
          pages: [
            {
              id: "page-out-1",
              messages: [
                { content: "reply:hello" },
              ],
            },
          ],
        },
      ],
    });

    await expect(client.temporaryConversations.finalize({ accountId: "acc-1", conversationId: "tmp-1" }))
      .resolves.toMatchObject({ status: "finalized", finalizedAt: 30 });
    await expect(client.temporaryConversations.discard({ accountId: "acc-1", conversationId: "tmp-1" }))
      .resolves.toMatchObject({ status: "discarded", discardedAt: 31 });
    await expect(client.temporaryConversations.cancel({ accountId: "acc-1", conversationId: "tmp-1" }))
      .resolves.toMatchObject({ status: "cancelled", cancelledAt: 32 });
    await expect(client.temporaryConversations.exportToPageStagedWrite({
      accountId: "acc-1",
      conversationId: "tmp-1",
      targetPageId: "page-target-1",
      sourceOutputPageId: "page-out-1",
      reason: "assistant draft",
    })).resolves.toEqual({
      conversationId: "tmp-1",
      target: "page_staged_write",
      stagedWriteId: "stage-1",
      targetPageId: "page-target-1",
      sourcePageId: "page-out-1",
      createdAt: 40,
      status: "staged",
    });

    expect(fetchImpl.mock.calls[0]![1]?.body).toBe(JSON.stringify({ role: "user", content: "hello" }));
    expect(fetchImpl.mock.calls[1]![1]?.body).toBe(JSON.stringify({ input_message: { role: "user", content: "hello" } }));
    expect(fetchImpl.mock.calls[2]![1]?.headers).toBeDefined();
    expect(fetchImpl.mock.calls[7]![1]?.body).toBe(JSON.stringify({
      target: "page_staged_write",
      target_page_id: "page-target-1",
      source_output_page_id: "page-out-1",
      reason: "assistant draft",
    }));
  });
});
