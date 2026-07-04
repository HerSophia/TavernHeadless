import type { NodeGraphNodeRunStatus } from "@tavern/core/node-graph";

import type {
  NodeGraphRunEnqueueResponse,
  NodeGraphRunRecord,
  NodeGraphRunRecordResponse,
} from "../../../lib/nodegraph-api/types";

/**
 * NG2-4 运行 view model 纯函数层。
 *
 * 这层只负责把后端 run / getRun 响应解析为编辑器可用的状态，不做任何请求或轮询。
 *请求、轮询与生命周期由 `use-graph-run.ts` 承接；把解析逻辑集中在这里是为了可测。
 */

/** GraphView 工具栏用的运行 UI 状态（前端语义，非后端 run.status 原样）。 */
export type GraphEditorRunUiStatus =
  | "idle"
  | "submitting"
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timeout";

/** 节点级运行状态合法值集合（对齐 core `NodeGraphNodeRunStatus`）。 */
const NODE_RUN_STATUSES: readonly NodeGraphNodeRunStatus[] = [
  "skipped",
  "running",
  "succeeded",
  "failed",
  "reused",
];

/** 运行整体状态视图，供 GraphView 展示与画布叠加。 */
export interface GraphEditorRunState {
  status: GraphEditorRunUiStatus;
  runId?: string;
  jobId?: string;
  startedAt?: number;
  finishedAt?: number;
  /** 人类可读的错误概要（失败 / 超时 / 只入队等）。 */
  errorMessage?: string;
  /** 只有 jobId、无 runId 时为 true：不能查询节点状态，只显示入队提示。 */
  queuedWithoutRun?: boolean;
  /** 后端 worker是否启用（入队后是否会被消费）。 */
  workerEnabled?: boolean;
  /** 节点级状态叠加（按 nodeId），传给 GraphCanvas。 */
  nodeStatusById: Record<string, NodeGraphNodeRunStatus>;
}

/** 节点状态统计摘要，用于运行状态小面板。 */
export interface GraphRunNodeStatusSummary {
  total: number;
  running: number;
  succeeded: number;
  failed: number;
  skipped: number;
  reused: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeRunStatus(value: unknown): value is NodeGraphNodeRunStatus {
  return typeof value === "string" && (NODE_RUN_STATUSES as readonly string[]).includes(value);
}

/** 初始 idle 运行状态。 */
export function createIdleRunState(): GraphEditorRunState {
  return { status: "idle", nodeStatusById: {} };
}

/**
 * 从 run 提交响应中读取 run id。
 *
 * 当前后端 `/run`只返回 `job_id`，run record 由 worker 执行时才创建，因此通常返回 null。
 * 保留此函数是为兼容后端未来可能在同步 dry-run 场景直接回传 `run_id`。
 */
export function readRunIdFromRunResponse(
  response: NodeGraphRunEnqueueResponse | null | undefined,
): string | null {
  if (!response) {
    return null;
  }
  const runId = response.run_id;
  return typeof runId === "string" && runId.length > 0 ? runId : null;
}

/** 从 run 提交响应中读取 job id。 */
export function readJobIdFromRunResponse(
  response: NodeGraphRunEnqueueResponse | null | undefined,
): string | null {
  if (!response) {
    return null;
  }
  return typeof response.job_id === "string" && response.job_id.length > 0 ? response.job_id : null;
}

/**
 * 从 run record 响应中提取每个 nodeId 的运行状态。
 *
 * 优先读取结构化的 `node_runs` 数组（后端 getRun 主路径）。同一 nodeId 出现多条时后写覆盖
 * （node_runs按 started_at 升序，靠后的 phase 状态更能代表节点最终态）。
 * 若 `node_runs` 缺失，回退到保守解析 `run.trace`。找不到时返回空对象，不抛异常。
 */
export function mapRunRecordToNodeStatusById(
  response: NodeGraphRunRecordResponse |null | undefined,
): Record<string, NodeGraphNodeRunStatus> {
  const result: Record<string, NodeGraphNodeRunStatus> = {};
  if (!response) {
    return result;
  }

  const nodeRuns = response.node_runs;
  if (Array.isArray(nodeRuns) && nodeRuns.length > 0) {
    for (const nodeRun of nodeRuns) {
      if (!isRecord(nodeRun)) {
        continue;
      }
      const nodeId = nodeRun.node_id;
      const status = nodeRun.status;
      if (typeof nodeId === "string" && nodeId.length > 0 && isNodeRunStatus(status)) {
        result[nodeId] = status;
      }
    }
    if (Object.keys(result).length > 0) {
      return result;
    }
  }

  // 回退：从 trace 中保守提取节点运行记录（结构可能随后端演进，缺失时返回空对象）。
  return extractNodeStatusFromTrace(response.run?.trace);
}

/**
 * 从 run.trace 中保守提取节点运行状态。
 *
 * 兼容常见字段名：`nodeRuns` / `node_runs` / `nodes`，每条记录读取 `nodeId` / `node_id` 与
 * `status`。任何形状不匹配都跳过，不抛异常。
 */
function extractNodeStatusFromTrace(trace: unknown): Record<string, NodeGraphNodeRunStatus> {
  const result: Record<string, NodeGraphNodeRunStatus> = {};
  if (!isRecord(trace)) {
    return result;
  }
  const candidates = [trace.nodeRuns, trace.node_runs, trace.nodes];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) {
      continue;
    }
    for (const entry of candidate) {
      if (!isRecord(entry)) {
        continue;
      }
      const nodeId = entry.nodeId ?? entry.node_id;
      const status = entry.status;
      if (typeof nodeId === "string" && nodeId.length > 0 && isNodeRunStatus(status)) {
        result[nodeId] = status;
      }
    }
    if (Object.keys(result).length > 0) {
      return result;
    }
  }
  return result;
}

/** 统计节点级状态分布，供运行状态小面板展示。 */
export function summarizeNodeRunStatuses(
  nodeStatusById: Record<string, NodeGraphNodeRunStatus>,
): GraphRunNodeStatusSummary {
  const summary: GraphRunNodeStatusSummary = {
    total: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    reused: 0,
  };
  for (const status of Object.values(nodeStatusById)) {
    summary.total += 1;
    summary[status] += 1;
  }
  return summary;
}

/**
 * 把后端 run record 状态映射为前端 UI 状态。
 *
 * `running` 仍在进行；`succeeded` / `failed` / `cancelled` 为终态。未知状态回退为 `running`，
 * 让轮询继续直到超时，而不是错误地判定完成。
 */
export function mapRunRecordStatusToUiStatus(
  status: string | null | undefined,
): GraphEditorRunUiStatus {
  switch (status) {
    case "succeeded":
      return "succeeded";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
 case "running":
      return "running";
    default:
      return "running";
  }
}

/** run.status 是否为终态（可停止轮询）。 */
export function isTerminalRunStatus(status: string | null | undefined): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

/** 读取run record 主体（后端返回 `{ run, node_runs }`，此处安全取 run）。 */
export function readRunRecord(
  response: NodeGraphRunRecordResponse | null | undefined,
): NodeGraphRunRecord | null{
  if (!response || !isRecord(response.run)) {
    return null;
  }
  return response.run;
}
