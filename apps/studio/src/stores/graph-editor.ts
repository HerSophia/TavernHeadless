/**
 * Graph 编辑器 store（B10 阶段 6）。
 *
 * 单一事实源：持有一份**可编辑的工作文档**（`document`），承载增删节点 / 连线 / 改 config /
 * 坐标持久化，并负责版本读取 / 切换 / 另存为新版本。坐标（手动拖动与自动布局结果）写回
 * `node.ui.position` 进入文档，随版本保存持久化。
 *
 * 校验与保存门槛复用 `@tavern/core/node-graph`（与后端同源）：仅当无 `error` 级诊断
 * （`isExecutable`）才允许保存为版本——这与后端 `assertExecutable` 一致，无法绕过。
 * 校验失败时给出阻断提示，但工作文档作为**本地草稿**保留（可选持久化到 localStorage），
 * 修复后再保存，满足「阻断但不丢草稿」。
 */
import {
  createDefaultNodeTypeRegistry,
  type NodeGraphDocument,
  type NodeGraphEdge,
  type NodeGraphEdgeKind,
  type NodeGraphNode,
  type NodeGraphPhase,
  type NodeTypeRegistryEntry,
} from "@tavern/core/node-graph";
import { defineStore } from "pinia";
import { computed, ref } from "vue";

import {
  nodeGraphApi,
  NodeGraphApiError,
  type NodeGraphVersionResponse,
} from "../lib/nodegraph-api";
import { SAMPLE_NODE_GRAPH_DOCUMENT } from "../modules/graph/canvas/sample-document";
import {
  EMPTY_LOCAL_VALIDATION,
  validateGraphDocument,
} from "../modules/graph/validate/local-validation";

/** 列布局相邻列水平间距（新增节点在已布局图中的落点）。 */
const NEW_NODE_COLUMN_GAP = 280;

const registry = createDefaultNodeTypeRegistry();

/**
 * 深拷贝文档，确保工作副本与源版本（缓存 / 草稿）互不影响。
 * 用 JSON 往返：NodeGraphDocument 为纯 JSON 数据，且可安全克隆 Vue 响应式代理
 * （`structuredClone` 无法克隆 Proxy）。
 */
export function cloneGraphDocument(document: NodeGraphDocument): NodeGraphDocument {
  return JSON.parse(JSON.stringify(document)) as NodeGraphDocument;
}

function shortTypeToken(type: string): string {
  const tail = type.split(".").pop() ?? type;
  return tail.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase() || "node";
}

/** 生成在文档内唯一的节点 id（`n_<type 短码>_<序号>`）。 */
export function generateNodeId(document: NodeGraphDocument, type: string): string {
  const existing = new Set(document.nodes.map((node) => node.id));
  const base = `n_${shortTypeToken(type)}`;
  let index = 1;
  let candidate = `${base}_${index}`;
  while (existing.has(candidate)) {
    index += 1;
    candidate = `${base}_${index}`;
  }
  return candidate;
}

/** 生成在文档内唯一的边 id。 */
export function generateEdgeId(document: NodeGraphDocument): string {
  const existing = new Set(document.edges.map((edge) => edge.id));
  let index = document.edges.length + 1;
  let candidate = `e_${index}`;
  while (existing.has(candidate)) {
    index += 1;
    candidate = `e_${index}`;
  }
  return candidate;
}

/** 已布局图中新增节点的默认落点：最右列再右移一列（无任何坐标时返回 null，交回退布局）。 */
function nextNodePosition(document: NodeGraphDocument): { x: number; y: number } | null {
  const positioned = document.nodes
    .map((node) => node.ui?.position)
    .filter((position): position is { x: number; y: number } => Boolean(position));
  if (positioned.length === 0) {
    return null;
  }
  const maxX = Math.max(...positioned.map((position) => position.x));
  return { x: maxX + NEW_NODE_COLUMN_GAP, y: 0 };
}

