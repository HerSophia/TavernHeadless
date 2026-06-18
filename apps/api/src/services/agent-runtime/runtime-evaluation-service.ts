/**
 * RuntimeEvaluationService：R6-4 最小评估指标闭环。
 *
 * 目标是“可采样、可记录、可对比”，不是一个完整评估平台。它从已有运行 trace
 * （`node_graph_run` / `node_graph_node_run` / agent `runtime_job`）采样，产出一份
 * **debug report**。评估结果只作为调试 / 派生输出参考，**不直接影响主叙事提交**，
 * 也不写入任何 live 状态。
 *
 * 指标分两类：
 *  - 可从运行 trace 直接计算的运维指标：latency、retry reuse、graph failure reason、
 *    nested job fan-out。
 *  - 需要打分器（grader / LLM 评审）才能得到的质量指标：player agency、state
 *    contradiction、memory quality、token usage。这些指标在报告里以
 *    `status = "not_sampled"` 占位，结构预留但不臆造数值。
 *
 * 同时预留一个 A/B baseline 数据结构与 `compareReports` 对比 helper，便于后续接入完整
 * 评估平台，但当前不启用真实 A/B 调度。
 */
import { and, desc, eq, inArray, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";

import type { AppDb, DbExecutor } from "../../db/client.js";
import { nodeGraphNodeRuns, nodeGraphRuns, runtimeJobs } from "../../db/schema.js";
import { RUNTIME_GOVERNANCE_CONTRACT_VERSION } from "../governance/runtime-governance-types.js";

type EvaluationDb = AppDb | DbExecutor;

/** Minimal R6 evaluation metric keys (design §7 evaluation contract). */
export const RUNTIME_EVALUATION_METRIC_KEYS = [
  "player_agency",
  "state_contradiction",
  "memory_quality",
  "latency",
  "token_usage",
  "retry_reuse",
  "graph_failure_reason",
  "nested_job_fan_out",
] as const;

export type RuntimeEvaluationMetricKey = (typeof RUNTIME_EVALUATION_METRIC_KEYS)[number];

/** `sampled` 表示从 trace 计算得到；`not_sampled` 表示需打分器，结构预留但无数值。 */
export type RuntimeEvaluationMetricStatus = "sampled" | "not_sampled";

export interface RuntimeEvaluationMetric {
  key: RuntimeEvaluationMetricKey;
  status: RuntimeEvaluationMetricStatus;
  value: number | null;
  unit: string | null;
  detail: Record<string, unknown>;
  note?: string;
}

export interface RuntimeEvaluationScope {
  accountId: string;
  projectId?: string | null;
  sessionId?: string | null;
  rootRunId?: string | null;
  limit?: number;
}

/**
 * A/B baseline 数据结构预留。R6-4 不做完整 A/B 平台，仅保留对比标签与开关，
 * 让后续平台化时不必重构报告结构。
 */
export interface RuntimeEvaluationAbBaselineSlot {
  enabled: false;
  baselineLabel: string | null;
  candidateLabel: string | null;
  note: string;
}

export interface RuntimeEvaluationReport {
  contractVersion: typeof RUNTIME_GOVERNANCE_CONTRACT_VERSION;
  kind: "runtime_evaluation_report";
  generatedAt: number;
  scope: {
    accountId: string;
    projectId: string | null;
    sessionId: string | null;
    rootRunId: string | null;
  };
  sample: {
    graphRunCount: number;
    agentJobCount: number;
    nodeRunCount: number;
  };
  metrics: Record<RuntimeEvaluationMetricKey, RuntimeEvaluationMetric>;
  abBaseline: RuntimeEvaluationAbBaselineSlot;
}

export interface RuntimeEvaluationMetricDelta {
  key: RuntimeEvaluationMetricKey;
  baselineValue: number | null;
  candidateValue: number | null;
  delta: number | null;
}

export interface RuntimeEvaluationComparison {
  contractVersion: typeof RUNTIME_GOVERNANCE_CONTRACT_VERSION;
  kind: "runtime_evaluation_comparison";
  generatedAt: number;
  baselineLabel: string | null;
  candidateLabel: string | null;
  deltas: RuntimeEvaluationMetricDelta[];
}

const DEFAULT_SAMPLE_LIMIT = 100;
const MAX_SAMPLE_LIMIT = 500;

export class RuntimeEvaluationService {
  constructor(private readonly db: EvaluationDb) {}

  /**
   * 采样运行 trace 并产出最小评估报告（debug report）。
   *
   * 报告不落库、不影响主叙事；调用方可选择把它作为 derived output 或调试结果展示。
   */
  evaluate(scope: RuntimeEvaluationScope, now = Date.now()): RuntimeEvaluationReport {
    assertNonEmpty(scope.accountId, "accountId");
    const limit = clampLimit(scope.limit);

    const graphRunFilters: SQL[] = [eq(nodeGraphRuns.accountId, scope.accountId)];
    pushOptionalFilter(graphRunFilters, nodeGraphRuns.projectId, scope.projectId);
    pushOptionalFilter(graphRunFilters, nodeGraphRuns.sessionId, scope.sessionId);
    const graphRunRows = this.db
      .select()
      .from(nodeGraphRuns)
      .where(and(...graphRunFilters))
      .orderBy(desc(nodeGraphRuns.createdAt))
      .limit(limit)
      .all();

    const scopedRuns = scope.rootRunId
      ? graphRunRows.filter((row) => {
          const trace = asRecord(parseJson(row.traceJson));
          return readString(trace.root_run_id) === scope.rootRunId || row.id === scope.rootRunId;
        })
      : graphRunRows;

    const runIds = scopedRuns.map((row) => row.id);
    const nodeRunRows = runIds.length > 0
      ? this.db
          .select()
          .from(nodeGraphNodeRuns)
          .where(inArray(nodeGraphNodeRuns.graphRunId, runIds))
          .all()
      : [];

    const agentJobFilters: SQL[] = [
      eq(runtimeJobs.accountId, scope.accountId),
      eq(runtimeJobs.jobType, "agent.run"),
    ];
    pushOptionalFilter(agentJobFilters, runtimeJobs.projectId, scope.projectId);
    pushOptionalFilter(agentJobFilters, runtimeJobs.sessionId, scope.sessionId);
    const agentJobRows = this.db
      .select()
      .from(runtimeJobs)
      .where(and(...agentJobFilters))
      .orderBy(desc(runtimeJobs.createdAt))
      .limit(limit)
      .all();

    const metrics = this.buildMetrics(scopedRuns, nodeRunRows);

    return {
      contractVersion: RUNTIME_GOVERNANCE_CONTRACT_VERSION,
      kind: "runtime_evaluation_report",
      generatedAt: now,
      scope: {
        accountId: scope.accountId,
        projectId: scope.projectId ?? null,
        sessionId: scope.sessionId ?? null,
        rootRunId: scope.rootRunId ?? null,
      },
      sample: {
        graphRunCount: scopedRuns.length,
        agentJobCount: agentJobRows.length,
        nodeRunCount: nodeRunRows.length,
      },
      metrics,
      abBaseline: {
        enabled: false,
        baselineLabel: null,
        candidateLabel: null,
        note: "A/B baseline structure reserved; full evaluation platform is out of scope for R6-4.",
      },
    };
  }

  /** A/B baseline 对比：对两份报告的数值指标求差，质量指标缺值时 delta 为 null。 */
  compareReports(
    baseline: RuntimeEvaluationReport,
    candidate: RuntimeEvaluationReport,
    options: { baselineLabel?: string; candidateLabel?: string; now?: number } = {},
  ): RuntimeEvaluationComparison {
    const deltas: RuntimeEvaluationMetricDelta[] = RUNTIME_EVALUATION_METRIC_KEYS.map((key) => {
      const baselineValue = baseline.metrics[key]?.value ?? null;
      const candidateValue = candidate.metrics[key]?.value ?? null;
      const delta = baselineValue !== null && candidateValue !== null
        ? roundTo(candidateValue - baselineValue, 4)
        : null;
      return { key, baselineValue, candidateValue, delta };
    });
    return {
      contractVersion: RUNTIME_GOVERNANCE_CONTRACT_VERSION,
      kind: "runtime_evaluation_comparison",
      generatedAt: options.now ?? Date.now(),
      baselineLabel: options.baselineLabel ?? null,
      candidateLabel: options.candidateLabel ?? null,
      deltas,
    };
  }

  private buildMetrics(
    graphRuns: Array<typeof nodeGraphRuns.$inferSelect>,
    nodeRuns: Array<typeof nodeGraphNodeRuns.$inferSelect>,
  ): Record<RuntimeEvaluationMetricKey, RuntimeEvaluationMetric> {
    return {
      player_agency: graderReservedMetric("player_agency"),
      state_contradiction: graderReservedMetric("state_contradiction"),
      memory_quality: graderReservedMetric("memory_quality"),
      token_usage: notSampledMetric(
        "token_usage",
        "Token usage is not exposed by node graph run trace; wire prompt runtime budget when available.",
      ),
      latency: this.buildLatencyMetric(nodeRuns),
      retry_reuse: this.buildRetryReuseMetric(graphRuns),
      graph_failure_reason: this.buildGraphFailureMetric(graphRuns),
      nested_job_fan_out: this.buildNestedJobFanOutMetric(graphRuns),
    };
  }

  private buildLatencyMetric(
    nodeRuns: Array<typeof nodeGraphNodeRuns.$inferSelect>,
  ): RuntimeEvaluationMetric {
    const durations: number[] = [];
    for (const run of nodeRuns) {
      if (typeof run.startedAt === "number" && typeof run.finishedAt === "number" && run.finishedAt >= run.startedAt) {
        durations.push(run.finishedAt - run.startedAt);
      }
    }
    if (durations.length === 0) {
      return notSampledMetric("latency", "No node run timing pairs available in sample.");
    }
    const avg = durations.reduce((sum, value) => sum + value, 0) / durations.length;
    return {
      key: "latency",
      status: "sampled",
      value: roundTo(avg, 2),
      unit: "ms",
      detail: {
        node_run_sample: durations.length,
        max_ms: Math.max(...durations),
        min_ms: Math.min(...durations),
      },
    };
  }

  private buildRetryReuseMetric(
    graphRuns: Array<typeof nodeGraphRuns.$inferSelect>,
  ): RuntimeEvaluationMetric {
    let reused = 0;
    let total = 0;
    for (const run of graphRuns) {
      const trace = asRecord(parseJson(run.traceJson));
      const statusCounts = asRecord(trace.statusCounts);
      for (const [status, count] of Object.entries(statusCounts)) {
        if (typeof count === "number") {
          total += count;
          if (status === "reused") {
            reused += count;
          }
        }
      }
    }
    if (total === 0) {
      return notSampledMetric("retry_reuse", "No node status counts available in sample.");
    }
    return {
      key: "retry_reuse",
      status: "sampled",
      value: roundTo(reused / total, 4),
      unit: "ratio",
      detail: { reused_node_runs: reused, total_node_runs: total },
    };
  }

  private buildGraphFailureMetric(
    graphRuns: Array<typeof nodeGraphRuns.$inferSelect>,
  ): RuntimeEvaluationMetric {
    if (graphRuns.length === 0) {
      return notSampledMetric("graph_failure_reason", "No graph runs in sample.");
    }
    let failed = 0;
    const reasonCounts: Record<string, number> = {};
    const statusCounts: Record<string, number> = {};
    for (const run of graphRuns) {
      statusCounts[run.status] = (statusCounts[run.status] ?? 0) + 1;
      if (run.status === "failed" || run.status === "cancelled") {
        failed += 1;
        const trace = asRecord(parseJson(run.traceJson));
        const reason = readString(trace.reason_code) ?? "unknown";
        reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
      }
    }
    return {
      key: "graph_failure_reason",
      status: "sampled",
      value: roundTo(failed / graphRuns.length, 4),
      unit: "ratio",
      detail: {
        failed,
        total: graphRuns.length,
        status_counts: statusCounts,
        reason_counts: reasonCounts,
      },
    };
  }

  private buildNestedJobFanOutMetric(
    graphRuns: Array<typeof nodeGraphRuns.$inferSelect>,
  ): RuntimeEvaluationMetric {
    if (graphRuns.length === 0) {
      return notSampledMetric("nested_job_fan_out", "No graph runs in sample.");
    }
    let totalNested = 0;
    let maxFanOut = 0;
    let runsWithNested = 0;
    for (const run of graphRuns) {
      const trace = asRecord(parseJson(run.traceJson));
      const refs = Array.isArray(trace.nestedJobRefs) ? trace.nestedJobRefs : [];
      const count = refs.length;
      totalNested += count;
      maxFanOut = Math.max(maxFanOut, count);
      if (count > 0) {
        runsWithNested += 1;
      }
    }
    return {
      key: "nested_job_fan_out",
      status: "sampled",
      value: roundTo(totalNested / graphRuns.length, 4),
      unit: "jobs_per_run",
      detail: {
        total_nested_jobs: totalNested,
        max_fan_out: maxFanOut,
        runs_with_nested_jobs: runsWithNested,
      },
    };
  }
}

function graderReservedMetric(key: RuntimeEvaluationMetricKey): RuntimeEvaluationMetric {
  return notSampledMetric(key, "Qualitative metric requires a grader; reserved by R6-4, not auto-sampled.");
}

function notSampledMetric(key: RuntimeEvaluationMetricKey, note: string): RuntimeEvaluationMetric {
  return { key, status: "not_sampled", value: null, unit: null, detail: {}, note };
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function pushOptionalFilter(filters: SQL[], column: AnySQLiteColumn, value: string | null | undefined): void {
  if (typeof value === "string" && value.trim().length > 0) {
    filters.push(eq(column, value.trim()));
  }
}

function parseJson(value: string | null): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function clampLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_SAMPLE_LIMIT;
  }
  return Math.min(MAX_SAMPLE_LIMIT, Math.max(1, Math.trunc(value)));
}

function assertNonEmpty(value: string, fieldName: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
}
