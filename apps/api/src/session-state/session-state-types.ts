import type { FloorRunType, ToolReplaySafety, TokenUsage, TurnExecutionResult } from "@tavern/core";

export const SESSION_STATE_MANAGER_KIND = "session_state" as const;
export const SESSION_STATE_HOST_TYPE = "session" as const;
export const SESSION_STATE_INTERNAL_OWNER_TYPE = "application" as const;
export const SESSION_STATE_INTERNAL_OWNER_ID = "tavern-session-state" as const;
export const SESSION_STATE_NAMESPACE_GAME_STATE = "game_state" as const;

export const SESSION_STATE_LIVE_COLLECTION = "__session_state_live_heads" as const;
export const SESSION_STATE_SNAPSHOT_COLLECTION = "__session_state_floor_snapshots" as const;

export type SessionStateManagerKind = typeof SESSION_STATE_MANAGER_KIND;
export type SessionStateHostType = typeof SESSION_STATE_HOST_TYPE;
export type SessionStateNamespace = typeof SESSION_STATE_NAMESPACE_GAME_STATE | (string & {});

export type SessionStateVisibilityMode =
  | "session_shared"
  | "branch_local"
  | "fork_on_branch";

export type SessionStateWriteMode =
  | "direct"
  | "commit_bound";

export type SessionStateReplaySafety = ToolReplaySafety;

export type SessionStateMutationStatus =
  | "staged"
  | "applied"
  | "discarded"
  | "blocked"
  | "uncertain";

export interface SessionStateSlotDefinition {
  namespace: SessionStateNamespace;
  slot: string;
  visibilityMode: SessionStateVisibilityMode;
  defaultWriteMode: SessionStateWriteMode;
  defaultReplaySafety: ToolReplaySafety;
  schemaVersion: number;
  sizeBudgetBytes: number;
}

export interface SessionStateManagedDomainBinding {
  domainId: string;
  accountId: string;
  managerKind: SessionStateManagerKind;
  hostType: SessionStateHostType;
  hostId: string;
  stateNamespace: SessionStateNamespace;
  requireCallerOwner: boolean;
  allowAutoCreateCollection: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SessionStateMutationPayload {
  present: boolean;
  value: unknown | null;
}

export interface SessionStateMutationView {
  id: string;
  accountId: string;
  domainId: string;
  stateNamespace: SessionStateNamespace;
  sessionId: string;
  branchId: string;
  sourceFloorId: string | null;
  targetSlot: string;
  visibilityMode: SessionStateVisibilityMode;
  writeMode: SessionStateWriteMode;
  payloadJson: string;
  replaySafety: ToolReplaySafety;
  status: SessionStateMutationStatus;
  requestId: string | null;
  runId: string | null;
  payload: SessionStateMutationPayload;
  sourceSnapshotFloorId: string | null;
  liveHeadKey: string | null;
  discardReason: string | null;
  blockedReason: string | null;
  createdAt: number;
  updatedAt: number;
  appliedAt: number | null;
}

export interface SessionStateLiveHeadEnvelope {
  kind: "live_head";
  namespace: SessionStateNamespace;
  slot: string;
  sessionId: string;
  branchId: string | null;
  visibilityMode: SessionStateVisibilityMode;
  schemaVersion: number;
  present: boolean;
  value: unknown | null;
  lastMutationId: string | null;
  sourceFloorId: string | null;
  updatedAt: number;
}

export interface SessionStateFloorSnapshotEnvelope {
  kind: "floor_snapshot";
  namespace: SessionStateNamespace;
  slot: string;
  sessionId: string;
  branchId: string;
  floorId: string;
  visibilityMode: SessionStateVisibilityMode;
  schemaVersion: number;
  present: boolean;
  value: unknown | null;
  sourceMutationIds: string[];
  committedAt: number;
}

export interface SessionStateResolvedValue {
  namespace: SessionStateNamespace;
  slot: string;
  source:
    | "live_head"
    | "latest_branch_snapshot"
    | "source_floor_snapshot"
    | "latest_main_snapshot";
  visibilityMode: SessionStateVisibilityMode;
  schemaVersion: number;
  present: boolean;
  value: unknown | null;
  sessionId: string;
  branchId: string;
  floorId: string | null;
  sourceMutationIds: string[];
  updatedAt: number;
}

export interface SessionStateFloorSnapshotView {
  namespace: SessionStateNamespace;
  slot: string;
  visibilityMode: SessionStateVisibilityMode;
  schemaVersion: number;
  present: boolean;
  value: unknown | null;
  sessionId: string;
  branchId: string;
  floorId: string;
  sourceMutationIds: string[];
  committedAt: number;
}

export interface SessionStateDiffEntry {
  namespace: SessionStateNamespace;
  slot: string;
  changeType: "added" | "removed" | "changed" | "unchanged";
  leftFloorId: string | null;
  rightFloorId: string | null;
  leftPresent: boolean;
  rightPresent: boolean;
  leftValue: unknown | null;
  rightValue: unknown | null;
}

export interface SessionStateReplayBlocker {
  mutationId: string;
  stateNamespace: SessionStateNamespace;
  targetSlot: string;
  replaySafety: ToolReplaySafety;
  status: SessionStateMutationStatus;
  reason: "confirmation_required" | "never_auto_replay" | "uncertain" | "blocked";
}

export interface SessionStateReplayEvaluation {
  allowed: boolean;
  blockers: SessionStateReplayBlocker[];
}

export type FirstPartySceneResolutionMode = "current_effective" | "source_floor";

export interface LoadFirstPartySceneContextInput {
  accountId: string;
  sessionId: string;
  branchId: string;
  sourceFloorId?: string | null;
  expectedSourceBranchId?: string | null;
  resolutionMode?: FirstPartySceneResolutionMode;
}

export interface FirstPartySceneContext {
  namespace: typeof SESSION_STATE_NAMESPACE_GAME_STATE;
  slot: "scene";
  resolutionMode: FirstPartySceneResolutionMode;
  source: SessionStateResolvedValue["source"] | "none";
  present: boolean;
  schemaVersion: number | null;
  sessionId: string;
  branchId: string;
  floorId: string | null;
  sourceMutationIds: string[];
  updatedAt: number | null;
  scene: NormalizedFirstPartySceneState | null;
}

export interface FirstPartyReplayBlocker extends SessionStateReplayBlocker {
  blockerType: "session_state_mutation";
}

export interface FirstPartyReplayEvaluation {
  allowed: boolean;
  blockers: FirstPartyReplayBlocker[];
}

export interface FirstPartySceneStateValue {
  kind: "first_party_scene_state";
  schemaVersion: number;
  sessionId: string;
  branchId: string;
  floorId: string;
  runType: FloorRunType;
  generatedText: string;
  summaries: string[];
  usage: TokenUsage;
  toolExecutionIds: string[];
  updatedAt: number;
}

export type NormalizedFirstPartySceneState = FirstPartySceneStateValue;

export interface StageFirstPartySceneStateInput {
  accountId: string;
  sessionId: string;
  branchId: string;
  floorId: string;
  runType: FloorRunType;
  execution: Pick<TurnExecutionResult, "generatedText" | "summaries" | "totalUsage" | "toolExecutionRecords">;
  stagedAt?: number;
  requestId?: string | null;
}
