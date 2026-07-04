import {
  compileNodeGraph,
  describeNodeTypeKnowledge,
  listNodeTypeKnowledge,
  type ToolCallResult,
  type ToolDefinition,
  type ToolExecutionContext,
  type ToolParameterProperty,
  type ToolProvider,
  type ToolSideEffectLevel,
  type NodeGraphDocument,
  type NodeGraphEdge,
  type NodeGraphGroup,
  type NodeGraphNode,
} from "@tavern/core";
import { nanoid } from "nanoid";

import type { NodeGraphDefinitionService } from "../services/node-graph-definition-service.js";
import type { ProjectInboxService } from "../services/project-inbox-service.js";
import type { ProjectActorInput } from "../services/project-access-service.js";
import type { OperationLogService } from "../services/operation-log-service.js";
import { GOVERNANCE_OPERATION_ACTIONS } from "../services/governance/operation-log-names.js";

export type NodeGraphToolProviderOptions = {
  service: NodeGraphDefinitionService;
  projectInbox: ProjectInboxService;
  actor: ProjectActorInput;
  projectId: string;
  /**
   * R6-1（缺口 1）：可选 operation log。注入后 `submit_proposal` 会写 `node_graph.proposal.submit` 审计。
   * 不注入时退化为仅写 project_inbox，保持向后兼容。
   */
  operationLog?: OperationLogService;
  workspaceId?: string | null;
  /** R6-3（缺口 5）：草稿 TTL（毫秒）。访问会滑动续期，过期后被驱逐。 */
  draftTtlMs?: number;
  /** R6-3（缺口 5）：同一 provider 实例允许保留的最大草稿数。 */
  maxDrafts?: number;
  /** 可注入时钟，仅用于测试。 */
  clock?: () => number;
};

/** R6-3（缺口 5）：草稿默认 TTL（30 分钟）。 */
export const DEFAULT_NODE_GRAPH_DRAFT_TTL_MS = 30 * 60 * 1000;
/** R6-3（缺口 5）：草稿默认数量上限。 */
export const DEFAULT_NODE_GRAPH_MAX_DRAFTS = 64;

type DraftRecord = {
  id: string;
  graphId: string;
  baseVersionId: string;
  document: NodeGraphDocument;
  createdAt: number;
  expiresAt: number;
};

/**
 * NodeGraph 自修改工具提供者。
 *
 * R6-3（缺口 5）草稿治理决策：agent 自改图草稿是**进程内非持久**的（`drafts` Map）。
 * 它们刻意不落库，因此：
 *  - 进程重启即丢，不在不同 worker / 进程间共享；
 *  - 受 TTL 滑动过期与数量上限约束，避免内存无限累积；
 *  - 真正的版本变更只能经 `submit_proposal` 进入 `project_inbox`（写 `node_graph.proposal.submit` 审计），
 *    再由拥有 `project.nodegraph.write` 的人创建正式版本，草稿本身永远不会被自动 live apply。
 * 持久化草稿与跨进程草稿编辑属于 NodeGraph editor（批次 9 / 10）范围，本阶段不实现。
 */
export class NodeGraphToolProvider implements ToolProvider {
  readonly id = "node-graph-tool-provider";
  readonly type = "builtin" as const;

  private readonly drafts = new Map<string, DraftRecord>();
  private readonly draftTtlMs: number;
  private readonly maxDrafts: number;
  private readonly now: () => number;

  constructor(private readonly options: NodeGraphToolProviderOptions) {
    this.draftTtlMs = options.draftTtlMs && options.draftTtlMs > 0 ? options.draftTtlMs : DEFAULT_NODE_GRAPH_DRAFT_TTL_MS;
    this.maxDrafts = options.maxDrafts && options.maxDrafts > 0 ? options.maxDrafts : DEFAULT_NODE_GRAPH_MAX_DRAFTS;
    this.now = options.clock ?? (() => Date.now());
  }

  async listTools(): Promise<ToolDefinition[]> {
    return NODE_GRAPH_TOOL_DEFINITIONS;
  }

