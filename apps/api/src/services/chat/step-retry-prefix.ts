import { asc, eq } from "drizzle-orm";
import type { AgentLoopPriorRoundtrip, ToolCallResult, ToolSideEffectLevel } from "@tavern/core";

import type { AppDb, DbExecutor } from "../../db/client.js";
import { toolExecutionRecords } from "../../db/schema.js";

/**
 * step 级重试前缀重建相关的错误。
 *
 * - `invalid_from_step_index`：fromStepIndex 非正整数。
 * - `step_retry_blocked_side_effect`：重试起点对应的工具带写类副作用，禁止以它为起点。
 */
export class StepRetryError extends Error {
  constructor(
    public readonly code: "invalid_from_step_index" | "step_retry_blocked_side_effect",
    message: string,
  ) {
    super(message);
    this.name = "StepRetryError";
  }
}

/**
 * 起点之前已产生、且不会随重试回滚的写类副作用条目。
 *
 * 来自 tool_execution_record 中 side_effect_level != none 且 generation_step_no < fromStepIndex 的执行。
 * 仅用于提示用户「这些副作用已经发生、不会回滚」，脱敏边界与 transcript / inspect 一致（只暴露摘要字段）。
 */
export interface StepRetryIrreversibleSideEffect {
  executionId: string;
  toolName: string;
  sideEffectLevel: ToolSideEffectLevel;
  startedAt: number;
  generationStepNo: number | null;
}

/** step 级重试前缀重建结果。 */
export interface StepRetryPrefixResult {
  /** 传给 agent loop 的前缀工具往返（按 stepIndex 升序）。 */
  priorRoundtrips: AgentLoopPriorRoundtrip[];
  /** 起点之前不可回滚的写类副作用清单。 */
  irreversibleSideEffects: StepRetryIrreversibleSideEffect[];
  /** 被丢弃并重新生成的起点步号（即 fromStepIndex）。 */
  discardedFromStepIndex: number;
}

type ToolExecutionRow = {
  id: string;
  runId: string;
  toolName: string;
  argsJson: string;
  resultJson: string;
  status: string;
  errorMessage: string | null;
  sideEffectLevel: ToolSideEffectLevel | null;
  commitOutcome: string | null;
  startedAt: number;
  generationStepNo: number | null;
};

/** 解析 args_json 为对象；非对象或解析失败时返回空对象。 */
function parseArgsJson(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) {
    return {};
  }
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
  : {};
  } catch {
    return {};
  }
}

