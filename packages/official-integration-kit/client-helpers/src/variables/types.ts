import type {
  BranchVariableScopeRef,
  PageStagedVariableWriteRecord,
  PageStagedVariableWriteSnapshot,
  PageVariablePromotionTraceSnapshot,
  ResolvedVariablesSnapshot,
  VariablePromotionTraceRecord,
  VariableScope,
} from "@tavern/sdk";

export type VariableSnapshotLike = Pick<ResolvedVariablesSnapshot, "layers" | "resolved"> | null | undefined;

export type PageStagedVariableWriteLike = Pick<PageStagedVariableWriteSnapshot, "items"> | null | undefined;

export type VariablePromotionTraceLike = Pick<PageVariablePromotionTraceSnapshot, "items"> | null | undefined;

export type VariableInspectorLayerValue = {
  isWinning: boolean;
  preview: string;
  scope: VariableScope;
  scopeId: string;
  scopeRef?: BranchVariableScopeRef;
  updatedAt: number;
  value: unknown;
};

export type VariableInspectorRow = {
  key: string;
  layers: VariableInspectorLayerValue[];
  preview: string;
  sourceScope: VariableScope;
  sourceScopeId: string;
  sourceScopeRef?: BranchVariableScopeRef;
  updatedAt: number;
  value: unknown;
};

export type FlattenedPageStagedVariableWrite = {
  createdAt: number;
  decisionReason: string | null;
  id: string;
  intent: PageStagedVariableWriteRecord["intent"];
  key: string;
  op: PageStagedVariableWriteRecord["op"];
  preview: string;
  reason: string;
  resolvedAt: number | null;
  source: PageStagedVariableWriteRecord["source"];
  evidence: PageStagedVariableWriteRecord["evidence"];
  status: PageStagedVariableWriteRecord["status"];
  value: unknown | null;
};

export type GroupedVariablePromotionTrace = {
  key: string;
  latestCreatedAt: number;
  items: VariablePromotionTraceRecord[];
};