export const useGraphEditorStore = defineStore("graph-editor", () => {
  /** 服务端图定义 id；null = 未保存（示例图或全新草稿）。 */
  const graphId = ref<string | null>(null);
  const graphName = ref<string>("");
  const isSample = ref<boolean>(false);
  const document = ref<NodeGraphDocument | null>(null);
  /** 工作文档所基于的版本 id（保存时作为 parent_version_id；草稿匹配亦用之）。 */
  const baseVersionId = ref<string | null>(null);
  /** 服务端当前版本 id（用于版本选择器高亮「当前」）。 */
  const serverCurrentVersionId = ref<string | null>(null);
  const versions = ref<NodeGraphVersionResponse[]>([]);
  const dirty = ref<boolean>(false);
  const loading = ref<boolean>(false);
  const saving = ref<boolean>(false);
  const error = ref<string | null>(null);
  const selectedNodeId = ref<string | null>(null);
  const selectedEdgeId = ref<string | null>(null);
  const draftRestored = ref<boolean>(false);
  /** 每次 load / 切换版本自增，供画布以 `:key` 重挂载（干净渲染并 fitView）。 */
  const loadToken = ref<number>(0);

  const validation = computed(() =>
    document.value ? validateGraphDocument(document.value) : EMPTY_LOCAL_VALIDATION,
  );
  const diagnostics = computed(() => validation.value.diagnostics);
  const isExecutable = computed(() => validation.value.isExecutable);
  const errorCount = computed(() => validation.value.counts.error);
  const warningCount = computed(() => validation.value.counts.warning);

  const nodeCount = computed(() => document.value?.nodes.length ?? 0);
  const edgeCount = computed(() => document.value?.edges.length ?? 0);
  const groupCount = computed(() => document.value?.groups?.length ?? 0);

  const selectedNode = computed<NodeGraphNode | null>(
    () => document.value?.nodes.find((node) => node.id === selectedNodeId.value) ?? null,
  );
  const selectedEdge = computed<NodeGraphEdge | null>(
    () => document.value?.edges.find((edge) => edge.id === selectedEdgeId.value) ?? null,
  );
  const selectedNodeEntry = computed<NodeTypeRegistryEntry | undefined>(() =>
    selectedNode.value ? registry.find(selectedNode.value.type, selectedNode.value.typeVersion) : undefined,
  );

  /** 可新增的内置节点类型（按 type / version 排序）。 */
  const availableNodeTypes = computed(() => registry.list());

  /** 仅当无 error、有改动、非保存中才允许保存为版本（项目上下文在调用时校验）。 */
  const canSaveVersion = computed(
    () => Boolean(document.value) && dirty.value && isExecutable.value && !saving.value,
  );

  // —— 本地草稿（localStorage，浏览器环境才启用；测试 / SSR 环境静默跳过）——

  function draftStorageKey(): string {
    return `studio:graph-draft:${graphId.value ?? "sample"}`;
  }

  function persistDraft(): void {
    if (typeof localStorage === "undefined" || !document.value) {
      return;
    }
    try {
      localStorage.setItem(
        draftStorageKey(),
        JSON.stringify({ baseVersionId: baseVersionId.value, document: document.value }),
      );
    } catch {
      // 配额 / 隐私模式失败：草稿持久化非关键能力，静默降级。
    }
  }

  function clearDraft(): void {
    if (typeof localStorage === "undefined") {
      return;
    }
    try {
      localStorage.removeItem(draftStorageKey());
    } catch {
      // ignore
    }
  }

  function maybeRestoreDraft(): void {
    if (typeof localStorage === "undefined") {
      return;
    }
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(draftStorageKey());
    } catch {
      raw = null;
    }
    if (!raw) {
      return;
    }
    try {
      const parsed = JSON.parse(raw) as { baseVersionId: string | null; document: NodeGraphDocument };
      // 仅当草稿基于当前同一版本时恢复，避免覆盖已演进的服务端版本。
      if (parsed.baseVersionId === baseVersionId.value && parsed.document) {
        document.value = parsed.document;
        dirty.value = true;
        draftRestored.value = true;
      }
    } catch {
      // 损坏草稿：忽略。
    }
  }

  /** 标记改动并持久化草稿（所有编辑动作统一出口）。 */
  function markDirty(): void {
    dirty.value = true;
    persistDraft();
  }

  // —— 加载 / 版本 ——

  function loadSample(): void {
    document.value = cloneGraphDocument(SAMPLE_NODE_GRAPH_DOCUMENT);
    graphId.value = null;
    graphName.value = SAMPLE_NODE_GRAPH_DOCUMENT.name;
    isSample.value = true;
    baseVersionId.value = null;
    serverCurrentVersionId.value = null;
    versions.value = [];
    dirty.value = false;
    error.value = null;
    selectedNodeId.value = null;
    selectedEdgeId.value = null;
    draftRestored.value = false;
    loadToken.value += 1;
  }

  async function loadGraph(projectId: string, id: string): Promise<void> {
    loading.value = true;
    error.value = null;
    selectedNodeId.value = null;
    selectedEdgeId.value = null;
    draftRestored.value = false;
    try {
      const result = await nodeGraphApi.get(projectId, id);
      graphId.value = result.definition.id;
      graphName.value = result.definition.name;
      isSample.value = false;
      serverCurrentVersionId.value = result.definition.current_version_id;
      if (!result.current_version) {
        document.value = null;
        baseVersionId.value = null;
        versions.value = [];
        return;
      }
      baseVersionId.value = result.current_version.id;
      document.value = cloneGraphDocument(result.current_version.document);
      dirty.value = false;
      loadToken.value += 1;
      try {
        versions.value = (await nodeGraphApi.listVersions(projectId, id)).items;
      } catch {
        versions.value = [];
      }
      maybeRestoreDraft();
    } catch (cause) {
      document.value = null;
      error.value = describeError(cause);
    } finally {
      loading.value = false;
    }
  }

  /** 读取 / 切换到某个版本（载入编辑器；不改服务端当前版本）。 */
  function loadVersion(versionId: string): void {
    const version = versions.value.find((candidate) => candidate.id === versionId);
    if (!version) {
      return;
    }
    document.value = cloneGraphDocument(version.document);
    baseVersionId.value = version.id;
    dirty.value = false;
    draftRestored.value = false;
    selectedNodeId.value = null;
    selectedEdgeId.value = null;
    error.value = null;
    loadToken.value += 1;
  }

  /** 将某版本设为服务端当前版本（治理动作，需 project.nodegraph.manage）。 */
  async function setAsCurrentVersion(projectId: string, versionId: string): Promise<boolean> {
    if (!graphId.value) {
      return false;
    }
    saving.value = true;
    error.value = null;
    try {
      const result = await nodeGraphApi.setCurrentVersion(projectId, graphId.value, versionId);
      serverCurrentVersionId.value = result.definition.current_version_id;
      return true;
    } catch (cause) {
      error.value = describeError(cause);
      return false;
    } finally {
      saving.value = false;
    }
  }

  /** 丢弃本地草稿，回到所基于版本的原始文档。 */
  function discardDraft(): void {
    clearDraft();
    draftRestored.value = false;
    if (baseVersionId.value) {
      const version = versions.value.find((candidate) => candidate.id === baseVersionId.value);
      if (version) {
        document.value = cloneGraphDocument(version.document);
        dirty.value = false;
        selectedNodeId.value = null;
        selectedEdgeId.value = null;
        loadToken.value += 1;
        return;
      }
    }
    if (isSample.value) {
      loadSample();
    }
  }

  /** 另存为新版本（无 graphId 则新建图）。校验失败（有 error）直接阻断并提示。 */
  async function saveAsNewVersion(projectId: string): Promise<boolean> {
    if (!document.value) {
      return false;
    }
    if (!isExecutable.value) {
      error.value = "blocked_by_diagnostics";
      return false;
    }
    saving.value = true;
    error.value = null;
    try {
      if (graphId.value === null) {
        // 新建图：清空文档内 graphId，交由后端分配，避免示例图 id 冲突。
        const payload = { ...cloneGraphDocument(document.value), graphId: "" };
        const result = await nodeGraphApi.create(projectId, payload, graphName.value || null);
        graphId.value = result.definition.id;
        graphName.value = result.definition.name;
        isSample.value = false;
        serverCurrentVersionId.value = result.definition.current_version_id;
        baseVersionId.value = result.version.id;
        document.value = cloneGraphDocument(result.version.document);
      } else {
        const result = await nodeGraphApi.createVersion(
          projectId,
          graphId.value,
          document.value,
          baseVersionId.value,
        );
        serverCurrentVersionId.value = result.definition.current_version_id;
        baseVersionId.value = result.version.id;
        document.value = cloneGraphDocument(result.version.document);
      }
      dirty.value = false;
      draftRestored.value = false;
      clearDraft();
      try {
        versions.value = (await nodeGraphApi.listVersions(projectId, graphId.value)).items;
      } catch {
        // 列表刷新失败不影响保存成功。
      }
      return true;
    } catch (cause) {
      error.value = describeError(cause);
      return false;
    } finally {
      saving.value = false;
    }
  }

  // —— 编辑动作（就地变更 + markDirty）——

  function renameGraph(name: string): void {
    graphName.value = name;
    if (document.value) {
      document.value.name = name;
      markDirty();
    }
  }

  function addNode(type: string, typeVersion = "1"): NodeGraphNode | null {
    const doc = document.value;
    if (!doc) {
      return null;
    }
    const entry = registry.find(type, typeVersion);
    const phase: NodeGraphPhase = entry?.supportedPhases[0] ?? "pre_response";
    const node: NodeGraphNode = {
      id: generateNodeId(doc, type),
      type,
      typeVersion,
      phase,
    };
    const position = nextNodePosition(doc);
    if (position) {
      node.ui = { position };
    }
    doc.nodes.push(node);
    selectedNodeId.value = node.id;
    selectedEdgeId.value = null;
    markDirty();
    return node;
  }

  function removeNode(nodeId: string): void {
    const doc = document.value;
    if (!doc) {
      return;
    }
    doc.nodes = doc.nodes.filter((node) => node.id !== nodeId);
    doc.edges = doc.edges.filter(
      (edge) => edge.from.nodeId !== nodeId && edge.to.nodeId !== nodeId,
    );
    if (doc.groups) {
      for (const group of doc.groups) {
        group.nodeIds = group.nodeIds.filter((id) => id !== nodeId);
      }
    }
    if (selectedNodeId.value === nodeId) {
      selectedNodeId.value = null;
    }
    markDirty();
  }

  function updateNode(nodeId: string, patch: Partial<Omit<NodeGraphNode, "id">>): void {
    const doc = document.value;
    if (!doc) {
      return;
    }
    const node = doc.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) {
      return;
    }
    Object.assign(node, patch);
    markDirty();
  }

  function updateNodeConfig(nodeId: string, config: unknown): void {
    updateNode(nodeId, { config });
  }

  function updateNodePosition(nodeId: string, position: { x: number; y: number }): void {
    const doc = document.value;
    if (!doc) {
      return;
    }
    const node = doc.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) {
      return;
    }
    node.ui = { ...node.ui, position };
    markDirty();
  }

  /** 批量写回坐标（自动布局结果持久化进文档）。 */
  function applyNodePositions(positions: Record<string, { x: number; y: number }>): void {
    const doc = document.value;
    if (!doc) {
      return;
    }
    let changed = false;
    for (const node of doc.nodes) {
      const position = positions[node.id];
      if (position) {
        node.ui = { ...node.ui, position };
        changed = true;
      }
    }
    if (changed) {
      markDirty();
    }
  }

  function addEdge(
    from: { nodeId: string; port: string },
    to: { nodeId: string; port: string },
    kind: NodeGraphEdgeKind = "data",
  ): NodeGraphEdge | null {
    const doc = document.value;
    if (!doc) {
      return null;
    }
    // 去重：同源同目标同端口的边只保留一条。
    const duplicate = doc.edges.some(
      (edge) =>
        edge.from.nodeId === from.nodeId &&
        edge.from.port === from.port &&
        edge.to.nodeId === to.nodeId &&
        edge.to.port === to.port,
    );
    if (duplicate) {
      return null;
    }
    const edge: NodeGraphEdge = { id: generateEdgeId(doc), from, to };
    if (kind === "control") {
      edge.kind = "control";
    }
    doc.edges.push(edge);
    markDirty();
    return edge;
  }

  function removeEdge(edgeId: string): void {
    const doc = document.value;
    if (!doc) {
      return;
    }
    doc.edges = doc.edges.filter((edge) => edge.id !== edgeId);
    if (selectedEdgeId.value === edgeId) {
      selectedEdgeId.value = null;
    }
    markDirty();
  }

  function selectNode(nodeId: string | null): void {
    selectedNodeId.value = nodeId;
    if (nodeId) {
      selectedEdgeId.value = null;
    }
  }

  function selectEdge(edgeId: string | null): void {
    selectedEdgeId.value = edgeId;
    if (edgeId) {
      selectedNodeId.value = null;
    }
  }

  function clearSelection(): void {
    selectedNodeId.value = null;
    selectedEdgeId.value = null;
  }

  return {
    // state
    graphId,
    graphName,
    isSample,
    document,
    baseVersionId,
    serverCurrentVersionId,
    versions,
    dirty,
    loading,
    saving,
    error,
    selectedNodeId,
    selectedEdgeId,
    draftRestored,
    loadToken,
    // derived
    validation,
    diagnostics,
    isExecutable,
    errorCount,
    warningCount,
    nodeCount,
    edgeCount,
    groupCount,
    selectedNode,
    selectedEdge,
    selectedNodeEntry,
    availableNodeTypes,
    canSaveVersion,
    // actions
    loadSample,
    loadGraph,
    loadVersion,
    setAsCurrentVersion,
    discardDraft,
    saveAsNewVersion,
    renameGraph,
    addNode,
    removeNode,
    updateNode,
    updateNodeConfig,
    updateNodePosition,
    applyNodePositions,
    addEdge,
    removeEdge,
    selectNode,
    selectEdge,
    clearSelection,
  };
});

function describeError(cause: unknown): string {
  if (cause instanceof NodeGraphApiError) {
    const detail = cause.detail;
    if (detail && typeof detail === "object" && "message" in detail) {
      const message = (detail as { message?: unknown }).message;
      if (typeof message === "string" && message.length > 0) {
        return message;
      }
    }
    return cause.message;
  }
  return cause instanceof Error ? cause.message : String(cause);
}