/** 解析 result_json；解析失败时原样返回字符串。 */
function parseResultJson(raw: string | null | undefined): unknown {
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** 把一条执行记录还原为 core 的 ToolCallResult（失败状态走 error 分支，让模型续跑时看到错误）。 */
function toToolCallResult(row: ToolExecutionRow): ToolCallResult {
  const failed =
    row.status === "error" ||
    row.status === "denied" ||
    row.status === "timeout" ||
    row.status === "uncertain" ||
    row.status === "blocked";
  if (failed) {
    return { error: row.errorMessage ?? `tool '${row.toolName}' execution failed` };
  }
  return { data: parseResultJson(row.resultJson) };
}

/**
 * 为「从第 N 步重试」重建前缀工具往返，并算出起点之前的不可回滚副作用清单。
 *
 * 数据来源：tool_execution_record（工具执行主审计真相）。按 floor_id 取已提交执行，
 * 选取最近一次已提交生成（按 started_at 末行的 runId），再按 generation_step_no 分组；
 * 无该列时按 started_at 顺序每条执行各占一步（best-effort 回退）。
 *
 * 起点校验：fromStepIndex 对应步的工具若 side_effect_level !== "none"，抛 step_retry_blocked_side_effect。
 *
 * 注意：tool_execution_record 不存 call_id，这里用执行记录 id 作为 callId；
 * 往返内 tool-call 与 tool-result 用同一 id 配对，自洽且满足 SDK 要求。
 */
export async function buildPriorRoundtripsForStepRetry(args: {
  db: AppDb | DbExecutor;
  floorId: string;
  fromStepIndex: number;
}): Promise<StepRetryPrefixResult> {
  if (!Number.isInteger(args.fromStepIndex) || args.fromStepIndex < 1) {
    throw new StepRetryError(
      "invalid_from_step_index",
      `Step retry requires a positive integer fromStepIndex, got ${String(args.fromStepIndex)}`,
    );
  }

  const rows = (await args.db
    .select({
      id: toolExecutionRecords.id,
      runId: toolExecutionRecords.runId,
      toolName: toolExecutionRecords.toolName,
      argsJson: toolExecutionRecords.argsJson,
      resultJson: toolExecutionRecords.resultJson,
      status: toolExecutionRecords.status,
      errorMessage: toolExecutionRecords.errorMessage,
      sideEffectLevel: toolExecutionRecords.sideEffectLevel,
      commitOutcome: toolExecutionRecords.commitOutcome,
      startedAt: toolExecutionRecords.startedAt,
      generationStepNo: toolExecutionRecords.generationStepNo,
    })
    .from(toolExecutionRecords)
    .where(eq(toolExecutionRecords.floorId, args.floorId))
    .orderBy(asc(toolExecutionRecords.startedAt))) as ToolExecutionRow[];

  // 只取已提交执行作为前缀真相（未提交 / 被取代的执行不计入）。
  const committed = rows.filter((row) => row.commitOutcome === "committed");
  if (committed.length === 0) {
    return {
      priorRoundtrips: [],
      irreversibleSideEffects: [],
      discardedFromStepIndex: args.fromStepIndex,
    };
  }

  // 同一 floor 可能留有多次历史生成的执行：取最近一次已提交生成（按 started_at 末行的 runId）。
  const latestRunId = committed[committed.length - 1]!.runId;
  const activeRows = committed.filter((row) => row.runId === latestRunId);

  // 步号分组：优先 generation_step_no；缺失时按 started_at 顺序每条执行各占一步（best-effort 回退）。
  const hasStepNo = activeRows.every(
    (row) => row.generationStepNo !== null && row.generationStepNo !== undefined,
  );
  const stepOf = new Map<string, number>();
  if (hasStepNo) {
    for (const row of activeRows) {
      stepOf.set(row.id, row.generationStepNo as number);
    }
  } else {
    let seq = 0;
    for (const row of activeRows) {
      seq += 1;
      stepOf.set(row.id, seq);
    }
  }

  // 起点校验：fromStepIndex 对应步的工具必须无写类副作用。
  for (const row of activeRows) {
    if (
      stepOf.get(row.id) === args.fromStepIndex &&
      row.sideEffectLevel &&
      row.sideEffectLevel !== "none"
    ) {
      throw new StepRetryError(
        "step_retry_blocked_side_effect",
        `Cannot retry from step ${args.fromStepIndex}: tool '${row.toolName}' has side effect level '${row.sideEffectLevel}'.`,
      );
    }
  }

  // 收集前缀（step < fromStepIndex）：按步分组重建往返，并记录其中的写类副作用。
  const byStep = new Map<number, ToolExecutionRow[]>();
  const irreversibleSideEffects: StepRetryIrreversibleSideEffect[] = [];
  for (const row of activeRows) {
    const step = stepOf.get(row.id)!;
    if (step >= args.fromStepIndex) {
      continue;
    }
    const list = byStep.get(step) ?? [];
    list.push(row);
    byStep.set(step, list);
    if (row.sideEffectLevel && row.sideEffectLevel !== "none") {
      irreversibleSideEffects.push({
        executionId: row.id,
        toolName: row.toolName,
        sideEffectLevel: row.sideEffectLevel,
        startedAt: row.startedAt,
        generationStepNo: row.generationStepNo ?? null,
      });
    }
  }

  const priorRoundtrips: AgentLoopPriorRoundtrip[] = [...byStep.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([stepIndex, group]) => ({
      stepIndex,
      calls: group.map((row) => ({
        callId: row.id,
        toolName: row.toolName,
        args: parseArgsJson(row.argsJson),
        result: toToolCallResult(row),
      })),
    }));

  return {
    priorRoundtrips,
    irreversibleSideEffects,
    discardedFromStepIndex: args.fromStepIndex,
  };
}
