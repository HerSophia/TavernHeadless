import { onUnmounted, ref } from "vue";

import { nodeGraphApi } from "../../../lib/nodegraph-api";
import type {
  NodeGraphRunEnqueueResponse,
  NodeGraphRunInput,
  NodeGraphRunRecordResponse,
} from "../../../lib/nodegraph-api/types";
import {
  createIdleRunState,
  isTerminalRunStatus,
  mapRunRecordStatusToUiStatus,
  mapRunRecordToNodeStatusById,
  readJobIdFromRunResponse,
  readRunIdFromRunResponse,
  readRunRecord,
  type GraphEditorRunState,
} from "./graph-run-view";

/** 轮询间隔（毫秒）。 */
const POLL_INTERVAL_MS = 1000;
/** 轮询最大时长（毫秒），超时后停止并保留已有状态。 */
const POLL_TIMEOUT_MS = 60_000;
/** getRun 连续失败达到该阈值后停止轮询并标记失败。 */
const MAX_CONSECUTIVE_POLL_ERRORS = 3;

/** 注入用的最小 API 契约，便于测试替身。 */
export interface GraphRunApi {
  run(
    projectId: string,
    graphId: string,
    input?: NodeGraphRunInput,
  ): Promise<NodeGraphRunEnqueueResponse>;
  getRun(projectId: string, runId: string): Promise<NodeGraphRunRecordResponse>;
}

/** 可注入的定时器契约，便于测试用 fake timers 或手动推进。 */
export interface GraphRunTimers {
  setInterval(handler: () => void, ms: number): number;
  clearInterval(handle: number): void;
  now(): number;
}

const defaultTimers: GraphRunTimers = {
  setInterval: (handler, ms) => globalThis.setInterval(handler, ms) as unknown as number,
  clearInterval: (handle) => globalThis.clearInterval(handle),
  now: () => Date.now(),
};

export interface RunGraphInput {
  projectId: string;
  graphId: string;
  input?: NodeGraphRunInput;
}

export interface UseGraphRunOptions {
  api?: GraphRunApi;
  timers?: GraphRunTimers;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}

/**
 * NG2-4 运行状态机 composable。
 *
 * 职责：提交安全运行、（拿到 run id 时）轮询 getRun、把节点级状态映射进 run state、
 * 停止刷新与清除状态。请求与轮询解析逻辑委托给 `graph-run-view.ts` 的纯函数。
 *
 * 当前后端 `/run` 只返回 job_id，run record 由 worker 执行时才创建且 id 不回传，
 * 因此常见路径为 `queued`（不伪造节点状态）。若后端未来在响应中带 run_id，则自动进入轮询。
 */
export function useGraphRun(options: UseGraphRunOptions = {}) {
  const api = options.api ?? nodeGraphApi;
  const timers = options.timers ?? defaultTimers;
  const pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
  const pollTimeoutMs = options.pollTimeoutMs ?? POLL_TIMEOUT_MS;

  const state = ref<GraphEditorRunState>(createIdleRunState());

  let pollHandle: number | null = null;
  let pollStartedAt = 0;
  let consecutiveErrors = 0;
  let activeProjectId: string | null = null;
  let activeRunId: string | null = null;

  function stopPolling(): void {
    if (pollHandle !== null) {
      timers.clearInterval(pollHandle);
      pollHandle = null;
    }
  }

  /** 清除前端运行状态叠加（不删除后端记录）。 */
  function clearRunState(): void {
    stopPolling();
    activeProjectId = null;
    activeRunId = null;
    consecutiveErrors = 0;
    state.value = createIdleRunState();
  }

  async function pollOnce(): Promise<void> {
    if (!activeProjectId || !activeRunId) {
      return;
    }
    // 超时：停止轮询，保留已有节点状态，标记 timeout。
    if (timers.now() - pollStartedAt >= pollTimeoutMs) {
      stopPolling();
      state.value = { ...state.value, status: "timeout" };
      return;
    }
    let response: NodeGraphRunRecordResponse;
    try {
      response = await api.getRun(activeProjectId, activeRunId);
    } catch {
      consecutiveErrors += 1;
      if (consecutiveErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
        stopPolling();
        state.value = {
          ...state.value,
          status: "failed",
          errorMessage: "poll_failed",
        };
      }
      return;
    }
    consecutiveErrors = 0;
    const record = readRunRecord(response);
    const nodeStatusById = mapRunRecordToNodeStatusById(response);
    const uiStatus = mapRunRecordStatusToUiStatus(record?.status);
    state.value = {
      ...state.value,
      status: uiStatus,
      // 保留已有节点状态：新记录为空时不清空之前拿到的状态，方便排查。
     nodeStatusById:
        Object.keys(nodeStatusById).length > 0 ? nodeStatusById : state.value.nodeStatusById,
      finishedAt: isTerminalRunStatus(record?.status) ? timers.now() : state.value.finishedAt,
    };
    if (isTerminalRunStatus(record?.status)) {
      stopPolling();
    }
  }

  function startPolling(projectId: string, runId: string): void {
    stopPolling();
    activeProjectId = projectId;
    activeRunId = runId;
    consecutiveErrors = 0;
    pollStartedAt = timers.now();
    // 立即拉取一次，随后按间隔轮询。
    void pollOnce();
    pollHandle = timers.setInterval(() => {
      void pollOnce();
    }, pollIntervalMs);
  }

  /**
 * 提交一次运行。再次运行前会先停止旧轮询并清空状态。
   *
   * 拿到run_id 时进入轮询；只有 job_id 时标记 queued 并提示 worker 状态。
   */
  async function runGraph(payload: RunGraphInput): Promise<void> {
    stopPolling();
    activeRunId = null;
    consecutiveErrors = 0;
    state.value = { status: "submitting", nodeStatusById: {} };

    let response: NodeGraphRunEnqueueResponse;
    try {
      response = await api.run(payload.projectId, payload.graphId, payload.input);
    } catch (error) {
      state.value = {
        status: "failed",
        nodeStatusById: {},
        errorMessage: error instanceof Error ? error.message : "run_failed",
      };
      return;
    }

    const jobId = readJobIdFromRunResponse(response) ?? undefined;
    const runId = readRunIdFromRunResponse(response);
    const workerEnabled = response.worker_enabled;

    if (runId) {
      state.value = {
        status: "running",
        runId,
        jobId,
        workerEnabled,
        startedAt: timers.now(),
        nodeStatusById: {},
      };
      startPolling(payload.projectId, runId);
      return;
    }

    // 只入队：无 run id，无法查询节点状态，只显示入队提示。
    state.value = {
      status: "queued",
      jobId,
      workerEnabled,
      queuedWithoutRun: true,
      startedAt: timers.now(),
      nodeStatusById: {},
    };
  }

  onUnmounted(() => {
    stopPolling();
  });

  return {
    state,
       runGraph,
    startPolling,
    stopPolling,
    clearRunState,
  };
}
