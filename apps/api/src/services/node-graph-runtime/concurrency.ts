/**
 * NodeGraph 运行的项目级跨图并发桶（R6-2，缺口 4）。
 *
 * 现有 run scope 只有同图 FIFO（scope key = workspace+project+graph），不同图之间可无限并发。
 * 本模块在入队前补一层 project 级 NodeGraph 运行并发上限，避免一个项目同时排入过多图运行。
 */
import { and, count, eq, inArray } from "drizzle-orm";

import type { AppDb, DbExecutor } from "../../db/client.js";
import { runtimeJobs } from "../../db/schema.js";
import { NODE_GRAPH_RUN_JOB_TYPE } from "../node-graph-runtime-job-definitions.js";

type ConcurrencyDb = AppDb | DbExecutor;

/** 仍占用 worker 容量的活跃状态。succeeded / dead_letter / cancelled 不计入。 */
const ACTIVE_GRAPH_RUN_STATUSES = ["pending", "leased", "running", "retry_waiting"] as const;

export function countActiveProjectGraphRunJobs(
  db: ConcurrencyDb,
  input: { accountId: string; projectId: string },
): number {
  const row = db
    .select({ value: count() })
    .from(runtimeJobs)
    .where(and(
      eq(runtimeJobs.accountId, input.accountId),
      eq(runtimeJobs.projectId, input.projectId),
      eq(runtimeJobs.jobType, NODE_GRAPH_RUN_JOB_TYPE),
      inArray(runtimeJobs.status, [...ACTIVE_GRAPH_RUN_STATUSES]),
    ))
    .get();
  return row?.value ?? 0;
}
