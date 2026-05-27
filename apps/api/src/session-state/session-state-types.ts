import type { FloorRunType, ToolReplaySafety, TokenUsage, TurnExecutionResult } from "@tavern/core";

export const SESSION_STATE_MANAGER_KIND = "session_state" as const;
export const SESSION_STATE_HOST_TYPE = "session" as const;
export const SESSION_STATE_INTERNAL_OWNER_TYPE = "application" as const;
export const SESSION_STATE_INTERNAL_OWNER_ID = "tavern-session-state" as const;
export const SESSION_STATE_NAMESPACE_GAME_STATE = "game_state" as const;

export const SESSION_STATE_LIVE_COLLECTION = "__session_state_live_heads" as const;
export const SESSION_STATE_SNAPSHOT_COLLECTION = "__session_state_floor_snapshots" as const;

export const SESSION_STATE_NAMESPACE_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/;
export const SESSION_STATE_LOGICAL_OWNER_TYPE_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/;
export const SESSION_STATE_LOGICAL_OWNER_ID_PATTERN = /^[a-z0-9@][a-z0-9._:@/-]*$/;

export const SESSION_STATE_NAMESPACE_PATTERN_HINT = "lowercase letters, digits, underscore, with optional dot-separated segments" as const;
export const SESSION_STATE_LOGICAL_OWNER_TYPE_PATTERN_HINT = "lowercase letters, digits, underscore, with optional dot-separated segments" as const;
export const SESSION_STATE_LOGICAL_OWNER_ID_PATTERN_HINT = "lowercase letters, digits, '.', '_', ':', '@', '/', '-'" as const;

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

export type SessionStateMutationCommitMode =
  | "direct_public"
  | "turn_bound"
  | "variable_reroute";

export type SessionStateMutationDecisionStatus =
  | "accepted"
  | "discarded"
  | "blocked"
  | "rerouted_to_session_state";

export type SessionStateMutationSourceKind = string & {};

export type SessionStateReplaySafety = ToolReplaySafety;

export type SessionStateMutationStatus =
  | "staged"
  | "applied"
  | "discarded"
  | "blocked"
  | "uncertain";

export type SessionStateSlotOwnerKind = "built_in" | "custom";
export type SessionStatePublicExposureLifecycle = "public_stable" | "candidate" | "internal_only";

export type SessionStateLogicalOwnerType = string & {};
export type SessionStateReplayPolicySource = "system_default" | (string & {});

export interface SessionStateSlotCapabilities {
  clientReadable: boolean;
  clientWritable: boolean;
  allowedWriteModes: SessionStateWriteMode[];
  supportsSnapshot: boolean;
  supportsDiff: boolean;
}

export interface SessionStateSlotPublicExposure {
  ownerKind: SessionStateSlotOwnerKind;
  exposureLifecycle: SessionStatePublicExposureLifecycle;
  capabilities: SessionStateSlotCapabilities;
}

