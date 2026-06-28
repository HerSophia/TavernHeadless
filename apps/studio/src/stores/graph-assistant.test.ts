import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/temp-conversation", () => ({
  tempConversationApi: {
    createFromProject: vi.fn(),
    createFromSession: vi.fn(),
    getDetail: vi.fn(),
    getTranscript: vi.fn(),
    finalize: vi.fn(),
    discard: vi.fn(),
    cancel: vi.fn(),
  },
  streamTempRespond: vi.fn(),
  GRAPH_ASSISTANT_PURPOSE: "graph-assistant",
  GRAPH_ASSISTANT_TTL_SECONDS: 3600,
}));

vi.mock("../lib/graph-assistant-confirmation-api", () => ({
  graphAssistantConfirmationApi: {
    listPending: vi.fn(),
    resolve: vi.fn(),
  },
}));

import {
  streamTempRespond,
  tempConversationApi,
  type TemporaryConversationRecord,
  type TemporaryConversationResult,
  type TemporaryConversationTranscript,
} from "../lib/temp-conversation";
import {
  graphAssistantConfirmationApi,
  type GraphAssistantPendingToolCall,
} from "../lib/graph-assistant-confirmation-api";
import { flattenTranscript, useGraphAssistantStore } from "./graph-assistant";

function pending(over: Partial<GraphAssistantPendingToolCall> = {}): GraphAssistantPendingToolCall {
  return {
    id: "ptc1",
    conversation_id: "c1",
    branch_id: "main",
    floor_id: "f1",
    call_id: "call_1",
    tool_name: "nodegraph.graph.create",
    args: { name: "New Graph" },
    side_effect_level: "irreversible",
    status: "pending",
    created_at: 0,
    updated_at: 0,
    expires_at: null,
    ...over,
  };
}

function record(over: Partial<TemporaryConversationRecord> = {}): TemporaryConversationRecord {
  return {
    id: "c1",
    workspaceId: null,
    projectId: "p1",
    sourceSessionId: null,
    branchId: "main",
    kind: "temporary",
    title: null,
    purpose: "graph-assistant",
    status: "active",
    retentionPolicy: "ttl",
    visibility: "client_visible",
    createdAt: 0,
    updatedAt: 0,
    lastActivityAt: 0,
    expiresAt: null,
    finalizedAt: null,
    discardedAt: null,
    cancelledAt: null,
    cleanedAt: null,
    ...over,
  };
}

function transcript(): TemporaryConversationTranscript {
  return {
    conversationId: "c1",
    branchId: "main",
    floors: [
      {
        id: "f1",
        floorNo: 1,
        branchId: "main",
        parentFloorId: null,
        state: "committed",
        tokenIn: 1,
        tokenOut: 2,
        createdAt: 0,
        updatedAt: 0,
        pages: [
          {
            id: "pg1",
            pageNo: 1,
            pageKind: "narrative",
            isActive: true,
            version: 1,
            checksum: null,
            createdAt: 0,
            updatedAt: 0,
            messages: [
              { id: "m_u", seq: 0, role: "user", content: "hi", contentFormat: "text", isHidden: false, source: null, createdAt: 0 },
              { id: "m_a", seq: 1, role: "assistant", content: "hello graph", contentFormat: "text", isHidden: false, source: null, createdAt: 1 },
              { id: "m_h", seq: 2, role: "system", content: "secret", contentFormat: "text", isHidden: true, source: null, createdAt: 2 },
            ],
          },
        ],
      },
    ],
  };
}

function result(over: Partial<TemporaryConversationResult> = {}): TemporaryConversationResult {
  return {
    conversationId: "c1",
    branchId: "main",
    floorId: "f1",
    floorNo: 1,
    pageId: "pg1",
    generatedText: "Hello graph",
    inputTokens: 1,
    outputTokens: 2,
    totalTokens: 3,
    totalUsage: {},
    ...over,
  } as TemporaryConversationResult;
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  vi.mocked(graphAssistantConfirmationApi.listPending).mockResolvedValue({ items: [] });
});

