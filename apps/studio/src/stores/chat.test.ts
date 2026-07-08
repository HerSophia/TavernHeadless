import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/chat", () => ({
  chatApi: {
    createSession: vi.fn(),
    getTimeline: vi.fn(),
    regenerate: vi.fn(),
    getActiveRun: vi.fn(),
    retryFloor: vi.fn(),
    retryFloorStep: vi.fn(),
    editAndRegenerate: vi.fn(),
    getMessageRevisions: vi.fn(),
    createMessageRevision: vi.fn(),
    listFloorPages: vi.fn(),
    activatePage: vi.fn(),
  },
  streamRespond: vi.fn(),
}));

import {
  chatApi,
  streamRespond,
  type CommittedContentManualRevisionTimeline,
  type CreateSessionInput,
  type FloorRetryStepResult,
  type PageRecord,
  type RegenerateResult,
  type RespondResult,
  type SessionActiveRunRecord,
  type SessionActiveRunSummary,
  type SessionRecord,
  type SessionTimeline,
  type TimelineFloor,
} from "../lib/chat";
import { TIMELINE_PAGE_SIZE, useChatStore } from "./chat";

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

/** 构造 n 个递增 floorNo / id 的楼层（从 startNo 开始）。 */
function manyFloors(n: number, startNo: number): TimelineFloor[] {
  return Array.from({ length: n }, (_, i) => floor({ id: `f${startNo + i}`, floorNo: startNo + i }));
}

const respondResult = { floorId: "f1", floorNo: 1, generatedText: "Hello world" } as RespondResult;

/** 构造一条分步重跑结果（默认无不可回滚副作用）。 */
function retryStepResult(over: Partial<FloorRetryStepResult> = {}): FloorRetryStepResult {
  return {
    floorId: "f1",
    floorNo: 1,
    generatedText: "redo",
    discardedFromStepIndex: 2,
    irreversibleSideEffects: [],
    ...over,
  } as FloorRetryStepResult;
}

/** 构造一条 active-run 记录（默认空闲），可覆盖 busy / phase / type 等。 */
function activeRunRecord(over: Partial<SessionActiveRunSummary> = {}): SessionActiveRunRecord {
  return {
    sessionId: "s1",
    activeRun: { branchId: "main", busy: false, updatedAt: 0, ...over },
  };
}

/** 构造一条人工修订时间线（默认 latestRevisionNo=0）。 */
function revisionTimeline(
  over: Partial<CommittedContentManualRevisionTimeline> = {},
): CommittedContentManualRevisionTimeline {
  return {
    branchId: "main",
    currentContent: "hello",
    currentTokenCount: 5,
    floorId: "f1",
    items: [],
    latestRevisionNo: 0,
    messageId: "m_a",
    pageId: "p1",
    sessionId: "s1",
    targetId: "m_a",
    targetKind: "message",
    ...over,
  };
}

/** 构造一条页记录（SC1-8）。 */
function pageRecord(over: Partial<PageRecord> = {}): PageRecord {
  return {
    id: "p1",
    floorId: "f1",
    pageNo: 0,
    pageKind: "output",
    isActive: false,
    version: 1,
    checksum: null,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
});

