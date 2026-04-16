import { and, eq } from "drizzle-orm";

import type { AppDb } from "../db/client.js";
import { floors } from "../db/schema.js";
import { SessionStateService } from "./session-state-service.js";
import {
  SESSION_STATE_NAMESPACE_GAME_STATE,
  type FirstPartyReplayEvaluation,
  type FirstPartySceneContext,
  type FirstPartySceneStateValue,
  type LoadFirstPartySceneContextInput,
  type NormalizedFirstPartySceneState,
  type StageFirstPartySceneStateInput,
} from "./session-state-types.js";

/**
 * scene payload 语义字段当前的写入版本。
 *
 * 不会被 reader 用于强校验：reader 采用「min supported 起步 + 大于等于起步就按兼容模式解析」。
 */
export const FIRST_PARTY_SCENE_STATE_WRITER_SCHEMA_VERSION = 1;

/**
 * reader 允许解析的最低 `schemaVersion`。
 *
 * 低于这个版本的 payload 直接拒绝，避免旧格式与当前归一化字段集语义不一致。
 */
export const FIRST_PARTY_SCENE_STATE_MIN_SUPPORTED_SCHEMA_VERSION = 1;

const VALID_SCENE_RUN_TYPES: ReadonlySet<NormalizedFirstPartySceneState["runType"]> = new Set([
  "respond",
  "retry_turn",
  "regenerate_page",
  "edit_and_regenerate",
]);

export class FirstPartyGameStateService {
  constructor(
    private readonly db: AppDb,
    private readonly sessionStateService: SessionStateService,
  ) {}

  stageSceneState(input: StageFirstPartySceneStateInput) {
    return this.sessionStateService.stageCommitBoundValue({
      accountId: input.accountId,
      sessionId: input.sessionId,
      branchId: input.branchId,
      sourceFloorId: input.floorId,
      namespace: SESSION_STATE_NAMESPACE_GAME_STATE,
      slot: "scene",
      value: this.buildSceneStateValue(input),
      replaySafety: "safe",
      requestId: input.requestId ?? null,
      runId: buildFirstPartySceneRunId(input.floorId, input.runType),
    });
  }

  loadSceneContext(input: LoadFirstPartySceneContextInput): FirstPartySceneContext {
    const resolutionMode = input.resolutionMode ?? (input.sourceFloorId ? "source_floor" : "current_effective");
    if (resolutionMode === "source_floor") {
      return this.loadSceneContextFromSourceFloor(input);
    }

    if (input.sourceFloorId) {
      this.requireSourceFloor(input.sessionId, input.sourceFloorId, input.expectedSourceBranchId ?? null);
    }

    const resolved = this.sessionStateService.resolveLiveValue({
      accountId: input.accountId,
      sessionId: input.sessionId,
      branchId: input.branchId,
      namespace: SESSION_STATE_NAMESPACE_GAME_STATE,
      slot: "scene",
      ...(input.sourceFloorId ? { sourceFloorId: input.sourceFloorId } : {}),
    });

    return this.toSceneContextFromResolved(input, resolutionMode, resolved);
  }

  evaluateReplayBlockersForFloor(input: {
    accountId: string;
    sessionId: string;
    floorId: string;
    confirmedMutationIds?: string[];
  }): FirstPartyReplayEvaluation {
    const evaluation = this.sessionStateService.evaluateReplaySafetyForFloor(input);
    return {
      allowed: evaluation.allowed,
      blockers: evaluation.blockers.map((blocker) => ({
        blockerType: "session_state_mutation" as const,
        ...blocker,
      })),
    };
  }

  normalizeSceneValue(rawValue: unknown): NormalizedFirstPartySceneState {
    const record = asRecord(rawValue);
    if (!record) {
      throw new FirstPartyGameStateServiceError(
        "first_party_scene_payload_invalid",
        409,
        "Scene payload must be an object",
      );
    }

    const kind = requireStringField(record, "kind");
    if (kind !== "first_party_scene_state") {
      throw new FirstPartyGameStateServiceError(
        "first_party_scene_payload_invalid",
        409,
        `Unsupported scene payload kind '${kind}'`,
      );
    }

    const schemaVersion = requireNonNegativeIntegerField(record, "schemaVersion");
    if (schemaVersion < FIRST_PARTY_SCENE_STATE_MIN_SUPPORTED_SCHEMA_VERSION) {
      throw new FirstPartyGameStateServiceError(
        "first_party_scene_payload_invalid",
        409,
        `Scene payload schemaVersion '${schemaVersion}' is below the minimum supported version '${FIRST_PARTY_SCENE_STATE_MIN_SUPPORTED_SCHEMA_VERSION}'`,
      );
    }

    const runTypeRaw = requireStringField(record, "runType");
    if (!VALID_SCENE_RUN_TYPES.has(runTypeRaw as NormalizedFirstPartySceneState["runType"])) {
      throw new FirstPartyGameStateServiceError(
        "first_party_scene_payload_invalid",
        409,
        `Scene payload field 'runType' has unsupported value '${runTypeRaw}'`,
      );
    }

    return {
      kind: "first_party_scene_state",
      schemaVersion,
      sessionId: requireStringField(record, "sessionId"),
      branchId: requireStringField(record, "branchId"),
      floorId: requireStringField(record, "floorId"),
      runType: runTypeRaw as NormalizedFirstPartySceneState["runType"],
      generatedText: optionalStringField(record, "generatedText", ""),
      summaries: optionalStringArrayField(record, "summaries"),
      usage: optionalTokenUsage(record.usage),
      toolExecutionIds: optionalStringArrayField(record, "toolExecutionIds"),
      updatedAt: optionalNonNegativeIntegerField(record, "updatedAt", 0),
    };
  }