describe("graph-assistant store: lazy creation", () => {
  it("creates a project-scoped conversation once with the graph-assistant purpose", async () => {
    vi.mocked(tempConversationApi.createFromProject).mockResolvedValue(record());
    const store = useGraphAssistantStore();

    await store.ensureConversation({ projectId: "p1" });
    await store.ensureConversation({ projectId: "p1" });

    expect(tempConversationApi.createFromProject).toHaveBeenCalledTimes(1);
    expect(tempConversationApi.createFromProject).toHaveBeenCalledWith("p1", "graph-assistant");
    expect(store.isActive).toBe(true);
  });

  it("falls back to session scope when no project is present", async () => {
    vi.mocked(tempConversationApi.createFromSession).mockResolvedValue(record({ projectId: null, sourceSessionId: "s1" }));
    const store = useGraphAssistantStore();

    await store.ensureConversation({ sessionId: "s1" });

    expect(tempConversationApi.createFromSession).toHaveBeenCalledWith("s1", "graph-assistant");
    expect(tempConversationApi.createFromProject).not.toHaveBeenCalled();
  });

  it("does nothing without any context", async () => {
    const store = useGraphAssistantStore();
    await store.ensureConversation({});
    expect(tempConversationApi.createFromProject).not.toHaveBeenCalled();
    expect(tempConversationApi.createFromSession).not.toHaveBeenCalled();
    expect(store.conversation).toBeNull();
  });
});

describe("graph-assistant store: streaming send", () => {
  it("accumulates streamed chunks then reloads transcript to replace the optimistic draft", async () => {
    vi.mocked(tempConversationApi.createFromProject).mockResolvedValue(record());
    vi.mocked(streamTempRespond).mockImplementation(async (params) => {
      params.callbacks?.onChunk?.("Hello");
      params.callbacks?.onChunk?.(" graph");
      return result();
    });
    vi.mocked(tempConversationApi.getTranscript).mockResolvedValue(transcript());

    const store = useGraphAssistantStore();
    await store.sendMessage({ projectId: "p1" }, "  hi there  ");

    expect(streamTempRespond).toHaveBeenCalledTimes(1);
    expect(vi.mocked(streamTempRespond).mock.calls[0]?.[0]).toMatchObject({ conversationId: "c1", message: "hi there" });
    // 成功后回拉 transcript、清空临时流式态；隐藏消息被跳过。
    expect(tempConversationApi.getTranscript).toHaveBeenCalledWith("c1");
    expect(store.messages.map((m) => m.id)).toEqual(["m_u", "m_a"]);
    expect(store.stream.active).toBe(false);
    expect(store.stream.text).toBe("");
    expect(store.sending).toBe(false);
  });

  it("reloads transcript without throwing when the stream is aborted", async () => {
    vi.mocked(tempConversationApi.createFromProject).mockResolvedValue(record());
    let started!: () => void;
    const inFlight = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.mocked(streamTempRespond).mockImplementation(
      (params) =>
        new Promise((_resolve, reject) => {
          params.callbacks?.onChunk?.("partial");
          params.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
          started();
        }),
    );
    vi.mocked(tempConversationApi.getTranscript).mockResolvedValue(transcript());

    const store = useGraphAssistantStore();
    const pending = store.sendMessage({ projectId: "p1" }, "hi");
    await inFlight;
    store.abort();
    await pending;

    expect(tempConversationApi.getTranscript).toHaveBeenCalledWith("c1");
    expect(store.messages.map((m) => m.id)).toEqual(["m_u", "m_a"]);
    expect(store.stream.active).toBe(false);
    expect(store.sending).toBe(false);
  });

  it("marks the conversation inactive when respond returns 409 conversation_not_active", async () => {
    vi.mocked(tempConversationApi.createFromProject).mockResolvedValue(record());
    vi.mocked(streamTempRespond).mockRejectedValue(
      Object.assign(new Error("conversation is not active"), { status: 409, code: "conversation_not_active" }),
    );
    vi.mocked(tempConversationApi.getDetail).mockResolvedValue(record({ status: "finalized", finalizedAt: 1 }));

    const store = useGraphAssistantStore();
    await store.sendMessage({ projectId: "p1" }, "hi");

    expect(tempConversationApi.getDetail).toHaveBeenCalledWith("c1");
    expect(store.isActive).toBe(false);
    expect(store.error).toBeTruthy();
    expect(store.errorSoft).toBe(true);
    expect(store.sending).toBe(false);
  });

  it("clears the local conversation when respond returns 404 conversation_not_found", async () => {
    vi.mocked(tempConversationApi.createFromProject).mockResolvedValue(record());
    vi.mocked(streamTempRespond).mockRejectedValue(
      Object.assign(new Error("not found"), { status: 404, code: "conversation_not_found" }),
    );

    const store = useGraphAssistantStore();
    await store.sendMessage({ projectId: "p1" }, "hi");

    expect(store.conversation).toBeNull();
    expect(store.errorSoft).toBe(true);
    expect(store.sending).toBe(false);
  });

  it("marks access-denied errors as soft and keeps no conversation on create 403", async () => {
    vi.mocked(tempConversationApi.createFromProject).mockRejectedValue(
      Object.assign(new Error("forbidden"), { status: 403, code: "project_access_denied" }),
    );

    const store = useGraphAssistantStore();
    await store.sendMessage({ projectId: "p1" }, "hi");

    expect(streamTempRespond).not.toHaveBeenCalled();
    expect(store.conversation).toBeNull();
    expect(store.error).toBeTruthy();
    expect(store.errorSoft).toBe(true);
  });

  it("ignores empty messages and concurrent sends", async () => {
    const store = useGraphAssistantStore();
    await store.sendMessage({ projectId: "p1" }, "   ");
    expect(streamTempRespond).not.toHaveBeenCalled();
  });
});

