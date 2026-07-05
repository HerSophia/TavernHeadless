import type { NodeGraphDocument } from "@tavern/core/node-graph";
import type { EdgeMarker } from "@vue-flow/core";
import { describe, expect, it } from "vitest";

import {
  COLLAPSED_NODE_ID_PREFIX,
  GROUP_COLLAPSED_NODE_TYPE,
  GROUP_NODE_TYPE,
  NODE_WIDTH,
  TAVERN_NODE_TYPE,
  mapDocumentToFlow,
  summarizeNodeConfig,
  summarizeNodePreview,
  type GraphCollapsedGroupNodeData,
  type GraphFlowNode,
  type GraphGroupNodeData,
  type GraphTavernNodeData,
} from "./map-document";
import { SAMPLE_NODE_GRAPH_DOCUMENT } from "./sample-document";

function tavernData(nodes: GraphFlowNode[], id: string): GraphTavernNodeData {
  const node = nodes.find((candidate) => candidate.id === id);
  expect(node, `node ${id} should exist`).toBeDefined();
  expect(node?.type).toBe(TAVERN_NODE_TYPE);
  const data = node!.data as GraphTavernNodeData;
  expect(data.kind).toBe("node");
  return data;
}

describe("mapDocumentToFlow", () => {
  it("maps a v2 document with groups and control edges", () => {
    const { nodes, edges } = mapDocumentToFlow(SAMPLE_NODE_GRAPH_DOCUMENT);

    // 23 个文档节点 + 3 个分组容器
    expect(nodes).toHaveLength(26);
    expect(nodes.filter((node) => node.type === TAVERN_NODE_TYPE)).toHaveLength(23);
    expect(nodes.filter((node) => node.type === GROUP_NODE_TYPE)).toHaveLength(3);
    // 分组容器排在最前（绘制于成员之后）
    expect(nodes[0]?.type).toBe(GROUP_NODE_TYPE);

    expect(edges).toHaveLength(SAMPLE_NODE_GRAPH_DOCUMENT.edges.length);

    for (const node of nodes.filter((candidate) => candidate.type === TAVERN_NODE_TYPE)) {
      expect(node.style).toMatchObject({ width: `${NODE_WIDTH}px` });
      expect(node.position).toEqual({
        x: expect.any(Number),
        y: expect.any(Number),
      });
    }
  });

  it("prefers an explicit node name over the registry title", () => {
    const document: NodeGraphDocument = {
      schemaVersion: 2,
      graphId: "named",
      name: "named",
      mode: "native_graph",
      nodes: [
        // source.user_input 注册表标题为 "User Input"，但带 name 时应显示 name（slot 名）。
        { id: "n1", type: "source.user_input", typeVersion: "1", phase: "pre_response", name: "Main Prompt" },
        // 无 name → 回退注册表标题。
        { id: "n2", type: "source.user_input", typeVersion: "1", phase: "pre_response" },
      ],
      edges: [],
      policies: {},
    };

    const { nodes } = mapDocumentToFlow(document);
    expect(tavernData(nodes, "n1").title).toBe("Main Prompt");
    expect(tavernData(nodes, "n2").title).toBe("User Input");
  });

  it("encodes registry metadata onto node data", () => {
    const { nodes } = mapDocumentToFlow(SAMPLE_NODE_GRAPH_DOCUMENT);

    const user = tavernData(nodes, "n_user");
    expect(user.title).toBe("User Input");
    expect(user.sideEffects).toBe("none");
    expect(user.inputPorts).toHaveLength(0);
    expect(user.outputPorts.map((port) => port.name)).toContain("text");
    expect(user.unknownType).toBe(false);

    const narrator = tavernData(nodes, "n_narrator");
    expect(narrator.sideEffects).toBe("llm");

    const lore = tavernData(nodes, "n_lore");
    expect(lore.permissionsRequired).toEqual(["project.agent.run"]);
    expect(lore.configSummary).toEqual([
      { label: "medium", labelKey: "graphNode.summary.label.medium", value: "single_call" },
      { label: "output", labelKey: "graphNode.summary.label.output", value: "return_inline" },
      {
        label: "execution",
        labelKey: "graphNode.summary.label.execution",
        value: "inherit",
        valueKey: "graphNode.summary.value.execution.inherit",
        tone: "neutral",
      },
    ]);
 expect(lore.inlineConfigControls.map((control) => control.path)).toEqual([
      "medium.kind",
      "medium.deliveryTarget",
      "triggerReason",
      "execution.modelSource",
      "execution.modelId",
      "execution.generation.temperature",
      "execution.generation.topP",
      "execution.generation.maxOutputTokens",
      "execution.generation.maxContextTokens",
    ]);
    expect(lore.previewSummary).toEqual({ status: "available", policy: "cached_only" });

    const derived = tavernData(nodes, "n_derived");
    expect(derived.sideEffects).toBe("write");
  });

  it("distinguishes data and control edges and wires handles", () => {
    const { edges } = mapDocumentToFlow(SAMPLE_NODE_GRAPH_DOCUMENT);

    const controlEdges = edges.filter((edge) => edge.data?.kind === "control");
    expect(controlEdges.map((edge) => edge.id).sort()).toEqual([
      "c_gate_lore",
    ]);
    for (const edge of controlEdges) {
      expect((edge.style as Record<string, unknown>).strokeDasharray).toBeDefined();
    }

    const dataEdge = edges.find((edge) => edge.id === "e_user_wb");
    expect(dataEdge?.data?.kind).toBe("data");
    expect(dataEdge?.source).toBe("n_user");
    expect(dataEdge?.target).toBe("n_wb");
    expect(dataEdge?.sourceHandle).toBe("text");
    expect(dataEdge?.targetHandle).toBe("query");
    expect((dataEdge?.markerEnd as EdgeMarker).type).toBe("arrowclosed");
  });

  it("NG2-6：选中边输出选中态与高亮描边", () => {
    const { edges } = mapDocumentToFlow(SAMPLE_NODE_GRAPH_DOCUMENT, { selectedEdgeId: "e_user_wb" });
    const selected = edges.find((edge) => edge.id === "e_user_wb");
    expect(selected?.selected).toBe(true);
    expect(selected?.class).toContain("graph-edge--selected");
    // 选中描边加粗（>= 2.5）。
    expect(Number((selected?.style as Record<string, unknown>).strokeWidth)).toBeGreaterThanOrEqual(2.5);

    const other = edges.find((edge) => edge.id !== "e_user_wb");
    expect(other?.selected).toBe(false);
  });


  it("applies deterministic placeholder positions when coordinates are missing", () => {
    const first = mapDocumentToFlow(SAMPLE_NODE_GRAPH_DOCUMENT);
    const second = mapDocumentToFlow(SAMPLE_NODE_GRAPH_DOCUMENT);

    for (const node of first.nodes) {
      const other = second.nodes.find((candidate) => candidate.id === node.id);
      expect(other?.position).toEqual(node.position);
    }

    // 示例文档不带坐标 → 全部为占位布局
    for (const node of first.nodes.filter((candidate) => candidate.type === TAVERN_NODE_TYPE)) {
      expect((node.data as GraphTavernNodeData).hasPosition).toBe(false);
    }

    // 不同 phase 应落在不同列（x 不同）
    const userX = tavernData(first.nodes, "n_user").node.ui?.position?.x;
    expect(userX).toBeUndefined();
    const userNode = first.nodes.find((node) => node.id === "n_user");
    const responseNode = first.nodes.find((node) => node.id === "n_compose");
    expect(userNode?.position.x).not.toBe(responseNode?.position.x);
  });

  it("respects explicit ui.position and flags hasPosition", () => {
    const document: NodeGraphDocument = {
      schemaVersion: 2,
      graphId: "explicit",
      name: "explicit",
      mode: "native_graph",
      nodes: [
        {
          id: "n1",
          type: "source.user_input",
          typeVersion: "1",
          phase: "pre_response",
          ui: { position: { x: 123, y: 456 } },
        },
      ],
      edges: [],
      policies: {},
    };

    const { nodes } = mapDocumentToFlow(document);
    const data = tavernData(nodes, "n1");
    expect(data.hasPosition).toBe(true);
    expect(nodes.find((node) => node.id === "n1")?.position).toEqual({ x: 123, y: 456 });
  });

  it("overlays run status and preview summary by node id", () => {
    const { nodes } = mapDocumentToFlow(SAMPLE_NODE_GRAPH_DOCUMENT, {
      runStatusByNodeId: {
        n_narrator: "running",
        n_commit: "succeeded",
        n_lore: "failed",
        n_wb: "skipped",
        n_history: "reused",
      },
    });

    expect(tavernData(nodes, "n_narrator").runStatus).toBe("running");
    expect(tavernData(nodes, "n_narrator").previewSummary.status).toBe("running");
    expect(tavernData(nodes, "n_commit").runStatus).toBe("succeeded");
    expect(tavernData(nodes, "n_commit").previewSummary.status).toBe("succeeded");
    expect(tavernData(nodes, "n_lore").runStatus).toBe("failed");
    expect(tavernData(nodes, "n_lore").previewSummary.status).toBe("failed");
    // NG2-4：skipped / reused 状态也应完整传递到节点数据（reused 归一为 succeeded 预览）。
    expect(tavernData(nodes, "n_wb").runStatus).toBe("skipped");
    expect(tavernData(nodes, "n_history").runStatus).toBe("reused");
    expect(tavernData(nodes, "n_history").previewSummary.status).toBe("succeeded");
    expect(tavernData(nodes, "n_user").runStatus).toBeUndefined();
  });

  it("flags unknown node types with empty ports", () => {
    const document: NodeGraphDocument = {
      schemaVersion: 2,
      graphId: "unknown",
      name: "unknown",
      mode: "native_graph",
      nodes: [
        { id: "x", type: "does.not.exist", typeVersion: "1", name: "Mystery", phase: "response" },
      ],
      edges: [],
      policies: {},
    };

    const { nodes } = mapDocumentToFlow(document);
    const data = tavernData(nodes, "x");
    expect(data.unknownType).toBe(true);
    expect(data.entry).toBeUndefined();
    expect(data.title).toBe("Mystery");
    expect(data.inputPorts).toHaveLength(0);
    expect(data.outputPorts).toHaveLength(0);
  });

  it("drills into a group: renders only its members and intra-group edges", () => {
    const { nodes, edges } = mapDocumentToFlow(SAMPLE_NODE_GRAPH_DOCUMENT, { focusGroupId: "g_preflight" });

    // 仅 g_preflight 的 5 个成员，无分组容器。
    expect(nodes.filter((node) => node.type === GROUP_NODE_TYPE)).toHaveLength(0);
    expect(nodes.filter((node) => node.type === TAVERN_NODE_TYPE).map((node) => node.id).sort()).toEqual([
      "n_agency_pre",
      "n_cond",
      "n_director",
      "n_gate",
      "n_lore",
    ]);
    // 仅组内边（n_cond→n_gate 与 gate→lore 控制边），跨组边（n_wb→…）被隐藏。
    expect(edges.map((edge) => edge.id).sort()).toEqual(["c_gate_lore", "e_cond_gate"]);
  });
  it("de-overlaps drilled-in members whose explicit positions collide", () => {
    // 构造一个组，其成员被写入了相同坐标（模拟被写坏的数据）。
    const document: NodeGraphDocument = {
      schemaVersion: 2,
      graphId: "overlap",
      name: "overlap",
      mode: "native_graph",
      nodes: [
        { id: "m1", type: "compose.template_render", typeVersion: "1", phase: "pre_response", ui: { position: { x: 100, y: 100 } } },
        { id: "m2", type: "compose.template_render", typeVersion: "1", phase: "pre_response", ui: { position: { x: 100, y: 100 } } },
        { id: "m3", type: "compose.template_render", typeVersion: "1", phase: "pre_response", ui: { position: { x: 100, y: 100 } } },
      ],
      edges: [],
      groups: [{ id: "g", name: "G", kind: "subgraph", nodeIds: ["m1", "m2", "m3"] }],
      policies: {},
    };

    const { nodes } = mapDocumentToFlow(document, { focusGroupId: "g" });
    const tavern = nodes.filter((node) => node.type === TAVERN_NODE_TYPE);
    const positionKeys = new Set(tavern.map((node) => `${Math.round(node.position.x)}:${Math.round(node.position.y)}`));
    // 检测到重叠后应回退占位布局，三个成员坐标互不相同。
    expect(positionKeys.size).toBe(3);
  });


  it("falls back to the full graph when the focus group id is unknown", () => {
    const { nodes } = mapDocumentToFlow(SAMPLE_NODE_GRAPH_DOCUMENT, { focusGroupId: "does_not_exist" });
    expect(nodes).toHaveLength(26);
  });

  it("summarizes node config without exposing long JSON", () => {
    const document: NodeGraphDocument = {
      schemaVersion: 2,
      graphId: "summary",
      name: "summary",
      mode: "native_graph",
      nodes: [
        {
          id: "agent",
          type: "agent.call",
          typeVersion: "1",
          phase: "pre_response",
          config: { medium: { kind: "background_job", deliveryTarget: "derived_output" } },
        },
        {
          id: "cond",
          type: "control.condition",
          typeVersion: "1",
          phase: "pre_response",
          config: { condition: { op: "exists", value: { source: "runtime", path: ["intent"] } } },
        },
        {
          id: "note",
          type: "annotation.comment",
          typeVersion: "1",
          phase: "pre_response",
          config: { content: "Explain the control path." },
        },
      ],
      edges: [],
      policies: {},
    };

    expect(summarizeNodeConfig(document, document.nodes[0]!).items).toEqual([
      { label: "medium", labelKey: "graphNode.summary.label.medium", value: "background_job" },
      { label: "output", labelKey: "graphNode.summary.label.output", value: "derived_output" },
      { label: "binding", labelKey: "graphNode.summary.label.binding", value: "missing", valueKey: "graphNode.summary.value.missing", tone: "warning" },
      {
        label: "execution",
        labelKey: "graphNode.summary.label.execution",
        value: "inherit",
        valueKey: "graphNode.summary.value.execution.inherit",
        tone: "neutral",
      },
    ]);
    expect(summarizeNodeConfig(document, document.nodes[0]!).missing).toBe(true);
    expect(summarizeNodeConfig(document, document.nodes[1]!).items).toEqual([
      { label: "condition", labelKey: "graphNode.summary.label.condition", value: "exists runtime.intent" },
    ]);
    expect(summarizeNodeConfig(document, document.nodes[2]!).items).toEqual([
      { label: "note", labelKey: "graphNode.summary.label.note", value: "25 chars", valueKey: "graphNode.summary.value.chars", valueParams: { count: 25 } },
    ]);
  });

  it("summarizes Agent execution overrides for node cards", () => {
    const document: NodeGraphDocument = {
      schemaVersion: 2,
      graphId: "agent-execution-summary",
      name: "agent-execution-summary",
      mode: "native_graph",
      nodes: [
        {
          id: "director",
          type: "agent.director_plan",
          typeVersion: "1",
          phase: "pre_response",
          config: {
            execution: {
              modelSource: { mode: "llm_profile", profileId: "profile-a" },
              modelId: "model-a",
              generation: {
                temperature: { enabled: true, value: 0.7 },
                topP: { enabled: false, value: 1 },
              },
            },
          },
        },
      ],
      edges: [],
      policies: {},
    };

    expect(summarizeNodeConfig(document, document.nodes[0]!).items).toEqual([
      {
        label: "execution",
        labelKey: "graphNode.summary.label.execution",
        value: "profile-a · model-a",
      },
      {
        label: "generation",
        labelKey: "graphNode.summary.label.generation",
        value: "1 enabled",
        valueKey: "graphNode.summary.value.execution.paramsEnabled",
        valueParams: { count: 1 },
      },
    ]);
  });

  it("maps inline controls for first batch node types", () => {
    const document: NodeGraphDocument = {
      schemaVersion: 2,
      graphId: "inline",
      name: "inline",
      mode: "native_graph",
      nodes: [
        { id: "comment", type: "annotation.comment", typeVersion: "1", phase: "pre_response", config: { content: "note" } },
        { id: "template", type: "compose.template_render", typeVersion: "1", phase: "pre_response", config: { template: "hi" } },
        { id: "branch", type: "control.branch", typeVersion: "1", phase: "pre_response" },
        { id: "gate", type: "control.gate", typeVersion: "1", phase: "pre_response", config: { onSkip: "use_cached" } },
        { id: "agent", type: "agent.call", typeVersion: "1", phase: "pre_response", config: { medium: { kind: "single_call", deliveryTarget: "return_inline" } } },
        { id: "narrator", type: "narration.narrator", typeVersion: "1", phase: "response", config: { presetRef: { presetId: "p1" } } },
      ],
      edges: [],
      policies: {},
    };

    const { nodes } = mapDocumentToFlow(document);
    expect(tavernData(nodes, "comment").inlineConfigControls.map((control) => control.path)).toEqual(["content"]);
    expect(tavernData(nodes, "template").inlineConfigControls.map((control) => control.path)).toEqual(["template", "role"]);
    expect(tavernData(nodes, "branch").inlineConfigControls.map((control) => control.path)).toEqual(["condition"]);
    expect(tavernData(nodes, "gate").inlineConfigControls.map((control) => control.path)).toEqual(["condition", "onSkip"]);
    expect(tavernData(nodes, "agent").inlineConfigControls.map((control) => control.path)).toEqual([
      "medium.kind",
      "medium.deliveryTarget",
      "triggerReason",
      "execution.modelSource",
      "execution.modelId",
      "execution.generation.temperature",
      "execution.generation.topP",
       "execution.generation.maxOutputTokens",
      "execution.generation.maxContextTokens",
    ]);
    expect(tavernData(nodes, "narrator").inlineConfigControls.map((control) => control.path)).toEqual([
      "presetRef.presetId",
      "presetRef.presetVersionId",
      "execution.modelSource",
      "execution.modelId",
      "execution.generation.temperature",
      "execution.generation.topP",
      "execution.generation.maxOutputTokens",
      "execution.generation.maxContextTokens",
    ]);
  });

  it("summarizes preview status from run status and preview policy", () => {
    expect(summarizeNodePreview("manual")).toEqual({ status: "available", policy: "manual" });
    expect(summarizeNodePreview("disabled")).toEqual({ status: "disabled", policy: "disabled" });
    expect(summarizeNodePreview("auto", "running")).toEqual({ status: "running", policy: "auto" });
    expect(summarizeNodePreview("auto", "succeeded")).toEqual({ status: "succeeded", policy: "auto" });
    expect(summarizeNodePreview("auto", "failed")).toEqual({ status: "failed", policy: "auto" });
  });

  it("renders group.node ports from its interface cache", () => {
    const document: NodeGraphDocument = {
      schemaVersion: 2,
      graphId: "gn",
      name: "gn",
      mode: "native_graph",
      nodes: [
        {
          id: "g",
          type: "group.node",
          typeVersion: "1",
          phase: "pre_response",
          name: "My Group",
          config: {
            ref: { graphId: "sub" },
            interface: { inputs: [{ name: "q", type: "text" }], outputs: [{ name: "r", type: "json" }] },
          },
        },
      ],
      edges: [],
      policies: {},
    };

    const { nodes } = mapDocumentToFlow(document);
    const data = tavernData(nodes, "g");
    expect(data.inputPorts.map((port) => port.name)).toEqual(["q"]);
    expect(data.outputPorts.map((port) => port.name)).toEqual(["r"]);
  });

  it("computes a group container bounding box covering its members", () => {
    const { nodes } = mapDocumentToFlow(SAMPLE_NODE_GRAPH_DOCUMENT);

    const groupNode = nodes.find((node) => node.id === "group:g_preflight");
    expect(groupNode).toBeDefined();
    expect(groupNode?.type).toBe(GROUP_NODE_TYPE);

    const data = groupNode!.data as GraphGroupNodeData;
    expect(data.kind).toBe("group");
    expect(data.group.id).toBe("g_preflight");
    expect(data.memberCount).toBe(5);
    // 样例图成员均启用 → 组开关呈「开」。
    expect(data.switchState).toBe("on");

    const style = groupNode!.style as Record<string, string>;
    expect(style.width).toMatch(/px$/);
    expect(style.height).toMatch(/px$/);
    expect(groupNode!.selectable).toBe(false);
    expect(groupNode!.draggable).toBe(false);
  });
});