  async executeTool(
    name: string,
    args: Record<string, unknown>,
    _context: ToolExecutionContext,
  ): Promise<ToolCallResult> {
    try {
      switch (name) {
        case "nodegraph.graph.create":
          return { data: this.createGraph(args) };
        case "nodegraph.graph.get":
          return { data: this.getGraph(args) };
     case "nodegraph.graph.list":
          return { data: this.listGraphs(args) };
        case "nodegraph.graph.find_by_name":
          return { data: this.findGraphByName(args) };
        case "nodegraph.graph.list_versions":
          return { data: this.listVersions(args) };
        case "nodegraph.node.get":
          return { data: this.getNode(args) };
        case "nodegraph.preset.get":
          return { data: this.getPreset(args) };
             case "nodegraph.node_type.list":
          return { data: listNodeTypeKnowledge() };
        case "nodegraph.node_type.describe":
          return { data: this.describeNodeType(args) };
        case "nodegraph.draft.create_from_version":
          return { data: this.createDraft(args) };
        case "nodegraph.node.add":
          return { data: this.addNode(args) };
        case "nodegraph.node.update_config":
          return { data: this.updateNodeConfig(args) };
        case "nodegraph.node.rename":
          return { data: this.renameNode(args) };
        case "nodegraph.node.delete":
          return { data: this.deleteNode(args) };
        case "nodegraph.edge.add":
          return { data: this.addEdge(args) };
        case "nodegraph.edge.delete":
          return { data: this.deleteEdge(args) };
        case "nodegraph.group.create":
          return { data: this.createGroup(args) };
        case "nodegraph.group.update":
          return { data: this.updateGroup(args) };
        case "nodegraph.patch.validate":
          return { data: this.validateDraft(args) };
        case "nodegraph.patch.diff":
          return { data: this.diffDraft(args) };
        case "nodegraph.patch.submit_proposal":
          return { data: this.submitProposal(args) };
        default:
          return {
            error: `Unknown or forbidden NodeGraph tool: ${name}`,
            executionStatus: "denied",
            executionReasonCode: "nodegraph_tool_not_allowed",
          };
      }
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
        executionStatus: "error",
        executionReasonCode: "nodegraph_tool_failed",
      };
    }
  }

  /**
   * 从零创建一张新图（真实持久写入）。
   *
   * 这是 NodeGraph 工具里唯一会 live 持久写入的工具：它创建的是**全新**图与其 v1 版本，
   * 不修改任何受保护的既有图。改动既有图仍只能经 `nodegraph.patch.submit_proposal`
   * 进入 project_inbox，由有权限的人创建正式版本，工具本身永远不会 live apply 既有图的改动。
   * 因此其 sideEffectLevel 取 `sandbox`（可逆：可归档 / 删除），而非 `irreversible`。
   */
  private createGraph(args: Record<string, unknown>) {
    const document = requireRecord(args.document, "document") as unknown as NodeGraphDocument;
    const name = typeof args.name === "string" && args.name.trim().length > 0 ? args.name.trim() : null;
    return this.options.service.create({
      actor: this.options.actor,
      projectId: this.options.projectId,
      name,
      document,
    });
  }

  /**
 * 读取一张图的定义与当前版本，以「节点组为一等公民」的分层视图呈现。
   *
   * 需求约定：节点组是工具结果里的一等信息（区分 kind=subgraph 封装子图 / kind=visual 可视收纳），
   * 组内成员只给摘要（二等公民，不含完整 config）；不属于任何组的游离节点单列。想看组内节点的
   * 完整配置，用 nodegraph.node.get 展开。edges 全量给出以便理解连接关系；若该图来自酒馆预设导入，
   * source 会标明并引导使用 nodegraph.preset.get。
   */
  private getGraph(args: Record<string, unknown>) {
    const graphId = requireString(args.graph_id, "graph_id");
    const definition = this.options.service.get({
          actor: this.options.actor,
      projectId: this.options.projectId,
      graphId,
    });
    const currentVersion = this.options.service.getCurrentVersion({
      actor: this.options.actor,
      projectId: this.options.projectId,
      graphId,
    });
    const document = currentVersion.document;
    const nodesById = new Map(document.nodes.map((node) => [node.id, node] as const));
    const groups = document.groups ?? [];
    const groupedNodeIds = new Set<string>();
    for (const group of groups) {
      for (const nodeId of group.nodeIds) {
        groupedNodeIds.add(nodeId);
      }
    }
    const ungroupedNodes = document.nodes
      .filter((node) => !groupedNodeIds.has(node.id))
      .map(toNodeSummary);
    return {
      definition,
      current_version: {
        id: currentVersion.id,
        version_no: currentVersion.versionNo,
        document_hash: currentVersion.documentHash,
        created_at: currentVersion.createdAt,
      },
      graph: {
        schema_version: document.schemaVersion,
        name: document.name,
        description: document.description,
        source: buildGraphSourceInfo(document),
      counts: {
          nodes: document.nodes.length,
          edges: document.edges.length,
          groups: groups.length,
        },
        groups: groups.map((group) => toGroupView(group, nodesById)),
        ungrouped_nodes: ungroupedNodes,
        edges: document.edges,
      },
    };
  }

  /**
   * 读取线上当前版本的单个节点；若传入的是节点组 id，则展开该组全部成员的完整信息。
   *
   * 与 graph.get 的「组一等、节点二等」呼应：graph.get 只给组与成员摘要，想看组内节点的完整
   * 配置时用本工具——传节点 id 得该节点，传组 id 会展开整组成员（钻入子图 / 展开可视收纳）。
   */
  private getNode(args: Record<string,unknown>) {
    const graphId = requireString(args.graph_id, "graph_id");
    const nodeId = requireString(args.node_id, "node_id");
    const currentVersion = this.options.service.getCurrentVersion({
      actor: this.options.actor,
      projectId: this.options.projectId,
      graphId,
    });
    const document = currentVersion.document;
    const nodesById = new Map(document.nodes.map((node) => [node.id, node] as const));

    // 优先按节点组解析：命中组则展开成员完整信息（钻入子图 / 展开可视收纳）。
    const group = (document.groups ?? []).find((candidate) => candidate.id === nodeId);
    if (group) {
      const members = group.nodeIds
        .map((id) => nodesById.get(id))
       .filter((node): node is NodeGraphNode => Boolean(node));
      const memberIds = new Set(members.map((node) => node.id));
      const relatedEdges = document.edges.filter(
        (edge) => memberIds.has(edge.from.nodeId) || memberIds.has(edge.to.nodeId),
      );
      return {
        graph_id: graphId,
        resolved_as: "group" as const,
     group: omitUndefined({
          id: group.id,
          name: group.name,
          kind: group.kind,
          collapsed: group.collapsed === true ? true : undefined,
          enabled: group.enabled === false ? false : undefined,
          input_ports: group.inputPorts && group.inputPorts.length > 0 ? group.inputPorts : undefined,
          output_ports:
         group.outputPorts && group.outputPorts.length > 0 ? group.outputPorts : undefined,
        }),
        nodes: members,
        edges: relatedEdges,
      };
    }

    // 否则按普通节点解析。
    const node = nodesById.get(nodeId);
    if (!node) {
      throw new Error(`Node or group not found in the current version: ${nodeId}`);
    }
    const ownerGroup = (document.groups ?? []).find((candidate) =>
      candidate.nodeIds.includes(nodeId),
    );
    return {
      graph_id: graphId,
      resolved_as: "node" as const,
      node,
      group: ownerGroup
        ? { id: ownerGroup.id, name: ownerGroup.name, kind: ownerGroup.kind }
        : null,
      incoming_edges: document.edges.filter((edge) => edge.to.nodeId === nodeId),
      outgoing_edges: document.edges.filter((edge) => edge.from.nodeId === nodeId),
    };
  }

  /**
   * 读取「来自酒馆（SillyTavern）预设导入」的图背后的原始预设信息。
   *
   * 不带 identifier：返回预设整体概览 + prompt_order 对照表（每条原始 prompt → 当前所属分组），
   * 让 agent 一眼看清预设被拆分/封装成了哪些组。带 identifier：返回该条 prompt 的完整原文。
   * 图不是从预设导入时返回 imported_from_preset=false，不报错。
   */
  private getPreset(args: Record<string, unknown>) {
    const graphId =requireString(args.graph_id, "graph_id");
    const currentVersion = this.options.service.getCurrentVersion({
      actor: this.options.actor,
      projectId: this.options.projectId,
      graphId,
    });
    const document = currentVersion.document;
    const meta = isRecord(document.metadata) ? document.metadata : null;
    if (!meta || meta.importedFrom !== "sillytavern_openai_preset") {
      return {
        graph_id: graphId,
        imported_from_preset: false,
        message:
          "This graph was not imported from a SillyTavern preset; there is no original preset to read.",
      };
    }

    const presetSource =isRecord(meta.presetSource) ?meta.presetSource : null;
    const prompts =
      presetSource && Array.isArray(presetSource.prompts) ? presetSource.prompts : [];
    const promptById = new Map<string, Record<string, unknown>>();
    for (const prompt of prompts) {
      if (isRecord(prompt) && typeof prompt.identifier === "string") {
        promptById.set(prompt.identifier, prompt);
      }
    }

    // 当前图里 block 节点通过 config.identifier 回指原始 prompt；据此对照分组归属。
    const nodeByIdentifier = new Map<string, NodeGraphNode>();
    for (const node of document.nodes) {
      if (isRecord(node.config) && typeof node.config.identifier === "string") {
        nodeByIdentifier.set(node.config.identifier, node);
      }
    }
    const groupByNodeId = new Map<string, NodeGraphGroup>();
    for (const group of document.groups ?? []) {
      for (const memberId of group.nodeIds) {
        groupByNodeId.set(memberId, group);
      }
    }

    const identifierArg =
  typeof args.identifier === "string" && args.identifier.trim().length > 0
        ? args.identifier.trim()
        : null;

    if (identifierArg) {
      const prompt = promptById.get(identifierArg) ?? null;
      const node = nodeByIdentifier.get(identifierArg) ?? null;
      const group = node ? groupByNodeId.get(node.id) ?? null : null;
      if (!prompt && !node) {
        throw new Error(`Preset prompt not found: ${identifierArg}`);
      }
   return {
        graph_id: graphId,
        imported_from_preset: true,
        entry: {
          identifier: identifierArg,
          original: prompt,
          current_node: node
            ? { id: node.id, name: node.name ?? null, enabled: node.enabled !== false }
            : null,
          current_group: group
            ? { id: group.id, name: group.name, kind: group.kind }
            : null,
        },
      };
    }

    const order = pickPresetPromptOrder(presetSource, promptById);
    const promptOrder = order.map((entry) => {
      const prompt = promptById.get(entry.identifier);
      const node = nodeByIdentifier.get(entry.identifier) ?? null;
      const group = node ? groupByNodeId.get(node.id) ?? null : null;
  return omitUndefined({
        identifier: entry.identifier,
        name: prompt && typeof prompt.name === "string" ? prompt.name : undefined,
       enabled: entry.enabled,
        role: prompt && typeof prompt.role === "string" ? prompt.role : undefined,
        marker: prompt && prompt.marker === true ? true : undefined,
        has_content:
          prompt !== undefined && typeof prompt.content === "string" && prompt.content.length > 0,
        current_node_id: node ? node.id : null,
        current_group: group
          ? { id: group.id, name: group.name, kind: group.kind }
          : null,
      });
    });

    const sampling = extractPresetSampling(presetSource);
    return {
      graph_id: graphId,
      imported_from_preset: true,
      overview: omitUndefined({
        preset_name: typeof meta.presetName === "string" ? meta.presetName : undefined,
        cluster_mode: typeof meta.clusterMode === "string" ? meta.clusterMode : undefined,
        prompt_count: prompts.length,
        order_count: order.length,
        sampling: Object.keys(sampling).length > 0 ? sampling : undefined,
        regex_count: countPresetRegex(presetSource),
      }),
      prompt_order: promptOrder,
    };
  }

  /** 列出当前项目下的图（id / 名称 / 状态），用于「看看有哪些图」。只读，不修改任何数据。 */
  private listGraphs(args: Record<string, unknown>) {
    const status = normalizeStatusFilter(args.status);
    const definitions = this.options.service.list({
      actor: this.options.actor,
      projectId: this.options.projectId,
      ...(status ? { status } : {}),
    });
    return {
      graphs: definitions.map((definition) => ({
        id: definition.id,
        name: definition.name,
        status: definition.status,
        current_version_id: definition.currentVersionId,
        created_at: definition.createdAt,
        updated_at: definition.updatedAt,
      })),
    };
  }

  /**
   * 按名称查找图，返回其 Graph ID。
   *
   * 名称可能不唯一：优先精确匹配；无精确匹配时回退为大小写不敏感匹配。
   * `matches` 返回所有命中项；`graph_id` 仅在恰好命中一张图时给出，便于直接接续后续工具调用。
   */
  private findGraphByName(args: Record<string, unknown>) {
    const name = requireString(args.name, "name");
    const status = normalizeStatusFilter(args.status);
    const definitions = this.options.service.list({
      actor: this.options.actor,
      projectId: this.options.projectId,
      ...(status? { status } : {}),
    });
    const exact = definitions.filter((definition) => definition.name === name);
    const lower = name.toLowerCase();
    const matched = exact.length > 0
      ? exact
      : definitions.filter((definition) => definition.name.toLowerCase() === lower);
    const sole = matched.length === 1 ? matched[0] : null;
    return {
      name,
      matches: matched.map((definition) => ({
        id: definition.id,
     name: definition.name,
        status: definition.status,
        current_version_id: definition.currentVersionId,
      })),
      graph_id: sole ? sole.id : null,
    };
  }

  private listVersions(args: Record<string, unknown>) {
    const graphId = requireString(args.graph_id, "graph_id");
    return this.options.service.listVersions({
      actor: this.options.actor,
      projectId: this.options.projectId,
       graphId,
    });
  }

  private describeNodeType(args: Record<string, unknown>) {
    const type = requireString(args.type, "type");
    const typeVersion = typeof args.type_version === "string" ? args.type_version : "1";
    const detail = describeNodeTypeKnowledge(type, typeVersion);
    if (!detail) {
      throw new Error(`Node type not registered: ${type}@${typeVersion}`);
    }
    return detail;
  }

  private createDraft(args: Record<string, unknown>) {
    const graphId = requireString(args.graph_id, "graph_id");
    const versionId = requireString(args.version_id, "version_id");
    const version = this.options.service.getVersion({
      actor: this.options.actor,
      projectId: this.options.projectId,
      graphId,
      versionId,
    });
    const now = this.now();
    this.pruneExpiredDrafts(now);
    this.enforceDraftCap();
    const draft: DraftRecord = {
      id: `ngdraft_${nanoid(12)}`,
      graphId,
      baseVersionId: version.id,
      document: structuredClone(version.document),
      createdAt: now,
      expiresAt: now + this.draftTtlMs,
    };
    this.drafts.set(draft.id, draft);
    return {
      id: draft.id,
      graphId: draft.graphId,
      baseVersionId: draft.baseVersionId,
      document: draft.document,
      createdAt: draft.createdAt,
      expiresAt: draft.expiresAt,
      persistent: false,
    };
  }

  private addNode(args: Record<string, unknown>) {
    const draft = this.getDraft(requireString(args.draft_id, "draft_id"));
    const node = requireRecord(args.node, "node") as unknown as NodeGraphNode;
    if (draft.document.nodes.some((existing) => existing.id === node.id)) {
      throw new Error(`Node already exists: ${node.id}`);
    }
    draft.document.nodes.push(node);
    return { draft_id: draft.id, node };
  }

  private updateNodeConfig(args: Record<string, unknown>) {
    const draft = this.getDraft(requireString(args.draft_id, "draft_id"));
    const node = this.requireDraftNode(draft, requireString(args.node_id, "node_id"));
    node.config = args.config ?? {};
    return { draft_id: draft.id, node };
  }

  private renameNode(args: Record<string, unknown>) {
    const draft = this.getDraft(requireString(args.draft_id, "draft_id"));
    const node = this.requireDraftNode(draft, requireString(args.node_id, "node_id"));
    node.name = requireString(args.name, "name");
    return { draft_id: draft.id, node };
  }

  private deleteNode(args: Record<string, unknown>) {
    const draft = this.getDraft(requireString(args.draft_id, "draft_id"));
    const nodeId = requireString(args.node_id, "node_id");
    const beforeCount = draft.document.nodes.length;
    draft.document.nodes = draft.document.nodes.filter((node) => node.id !== nodeId);
    if (draft.document.nodes.length === beforeCount) {
      throw new Error(`Node not found: ${nodeId}`);
    }
    draft.document.edges = draft.document.edges.filter((edge) => edge.from.nodeId !== nodeId && edge.to.nodeId !== nodeId);
    if (draft.document.groups) {
      draft.document.groups = draft.document.groups.map((group) => ({
        ...group,
        nodeIds: group.nodeIds.filter((id) => id !== nodeId),
      }));
    }
    return { draft_id: draft.id, node_id: nodeId };
  }

  private addEdge(args: Record<string, unknown>) {
    const draft = this.getDraft(requireString(args.draft_id, "draft_id"));
    const edge = requireRecord(args.edge, "edge") as unknown as NodeGraphEdge;
    if (draft.document.edges.some((existing) => existing.id === edge.id)) {
      throw new Error(`Edge already exists: ${edge.id}`);
    }
    if (!draft.document.nodes.some((node) => node.id === edge.from.nodeId)) {
      throw new Error(`Edge source node not found: ${edge.from.nodeId}`);
    }
    if (!draft.document.nodes.some((node) => node.id === edge.to.nodeId)) {
      throw new Error(`Edge target node not found: ${edge.to.nodeId}`);
    }
    draft.document.edges.push(edge);
    return { draft_id: draft.id, edge };
  }

  private deleteEdge(args: Record<string, unknown>) {
    const draft = this.getDraft(requireString(args.draft_id, "draft_id"));
    const edgeId = requireString(args.edge_id, "edge_id");
    const beforeCount = draft.document.edges.length;
    draft.document.edges = draft.document.edges.filter((edge) => edge.id !== edgeId);
    if (draft.document.edges.length === beforeCount) {
      throw new Error(`Edge not found: ${edgeId}`);
    }
    return { draft_id: draft.id, edge_id: edgeId };
  }

  private createGroup(args: Record<string, unknown>) {
    const draft = this.getDraft(requireString(args.draft_id, "draft_id"));
    const group = requireRecord(args.group, "group") as unknown as NodeGraphGroup;
    if (draft.document.groups?.some((existing) => existing.id === group.id)) {
      throw new Error(`Group already exists: ${group.id}`);
    }
    draft.document.groups = [...(draft.document.groups ?? []), group];
    return { draft_id: draft.id, group };
  }

  private updateGroup(args: Record<string, unknown>) {
    const draft = this.getDraft(requireString(args.draft_id, "draft_id"));
    const groupId = requireString(args.group_id, "group_id");
    const patch = requireRecord(args.patch, "patch") as Partial<NodeGraphGroup>;
    const groups = draft.document.groups ?? [];
    const index = groups.findIndex((group) => group.id === groupId);
    if (index < 0) {
      throw new Error(`Group not found: ${groupId}`);
    }
    const updated = {
      ...groups[index],
      ...patch,
      id: groupId,
    } as NodeGraphGroup;
    draft.document.groups = [
      ...groups.slice(0, index),
      updated,
      ...groups.slice(index + 1),
    ];
    return { draft_id: draft.id, group: updated };
  }

  private validateDraft(args: Record<string, unknown>) {
    const draft = this.getDraft(requireString(args.draft_id, "draft_id"));
    const compiled = compileNodeGraph(draft.document);
    return {
      is_executable: compiled.isExecutable,
      diagnostics: compiled.diagnostics,
      topological_levels: compiled.topologicalLevels.map((level) => level.map((node) => node.id)),
    };
  }

  private diffDraft(args: Record<string, unknown>) {
    const draft = this.getDraft(requireString(args.draft_id, "draft_id"));
    const base = this.options.service.getVersion({
      actor: this.options.actor,
      projectId: this.options.projectId,
      graphId: draft.graphId,
      versionId: draft.baseVersionId,
    });
    return {
      draft_id: draft.id,
      base_version_id: draft.baseVersionId,
      changed: JSON.stringify(base.document) !== JSON.stringify(draft.document),
      before: base.document,
      after: draft.document,
    };
  }

  private submitProposal(args: Record<string, unknown>) {
    const draft = this.getDraft(requireString(args.draft_id, "draft_id"));
    const validation = compileNodeGraph(draft.document);
    if (!validation.isExecutable) {
      throw new Error("Cannot submit a NodeGraph patch proposal while the draft has validation errors.");
    }
    const proposal = {
      kind: "nodegraph_patch_proposal",
      draft_id: draft.id,
      graph_id: draft.graphId,
      base_version_id: draft.baseVersionId,
      document: draft.document,
      validation: {
        is_executable: validation.isExecutable,
        diagnostics: validation.diagnostics,
      },
      note: typeof args.note === "string" ? args.note : null,
    };
    const inboxItem = this.options.projectInbox.create({
      actorAccountId: this.options.actor.actorAccountId,
      actor: this.options.actor,
      projectId: this.options.projectId,
      type: "nodegraph.patch_proposal",
      title: `NodeGraph patch proposal: ${draft.document.name}`,
      payload: proposal,
    });

    this.options.operationLog?.append({
      accountId: this.options.actor.actorAccountId,
      actorType: this.options.actor.actorType,
      actorId: this.options.actor.actorAccountId,
      sourceType: "node_graph_tool",
      action: GOVERNANCE_OPERATION_ACTIONS.nodeGraph.proposalSubmit,
      status: "succeeded",
      ...(this.options.workspaceId ? { workspaceId: this.options.workspaceId } : {}),
      projectId: this.options.projectId,
      actorClientId: this.options.actor.actorClientId ?? null,
      targetType: "node_graph",
      targetId: draft.graphId,
      metadata: {
        draft_id: draft.id,
        graph_id: draft.graphId,
        base_version_id: draft.baseVersionId,
        project_inbox_item_id: inboxItem.id,
        is_executable: validation.isExecutable,
        diagnostic_count: validation.diagnostics.length,
      },
    });

    return {
      ...proposal,
      project_inbox_item_id: inboxItem.id,
    };
  }

  private getDraft(draftId: string): DraftRecord {
    const now = this.now();
    this.pruneExpiredDrafts(now);
    const draft = this.drafts.get(draftId);
    if (!draft) {
      throw new Error(
        `NodeGraph draft not found or expired: ${draftId}. Drafts are in-process and non-persistent; `
          + "they are lost on restart and evicted after their TTL. Recreate the draft with nodegraph.draft.create_from_version.",
      );
    }
    // 滑动续期：每次访问刷新过期时间。
    draft.expiresAt = now + this.draftTtlMs;
    return draft;
  }

  /** R6-3（缺口 5）：驱逐已过期草稿，避免内存无限累积。 */
  private pruneExpiredDrafts(now: number): void {
    for (const [id, draft] of this.drafts) {
      if (draft.expiresAt <= now) {
        this.drafts.delete(id);
      }
    }
  }

  /** R6-3（缺口 5）：达到草稿上限时，驱逐最早过期的草稿，给新草稿腾出空间。 */
  private enforceDraftCap(): void {
    while (this.drafts.size >= this.maxDrafts) {
      let oldestId: string | null = null;
      let oldestExpiresAt = Number.POSITIVE_INFINITY;
      for (const [id, draft] of this.drafts) {
        if (draft.expiresAt < oldestExpiresAt) {
          oldestExpiresAt = draft.expiresAt;
          oldestId = id;
        }
      }
      if (oldestId === null) {
        break;
      }
      this.drafts.delete(oldestId);
    }
  }

  private requireDraftNode(draft: DraftRecord, nodeId: string): NodeGraphNode {
    const node = draft.document.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) {
      throw new Error(`Node not found: ${nodeId}`);
    }
    return node;
  }
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} is required`);
  }
  return value.trim();
}

function requireRecord(value: unknown, fieldName: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object`);
  }
  return value as Record<string, unknown>;
}

