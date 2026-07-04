import type { NodeGraphDocument } from "@tavern/core/node-graph";
import { describe, expect, it } from "vitest";

import { diffNodeGraphDocuments } from "./graph-document-diff";

function doc(partial: Partial<NodeGraphDocument> = {}): NodeGraphDocument {
  return {
    schemaVersion: 2,
    graphId: "g1",
    name: "G1",
    mode: "native_graph",
    nodes: [
      {
        id: "n1",
        type: "source.user_input",
        typeVersion: "1",
        phase: "pre_response",
        config: { label: "before" },
      },
    ],
    edges: [],
    groups: [],
    policies: {},
    ...partial,
  };
}

describe("diffNodeGraphDocuments", () => {
  it("reports added and removed nodes", () => {
    const before = doc({ nodes: [{ id: "old", type: "source.user_input", typeVersion: "1", phase: "pre_response" }] });
    const after = doc({ nodes: [{ id: "new", type: "source.user_input", typeVersion: "1", phase: "pre_response" }] });

    const diff = diffNodeGraphDocuments(before, after);

    expect(diff.entries.map((entry) => entry.kind)).toEqual(["node_added", "node_removed"]);
    expect(diff.counts.node_added).toBe(1);
    expect(diff.counts.node_removed).toBe(1);
    expect(diff.hasChanges).toBe(true);
  });

  it("reports node field and config changes separately", () => {
    const before = doc();
    const after = doc({
      nodes: [
        {
          id: "n1",
          type: "source.user_input",
          typeVersion: "1",
          phase: "response",
          config: { label: "after" },
        },
      ],
    });

    const diff = diffNodeGraphDocuments(before, after);

    expect(diff.entries.some((entry) => entry.kind === "node_changed" && entry.path === "nodes.n1.phase")).toBe(true);
    expect(diff.entries.some((entry) => entry.kind === "node_config_changed" && entry.path === "nodes.n1.config")).toBe(true);
  });

  it("reports added, removed and changed edges", () => {
    const before = doc({
      nodes: [
        { id: "n1", type: "source.user_input", typeVersion: "1", phase: "pre_response" },
        { id: "n2", type: "source.user_input", typeVersion: "1", phase: "pre_response" },
      ],
      edges: [
        { id: "same", from: { nodeId: "n1", port: "text" }, to: { nodeId: "n2", port: "text" } },
        { id: "removed", from: { nodeId: "n1", port: "text" }, to: { nodeId: "n2", port: "text" } },
      ],
    });
    const after = doc({
      nodes: before.nodes,
      edges: [
        { id: "same", from: { nodeId: "n1", port: "text" }, to: { nodeId: "n2", port: "text" }, kind: "control" },
        { id: "added", from: { nodeId: "n2", port: "text" }, to: { nodeId: "n1", port: "text" } },
      ],
    });

    const diff = diffNodeGraphDocuments(before, after);

    expect(diff.counts.edge_added).toBe(1);
    expect(diff.counts.edge_removed).toBe(1);
    expect(diff.entries.some((entry) => entry.kind === "edge_changed" && entry.path === "edges.same.kind")).toBe(true);
  });

  it("normalizes missing edge kind as data", () => {
    const before = doc({
      edges: [{ id: "e1", from: { nodeId: "n1", port: "text" }, to: { nodeId: "n1", port: "text" } }],
    });
    const after = doc({
      edges: [{ id: "e1", from: { nodeId: "n1", port: "text" }, to: { nodeId: "n1", port: "text" }, kind: "data" }],
    });

    const diff = diffNodeGraphDocuments(before, after);

    expect(diff.entries.filter((entry) => entry.kind === "edge_changed")).toHaveLength(0);
  });

  it("reports group, policies and permissions changes", () => {
    const before = doc({
      groups: [{ id: "g", name: "Group", kind: "visual", nodeIds: ["n1"] }],
      policies: { allowBackgroundJobs: false },
      permissions: { required: ["a"] },
    });
    const after = doc({
      groups: [{ id: "g", name: "Renamed", kind: "visual", nodeIds: ["n1"] }],
      policies: { allowBackgroundJobs: true },
      permissions: { required: ["b"] },
    });

    const diff = diffNodeGraphDocuments(before, after);

    expect(diff.counts.group_changed).toBe(1);
    expect(diff.counts.policies_changed).toBe(1);
    expect(diff.counts.permissions_changed).toBe(1);
  });

  it("returns no entries for equivalent documents", () => {
    const before = doc();
    const after = JSON.parse(JSON.stringify(before)) as NodeGraphDocument;

    const diff = diffNodeGraphDocuments(before, after);

    expect(diff.entries).toEqual([]);
    expect(diff.hasChanges).toBe(false);
  });
});
