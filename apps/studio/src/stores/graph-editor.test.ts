import type { NodeGraphDocument } from "@tavern/core/node-graph";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/nodegraph-api", () => {
  class NodeGraphApiError extends Error {
    constructor(
      readonly status: number,
      readonly detail: unknown,
      message?: string,
    ) {
      super(message ?? `status ${status}`);
      this.name = "NodeGraphApiError";
    }
  }
  return {
    NodeGraphApiError,
    nodeGraphApi: {
      get: vi.fn(),
      list: vi.fn(),
      listVersions: vi.fn(),
      create: vi.fn(),
      createVersion: vi.fn(),
      setCurrentVersion: vi.fn(),
    },
  };
});

import {
  NodeGraphApiError,
  nodeGraphApi,
  type NodeGraphDefinitionResponse,
  type NodeGraphVersionResponse,
} from "../lib/nodegraph-api";
import { cloneGraphDocument, generateEdgeId, generateNodeId, useGraphEditorStore } from "./graph-editor";

function validDocument(): NodeGraphDocument {
  return {
    schemaVersion: 2,
    graphId: "g1",
    name: "G1",
    mode: "native_graph",
    nodes: [{ id: "n1", type: "source.user_input", typeVersion: "1", phase: "pre_response" }],
    edges: [],
    policies: {},
  };
}

function defResponse(over: Partial<NodeGraphDefinitionResponse> = {}): NodeGraphDefinitionResponse {
  return {
    id: "g1",
    account_id: "a1",
    workspace_id: null,
    project_id: "p1",
    name: "G1",
    status: "active",
    current_version_id: "v1",
    created_at: 0,
    updated_at: 0,
    ...over,
  };
}

function verResponse(over: Partial<NodeGraphVersionResponse> = {}): NodeGraphVersionResponse {
  return {
    id: "v1",
    graph_id: "g1",
    version_no: 1,
    document: validDocument(),
    document_hash: "h1",
    parent_version_id: null,
    operation_log_id: null,
    created_at: 0,
    ...over,
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
});

describe("pure helpers", () => {
  it("generateNodeId derives a unique id from the type tail", () => {
    const document = validDocument();
    expect(generateNodeId(document, "source.user_input")).toBe("n_user_input_1");
    document.nodes.push({ id: "n_user_input_1", type: "source.user_input", typeVersion: "1", phase: "pre_response" });
    expect(generateNodeId(document, "source.user_input")).toBe("n_user_input_2");
  });

  it("generateEdgeId stays unique", () => {
    const document = validDocument();
    const first = generateEdgeId(document);
    document.edges.push({ id: first, from: { nodeId: "n1", port: "text" }, to: { nodeId: "n1", port: "text" } });
    expect(generateEdgeId(document)).not.toBe(first);
  });

  it("cloneGraphDocument produces an independent copy", () => {
    const original = validDocument();
    const clone = cloneGraphDocument(original);
    clone.nodes.push({ id: "n2", type: "source.character", typeVersion: "1", phase: "floor_prepare" });
    expect(original.nodes).toHaveLength(1);
  });
});

describe("graph-editor store: sample + validation gating", () => {
  it("loads the sample as an editable working copy with live diagnostics", () => {
    const store = useGraphEditorStore();
    store.loadSample();
    expect(store.isSample).toBe(true);
    expect(store.graphId).toBeNull();
    expect(store.document).not.toBeNull();
    expect(store.dirty).toBe(false);
    // 示例图刻意含错误（control.condition 缺 config、write 节点权限/策略）。
    expect(store.errorCount).toBeGreaterThan(0);
    expect(store.isExecutable).toBe(false);
    expect(store.canSaveVersion).toBe(false);
  });

  it("blocks saving an invalid graph and keeps the draft", async () => {
    const store = useGraphEditorStore();
    store.loadSample();
    const ok = await store.saveAsNewVersion("p1");
    expect(ok).toBe(false);
    expect(store.error).toBe("blocked_by_diagnostics");
    expect(nodeGraphApi.create).not.toHaveBeenCalled();
    expect(nodeGraphApi.createVersion).not.toHaveBeenCalled();
    // 草稿仍在。
    expect(store.document).not.toBeNull();
  });
});