/** 解析可选的图状态过滤参数：仅接受 active / archived，其余一律视为不过滤。 */
function normalizeStatusFilter(value: unknown): "active" | "archived" | null {
  return value === "active"|| value === "archived" ? value : null;
}

/** 浅层删除值为 undefined 的键，保持工具结果紧凑。 */
function omitUndefined<T extends Record<string, unknown>>(value: T): T {
 for (const key of Object.keys(value)) {
    if (value[key] === undefined) {
      delete value[key];
    }
  }
  return value;
}

/** 轻量对象守卫（非数组的纯对象）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 从文档 metadata 推断该图是否来自酒馆（SillyTavern）预设导入。
 *
 * 导入器（studio 侧 silly-tavern-preset）会写 `metadata.importedFrom = "sillytavern_openai_preset"`
 * 及 presetName / clusterMode / presetSource。命中时附一句提示，引导 agent 使用 nodegraph.preset.get。
 */
function buildGraphSourceInfo(document: NodeGraphDocument): Record<string, unknown> {
  const meta = isRecord(document.metadata) ? document.metadata : null;
  if (meta && meta.importedFrom === "sillytavern_openai_preset") {
    return omitUndefined({
      imported_from_preset: true,
      preset_name: typeof meta.presetName === "string" ? meta.presetName : undefined,
      cluster_mode: typeof meta.clusterMode === "string" ?meta.clusterMode : undefined,
      hint: "Imported from a SillyTavern preset. Use nodegraph.preset.get (with this graph_id) to read the original preset overview and the prompt_order -> group mapping.",
    });
  }
  return { imported_from_preset: false };
}