  private loadSceneContextFromSourceFloor(input: LoadFirstPartySceneContextInput): FirstPartySceneContext {
    if (!input.sourceFloorId) {
      return this.createEmptySceneContext(input, "source_floor", null);
    }

    const sourceFloor = this.requireSourceFloor(
      input.sessionId,
      input.sourceFloorId,
      input.expectedSourceBranchId ?? null,
    );
    const snapshot = this.sessionStateService.getFloorSnapshot({
      accountId: input.accountId,
      sessionId: input.sessionId,
      floorId: sourceFloor.id,
      namespace: SESSION_STATE_NAMESPACE_GAME_STATE,
      slot: "scene",
    });

    if (!snapshot) {
      return this.createEmptySceneContext(input, "source_floor", sourceFloor.id);
    }

    return {
      namespace: SESSION_STATE_NAMESPACE_GAME_STATE,
      slot: "scene",
      resolutionMode: "source_floor",
      source: "source_floor_snapshot",
      present: snapshot.present,
      schemaVersion: snapshot.schemaVersion,
      sessionId: input.sessionId,
      branchId: input.branchId,
      floorId: snapshot.floorId,
      sourceMutationIds: [...snapshot.sourceMutationIds],
      updatedAt: snapshot.committedAt,
      scene: snapshot.present ? this.normalizeSceneValue(snapshot.value) : null,
    };
  }

  private buildSceneStateValue(input: StageFirstPartySceneStateInput): FirstPartySceneStateValue {
    return {
      kind: "first_party_scene_state",
      schemaVersion: FIRST_PARTY_SCENE_STATE_WRITER_SCHEMA_VERSION,
      sessionId: input.sessionId,
      branchId: input.branchId,
      floorId: input.floorId,
      runType: input.runType,
      generatedText: input.execution.generatedText,
      summaries: [...input.execution.summaries],
      usage: input.execution.totalUsage,
      toolExecutionIds: (input.execution.toolExecutionRecords ?? []).map((record) => record.id),
      updatedAt: input.stagedAt ?? Date.now(),
    };
  }

  private requireSourceFloor(
    sessionId: string,
    sourceFloorId: string,
    expectedSourceBranchId: string | null,
  ): {
    id: string;
    branchId: string;
    state: "draft" | "generating" | "committed" | "failed";
  } {
    const sourceFloor = this.db
      .select({
        id: floors.id,
        branchId: floors.branchId,
        state: floors.state,
      })
      .from(floors)
      .where(and(eq(floors.id, sourceFloorId), eq(floors.sessionId, sessionId)))
      .limit(1)
      .get();

    if (!sourceFloor) {
      throw new FirstPartyGameStateServiceError(
        "first_party_scene_source_floor_not_found",
        404,
        `Source floor '${sourceFloorId}' was not found in session '${sessionId}'`,
      );
    }

    if (sourceFloor.state !== "committed") {
      throw new FirstPartyGameStateServiceError(
        "first_party_scene_source_floor_not_committed",
        409,
        `Source floor '${sourceFloorId}' must be committed before it can be used as a scene baseline`,
      );
    }

    if (expectedSourceBranchId && sourceFloor.branchId !== expectedSourceBranchId) {
      throw new FirstPartyGameStateServiceError(
        "first_party_scene_source_floor_branch_mismatch",
        409,
        `Source floor '${sourceFloorId}' belongs to branch '${sourceFloor.branchId}', expected '${expectedSourceBranchId}'`,
      );
    }

    return sourceFloor;
  }