describe("graph-editor store: editing actions", () => {
  it("adds and removes nodes, cascading incident edges", () => {
    const store = useGraphEditorStore();
    store.loadSample();
    const before = store.nodeCount;
    const node = store.addNode("source.persona");
    expect(node).not.toBeNull();
    expect(store.nodeCount).toBe(before + 1);
    expect(store.dirty).toBe(true);
    expect(store.selectedNodeId).toBe(node?.id);

    store.removeNode("n_user");
    expect(store.document?.nodes.some((n) => n.id === "n_user")).toBe(false);
    // 与 n_user 相连的边（e_user_wb）应一并移除。
    expect(store.document?.edges.some((e) => e.from.nodeId === "n_user" || e.to.nodeId === "n_user")).toBe(false);
  });

  it("adds edges and ignores duplicates", () => {
    const store = useGraphEditorStore();
    store.loadSample();
    const before = store.edgeCount;
    // e_user_wb 已存在（n_user.text → n_wb.query）。
    expect(store.addEdge({ nodeId: "n_user", port: "text" }, { nodeId: "n_wb", port: "query" })).toBeNull();
    expect(store.edgeCount).toBe(before);
    const created = store.addEdge({ nodeId: "n_user", port: "text" }, { nodeId: "n_compose", port: "messages" });
    expect(created).not.toBeNull();
    expect(store.edgeCount).toBe(before + 1);
  });

  it("updates node config and removes edges by id", () => {
    const store = useGraphEditorStore();
    store.loadSample();
    store.updateNodeConfig("n_cond", { condition: { all: [] } });
    expect(store.document?.nodes.find((n) => n.id === "n_cond")?.config).toEqual({ condition: { all: [] } });

    store.removeEdge("e_user_wb");
    expect(store.document?.edges.some((e) => e.id === "e_user_wb")).toBe(false);
  });

  it("persists positions into ui.position (auto-layout / drag write-back)", () => {
    const store = useGraphEditorStore();
    store.loadSample();
    store.applyNodePositions({ n_user: { x: 10, y: 20 } });
    const node = store.document?.nodes.find((n) => n.id === "n_user");
    expect(node?.ui?.position).toEqual({ x: 10, y: 20 });
    expect(store.dirty).toBe(true);
  });
});

describe("graph-editor store: version read / save", () => {
  it("loads a graph's current version into the editor", async () => {
    vi.mocked(nodeGraphApi.get).mockResolvedValue({
      definition: defResponse(),
      current_version: verResponse(),
    });
    vi.mocked(nodeGraphApi.listVersions).mockResolvedValue({ items: [verResponse()] });

    const store = useGraphEditorStore();
    await store.loadGraph("p1", "g1");

    expect(store.graphId).toBe("g1");
    expect(store.isSample).toBe(false);
    expect(store.baseVersionId).toBe("v1");
    expect(store.serverCurrentVersionId).toBe("v1");
    expect(store.document?.nodes).toHaveLength(1);
    expect(store.isExecutable).toBe(true);
    expect(store.dirty).toBe(false);
    expect(store.versions).toHaveLength(1);
  });

  it("saves an edited valid graph as a new version", async () => {
    vi.mocked(nodeGraphApi.get).mockResolvedValue({
      definition: defResponse(),
      current_version: verResponse(),
    });
    vi.mocked(nodeGraphApi.listVersions).mockResolvedValue({ items: [verResponse()] });
    vi.mocked(nodeGraphApi.createVersion).mockResolvedValue({
      definition: defResponse({ current_version_id: "v2" }),
      version: verResponse({ id: "v2", version_no: 2, parent_version_id: "v1" }),
      validation: { diagnostics: [], isValid: true },
    });

    const store = useGraphEditorStore();
    await store.loadGraph("p1", "g1");
    store.renameGraph("G1 edited");
    expect(store.dirty).toBe(true);
    expect(store.canSaveVersion).toBe(true);

    const ok = await store.saveAsNewVersion("p1");
    expect(ok).toBe(true);
    expect(nodeGraphApi.createVersion).toHaveBeenCalledWith("p1", "g1", expect.anything(), "v1");
    expect(store.baseVersionId).toBe("v2");
    expect(store.serverCurrentVersionId).toBe("v2");
    expect(store.dirty).toBe(false);
  });

  it("switches to a listed version (read/switch) without touching server current", () => {
    const store = useGraphEditorStore();
    store.versions = [
      verResponse({ id: "v1", version_no: 1 }),
      verResponse({
        id: "v2",
        version_no: 2,
        document: { ...validDocument(), name: "v2 doc" },
      }),
    ];
    store.serverCurrentVersionId = "v1";
    store.loadVersion("v2");
    expect(store.baseVersionId).toBe("v2");
    expect(store.document?.name).toBe("v2 doc");
    expect(store.serverCurrentVersionId).toBe("v1");
    expect(store.dirty).toBe(false);
  });

  it("sets a version as the server current version", async () => {
    vi.mocked(nodeGraphApi.setCurrentVersion).mockResolvedValue({
      definition: defResponse({ current_version_id: "v2" }),
      version: verResponse({ id: "v2", version_no: 2 }),
    });
    const store = useGraphEditorStore();
    store.graphId = "g1";
    const ok = await store.setAsCurrentVersion("p1", "v2");
    expect(ok).toBe(true);
    expect(nodeGraphApi.setCurrentVersion).toHaveBeenCalledWith("p1", "g1", "v2");
    expect(store.serverCurrentVersionId).toBe("v2");
  });

  it("creates a brand-new graph (blank graphId) when saving a draft without a target", async () => {
    vi.mocked(nodeGraphApi.create).mockResolvedValue({
      definition: defResponse({ id: "gnew", current_version_id: "v1" }),
      version: verResponse({ id: "v1", graph_id: "gnew" }),
      validation: { diagnostics: [], isValid: true },
    });
    vi.mocked(nodeGraphApi.listVersions).mockResolvedValue({ items: [verResponse({ graph_id: "gnew" })] });

    const store = useGraphEditorStore();
    store.loadSample();
    store.document = validDocument();
    store.renameGraph("My Graph");
    expect(store.canSaveVersion).toBe(true);

    const ok = await store.saveAsNewVersion("p1");
    expect(ok).toBe(true);
    expect(nodeGraphApi.create).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ graphId: "" }),
      "My Graph",
    );
    expect(store.graphId).toBe("gnew");
    expect(store.dirty).toBe(false);
  });

  it("surfaces a backend error message when save fails", async () => {
    vi.mocked(nodeGraphApi.get).mockResolvedValue({
      definition: defResponse(),
      current_version: verResponse(),
    });
    vi.mocked(nodeGraphApi.listVersions).mockResolvedValue({ items: [verResponse()] });
    vi.mocked(nodeGraphApi.createVersion).mockRejectedValue(
      new NodeGraphApiError(400, { message: "document invalid" }),
    );

    const store = useGraphEditorStore();
    await store.loadGraph("p1", "g1");
    store.renameGraph("edited");
    const ok = await store.saveAsNewVersion("p1");
    expect(ok).toBe(false);
    expect(store.error).toBe("document invalid");
  });
});

