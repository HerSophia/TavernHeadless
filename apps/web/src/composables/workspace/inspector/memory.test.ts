import { afterEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref } from "vue";

import type {
  MemoryJobRecord,
  MemoryJobsListResult,
  MemoryRecord,
  MemoryScopeStateRecord,
  MemoryScopesListResult,
  MemoryStats,
} from "@tavern/sdk";

import { useWorkspaceInspectorMemory } from "./memory";

async function flushAsyncWork(): Promise<void> {
  await nextTick();
  await Promise.resolve();
  await Promise.resolve();
}

function createMemoryRecord(id: string, overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    confidence: 1,
    content: `memory-${id}`,
    coverageEndFloorNo: null,
    coverageStartFloorNo: null,
    createdAt: 100,
    derivedFromCount: null,
    factKey: null,
    id,
    importance: 0.6,
    lastUsedAt: null,
    lifecycleStatus: "active",
    scope: "chat",
    scopeId: "session-1",
    sourceFloorId: null,
    sourceJobId: null,
    sourceMessageId: null,
    status: "active",
    summaryTier: null,
    tokenCountEstimate: 8,
    type: "fact",
    updatedAt: 200,
    ...overrides,
  };
}

function createMemoryStats(overrides: Partial<MemoryStats> = {}): MemoryStats {
  return {
    active: 3,
    avgConfidence: 0.9,
    avgImportance: 0.7,
    byType: {
      fact: 1,
      openLoop: 1,
      summary: 1,
    },
    deprecated: 1,
    estimatedTokens: 42,
    total: 4,
    ...overrides,
  };
}

function createScopeListResult(scope: MemoryScopeStateRecord | null): MemoryScopesListResult {
  return {
    meta: {
      hasMore: false,
      limit: 1,
      offset: 0,
      sortBy: "updated_at",
      sortOrder: "desc",
      total: scope ? 1 : 0,
    },
    scopes: scope ? [scope] : [],
  };
}

function createJobsListResult(jobs: MemoryJobRecord[]): MemoryJobsListResult {
  return {
    jobs,
    meta: {
      hasMore: false,
      limit: jobs.length,
      offset: 0,
      sortBy: "created_at",
      sortOrder: "desc",
      total: jobs.length,
    },
  };
}

class MockWebSocket {
  public closed = false;
  public onclose: ((event: unknown) => void) | null = null;
  public onerror: ((event: unknown) => void) | null = null;
  public onmessage: ((event: { data: string }) => void) | null = null;
  public onopen: ((event: unknown) => void) | null = null;
  public readyState = 1;

  constructor(public readonly url: string) {}

  close(): void {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.({ code: 1000, wasClean: true });
  }

