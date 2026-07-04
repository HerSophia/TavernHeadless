import { effectScope } from "vue";
import { describe, expect, it, vi } from "vitest";

import type {
  NodeGraphRunEnqueueResponse,
  NodeGraphRunRecordResponse,
} from "../../../lib/nodegraph-api/types";
import {
  useGraphRun,
  type GraphRunApi,
  type GraphRunTimers,
} from "./use-graph-run";

/** 手动可推进的 fake timer，便于确定性地测试轮询。 */
function createManualTimers() {
  let currentTime = 0;
  let nextHandle = 1;
  const handlers = new Map<number, { handler: () => void; intervalMs: number; lastRun: number }>();
  const timers: GraphRunTimers = {
    setInterval(handler, ms) {
      const handle = nextHandle++;
      handlers.set(handle, { handler, intervalMs: ms, lastRun: currentTime });
      return handle;
    },
    clearInterval(handle) {
      handlers.delete(handle);
    },
    now() {
      return currentTime;
    },
  };
  async function advance(ms: number): Promise<void> {
    const target = currentTime + ms;
    // 逐个间隔推进，触发到期的 interval handler。
    while (true) {
      let nextTick = Infinity;
      for (const entry of handlers.values()) {
        nextTick = Math.min(nextTick, entry.lastRun + entry.intervalMs);
      }
      if (nextTick > target || nextTick === Infinity) {
        break;
      }
      currentTime = nextTick;
      for (const entry of handlers.values()) {
        if (entry.lastRun + entry.intervalMs <= currentTime) {
          entry.lastRun = currentTime;
          entry.handler();
        }
      }
      // 让 pollOnce 的 await 链有机会 resolve。
      await Promise.resolve();
      await Promise.resolve();
    }
    currentTime = target;
  }
  return { timers, advance, activeCount: () => handlers.size };
}

function enqueueResponse(overrides: Partial<NodeGraphRunEnqueueResponse> = {}): NodeGraphRunEnqueueResponse {
  return {
    job_id: "job_1",
    created: true,
    dedupe_key: null,
    graph_id: "g1",
    graph_version_id: "v1",
    worker_enabled: true,
    ...overrides,
  };
}

function runRecordResponse(status: string): NodeGraphRunRecordResponse {
  return {
    run: {
      id: "ngrun_1",
      graph_id: "g1",
      graph_version_id: "v1",
      status,
      intent: "dry_run",
      session_id: null,
      floor_id: null,
      page_id: null,
      trace: null,
      cleaned_at: null,
      created_at: 1,
      updated_at: 2,
    },
    node_runs: [
      {
        id: "nr1",
        graph_run_id: "ngrun_1",
        node_id: "n_a",
        phase: "commit",
        status: status === "succeeded" ? "succeeded" : "running",
        input_hash: null,
        output_hash: null,
        started_at: 1,
        finished_at: 2,
      },
  ],
    restricted: true,
  };
}

/** 在 effectScope 内运行 composable，返回句柄与销毁函数（避免 onUnmounted 警告）。 */
function withGraphRun(...args: Parameters<typeof useGraphRun>) {
  const scope = effectScope();
  const result = scope.run(() => useGraphRun(...args))!;
  return { ...result, dispose: () => scope.stop() };
}

