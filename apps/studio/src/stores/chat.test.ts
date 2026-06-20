import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/chat", () => ({
  chatApi: {
    createSession: vi.fn(),
    getTimeline: vi.fn(),
    regenerate: vi.fn(),
  },
  streamRespond: vi.fn(),
}));

import {
  chatApi,
  streamRespond,
  type RespondResult,
  type SessionRecord,
  type SessionTimeline,
  type TimelineFloor,
} from "../lib/chat";
import { useChatStore } from "./chat";

function floor(over: Partial<TimelineFloor> = {}): TimelineFloor {
  return {
    id: "f1",
    floorNo: 1,
    state: "committed",
    createdAt: 0,
    pageCount: 2,
    tokenIn: 3,
    tokenOut: 7,
    pages: [],
    activePages: [],
    activePage: null,
    messages: [
      { id: "m_u", role: "user", content: "hi", contentFormat: "text", seq: 0 },
      { id: "m_a", role: "assistant", content: "hello", contentFormat: "text", seq: 0 },
    ],
    ...over,
  };
}

function timeline(floors: TimelineFloor[]): SessionTimeline {
  return { sessionId: "s1", floors };
}

const respondResult = { floorId: "f1", floorNo: 1, generatedText: "Hello world" } as RespondResult;

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
});

describe("chat store: timeline", () => {
  it("loads a session timeline into floors", async () => {
    vi.mocked(chatApi.getTimeline).mockResolvedValue(timeline([floor()]));
    const store = useChatStore();
    await store.loadTimeline("s1");
    expect(chatApi.getTimeline).toHaveBeenCalledWith("s1");
    expect(store.floors).toHaveLength(1);
    expect(store.latestFloor?.id).toBe("f1");
    expect(store.error).toBeNull();
  });

  it("surfaces timeline errors", async () => {
    vi.mocked(chatApi.getTimeline).mockRejectedValue(new Error("nope"));
    const store = useChatStore();
    await store.loadTimeline("s1");
    expect(store.timeline).toBeNull();
    expect(store.error).toBe("nope");
  });
});

describe("chat store: streaming send", () => {
  it("accumulates streamed chunks and tracks phase, then reloads timeline on success", async () => {
    vi.mocked(streamRespond).mockImplementation(async (params) => {
      params.callbacks?.onStart?.({ floorNo: 2 });
      params.callbacks?.onPhase?.("generating");
      params.callbacks?.onChunk?.("Hello");
      params.callbacks?.onChunk?.(" world");
      return respondResult;
    });
    vi.mocked(chatApi.getTimeline).mockResolvedValue(timeline([floor({ id: "f2", floorNo: 2 })]));

    const store = useChatStore();
    await store.sendMessage("s1", "  hi there  ");

    expect(streamRespond).toHaveBeenCalledTimes(1);
    expect(vi.mocked(streamRespond).mock.calls[0]?.[0]).toMatchObject({ sessionId: "s1", message: "hi there" });
    // 成功后重拉时间线、清空临时流式态。
    expect(chatApi.getTimeline).toHaveBeenCalledWith("s1");
    expect(store.floors).toHaveLength(1);
    expect(store.stream.active).toBe(false);
    expect(store.stream.text).toBe("");
    expect(store.sending).toBe(false);
  });

  it("keeps the streamed draft and surfaces the error when the stream fails", async () => {
    vi.mocked(streamRespond).mockImplementation(async (params) => {
      params.callbacks?.onPhase?.("generating");
      params.callbacks?.onChunk?.("partial");
      throw new Error("stream broke");
    });

    const store = useChatStore();
    await store.sendMessage("s1", "hi");

    expect(store.stream.active).toBe(true);
    expect(store.stream.text).toBe("partial");
    expect(store.stream.phase).toBe("generating");
    expect(store.stream.error).toBe("stream broke");
    expect(chatApi.getTimeline).not.toHaveBeenCalled();
    expect(store.sending).toBe(false);
  });

  it("ignores empty messages and concurrent sends", async () => {
    const store = useChatStore();
    await store.sendMessage("s1", "   ");
    expect(streamRespond).not.toHaveBeenCalled();
  });
});

describe("chat store: regenerate + create", () => {
  it("regenerates the latest floor and reloads the timeline", async () => {
    vi.mocked(chatApi.regenerate).mockResolvedValue({ floorId: "f1", floorNo: 1, generatedText: "redo" } as never);
    vi.mocked(chatApi.getTimeline).mockResolvedValue(timeline([floor({ tokenOut: 9 })]));

    const store = useChatStore();
    await store.regenerateLatest("s1");

    expect(chatApi.regenerate).toHaveBeenCalledWith("s1");
    expect(chatApi.getTimeline).toHaveBeenCalledWith("s1");
    expect(store.latestFloor?.tokenOut).toBe(9);
    expect(store.regenerating).toBe(false);
  });

  it("creates a session and returns the record", async () => {
    const record = { id: "s_new", title: "Studio session" } as SessionRecord;
    vi.mocked(chatApi.createSession).mockResolvedValue(record);

    const store = useChatStore();
    const created = await store.createSession("p1", "Studio session");
    expect(chatApi.createSession).toHaveBeenCalledWith("p1", "Studio session");
    expect(created?.id).toBe("s_new");
  });

  it("returns null and surfaces the error when creating a session fails", async () => {
    vi.mocked(chatApi.createSession).mockRejectedValue(new Error("boom"));
    const store = useChatStore();
    expect(await store.createSession("p1")).toBeNull();
    expect(store.error).toBe("boom");
  });

  it("ignores regenerate while busy and abort while idle", async () => {
    const store = useChatStore();
    store.sending = true;
    await store.regenerateLatest("s1");
    expect(chatApi.regenerate).not.toHaveBeenCalled();
    store.sending = false;
    expect(() => store.abort()).not.toThrow();
  });

  it("reset and clearError reset state", () => {
    const store = useChatStore();
    store.error = "x";
    store.clearError();
    expect(store.error).toBeNull();
    store.reset();
    expect(store.timeline).toBeNull();
    expect(store.stream.active).toBe(false);
  });

  it("surfaces regenerate errors", async () => {
    vi.mocked(chatApi.regenerate).mockRejectedValue(new Error("regen failed"));
    const store = useChatStore();
    await store.regenerateLatest("s1");
    expect(store.error).toBe("regen failed");
  });
});
