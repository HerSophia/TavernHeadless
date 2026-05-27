import type { VariableWriteIntent, VariableWriteSourceMetadata } from "@tavern/core";
import type { VariableEntry, VariableScope } from "@tavern/shared";

import type {
  PageInspectionDecisionCode,
  PageInspectionSourceKind,
} from "../state-governance/shared/page-inspection-contracts.js";

export const PAGE_STAGED_VARIABLE_WRITE_OPS = ["set", "delete"] as const;
export type PageStagedVariableWriteOp = (typeof PAGE_STAGED_VARIABLE_WRITE_OPS)[number];

export const PAGE_STAGED_VARIABLE_WRITE_STATUSES = [
  "staged",
  "accepted_page_only",
  "promoted",
  "rejected",
  "discarded",
  "rerouted_to_session_state",
] as const;
export type PageStagedVariableWriteStatus = (typeof PAGE_STAGED_VARIABLE_WRITE_STATUSES)[number];

export const PAGE_VARIABLE_DECISION_STATUSES = [
  "accepted",
  "rejected",
  "discarded",
  "rerouted_to_session_state",
] as const;
export type PageVariableDecisionStatus = (typeof PAGE_VARIABLE_DECISION_STATUSES)[number];

export interface PageVariableDecision {
  status: PageVariableDecisionStatus;
  decisionReason?: string | null;
  decisionCode?: PageInspectionDecisionCode | null;
  reroutedTarget?: "session_state" | null;
}

export const VARIABLE_CONFLICT_POLICIES = ["replace", "if_absent"] as const;
export type VariableConflictPolicy = (typeof VARIABLE_CONFLICT_POLICIES)[number];

export type PageStagedVariableWriteSource = VariableWriteSourceMetadata;

export interface PageStagedVariableWriteEvidence {
  runId?: string;
  generationAttemptNo?: number;
  bufferedAt?: number;
  committedAt?: number;
  accountId?: string;
  scope?: VariableScope;
  scopeId?: string;
}

export interface PageStagedVariableRerouteTarget {
  surface: "session_state";
  namespace?: string | null;
  slot?: string | null;
}

export interface PageStagedVariableWriteRecord {
  id: string;
  accountId: string;
  sessionId: string;
  branchId: string;
  floorId: string;
  pageId: string;
  key: string;
  op: PageStagedVariableWriteOp;
  value: unknown | null;
  intent: VariableWriteIntent;
  conflictPolicy: VariableConflictPolicy;
  sourceKind: PageInspectionSourceKind;
  actorClientId: string | null;
  source: PageStagedVariableWriteSource;
  evidence: PageStagedVariableWriteEvidence;
  reason: string;
  status: PageStagedVariableWriteStatus;
  reroutedTarget?: PageStagedVariableRerouteTarget | null;
  decisionCode: PageInspectionDecisionCode | null;
  decisionReason: string | null;
  linkedSessionStateMutationId: string | null;
  createdAt: number;
  resolvedAt: number | null;
}

export interface PageVariableStageSnapshot {
  pageId: string;
  floorId: string;
  sessionId: string;
  branchId: string;
  items: PageStagedVariableWriteRecord[];
}

export const VARIABLE_PROMOTION_FROM_SCOPES = ["page", "floor", "branch", "chat"] as const;
export type VariablePromotionFromScope = (typeof VARIABLE_PROMOTION_FROM_SCOPES)[number];

export const VARIABLE_PROMOTION_TO_SCOPES = ["floor", "branch", "chat", "global", "session_state"] as const;
export type VariablePromotionToScope = (typeof VARIABLE_PROMOTION_TO_SCOPES)[number];

export interface VariablePromotionTraceRecord {
  id: string;
  accountId: string;
  sessionId: string;
  branchId: string;
  floorId: string;
  pageId: string | null;
  stagedWriteId: string | null;
  key: string;
  fromScope: VariablePromotionFromScope;
  fromScopeId: string;
  toScope: VariablePromotionToScope;
  toScopeId: string;
  conflictPolicy: VariableConflictPolicy;
  sourceVariableId: string | null;
  targetVariableId: string | null;
  sourceKind: PageInspectionSourceKind;
  actorClientId: string | null;
  source: Record<string, unknown>;
  evidence: Record<string, unknown>;
  decisionCode: PageInspectionDecisionCode | null;
  reroutedTarget?: PageStagedVariableRerouteTarget | null;
  decisionReason: string | null;
  linkedSessionStateMutationId: string | null;
  value: unknown;
  createdAt: number;
}

export interface PageVariablePromotionTraceSnapshot {
  pageId: string;
  floorId: string;
  sessionId: string;
  branchId: string;
  items: VariablePromotionTraceRecord[];
}

export interface MaterializedPageVariableRecord {
  stagedWriteId: string;
  entry: VariableEntry;
  isNew: boolean;
}

export interface VariablePromotionResult {
  pageId?: string;
  floorId: string;
  sessionId: string;
  branchId?: string;
  fromScope: "page";
  toScope: "floor";
  policy: "replace" | "ifAbsent";
  scannedCount: number;
  promotedCount: number;
  skippedCount: number;
  promotedVariables: VariableEntry[];
  pageVariables: MaterializedPageVariableRecord[];
  stageWrites: PageStagedVariableWriteRecord[];
  promotionTraces: VariablePromotionTraceRecord[];
}
