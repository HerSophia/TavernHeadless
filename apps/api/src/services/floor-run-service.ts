import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type {
  CoreEventBus,
  FloorRunError,
  FloorRunPendingOutput,
  FloorRunPendingOutputState,
  FloorRunPhase,
  FloorRunPublicPhase,
  FloorRunSnapshot,
  FloorRunStatus,
  FloorRunType,
  FloorRunVerifierIssue,
  FloorRunVerifierSnapshot,
  FloorRunVerifierStatus,
} from "@tavern/core";

import type { AppDb } from "../db/client.js";
import { floorRunStates, floors } from "../db/schema.js";

export interface SessionActiveRunSummary {
  branchId: string;
  latestFloorId?: string;
  activeRunId?: string;
  activeRunType?: FloorRunType;
  busy: boolean;
  publicPhase?: FloorRunPublicPhase;
  updatedAt: number;
}

export interface FloorRunRecord {
  floorId: string;
  state: typeof floors.$inferSelect["state"];
  run: FloorRunSnapshot | null;
}

export interface FloorRunIdentity {
  floorId: string;
  runId: string;
  runType: FloorRunType;
  attemptNo: number;
  status: FloorRunStatus;
}

interface PendingOutputPersistState {
  attemptNo: number;
  lastPersistedAt: number;
  lastPersistedLength: number;
  startedAt: number;
  tempId: string;
}

export interface FloorRunServiceOptions {
  pendingOutputMinPersistIntervalMs?: number;
  pendingOutputMinPersistChars?: number;
  staleRunTimeoutMs?: number;
  staleRunGracePeriodMs?: number;
}

/**
 * 重试 run 在被 executeTurn 显式 reopen 到 generating 之前所处的准备阶段集合。
 *
 * 楼层级 / step 级重试会先在「已提交楼层」上初始化一条新的 running run，之后才由 executeTurn
 * 走 reopenForRetry 把楼层从 committed 打开到 generating。在 reopen 之前存在一个短暂但真实的
 * 「committed + running」窗口（step 重试还要重建前缀往返、拉取会话窗口、组装 prompt，可能持续数秒）。
 * 这个集合用于在 stale 收尾里识别「正处于该准备窗口的重试 run」，从而不把它误当作 stale 收尾。
 */
const PRE_REOPEN_RETRY_PHASES: ReadonlySet<FloorRunPhase> = new Set<FloorRunPhase>([
  "input_recorded",
  "semantic_resolved",
  "prechecked",
  "prompt_assembled",
]);

function toPublicPhase(phase: FloorRunPhase): FloorRunPublicPhase {
  switch (phase) {
    case "input_recorded":
    case "semantic_resolved":
    case "prechecked":
    case "prompt_assembled":
      return "preparing";
    case "page_generating":
      return "generating";
    case "candidate_generated":
    case "verifier_checked":
      return "verifying";
    case "transaction_prepared":
    case "transaction_committed":
      return "committing";
    case "post_commit_scheduled":
      return "post_processing";
  }
}