/** 节点摘要（二等公民视图）：只给身份与开关，不含完整 config。 */
function toNodeSummary(node: NodeGraphNode): Record<string, unknown> {
  return omitUndefined({
    id: node.id,
    type: node.type,
    name: node.name,
    phase: node.phase,
    enabled: node.enabled !== false,
  });
}

/**
 * 节点组视图（一等公民）：区分子图封装与可视收纳，带成员摘要与（子图的）对外接口端口。
 *
 * - `kind: "subgraph"`：封装成对外单节点的子图，成员默认藏在内部；
 * - `kind: "visual"`：编辑器可视收纳，成员本身仍是画布上的独立节点。
 */
function toGroupView(
  group: NodeGraphGroup,
  nodesById: Map<string, NodeGraphNode>,
): Record<string, unknown> {
  const members = group.nodeIds
    .map((id) => nodesById.get(id))
    .filter((node): node is NodeGraphNode => Boolean(node))
    .map(toNodeSummary);
  return omitUndefined({
    id: group.id,
    name: group.name,
    kind: group.kind,
    collapsed: group.collapsed === true ? true : undefined,
    enabled: group.enabled === false ? false : undefined,
    member_count: group.nodeIds.length,
    members,
    input_ports: group.inputPorts && group.inputPorts.length > 0 ? group.inputPorts : undefined,
    output_ports: group.outputPorts && group.outputPorts.length > 0 ? group.outputPorts : undefined,
  });
}

