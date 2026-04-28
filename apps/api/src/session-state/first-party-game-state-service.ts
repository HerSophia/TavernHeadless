import { and, eq } from "drizzle-orm";

import type { AppDb } from "../db/client.js";
import { floors } from "../db/schema.js";
import { SessionStateService } from "./session-state-service.js";
import {
  SESSION_STATE_NAMESPACE_GAME_STATE,
  type FirstPartyReplayEvaluation,
  type FirstPartySceneContext,
  type FirstPartySceneStateValue,
  type FirstPartyStateResolutionMode,
  type FirstPartyWorldContext,
  type FirstPartyWorldStateValue,
  type LoadFirstPartySceneContextInput,
  type LoadFirstPartyWorldContextInput,
  type NormalizedFirstPartySceneState,
  type NormalizedFirstPartyWorldState,
  type StageFirstPartySceneStateInput,
  type StageFirstPartyWorldStateInput,
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

/**
 * world payload 语义字段当前的写入版本。
 */
export const FIRST_PARTY_WORLD_STATE_WRITER_SCHEMA_VERSION = 1;

/**
 * reader 允许解析的最低 world `schemaVersion`。
 */
export const FIRST_PARTY_WORLD_STATE_MIN_SUPPORTED_SCHEMA_VERSION = 1;

const VALID_FIRST_PARTY_GAME_STATE_RUN_TYPES: ReadonlySet<NormalizedFirstPartySceneState["runType"]> = new Set([
  "respond",
  "retry_turn",
  "regenerate_page",
  "edit_and_regenerate",
]);

const SCENE_PAYLOAD_ERROR_CONTEXT = {
  invalidCode: "first_party_scene_payload_invalid",
  label: "Scene",
} as const;

const WORLD_PAYLOAD_ERROR_CONTEXT = {
  invalidCode: "first_party_world_payload_invalid",
  label: "World",
} as const;

const SCENE_SOURCE_FLOOR_ERROR_CONTEXT = {
  notFound: "first_party_scene_source_floor_not_found",
  notCommitted: "first_party_scene_source_floor_not_committed",
  branchMismatch: "first_party_scene_source_floor_branch_mismatch",
  slotLabel: "scene",
} as const;

const WORLD_SOURCE_FLOOR_ERROR_CONTEXT = {
  notFound: "first_party_world_source_floor_not_found",
  notCommitted: "first_party_world_source_floor_not_committed",
  branchMismatch: "first_party_world_source_floor_branch_mismatch",
  slotLabel: "world",
} as const;

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

  stageWorldState(input: StageFirstPartyWorldStateInput) {
    return this.sessionStateService.stageCommitBoundValue({
      accountId: input.accountId,
      sessionId: input.sessionId,
      branchId: input.branchId,
      sourceFloorId: input.floorId,
      namespace: SESSION_STATE_NAMESPACE_GAME_STATE,
      slot: "world",
      value: this.buildWorldStateValue(input),
      replaySafety: "safe",
      requestId: input.requestId ?? null,
      runId: buildFirstPartyWorldRunId(input.floorId, input.runType),
    });
  }

  loadSceneContext(input: LoadFirstPartySceneContextInput): FirstPartySceneContext {
    const resolutionMode = input.resolutionMode ?? (input.sourceFloorId ? "source_floor" : "current_effective");
    if (resolutionMode === "source_floor") {
      return this.loadSceneContextFromSourceFloor(input);
    }

    if (input.sourceFloorId) {
      this.requireSourceFloor(
        input.sessionId,
        input.sourceFloorId,
        input.expectedSourceBranchId ?? null,
        SCENE_SOURCE_FLOOR_ERROR_CONTEXT,
      );
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

  loadWorldContext(input: LoadFirstPartyWorldContextInput): FirstPartyWorldContext {
    const resolutionMode = input.resolutionMode ?? (input.sourceFloorId ? "source_floor" : "current_effective");
    if (resolutionMode === "source_floor") {
      return this.loadWorldContextFromSourceFloor(input);
    }

    if (input.sourceFloorId) {
      this.requireSourceFloor(
        input.sessionId,
        input.sourceFloorId,
        input.expectedSourceBranchId ?? null,
        WORLD_SOURCE_FLOOR_ERROR_CONTEXT,
      );
    }

    const resolved = this.sessionStateService.resolveLiveValue({
      accountId: input.accountId,
      sessionId: input.sessionId,
      branchId: input.branchId,
      namespace: SESSION_STATE_NAMESPACE_GAME_STATE,
      slot: "world",
      ...(input.sourceFloorId ? { sourceFloorId: input.sourceFloorId } : {}),
    });

    return this.toWorldContextFromResolved(input, resolutionMode, resolved);
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
    const record = requirePayloadRecord(rawValue, SCENE_PAYLOAD_ERROR_CONTEXT);

    const kind = requireStringField(record, "kind", SCENE_PAYLOAD_ERROR_CONTEXT);
    if (kind !== "first_party_scene_state") {
      throw new FirstPartyGameStateServiceError(
        "first_party_scene_payload_invalid",
        409,
        `Unsupported scene payload kind '${kind}'`,
      );
    }

    const schemaVersion = requireNonNegativeIntegerField(record, "schemaVersion", SCENE_PAYLOAD_ERROR_CONTEXT);
    if (schemaVersion < FIRST_PARTY_SCENE_STATE_MIN_SUPPORTED_SCHEMA_VERSION) {
      throw new FirstPartyGameStateServiceError(
        "first_party_scene_payload_invalid",
        409,
        `Scene payload schemaVersion '${schemaVersion}' is below the minimum supported version '${FIRST_PARTY_SCENE_STATE_MIN_SUPPORTED_SCHEMA_VERSION}'`,
      );
    }

    const runTypeRaw = requireStringField(record, "runType", SCENE_PAYLOAD_ERROR_CONTEXT);
    if (!VALID_FIRST_PARTY_GAME_STATE_RUN_TYPES.has(runTypeRaw as NormalizedFirstPartySceneState["runType"])) {
      throw new FirstPartyGameStateServiceError(
        "first_party_scene_payload_invalid",
        409,
        `Scene payload field 'runType' has unsupported value '${runTypeRaw}'`,
      );
    }

    return {
      kind: "first_party_scene_state",
      schemaVersion,
      sessionId: requireStringField(record, "sessionId", SCENE_PAYLOAD_ERROR_CONTEXT),
      branchId: requireStringField(record, "branchId", SCENE_PAYLOAD_ERROR_CONTEXT),
      floorId: requireStringField(record, "floorId", SCENE_PAYLOAD_ERROR_CONTEXT),
      runType: runTypeRaw as NormalizedFirstPartySceneState["runType"],
      generatedText: optionalStringField(record, "generatedText", "", SCENE_PAYLOAD_ERROR_CONTEXT),
      summaries: optionalStringArrayField(record, "summaries", SCENE_PAYLOAD_ERROR_CONTEXT),
      usage: optionalTokenUsage(record.usage, SCENE_PAYLOAD_ERROR_CONTEXT),
      toolExecutionIds: optionalStringArrayField(record, "toolExecutionIds", SCENE_PAYLOAD_ERROR_CONTEXT),
      updatedAt: optionalNonNegativeIntegerField(record, "updatedAt", 0, SCENE_PAYLOAD_ERROR_CONTEXT),
    };
  }

  normalizeWorldValue(rawValue: unknown): NormalizedFirstPartyWorldState {
    const record = requirePayloadRecord(rawValue, WORLD_PAYLOAD_ERROR_CONTEXT);

    const kind = requireStringField(record, "kind", WORLD_PAYLOAD_ERROR_CONTEXT);
    if (kind !== "first_party_world_state") {
      throw new FirstPartyGameStateServiceError(
        "first_party_world_payload_invalid",
        409,
        `Unsupported world payload kind '${kind}'`,
      );
    }

    const schemaVersion = requireNonNegativeIntegerField(record, "schemaVersion", WORLD_PAYLOAD_ERROR_CONTEXT);
    if (schemaVersion < FIRST_PARTY_WORLD_STATE_MIN_SUPPORTED_SCHEMA_VERSION) {
      throw new FirstPartyGameStateServiceError(
        "first_party_world_payload_invalid",
        409,
        `World payload schemaVersion '${schemaVersion}' is below the minimum supported version '${FIRST_PARTY_WORLD_STATE_MIN_SUPPORTED_SCHEMA_VERSION}'`,
      );
    }

    const runTypeRaw = requireStringField(record, "runType", WORLD_PAYLOAD_ERROR_CONTEXT);
    if (!VALID_FIRST_PARTY_GAME_STATE_RUN_TYPES.has(runTypeRaw as NormalizedFirstPartyWorldState["runType"])) {
      throw new FirstPartyGameStateServiceError(
        "first_party_world_payload_invalid",
        409,
        `World payload field 'runType' has unsupported value '${runTypeRaw}'`,
      );
    }

    return {
      kind: "first_party_world_state",
      schemaVersion,
      sessionId: requireStringField(record, "sessionId", WORLD_PAYLOAD_ERROR_CONTEXT),
      branchId: requireStringField(record, "branchId", WORLD_PAYLOAD_ERROR_CONTEXT),
      floorId: requireStringField(record, "floorId", WORLD_PAYLOAD_ERROR_CONTEXT),
      runType: runTypeRaw as NormalizedFirstPartyWorldState["runType"],
      summaryLines: optionalStringArrayField(record, "summaryLines", WORLD_PAYLOAD_ERROR_CONTEXT),
      worldbookId: optionalNullableStringField(record, "worldbookId", WORLD_PAYLOAD_ERROR_CONTEXT),
      worldbookVersion: optionalNullableNonNegativeIntegerField(record, "worldbookVersion", WORLD_PAYLOAD_ERROR_CONTEXT),
      activatedWorldbookEntryUids: optionalNonNegativeIntegerArrayField(record, "activatedWorldbookEntryUids", WORLD_PAYLOAD_ERROR_CONTEXT),
      toolExecutionIds: optionalStringArrayField(record, "toolExecutionIds", WORLD_PAYLOAD_ERROR_CONTEXT),
      updatedAt: optionalNonNegativeIntegerField(record, "updatedAt", 0, WORLD_PAYLOAD_ERROR_CONTEXT),
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
      SCENE_SOURCE_FLOOR_ERROR_CONTEXT,
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

  private loadWorldContextFromSourceFloor(input: LoadFirstPartyWorldContextInput): FirstPartyWorldContext {
    if (!input.sourceFloorId) {
      return this.createEmptyWorldContext(input, "source_floor", null);
    }

    const sourceFloor = this.requireSourceFloor(
      input.sessionId,
      input.sourceFloorId,
      input.expectedSourceBranchId ?? null,
      WORLD_SOURCE_FLOOR_ERROR_CONTEXT,
    );
    const snapshot = this.sessionStateService.getFloorSnapshot({
      accountId: input.accountId,
      sessionId: input.sessionId,
      floorId: sourceFloor.id,
      namespace: SESSION_STATE_NAMESPACE_GAME_STATE,
      slot: "world",
    });

    if (!snapshot) {
      return this.createEmptyWorldContext(input, "source_floor", sourceFloor.id);
    }

    return {
      namespace: SESSION_STATE_NAMESPACE_GAME_STATE,
      slot: "world",
      resolutionMode: "source_floor",
      source: "source_floor_snapshot",
      present: snapshot.present,
      schemaVersion: snapshot.schemaVersion,
      sessionId: input.sessionId,
      branchId: input.branchId,
      floorId: snapshot.floorId,
      sourceMutationIds: [...snapshot.sourceMutationIds],
      updatedAt: snapshot.committedAt,
      world: snapshot.present ? this.normalizeWorldValue(snapshot.value) : null,
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

  private buildWorldStateValue(input: StageFirstPartyWorldStateInput): FirstPartyWorldStateValue {
    return {
      kind: "first_party_world_state",
      schemaVersion: FIRST_PARTY_WORLD_STATE_WRITER_SCHEMA_VERSION,
      sessionId: input.sessionId,
      branchId: input.branchId,
      floorId: input.floorId,
      runType: input.runType,
      summaryLines: [...input.execution.summaries],
      worldbookId: input.promptSnapshot?.worldbookId ?? null,
      worldbookVersion: input.promptSnapshot?.worldbookVersion ?? null,
      activatedWorldbookEntryUids: [...(input.promptSnapshot?.worldbookActivatedEntryUids ?? [])],
      toolExecutionIds: (input.execution.toolExecutionRecords ?? []).map((record) => record.id),
      updatedAt: input.stagedAt ?? Date.now(),
    };
  }

  private requireSourceFloor(
    sessionId: string,
    sourceFloorId: string,
    expectedSourceBranchId: string | null,
    errorContext: SourceFloorErrorContext,
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
        errorContext.notFound,
        404,
        `Source floor '${sourceFloorId}' was not found in session '${sessionId}'`,
      );
    }

    if (sourceFloor.state !== "committed") {
      throw new FirstPartyGameStateServiceError(
        errorContext.notCommitted,
        409,
        `Source floor '${sourceFloorId}' must be committed before it can be used as a ${errorContext.slotLabel} baseline`,
      );
    }

    if (expectedSourceBranchId && sourceFloor.branchId !== expectedSourceBranchId) {
      throw new FirstPartyGameStateServiceError(
        errorContext.branchMismatch,
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

  private toWorldContextFromResolved(
    input: LoadFirstPartyWorldContextInput,
    resolutionMode: NonNullable<LoadFirstPartyWorldContextInput["resolutionMode"]>,
    resolved: ReturnType<SessionStateService["resolveLiveValue"]>,
  ): FirstPartyWorldContext {
    if (!resolved) {
      return this.createEmptyWorldContext(input, resolutionMode, null);
    }

    return {
      namespace: SESSION_STATE_NAMESPACE_GAME_STATE,
      slot: "world",
      resolutionMode,
      source: resolved.source,
      present: resolved.present,
      schemaVersion: resolved.schemaVersion,
      sessionId: input.sessionId,
      branchId: input.branchId,
      floorId: resolved.floorId,
      sourceMutationIds: [...resolved.sourceMutationIds],
      updatedAt: resolved.updatedAt,
      world: resolved.present ? this.normalizeWorldValue(resolved.value) : null,
    };
  }

  private createEmptySceneContext(
    input: LoadFirstPartySceneContextInput,
    resolutionMode: FirstPartyStateResolutionMode,
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

  private createEmptyWorldContext(
    input: LoadFirstPartyWorldContextInput,
    resolutionMode: FirstPartyStateResolutionMode,
    floorId: string | null,
  ): FirstPartyWorldContext {
    return {
      namespace: SESSION_STATE_NAMESPACE_GAME_STATE,
      slot: "world",
      resolutionMode,
      source: "none",
      present: false,
      schemaVersion: null,
      sessionId: input.sessionId,
      branchId: input.branchId,
      floorId,
      sourceMutationIds: [],
      updatedAt: null,
      world: null,
    };
  }
}

export class FirstPartyGameStateServiceError extends Error {
  constructor(
    readonly code:
      | "first_party_scene_payload_invalid"
      | "first_party_scene_source_floor_not_found"
      | "first_party_scene_source_floor_not_committed"
      | "first_party_scene_source_floor_branch_mismatch"
      | "first_party_world_payload_invalid"
      | "first_party_world_source_floor_not_found"
      | "first_party_world_source_floor_not_committed"
      | "first_party_world_source_floor_branch_mismatch",
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "FirstPartyGameStateServiceError";
  }
}

type SourceFloorErrorContext = {
  notFound:
    | "first_party_scene_source_floor_not_found"
    | "first_party_world_source_floor_not_found";
  notCommitted:
    | "first_party_scene_source_floor_not_committed"
    | "first_party_world_source_floor_not_committed";
  branchMismatch:
    | "first_party_scene_source_floor_branch_mismatch"
    | "first_party_world_source_floor_branch_mismatch";
  slotLabel: "scene" | "world";
};

type PayloadErrorContext = {
  invalidCode:
    | "first_party_scene_payload_invalid"
    | "first_party_world_payload_invalid";
  label: "Scene" | "World";
};

function buildFirstPartySceneRunId(
  floorId: string,
  runType: StageFirstPartySceneStateInput["runType"],
): string {
  return `first-party-scene:${runType}:${floorId}`;
}

function buildFirstPartyWorldRunId(
  floorId: string,
  runType: StageFirstPartyWorldStateInput["runType"],
): string {
  return `first-party-world:${runType}:${floorId}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requirePayloadRecord(value: unknown, context: PayloadErrorContext): Record<string, unknown> {
  const record = asRecord(value);
  if (!record) {
    throw new FirstPartyGameStateServiceError(
      context.invalidCode,
      409,
      `${context.label} payload must be an object`,
    );
  }

  return record;
}

function requireStringField(
  record: Record<string, unknown>,
  fieldName: string,
  context: PayloadErrorContext,
): string {
  const value = record[fieldName];
  if (typeof value !== "string" || value.length === 0) {
    throw new FirstPartyGameStateServiceError(
      context.invalidCode,
      409,
      `${context.label} payload field '${fieldName}' must be a non-empty string`,
    );
  }

  return value;
}

function requireNonNegativeIntegerField(
  record: Record<string, unknown>,
  fieldName: string,
  context: PayloadErrorContext,
): number {
  const value = record[fieldName];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new FirstPartyGameStateServiceError(
      context.invalidCode,
      409,
      `${context.label} payload field '${fieldName}' must be a non-negative number`,
    );
  }

  return Math.trunc(value);
}

function requireTokenUsage(
  value: unknown,
  context: PayloadErrorContext,
): NormalizedFirstPartySceneState["usage"] {
  const usage = asRecord(value);
  if (!usage) {
    throw new FirstPartyGameStateServiceError(
      context.invalidCode,
      409,
      `${context.label} payload field 'usage' must be an object`,
    );
  }

  return {
    promptTokens: requireNonNegativeIntegerField(usage, "promptTokens", context),
    completionTokens: requireNonNegativeIntegerField(usage, "completionTokens", context),
    totalTokens: requireNonNegativeIntegerField(usage, "totalTokens", context),
  };
}

function optionalStringField(
  record: Record<string, unknown>,
  fieldName: string,
  fallback: string,
  context: PayloadErrorContext,
): string {
  const value = record[fieldName];
  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value !== "string") {
    throw new FirstPartyGameStateServiceError(
      context.invalidCode,
      409,
      `${context.label} payload field '${fieldName}' must be a string when present`,
    );
  }

  return value;
}

function optionalStringArrayField(
  record: Record<string, unknown>,
  fieldName: string,
  context: PayloadErrorContext,
): string[] {
  const value = record[fieldName];
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new FirstPartyGameStateServiceError(
      context.invalidCode,
      409,
      `${context.label} payload field '${fieldName}' must be a string array when present`,
    );
  }

  return [...value] as string[];
}

function optionalNonNegativeIntegerField(
  record: Record<string, unknown>,
  fieldName: string,
  fallback: number,
  context: PayloadErrorContext,
): number {
  const value = record[fieldName];
  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new FirstPartyGameStateServiceError(
      context.invalidCode,
      409,
      `${context.label} payload field '${fieldName}' must be a non-negative number when present`,
    );
  }

  return Math.trunc(value);
}

function optionalNullableStringField(
  record: Record<string, unknown>,
  fieldName: string,
  context: PayloadErrorContext,
): string | null {
  const value = record[fieldName];
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new FirstPartyGameStateServiceError(
      context.invalidCode,
      409,
      `${context.label} payload field '${fieldName}' must be a string or null when present`,
    );
  }

  return value;
}

function optionalNullableNonNegativeIntegerField(
  record: Record<string, unknown>,
  fieldName: string,
  context: PayloadErrorContext,
): number | null {
  const value = record[fieldName];
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new FirstPartyGameStateServiceError(
      context.invalidCode,
      409,
      `${context.label} payload field '${fieldName}' must be a non-negative number or null when present`,
    );
  }

  return Math.trunc(value);
}

function optionalNonNegativeIntegerArrayField(
  record: Record<string, unknown>,
  fieldName: string,
  context: PayloadErrorContext,
): number[] {
  const value = record[fieldName];
  if (value === undefined || value === null) {
    return [];
  }

  if (
    !Array.isArray(value)
    || value.some((entry) => typeof entry !== "number" || !Number.isFinite(entry) || entry < 0)
  ) {
    throw new FirstPartyGameStateServiceError(
      context.invalidCode,
      409,
      `${context.label} payload field '${fieldName}' must be a non-negative number array when present`,
    );
  }

  return value.map((entry) => Math.trunc(entry as number));
}

function optionalTokenUsage(
  value: unknown,
  context: PayloadErrorContext,
): NormalizedFirstPartySceneState["usage"] {
  if (value === undefined || value === null) {
    return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  }

  return requireTokenUsage(value, context);
}
