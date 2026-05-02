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

    const snapshot = await this.getSnapshot(input.floorId);
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

  async getActiveRunForFloor(floorId: string): Promise<FloorRunSnapshot | null> {
    const snapshot = await this.getSnapshot(floorId);
    return snapshot?.status === "running" ? snapshot : null;
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

  async getSnapshot(floorId: string): Promise<FloorRunSnapshot | null> {
    const runRow = await this.getRunRow(floorId);
    if (!runRow) {
      return null;
    }

    const floorRow = await this.getFloorRow(floorId);
    if (!floorRow) {
      return null;
    }

    const reconciledRunRow = await this.reconcileStaleRunRow(floorRow, runRow);
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
      await this.markCompleted(floorRow.id, { updatedAt });
      return (await this.getRunRow(floorRow.id)) ?? runRow;
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