  emitMessage(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("useWorkspaceInspectorMemory", () => {
  it("loads session memory state and reuses the cache by default", async () => {
    const accountId = ref("acc-1");
    const sessionId = ref("session-1");
    const list = vi.fn<(options?: unknown) => Promise<MemoryRecord[]>>().mockResolvedValue([
      createMemoryRecord("mem-1", { type: "summary", summaryTier: "micro" }),
      createMemoryRecord("mem-2", { type: "fact", factKey: "vault_key" }),
    ]);
    const getStats = vi.fn<(options?: unknown) => Promise<MemoryStats>>().mockResolvedValue(
      createMemoryStats({ estimatedTokens: 64 }),
    );
    const scopeList = vi.fn<(options?: unknown) => Promise<MemoryScopesListResult>>().mockResolvedValue(
      createScopeListResult({
        lastCompactionAt: 456,
        lastProcessedFloorNo: 12,
        leaseOwner: null,
        leaseUntil: null,
        revision: 3,
        scope: "chat",
        scopeId: "session-1",
        updatedAt: 789,
      }),
    );
    const jobList = vi.fn<(options?: unknown) => Promise<MemoryJobsListResult>>().mockResolvedValue(
      createJobsListResult([
        {
          attemptCount: 1,
          availableAt: 100,
          basedOnRevision: 2,
          createdAt: 100,
          finishedAt: 200,
          floorId: "floor-9",
          id: "job-1",
          jobType: "ingest_turn",
          lastError: null,
          leaseOwner: null,
          leaseUntil: null,
          maxAttempts: 4,
          payload: null,
          scope: "chat",
          scopeId: "session-1",
          status: "succeeded",
          updatedAt: 200,
        },
      ]),
    );

    const scope = effectScope();
    const state = scope.run(() => useWorkspaceInspectorMemory({
      accountId,
      memoriesResource: { getStats, list },
      memoryJobsResource: { list: jobList },
      memoryScopesResource: { list: scopeList },
      sessionId,
    }));

    expect(state).toBeTruthy();
    await flushAsyncWork();

    expect(list).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledWith({
      accountId: "acc-1",
      limit: 12,
      offset: 0,
      scope: "chat",
      scopeId: "session-1",
      sortBy: "updated_at",
      sortOrder: "desc",
    });
    expect(getStats).toHaveBeenCalledWith({
      accountId: "acc-1",
      scope: "chat",
      scopeId: "session-1",
    });
    expect(scopeList).toHaveBeenCalledWith({
      accountId: "acc-1",
      limit: 1,
      offset: 0,
      scope: "chat",
      scopeId: "session-1",
      sortBy: "updated_at",
      sortOrder: "desc",
    });
    expect(jobList).toHaveBeenCalledWith({
      accountId: "acc-1",
      limit: 6,
      offset: 0,
      scope: "chat",
      scopeId: "session-1",
      sortBy: "created_at",
      sortOrder: "desc",
    });
    expect(state?.items.value).toHaveLength(2);
    expect(state?.jobs.value).toHaveLength(1);
    expect(state?.scopeState.value).toEqual(expect.objectContaining({ revision: 3 }));
    expect(state?.stats.value).toEqual(expect.objectContaining({ estimatedTokens: 64 }));

    await state?.refresh();
    expect(list).toHaveBeenCalledTimes(1);
    expect(getStats).toHaveBeenCalledTimes(1);
    expect(scopeList).toHaveBeenCalledTimes(1);
    expect(jobList).toHaveBeenCalledTimes(1);

    scope.stop();
  });

  it("bypasses the cache on forced refresh and clears state when the session disappears", async () => {
    const accountId = ref("acc-1");
    const sessionId = ref<string | null>("session-1");
    const list = vi
      .fn<(options?: unknown) => Promise<MemoryRecord[]>>()
      .mockResolvedValueOnce([createMemoryRecord("mem-1", { updatedAt: 100 })])
      .mockResolvedValueOnce([createMemoryRecord("mem-1", { updatedAt: 200 })]);
    const getStats = vi
      .fn<(options?: unknown) => Promise<MemoryStats>>()
      .mockResolvedValueOnce(createMemoryStats({ estimatedTokens: 10 }))
      .mockResolvedValueOnce(createMemoryStats({ estimatedTokens: 20 }));
    const scopeList = vi
      .fn<(options?: unknown) => Promise<MemoryScopesListResult>>()
      .mockResolvedValue(createScopeListResult({
        lastCompactionAt: null,
        lastProcessedFloorNo: 3,
        leaseOwner: null,
        leaseUntil: null,
        revision: 1,
        scope: "chat",
        scopeId: "session-1",
        updatedAt: 300,
      }));
    const jobList = vi
      .fn<(options?: unknown) => Promise<MemoryJobsListResult>>()
      .mockResolvedValue(createJobsListResult([]));

    const scope = effectScope();
    const state = scope.run(() => useWorkspaceInspectorMemory({
      accountId,
      memoriesResource: { getStats, list },
      memoryJobsResource: { list: jobList },
      memoryScopesResource: { list: scopeList },
      sessionId,
    }));

    expect(state).toBeTruthy();
    await flushAsyncWork();
    await state?.refresh(true);

    expect(list).toHaveBeenCalledTimes(2);
    expect(state?.items.value[0]?.updatedAt).toBe(200);
    expect(state?.stats.value?.estimatedTokens).toBe(20);

    sessionId.value = null;
    await flushAsyncWork();

    expect(state?.items.value).toEqual([]);
    expect(state?.jobs.value).toEqual([]);
    expect(state?.scopeState.value).toBeNull();
    expect(state?.stats.value).toBeNull();
    expect(state?.error.value).toBeNull();

    scope.stop();
  });

  it("refreshes from websocket memory events for the active session", async () => {
    vi.useFakeTimers();

    const accountId = ref("acc-1");
    const sessionId = ref("session-1");
    const list = vi
      .fn<(options?: unknown) => Promise<MemoryRecord[]>>()
      .mockResolvedValueOnce([createMemoryRecord("mem-1", { updatedAt: 100 })])
      .mockResolvedValueOnce([createMemoryRecord("mem-1", { updatedAt: 200 })]);
    const getStats = vi
      .fn<(options?: unknown) => Promise<MemoryStats>>()
      .mockResolvedValueOnce(createMemoryStats({ estimatedTokens: 10 }))
      .mockResolvedValueOnce(createMemoryStats({ estimatedTokens: 20 }));
    const scopeList = vi
      .fn<(options?: unknown) => Promise<MemoryScopesListResult>>()
      .mockResolvedValue(createScopeListResult({
        lastCompactionAt: null,
        lastProcessedFloorNo: 3,
        leaseOwner: null,
        leaseUntil: null,
        revision: 1,
        scope: "chat",
        scopeId: "session-1",
        updatedAt: 300,
      }));
    const jobList = vi
      .fn<(options?: unknown) => Promise<MemoryJobsListResult>>()
      .mockResolvedValueOnce(createJobsListResult([]))
      .mockResolvedValueOnce(createJobsListResult([
        {
          attemptCount: 1,
          availableAt: 100,
          basedOnRevision: 1,
          createdAt: 100,
          finishedAt: 200,
          floorId: "floor-1",
          id: "job-1",
          jobType: "ingest_turn",
          lastError: null,
          leaseOwner: null,
          leaseUntil: null,
          maxAttempts: 4,
          payload: null,
          scope: "chat",
          scopeId: "session-1",
          status: "succeeded",
          updatedAt: 200,
        },
      ]));
    const sockets: MockWebSocket[] = [];
    const webSocketFactory = vi.fn((url: string) => {
      const socket = new MockWebSocket(url);
      sockets.push(socket);
      return socket;
    });

    const scope = effectScope();
    const state = scope.run(() => useWorkspaceInspectorMemory({
      accountId,
      memoriesResource: { getStats, list },
      memoryJobsResource: { list: jobList },
      memoryScopesResource: { list: scopeList },
      sessionId,
      webSocketFactory,
      webSocketUrlResolver: (targetSessionId) => `ws://example.test/ws?session_id=${targetSessionId}`,
    }));

    expect(state).toBeTruthy();
    await flushAsyncWork();

    expect(webSocketFactory).toHaveBeenCalledWith("ws://example.test/ws?session_id=session-1");
    expect(state?.items.value[0]?.updatedAt).toBe(100);
    expect(state?.jobs.value).toEqual([]);

    sockets[0]!.emitMessage({
      type: "event",
      event: "memory.consolidated",
      data: {
        sessionId: "session-1",
        scope: "chat",
        scopeId: "session-1",
      },
      timestamp: 123,
    });
    await vi.advanceTimersByTimeAsync(120);
    await flushAsyncWork();

    expect(list).toHaveBeenCalledTimes(2);
    expect(getStats).toHaveBeenCalledTimes(2);
    expect(scopeList).toHaveBeenCalledTimes(2);
    expect(jobList).toHaveBeenCalledTimes(2);
    expect(state?.items.value[0]?.updatedAt).toBe(200);
    expect(state?.stats.value?.estimatedTokens).toBe(20);
    expect(state?.jobs.value).toHaveLength(1);

    scope.stop();
    expect(sockets[0]!.closed).toBe(true);
  });
});
