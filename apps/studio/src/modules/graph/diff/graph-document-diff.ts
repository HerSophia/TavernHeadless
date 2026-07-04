import type {
  NodeGraphDocument,
  NodeGraphEdge,
  NodeGraphGroup,
  NodeGraphNode,
} from "@tavern/core/node-graph";

export const GRAPH_DOCUMENT_DIFF_KINDS = [
  "node_added",
  "node_removed",
  "node_changed",
  "node_config_changed",
  "edge_added",
  "edge_removed",
  "edge_changed",
  "group_added",
  "group_removed",
  "group_changed",
  "policies_changed",
  "permissions_changed",
] as const;

export type GraphDocumentDiffKind = (typeof GRAPH_DOCUMENT_DIFF_KINDS)[number];

export type GraphDocumentDiffTargetType = "graph" | "node" | "edge" | "group";

export interface GraphDocumentDiffEntry {
  kind: GraphDocumentDiffKind;
  targetType: GraphDocumentDiffTargetType;
  targetId?: string;
  path: string;
  before?: unknown;
  after?: unknown;
}

export interface GraphDocumentDiffResult {
  entries: GraphDocumentDiffEntry[];
  counts: Record<GraphDocumentDiffKind, number>;
  hasChanges: boolean;
}

const NODE_FIELD_KEYS = [
  "type",
  "typeVersion",
  "name",
  "enabled",
  "phase",
  "retryPolicy",
  "failurePolicy",
  "previewPolicy",
  "scope",
  "checkpointPolicy",
  "ui",
] as const satisfies readonly (keyof NodeGraphNode)[];

const EDGE_FIELD_KEYS = ["from", "to", "kind"] as const satisfies readonly (keyof NodeGraphEdge)[];