  private toSceneContextFromResolved(
    input: LoadFirstPartySceneContextInput,
    resolutionMode: NonNullable<LoadFirstPartySceneContextInput["resolutionMode"]>,
    resolved: ReturnType<SessionStateService["resolveLiveValue"]>,
  ): FirstPartySceneContext {
    if (!resolved) {
      return this.createEmptySceneContext(input, resolutionMode, null);
    }

    return {
      namespace: SESSION_STATE_NAMESPACE_GAME_STATE,
      slot: "scene",
      resolutionMode,
      source: resolved.source,
      present: resolved.present,
      schemaVersion: resolved.schemaVersion,
      sessionId: input.sessionId,
      branchId: input.branchId,
      floorId: resolved.floorId,
      sourceMutationIds: [...resolved.sourceMutationIds],
      updatedAt: resolved.updatedAt,
      scene: resolved.present ? this.normalizeSceneValue(resolved.value) : null,
    };
  }

  private createEmptySceneContext(
    input: LoadFirstPartySceneContextInput,
    resolutionMode: NonNullable<LoadFirstPartySceneContextInput["resolutionMode"]>,
    floorId: string | null,
  ): FirstPartySceneContext {
    return {
      namespace: SESSION_STATE_NAMESPACE_GAME_STATE,
      slot: "scene",
      resolutionMode,
      source: "none",
      present: false,
      schemaVersion: null,
      sessionId: input.sessionId,
      branchId: input.branchId,
      floorId,
      sourceMutationIds: [],
      updatedAt: null,
      scene: null,
    };
  }
}

export class FirstPartyGameStateServiceError extends Error {
  constructor(
    readonly code:
      | "first_party_scene_payload_invalid"
      | "first_party_scene_source_floor_not_found"
      | "first_party_scene_source_floor_not_committed"
      | "first_party_scene_source_floor_branch_mismatch",
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "FirstPartyGameStateServiceError";
  }
}

function buildFirstPartySceneRunId(
  floorId: string,
  runType: StageFirstPartySceneStateInput["runType"],
): string {
  return `first-party-scene:${runType}:${floorId}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requireStringField(record: Record<string, unknown>, fieldName: string): string {
  const value = record[fieldName];
  if (typeof value !== "string" || value.length === 0) {
    throw new FirstPartyGameStateServiceError(
      "first_party_scene_payload_invalid",
      409,
      `Scene payload field '${fieldName}' must be a non-empty string`,
    );
  }

  return value;
}

function requireStringArrayField(record: Record<string, unknown>, fieldName: string): string[] {
  const value = record[fieldName];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new FirstPartyGameStateServiceError(
      "first_party_scene_payload_invalid",
      409,
      `Scene payload field '${fieldName}' must be a string array`,
    );
  }

  return [...value];
}

function requireNonNegativeIntegerField(record: Record<string, unknown>, fieldName: string): number {
  const value = record[fieldName];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new FirstPartyGameStateServiceError(
      "first_party_scene_payload_invalid",
      409,
      `Scene payload field '${fieldName}' must be a non-negative number`,
    );
  }

  return Math.trunc(value);
}

function requireTokenUsage(value: unknown): NormalizedFirstPartySceneState["usage"] {
  const usage = asRecord(value);
  if (!usage) {
    throw new FirstPartyGameStateServiceError(
      "first_party_scene_payload_invalid",
      409,
      "Scene payload field 'usage' must be an object",
    );
  }

  return {
    promptTokens: requireNonNegativeIntegerField(usage, "promptTokens"),
    completionTokens: requireNonNegativeIntegerField(usage, "completionTokens"),
    totalTokens: requireNonNegativeIntegerField(usage, "totalTokens"),
  };
}

function optionalStringField(
  record: Record<string, unknown>,
  fieldName: string,
  fallback: string,
): string {
  const value = record[fieldName];
  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value !== "string") {
    throw new FirstPartyGameStateServiceError(
      "first_party_scene_payload_invalid",
      409,
      `Scene payload field '${fieldName}' must be a string when present`,
    );
  }

  return value;
}

function optionalStringArrayField(
  record: Record<string, unknown>,
  fieldName: string,
): string[] {
  const value = record[fieldName];
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new FirstPartyGameStateServiceError(
      "first_party_scene_payload_invalid",
      409,
      `Scene payload field '${fieldName}' must be a string array when present`,
    );
  }

  return [...value] as string[];
}

function optionalNonNegativeIntegerField(
  record: Record<string, unknown>,
  fieldName: string,
  fallback: number,
): number {
  const value = record[fieldName];
  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new FirstPartyGameStateServiceError(
      "first_party_scene_payload_invalid",
      409,
      `Scene payload field '${fieldName}' must be a non-negative number when present`,
    );
  }

  return Math.trunc(value);
}

function optionalTokenUsage(value: unknown): NormalizedFirstPartySceneState["usage"] {
  if (value === undefined || value === null) {
    return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  }

  return requireTokenUsage(value);
}