describe("mapDocumentToFlow · collapsed node groups", () => {
  function collapsedDoc(collapsed: boolean): NodeGraphDocument {
    return {
      schemaVersion: 2,
      graphId: "c",
      name: "c",
      mode: "native_graph",
      nodes: [
        { id: "ext", type: "source.user_input", typeVersion: "1", phase: "pre_response", ui: { position: { x: 0, y: 0 } } },
        { id: "a", type: "compose.template_render", typeVersion: "1", phase: "pre_response", ui: { position: { x: 300, y: 0 } } },
        { id: "b", type: "compose.final_messages", typeVersion: "1", phase: "response", ui: { position: { x: 600, y: 0 } } },
        { id: "ext2", type: "output.commit_gate", typeVersion: "1", phase: "commit", ui: { position: { x: 900, y: 0 } } },
      ],
      edges: [
        { id: "e_in", from: { nodeId: "ext", port: "text" }, to: { nodeId: "a", port: "blocks" } },
        { id: "e_ab", from: { nodeId: "a", port: "block" }, to: { nodeId: "b", port: "blocks" } },
        { id: "e_out", from: { nodeId: "b", port: "messages" }, to: { nodeId: "ext2", port: "text" } },
      ],
      groups: [{ id: "grp", name: "Grp", kind: "subgraph", collapsed, nodeIds: ["a", "b"] }],
      policies: {},
    };
  }

  it("renders a collapsed subgraph group as a single node with derived interface ports", () => {
    const { nodes, edges } = mapDocumentToFlow(collapsedDoc(true));

    // 折叠节点存在；成员 a/b 隐藏；无包围盒容器；外部节点照常。
    const collapsed = nodes.find((n) => n.id === `${COLLAPSED_NODE_ID_PREFIX}grp`);
    expect(collapsed?.type).toBe(GROUP_COLLAPSED_NODE_TYPE);
    expect(nodes.some((n) => n.id === "a")).toBe(false);
    expect(nodes.some((n) => n.id === "b")).toBe(false);
    expect(nodes.some((n) => n.id === "group:grp")).toBe(false);
    expect(nodes.some((n) => n.id === "ext")).toBe(true);
    expect(nodes.some((n) => n.id === "ext2")).toBe(true);

    const data = collapsed!.data as GraphCollapsedGroupNodeData;
    expect(data.kind).toBe("groupCollapsed");
    expect(data.memberCount).toBe(2);
    expect(data.inputs.map((h) => h.id)).toEqual(["in:a:blocks"]);
    expect(data.outputs.map((h) => h.id)).toEqual(["out:b:messages"]);

    // 跨界边重路由到折叠节点端口；组内边隐藏。
    const eIn = edges.find((e) => e.id === "e_in");
    expect(eIn?.source).toBe("ext");
    expect(eIn?.target).toBe(`${COLLAPSED_NODE_ID_PREFIX}grp`);
    expect(eIn?.targetHandle).toBe("in:a:blocks");
    const eOut = edges.find((e) => e.id === "e_out");
    expect(eOut?.source).toBe(`${COLLAPSED_NODE_ID_PREFIX}grp`);
    expect(eOut?.sourceHandle).toBe("out:b:messages");
    expect(eOut?.target).toBe("ext2");
    expect(edges.some((e) => e.id === "e_ab")).toBe(false);
  });

  it("keeps the bounding box (no collapsed node) when collapsed is false", () => {
    const { nodes, edges } = mapDocumentToFlow(collapsedDoc(false));
    expect(nodes.some((n) => n.id === "group:grp")).toBe(true);
    expect(nodes.some((n) => n.id === `${COLLAPSED_NODE_ID_PREFIX}grp`)).toBe(false);
    expect(nodes.some((n) => n.id === "a")).toBe(true);
    // 未折叠：边保持原样（不重路由）。
    expect(edges.find((e) => e.id === "e_ab")).toBeDefined();
    expect(edges.find((e) => e.id === "e_in")?.target).toBe("a");
  });

  it("ignores collapse while focused (drill-in shows members)", () => {
    const { nodes } = mapDocumentToFlow(collapsedDoc(true), { focusGroupId: "grp" });
    expect(nodes.some((n) => n.id === "a")).toBe(true);
    expect(nodes.some((n) => n.id === "b")).toBe(true);
    expect(nodes.some((n) => n.id === `${COLLAPSED_NODE_ID_PREFIX}grp`)).toBe(false);
  });

  it("marks an explicitly disabled output channel and mutes its edge", () => {
    const doc = collapsedDoc(true);
    doc.groups![0]!.disabledChannels = ["out:b:messages"];
    const { nodes, edges } = mapDocumentToFlow(doc);

    const collapsed = nodes.find((n) => n.id === `${COLLAPSED_NODE_ID_PREFIX}grp`);
    const data = collapsed!.data as GraphCollapsedGroupNodeData;
    const channel = data.outputs.find((o) => o.id === "out:b:messages");
    expect(channel?.disabled).toBe(true);
    expect(channel?.producerNodeId).toBe("b");

    const eOut = edges.find((e) => e.id === "e_out");
    expect(eOut?.data?.muted).toBe(true);
  });

  it("treats a channel as semantically closed when its end node is disabled", () => {
    const doc = collapsedDoc(true);
    // 末端节点 b 禁用 → out:b:messages 语义上关闭（数据未变）。
    doc.nodes.find((n) => n.id === "b")!.enabled = false;
    const { nodes, edges } = mapDocumentToFlow(doc);

    const collapsed = nodes.find((n) => n.id === `${COLLAPSED_NODE_ID_PREFIX}grp`);
    const data = collapsed!.data as GraphCollapsedGroupNodeData;
    const channel = data.outputs.find((o) => o.id === "out:b:messages");
    expect(channel?.disabled).toBe(true);

    const eOut = edges.find((e) => e.id === "e_out");
    expect(eOut?.data?.muted).toBe(true);
  });
});