/**
 * 选定要展示的 `prompt_order`：取「启用且能解析到 prompt 定义」条目最多者，与导入器口径一致。
 * 无prompt_order 时退化为按 prompts 顺序全部启用。
 */
function pickPresetPromptOrder(
  presetSource: Record<string, unknown> | null,
  promptById: Map<string, Record<string, unknown>>,
): Array<{ identifier: string; enabled: boolean }> {
  const orders =
    presetSource && Array.isArray(presetSource.prompt_order) ? presetSource.prompt_order: [];
  if (orders.length === 0) {
    return [...promptById.keys()].map((identifier) => ({ identifier, enabled: true }));
  }
  let best: Array<{ identifier: string; enabled: boolean }> = [];
  let bestScore = -1;
  for (const order of orders) {
    if (!isRecord(order) || !Array.isArray(order.order)) {
      continue;
    }
    const entries = order.order
      .filter(
        (entry): entry is Record<string, unknown> =>
          isRecord(entry) && typeof entry.identifier === "string",
      )
      .map((entry) => ({
        identifier: entry.identifier as string,
        enabled: entry.enabled !== false,
      }));
    const score = entries.filter(
      (entry) => entry.enabled && promptById.has(entry.identifier),
    ).length;
    if (score > bestScore) {
      bestScore = score;
      best = entries;
    }
  }
  return best;
}