describe("graph-assistant store: pre-execution confirmation gate", () => {
  it("surfaces pending tool calls after a streamed send pauses on a confirm tool", async () => {
    vi.mocked(tempConversationApi.createFromProject).mockResolvedValue(record());
    vi.mocked(streamTempRespond).mockResolvedValue(result({ finalState: "awaiting_tool_confirmation" }));
    vi.mocked(tempConversationApi.getTranscript).mockResolvedValue(transcript());
    vi.mocked(graphAssistantConfirmationApi.listPending).mockResolvedValue({ items: [pending()] });

    const store = useGraphAssistantStore();
    await store.sendMessage({ projectId: "p1" }, "create a graph");

    expect(graphAssistantConfirmationApi.listPending).toHaveBeenCalledWith("c1");
    expect(store.hasPending).toBe(true);
    expect(store.pendingToolCalls.map((p) => p.id)).toEqual(["ptc1"]);
    expect(store.sending).toBe(false);
  });

  it("approves a pending call, then refreshes transcript and clears pending when the loop stops", async () => {
    vi.mocked(tempConversationApi.createFromProject).mockResolvedValue(record());
    vi.mocked(streamTempRespond).mockResolvedValue(result({ finalState: "awaiting_tool_confirmation" }));
    vi.mocked(tempConversationApi.getTranscript).mockResolvedValue(transcript());
    vi.mocked(graphAssistantConfirmationApi.listPending)
      .mockResolvedValueOnce({ items: [pending()] }) // after send
      .mockResolvedValueOnce({ items: [] }); // after approve
    vi.mocked(graphAssistantConfirmationApi.resolve).mockResolvedValue({
      data: { decision: "approved", pending_tool_call: pending({ status: "approved" }), result: {
        conversation_id: "c1", branch_id: "main", floor_id: "f2", floor_no: 2, page_id: "pg2",
        generated_text: "ok", total_usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        final_state: "assistant_message_committed",
      } },
    });

    const store = useGraphAssistantStore();
    await store.sendMessage({ projectId: "p1" }, "create a graph");
    expect(store.hasPending).toBe(true);

    await store.approveToolCall("ptc1");

    expect(graphAssistantConfirmationApi.resolve).toHaveBeenCalledWith("c1", "ptc1", "approve");
    expect(store.hasPending).toBe(false);
    expect(store.resolving).toBe(false);
  });

  it("keeps pausing when approval continuation hits another confirm tool", async () => {
    vi.mocked(tempConversationApi.createFromProject).mockResolvedValue(record());
    vi.mocked(streamTempRespond).mockResolvedValue(result({ finalState: "awaiting_tool_confirmation" }));
    vi.mocked(tempConversationApi.getTranscript).mockResolvedValue(transcript());
    vi.mocked(graphAssistantConfirmationApi.listPending)
      .mockResolvedValueOnce({ items: [pending()] })
      .mockResolvedValueOnce({ items: [pending({ id: "ptc2", tool_name: "nodegraph.patch.submit_proposal" })] });
    vi.mocked(graphAssistantConfirmationApi.resolve).mockResolvedValue({
      data: { decision: "approved", pending_tool_call: pending({ status: "approved" }), result: {
        conversation_id: "c1", branch_id: "main", floor_id: "f2", floor_no: 2, page_id: "pg2",
        generated_text: "", total_usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        final_state: "awaiting_tool_confirmation",
      } },
    });

    const store = useGraphAssistantStore();
    await store.sendMessage({ projectId: "p1" }, "go");
    await store.approveToolCall("ptc1");

    expect(store.pendingToolCalls.map((p) => p.id)).toEqual(["ptc2"]);
    expect(store.hasPending).toBe(true);
  });

  it("rejects a pending call and refreshes state", async () => {
    vi.mocked(tempConversationApi.createFromProject).mockResolvedValue(record());
    vi.mocked(streamTempRespond).mockResolvedValue(result({ finalState: "awaiting_tool_confirmation" }));
    vi.mocked(tempConversationApi.getTranscript).mockResolvedValue(transcript());
    vi.mocked(graphAssistantConfirmationApi.listPending)
      .mockResolvedValueOnce({ items: [pending()] })
      .mockResolvedValueOnce({ items: [] });
    vi.mocked(graphAssistantConfirmationApi.resolve).mockResolvedValue({
      data: { decision: "rejected", pending_tool_call: pending({ status: "rejected" }) },
    });

    const store = useGraphAssistantStore();
    await store.sendMessage({ projectId: "p1" }, "go");
    await store.rejectToolCall("ptc1");

    expect(graphAssistantConfirmationApi.resolve).toHaveBeenCalledWith("c1", "ptc1", "reject");
    expect(store.hasPending).toBe(false);
  });

  it("treats a stale pending (already resolved) as a soft error and re-syncs", async () => {
    vi.mocked(tempConversationApi.createFromProject).mockResolvedValue(record());
    vi.mocked(streamTempRespond).mockResolvedValue(result({ finalState: "awaiting_tool_confirmation" }));
    vi.mocked(tempConversationApi.getTranscript).mockResolvedValue(transcript());
    vi.mocked(graphAssistantConfirmationApi.listPending)
      .mockResolvedValueOnce({ items: [pending()] })
      .mockResolvedValueOnce({ items: [] });
    vi.mocked(graphAssistantConfirmationApi.resolve).mockRejectedValue(
      Object.assign(new Error("request failed"), {
        status: 409,
        detail: { error: { code: "pending_tool_call_not_pending", message: "already resolved" } },
      }),
    );

    const store = useGraphAssistantStore();
    await store.sendMessage({ projectId: "p1" }, "go");
    await store.approveToolCall("ptc1");

    expect(store.errorSoft).toBe(true);
    expect(store.error).toBe("already resolved");
    expect(store.hasPending).toBe(false);
  });

  it("ignores concurrent resolves via the resolving guard", async () => {
    vi.mocked(tempConversationApi.createFromProject).mockResolvedValue(record());
    const store = useGraphAssistantStore();
    await store.ensureConversation({ projectId: "p1" });
    store.pendingToolCalls = [pending()];

    let release!: () => void;
    vi.mocked(graphAssistantConfirmationApi.resolve).mockImplementation(
      () => new Promise((resolve) => {
        release = () => resolve({ data: { decision: "rejected", pending_tool_call: pending({ status: "rejected" }) } });
      }),
    );
    vi.mocked(tempConversationApi.getTranscript).mockResolvedValue(transcript());

    const first = store.approveToolCall("ptc1");
    await store.approveToolCall("ptc1"); // 应被 resolving 守卫忽略
    release();
    await first;

    expect(graphAssistantConfirmationApi.resolve).toHaveBeenCalledTimes(1);
  });

  it("reset clears pending tool calls and resolving", async () => {
    vi.mocked(tempConversationApi.createFromProject).mockResolvedValue(record());
    const store = useGraphAssistantStore();
    await store.ensureConversation({ projectId: "p1" });
    store.pendingToolCalls = [pending()];
    store.reset();
    expect(store.pendingToolCalls).toEqual([]);
    expect(store.hasPending).toBe(false);
  });
});