describe("graph-editor store: more editing actions", () => {
  it("updates a node position and renames the graph", () => {
    const store = useGraphEditorStore();
    store.loadSample();
    store.updateNodePosition("n_user", { x: 5, y: 6 });
    expect(store.document?.nodes.find((n) => n.id === "n_user")?.ui?.position).toEqual({ x: 5, y: 6 });

    store.renameGraph("Renamed");
    expect(store.graphName).toBe("Renamed");
    expect(store.document?.name).toBe("Renamed");
    expect(store.dirty).toBe(true);
  });

  it("adds a control edge with kind control", () => {
    const store = useGraphEditorStore();
    store.loadSample();
    const edge = store.addEdge({ nodeId: "n_branch", port: "false" }, { nodeId: "n_compose", port: "messages" }, "control");
    expect(edge?.kind).toBe("control");
  });

  it("clears edge selection when the selected edge is removed", () => {
    const store = useGraphEditorStore();
    store.loadSample();
    store.selectEdge("e_user_wb");
    expect(store.selectedEdgeId).toBe("e_user_wb");
    store.removeEdge("e_user_wb");
    expect(store.selectedEdgeId).toBeNull();
  });

  it("discards a sample draft back to the pristine sample", () => {
    const store = useGraphEditorStore();
    store.loadSample();
    store.addNode("source.persona");
    expect(store.dirty).toBe(true);
    store.discardDraft();
    expect(store.dirty).toBe(false);
    expect(store.document?.nodes.some((n) => n.type === "source.persona")).toBe(false);
  });
});

describe("graph-editor store: guards with no document", () => {
  it("no-ops editing actions when no document is loaded", async () => {
    const store = useGraphEditorStore();
    expect(store.document).toBeNull();
    expect(store.addNode("source.user_input")).toBeNull();
    expect(store.addEdge({ nodeId: "a", port: "x" }, { nodeId: "b", port: "y" })).toBeNull();
    store.removeNode("a");
    store.removeEdge("e");
    store.updateNode("a", { name: "x" });
    store.updateNodeConfig("a", {});
    store.updateNodePosition("a", { x: 0, y: 0 });
    store.applyNodePositions({ a: { x: 0, y: 0 } });
    store.renameGraph("x");
    store.loadVersion("missing");
    expect(store.nodeCount).toBe(0);
    expect(store.canSaveVersion).toBe(false);
    expect(await store.saveAsNewVersion("p1")).toBe(false);
    expect(await store.setAsCurrentVersion("p1", "v1")).toBe(false);
  });

  it("handles a graph with no current version", async () => {
    vi.mocked(nodeGraphApi.get).mockResolvedValue({
      definition: defResponse({ current_version_id: null }),
      current_version: null,
    });
    const store = useGraphEditorStore();
    await store.loadGraph("p1", "g1");
    expect(store.document).toBeNull();
    expect(store.baseVersionId).toBeNull();
  });

  it("reports a load error", async () => {
    vi.mocked(nodeGraphApi.get).mockRejectedValue(new Error("offline"));
    const store = useGraphEditorStore();
    await store.loadGraph("p1", "g1");
    expect(store.document).toBeNull();
    expect(store.error).toBe("offline");
  });
});