describe("chat store: timeline", () => {
  it("loads a session timeline into floors", async () => {
    vi.mocked(chatApi.getTimeline).mockResolvedValue(timeline([floor()]));
    const store = useChatStore();
    await store.loadTimeline("s1");
    expect(chatApi.getTimeline).toHaveBeenCalledWith("s1", { offset: 0, limit: TIMELINE_PAGE_SIZE });
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
    expect(chatApi.getTimeline).toHaveBeenCalledWith("s1", { offset: 0, limit: TIMELINE_PAGE_SIZE });
    expect(store.floors).toHaveLength(1);
    expect(store.stream.active).toBe(false);
    expect(store.stream.text).toBe("");
    expect(store.sending).toBe(false);
  });

  it("keeps the streamed draft, surfaces the error and reconciles when the stream fails", async () => {
    vi.mocked(streamRespond).mockImplementation(async (params) => {
      params.callbacks?.onPhase?.("generating");
      params.callbacks?.onChunk?.("partial");
      throw new Error("stream broke");
    });
    // SC1-5：真实错误（非 abort）后追加一次 active-run + timeline 轻量对账。
    vi.mocked(chatApi.getTimeline).mockResolvedValue(timeline([]));
    vi.mocked(chatApi.getActiveRun).mockResolvedValue(activeRunRecord({ busy: false }));

    const store = useChatStore();
    await store.sendMessage("s1", "hi");

    // 流式草稿与错误仍保留（不被对账清除）。
    expect(store.stream.active).toBe(true);
    expect(store.stream.text).toBe("partial");
    expect(store.stream.phase).toBe("generating");
    expect(store.stream.error).toBe("stream broke");
    // 对账已发生：拉取了 active-run 与时间线。
    expect(chatApi.getActiveRun).toHaveBeenCalledWith("s1");
    expect(chatApi.getTimeline).toHaveBeenCalledWith("s1", { offset: 0, limit: TIMELINE_PAGE_SIZE });
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
    expect(chatApi.getTimeline).toHaveBeenCalledWith("s1", { offset: 0, limit: TIMELINE_PAGE_SIZE });
    expect(store.latestFloor?.tokenOut).toBe(9);
    expect(store.regenerating).toBe(false);
  });

  it("creates a session and passes the binding input through", async () => {
    const record = { id: "s_new", title: "Studio session" } as SessionRecord;
    vi.mocked(chatApi.createSession).mockResolvedValue(record);

    const store = useChatStore();
    const input: CreateSessionInput = {
      title: "Studio session",
      character: { kind: "character", id: "c1", name: "Nyx", version: 2, versionId: "cv2" },
      promptMode: "native",
    };
    const created = await store.createSession("p1", input);
    // store 仅透传，不做映射（映射在 chatApi 层，此处被 mock）。
    expect(chatApi.createSession).toHaveBeenCalledWith("p1", input);
    expect(created?.id).toBe("s_new");
    expect(store.creating).toBe(false);
  });

  it("creates an empty session when no input is given (backward compatible)", async () => {
    const record = { id: "s_empty" } as SessionRecord;
    vi.mocked(chatApi.createSession).mockResolvedValue(record);

    const store = useChatStore();
    const created = await store.createSession("p1");
    expect(chatApi.createSession).toHaveBeenCalledWith("p1", undefined);
    expect(created?.id).toBe("s_empty");
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

describe("chat store: active run awareness", () => {
  it("merges server busy into busy and reports remoteBusy when idle locally", async () => {
    vi.mocked(chatApi.getActiveRun).mockResolvedValue(
      activeRunRecord({ busy: true, publicPhase: "generating", activeRunType: "respond" }),
    );
    const store = useChatStore();
    await store.refreshActiveRun("s1");
    expect(chatApi.getActiveRun).toHaveBeenCalledWith("s1");
    expect(store.serverBusy).toBe(true);
    expect(store.busy).toBe(true);
    expect(store.remoteBusy).toBe(true);
    expect(store.activeRunPhase).toBe("generating");
    expect(store.activeRunType).toBe("respond");
  });

  it("does not report remoteBusy while sending locally (no misreport)", async () => {
    vi.mocked(chatApi.getActiveRun).mockResolvedValue(activeRunRecord({ busy: true }));
    const store = useChatStore();
    store.sending = true;
    await store.refreshActiveRun("s1");
    expect(store.serverBusy).toBe(true);
    expect(store.busy).toBe(true);
    expect(store.remoteBusy).toBe(false);
  });

  it("degrades to idle when getActiveRun fails, not blocking send", async () => {
    vi.mocked(chatApi.getActiveRun).mockRejectedValue(new Error("nope"));
    const store = useChatStore();
    await store.refreshActiveRun("s1");
    expect(store.activeRun).toBeNull();
    expect(store.serverBusy).toBe(false);
    expect(store.busy).toBe(false);
    expect(store.error).toBeNull();
  });

  it("discards a stale refreshActiveRun response (race)", async () => {
    const store = useChatStore();
    let resolveFirst!: (v: SessionActiveRunRecord) => void;
    const first = new Promise<SessionActiveRunRecord>((res) => {
      resolveFirst = res;
    });
    vi.mocked(chatApi.getActiveRun)
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce(activeRunRecord({ busy: false }));
    const p1 = store.refreshActiveRun("s1"); // token 1（挂起）
    const p2 = store.refreshActiveRun("s1"); // token 2（先返回：空闲）
    await p2;
    resolveFirst(activeRunRecord({ busy: true })); // 旧响应（忙碌）迟到
    await p1;
    // 最新一次（空闲）胜出，迟到的忙碌被丢弃。
    expect(store.serverBusy).toBe(false);
    expect(store.activeRun?.busy).toBe(false);
  });

  it("reset clears active run state", async () => {
    vi.mocked(chatApi.getActiveRun).mockResolvedValue(activeRunRecord({ busy: true }));
    const store = useChatStore();
    await store.refreshActiveRun("s1");
    expect(store.serverBusy).toBe(true);
    store.reset();
    expect(store.activeRun).toBeNull();
    expect(store.serverBusy).toBe(false);
    expect(store.loadingActiveRun).toBe(false);
  });

  it("reconciles active run after a successful send", async () => {
    vi.mocked(streamRespond).mockImplementation(async (params) => {
      params.callbacks?.onChunk?.("hi");
      return respondResult;
    });
    vi.mocked(chatApi.getTimeline).mockResolvedValue(timeline([floor({ id: "f2", floorNo: 2 })]));
    vi.mocked(chatApi.getActiveRun).mockResolvedValue(activeRunRecord({ busy: false }));
    const store = useChatStore();
    await store.sendMessage("s1", "hi");
    expect(chatApi.getActiveRun).toHaveBeenCalledWith("s1");
    expect(store.serverBusy).toBe(false);
  });

  it("reconciles active run after regenerate", async () => {
    vi.mocked(chatApi.regenerate).mockResolvedValue({
      floorId: "f1",
      floorNo: 1,
      generatedText: "redo",
    } as never);
    vi.mocked(chatApi.getTimeline).mockResolvedValue(timeline([floor()]));
    vi.mocked(chatApi.getActiveRun).mockResolvedValue(activeRunRecord({ busy: false }));
    const store = useChatStore();
    await store.regenerateLatest("s1");
    expect(chatApi.getActiveRun).toHaveBeenCalledWith("s1");
  });
});

describe("chat store: timeline pagination", () => {
  it("loads the first window and infers hasMore when the window is full", async () => {
    vi.mocked(chatApi.getTimeline).mockResolvedValue(timeline(manyFloors(TIMELINE_PAGE_SIZE, 1)));
    const store = useChatStore();
    await store.loadTimeline("s1");
    expect(chatApi.getTimeline).toHaveBeenCalledWith("s1", { offset: 0, limit: TIMELINE_PAGE_SIZE });
    expect(store.floors).toHaveLength(TIMELINE_PAGE_SIZE);
    expect(store.timelineOffset).toBe(TIMELINE_PAGE_SIZE);
    expect(store.timelineHasMore).toBe(true);
  });

  it("marks no more when the first window is short", async () => {
    vi.mocked(chatApi.getTimeline).mockResolvedValue(timeline(manyFloors(3, 1)));
    const store = useChatStore();
    await store.loadTimeline("s1");
    expect(store.timelineHasMore).toBe(false);
    expect(store.timelineOffset).toBe(3);
  });

  it("appends the next window, dedupes overlap and keeps ascending order", async () => {
    const store = useChatStore();
    // 首窗：满窗 → hasMore=true
    vi.mocked(chatApi.getTimeline).mockResolvedValueOnce(timeline(manyFloors(TIMELINE_PAGE_SIZE, 1)));
    await store.loadTimeline("s1");
    // 下一窗：含一个与首窗重叠的 id（f{PAGE_SIZE}）用于验证去重 + 3 个更新楼层
    const overlap = floor({ id: `f${TIMELINE_PAGE_SIZE}`, floorNo: TIMELINE_PAGE_SIZE });
    const newer = manyFloors(3, TIMELINE_PAGE_SIZE + 1);
    vi.mocked(chatApi.getTimeline).mockResolvedValueOnce(timeline([overlap, ...newer]));
    await store.loadMoreTimeline("s1");

    expect(chatApi.getTimeline).toHaveBeenLastCalledWith("s1", {
      offset: TIMELINE_PAGE_SIZE,
      limit: TIMELINE_PAGE_SIZE,
    });
    // 唯一楼层 = 50 + 3（重叠被去重）
    expect(store.floors).toHaveLength(TIMELINE_PAGE_SIZE + 3);
    const nos = store.floors.map((f) => f.floorNo);
    expect(nos).toEqual([...nos].sort((a, b) => a - b));
    // offset 按服务端实际返回数（4）推进；短窗 → hasMore=false
    expect(store.timelineOffset).toBe(TIMELINE_PAGE_SIZE + 4);
    expect(store.timelineHasMore).toBe(false);
  });

  it("does not request more when hasMore is false", async () => {
    vi.mocked(chatApi.getTimeline).mockResolvedValue(timeline(manyFloors(3, 1)));
    const store = useChatStore();
    await store.loadTimeline("s1");
    vi.mocked(chatApi.getTimeline).mockClear();
    await store.loadMoreTimeline("s1");
    expect(chatApi.getTimeline).not.toHaveBeenCalled();
  });

  it("reset clears pagination state", async () => {
    vi.mocked(chatApi.getTimeline).mockResolvedValue(timeline(manyFloors(TIMELINE_PAGE_SIZE, 1)));
    const store = useChatStore();
    await store.loadTimeline("s1");
    store.reset();
    expect(store.timelineOffset).toBe(0);
    expect(store.timelineHasMore).toBe(false);
    expect(store.loadingMoreTimeline).toBe(false);
  });
});

describe("chat store: floor retry (SC1-6)", () => {
  it("retries a floor in place and reconciles timeline + active run", async () => {
    vi.mocked(chatApi.retryFloor).mockResolvedValue(respondResult as never);
    vi.mocked(chatApi.getTimeline).mockResolvedValue(timeline([floor()]));
    vi.mocked(chatApi.getActiveRun).mockResolvedValue(activeRunRecord({ busy: false }));
    const store = useChatStore();
    await store.retryFloor("s1", "f1");
    expect(chatApi.retryFloor).toHaveBeenCalledWith("f1");
    expect(chatApi.getTimeline).toHaveBeenCalledWith("s1", { offset: 0, limit: TIMELINE_PAGE_SIZE });
    expect(chatApi.getActiveRun).toHaveBeenCalledWith("s1");
    expect(store.retrying).toBe(false);
  });

  it("does not retry a floor while busy", async () => {
    const store = useChatStore();
    store.sending = true;
    await store.retryFloor("s1", "f1");
    expect(chatApi.retryFloor).not.toHaveBeenCalled();
    store.sending = false;
  });

  it("surfaces retry errors", async () => {
    vi.mocked(chatApi.retryFloor).mockRejectedValue(new Error("retry failed"));
    const store = useChatStore();
    await store.retryFloor("s1", "f1");
    expect(store.error).toBe("retry failed");
    expect(store.retrying).toBe(false);
  });

  it("retryFloorStep records discarded step + side effects and reconciles", async () => {
    vi.mocked(chatApi.retryFloorStep).mockResolvedValue(
      retryStepResult({
        discardedFromStepIndex: 3,
        irreversibleSideEffects: [
          { executionId: "e1", sideEffectLevel: "write", startedAt: 0, toolName: "sql.update" },
        ],
      }),
    );
    vi.mocked(chatApi.getTimeline).mockResolvedValue(timeline([floor()]));
    vi.mocked(chatApi.getActiveRun).mockResolvedValue(activeRunRecord({ busy: false }));
    const store = useChatStore();
    await store.retryFloorStep("s1", "f1", 3);
    expect(chatApi.retryFloorStep).toHaveBeenCalledWith("f1", 3);
    expect(store.lastRetryStep?.floorId).toBe("f1");
    expect(store.lastRetryStep?.discardedFromStepIndex).toBe(3);
    expect(store.lastRetryStep?.irreversibleSideEffects).toHaveLength(1);
    expect(store.lastRetryStep?.irreversibleSideEffects[0]?.toolName).toBe("sql.update");
    expect(chatApi.getTimeline).toHaveBeenCalledWith("s1", { offset: 0, limit: TIMELINE_PAGE_SIZE });
    expect(chatApi.getActiveRun).toHaveBeenCalledWith("s1");
  });

  it("rejects an invalid step index without calling the API", async () => {
    const store = useChatStore();
    await store.retryFloorStep("s1", "f1", 0);
    expect(chatApi.retryFloorStep).not.toHaveBeenCalled();
    expect(store.error).not.toBeNull();
    await store.retryFloorStep("s1", "f1", 1.5);
    await store.retryFloorStep("s1", "f1", -2);
    expect(chatApi.retryFloorStep).not.toHaveBeenCalled();
    expect(store.retrying).toBe(false);
  });

  it("clearLastRetryStep clears the summary", async () => {
    vi.mocked(chatApi.retryFloorStep).mockResolvedValue(retryStepResult());
    vi.mocked(chatApi.getTimeline).mockResolvedValue(timeline([floor()]));
    vi.mocked(chatApi.getActiveRun).mockResolvedValue(activeRunRecord({ busy: false }));
    const store = useChatStore();
    await store.retryFloorStep("s1", "f1", 2);
    expect(store.lastRetryStep).not.toBeNull();
    store.clearLastRetryStep();
    expect(store.lastRetryStep).toBeNull();
  });

  it("reset clears retrying and lastRetryStep", async () => {
    vi.mocked(chatApi.retryFloorStep).mockResolvedValue(retryStepResult());
    vi.mocked(chatApi.getTimeline).mockResolvedValue(timeline([floor()]));
    vi.mocked(chatApi.getActiveRun).mockResolvedValue(activeRunRecord({ busy: false }));
    const store = useChatStore();
    await store.retryFloorStep("s1", "f1", 2);
    store.reset();
    expect(store.retrying).toBe(false);
    expect(store.lastRetryStep).toBeNull();
  });
});

describe("chat store: edit and regenerate (SC1-7)", () => {
  it("edits a user message and follows the returned fork branch, then reconciles", async () => {
    vi.mocked(chatApi.editAndRegenerate).mockResolvedValue({
      floorId: "f9",
      floorNo: 9,
      generatedText: "redo",
      branchId: "branch-abc",
    } as RegenerateResult);
    vi.mocked(chatApi.getTimeline).mockResolvedValue({
      sessionId: "s1",
      branchId: "branch-abc",
      floors: [floor({ id: "f9", floorNo: 9 })],
    });
    vi.mocked(chatApi.getActiveRun).mockResolvedValue(activeRunRecord({ busy: false }));
    const store = useChatStore();
    await store.editAndRegenerate("s1", "m_u", "  edited text  ");
    // 内容去空后传递；branchId 不传（服务端自动生成）。
    expect(chatApi.editAndRegenerate).toHaveBeenCalledWith("m_u", "edited text");
    // 视图跟随返回的 fork 分支。
    expect(store.currentBranchId).toBe("branch-abc");
    expect(store.onFork).toBe(true);
    expect(chatApi.getTimeline).toHaveBeenCalledWith("s1", {
      offset: 0,
      limit: TIMELINE_PAGE_SIZE,
      branchId: "branch-abc",
    });
    expect(chatApi.getActiveRun).toHaveBeenCalledWith("s1");
    expect(store.editing).toBe(false);
  });

  it("does not edit while busy", async () => {
    const store = useChatStore();
    store.sending = true;
    await store.editAndRegenerate("s1", "m_u", "x");
    expect(chatApi.editAndRegenerate).not.toHaveBeenCalled();
    store.sending = false;
  });

  it("ignores empty content", async () => {
    const store = useChatStore();
    await store.editAndRegenerate("s1", "m_u", "   ");
    expect(chatApi.editAndRegenerate).not.toHaveBeenCalled();
  });

  it("surfaces edit errors", async () => {
    vi.mocked(chatApi.editAndRegenerate).mockRejectedValue(new Error("edit failed"));
    const store = useChatStore();
    await store.editAndRegenerate("s1", "m_u", "text");
    expect(store.error).toBe("edit failed");
    expect(store.editing).toBe(false);
  });

  it("loadTimeline is branch-aware: main omits branchId, fork includes it", async () => {
    vi.mocked(chatApi.getTimeline).mockResolvedValue(timeline([floor()]));
    const store = useChatStore();
    // main：不带 branchId（不回归 SC1-4 断言）。
    await store.loadTimeline("s1");
    expect(chatApi.getTimeline).toHaveBeenLastCalledWith("s1", {
      offset: 0,
      limit: TIMELINE_PAGE_SIZE,
    });
    expect(store.onFork).toBe(false);
    // 显式切到 fork：带 branchId。
    await store.loadTimeline("s1", "branch-x");
    expect(chatApi.getTimeline).toHaveBeenLastCalledWith("s1", {
      offset: 0,
      limit: TIMELINE_PAGE_SIZE,
      branchId: "branch-x",
    });
    expect(store.currentBranchId).toBe("branch-x");
    expect(store.onFork).toBe(true);
    // 回到主分支："main" 归一为 null，不带 branchId。
    await store.loadTimeline("s1", "main");
    expect(chatApi.getTimeline).toHaveBeenLastCalledWith("s1", {
      offset: 0,
      limit: TIMELINE_PAGE_SIZE,
    });
    expect(store.currentBranchId).toBeNull();
    expect(store.onFork).toBe(false);
  });

  it("sends within the current fork branch (passes branchId to streamRespond)", async () => {
    vi.mocked(chatApi.getTimeline).mockResolvedValue({
      sessionId: "s1",
      branchId: "branch-x",
      floors: [],
    });
    vi.mocked(chatApi.getActiveRun).mockResolvedValue(activeRunRecord({ busy: false }));
    vi.mocked(streamRespond).mockImplementation(async (params) => {
      params.callbacks?.onChunk?.("hi");
      return respondResult;
    });
    const store = useChatStore();
    await store.loadTimeline("s1", "branch-x");
    await store.sendMessage("s1", "hello");
    expect(vi.mocked(streamRespond).mock.calls[0]?.[0]).toMatchObject({ branchId: "branch-x" });
  });

  it("reset clears editing and currentBranchId", async () => {
    vi.mocked(chatApi.getTimeline).mockResolvedValue(timeline([floor()]));
    const store = useChatStore();
    await store.loadTimeline("s1", "branch-x");
    expect(store.currentBranchId).toBe("branch-x");
    store.reset();
    expect(store.currentBranchId).toBeNull();
    expect(store.editing).toBe(false);
    expect(store.onFork).toBe(false);
  });
});

describe("chat store: page swipes (SC1-8)", () => {
  it("lazily loads floor pages into the cache", async () => {
    vi.mocked(chatApi.listFloorPages).mockResolvedValue([
      pageRecord({ id: "p1", version: 1, isActive: false }),
      pageRecord({ id: "p2", version: 2, isActive: true }),
    ]);
    const store = useChatStore();
    await store.loadFloorPages("f1");
    expect(chatApi.listFloorPages).toHaveBeenCalledWith("f1");
    expect(store.floorPages.f1).toHaveLength(2);
  });

  it("does not refetch when the cache is already populated", async () => {
    vi.mocked(chatApi.listFloorPages).mockResolvedValue([pageRecord()]);
    const store = useChatStore();
    await store.loadFloorPages("f1");
    vi.mocked(chatApi.listFloorPages).mockClear();
    await store.loadFloorPages("f1");
    expect(chatApi.listFloorPages).not.toHaveBeenCalled();
  });

  it("refetches when force is true", async () => {
    vi.mocked(chatApi.listFloorPages).mockResolvedValue([pageRecord()]);
    const store = useChatStore();
    await store.loadFloorPages("f1");
    await store.loadFloorPages("f1", true);
    expect(chatApi.listFloorPages).toHaveBeenCalledTimes(2);
  });

  it("dedupes concurrent loads of the same floor", async () => {
    let resolveList!: (v: PageRecord[]) => void;
    const pending = new Promise<PageRecord[]>((res) => {
      resolveList = res;
    });
    vi.mocked(chatApi.listFloorPages).mockReturnValueOnce(pending);
    const store = useChatStore();
    const p1 = store.loadFloorPages("f1");
    const p2 = store.loadFloorPages("f1"); // 并发：应早退，不再请求
    resolveList([pageRecord()]);
    await Promise.all([p1, p2]);
    expect(chatApi.listFloorPages).toHaveBeenCalledTimes(1);
  });

  it("keeps the old cache and surfaces the error when loadFloorPages fails", async () => {
    vi.mocked(chatApi.listFloorPages).mockResolvedValueOnce([pageRecord({ id: "p_old" })]);
    const store = useChatStore();
    await store.loadFloorPages("f1");
    vi.mocked(chatApi.listFloorPages).mockRejectedValueOnce(new Error("list failed"));
    await store.loadFloorPages("f1", true);
    expect(store.error).toBe("list failed");
    expect(store.floorPages.f1?.[0]?.id).toBe("p_old");
  });

  it("activates a page then reconciles timeline, page cache and active run", async () => {
    vi.mocked(chatApi.activatePage).mockResolvedValue(pageRecord({ id: "p2", isActive: true }));
    vi.mocked(chatApi.getTimeline).mockResolvedValue(timeline([floor()]));
    vi.mocked(chatApi.listFloorPages).mockResolvedValue([
      pageRecord({ id: "p1", version: 1, isActive: false }),
      pageRecord({ id: "p2", version: 2, isActive: true }),
    ]);
    vi.mocked(chatApi.getActiveRun).mockResolvedValue(activeRunRecord({ busy: false }));
    const store = useChatStore();
    await store.activatePage("s1", "f1", "p2");
    expect(chatApi.activatePage).toHaveBeenCalledWith("p2");
    expect(chatApi.getTimeline).toHaveBeenCalledWith("s1", { offset: 0, limit: TIMELINE_PAGE_SIZE });
    // 切换后 force 重取该楼层缓存。
    expect(chatApi.listFloorPages).toHaveBeenCalledWith("f1");
    expect(chatApi.getActiveRun).toHaveBeenCalledWith("s1");
    expect(store.activatingPageId).toBeNull();
    expect(store.floorPages.f1?.find((p) => p.id === "p2")?.isActive).toBe(true);
  });

  it("does not activate a page while busy", async () => {
    const store = useChatStore();
    store.sending = true;
    await store.activatePage("s1", "f1", "p2");
    expect(chatApi.activatePage).not.toHaveBeenCalled();
    store.sending = false;
  });

  it("does not activate a page while another switch is in progress", async () => {
    const store = useChatStore();
    store.activatingPageId = "p_other";
    await store.activatePage("s1", "f1", "p2");
    expect(chatApi.activatePage).not.toHaveBeenCalled();
  });

  it("surfaces activate errors and clears activatingPageId", async () => {
    vi.mocked(chatApi.activatePage).mockRejectedValue(new Error("activate failed"));
    const store = useChatStore();
    await store.activatePage("s1", "f1", "p2");
    expect(store.error).toBe("activate failed");
    expect(store.activatingPageId).toBeNull();
  });

  it("reset clears page cache and switch state", async () => {
    vi.mocked(chatApi.listFloorPages).mockResolvedValue([pageRecord()]);
    const store = useChatStore();
    await store.loadFloorPages("f1");
    expect(store.floorPages.f1).toBeDefined();
    store.reset();
    expect(store.floorPages).toEqual({});
    expect(store.activatingPageId).toBeNull();
  });
});

describe("chat store: edit assistant message (manual revision)", () => {
  it("fetches latest revision no then creates a revision and reconciles the timeline", async () => {
    vi.mocked(chatApi.getMessageRevisions).mockResolvedValue(revisionTimeline({ latestRevisionNo: 2 }));
    vi.mocked(chatApi.createMessageRevision).mockResolvedValue(
      revisionTimeline({ latestRevisionNo: 3, currentContent: "fixed" }),
    );
    vi.mocked(chatApi.getTimeline).mockResolvedValue(timeline([floor()]));
    const store = useChatStore();
    await store.editAssistantMessage("s1", "m_a", "  fixed  ");
    expect(chatApi.getMessageRevisions).toHaveBeenCalledWith("m_a");
    // 以 latestRevisionNo 作乐观锁基线、内容去空白后提交。
    expect(chatApi.createMessageRevision).toHaveBeenCalledWith("m_a", "fixed", 2);
    // 成功后对账时间线。
    expect(chatApi.getTimeline).toHaveBeenCalledWith("s1", { offset: 0, limit: TIMELINE_PAGE_SIZE });
    expect(store.error).toBeNull();
    expect(store.savingRevision).toBe(false);
  });

  it("does not edit while busy", async () => {
    const store = useChatStore();
    store.sending = true;
    await store.editAssistantMessage("s1", "m_a", "fixed");
    expect(chatApi.getMessageRevisions).not.toHaveBeenCalled();
    expect(chatApi.createMessageRevision).not.toHaveBeenCalled();
    store.sending = false;
  });

  it("does not edit when the content is blank", async () => {
    const store = useChatStore();
    await store.editAssistantMessage("s1", "m_a", "   ");
    expect(chatApi.getMessageRevisions).not.toHaveBeenCalled();
    expect(chatApi.createMessageRevision).not.toHaveBeenCalled();
  });

  it("surfaces optimistic-lock conflicts and does not reload the timeline", async () => {
    vi.mocked(chatApi.getMessageRevisions).mockResolvedValue(revisionTimeline({ latestRevisionNo: 1 }));
    vi.mocked(chatApi.createMessageRevision).mockRejectedValue(new Error("manual_revision_conflict"));
    const store = useChatStore();
    await store.editAssistantMessage("s1", "m_a", "fixed");
    expect(store.error).toBe("manual_revision_conflict");
    expect(chatApi.getTimeline).not.toHaveBeenCalled();
    expect(store.savingRevision).toBe(false);
  });

  it("includes savingRevision in busy and excludes it from remoteBusy", () => {
    const store = useChatStore();
    store.savingRevision = true;
    expect(store.busy).toBe(true);
    // 自己在保存修订时，即使服务端 busy 也不算 remoteBusy（不误报别处在跑）。
    store.activeRun = { branchId: "main", busy: true, updatedAt: 0 };
    expect(store.remoteBusy).toBe(false);
    store.savingRevision = false;
  });

  it("reset clears savingRevision", () => {
    const store = useChatStore();
    store.savingRevision = true;
    store.reset();
    expect(store.savingRevision).toBe(false);
  });
});