/** 采样字段名集合（酒馆 OpenAI 预设常见项）。 */
const PRESET_SAMPLER_KEYS = [
  "temperature",
  "top_p",
  "top_k",
  "top_a",
  "min_p",
  "frequency_penalty",
  "presence_penalty",
  "repetition_penalty",
  "openai_max_tokens",
  "openai_max_context",
];

/** 从原始预设提取采样参数（仅保留数值项）。 */
function extractPresetSampling(
  presetSource: Record<string, unknown> | null,
): Record<string, number> {
  const sampling: Record<string, number> = {};
  if (!presetSource) {
    return sampling;
  }
  for (const key of PRESET_SAMPLER_KEYS) {
    const value = presetSource[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      sampling[key] = value;
    }
  }
  return sampling;
}

/** 统计原始预设里的正则脚本数量（兼容多种放置位置）。 */
function countPresetRegex(presetSource: Record<string, unknown> | null): number {
  if (!presetSource) {
    return 0;
  }
  const extensions = isRecord(presetSource.extensions) ? presetSource.extensions : null;
  const candidates: unknown[] = [
    extensions?.regex_scripts,
    presetSource.regex_scripts,
    extensions?.regex,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
  return candidate.length;
    }
  }
  return 0;
}

const commonObjectSchema = {
  type: "object" as const,
  properties: {},
};

// ── NodeGraph 参数 schema 片段 ────────────────────────────
//
// 这些片段依据 core 的 NodeGraph 文档类型（NodeGraphNode / NodeGraphEdge /
// NodeGraphGroup / NodeGraphDocument）描述复杂对象参数的形状，让文本协议下的
// 模型知道每个对象 / 数组该怎么写。只增强对外暴露的 schema，不改变执行逻辑。

const nodeGraphPhaseEnum = [
  "floor_prepare",
  "pre_response",
  "response",
  "post_response",
  "commit",
];

const nodeUiSchema: ToolParameterProperty = {
  type: "object",
  description: "Optional UI hints for the node (canvas only; ignored by execution).",
  properties: {
    position: {
      type: "object",
      description: "Canvas position.",
      properties: {
        x: { type: "number" },
        y: { type: "number" },
      },
      required: ["x", "y"],
    },
    groupId: { type: "string", description: "Id of the group this node belongs to." },
  },
};

const nodeSchema: ToolParameterProperty = {
  type: "object",
  description:
    "A NodeGraph node. Use nodegraph.node_type.describe to learn a type's config keys and ports before adding it.",
  properties: {
    id: { type: "string", description: "Unique node id within the document." },
    type: { type: "string", description: "Registered node type (see nodegraph.node_type.list)." },
    typeVersion: { type: "string", description: 'Node type version string, e.g. "1".' },
    name: { type: "string", description: "Optional human-readable node name." },
    enabled: {
      type: "boolean",
      description: "Whether the node participates in execution (default true).",
    },
    phase: {
      type: "string",
      description: "Execution phase the node runs in.",
      enum: nodeGraphPhaseEnum,
    },
    config: {
      type: "object",
      description: "Node configuration object; its shape depends on the node type.",
    },
    ui: nodeUiSchema,
  },
  required: ["id", "type", "typeVersion", "phase"],
};

const edgeEndpointSchema: ToolParameterProperty = {
  type: "object",
  description: "An edge endpoint: a node id plus one of its port names.",
  properties: {
    nodeId: { type: "string", description: "Id of the connected node." },
    port: { type: "string", description: "Port name on that node." },
  },
  required: ["nodeId", "port"],
};