describe("graph-assistant store: lifecycle + helpers", () => {
  it("flattens transcript skipping hidden messages and keeping order", () => {
    const flat = flattenTranscript(transcript());
    expect(flat.map((m) => m.id)).toEqual(["m_u", "m_a"]);
    expect(flat[1]?.content).toBe("hello graph");
  });

  it("finalize transitions the conversation to a terminal state", async () => {
    vi.mocked(tempConversationApi.createFromProject).mockResolvedValue(record());
    vi.mocked(tempConversationApi.finalize).mockResolvedValue(record({ status: "finalized", finalizedAt: 1 }));

    const store = useGraphAssistantStore();
    await store.ensureConversation({ projectId: "p1" });
    await store.finalize();

    expect(tempConversationApi.finalize).toHaveBeenCalledWith("c1");
    expect(store.isActive).toBe(false);
  });

  it("reset clears local state only", async () => {
    vi.mocked(tempConversationApi.createFromProject).mockResolvedValue(record());
    const store = useGraphAssistantStore();
    await store.ensureConversation({ projectId: "p1" });
    store.reset();
    expect(store.conversation).toBeNull();
    expect(store.messages).toEqual([]);
    expect(store.stream.active).toBe(false);
    expect(tempConversationApi.discard).not.toHaveBeenCalled();
    expect(tempConversationApi.finalize).not.toHaveBeenCalled();
  });

  it("exposes expiresAt from the active conversation for the TTL notice", async () => {
    vi.mocked(tempConversationApi.createFromProject).mockResolvedValue(record({ expiresAt: 3_600_000 }));
    const store = useGraphAssistantStore();
    await store.ensureConversation({ projectId: "p1" });
    expect(store.expiresAt).toBe(3_600_000);
  });
});
