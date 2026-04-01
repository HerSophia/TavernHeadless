import type { BranchVariableScopeRef, ResolvedVariablesSnapshot, VariableScope } from "@tavern/sdk";

export type VariableSnapshotLike = Pick<ResolvedVariablesSnapshot, "layers" | "resolved"> | null | undefined;

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
