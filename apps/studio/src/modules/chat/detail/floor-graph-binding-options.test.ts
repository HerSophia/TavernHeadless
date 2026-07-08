import { describe, expect, it } from "vitest";

import type {
  NodeGraphDefinitionResponse,
  NodeGraphVersionResponse,
} from "../../../lib/nodegraph-api";
import {
  resolveDefaultVersionId,
  toGraphOptions,
  toVersionOptions,
} from "./floor-graph-binding-options";

function def(over: Partial<NodeGraphDefinitionResponse> = {}): NodeGraphDefinitionResponse {
  return {
    id: "g1",
    account_id: "a1",
    workspace_id: null,
    project_id: "p1",
    name: "Graph One",
    status: "active",
    current_version_id: "v2",
    created_at: 0,
    updated_at: 0,
    ...over,
  };
}

function ver(over: Partial<NodeGraphVersionResponse> = {}): NodeGraphVersionResponse {
  return {
    id: "v1",
    graph_id: "g1",
    version_no: 1,
    document: {} as NodeGraphVersionResponse["document"],
    document_hash: "h1",
    parent_version_id: null,
    operation_log_id: null,
    created_at: 0,
    ...over,
  };
}

describe("floor-graph-binding-options", () => {
  it("maps graphs to options (label=name, value=id)", () => {
    const options = toGraphOptions([
      def({ id: "ga", name: "Alpha" }),
      def({ id: "gb", name: "Beta" }),
    ]);
    expect(options).toEqual([
      { value: "ga", label: "Alpha" },
      { value: "gb", label: "Beta" },
    ]);
  });

  it("maps versions to options sorted by version_no desc", () => {
    const options = toVersionOptions([
      ver({ id: "v1", version_no: 1 }),
      ver({ id: "v3", version_no: 3 }),
      ver({ id: "v2", version_no: 2 }),
    ]);
    expect(options).toEqual([
      { value: "v3", label: "v3" },
      { value: "v2", label: "v2" },
      { value: "v1", label: "v1" },
    ]);
  });

  it("does not mutate the input version array", () => {
    const input = [ver({ id: "v1", version_no: 1 }), ver({ id: "v2", version_no: 2 })];
    toVersionOptions(input);
    expect(input.map((v) => v.id)).toEqual(["v1", "v2"]);
  });

  it("resolves default version to current_version_id when present", () => {
    const graph = def({ current_version_id: "v2" });
    const versions = [ver({ id: "v1", version_no: 1 }), ver({ id: "v2", version_no: 2 })];
    expect(resolveDefaultVersionId(graph, versions)).toBe("v2");
  });

  it("falls back to the latest version when current_version_id is missing from the list", () => {
    const graph = def({ current_version_id: "v9" });
    const versions = [ver({ id: "v1", version_no: 1 }), ver({ id: "v3", version_no: 3 })];
    expect(resolveDefaultVersionId(graph, versions)).toBe("v3");
  });

  it("falls back to the latest version when graph is null", () => {
    const versions = [ver({ id: "v1", version_no: 1 }), ver({ id: "v2", version_no: 2 })];
    expect(resolveDefaultVersionId(null, versions)).toBe("v2");
  });

  it("returns null when there are no versions", () => {
    expect(resolveDefaultVersionId(def(), [])).toBeNull();
  });
});
