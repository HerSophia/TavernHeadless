import type { ResolvedVariablesSnapshot, VariableScope } from "@tavern/sdk";

export type VariableSnapshotLike = Pick<ResolvedVariablesSnapshot, "layers" | "resolved"> | null | undefined;

export type VariableInspectorLayerValue = {
  isWinning: boolean;
  preview: string;
  scope: VariableScope;
  scopeId: string;
  updatedAt: number;
  value: unknown;
};

export type VariableInspectorRow = {
  key: string;
  layers: VariableInspectorLayerValue[];
  preview: string;
  sourceScope: VariableScope;
  sourceScopeId: string;
  updatedAt: number;
  value: unknown;
};
