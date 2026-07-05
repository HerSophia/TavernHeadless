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

  it("surfaces the awaiting_confirmation tool phase with call id and args", async () => {
    // 图助手在 confirm 工具执行前暂停：发一条 awaiting_confirmation 工具事件（携带 call_id / args），
    // 已生成的可见文本仍照常提交，故 done 的 final_state 仍是 "committed"（暂停由 pending 列表探测）。
    const stream = [
      "event: start\n",
      'data: {"branch_id":"main","floor_id":"floor-1","floor_no":2}\n\n',
      "event: tool\n",
      'data: {"execution_id":"call-9","tool_name":"nodegraph.graph.create","provider_id":"","phase":"awaiting_confirmation","replay_safety":"confirm_on_replay","side_effect_level":"irreversible","call_id":"call-9","args":{"name":"New Graph"}}\n\n',
      "event: done\n",
      'data: {"conversation_id":"tmp-1","branch_id":"main","floor_id":"floor-1","floor_no":2,"page_id":"page-out-1","generated_text":"","summaries":[],"total_usage":{"prompt_tokens":1,"completion_tokens":0,"total_tokens":1},"final_state":"committed"}\n\n',
    ].join("");

    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(stream, { headers: { "content-type": "text/event-stream" }, status: 200 }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    const toolEvents: Array<{ phase: string; callId?: string; args?: Record<string, unknown> }> = [];
    await expect(client.temporaryConversations.respondStream({
      accountId: "acc-1",
      conversationId: "tmp-1",
      inputMessage: { role: "user", content: "create a graph" },
      onTool: (payload) => toolEvents.push({ phase: payload.phase, callId: payload.callId, args: payload.args }),
    })).resolves.toMatchObject({
      conversationId: "tmp-1",
      finalState: "committed",
    });

    expect(toolEvents).toEqual([
      { phase: "awaiting_confirmation", callId: "call-9", args: { name: "New Graph" } },
    ]);
  });

  it("maps the inspect view and forwards include_agent_private", async () => {
    const inspectPayload = {
      conversation: { ...temporaryConversationPayload, status: "finalized", finalized_at: 50, cleaned_at: null },
      agent_private: true,
      transcript_restricted: false,
      source_snapshot: { digest: "sha256:abc", source_session_id: "sess-1" },
      agent_origin: { source_agent_run_id: "run-1", source_attempt_no: 2 },
      cleanup: { cleaned: false, cleaned_at: null, retention_policy: "delete_on_finalize" },
      transcript: {
        conversation_id: "tmp-1",
        branch_id: "main",
        floors: [
          {
            id: "floor-1",
            floor_no: 1,
            branch_id: "main",
            parent_floor_id: null,
            state: "committed",
            token_in: 0,
            token_out: 0,
            created_at: 10,
            updated_at: 11,
            pages: [
              {
                id: "page-1",
                page_no: 0,
                page_kind: "mixed",
                is_active: true,
                version: 1,
                checksum: null,
                created_at: 10,
                updated_at: 11,
                messages: [
                  {
                    id: "msg-1",
                    seq: 0,
                    role: "user",
                    content: "agent body",
                    content_length: 10,
                    content_format: "text",
                    is_hidden: false,
                    source: null,
                    restricted: false,
                    created_at: 10,
                  },
                ],
              },
            ],
          },
        ],
      },
      exports: [
        {
          staged_write_id: "stage-1",
          delivery_target: "page_staged_write",
          target_session_id: "sess-main",
          target_page_id: "page-target-1",
          source_page_id: "page-out-1",
          status: "staged",
          reason: "draft",
          created_at: 40,
          updated_at: 41,
          applied_at: null,
          discarded_at: null,
        },
      ],
    };

    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({ data: inspectPayload }));
    const client = createTavernClient({ baseUrl, fetchImpl });

    const inspect = await client.temporaryConversations.inspect({
      accountId: "acc-1",
      conversationId: "tmp-1",
      includeAgentPrivate: true,
    });

    expect(inspect.agentPrivate).toBe(true);
    expect(inspect.transcriptRestricted).toBe(false);
    expect(inspect.sourceSnapshot).toEqual({ digest: "sha256:abc", sourceSessionId: "sess-1" });
    expect(inspect.agentOrigin).toEqual({ sourceAgentRunId: "run-1", sourceAttemptNo: 2 });
    expect(inspect.cleanup).toEqual({ cleaned: false, cleanedAt: null, retentionPolicy: "delete_on_finalize" });
    expect(inspect.conversation.cleanedAt).toBeNull();
    expect(inspect.transcript.floors[0]?.pages[0]?.messages[0]).toMatchObject({
      content: "agent body",
      contentLength: 10,
      restricted: false,
    });
    expect(inspect.exports).toEqual([
      {
        stagedWriteId: "stage-1",
        deliveryTarget: "page_staged_write",
        targetSessionId: "sess-main",
        targetPageId: "page-target-1",
        sourcePageId: "page-out-1",
        status: "staged",
        reason: "draft",
        createdAt: 40,
        updatedAt: 41,
        appliedAt: null,
        discardedAt: null,
      },
    ]);

    expect(String(fetchImpl.mock.calls[0]![0])).toBe(
      "http://localhost:3000/temporary-conversations/tmp-1/inspect?include_agent_private=true",
    );
  });

  it("maps tool_executions on inspect floors, forwards null redaction fields, and normalizes missing arrays to []", async () => {
    const inspectPayload = {
      conversation: { ...temporaryConversationPayload, cleaned_at: null },
      agent_private: true,
      transcript_restricted: true,
      source_snapshot: { digest: null, source_session_id: null },
      agent_origin: null,
      cleanup: { cleaned: false, cleaned_at: null, retention_policy: "delete_on_finalize" },
      transcript: {
        conversation_id: "tmp-1",
        branch_id: "main",
        floors: [
          {
            id: "floor-1",
            floor_no: 1,
            branch_id: "main",
            parent_floor_id: null,
            state: "committed",
            token_in: 0,
            token_out: 0,
            created_at: 10,
            updated_at: 11,
            step_narrations: [],
            tool_executions: [
              {
                // 受限（agent-private）：service 已将 args / result / error_message 脱敏为 null，SDK 只透传。
                id: "exec-1",
                tool_name: "search_memory",
                status: "success",
                args: null,
                result: null,
                side_effect_level: "none",
                commit_outcome: "committed",
                error_message: null,
                duration_ms: 12,
                started_at: 100,
                finished_at: 112,
                attempt_no: 1,
                replay_parent_execution_id: null,
                generation_step_no: 3,
              },
              {
                // 非受限形态：args / result 已解析，旧数据 generation_step_no 为 null。
                id: "exec-2",
                tool_name: "write_note",
                status: "error",
                args: { text: "note" },
                result: { ok: false },
                side_effect_level: "sandbox",
                commit_outcome: "discarded",
                error_message: "boom",
                duration_ms: 5,
                started_at: 120,
                finished_at: null,
                attempt_no: 2,
                replay_parent_execution_id: "exec-1",
                generation_step_no: null,
              },
            ],
            pages: [],
          },
          {
            id: "floor-2",
            floor_no: 2,
            branch_id: "main",
            parent_floor_id: "floor-1",
            state: "committed",
            token_in: 0,
            token_out: 0,
            created_at: 20,
            updated_at: 21,
            step_narrations: [],
            // 故意不带 tool_executions：应归一为空数组。
            pages: [],
          },
        ],
      },
      exports: [],
    };

    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({ data: inspectPayload }));
    const client = createTavernClient({ baseUrl, fetchImpl });

    const inspect = await client.temporaryConversations.inspect({
      accountId: "acc-1",
      conversationId: "tmp-1",
    });

    expect(inspect.transcript.floors[0]?.toolExecutions).toEqual([
      {
        id: "exec-1",
        toolName: "search_memory",
        status: "success",
        args: null,
        result: null,
        sideEffectLevel: "none",
        commitOutcome: "committed",
        errorMessage: null,
        durationMs: 12,
        startedAt: 100,
        finishedAt: 112,
        attemptNo: 1,
        replayParentExecutionId: null,
        generationStepNo: 3,
      },
      {
        id: "exec-2",
        toolName: "write_note",
        status: "error",
        args: { text: "note" },
        result: { ok: false },
        sideEffectLevel: "sandbox",
        commitOutcome: "discarded",
        errorMessage: "boom",
        durationMs: 5,
        startedAt: 120,
        finishedAt: null,
        attemptNo: 2,
        replayParentExecutionId: "exec-1",
        generationStepNo: null,
      },
    ]);
    // 缺 tool_executions 的楼层归一为空数组。
    expect(inspect.transcript.floors[1]?.toolExecutions).toEqual([]);
  });

  it("streams reasoning deltas, forwards reasoning_effort, and maps reasoning_text on floors", async () => {
    const stream = [
      "event: start\n",
      'data: {"branch_id":"main","floor_id":"floor-1","floor_no":2}\n\n',
      "event: reasoning\n",
      'data: {"delta":"think:"}\n\n',
      "event: reasoning\n",
      'data: {"delta":"hello"}\n\n',
      "event: chunk\n",
      'data: {"chunk":"reply:hello"}\n\n',
      "event: done\n",
      'data: {"conversation_id":"tmp-1","branch_id":"main","floor_id":"floor-1","floor_no":2,"page_id":"page-out-1","generated_text":"reply:hello","summaries":[],"total_usage":{"prompt_tokens":12,"completion_tokens":8,"total_tokens":20},"final_state":"committed"}\n\n',
    ].join("");

    const fetchImpl = vi.fn<typeof fetch>()
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
              reasoning_text: "think:hello",
              pages: [],
            },
          ],
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          conversation: { ...temporaryConversationPayload, status: "finalized", finalized_at: 50, cleaned_at: null },
          agent_private: true,
          transcript_restricted: true,
          source_snapshot: { digest: null, source_session_id: "sess-1" },
          agent_origin: null,
          cleanup: { cleaned: false, cleaned_at: null, retention_policy: "delete_on_finalize" },
          transcript: {
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
                reasoning_text: null,
                pages: [],
              },
            ],
          },
          exports: [],
        },
      }));
    const client = createTavernClient({ baseUrl, fetchImpl });

    const reasoningDeltas: string[] = [];
    await expect(client.temporaryConversations.respondStream({
      accountId: "acc-1",
      conversationId: "tmp-1",
      inputMessage: { role: "user", content: "hello" },
      generationParams: { reasoningEffort: "high" },
      onReasoning: (payload) => reasoningDeltas.push(payload.delta),
    })).resolves.toMatchObject({ conversationId: "tmp-1", generatedText: "reply:hello" });
    expect(reasoningDeltas).toEqual(["think:", "hello"]);
    expect(fetchImpl.mock.calls[0]![1]?.body).toBe(JSON.stringify({
      input_message: { role: "user", content: "hello" },
      generation_params: { reasoning_effort: "high" },
    }));

    const transcript = await client.temporaryConversations.getTranscript({
      accountId: "acc-1",
      conversationId: "tmp-1",
    });
    expect(transcript.floors[0]?.reasoningText).toBe("think:hello");

    const inspect = await client.temporaryConversations.inspect({
      accountId: "acc-1",
      conversationId: "tmp-1",
    });
    expect(inspect.transcript.floors[0]?.reasoningText).toBeNull();
  });
  it("streams step_narration events and maps them to camelCase onStepNarration payloads", async () => {
    const stream = [
      "event: start\n",
      'data: {"branch_id":"main","floor_id":"floor-1","floor_no":2}\n\n',
      "event: step_narration\n",
      'data: {"step_index":0,"text":"first step narration","created_at":111}\n\n',
      "event: step_narration\n",
      'data: {"step_index":1,"text":"second step narration","created_at":222}\n\n',
   "event: chunk\n",
      'data: {"chunk":"reply:hello"}\n\n',
      "event: done\n",
      'data: {"conversation_id":"tmp-1","branch_id":"main","floor_id":"floor-1","floor_no":2,"page_id":"page-out-1","generated_text":"reply:hello","summaries":[],"total_usage":{"prompt_tokens":12,"completion_tokens":8,"total_tokens":20},"final_state":"committed"}\n\n',
    ].join("");

    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(stream, {
        headers: { "content-type": "text/event-stream" },
        status: 200,
      }),
    );
    const client = createTavernClient({ baseUrl, fetchImpl });

    const narrations: { stepIndex: number; text: string; createdAt: number }[] = [];
    await expect(
      client.temporaryConversations.respondStream({
        accountId: "acc-1",
        conversationId: "tmp-1",
        inputMessage: { role: "user", content: "hello" },
        onStepNarration: (payload) => narrations.push(payload),
      }),
    ).resolves.toMatchObject({ conversationId: "tmp-1", generatedText: "reply:hello" });
    expect(narrations).toEqual([
      { stepIndex: 0, text: "first step narration", createdAt: 111 },
      { stepIndex: 1, text: "second step narration", createdAt: 222 },
    ]);
  });


  it("forwards the full generation params set as snake_case generation_params", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({
      data: {
        conversation_id: "tmp-1",
        branch_id: "main",
        floor_id: "floor-1",
        floor_no: 2,
        page_id: "page-out-1",
        generated_text: "reply:hello",
        summaries: [],
        total_usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
        final_state: "committed",
      },
    }));
    const client = createTavernClient({ baseUrl, fetchImpl });

    await client.temporaryConversations.respond({
      accountId: "acc-1",
      conversationId: "tmp-1",
      inputMessage: { role: "user", content: "hello" },
      generationParams: {
        reasoningEffort: "xhigh",
        temperature: 1,
        topP: 0.5,
        maxOutputTokens: 8192,
        maxContextTokens: 300000,
      },
    });

    expect(fetchImpl.mock.calls[0]![1]?.body).toBe(JSON.stringify({
      input_message: { role: "user", content: "hello" },
      generation_params: {
   reasoning_effort: "xhigh",
        temperature: 1,
        top_p:0.5,
        max_output_tokens: 8192,
               max_context_tokens: 300000,
      },
    }));
  });

  it("forwards tool_transport_preference as snake_case when provided", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({
      data: {
        conversation_id: "tmp-1",
        branch_id: "main",
        floor_id: "floor-1",
        floor_no: 2,
        page_id: "page-out-1",
        generated_text: "reply:hello",
        summaries: [],
        total_usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
        final_state: "committed",
      },
    }));
    const client = createTavernClient({ baseUrl, fetchImpl });

    await client.temporaryConversations.respond({
      accountId: "acc-1",
      conversationId: "tmp-1",
      inputMessage: { role: "user", content: "hello" },
      toolTransportPreference: "native",
    });

    expect(fetchImpl.mock.calls[0]![1]?.body).toBe(JSON.stringify({
      input_message: { role: "user", content: "hello" },
      tool_transport_preference: "native",
    }));
  });

  it("omits tool_transport_preference when not provided", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({
      data: {
        conversation_id: "tmp-1",
   branch_id: "main",
        floor_id: "floor-1",
        floor_no: 2,
        page_id: "page-out-1",
        generated_text: "reply:hello",
        summaries: [],
        total_usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
        final_state: "committed",
      },
    }));
    const client = createTavernClient({ baseUrl, fetchImpl });

    await client.temporaryConversations.respond({
      accountId: "acc-1",
      conversationId: "tmp-1",
      inputMessage: {role: "user", content: "hello" },
    });

    expect(fetchImpl.mock.calls[0]![1]?.body).toBe(JSON.stringify({
      input_message: { role: "user", content: "hello" },
    }));
  });
  it("retries a temporary conversation floor (open a new output page version)", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({
      data: {
        conversation_id: "tmp-1",
        branch_id: "main",
        floor_id: "floor-1",
        floor_no: 2,
        page_id: "page-out-2",
        generated_text: "reply:retry",
        total_usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        final_state: "committed",
      },
    }));
    const client = createTavernClient({baseUrl, fetchImpl });

    await expect(client.temporaryConversations.retry({
      accountId: "acc-1",
      conversationId: "tmp-1",
      floorId: "floor-1",
      dynamicContext: "ctx",
      generationParams: { temperature: 0.4 },
    })).resolves.toMatchObject({
      conversationId: "tmp-1",
      pageId: "page-out-2",
      generatedText: "reply:retry",
      totalTokens: 8,
    });

    expect(String(fetchImpl.mock.calls[0]![0])).toBe("http://localhost:3000/temporary-conversations/tmp-1/retry");
    expect(fetchImpl.mock.calls[0]![1]?.body).toBe(JSON.stringify({
      floor_id: "floor-1",
      dynamic_context: "ctx",
      generation_params: { temperature: 0.4 },
    }));
  });

  it("retries from a step and maps discarded index plus irreversible side effects", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({
      data: {
        conversation_id: "tmp-1",
        branch_id: "main",
        floor_id: "floor-1",
        floor_no: 2,
        page_id: "page-out-3",
        generated_text: "reply:step",
        total_usage: { prompt_tokens: 6, completion_tokens: 4, total_tokens: 10 },
        final_state: "committed",
        discarded_from_step_index: 3,
        irreversible_side_effects: [
          {
            execution_id: "exec-1",
            tool_name: "write_file",
            side_effect_level: "irreversible",
            started_at: 100,
            generation_step_no: 2,
          },
        ],
      },
    }));
    const client = createTavernClient({ baseUrl, fetchImpl });

    await expect(client.temporaryConversations.retryStep({
      accountId: "acc-1",
      conversationId: "tmp-1",
      floorId: "floor-1",
      fromStepIndex: 3,
      confirmedExecutionIds: ["exec-9"],
    })).resolves.toMatchObject({
      conversationId: "tmp-1",
      pageId: "page-out-3",
      discardedFromStepIndex: 3,
      irreversibleSideEffects: [
        {
          executionId: "exec-1",
          toolName: "write_file",
          sideEffectLevel: "irreversible",
          startedAt: 100,
          generationStepNo: 2,
        },
      ],
    });

    expect(String(fetchImpl.mock.calls[0]![0])).toBe("http://localhost:3000/temporary-conversations/tmp-1/retry-step");
    expect(fetchImpl.mock.calls[0]![1]?.body).toBe(JSON.stringify({
      floor_id: "floor-1",
      from_step_index: 3,
      confirmed_execution_ids: ["exec-9"],
    }));
  });

  it("streams a step retry and surfaces retry-step fields from the done event", async () => {
    const stream = [
      "event: start\n",
      'data: {"branch_id":"main","floor_id":"floor-1","floor_no":2}\n\n',
      "event: chunk\n",
      'data: {"chunk":"reply:step"}\n\n',
      "event: done\n",
      'data: {"conversation_id":"tmp-1","branch_id":"main","floor_id":"floor-1","floor_no":2,"page_id":"page-out-3","generated_text":"reply:step","summaries":[],"total_usage":{"prompt_tokens":6,"completion_tokens":4,"total_tokens":10},"final_state":"committed","discarded_from_step_index":3,"irreversible_side_effects":[{"execution_id":"exec-1","tool_name":"write_file","side_effect_level":"irreversible","started_at":100,"generation_step_no":2}]}\n\n',
    ].join("");
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(stream, {
      headers: { "content-type": "text/event-stream" },
      status: 200,
    }));
    const client = createTavernClient({ baseUrl, fetchImpl });

    const chunks: string[]= [];
    await expect(client.temporaryConversations.retryStepStream({
      accountId: "acc-1",
      conversationId: "tmp-1",
      floorId: "floor-1",
      fromStepIndex: 3,
      onChunk: (payload) => chunks.push(payload.chunk),
    })).resolves.toMatchObject({
      conversationId: "tmp-1",
      pageId: "page-out-3",
      discardedFromStepIndex: 3,
      irreversibleSideEffects: [
        {
          executionId: "exec-1",
          toolName: "write_file",
          generationStepNo: 2,
        },
      ],
    });
    expect(chunks).toEqual(["reply:step"]);
  });



});