const edgeSchema: ToolParameterProperty = {
  type: "object",
  description:
    "A NodeGraph edge connecting one node's output port to another node's input port.",
  properties: {
    id: { type: "string", description: "Unique edge id within the document." },
    from: edgeEndpointSchema,
    to: edgeEndpointSchema,
    kind: {
      type: "string",
      description: 'Edge kind; defaults to "data". "control" requires schemaVersion >= 2.',
      enum: ["data", "control"],
    },
  },
  required: ["id", "from", "to"],
};

const groupSchema: ToolParameterProperty = {
  type: "object",
   description: "A NodeGraph group (visual cluster or subgraph) over a set of member nodes.",
  properties: {
    id: { type: "string", description: "Unique group id within the document." },
    name: { type: "string", description: "Group name." },
    kind: {
      type: "string",
      description: "Group kind.",
      enum: ["visual", "subgraph"],
    },
    nodeIds: {
      type: "array",
      description: "Ids of the member nodes.",
      items: { type: "string" },
    },
    version: { type: "string", description: "Optional subgraph version lock." },
    enabled: { type: "boolean", description: "Group-level enable switch." },
    collapsed: { type: "boolean", description: "UI: render the group as a single collapsed node." },
  },
  required: ["id", "name", "kind", "nodeIds"],
};

const groupPatchSchema: ToolParameterProperty = {
  type: "object",
  description: "Partial group fields to merge into an existing group; the group id stays unchanged.",
  properties: {
    name: { type: "string" },
    kind: { type: "string", enum: ["visual", "subgraph"] },
    nodeIds: { type: "array", items: { type: "string" } },
    version: { type: "string" },
    enabled: { type: "boolean" },
    collapsed: { type: "boolean" },
  },
};

const nodeConfigSchema: ToolParameterProperty = {
  type: "object",
  description: "Replacement config object for the node; its shape depends on the node type.",
};

const documentSchema: ToolParameterProperty = {
  type: "object",
  description:
    "A complete NodeGraph document. Prefer incremental building (draft.create_from_version + node.add / edge.add) over emitting a whole document at once.",
  properties: {
    schemaVersion: {
      type: "number",
      description: "Document schema version: 1 (v1) or 2 (NG2-CORE v2).",
    },
    graphId: { type: "string", description: "Stable graph id." },
    name: { type: "string", description: "Graph name." },
    description: { type: "string", description: "Optional graph description." },
    mode: {
      type: "string",
      description: 'Always "native_graph".',
      enum: ["native_graph"],
    },
    nodes: { type: "array", description: "All nodes in the graph.", items: nodeSchema },
    edges: { type: "array", description: "All edges in the graph.", items: edgeSchema },
    groups: { type: "array", description: "Optional groups.", items: groupSchema },
    policies: { type: "object", description: "Graph-level execution policies." },
    permissions: { type: "object", description: "Optional permission manifest." },
    metadata: { type: "object", description: "Optional arbitrary metadata." },
  },
  required: ["schemaVersion", "graphId", "name", "mode", "nodes", "edges", "policies"],
};

