import {
  compileNodeGraph,
  createDefaultNodeTypeRegistry,
  type ToolCallResult,
  type ToolDefinition,
  type ToolExecutionContext,
  type ToolProvider,
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
        case "nodegraph.graph.get":
          return { data: this.getGraph(args) };
        case "nodegraph.graph.list_versions":
          return { data: this.listVersions(args) };
        case "nodegraph.node_type.list":
          return { data: createDefaultNodeTypeRegistry().list() };
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
    return { definition, current_version: currentVersion };
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
    return createDefaultNodeTypeRegistry().get(type, typeVersion);
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

const commonObjectSchema = {
  type: "object" as const,
  properties: {},
};

const NODE_GRAPH_TOOL_DEFINITIONS: ToolDefinition[] = [
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
        node: { type: "object" },
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
        config: { type: "object" },
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
        edge: { type: "object" },
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
        group: { type: "object" },
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
        patch: { type: "object" },
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