function safeParseJson<T>(value: string | null | undefined): T | null {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function toErrorCode(error: Error | FloorRunError): string {
  if ("code" in error && typeof error.code === "string" && error.code.length > 0) {
    return error.code;
  }

  return error instanceof Error && error.name ? error.name : "floor_run_failed";
}

function toErrorMessage(error: Error | FloorRunError): string {
  return error.message || "Floor run failed";
}

export class FloorRunService {
  private readonly pendingOutputMinPersistIntervalMs: number;
  private readonly pendingOutputMinPersistChars: number;
  private readonly pendingOutputStates = new Map<string, PendingOutputPersistState>();
  private readonly staleRunMaxAgeMs: number;

  constructor(
    private readonly db: AppDb,
    private readonly eventBus?: CoreEventBus,
    options: FloorRunServiceOptions = {},
  ) {
    this.pendingOutputMinPersistIntervalMs = Math.max(
      100,
      options.pendingOutputMinPersistIntervalMs ?? 500,
    );
    this.pendingOutputMinPersistChars = Math.max(
      1,
      options.pendingOutputMinPersistChars ?? 1024,
    );
    this.staleRunMaxAgeMs = Math.max(
      1_000,
      (options.staleRunTimeoutMs ?? 60_000) + (options.staleRunGracePeriodMs ?? 30_000),
    );
  }

  async initializeRun(input: {
    sessionId: string;
    floorId: string;
    runType: FloorRunType;
    phase?: FloorRunPhase;
    startedAt?: number;
  }): Promise<FloorRunSnapshot | null> {
    const startedAt = input.startedAt ?? Date.now();
    const phase = input.phase ?? "input_recorded";
    const runId = nanoid();

    this.pendingOutputStates.delete(input.floorId);

    await this.db
      .insert(floorRunStates)
      .values({
        floorId: input.floorId,
        runId,
        runType: input.runType,
        status: "running",
        phase,
        publicPhase: toPublicPhase(phase),
        phaseSeq: 1,
        attemptNo: 1,
        pendingOutputJson: null,
        verifierJson: null,
        errorJson: null,
        startedAt,
        updatedAt: startedAt,
        completedAt: null,
      })
      .onConflictDoUpdate({
        target: floorRunStates.floorId,
        set: {
          runId,
          runType: input.runType,
          status: "running",
          phase,
          publicPhase: toPublicPhase(phase),
          phaseSeq: 1,
          attemptNo: 1,
          pendingOutputJson: null,
          verifierJson: null,
          errorJson: null,
          startedAt,
          updatedAt: startedAt,
          completedAt: null,
        },
      })
      .run();

    // 刚写入的 run 不可能是 stale；且重试会在旧的已提交楼层上初始化新 run，此时不能触发 stale 收尾。
    const snapshot = await this.getSnapshot(input.floorId, { reconcile: false });
    if (snapshot) {
            this.emitSnapshot(snapshot);
    }
    return snapshot;
  }

  async advancePhase(
    floorId: string,
    phase: FloorRunPhase,
    options: {
      attemptNo?: number;
      updatedAt?: number;
    } = {},
  ): Promise<FloorRunSnapshot | null> {
    const row = await this.getRunRow(floorId);
    if (!row) {
      return null;
    }

    const updatedAt = options.updatedAt ?? Date.now();
    await this.db
      .update(floorRunStates)
      .set({
        phase,
        publicPhase: toPublicPhase(phase),
        phaseSeq: row.phaseSeq + 1,
        attemptNo: options.attemptNo ?? row.attemptNo,
        updatedAt,
      })
      .where(eq(floorRunStates.floorId, floorId))
      .run();

    // 阶段推进只是刷新当前 run 的 phase，自身不是 stale；重试在 reopen 前楼层仍为 committed，
    // 不能因阶段推进而误触发 stale 收尾。
    const snapshot = await this.getSnapshot(floorId, { reconcile: false });
    if (snapshot) {
      this.emitSnapshot(snapshot);
    }
    return snapshot;
  }

  async startAttempt(
    floorId: string,
    input: {
      attemptNo: number;
      phase?: FloorRunPhase;
      updatedAt?: number;
    },
  ): Promise<FloorRunSnapshot | null> {
    const row = await this.getRunRow(floorId);
    if (!row) {
      return null;
    }

    const updatedAt = input.updatedAt ?? Date.now();
    const phase = input.phase ?? "page_generating";
    this.pendingOutputStates.delete(floorId);

    await this.db
      .update(floorRunStates)
      .set({
        status: "running",
        phase,
        publicPhase: toPublicPhase(phase),
        phaseSeq: row.phaseSeq + 1,
        attemptNo: input.attemptNo,
        pendingOutputJson: null,
        verifierJson: null,
        errorJson: null,
        completedAt: null,
        updatedAt,
      })
      .where(eq(floorRunStates.floorId, floorId))
      .run();

    const snapshot = await this.getSnapshot(floorId);
    if (snapshot) {
      this.emitSnapshot(snapshot);
    }
    return snapshot;
  }

  async updatePendingOutput(
    floorId: string,
    input: {
      text: string;
      state: FloorRunPendingOutputState;
      attemptNo: number;
      force?: boolean;
      error?: string;
    },
  ): Promise<FloorRunSnapshot | null> {
    const row = await this.getRunRow(floorId);
    if (!row) {
      return null;
    }

    const now = Date.now();
    const existing = this.pendingOutputStates.get(floorId);
    const persistState = !existing || existing.attemptNo !== input.attemptNo
      ? {
          attemptNo: input.attemptNo,
          lastPersistedAt: 0,
          lastPersistedLength: 0,
          startedAt: now,
          tempId: `temp-${row.runId}-${input.attemptNo}-${nanoid(6)}`,
        }
      : existing;

    const shouldPersist = input.force === true
      || input.state !== "streaming"
      || now - persistState.lastPersistedAt >= this.pendingOutputMinPersistIntervalMs
      || Math.max(0, input.text.length - persistState.lastPersistedLength) >= this.pendingOutputMinPersistChars;

    this.pendingOutputStates.set(floorId, persistState);

    if (!shouldPersist) {
      return null;
    }

    const pendingOutput: FloorRunPendingOutput = {
      tempId: persistState.tempId,
      attemptNo: input.attemptNo,
      state: input.state,
      text: input.text,
      startedAt: persistState.startedAt,
      updatedAt: now,
      ...(input.error ? { error: input.error } : {}),
    };

    await this.db
      .update(floorRunStates)
      .set({
        attemptNo: input.attemptNo,
        pendingOutputJson: JSON.stringify(pendingOutput),
        phaseSeq: row.phaseSeq + 1,
        updatedAt: now,
      })
      .where(eq(floorRunStates.floorId, floorId))
      .run();

    persistState.lastPersistedAt = now;
    persistState.lastPersistedLength = input.text.length;
    this.pendingOutputStates.set(floorId, persistState);

    const snapshot = await this.getSnapshot(floorId);
    if (snapshot) {
      this.emitSnapshot(snapshot);
    }
    return snapshot;
  }

  async updateVerifier(
    floorId: string,
    input: {
      status: FloorRunVerifierStatus;
      suggestion?: string;
      issues?: FloorRunVerifierIssue[];
    },
  ): Promise<FloorRunSnapshot | null> {
    const row = await this.getRunRow(floorId);
    if (!row) {
      return null;
    }

    const verifier: FloorRunVerifierSnapshot = {
      status: input.status,
      ...(input.suggestion ? { suggestion: input.suggestion } : {}),
      ...(input.issues && input.issues.length > 0 ? { issues: input.issues } : {}),
    };

    await this.db
      .update(floorRunStates)
      .set({
        verifierJson: JSON.stringify(verifier),
        phaseSeq: row.phaseSeq + 1,
        updatedAt: Date.now(),
      })
      .where(eq(floorRunStates.floorId, floorId))
      .run();

    const snapshot = await this.getSnapshot(floorId);
    if (snapshot) {
      this.emitSnapshot(snapshot);
    }
    return snapshot;
  }

  async markFailed(
    floorId: string,
    error: Error | FloorRunError,
    options: {
      updatedAt?: number;
    } = {},
  ): Promise<FloorRunSnapshot | null> {
    const row = await this.getRunRow(floorId);
    if (!row) {
      return null;
    }

    const updatedAt = options.updatedAt ?? Date.now();
    const payload: FloorRunError = {
      code: toErrorCode(error),
      message: toErrorMessage(error),
    };

    await this.db
      .update(floorRunStates)
      .set({
        status: "failed",
        errorJson: JSON.stringify(payload),
        completedAt: updatedAt,
        phaseSeq: row.phaseSeq + 1,
        updatedAt,
      })
      .where(eq(floorRunStates.floorId, floorId))
      .run();

    const snapshot = await this.getSnapshot(floorId);
    if (snapshot) {
      this.emitSnapshot(snapshot);
    }
    return snapshot;
  }

  async markCancelled(
    floorId: string,
    error: Error | FloorRunError = {
      code: "floor_run_cancelled",
      message: "Floor run was cancelled",
    },
    options: {
      updatedAt?: number;
    } = {},
  ): Promise<FloorRunSnapshot | null> {
    const row = await this.getRunRow(floorId);
    if (!row) {
      return null;
    }

    const updatedAt = options.updatedAt ?? Date.now();
    const payload: FloorRunError = {
      code: toErrorCode(error),
      message: toErrorMessage(error),
    };

    await this.db
      .update(floorRunStates)
      .set({
        status: "cancelled",
        errorJson: JSON.stringify(payload),
        completedAt: updatedAt,
        phaseSeq: row.phaseSeq + 1,
        updatedAt,
      })
      .where(eq(floorRunStates.floorId, floorId))
      .run();

    this.pendingOutputStates.delete(floorId);

    const snapshot = await this.getSnapshot(floorId);
    if (snapshot) {
      this.emitSnapshot(snapshot);
    }
    return snapshot;
  }

  async markCompleted(
    floorId: string,
    options: {
      clearPendingOutput?: boolean;
      updatedAt?: number;
    } = {},
  ): Promise<FloorRunSnapshot | null> {
    const row = await this.getRunRow(floorId);
    if (!row) {
      return null;
    }

    const updatedAt = options.updatedAt ?? Date.now();
    await this.db
      .update(floorRunStates)
      .set({
        status: "completed",
        pendingOutputJson: options.clearPendingOutput === false ? row.pendingOutputJson : null,
        completedAt: updatedAt,
        phaseSeq: row.phaseSeq + 1,
        updatedAt,
      })
      .where(eq(floorRunStates.floorId, floorId))
      .run();

    if (options.clearPendingOutput !== false) {
      this.pendingOutputStates.delete(floorId);
    }

    const snapshot = await this.getSnapshot(floorId);
    if (snapshot) {
      this.emitSnapshot(snapshot);
    }
    return snapshot;
  }

  async getFloorRunRecord(floorId: string): Promise<FloorRunRecord | null> {
    const floorRow = await this.getFloorRow(floorId);
    if (!floorRow) {
      return null;
    }

    const run = await this.getSnapshot(floorId);
    const latestFloorRow = await this.getFloorRow(floorId);

    return {
      floorId: (latestFloorRow ?? floorRow).id,
      state: (latestFloorRow ?? floorRow).state,
      run,
    };
  }

  /**
   * 按 `runId` 取最终态记录（RT3 缺口补发的 DB 兜底来源）。
   *
   * `floor_run_state` 以 `floorId` 为主键、每个 floor 仅保留「当前/最新」一条 run，
   * `runId` 列在 `initializeRun` 时被覆盖。因此只有当传入的 `runId` 仍是该 floor 当前的 run
   * 时才能命中；若该 run 已被新的 run 取代，则视为已不可回放，返回 null。
   *
   * 只读：复用既有 `getFloorRunRecord`（含 `getSnapshot` 的 stale 校正），不改写库结构；
   * `floor_run_state.runId` 已有索引（`floor_run_state_run_id_idx`），无需新增迁移。
   */
  async getFloorRunRecordByRunId(runId: string): Promise<FloorRunRecord | null> {
    const [row] = await this.db
      .select({ floorId: floorRunStates.floorId })
      .from(floorRunStates)
      .where(eq(floorRunStates.runId, runId))
      .limit(1);

    if (!row) {
      return null;
    }

    const record = await this.getFloorRunRecord(row.floorId);
    if (!record || !record.run || record.run.runId !== runId) {
      return null;
    }
    return record;
  }

  async getActiveRunForFloor(floorId: string): Promise<FloorRunSnapshot | null> {
    const snapshot = await this.getSnapshot(floorId);
    return snapshot?.status === "running" ? snapshot : null;
  }

  async getRunIdentity(floorId: string): Promise<FloorRunIdentity | null> {
    const row = await this.getRunRow(floorId);
    if (!row) {
      return null;
    }

    return {
      floorId: row.floorId,
      runId: row.runId,
      runType: row.runType as FloorRunType,
      attemptNo: row.attemptNo,
      status: row.status as FloorRunStatus,
    };
  }

  async isCurrentAttempt(input: {
    floorId: string;
    runId: string;
    attemptNo: number;
  }): Promise<boolean> {
    const row = await this.getRunRow(input.floorId);
    return Boolean(
      row &&
    row.status === "running" &&
      row.runId === input.runId &&
      row.attemptNo === input.attemptNo,
    );
  }

  async getActiveRunSummary(sessionId: string, branchId?: string): Promise<SessionActiveRunSummary | null> {
    const conditions = [eq(floors.sessionId, sessionId), eq(floorRunStates.status, "running")];
    if (branchId) {
      conditions.push(eq(floors.branchId, branchId));
    }

    const rows = await this.db
      .select({
        branchId: floors.branchId,
        floorId: floors.id,
      })
      .from(floorRunStates)
      .innerJoin(floors, eq(floorRunStates.floorId, floors.id))
      .where(and(...conditions))
      .orderBy(desc(floorRunStates.updatedAt))
      .all();

    for (const row of rows) {
      const snapshot = await this.getSnapshot(row.floorId);
      if (!snapshot || snapshot.status !== "running") {
        continue;
      }

      return {
        branchId: row.branchId,
        latestFloorId: row.floorId,
        activeRunId: snapshot.runId,
        activeRunType: snapshot.runType,
        busy: true,
        publicPhase: snapshot.publicPhase,
        updatedAt: snapshot.updatedAt,
      };
    }

    return null;
  }

  /**
   * 读取楼层的 run 快照。
   *
   * reconcile 默认开启：对「楼层已终态但 run 快照仍 running」的滞后情形做 stale 自愈收尾，
   * 适用于外部只读查询。写操作（initializeRun / advancePhase）结尾为发事件而读快照时应传
   * reconcile: false —— 刚写入的 run 不可能是 stale；且重试会先在旧的已提交楼层上创建 / 推进
   * 新 run（reopen 到 generating 发生在 executeTurn 内、更晚），此时若误触发 stale 收尾会把本次
   * 回合的 run 提前标为 completed，导致统一提交边界把本次回合误判为 attempt_not_current。
   */
  async getSnapshot(
    floorId: string,
    options: { reconcile?: boolean } = {},
  ): Promise<FloorRunSnapshot | null> {
    const runRow = await this.getRunRow(floorId);
    if (!runRow) {
      return null;
    }

    const floorRow = await this.getFloorRow(floorId);
    if (!floorRow) {
      return null;
    }

    const reconciledRunRow = options.reconcile === false
      ? runRow
      : await this.reconcileStaleRunRow(floorRow, runRow);
    return {
      sessionId: floorRow.sessionId,
      floorId: reconciledRunRow.floorId,
      runId: reconciledRunRow.runId,
      runType: reconciledRunRow.runType as FloorRunType,
      status: reconciledRunRow.status as FloorRunStatus,
      phase: reconciledRunRow.phase as FloorRunPhase,
      publicPhase: reconciledRunRow.publicPhase as FloorRunPublicPhase,
      phaseSeq: reconciledRunRow.phaseSeq,
      attemptNo: reconciledRunRow.attemptNo,
      startedAt: reconciledRunRow.startedAt,
      updatedAt: reconciledRunRow.updatedAt,
      completedAt: reconciledRunRow.completedAt,
      pendingOutput: safeParseJson<FloorRunPendingOutput>(reconciledRunRow.pendingOutputJson),
      verifier: safeParseJson<FloorRunVerifierSnapshot>(reconciledRunRow.verifierJson),
      error: safeParseJson<FloorRunError>(reconciledRunRow.errorJson),
    };
  }

  private async reconcileStaleRunRow(
    floorRow: typeof floors.$inferSelect,
    runRow: typeof floorRunStates.$inferSelect,
  ): Promise<typeof floorRunStates.$inferSelect> {
    if (runRow.status !== "running") {
      return runRow;
    }

    const updatedAt = Math.max(Date.now(), floorRow.updatedAt, runRow.updatedAt);
    if (floorRow.state === "committed") {
      // 重试会在「已提交楼层」上先建 run、再由 executeTurn 显式 reopen 到 generating。
      // 在 reopen 之前存在一个短暂但真实的「committed + running」窗口。这期间任何走 reconcile
      // 的读取（内部发事件回读、或外部轮询 GET /sessions/:id/active-run 等）都会把这条刚建好的
      // 重试 run 误判为 stale 并收尾成 completed；随后 commit 的 attempt 并发校验读到非 running
      // 状态，就会抛出 attempt_not_current。
      //
      // 因此仅当 run 是「重试类型且仍处于 reopen 前的准备阶段、且最近仍有活动」时，视为进行中的
      // 重试而不收尾；其余情形（正常回合已提交但 markCompleted 漏标、被取代的旧 attempt、已进入
      // 生成阶段却仍显示 committed 等）仍按 stale 收尾。若准备阶段的重试 run 长时间无活动（进程崩溃
      // 等极端情况），超过 stale 窗口后仍会被收尾，避免会话永久卡在 busy。
      const isRetryPreparingForReopen =
        (runRow.runType === "retry_turn" || runRow.runType === "retry_step") &&
        PRE_REOPEN_RETRY_PHASES.has(runRow.phase as FloorRunPhase) &&
        Date.now() - runRow.updatedAt <= this.staleRunMaxAgeMs;
      if (!isRetryPreparingForReopen) {
        await this.markCompleted(floorRow.id, { updatedAt });
        return (await this.getRunRow(floorRow.id)) ?? runRow;
      }
      return runRow;
    }

    if (floorRow.state === "failed") {
      await this.markFailed(
        floorRow.id,
        {
          code: "stale_floor_run_reconciled",
          message: `Floor '${floorRow.id}' was already failed while its run snapshot was still marked running`,
        },
        { updatedAt },
      );
      return (await this.getRunRow(floorRow.id)) ?? runRow;
    }

    const lastProgressAt = Math.max(floorRow.updatedAt, runRow.updatedAt);
    if (floorRow.state === "generating" && Date.now() - lastProgressAt > this.staleRunMaxAgeMs) {
      await this.markFailed(
        floorRow.id,
        {
          code: "stale_floor_run_timeout",
          message: `Floor run '${runRow.runId}' exceeded the stale timeout window while floor '${floorRow.id}' remained generating`,
        },
        { updatedAt },
      );
      await this.db
        .update(floors)
        .set({ state: "failed", updatedAt })
        .where(and(eq(floors.id, floorRow.id), eq(floors.state, "generating")))
        .run();
      return (await this.getRunRow(floorRow.id)) ?? runRow;
    }

    return runRow;
  }

  private async getFloorRow(floorId: string): Promise<typeof floors.$inferSelect | null> {
    const [row] = await this.db
      .select()
      .from(floors)
      .where(eq(floors.id, floorId))
      .limit(1);

    return row ?? null;
  }

  private async getRunRow(floorId: string): Promise<typeof floorRunStates.$inferSelect | null> {
    const [row] = await this.db
      .select()
      .from(floorRunStates)
      .where(eq(floorRunStates.floorId, floorId))
      .limit(1);

    return row ?? null;
  }

  private emitSnapshot(snapshot: FloorRunSnapshot): void {
    if (!this.eventBus) {
      return;
    }

    const eventName: "floor.run.updated" | "floor.run.completed" | "floor.run.failed" = snapshot.status === "completed"
      ? "floor.run.completed"
      : snapshot.status === "failed"
        ? "floor.run.failed"
        : "floor.run.updated";

    void this.eventBus.emit(eventName, snapshot);
  }
}