describe("useGraphRun", () => {
  it("marks queued when run only returns job id (no run id)", async () => {
    const api: GraphRunApi = {
      run: vi.fn().mockResolvedValue(enqueueResponse({ worker_enabled: false })),
      getRun: vi.fn(),
    };
    const { state, runGraph, dispose } = withGraphRun({ api });
    await runGraph({ projectId: "p1", graphId: "g1" });
    expect(state.value.status).toBe("queued");
    expect(state.value.queuedWithoutRun).toBe(true);
    expect(state.value.jobId).toBe("job_1");
    expect(state.value.workerEnabled).toBe(false);
    expect(api.getRun).not.toHaveBeenCalled();
   dispose();
  });

  it("polls getRun and reaches succeeded when run id is provided", async () => {
    const { timers, advance, activeCount } = createManualTimers();
    const getRun = vi
      .fn()
      .mockResolvedValueOnce(runRecordResponse("running"))
      .mockResolvedValue(runRecordResponse("succeeded"));
    const api: GraphRunApi = {
      run: vi.fn().mockResolvedValue(enqueueResponse({ run_id: "ngrun_1" })),
      getRun,
    };
    const { state, runGraph, dispose } = withGraphRun({ api, timers, pollIntervalMs: 1000, pollTimeoutMs: 60_000 });
    await runGraph({ projectId: "p1", graphId: "g1" });
    // 立即拉取一次（running）。
    await Promise.resolve();
    await Promise.resolve();
    expect(state.value.runId).toBe("ngrun_1");

    await advance(1000);
    expect(state.value.status).toBe("succeeded");
    expect(state.value.nodeStatusById).toEqual({ n_a: "succeeded" });
    // 终态后应停止轮询。
    expect(activeCount()).toBe(0);
    dispose();
  });

  it("times out and keeps existing node status", async () => {
    const { timers, advance } = createManualTimers();
    const api: GraphRunApi = {
      run: vi.fn().mockResolvedValue(enqueueResponse({ run_id: "ngrun_1" })),
      getRun: vi.fn().mockResolvedValue(runRecordResponse("running")),
    };
    const { state, runGraph, dispose } = withGraphRun({ api, timers, pollIntervalMs: 1000, pollTimeoutMs: 3000 });
    await runGraph({ projectId: "p1", graphId: "g1" });
    await Promise.resolve();
    await Promise.resolve();
    await advance(5000);
    expect(state.value.status).toBe("timeout");
    dispose();
  });

  it("marks failed when run request throws", async () => {
    const api: GraphRunApi = {
      run: vi.fn().mockRejectedValue(new Error("boom")),
      getRun: vi.fn(),
    };
    const { state, runGraph, dispose } = withGraphRun({api });
    await runGraph({ projectId: "p1", graphId: "g1" });
    expect(state.value.status).toBe("failed");
    expect(state.value.errorMessage).toBe("boom");
    dispose();
  });

  it("clearRunState resets to idle and stops polling", async () => {
    const { timers, activeCount } = createManualTimers();
    const api: GraphRunApi = {
      run: vi.fn().mockResolvedValue(enqueueResponse({ run_id: "ngrun_1" })),
      getRun: vi.fn().mockResolvedValue(runRecordResponse("running")),
    };
    const { state, runGraph, clearRunState, dispose } = withGraphRun({ api, timers });
    await runGraph({ projectId: "p1", graphId: "g1" });
    await Promise.resolve();
    expect(activeCount()).toBe(1);
    clearRunState();
    expect(state.value.status).toBe("idle");
    expect(state.value.nodeStatusById).toEqual({});
    expect(activeCount()).toBe(0);
    dispose();
  });

  it("stops polling after consecutive getRun errors", async () => {
    const { timers, advance } = createManualTimers();
    const api: GraphRunApi = {
      run: vi.fn().mockResolvedValue(enqueueResponse({ run_id: "ngrun_1" })),
      getRun: vi.fn().mockRejectedValue(new Error("net")),
    };
    const { state, runGraph, dispose } = withGraphRun({ api, timers, pollIntervalMs: 1000, pollTimeoutMs: 60_000 });
    await runGraph({ projectId: "p1", graphId: "g1" });
    await Promise.resolve();
    await Promise.resolve();
    // 立即一次 + 两次间隔 = 3 次失败，达到阈值。
    await advance(1000);
 await advance(1000);
    expect(state.value.status).toBe("failed");
    expect(state.value.errorMessage).toBe("poll_failed");
    dispose();
  });
});
