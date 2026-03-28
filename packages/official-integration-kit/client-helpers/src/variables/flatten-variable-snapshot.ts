import type { VariableInspectorLayerValue, VariableInspectorRow, VariableSnapshotLike } from "./types.js";
import type { ResolvedVariableRecord, VariableScope } from "@tavern/sdk";

const SCOPE_PRIORITY: Record<VariableScope, number> = {
  page: 0,
  floor: 1,
  chat: 2,
  global: 3,
};

export function flattenVariableSnapshot(snapshot: VariableSnapshotLike): VariableInspectorRow[] {
  if (!snapshot) {
    return [];
  }

  const layersByKey = buildLayerIndex(snapshot);

  return snapshot.resolved.map((item) => {
    const winningLayer = createWinningLayer(item);
    const layers = layersByKey.get(item.key)?.map((layer) => ({
      ...layer,
      isWinning: isWinningLayer(layer, item),
    })) ?? [winningLayer];

    if (!layers.some((layer) => layer.isWinning)) {
      layers.push(winningLayer);
    }

    return {
      key: item.key,
      layers: sortVariableLayers(layers),
      preview: formatVariablePreview(item.value),
      sourceScope: item.sourceScope,
      sourceScopeId: item.sourceScopeId,
      updatedAt: item.updatedAt,
      value: item.value,
    };
  });
}

export function sortVariableInspectorRows(rows: readonly VariableInspectorRow[]): VariableInspectorRow[] {
  return [...rows].sort((left, right) => {
    const keyOrder = left.key.localeCompare(right.key);
    if (keyOrder !== 0) {
      return keyOrder;
    }

    const scopeOrder = compareVariableScopes(left.sourceScope, right.sourceScope);
    if (scopeOrder !== 0) {
      return scopeOrder;
    }

    if (left.updatedAt !== right.updatedAt) {
      return right.updatedAt - left.updatedAt;
    }

    return left.sourceScopeId.localeCompare(right.sourceScopeId);
  });
}

export function formatVariablePreview(value: unknown): string {
  if (value === undefined) {
    return "";
  }

  if (value === null) {
    return "null";
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return `[Array(${value.length})]`;
  }

  if (typeof value === "object") {
    try {
      return JSON.stringify(value) ?? "[Object]";
    } catch {
      return "[Object]";
    }
  }

  return String(value);
}

function buildLayerIndex(snapshot: Exclude<VariableSnapshotLike, null | undefined>): Map<string, VariableInspectorLayerValue[]> {
  const result = new Map<string, VariableInspectorLayerValue[]>();
  const scopes: VariableScope[] = ["page", "floor", "chat", "global"];

  for (const scope of scopes) {
    const layer = snapshot.layers?.[scope];
    if (!layer) {
      continue;
    }

    for (const item of layer.items) {
      const values = result.get(item.key) ?? [];
      values.push({
        isWinning: false,
        preview: formatVariablePreview(item.value),
        scope: layer.scope,
        scopeId: layer.scopeId,
        updatedAt: item.updatedAt,
        value: item.value,
      });
      result.set(item.key, values);
    }
  }

  return result;
}

function createWinningLayer(item: ResolvedVariableRecord): VariableInspectorLayerValue {
  return {
    isWinning: true,
    preview: formatVariablePreview(item.value),
    scope: item.sourceScope,
    scopeId: item.sourceScopeId,
    updatedAt: item.updatedAt,
    value: item.value,
  };
}

function sortVariableLayers(layers: readonly VariableInspectorLayerValue[]): VariableInspectorLayerValue[] {
  return [...layers].sort((left, right) => {
    const scopeOrder = compareVariableScopes(left.scope, right.scope);
    if (scopeOrder !== 0) {
      return scopeOrder;
    }

    if (left.updatedAt !== right.updatedAt) {
      return right.updatedAt - left.updatedAt;
    }

    return left.scopeId.localeCompare(right.scopeId);
  });
}

function compareVariableScopes(left: VariableScope, right: VariableScope): number {
  return (SCOPE_PRIORITY[left] ?? Number.MAX_SAFE_INTEGER) - (SCOPE_PRIORITY[right] ?? Number.MAX_SAFE_INTEGER);
}

function isWinningLayer(layer: VariableInspectorLayerValue, item: ResolvedVariableRecord): boolean {
  return layer.scope === item.sourceScope && layer.scopeId === item.sourceScopeId;
}
