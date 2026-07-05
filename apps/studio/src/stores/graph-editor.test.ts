import {
  buildDirectorAdvisorSubgraph,
  buildMemoryRetrieveSubgraph,
  deriveSubgraphInterface,
  type NodeGraphDocument,
} from "@tavern/core/node-graph";
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
      validate: vi.fn(),
      listFloorGraphBindings: vi.fn(),
      setFloorGraphBinding: vi.fn(),
      clearFloorGraphBinding: vi.fn(),
      remove: vi.fn(),
    },
  };
});

import {
  NodeGraphApiError,
  nodeGraphApi,
  type FloorGraphBindingResponse,
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

function importedPresetDocument(purpose: "narrator_graph" | "compat_floor_graph"): NodeGraphDocument {
  return {
    schemaVersion: 2,
    graphId: "imported-narrator",
    name: purpose === "compat_floor_graph" ? "Compat Import" : "Narrator Import",
    mode: "native_graph",
    nodes: [
      { id: "n_user_input", type: "source.user_input", typeVersion: "1", phase: "pre_response" },
      { id: "n_narrator", type: "narration.narrator", typeVersion: "1", phase: "response" },
      { id: "n_commit", type: "output.commit_gate", typeVersion: "1", phase: "commit" },
    ],
    edges: [
      { id: "e_user_input", from: { nodeId: "n_user_input", port: "text" }, to: { nodeId: "n_narrator", port: "user_input" } },
      { id: "e_commit", from: { nodeId: "n_narrator", port: "text" }, to: { nodeId: "n_commit", port: "text" } },
    ],
    policies: {},
    metadata: {
      importedFrom: "sillytavern_openai_preset",
      importPurpose: purpose,
    },
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

function floorBindingResponse(over: Partial<FloorGraphBindingResponse> = {}): FloorGraphBindingResponse {
  return {
    id: "fgb1",
    account_id: "a1",
    workspace_id: "w1",
    project_id: "p1",
    kind: "compat",
    graph_id: "g1",
    graph_version_id: "v1",
    graph_name: "G1",
    graph_version_no: 1,
    status: "active",
    created_at: 0,
    updated_at: 0,
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

describe("graph settings actions", () => {
  it("patches graph policies and marks the document dirty", () => {
    const store = useGraphEditorStore();
    store.loadSample();

    store.patchGraphPolicies({ allowBackgroundJobs: true });

    expect(store.document?.policies.allowBackgroundJobs).toBe(true);
    expect(store.dirty).toBe(true);
  });

  it("updates permissions and budgets on the same document", () => {
    const store = useGraphEditorStore();
    store.loadSample();

    store.updateGraphPermissions({ required: ["project.agent.run"], outputTargets: [] });
    store.updateGraphBudgets({ maxNodesExecuted: 10, maxNestedAgentJobs: 0 });

    expect(store.document?.permissions?.required).toEqual(["project.agent.run"]);
    expect(store.document?.permissions?.outputTargets).toEqual([]);
    expect(store.document?.budgets).toEqual({ maxNodesExecuted: 10, maxNestedAgentJobs: 0 });
  });

  it("removes empty budgets", () => {
    const store = useGraphEditorStore();
    store.loadSample();

    store.updateGraphBudgets({});

    expect(store.document?.budgets).toBeUndefined();
  });
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
  it("loads the bundled Narrator sample as an editable, executable working copy", () => {
    const store = useGraphEditorStore();
    store.loadSample();
    expect(store.isSample).toBe(true);
    expect(store.graphId).toBeNull();
    expect(store.document).not.toBeNull();
    expect(store.dirty).toBe(false);
    // 示例图刻意做成干净可执行（无 error 级诊断）。
    expect(store.errorCount).toBe(0);
    expect(store.isExecutable).toBe(true);
    // 刚加载未改动 → 仍不可另存（canSaveVersion 需 dirty）。
    expect(store.canSaveVersion).toBe(false);
  });

  it("enters and exits a group (drill-in) and resets on reload", () => {
    const store = useGraphEditorStore();
    store.loadSample();
    expect(store.activeGroupId).toBeNull();

    store.enterGroup("g_preflight");
    expect(store.activeGroupId).toBe("g_preflight");
    expect(store.activeGroup?.id).toBe("g_preflight");

    // 不存在的组：忽略（保持当前钻入）。
    store.enterGroup("does_not_exist");
    expect(store.activeGroupId).toBe("g_preflight");

    store.exitGroup();
    expect(store.activeGroupId).toBeNull();

    // 重新加载样例应清空钻入态。
    store.enterGroup("g_preflight");
    store.loadSample();
    expect(store.activeGroupId).toBeNull();
  });

  it("imports a preset document as a fresh unsaved draft", () => {
    const store = useGraphEditorStore();
    store.importPreset(
      {
        schemaVersion: 2,
        graphId: "imported-narrator",
        name: "原名",
        mode: "native_graph",
        nodes: [
          { id: "n_user_input", type: "source.user_input", typeVersion: "1", phase: "pre_response" },
            { id: "n_narrator", type: "narration.narrator", typeVersion: "1", phase: "response" },
          { id: "n_commit", type: "output.commit_gate", typeVersion: "1", phase: "commit" },
        ],
        edges: [
          { id: "e_ui", from: { nodeId: "n_user_input", port: "text" }, to: { nodeId: "n_narrator", port: "user_input" } },
          { id: "e1", from: { nodeId: "n_narrator", port: "text" }, to: { nodeId: "n_commit", port: "text" } },
        ],
        policies: {},
      },
      "我的预设图",
    );
    // 全新草稿：无 graphId、非示例、已 dirty（选项目后可另存）。
    expect(store.graphId).toBeNull();
    expect(store.isSample).toBe(false);
    expect(store.dirty).toBe(true);
    expect(store.graphName).toBe("我的预设图");
    expect(store.document?.name).toBe("我的预设图");
    expect(store.isExecutable).toBe(true);
    expect(store.baseVersionId).toBeNull();
  });

  it("recognizes SillyTavern compat floor import drafts", () => {
    const store = useGraphEditorStore();
    store.importPreset(importedPresetDocument("compat_floor_graph"), "Compat Import");
    expect(store.isImportedSillyTavernPreset).toBe(true);
    expect(store.isCompatFloorImportDraft).toBe(true);

    store.importPreset(importedPresetDocument("narrator_graph"), "Narrator Import");
    expect(store.isImportedSillyTavernPreset).toBe(true);
    expect(store.isCompatFloorImportDraft).toBe(false);

    store.loadSample();
    expect(store.isImportedSillyTavernPreset).toBe(false);
    expect(store.isCompatFloorImportDraft).toBe(false);
  });

  it("blocks saving an invalid graph and keeps the draft", async () => {
    const store = useGraphEditorStore();
    store.loadSample();
    // 注入含 error 的草稿（未知节点类型）→ 保存应被诊断阻断。
    store.document = {
      schemaVersion: 2,
      graphId: "draft",
      name: "draft",
      mode: "native_graph",
      nodes: [{ id: "bad", type: "does.not.exist", typeVersion: "1", phase: "response" }],
      edges: [],
      policies: {},
    };
    expect(store.isExecutable).toBe(false);
    const ok = await store.saveAsNewVersion("p1");
    expect(ok).toBe(false);
    expect(store.error).toBe("blocked_by_diagnostics");
    expect(nodeGraphApi.create).not.toHaveBeenCalled();
    expect(nodeGraphApi.createVersion).not.toHaveBeenCalled();
    // 草稿仍在。
    expect(store.document).not.toBeNull();
  });
});

describe("graph-editor store: default floor template (DG11)", () => {
  it("loads the default floor template as a forkable, dirty, executable draft", () => {
    const store = useGraphEditorStore();
    store.loadTemplate("native", "默认楼层模板");
    expect(store.isTemplate).toBe(true);
    expect(store.templateKind).toBe("native");
    expect(store.isSample).toBe(false);
    expect(store.graphId).toBeNull();
    expect(store.baseVersionId).toBeNull();
    expect(store.document).not.toBeNull();
    expect(store.graphName).toBe("默认楼层模板");
    expect(store.document?.name).toBe("默认楼层模板");
    expect(store.document?.metadata?.template).toBe("native_prompt_floor");
    // 与系统图同结构、干净可执行 → 载入即 dirty，可立即保存（即 fork）。
    expect(store.errorCount).toBe(0);
    expect(store.isExecutable).toBe(true);
    expect(store.dirty).toBe(true);
    expect(store.canSaveVersion).toBe(true);
  });

  it("forks into a brand-new project graph on save (clears graphId for create)", async () => {
    vi.mocked(nodeGraphApi.create).mockResolvedValue({
      definition: defResponse({ id: "g_fork", current_version_id: "v1" }),
      version: verResponse({ id: "v1", graph_id: "g_fork" }),
      validation: { diagnostics: [], isValid: true },
    });
    vi.mocked(nodeGraphApi.listVersions).mockResolvedValue({ items: [verResponse({ graph_id: "g_fork" })] });

    const store = useGraphEditorStore();
    store.loadTemplate("native", "默认楼层模板");
    const ok = await store.saveAsNewVersion("p1");
    expect(ok).toBe(true);
    expect(nodeGraphApi.create).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ graphId: "" }),
      "默认楼层模板",
    );
    expect(store.graphId).toBe("g_fork");
    expect(store.isTemplate).toBe(false);
    expect(store.templateKind).toBeNull();
    expect(store.isSample).toBe(false);
    expect(store.dirty).toBe(false);
  });

  it("clears the template flag when switching to the sample graph", () => {
    const store = useGraphEditorStore();
    store.loadTemplate();
    expect(store.isTemplate).toBe(true);
    expect(store.templateKind).toBe("native");
    store.loadSample();
    expect(store.isTemplate).toBe(false);
    expect(store.templateKind).toBeNull();
    expect(store.isSample).toBe(true);
  });

  it("loads the compat default template (CG11-2): zero-agentic, forkable", () => {
    const store = useGraphEditorStore();
    store.loadTemplate("compat", "compat 默认模板");
    expect(store.templateKind).toBe("compat");
    expect(store.isTemplate).toBe(true);
    expect(store.isSample).toBe(false);
    expect(store.graphId).toBeNull();
    expect(store.graphName).toBe("compat 默认模板");
    expect(store.document?.metadata?.template).toBe("compat_prompt_floor");
    // compat 模板零 Agentic：无 agent.* / verify.* 决策节点。
    expect(store.document?.nodes.some((n) => n.type.startsWith("agent."))).toBe(false);
    expect(store.document?.nodes.some((n) => n.type.startsWith("verify."))).toBe(false);
    expect(store.isExecutable).toBe(true);
    expect(store.dirty).toBe(true);
    expect(store.canSaveVersion).toBe(true);
  });
});

describe("graph-editor store: insert built-in advisor subgraph (SG11-2)", () => {
  it("forks a built-in advisor subgraph into the project and places a group.node", async () => {
    vi.mocked(nodeGraphApi.create).mockResolvedValue({
      definition: defResponse({ id: "sub_director", current_version_id: "v1" }),
      version: verResponse({ id: "v1", graph_id: "sub_director" }),
      validation: { diagnostics: [], isValid: true },
    });

    const store = useGraphEditorStore();
    store.loadSample();
    const before = store.nodeCount;
    const director = buildDirectorAdvisorSubgraph();

    const ok = await store.insertBuiltinAdvisorSubgraph("p1", director);
    expect(ok).toBe(true);
    // 子图被 fork 进项目（metadata.subgraph）。
    expect(nodeGraphApi.create).toHaveBeenCalledTimes(1);
    const createdDoc = vi.mocked(nodeGraphApi.create).mock.calls[0]?.[1] as { metadata?: { subgraph?: boolean }; graphId?: string };
    expect(createdDoc.metadata?.subgraph).toBe(true);
    expect(createdDoc.graphId).toBe("");

    // 父图新增一个 group.node，ref 指向新建子图 + 接口缓存来自 deriveSubgraphInterface。
    expect(store.nodeCount).toBe(before + 1);
    const groupNode = store.document?.nodes.find((node) => node.type === "group.node");
    expect(groupNode).toBeDefined();
    const config = groupNode?.config as { ref: { graphId: string; versionId?: string }; interface: { inputs: unknown[]; outputs: unknown[] } };
    expect(config.ref).toEqual({ graphId: "sub_director", versionId: "v1" });
    expect(config.interface).toEqual(deriveSubgraphInterface(director));
    expect(store.dirty).toBe(true);
    expect(store.selectedNodeId).toBe(groupNode?.id);
  });

  it("no-ops without a loaded document", async () => {
    const store = useGraphEditorStore();
    const ok = await store.insertBuiltinAdvisorSubgraph("p1", buildDirectorAdvisorSubgraph());
    expect(ok).toBe(false);
    expect(nodeGraphApi.create).not.toHaveBeenCalled();
  });

  it("surfaces a backend error and keeps the document", async () => {
    vi.mocked(nodeGraphApi.create).mockRejectedValue(new NodeGraphApiError(400, { message: "invalid" }));
    const store = useGraphEditorStore();
    store.loadSample();
    const ok = await store.insertBuiltinAdvisorSubgraph("p1", buildMemoryRetrieveSubgraph());
    expect(ok).toBe(false);
    expect(store.error).toBe("invalid");
    expect(store.document).not.toBeNull();
  });
});

describe("graph-editor store: import overwrite + delete", () => {
  it("importPreset with target binds the draft to an existing graph for createVersion", () => {
    const store = useGraphEditorStore();
    store.importPreset(validDocument(), "G", { graphId: "gX", baseVersionId: "vX" });
    expect(store.graphId).toBe("gX");
    expect(store.baseVersionId).toBe("vX");
    expect(store.isSample).toBe(false);
    expect(store.dirty).toBe(true);
  });

  it("deleteGraph removes the definition and returns to the sample graph", async () => {
    const store = useGraphEditorStore();
    store.importPreset(validDocument(), "G", { graphId: "g9", baseVersionId: "v9" });
    expect(store.graphId).toBe("g9");
    vi.mocked(nodeGraphApi.remove).mockResolvedValue(undefined);
    const ok = await store.deleteGraph("p1");
    expect(ok).toBe(true);
    expect(nodeGraphApi.remove).toHaveBeenCalledWith("p1", "g9");
    expect(store.isSample).toBe(true);
    expect(store.graphId).toBeNull();
  });

  it("deleteGraph no-ops for the sample / unsaved graph", async () => {
    const store = useGraphEditorStore();
    store.loadSample();
    const ok = await store.deleteGraph("p1");
    expect(ok).toBe(false);
    expect(nodeGraphApi.remove).not.toHaveBeenCalled();
  });

  it("deleteGraph surfaces a backend error and keeps the graph loaded", async () => {
    const store = useGraphEditorStore();
    store.importPreset(validDocument(), "G", { graphId: "g9", baseVersionId: "v9" });
    vi.mocked(nodeGraphApi.remove).mockRejectedValue(
      new NodeGraphApiError(409, { message: "has runs" }),
    );
    const ok = await store.deleteGraph("p1");
    expect(ok).toBe(false);
    expect(store.error).toBe("has runs");
    expect(store.graphId).toBe("g9");
  });
});


describe("graph-editor store: extract to node group", () => {
  it("persists a subgraph and replaces the group with a group.node", async () => {
    vi.mocked(nodeGraphApi.create).mockResolvedValue({
      definition: defResponse({ id: "sub-1", current_version_id: "v1" }),
      version: verResponse({ id: "v1", graph_id: "sub-1" }),
      validation: { diagnostics: [], isValid: true },
    });

    const store = useGraphEditorStore();
    store.loadSample();
    const before = store.nodeCount;

    const ok = await store.extractGroupToNodeGroup("p1", "g_post");
    expect(ok).toBe(true);
    expect(nodeGraphApi.create).toHaveBeenCalledTimes(1);

    // 子图文档以 metadata.subgraph 标记持久化。
    const createdDoc = vi.mocked(nodeGraphApi.create).mock.calls[0]?.[1] as { metadata?: { subgraph?: boolean } };
    expect(createdDoc.metadata?.subgraph).toBe(true);

    // 父图：移除 2 个成员 + 新增 1 个 group.node → 净 -1。
    expect(store.nodeCount).toBe(before - 1);
    const gn = store.document?.nodes.find((node) => node.type === "group.node");
    expect(gn).toBeDefined();
    expect((gn?.config as { ref: { graphId: string; versionId?: string } }).ref).toEqual({
      graphId: "sub-1",
      versionId: "v1",
    });

    // 被抽取的组移除；父图仍可执行；标记 dirty。
    expect(store.document?.groups?.some((group) => group.id === "g_post")).toBe(false);
    expect(store.isExecutable).toBe(true);
    expect(store.dirty).toBe(true);
    expect(store.selectedNodeId).toBe(gn?.id);
  });

  it("fails fast (no API call) when the group is unknown", async () => {
    const store = useGraphEditorStore();
    store.loadSample();
    const ok = await store.extractGroupToNodeGroup("p1", "nope");
    expect(ok).toBe(false);
    expect(store.error).toBe("extract_failed:group_not_found");
    expect(nodeGraphApi.create).not.toHaveBeenCalled();
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

  it("adds edges, ignores duplicates, and infers control edge kind", () => {
    const store = useGraphEditorStore();
    store.loadSample();
    const before = store.edgeCount;
    // e_user_wb 已存在（n_user.text → n_wb.query）。
    expect(store.addEdge({ nodeId: "n_user", port: "text" }, { nodeId: "n_wb", port: "query" })).toBeNull();
    expect(store.edgeCount).toBe(before);
    const created = store.addEdge({ nodeId: "n_user", port: "text" }, { nodeId: "n_compose", port: "messages" });
    expect(created?.kind).toBeUndefined();
    expect(store.edgeCount).toBe(before + 1);

    const control = store.addEdge({ nodeId: "n_gate", port: "open" }, { nodeId: "n_director", port: "input" });
    expect(control).toMatchObject({ kind: "control" });
    expect(store.selectedEdgeId).toBe(control?.id);
  });

  it("upgrades v1 documents when adding control nodes or control edges", () => {
    const store = useGraphEditorStore();
    store.importPreset({ ...validDocument(), schemaVersion: 1 }, "V1");
    const node = store.addNode("control.gate");
    expect(node?.config).toEqual({
      condition: { op: "exists", value: { source: "runtime", path: ["intent"] } },
      onSkip: "empty_output",
    });
    expect(store.document?.schemaVersion).toBe(2);
    expect(store.error).toBe("schema_upgraded_to_v2");

    store.importPreset({
      ...validDocument(),
      schemaVersion: 1,
      nodes: [
        { id: "gate", type: "control.gate", typeVersion: "1", phase: "pre_response", config: { condition: { op: "exists", value: { source: "runtime", path: ["intent"] } } } },
        { id: "target", type: "source.user_input", typeVersion: "1", phase: "pre_response" },
      ],
      edges: [],
    }, "V1 control edge");
    const edge = store.addEdge({ nodeId: "gate", port: "open" }, { nodeId: "target", port: "text" });
    expect(edge?.kind).toBe("control");
    expect(store.document?.schemaVersion).toBe(2);
    expect(store.error).toBe("schema_upgraded_to_v2");
  });

  it("updates node config, edge kind, and removes edges by id", () => {
    const store = useGraphEditorStore();
    store.loadSample();
    store.updateNodeConfig("n_cond", { condition: { all: [] } });
    expect(store.document?.nodes.find((n) => n.id === "n_cond")?.config).toEqual({ condition: { all: [] } });

    store.updateEdgeKind("e_user_wb", "control");
    expect(store.document?.edges.find((edge) => edge.id === "e_user_wb")?.kind).toBe("control");
    store.updateEdgeKind("e_user_wb", "data");
    expect(store.document?.edges.find((edge) => edge.id === "e_user_wb")?.kind).toBe("data");

    store.removeEdge("e_user_wb");
    expect(store.document?.edges.some((e) => e.id === "e_user_wb")).toBe(false);
  });

  it("adds annotation comments with editor-only config", () => {
    const store = useGraphEditorStore();
    store.loadSample();
    const node = store.addNode("annotation.comment");
    expect(node).toMatchObject({
      type: "annotation.comment",
      config: { content: "" },
    });
    expect(store.isExecutable).toBe(true);
  });

  it("toggles a group switch, syncing member node.enabled in both directions", () => {
    const store = useGraphEditorStore();
    store.loadSample();
    const group = store.document?.groups?.[0];
    expect(group).toBeDefined();
    const memberIds = group!.nodeIds;
    const members = () => store.document!.nodes.filter((n) => memberIds.includes(n.id));

    // 关：组 enabled=false，所有成员置 enabled:false。
    store.setGroupEnabled(group!.id, false);
    expect(store.document?.groups?.find((g) => g.id === group!.id)?.enabled).toBe(false);
    expect(members().every((n) => n.enabled === false)).toBe(true);
    expect(store.dirty).toBe(true);

    // 开：组 enabled=true，所有成员清除禁用。
    store.setGroupEnabled(group!.id, true);
    expect(store.document?.groups?.find((g) => g.id === group!.id)?.enabled).toBe(true);
    expect(members().every((n) => n.enabled !== false)).toBe(true);
  });

  it("ignores group switch for an unknown group id", () => {
    const store = useGraphEditorStore();
    store.loadSample();
    store.setGroupEnabled("does_not_exist", false);
    expect(store.dirty).toBe(false);
  });

  it("collapses and expands a group (Blender-style single node ↔ region)", () => {
    const store = useGraphEditorStore();
    store.loadSample();
    const group = store.document?.groups?.[0];
    expect(group).toBeDefined();

    store.setGroupCollapsed(group!.id, true);
    expect(store.document?.groups?.find((g) => g.id === group!.id)?.collapsed).toBe(true);
    expect(store.dirty).toBe(true);

    store.setGroupCollapsed(group!.id, false);
    expect(store.document?.groups?.find((g) => g.id === group!.id)?.collapsed).toBe(false);
  });

  it("ignores collapse for an unknown group id", () => {
    const store = useGraphEditorStore();
    store.loadSample();
    store.setGroupCollapsed("does_not_exist", true);
    expect(store.dirty).toBe(false);
  });
  it("selects a group and clears node/edge selection", () => {
    const store = useGraphEditorStore();
    store.loadSample();
    const group = store.document?.groups?.[0];
    expect(group).toBeDefined();

    store.selectNode(store.document!.nodes[0]!.id);
    store.selectGroup(group!.id);
    expect(store.selectedGroupId).toBe(group!.id);
    expect(store.selectedGroup?.id).toBe(group!.id);
    expect(store.selectedNodeId).toBeNull();
    expect(store.selectedEdgeId).toBeNull();

    // 选节点反过来清除组选中。
    store.selectNode(store.document!.nodes[0]!.id);
    expect(store.selectedGroupId).toBeNull();
  });

  it("toggles an output channel via group.disabledChannels", () => {
    const store = useGraphEditorStore();
    store.loadSample();
    const group = store.document?.groups?.[0];
    expect(group).toBeDefined();
    const channelId = "out:n_x:y";

    // 关闭：加入 disabledChannels。
    store.setGroupChannelEnabled(group!.id, channelId, false);
    expect(store.document?.groups?.find((g) => g.id === group!.id)?.disabledChannels).toEqual([channelId]);
    expect(store.dirty).toBe(true);

    // 开启：移出后集合为空 → 字段被删除。
    store.setGroupChannelEnabled(group!.id, channelId, true);
    expect(store.document?.groups?.find((g) => g.id === group!.id)?.disabledChannels).toBeUndefined();
  });

  it("moves a collapsed group by shifting all members, preserving internal layout", () => {
    const store = useGraphEditorStore();
    store.loadSample();
    const doc = store.document!;
    const group = doc.groups![0]!;
    // 为成员赋予初始坐标（保证最小角可计算）。
    group.nodeIds.forEach((nodeId, index) => {
      const node = doc.nodes.find((n) => n.id === nodeId)!;
      node.ui = { position: { x: 100 + index * 50, y: 200 + index * 30 } };
    });
    const before = group.nodeIds.map((id) => ({
      id,
      pos: { ...doc.nodes.find((n) => n.id === id)!.ui!.position! },
    }));

    store.moveCollapsedGroup(group.id, { x: 400, y: 500 });

    const minX = Math.min(...before.map((m) => m.pos.x));
    const minY = Math.min(...before.map((m) => m.pos.y));
    const dx = 400 - minX;
    const dy = 500 - minY;
    for (const member of before) {
      const after = store.document!.nodes.find((n) => n.id === member.id)!.ui!.position!;
      expect(after).toEqual({ x: member.pos.x + dx, y: member.pos.y + dy });
    }
    expect(store.dirty).toBe(true);
  });
  it("moves a collapsed group whose members lack coordinates without overlapping them", () => {
    const store = useGraphEditorStore();
    store.loadSample();
    const doc = store.document!;
    const group = doc.groups![0]!;
    // 成员均无坐标（模拟导入未布局的图）。
    group.nodeIds.forEach((nodeId) => {
      const node = doc.nodes.find((n) => n.id === nodeId)!;
      delete node.ui;
    });

    store.moveCollapsedGroup(group.id, { x: 400, y: 500 });

    const positions = group.nodeIds.map(
      (id) => store.document!.nodes.find((n) => n.id === id)!.ui!.position!,
    );
    // 所有成员都被赋予坐标，且互不重叠。
    expect(positions.every((p) => p !== undefined)).toBe(true);
    const keys = new Set(positions.map((p) => `${p.x}:${p.y}`));
    expect(keys.size).toBe(group.nodeIds.length);
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

  it("runs manual server validation and keeps the local draft", async () => {
    const serverDiagnostic = {
      severity: "warning" as const,
      code: "server_warning",
      message: "server warning",
      nodeId: "n1",
    };
    vi.mocked(nodeGraphApi.validate).mockResolvedValue({
      isExecutable: true,
      diagnostics: [serverDiagnostic],
      topologicalLevels: [["n1"]],
    });

    const store = useGraphEditorStore();
    store.importPreset(validDocument(), "G", { graphId: "g1", baseVersionId: "v1" });
    const before = store.document;

    const ok = await store.validateOnServer("p1");

    expect(ok).toBe(true);
    expect(nodeGraphApi.validate).toHaveBeenCalledWith("p1", "g1", before);
    expect(store.serverDiagnostics).toEqual([{ ...serverDiagnostic, source: "server" }]);
    expect(store.diagnostics.some((diagnostic) => diagnostic.source === "server")).toBe(true);
    expect(store.document).toBe(before);
  });

  it("clears stale server diagnostics after editing", async () => {
    vi.mocked(nodeGraphApi.validate).mockResolvedValue({
      isExecutable: true,
      diagnostics: [{ severity: "info", code: "server_info", message: "server" }],
    });
    const store = useGraphEditorStore();
    store.importPreset(validDocument(), "G", { graphId: "g1", baseVersionId: "v1" });
    await store.validateOnServer("p1");
    expect(store.serverDiagnostics).toHaveLength(1);

    store.renameGraph("G edited");

    expect(store.serverDiagnostics).toEqual([]);
    expect(store.serverValidationCheckedAt).toBeNull();
  });

  it("surfaces server validation API errors and keeps the draft", async () => {
    vi.mocked(nodeGraphApi.validate).mockRejectedValue(new NodeGraphApiError(422, { message: "too large" }));
    const store = useGraphEditorStore();
    store.importPreset(validDocument(), "G", { graphId: "g1", baseVersionId: "v1" });
    const before = store.document;

    const ok = await store.validateOnServer("p1");

    expect(ok).toBe(false);
    expect(store.error).toBe("too large");
    expect(store.document).toBe(before);
  });

  it("loads, sets and clears floor graph bindings", async () => {
    vi.mocked(nodeGraphApi.listFloorGraphBindings).mockResolvedValue({
      items: [
        {
          id: "fgb1",
          account_id: "a1",
          workspace_id: "w1",
          project_id: "p1",
          kind: "native",
          graph_id: "g1",
          graph_version_id: "v1",
          graph_name: "G1",
          graph_version_no: 1,
          status: "active",
          created_at: 0,
          updated_at: 0,
        },
      ],
    });
    vi.mocked(nodeGraphApi.setFloorGraphBinding).mockResolvedValue({
      item: {
        id: "fgb2",
        account_id: "a1",
        workspace_id: "w1",
        project_id: "p1",
        kind: "compat",
        graph_id: "g1",
        graph_version_id: "v1",
        graph_name: "G1",
        graph_version_no: 1,
        status: "active",
        created_at: 0,
        updated_at: 1,
      },
    });
    vi.mocked(nodeGraphApi.clearFloorGraphBinding).mockResolvedValue({ cleared: true, previous: null });

    const store = useGraphEditorStore();
    store.graphId = "g1";
    store.baseVersionId = "v1";
    store.isSample = false;

    await store.loadFloorGraphBindings("p1");
    expect(store.floorGraphBindings).toHaveLength(1);
    expect(store.isCurrentVersionBoundAs("native")).toBe(true);
    expect(store.isCurrentGraphBoundAs("native")).toBe(true);
    expect(store.hasCurrentGraphFloorBindingVersionMismatch("native")).toBe(false);

    const setOk = await store.setCurrentGraphAsFloorBinding("p1", "compat");
    expect(setOk).toBe(true);
    expect(nodeGraphApi.setFloorGraphBinding).toHaveBeenCalledWith("p1", "compat", {
      graph_id: "g1",
      graph_version_id: "v1",
    });
    expect(store.isCurrentVersionBoundAs("compat")).toBe(true);

    const clearOk = await store.clearFloorGraphBinding("p1", "native");
    expect(clearOk).toBe(true);
    expect(store.getFloorGraphBinding("native")).toBeNull();
  });

  it("does not bind an unsaved graph", async () => {
    const store = useGraphEditorStore();
    store.loadSample();
    const ok = await store.setCurrentGraphAsFloorBinding("p1", "native");
    expect(ok).toBe(false);
    expect(nodeGraphApi.setFloorGraphBinding).not.toHaveBeenCalled();
  });

  it("does not bind an unsaved compat preset import", async () => {
    const store = useGraphEditorStore();
    store.importPreset(importedPresetDocument("compat_floor_graph"), "Compat Import");
    expect(store.isCompatFloorImportDraft).toBe(true);
    expect(store.canBindCurrentVersionAsFloorGraph).toBe(false);

    const ok = await store.setCurrentGraphAsFloorBinding("p1", "compat");
    expect(ok).toBe(false);
    expect(nodeGraphApi.setFloorGraphBinding).not.toHaveBeenCalled();
  });

  it("saves a compat preset import without auto-binding, then binds only on explicit action", async () => {
    const draft = importedPresetDocument("compat_floor_graph");
    const savedDocument = { ...draft, graphId: "g_compat" };
    vi.mocked(nodeGraphApi.create).mockResolvedValue({
      definition: defResponse({ id: "g_compat", name: "Compat Import", current_version_id: "v1" }),
      version: verResponse({ id: "v1", graph_id: "g_compat", document: savedDocument }),
      validation: { diagnostics: [], isValid: true },
    });
    vi.mocked(nodeGraphApi.listVersions).mockResolvedValue({
      items: [verResponse({ graph_id: "g_compat", document: savedDocument })],
    });
    vi.mocked(nodeGraphApi.setFloorGraphBinding).mockResolvedValue({
      item: floorBindingResponse({
        kind: "compat",
        graph_id: "g_compat",
        graph_version_id: "v1",
        graph_name: "Compat Import",
      }),
    });

    const store = useGraphEditorStore();
    store.importPreset(draft, "Compat Import");
    expect(store.isCompatFloorImportDraft).toBe(true);
    expect(store.canBindCurrentVersionAsFloorGraph).toBe(false);

    const saveOk = await store.saveAsNewVersion("p1");
    expect(saveOk).toBe(true);
    expect(store.graphId).toBe("g_compat");
    expect(store.baseVersionId).toBe("v1");
    expect(store.isCompatFloorImportDraft).toBe(true);
    expect(store.getFloorGraphBinding("compat")).toBeNull();
    expect(nodeGraphApi.setFloorGraphBinding).not.toHaveBeenCalled();

    const bindOk = await store.setCurrentGraphAsFloorBinding("p1", "compat");
    expect(bindOk).toBe(true);
    expect(nodeGraphApi.setFloorGraphBinding).toHaveBeenCalledWith("p1", "compat", {
      graph_id: "g_compat",
      graph_version_id: "v1",
    });
    expect(store.isCurrentVersionBoundAs("compat")).toBe(true);
  });

  it("saving a new version of a compat import does not update the compat binding", async () => {
    const draft = importedPresetDocument("compat_floor_graph");
    const savedV2 = { ...draft, graphId: "g_compat", name: "Compat Import edited" };
    vi.mocked(nodeGraphApi.createVersion).mockResolvedValue({
      definition: defResponse({ id: "g_compat", name: "Compat Import edited", current_version_id: "v2" }),
      version: verResponse({
        id: "v2",
        graph_id: "g_compat",
        version_no: 2,
        parent_version_id: "v1",
        document: savedV2,
      }),
      validation: { diagnostics: [], isValid: true },
    });
    vi.mocked(nodeGraphApi.listVersions).mockResolvedValue({
      items: [
        verResponse({ id: "v1", graph_id: "g_compat", document: draft }),
        verResponse({ id: "v2", graph_id: "g_compat", version_no: 2, document: savedV2 }),
      ],
    });

    const store = useGraphEditorStore();
    store.importPreset(draft, "Compat Import", { graphId: "g_compat", baseVersionId: "v1" });
    store.floorGraphBindings = [
      floorBindingResponse({
        kind: "compat",
        graph_id: "g_compat",
        graph_version_id: "v1",
        graph_name: "Compat Import",
      }),
    ];
    expect(store.isCurrentVersionBoundAs("compat")).toBe(true);

    store.renameGraph("Compat Import edited");
    const ok = await store.saveAsNewVersion("p1");
    expect(ok).toBe(true);
    expect(store.baseVersionId).toBe("v2");
    expect(store.getFloorGraphBinding("compat")?.graph_version_id).toBe("v1");
    expect(store.hasCurrentGraphFloorBindingVersionMismatch("compat")).toBe(true);
    expect(nodeGraphApi.setFloorGraphBinding).not.toHaveBeenCalled();
  });

  it("detects when the current saved version differs from the bound version", async () => {
    vi.mocked(nodeGraphApi.listFloorGraphBindings).mockResolvedValue({
      items: [
        {
          id: "fgb1",
          account_id: "a1",
          workspace_id: "w1",
          project_id: "p1",
          kind: "native",
          graph_id: "g1",
          graph_version_id: "v1",
          graph_name: "G1",
          graph_version_no: 1,
          status: "active",
          created_at: 0,
          updated_at: 0,
        },
      ],
    });
    const store = useGraphEditorStore();
    store.graphId = "g1";
    store.baseVersionId = "v2";
    store.isSample = false;

    await store.loadFloorGraphBindings("p1");
    expect(store.isCurrentGraphBoundAs("native")).toBe(true);
    expect(store.isCurrentVersionBoundAs("native")).toBe(false);
    expect(store.hasCurrentGraphFloorBindingVersionMismatch("native")).toBe(true);
  });

  it("saving a new version does not update an existing floor graph binding", async () => {
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
    vi.mocked(nodeGraphApi.listFloorGraphBindings).mockResolvedValue({
      items: [
        {
          id: "fgb1",
          account_id: "a1",
          workspace_id: "w1",
          project_id: "p1",
          kind: "native",
          graph_id: "g1",
          graph_version_id: "v1",
          graph_name: "G1",
          graph_version_no: 1,
          status: "active",
          created_at: 0,
          updated_at: 0,
        },
      ],
    });

    const store = useGraphEditorStore();
    await store.loadGraph("p1", "g1");
    await store.loadFloorGraphBindings("p1");
    expect(store.isCurrentVersionBoundAs("native")).toBe(true);

    store.renameGraph("G1 edited");
    const ok = await store.saveAsNewVersion("p1");

    expect(ok).toBe(true);
    expect(store.baseVersionId).toBe("v2");
    expect(store.getFloorGraphBinding("native")?.graph_version_id).toBe("v1");
    expect(store.hasCurrentGraphFloorBindingVersionMismatch("native")).toBe(true);
    expect(nodeGraphApi.setFloorGraphBinding).not.toHaveBeenCalled();
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
    const edge = store.addEdge({ nodeId: "n_gate", port: "open" }, { nodeId: "n_compose", port: "messages" }, "control");
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


describe("NG2-6 undo/redo", () => {
  it("每次原子操作可撤销并恢复文档", () => {
    const store = useGraphEditorStore();
    store.loadSample();
    const before = store.nodeCount;

    store.addNode("source.user_input", "1");
    expect(store.nodeCount).toBe(before + 1);
    expect(store.canUndo).toBe(true);

    store.undo();
    expect(store.nodeCount).toBe(before);
    expect(store.canRedo).toBe(true);
  });

  it("redo 恢复被撤销的操作", () => {
    const store = useGraphEditorStore();
    store.loadSample();
    const before = store.nodeCount;

    store.addNode("source.user_input", "1");
    store.undo();
    store.redo();
    expect(store.nodeCount).toBe(before + 1);
  });

  it("新的写操作清空redo 栈", () => {
    const store = useGraphEditorStore();
    store.loadSample();

    store.addNode("source.user_input", "1");
    store.undo();
    expect(store.canRedo).toBe(true);

    store.addNode("source.user_input", "1");
    expect(store.canRedo).toBe(false);
  });

  it("撤销栈超过上限后从栈底截断", () => {
    const store = useGraphEditorStore();
    store.loadSample();
    // 连续 120 次写操作，超过 100 上限。
    for (let i = 0; i < 120; i += 1) {
      store.addNode("source.user_input", "1");
    }
    // 上限 100：最多只能撤销 100 步。
    let undoCount = 0;
    while (store.canUndo) {
      store.undo();
      undoCount += 1;
    }
    expect(undoCount).toBe(100);
  });

  it("加载新图重置撤销重做栈", () => {
    const store = useGraphEditorStore();
    store.loadSample();
    store.addNode("source.user_input", "1");
    expect(store.canUndo).toBe(true);

    store.loadSample();
    expect(store.canUndo).toBe(false);
    expect(store.canRedo).toBe(false);
  });
});

describe("NG2-6 复制粘贴 / 批量删除 / 成组", () => {
  it("复制节点重映射 id 并复制内部边", () => {
    const store = useGraphEditorStore();
    store.loadSample();
    const doc = store.document!;
    // 取前两个节点及其之间的一条边（若无则手动建一条）。
    const [n1, n2] = doc.nodes;
    if (n1 && n2) {
      store.addEdge({nodeId: n1.id, port: "any" }, { nodeId: n2.id, port: "any" });
    }
    const beforeNodes = store.nodeCount;
    const ids = store.duplicateNodes(doc.nodes.slice(0, 2).map((node) => node.id));
    expect(ids.length).toBe(2);
    // 新 id 不与原 id 冲突。
    for (const id of ids) {
      expect(doc.nodes.slice(0, 2).map((node) => node.id)).not.toContain(id);
    }
    expect(store.nodeCount).toBe(beforeNodes + 2);
  });

  it("批量删除节点及其关联边（一次原子操作）", () => {
    const store = useGraphEditorStore();
    store.loadSample();
    const doc = store.document!;
    const targets = doc.nodes.slice(0, 2).map((node) => node.id);
    const beforeNodes = store.nodeCount;

    store.removeNodes(targets);
    expect(store.nodeCount).toBe(beforeNodes - targets.length);
    // 一次原子操作：单次 undo 即可恢复。
    store.undo();
    expect(store.nodeCount).toBe(beforeNodes);
  });

  it("成组把选中节点写入一个 visual 分组", () => {
    const store = useGraphEditorStore();
    store.loadSample();
    const doc = store.document!;
    const targets = doc.nodes.slice(0, 2).map((node) => node.id);

    const groupId = store.groupNodes(targets, "我的组");
    expect(groupId).not.toBeNull();
    const group = store.document?.groups?.find((candidate) => candidate.id === groupId);
    expect(group?.kind).toBe("visual");
    expect(group?.nodeIds.sort()).toEqual([...targets].sort());
  });

  it("成组不足两个有效节点时返回 null", () => {
    const store = useGraphEditorStore();
    store.loadSample();
    const doc = store.document!;
    expect(store.groupNodes([doc.nodes[0]!.id])).toBeNull();
  });
});