const NODE_GRAPH_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "nodegraph.graph.create",
    description:
      "Create a brand-new NodeGraph and its first version (a real, persistent write). This only creates a new graph; it never modifies an existing graph. Changes to existing graphs must still go through nodegraph.patch.submit_proposal. The created graph is reversible (can be archived or deleted).",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Optional graph name." },
        document: documentSchema,
      },
      required: ["document"],
    },
    sideEffectLevel: "sandbox",
    allowedSlots: [],
 source: "builtin",
  },
  {
    name: "nodegraph.graph.get",
    description: "Read a NodeGraph definition and its current version.",
    parameters: {
      type: "object",
      properties: { graph_id: { type: "string" } },
      required: ["graph_id"],
    },
    sideEffectLevel: "none",
    allowedSlots: [],
   source: "builtin",
  },
  {
    name: "nodegraph.graph.list",
    description:
      "List all NodeGraph definitions in the current project (id, name, status, current version). Use this to discover which graphs exist before reading or editing one.",
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          description: "Optional status filter; omit to list all.",
          enum: ["active", "archived"],
        },
      },
    },
    sideEffectLevel: "none",
    allowedSlots: [],
    source: "builtin",
  },
  {
    name: "nodegraph.graph.find_by_name",
    description:
      "Find a NodeGraph's id by its name within the current project. Returns every match; graph_id is set only when exactly one graph matches. Matching prefers an exact name, then falls back to case-insensitive.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "The graph name to look up." },
        status: {
          type: "string",
          description: "Optional status filter; omit to search all.",
          enum: ["active", "archived"],
        },
      },
      required: ["name"],
   },
    sideEffectLevel: "none",
    allowedSlots: [],
    source: "builtin",
  },
  {
 name: "nodegraph.graph.list_versions",
    description: "List versions for a NodeGraph.",
    parameters: {
 type: "object",
      properties: { graph_id: { type: "string" } },
      required: ["graph_id"],
    },
    sideEffectLevel: "none",
    allowedSlots: [],
    source: "builtin",
  },
  {
    name: "nodegraph.node.get",
    description:
      "Read a single node from a NodeGraph's current live version. If the given id is a node group, this expands the group: it returns the group's interface plus the full details of every member node (drilling into a subgraph or expanding a visual cluster). Use nodegraph.graph.get first to see the group-level overview, then this to dive in.",
    parameters: {
      type: "object",
      properties: {
        graph_id: { type: "string" },
        node_id: {
          type: "string",
          description: "A node id, or a group id to expand all ofits member nodes.",
        },
      },
      required: ["graph_id", "node_id"],
    },
    sideEffectLevel: "none",
    allowedSlots: [],
    source: "builtin",
  },
  {
    name: "nodegraph.preset.get",
    description:
      "For a graph imported from a SillyTavern preset, read the original preset: an overview (preset name, sampling params, regex count) plus a prompt_order mapping table (each original prompt -> the group it now belongs to). Pass an identifier to get one prompt's full original body. Returns imported_from_preset=false for graphs not imported from a preset.",
    parameters: {
      type: "object",
      properties: {
        graph_id: { type: "string" },
        identifier: {
          type: "string",
          description:
            "Optional preset prompt identifier; when set, returns that single entry's full original content.",
        },
      },
      required: ["graph_id"],
    },
    sideEffectLevel: "none",
    allowedSlots: [],
    source: "builtin",
  },
  {
    name: "nodegraph.node_type.list",
    description: "List registered NodeGraph node types.",
    parameters: commonObjectSchema,
    sideEffectLevel: "none",
    allowedSlots: [],
    source: "builtin",
  },
  {
    name: "nodegraph.node_type.describe",
    description: "Describe a registered NodeGraph node type.",
    parameters: {
      type: "object",
      properties: {
        type: { type: "string" },
        type_version: { type: "string" },
      },
      required: ["type"],
    },
    sideEffectLevel: "none",
    allowedSlots: [],
    source: "builtin",
  },
  {
    name: "nodegraph.draft.create_from_version",
    description: "Create an in-memory, non-persistent NodeGraph draft from an existing version. Drafts are lost on restart and expire after a TTL; persist changes via nodegraph.patch.submit_proposal.",
    parameters: {
      type: "object",
      properties: {
        graph_id: { type: "string" },
        version_id: { type: "string" },
      },
      required: ["graph_id", "version_id"],
    },
    sideEffectLevel: "sandbox",
    allowedSlots: [],
    source: "builtin",
  },
  {
    name: "nodegraph.node.add",
    description: "Add a node to an in-memory NodeGraph draft.",
    parameters: {
      type: "object",
      properties: {
        draft_id: { type: "string" },
        node: nodeSchema,
      },
      required: ["draft_id", "node"],
    },
    sideEffectLevel: "sandbox",
    allowedSlots: [],
    source: "builtin",
  },
  {
    name: "nodegraph.node.update_config",
    description: "Update only the config object of a node in a NodeGraph draft.",
    parameters: {
      type: "object",
      properties: {
        draft_id: { type: "string" },
        node_id: { type: "string" },
        config: nodeConfigSchema,
      },
      required: ["draft_id", "node_id", "config"],
    },
    sideEffectLevel: "sandbox",
    allowedSlots: [],
    source: "builtin",
  },
  {
    name: "nodegraph.node.rename",
    description: "Rename a node in a NodeGraph draft without changing graph wiring.",
    parameters: {
      type: "object",
      properties: {
        draft_id: { type: "string" },
        node_id: { type: "string" },
        name: { type: "string" },
      },
      required: ["draft_id", "node_id", "name"],
    },
    sideEffectLevel: "sandbox",
    allowedSlots: [],
    source: "builtin",
  },
  {
    name: "nodegraph.node.delete",
    description: "Delete a node from a NodeGraph draft and remove connected edges.",
    parameters: {
      type: "object",
      properties: {
        draft_id: { type: "string" },
        node_id: { type: "string" },
      },
      required: ["draft_id", "node_id"],
    },
    sideEffectLevel: "sandbox",
    allowedSlots: [],
    source: "builtin",
  },
  {
    name: "nodegraph.edge.add",
    description: "Add an edge to a NodeGraph draft.",
    parameters: {
      type: "object",
      properties: {
        draft_id: { type: "string" },
        edge: edgeSchema,
      },
      required: ["draft_id", "edge"],
    },
    sideEffectLevel: "sandbox",
    allowedSlots: [],
    source: "builtin",
  },
  {
    name: "nodegraph.edge.delete",
    description: "Delete an edge from a NodeGraph draft.",
    parameters: {
      type: "object",
      properties: {
        draft_id: { type: "string" },
        edge_id: { type: "string" },
      },
      required: ["draft_id", "edge_id"],
    },
    sideEffectLevel: "sandbox",
    allowedSlots: [],
    source: "builtin",
  },
  {
    name: "nodegraph.group.create",
    description: "Create a visual or subgraph group in a NodeGraph draft.",
    parameters: {
      type: "object",
      properties: {
        draft_id: { type: "string" },
        group: groupSchema,
      },
      required: ["draft_id", "group"],
    },
    sideEffectLevel: "sandbox",
    allowedSlots: [],
    source: "builtin",
  },
  {
    name: "nodegraph.group.update",
    description: "Patch a group in a NodeGraph draft without applying it live.",
    parameters: {
      type: "object",
      properties: {
        draft_id: { type: "string" },
        group_id: { type: "string" },
        patch: groupPatchSchema,
      },
      required: ["draft_id", "group_id", "patch"],
    },
    sideEffectLevel: "sandbox",
    allowedSlots: [],
    source: "builtin",
  },
  {
    name: "nodegraph.patch.validate",
    description: "Validate a NodeGraph draft.",
    parameters: {
      type: "object",
      properties: { draft_id: { type: "string" } },
      required: ["draft_id"],
    },
    sideEffectLevel: "none",
    allowedSlots: [],
    source: "builtin",
  },
  {
    name: "nodegraph.patch.diff",
    description: "Create a review diff for a NodeGraph draft.",
    parameters: {
      type: "object",
      properties: { draft_id: { type: "string" } },
      required: ["draft_id"],
    },
    sideEffectLevel: "none",
    allowedSlots: [],
    source: "builtin",
  },
  {
    name: "nodegraph.patch.submit_proposal",
    description: "Submit a NodeGraph patch proposal payload without applying it live.",
    parameters: {
      type: "object",
      properties: {
        draft_id: { type: "string" },
        note: { type: "string" },
      },
      required: ["draft_id"],
    },
    sideEffectLevel: "sandbox",
    allowedSlots: [],
    source: "builtin",
  },
];

/** 图助手工具目录条目：工具名 + 其副作用级别，用于策略默认值推导。 */
export interface NodeGraphToolCatalogEntry {
  name: string;
  sideEffectLevel: ToolSideEffectLevel;
}

/**
 * 图助手可见的 NodeGraph 工具目录（名称 + sideEffectLevel）。
 *
 * 直接从工具定义派生，避免与 `GraphAssistantToolPolicyService` 的默认值推导脱节。
 */
export const NODE_GRAPH_TOOL_CATALOG: NodeGraphToolCatalogEntry[] = NODE_GRAPH_TOOL_DEFINITIONS.map(
  (tool) => ({
    name: tool.name,
    sideEffectLevel: tool.sideEffectLevel ?? "none",
  }),
);

