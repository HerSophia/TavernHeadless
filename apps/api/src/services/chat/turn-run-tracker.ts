import { and, eq } from "drizzle-orm";
import type { FloorRunType, TurnRunObserver } from "@tavern/core";
import type { AppDb } from "../../db/client.js";
import { floors } from "../../db/schema.js";
import type { FloorRunService } from "../floor-run-service.js";
import { FloorStateMachine } from "@tavern/core";

export class TurnRunTracker {
  constructor(
    private readonly db: AppDb,
    private readonly floorStateMachine: FloorStateMachine,
    private readonly floorRunService?: FloorRunService,
  ) {}

  async initializeFloorRun(
    sessionId: string,
    floorId: string,
    runType: FloorRunType,
    startedAt = Date.now(),
  ): Promise<void> {
    try {
      await this.floorRunService?.initializeRun({
        sessionId,
        floorId,
        runType,
        startedAt,
      });
    } catch {
      // best-effort run tracking
    }
  }

  async trackFloorRunPhase(
    floorId: string,
    phase: "input_recorded" | "semantic_resolved" | "prechecked" | "prompt_assembled" | "page_generating" | "candidate_generated" | "verifier_checked" | "transaction_prepared" | "transaction_committed" | "post_commit_scheduled",
    attemptNo?: number,
  ): Promise<void> {
    try {
      await this.floorRunService?.advancePhase(floorId, phase, attemptNo !== undefined ? { attemptNo } : {});
    } catch {
      // best-effort run tracking
    }
  }

  async trackFloorRunPendingOutput(
    floorId: string,
    input: {
      text: string;
      state: "draft" | "streaming" | "generated" | "failed";
      attemptNo: number;
      force?: boolean;
      error?: string;
    },
  ): Promise<void> {
    try {
      await this.floorRunService?.updatePendingOutput(floorId, input);
    } catch {
      // best-effort run tracking
    }
  }

  async trackFloorRunVerifier(
    floorId: string,
    input: {
      status: "pending" | "passed" | "warned" | "blocked" | "skipped";
      suggestion?: string;
      issues?: Array<{ description: string; severity: "warning" | "error" }>;
    },
  ): Promise<void> {
    try {
      await this.floorRunService?.updateVerifier(floorId, input);
    } catch {
      // best-effort run tracking
    }
  }

  createTurnRunObserver(floorId: string): TurnRunObserver {
    return {
      onPhaseChange: ({ phase, attemptNo }) => this.trackFloorRunPhase(floorId, phase, attemptNo),
      onPendingOutputUpdate: (input) => this.trackFloorRunPendingOutput(floorId, input),
      onVerifierResult: (input) => this.trackFloorRunVerifier(floorId, input),
    };
  }

  async tryMarkRunFailed(floorId: string, error: unknown, code = "floor_run_failed"): Promise<void> {
    const normalizedError = error instanceof Error ? error : new Error(String(error));

    try {
      await this.floorRunService?.markFailed(floorId, { code, message: normalizedError.message });
    } catch {
      // best-effort run tracking
    }
  }

  async tryMarkFloorFailed(floorId: string, error: unknown): Promise<void> {
    const normalizedError = error instanceof Error ? error : new Error(String(error));

    try {
      await this.floorStateMachine.fail(floorId, normalizedError);
    } catch {
      // 提交失败后的补偿标记是 best-effort，避免覆盖原始错误。
    }
  }

  async failRunAndFloorBestEffort(
    floorId: string,
    error: unknown,
    code = "floor_run_failed",
    options?: { restoreSupersededSourceFloor?: string },
  ): Promise<void> {
    await this.tryMarkRunFailed(floorId, error, code);
    await this.tryMarkFloorFailed(floorId, error);

    if (options?.restoreSupersededSourceFloor) {
      await this.restoreSupersededSourceFloorBestEffort(
        options.restoreSupersededSourceFloor,
        floorId,
      );
    }
  }

  async restoreSupersededSourceFloorBestEffort(
    sourceFloorId: string,
    supersededByFloorId: string,
  ): Promise<void> {
    try {
      this.db
        .update(floors)
        .set({
          supersededAt: null,
          supersededByFloorId: null,
          updatedAt: Date.now(),
        })
        .where(and(
          eq(floors.id, sourceFloorId),
          eq(floors.supersededByFloorId, supersededByFloorId),
        ))
        .run();
    } catch {
      // best-effort compensation; avoid overriding the originating error.
    }
  }
}