function emptyCounts(): Record<GraphDocumentDiffKind, number> {
  return Object.fromEntries(GRAPH_DOCUMENT_DIFF_KINDS.map((kind) => [kind, 0])) as Record<GraphDocumentDiffKind, number>;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function sameValue(left: unknown, right: unknown): boolean {
  return stableStringify(left) === stableStringify(right);
}

function byId<T extends { id: string }>(items: readonly T[] | undefined): Map<string, T> {
  return new Map((items ?? []).map((item) => [item.id, item]));
}

function addEntry(entries: GraphDocumentDiffEntry[], entry: GraphDocumentDiffEntry): void {
  entries.push(entry);
}

function normalizedEdgeField(edge: NodeGraphEdge, field: (typeof EDGE_FIELD_KEYS)[number]): unknown {
  if (field === "kind") {
    return edge.kind ?? "data";
  }
  return edge[field];
}

function compareNodes(entries: GraphDocumentDiffEntry[], before: NodeGraphDocument, after: NodeGraphDocument): void {
  const beforeById = byId(before.nodes);
  const afterById = byId(after.nodes);
  const ids = [...new Set([...beforeById.keys(), ...afterById.keys()])].sort();

  for (const id of ids) {
    const left = beforeById.get(id);
    const right = afterById.get(id);
    if (!left && right) {
      addEntry(entries, {
        kind: "node_added",
        targetType: "node",
        targetId: id,
        path: `nodes.${id}`,
        after: right,
      });
      continue;
    }
    if (left && !right) {
      addEntry(entries, {
        kind: "node_removed",
        targetType: "node",
        targetId: id,
        path: `nodes.${id}`,
        before: left,
      });
      continue;
    }
    if (!left || !right) {
      continue;
    }

    for (const field of NODE_FIELD_KEYS) {
      if (!sameValue(left[field], right[field])) {
        addEntry(entries, {
          kind: "node_changed",
          targetType: "node",
          targetId: id,
          path: `nodes.${id}.${field}`,
          before: left[field],
          after: right[field],
        });
      }
    }

    if (!sameValue(left.config, right.config)) {
      addEntry(entries, {
        kind: "node_config_changed",
        targetType: "node",
        targetId: id,
        path: `nodes.${id}.config`,
        before: left.config,
        after: right.config,
      });
    }
  }
}

function compareEdges(entries: GraphDocumentDiffEntry[], before: NodeGraphDocument, after: NodeGraphDocument): void {
  const beforeById = byId(before.edges);
  const afterById = byId(after.edges);
  const ids = [...new Set([...beforeById.keys(), ...afterById.keys()])].sort();

  for (const id of ids) {
    const left = beforeById.get(id);
    const right = afterById.get(id);
    if (!left && right) {
      addEntry(entries, {
        kind: "edge_added",
        targetType: "edge",
        targetId: id,
        path: `edges.${id}`,
        after: right,
      });
      continue;
    }
    if (left && !right) {
      addEntry(entries, {
        kind: "edge_removed",
        targetType: "edge",
        targetId: id,
        path: `edges.${id}`,
        before: left,
      });
      continue;
    }
    if (!left || !right) {
      continue;
    }

    for (const field of EDGE_FIELD_KEYS) {
      const beforeValue = normalizedEdgeField(left, field);
      const afterValue = normalizedEdgeField(right, field);
      if (!sameValue(beforeValue, afterValue)) {
        addEntry(entries, {
          kind: "edge_changed",
          targetType: "edge",
          targetId: id,
          path: `edges.${id}.${field}`,
          before: beforeValue,
          after: afterValue,
        });
      }
    }
  }
}

function compareGroups(entries: GraphDocumentDiffEntry[], before: NodeGraphDocument, after: NodeGraphDocument): void {
  const beforeById = byId(before.groups);
  const afterById = byId(after.groups);
  const ids = [...new Set([...beforeById.keys(), ...afterById.keys()])].sort();

  for (const id of ids) {
    const left = beforeById.get(id);
    const right = afterById.get(id);
    if (!left && right) {
      addEntry(entries, {
        kind: "group_added",
        targetType: "group",
        targetId: id,
        path: `groups.${id}`,
        after: right,
      });
      continue;
    }
    if (left && !right) {
      addEntry(entries, {
        kind: "group_removed",
        targetType: "group",
        targetId: id,
        path: `groups.${id}`,
        before: left,
      });
      continue;
    }
    if (left && right && !sameValue(normalizeGroup(left), normalizeGroup(right))) {
      addEntry(entries, {
        kind: "group_changed",
        targetType: "group",
        targetId: id,
        path: `groups.${id}`,
        before: left,
        after: right,
      });
    }
  }
}

function normalizeGroup(group: NodeGraphGroup): NodeGraphGroup {
  return {
    ...group,
    nodeIds: [...group.nodeIds].sort(),
    disabledChannels: group.disabledChannels ? [...group.disabledChannels].sort() : undefined,
  };
}

export function diffNodeGraphDocuments(
  before: NodeGraphDocument,
  after: NodeGraphDocument,
): GraphDocumentDiffResult {
  const entries: GraphDocumentDiffEntry[] = [];

  compareNodes(entries, before, after);
  compareEdges(entries, before, after);
  compareGroups(entries, before, after);

  if (!sameValue(before.policies ?? {}, after.policies ?? {})) {
    addEntry(entries, {
      kind: "policies_changed",
      targetType: "graph",
      path: "policies",
      before: before.policies ?? {},
      after: after.policies ?? {},
    });
  }

  if (!sameValue(before.permissions ?? {}, after.permissions ?? {})) {
    addEntry(entries, {
      kind: "permissions_changed",
      targetType: "graph",
      path: "permissions",
      before: before.permissions ?? {},
      after: after.permissions ?? {},
    });
  }

  const counts = emptyCounts();
  for (const entry of entries) {
    counts[entry.kind] += 1;
  }

  return {
    entries,
    counts,
    hasChanges: entries.length > 0,
  };
}