export interface SessionStateSlotDefinition {
  namespace: SessionStateNamespace;
  slot: string;
  visibilityMode: SessionStateVisibilityMode;
  defaultWriteMode: SessionStateWriteMode;
  defaultReplaySafety: ToolReplaySafety;
  schemaVersion: number;
  sizeBudgetBytes: number;
  publicExposure: SessionStateSlotPublicExposure;
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

export interface SessionStateMutationPageInspectFilters {
  branchId?: string;
  sourceFloorId?: string;
  sourcePageId?: string;
  sourceBranchId?: string;
  targetSlot?: string;
  stateNamespace?: SessionStateNamespace;
  writeMode?: SessionStateWriteMode;
  sourceKind?: SessionStateMutationSourceKind;
  commitMode?: SessionStateMutationCommitMode;
  actorClientId?: string | null;
}

export interface SessionStateMutationView {
  id: string;
  accountId: string;
  domainId: string;
  stateNamespace: SessionStateNamespace;
  sessionId: string;
  branchId: string;
  sourceFloorId: string | null;
  sourcePageId: string | null;
  sourceBranchId: string | null;
  targetSlot: string;
  actorClientId: string | null;
  sourceKind: SessionStateMutationSourceKind | null;
  visibilityMode: SessionStateVisibilityMode;
  writeMode: SessionStateWriteMode;
  commitMode: SessionStateMutationCommitMode;
  payloadJson: string;
  replaySafety: ToolReplaySafety;
  status: SessionStateMutationStatus;
  requestId: string | null;
  runId: string | null;
  payload: SessionStateMutationPayload;
  sourceSnapshotFloorId: string | null;
  liveHeadKey: string | null;
  decisionStatus: SessionStateMutationDecisionStatus;
  decisionReason: string | null;
  decisionCode: string | null;
  linkedVariableStageId: string | null;
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

export interface SessionStatePublicSlotDefinition {
  namespace: SessionStateNamespace;
  slot: string;
  ownerKind: SessionStateSlotOwnerKind;
  exposureLifecycle: SessionStatePublicExposureLifecycle;
  visibilityMode: SessionStateVisibilityMode;
  defaultWriteMode: SessionStateWriteMode;
  defaultReplaySafety: ToolReplaySafety;
  schemaVersion: number;
  sizeBudgetBytes: number;
  capabilities: SessionStateSlotCapabilities;
}

export interface SessionStateCustomNamespaceDefaultSlotTemplate {
  defaultVisibilityMode: SessionStateVisibilityMode;
  defaultWriteMode: SessionStateWriteMode;
  defaultReplaySafety: SessionStateReplaySafety;
  clientWritable: boolean;
  allowedWriteModes: SessionStateWriteMode[];
  supportsSnapshot: boolean;
  supportsDiff: boolean;
  replayPolicySource: SessionStateReplayPolicySource;
}

export interface SessionStatePublicBuiltInNamespaceDefinition {
  namespace: SessionStateNamespace;
  ownerKind: "built_in";
  slots: SessionStatePublicSlotDefinition[];
}

export interface SessionStatePublicCustomNamespaceDefinition {
  namespace: SessionStateNamespace;
  ownerKind: "custom";
  logicalOwnerType: SessionStateLogicalOwnerType;
  logicalOwnerId: string;
  defaultSlotTemplate: SessionStateCustomNamespaceDefaultSlotTemplate;
  slots: SessionStatePublicSlotDefinition[];
}

export type SessionStatePublicNamespaceDefinition =
  | SessionStatePublicBuiltInNamespaceDefinition
  | SessionStatePublicCustomNamespaceDefinition;

export interface SessionStateNamespaceRegistrationRecord {
  id: string;
  accountId: string;
  sessionId: string;
  domainId: string;
  namespace: SessionStateNamespace;
  logicalOwnerType: SessionStateLogicalOwnerType;
  logicalOwnerId: string;
  defaultSlotTemplate: SessionStateCustomNamespaceDefaultSlotTemplate;
  createdAt: number;
  updatedAt: number;
}

export interface SessionStatePublicResolvedValue {
  namespace: SessionStateNamespace;
  slot: string;
  source: SessionStateResolvedValue["source"] | "none";
  visibilityMode: SessionStateVisibilityMode;
  schemaVersion: number | null;
  present: boolean;
  value: unknown | null;
  sessionId: string;
  branchId: string;
  floorId: string | null;
  sourceMutationIds: string[];
  updatedAt: number | null;
}

export interface SessionStatePublicSnapshotValue {
  namespace: SessionStateNamespace;
  slot: string;
  visibilityMode: SessionStateVisibilityMode;
  schemaVersion: number | null;
  present: boolean;
  value: unknown | null;
  sessionId: string;
  branchId: string;
  floorId: string;
  sourceMutationIds: string[];
  committedAt: number | null;
}

export interface SessionStatePublicDiffEntry {
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

export type FirstPartyStateResolutionMode = "current_effective" | "source_floor";
export type FirstPartySceneResolutionMode = FirstPartyStateResolutionMode;

export interface LoadFirstPartySceneContextInput {
  accountId: string;
  sessionId: string;
  branchId: string;
  sourceFloorId?: string | null;
  expectedSourceBranchId?: string | null;
  resolutionMode?: FirstPartyStateResolutionMode;
}

export interface FirstPartySceneContext {
  namespace: typeof SESSION_STATE_NAMESPACE_GAME_STATE;
  slot: "scene";
  resolutionMode: FirstPartyStateResolutionMode;
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

export interface FirstPartyWorldPromptSnapshot {
  worldbookId: string | null;
  worldbookVersion: number | null;
  worldbookActivatedEntryUids: number[];
}

export interface LoadFirstPartyWorldContextInput {
  accountId: string;
  sessionId: string;
  branchId: string;
  sourceFloorId?: string | null;
  expectedSourceBranchId?: string | null;
  resolutionMode?: FirstPartyStateResolutionMode;
}

export interface FirstPartyWorldContext {
  namespace: typeof SESSION_STATE_NAMESPACE_GAME_STATE;
  slot: "world";
  resolutionMode: FirstPartyStateResolutionMode;
  source: SessionStateResolvedValue["source"] | "none";
  present: boolean;
  schemaVersion: number | null;
  sessionId: string;
  branchId: string;
  floorId: string | null;
  sourceMutationIds: string[];
  updatedAt: number | null;
  world: NormalizedFirstPartyWorldState | null;
}

export interface FirstPartyWorldStateValue {
  kind: "first_party_world_state";
  schemaVersion: number;
  sessionId: string;
  branchId: string;
  floorId: string;
  runType: FloorRunType;
  summaryLines: string[];
  worldbookId: string | null;
  worldbookVersion: number | null;
  activatedWorldbookEntryUids: number[];
  toolExecutionIds: string[];
  updatedAt: number;
}

export type NormalizedFirstPartyWorldState = FirstPartyWorldStateValue;

export interface StageFirstPartyWorldStateInput {
  accountId: string;
  sessionId: string;
  branchId: string;
  floorId: string;
  runType: FloorRunType;
  execution: Pick<TurnExecutionResult, "summaries" | "toolExecutionRecords">;
  promptSnapshot?: FirstPartyWorldPromptSnapshot | null;
  stagedAt?: number;
  requestId?: string | null;
}
