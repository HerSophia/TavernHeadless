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
  buildCompatPromptFloorTemplate,
  buildNativePromptFloorTemplate,
  createDefaultNodeTypeRegistry,
  describeNodeTypeKnowledge,
  deriveSubgraphInterface,
  listNodeTypeKnowledge,
  nodeGraphControlOutputPorts,
  nodeGraphDocumentSchemaVersion,
  NODE_GRAPH_GROUP_NODE_TYPE,
  NODE_GRAPH_SCHEMA_VERSION_V2,
  type NodeGraphBudgetOverrides,
  type NodeGraphDocument,
  type NodeGraphEdge,
  type NodeGraphEdgeKind,
  type NodeGraphGroup,
  type NodeGraphNode,
  type NodeGraphNodeTypeKnowledgeDetail,
  type NodeGraphPermissionManifest,
  type NodeGraphPolicies,
  type NodeGraphNodeTypeKnowledgeListItem,
  type NodeGraphPhase,
  type NodeTypeRegistryEntry,
} from "@tavern/core/node-graph";
import { defineStore } from "pinia";
import { computed, ref } from "vue";

import {
  nodeGraphApi,
  NodeGraphApiError,
  type FloorGraphBindingKind,
  type FloorGraphBindingResponse,
  type NodeGraphVersionResponse,
} from "../lib/nodegraph-api";
import { SAMPLE_NODE_GRAPH_DOCUMENT } from "../modules/graph/canvas/sample-document";
import { buildGraphSettingsDiagnostics } from "../modules/graph/settings/graph-settings-view";
import { extractSubgraph } from "../modules/graph/subgraph/extract-subgraph";
import {
  EMPTY_LOCAL_VALIDATION,
  validateGraphDocument,
  withDiagnosticSource,
  type SourcedNodeGraphDiagnostic,
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

/** 深拷贝单个节点（复制粘贴用）。 */
export function cloneGraphNode(node: NodeGraphNode): NodeGraphNode {
  return JSON.parse(JSON.stringify(node)) as NodeGraphNode;
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

function isControlNodeType(type: string): boolean {
  return nodeGraphControlOutputPorts(type).length > 0 || type === "control.condition";
}

function defaultConfigForNodeType(type: string, typeVersion = "1"): unknown {
  const detail = describeNodeTypeKnowledge(type, typeVersion, registry);
  const defaultConfig = detail?.config?.defaultConfig;
  return defaultConfig === undefined ? undefined : JSON.parse(JSON.stringify(defaultConfig));
}

function ensureSchemaVersion2(document: NodeGraphDocument): boolean {
  if (nodeGraphDocumentSchemaVersion(document) >= NODE_GRAPH_SCHEMA_VERSION_V2) {
    return false;
  }
  document.schemaVersion = NODE_GRAPH_SCHEMA_VERSION_V2;
  for (const edge of document.edges) {
    if (edge.kind === undefined) {
      edge.kind = "data";
    }
  }
  return true;
}

function inferEdgeKind(
  document: NodeGraphDocument,
  from: { nodeId: string; port: string },
  explicitKind?: NodeGraphEdgeKind,
): NodeGraphEdgeKind {
  if (explicitKind) {
    return explicitKind;
  }
  const source = document.nodes.find((node) => node.id === from.nodeId);
  return source && nodeGraphControlOutputPorts(source.type).includes(from.port) ? "control" : "data";
}

export const useGraphEditorStore = defineStore("graph-editor", () => {
  /** 服务端图定义 id；null = 未保存（示例图或全新草稿）。 */
  const graphId = ref<string | null>(null);
  const graphName = ref<string>("");
  const isSample = ref<boolean>(false);
  /**
   * DG11 / CG11-2：当前工作文档来自哪种「默认楼层模板」（可 fork 的同结构副本，未保存即新建图）。
   * `null` = 非模板。`native` = native 默认楼层模板（DG11）；`compat` = compat 默认楼层模板（CG11-2）。
   */
  const templateKind = ref<"native" | "compat" | null>(null);
  const document = ref<NodeGraphDocument | null>(null);
  /** 工作文档所基于的版本 id（保存时作为 parent_version_id；草稿匹配亦用之）。 */
  const baseVersionId = ref<string | null>(null);
  /** 服务端当前版本 id（用于版本选择器高亮「当前」）。 */
  const serverCurrentVersionId = ref<string | null>(null);
  const versions = ref<NodeGraphVersionResponse[]>([]);
  const floorGraphBindings = ref<FloorGraphBindingResponse[]>([]);
  const floorGraphBindingLoading = ref<boolean>(false);
  const floorGraphBindingSaving = ref<boolean>(false);
  const dirty = ref<boolean>(false);
  const loading = ref<boolean>(false);
  const saving = ref<boolean>(false);
  const serverValidating = ref<boolean>(false);
  const serverDiagnostics = ref<SourcedNodeGraphDiagnostic[]>([]);
  const serverValidationCheckedAt = ref<number | null>(null);
  const error = ref<string | null>(null);
  const selectedNodeId = ref<string | null>(null);
  const selectedEdgeId = ref<string | null>(null);
  /** 选中的节点组 id（点击折叠节点组）；null = 未选中组。供右侧检视器展示输出通道开关。 */
  const selectedGroupId = ref<string | null>(null);
  /** 钻入（drill-in）的当前分组 id；null = 根图。 */
  const activeGroupId = ref<string | null>(null);
  const draftRestored = ref<boolean>(false);
  /** 每次 load / 切换版本自增，供画布以 `:key` 重挂载（干净渲染并 fitView）。 */
  const loadToken = ref<number>(0);

  // —— 撤销重做栈（NG2-6）：每次原子写操作前把当前文档深拷贝入 undo 栈。——
  /** 撤销/重做栈上限，防止长时间编辑导致内存膨胀。 */
  const HISTORY_LIMIT = 100;
  const undoStack = ref<NodeGraphDocument[]>([]);
  const redoStack = ref<NodeGraphDocument[]>([]);
  const canUndo = computed(() => undoStack.value.length > 0);
  const canRedo = computed(() => redoStack.value.length > 0);

  /** 兼容保留：是否处于任一「默认楼层模板」态（fork 起点）。 */
  const isTemplate = computed(() => templateKind.value !== null);

  const validation = computed(() =>
    document.value ? validateGraphDocument(document.value) : EMPTY_LOCAL_VALIDATION,
  );
  const settingsDiagnostics = computed<SourcedNodeGraphDiagnostic[]>(() =>
    document.value ? withDiagnosticSource(buildGraphSettingsDiagnostics(document.value), "local") : [],
  );
  const diagnostics = computed<SourcedNodeGraphDiagnostic[]>(() => [
    ...validation.value.diagnostics,
    ...settingsDiagnostics.value,
    ...serverDiagnostics.value,
  ]);
  const errorCount = computed(() => diagnostics.value.filter((diagnostic) => diagnostic.severity === "error").length);
  const warningCount = computed(() => diagnostics.value.filter((diagnostic) => diagnostic.severity === "warning").length);
  const isExecutable = computed(() => errorCount.value === 0);

  const nodeCount = computed(() => document.value?.nodes.length ?? 0);
  const edgeCount = computed(() => document.value?.edges.length ?? 0);
  const groupCount = computed(() => document.value?.groups?.length ?? 0);
  const documentMetadata = computed(() => document.value?.metadata ?? null);
  const isImportedSillyTavernPreset = computed(
    () => documentMetadata.value?.importedFrom === "sillytavern_openai_preset",
  );
  const isCompatFloorImportDraft = computed(
    () => isImportedSillyTavernPreset.value && documentMetadata.value?.importPurpose === "compat_floor_graph",
  );

  /** 当前钻入的分组（id 失效或不存在时为 null）。 */
  const activeGroup = computed(
    () => document.value?.groups?.find((group) => group.id === activeGroupId.value) ?? null,
  );

  const selectedNode = computed<NodeGraphNode | null>(
    () => document.value?.nodes.find((node) => node.id === selectedNodeId.value) ?? null,
  );
  const selectedEdge = computed<NodeGraphEdge | null>(
    () => document.value?.edges.find((edge) => edge.id === selectedEdgeId.value) ?? null,
  );
  const selectedNodeEntry = computed<NodeTypeRegistryEntry | undefined>(() =>
    selectedNode.value ? registry.find(selectedNode.value.type, selectedNode.value.typeVersion) : undefined,
  );
  const selectedNodeKnowledge = computed<NodeGraphNodeTypeKnowledgeDetail | undefined>(() =>
    selectedNode.value ? describeNodeTypeKnowledge(selectedNode.value.type, selectedNode.value.typeVersion, registry) : undefined,
  );
  /** 当前选中的节点组（id 失效或不存在时为 null）。 */
  const selectedGroup = computed(
    () => document.value?.groups?.find((group) => group.id === selectedGroupId.value) ?? null,
  );

  /** 可新增的内置节点类型（按 type / version 排序）。 */
  const availableNodeTypes = computed<NodeGraphNodeTypeKnowledgeListItem[]>(() => listNodeTypeKnowledge(registry));

  /** 仅当无 error、有改动、非保存中才允许保存为版本（项目上下文在调用时校验）。 */
  const canSaveVersion = computed(
    () => Boolean(document.value) && dirty.value && isExecutable.value && !saving.value,
  );
  const canBindCurrentVersionAsFloorGraph = computed(
    () => Boolean(graphId.value && baseVersionId.value && !isSample.value && !floorGraphBindingSaving.value),
  );

  function getFloorGraphBinding(kind: FloorGraphBindingKind): FloorGraphBindingResponse | null {
    return floorGraphBindings.value.find((binding) => binding.kind === kind) ?? null;
  }

  function isCurrentGraphBoundAs(kind: FloorGraphBindingKind): boolean {
    const binding = getFloorGraphBinding(kind);
    return Boolean(binding && graphId.value && binding.graph_id === graphId.value);
  }

  function isCurrentVersionBoundAs(kind: FloorGraphBindingKind): boolean {
    const binding = getFloorGraphBinding(kind);
    return Boolean(
      binding
        && graphId.value
        && baseVersionId.value
        && binding.graph_id === graphId.value
        && binding.graph_version_id === baseVersionId.value,
    );
  }

  function hasCurrentGraphFloorBindingVersionMismatch(kind: FloorGraphBindingKind): boolean {
    const binding = getFloorGraphBinding(kind);
    return Boolean(
      binding
        && graphId.value
        && baseVersionId.value
        && binding.graph_id === graphId.value
        && binding.graph_version_id !== baseVersionId.value,
    );
  }

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
        setDocument(parsed.document, { clearServerValidation: false });
        dirty.value = true;
        draftRestored.value = true;
      }
    } catch {
      // 损坏草稿：忽略。
    }
  }

  /** 清除上一轮手动服务端校验结果。 */
  function clearServerValidation(): void {
    serverDiagnostics.value = [];
    serverValidationCheckedAt.value = null;
  }

  function setDocument(next: NodeGraphDocument | null, options?: { clearServerValidation?: boolean }): void {
    document.value = next;
    if (options?.clearServerValidation !== false) {
      clearServerValidation();
    }
  }

  /** 标记改动并持久化草稿（所有编辑动作统一出口）。 */
  function markDirty(): void {
    dirty.value = true;
    clearServerValidation();
    persistDraft();
  }

  // —— 撤销重做（NG2-6）——

  /** 清空撤销/重做栈（加载 / 切换版本 / 保存后调用，不跨图保留历史）。 */
  function resetHistory(): void {
    undoStack.value = [];
    redoStack.value = [];
  }

  /**
   * 每次原子写操作前调用：把当前 `document` 深拷贝入 undo 栈并清空 redo 栈。
   * 无文档时不入栈；超上限时从栈底截断。
   */
  function pushHistory(): void {
    if (!document.value) {
      return;
    }
    undoStack.value.push(cloneGraphDocument(document.value));
    if (undoStack.value.length > HISTORY_LIMIT) {
      undoStack.value.splice(0, undoStack.value.length - HISTORY_LIMIT);
    }
    redoStack.value = [];
  }

  /** 撤销：弹出 undo 栈顶恢复，并把当前态压入 redo 栈。 */
  function undo(): void {
    const previous = undoStack.value.pop();
    if (!previous || !document.value) {
      return;
     }
    redoStack.value.push(cloneGraphDocument(document.value));
    document.value = previous;
    clearSelection();
    clearServerValidation();
    dirty.value = true;
    persistDraft();
    loadToken.value += 1;
  }

  /** 重做：弹出 redo 栈顶恢复，并把当前态压回 undo 栈。 */
  function redo(): void {
    const next = redoStack.value.pop();
    if (!next || !document.value) {
      return;
    }
    undoStack.value.push(cloneGraphDocument(document.value));
    document.value = next;
    clearSelection();
    clearServerValidation();
    dirty.value = true;
    persistDraft();
    loadToken.value += 1;
  }

  // —— 加载 / 版本 ——

  function loadSample(): void {
    setDocument(cloneGraphDocument(SAMPLE_NODE_GRAPH_DOCUMENT));
    graphId.value = null;
    graphName.value = SAMPLE_NODE_GRAPH_DOCUMENT.name;
    isSample.value = true;
    templateKind.value = null;
    baseVersionId.value = null;
    serverCurrentVersionId.value = null;
    versions.value = [];
    dirty.value = false;
    error.value = null;
    selectedNodeId.value = null;
    selectedEdgeId.value = null;
    activeGroupId.value = null;
    draftRestored.value = false;
    resetHistory();
    loadToken.value += 1;
  }

  /**
   * DG11 / CG11-2：载入「默认楼层运行模板」为**全新可保存草稿**（fork 起点）。
   *
   * 模板是对应 system graph 的同结构、可 fork 副本（`@tavern/core` 单一事实源）：
   * `native` = `system.native_prompt`（DG11）；`compat` = `system.compat_prompt`（CG11-2，零 Agentic）。
   * 载入即标记 dirty（选定项目后点保存即新建一张普通可编辑图——「零配置可用」），系统图本身不受影响。
   * `name` 可由调用方传入本地化显示名（缺省用模板内置英文名）。
   */
  function loadTemplate(kind: "native" | "compat" = "native", name?: string): void {
    const source = kind === "compat" ? buildCompatPromptFloorTemplate() : buildNativePromptFloorTemplate();
    const next = cloneGraphDocument(source);
    if (name && name.trim().length > 0) {
      next.name = name.trim();
    }
    setDocument(next);
    graphId.value = null;
    graphName.value = next.name;
    isSample.value = false;
    templateKind.value = kind;
    baseVersionId.value = null;
    serverCurrentVersionId.value = null;
    versions.value = [];
    error.value = null;
    selectedNodeId.value = null;
    selectedEdgeId.value = null;
    selectedGroupId.value = null;
    activeGroupId.value = null;
    draftRestored.value = false;
    dirty.value = true;
    resetHistory();
    loadToken.value += 1;
  }

  /**
   * 载入一份外部导入的文档（如酒馆预设转换结果）为**全新未保存草稿**：
   * 无 graphId（保存时走新建），标记 dirty 以便选定项目后可另存为版本。
   */
  function importPreset(
    doc: NodeGraphDocument,
    name?: string,
    target?: { graphId: string; baseVersionId: string | null },
  ): void {
    const next = cloneGraphDocument(doc);
    if (name && name.trim().length > 0) {
      next.name = name.trim();
    }
    setDocument(next);
    graphId.value = target?.graphId ?? null;
    graphName.value = next.name;
   isSample.value = false;
    templateKind.value = null;
    baseVersionId.value = target?.baseVersionId ?? null;
    serverCurrentVersionId.value = target?.baseVersionId ?? null;
    versions.value = [];
    error.value = null;
    selectedNodeId.value = null;
    selectedEdgeId.value = null;
    activeGroupId.value = null;
    draftRestored.value = false;
    dirty.value = true;
    resetHistory();
    loadToken.value += 1;
  }

  async function loadGraph(projectId: string, id: string): Promise<void> {
    loading.value = true;
    error.value = null;
    selectedNodeId.value = null;
    selectedEdgeId.value = null;
    activeGroupId.value = null;
    draftRestored.value = false;
    try {
      const result = await nodeGraphApi.get(projectId, id);
      graphId.value = result.definition.id;
      graphName.value = result.definition.name;
      isSample.value = false;
      templateKind.value = null;
      serverCurrentVersionId.value = result.definition.current_version_id;
      if (!result.current_version) {
        setDocument(null);
        baseVersionId.value = null;
        versions.value = [];
        return;
      }
      baseVersionId.value = result.current_version.id;
      setDocument(cloneGraphDocument(result.current_version.document));
      dirty.value = false;
      resetHistory();
      loadToken.value += 1;
      try {
        versions.value = (await nodeGraphApi.listVersions(projectId, id)).items;
      } catch {
        versions.value = [];
      }
      maybeRestoreDraft();
    } catch (cause) {
      setDocument(null);
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
    setDocument(cloneGraphDocument(version.document));
    baseVersionId.value = version.id;
    dirty.value = false;
    draftRestored.value = false;
    selectedNodeId.value = null;
    selectedEdgeId.value = null;
    activeGroupId.value = null;
    error.value = null;
    resetHistory();
    loadToken.value += 1;
  }

  async function loadFloorGraphBindings(projectId: string): Promise<void> {
    floorGraphBindingLoading.value = true;
    error.value = null;
    try {
      floorGraphBindings.value = (await nodeGraphApi.listFloorGraphBindings(projectId)).items;
    } catch (cause) {
      floorGraphBindings.value = [];
      error.value = describeError(cause);
    } finally {
      floorGraphBindingLoading.value = false;
    }
  }

  async function setCurrentGraphAsFloorBinding(projectId: string, kind: FloorGraphBindingKind): Promise<boolean> {
    if (!graphId.value || !baseVersionId.value || isSample.value) {
      return false;
    }
    floorGraphBindingSaving.value = true;
    error.value = null;
    try {
      const result = await nodeGraphApi.setFloorGraphBinding(projectId, kind, {
        graph_id: graphId.value,
        graph_version_id: baseVersionId.value,
      });
      floorGraphBindings.value = [
        ...floorGraphBindings.value.filter((binding) => binding.kind !== kind),
        result.item,
      ];
      return true;
    } catch (cause) {
      error.value = describeError(cause);
      return false;
    } finally {
      floorGraphBindingSaving.value = false;
    }
  }

  async function clearFloorGraphBinding(projectId: string, kind: FloorGraphBindingKind): Promise<boolean> {
    floorGraphBindingSaving.value = true;
    error.value = null;
    try {
      const result = await nodeGraphApi.clearFloorGraphBinding(projectId, kind);
      if (result.cleared) {
        floorGraphBindings.value = floorGraphBindings.value.filter((binding) => binding.kind !== kind);
      }
      return result.cleared;
    } catch (cause) {
      error.value = describeError(cause);
      return false;
    } finally {
      floorGraphBindingSaving.value = false;
    }
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

  /** 手动调用服务端 validate，并把诊断以 server 来源并入诊断面板。 */
  async function validateOnServer(projectId: string): Promise<boolean> {
    if (!document.value || !graphId.value || isSample.value) {
      return false;
    }
    serverValidating.value = true;
    error.value = null;
    try {
      const result = await nodeGraphApi.validate(projectId, graphId.value, document.value);
      const diagnostics = Array.isArray(result.diagnostics) ? result.diagnostics : [];
      serverDiagnostics.value = withDiagnosticSource(diagnostics, "server");
      serverValidationCheckedAt.value = Date.now();
      return true;
    } catch (cause) {
      error.value = describeError(cause);
      return false;
    } finally {
      serverValidating.value = false;
    }
  }

  /** 丢弃本地草稿，回到所基于版本的原始文档。 */
  function discardDraft(): void {
    clearDraft();
    draftRestored.value = false;
    if (baseVersionId.value) {
      const version = versions.value.find((candidate) => candidate.id === baseVersionId.value);
      if (version) {
        setDocument(cloneGraphDocument(version.document));
        dirty.value = false;
        selectedNodeId.value = null;
        selectedEdgeId.value = null;
        resetHistory();
        loadToken.value += 1;
        return;
      }
    }
    if (isSample.value) {
      loadSample();
    } else if (templateKind.value) {
      loadTemplate(templateKind.value, graphName.value);
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
        templateKind.value = null;
        serverCurrentVersionId.value = result.definition.current_version_id;
        baseVersionId.value = result.version.id;
        setDocument(cloneGraphDocument(result.version.document));
      } else {
        const result = await nodeGraphApi.createVersion(
          projectId,
          graphId.value,
          document.value,
          baseVersionId.value,
        );
        serverCurrentVersionId.value = result.definition.current_version_id;
        baseVersionId.value = result.version.id;
        setDocument(cloneGraphDocument(result.version.document));
      }
      dirty.value = false;
      draftRestored.value = false;
      resetHistory();
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
  /**
   * 硬删除当前已保存的图定义本身（连同其所有版本），随后回到示例图。
   *
   * 仅对已保存的图（有graphId、非示例图）有效；示例图 / 未保存草稿无需删除。
   * 删除「数据存在本身」，区别于清空节点。后端若因运行历史拒绝（409），错误会回填 `error`。
   */
  async function deleteGraph(projectId: string): Promise<boolean> {
    if (!graphId.value || isSample.value) {
      return false;
    }
    saving.value = true;
    error.value = null;
    try {
      await nodeGraphApi.remove(projectId, graphId.value);
      clearDraft();
      loadSample();
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
      pushHistory();
      document.value.name = name;
      markDirty();
    }
  }

  function addNode(type: string, typeVersion = "1"): NodeGraphNode | null {
    const doc = document.value;
    if (!doc) {
      return null;
    }
    pushHistory();
    const entry = registry.find(type, typeVersion);
    const phase: NodeGraphPhase = entry?.supportedPhases[0] ?? "pre_response";
    const node: NodeGraphNode = {
      id: generateNodeId(doc, type),
      type,
      typeVersion,
      phase,
    };
    const defaultConfig = defaultConfigForNodeType(type, typeVersion);
    if (defaultConfig !== undefined) {
      node.config = defaultConfig;
    }
    const upgraded = isControlNodeType(type) ? ensureSchemaVersion2(doc) : false;
    const position = nextNodePosition(doc);
    if (position) {
      node.ui = { position };
    }
    doc.nodes.push(node);
    selectedNodeId.value = node.id;
    selectedEdgeId.value = null;
    if (upgraded) {
      error.value = "schema_upgraded_to_v2";
    }
    markDirty();
    return node;
  }

  function removeNode(nodeId: string): void {
    const doc = document.value;
    if (!doc) {
      return;
    }
    pushHistory();
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
    const node = doc.nodes.find((candidate) => candidate.id=== nodeId);
    if (!node) {
      return;
    }
    pushHistory();
    Object.assign(node, patch);
    markDirty();
  }

  function updateNodeConfig(nodeId: string, config: unknown): void {
    updateNode(nodeId, { config });
  }

  function updateGraphPolicies(policies: NodeGraphPolicies): void {
    const doc = document.value;
    if (!doc) {
      return;
    }
pushHistory();
    doc.policies = { ...policies };
    markDirty();
  }

  function patchGraphPolicies(patch: Partial<NodeGraphPolicies>): void {
    const doc = document.value;
    if (!doc) {
      return;
    }
    pushHistory();
    doc.policies = { ...doc.policies, ...patch };
    markDirty();
  }

  function updateGraphPermissions(permissions: NodeGraphPermissionManifest | undefined): void {
    const doc = document.value;
    if (!doc) {
      return;
    }
    pushHistory();
    if (!permissions) {
      delete doc.permissions;
 } else {
      doc.permissions = { ...permissions };
    }
    markDirty();
  }

  function updateGraphBudgets(budgets: NodeGraphBudgetOverrides | undefined): void {
    const doc = document.value;
    if (!doc) {
      return;
    }
    pushHistory();
    const next = cleanGraphBudgets(budgets);
    if (!next) {
      delete doc.budgets;
    } else {
      doc.budgets = next;
    }
    markDirty();
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
    pushHistory();
    node.ui = { ...node.ui, position };
    markDirty();
  }

  /** 批量写回坐标（自动布局结果 / 拖动停住持久化进文档）。 */
  function applyNodePositions(positions: Record<string, { x: number; y: number }>): void {
    const doc = document.value;
    if (!doc) {
      return;
    }
    // 先判断是否真有坐标变动，避免无变化时无谓入栈。
    const willChange = doc.nodes.some((node) => {
      const position = positions[node.id];
      return position && (node.ui?.position?.x !== position.x || node.ui?.position?.y !== position.y);
    });
    if (!willChange) {
      return;
    }
    pushHistory();
    for (const node of doc.nodes) {
      const position= positions[node.id];
      if (position) {
        node.ui = { ...node.ui, position };
        }
    }
    markDirty();
  }

  function addEdge(
    from: { nodeId: string; port: string },
    to: { nodeId: string; port: string },
    kind?: NodeGraphEdgeKind,
  ): NodeGraphEdge | null {
    const doc = document.value;
    if (!doc) {
      return null;
    }
    const resolvedKind = inferEdgeKind(doc, from, kind);
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
    pushHistory();
    const upgraded = resolvedKind === "control" ? ensureSchemaVersion2(doc) : false;
    const edge: NodeGraphEdge = { id: generateEdgeId(doc), from, to };
    if (resolvedKind === "control") {
      edge.kind = "control";
    }
    doc.edges.push(edge);
    selectedEdgeId.value = edge.id;
    selectedNodeId.value = null;
    selectedGroupId.value = null;
    if (upgraded) {
      error.value = "schema_upgraded_to_v2";
    }
    markDirty();
    return edge;
  }

  function updateEdgeKind(edgeId: string, kind: NodeGraphEdgeKind): void {
    const doc = document.value;
    if (!doc) {
      return;
    }
    const edge = doc.edges.find((candidate) => candidate.id === edgeId);
    if (!edge) {
            return;
    }
    pushHistory();
    const upgraded = kind === "control" ? ensureSchemaVersion2(doc) : false;
    if (kind === "control") {
      edge.kind = "control";
    } else {
      edge.kind = "data";
    }
    if (upgraded) {
      error.value = "schema_upgraded_to_v2";
    }
    markDirty();
  }

  function removeEdge(edgeId: string): void {
    const doc = document.value;
    if (!doc) {
      return;
    }
    pushHistory();
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
      selectedGroupId.value = null;
    }
  }

  function selectEdge(edgeId: string | null): void {
    selectedEdgeId.value = edgeId;
    if (edgeId) {
      selectedNodeId.value = null;
      selectedGroupId.value = null;
    }
  }

  /** 选中一个节点组（折叠节点组）；传 null 清除组选中。选中组时清除节点/边选中。 */
  function selectGroup(groupId: string | null): void {
    selectedGroupId.value = groupId;
    if (groupId) {
      selectedNodeId.value = null;
      selectedEdgeId.value = null;
    }
  }

  function clearSelection(): void {
    selectedNodeId.value = null;
    selectedEdgeId.value = null;
    selectedGroupId.value = null;
  }

  /**
   * 「Extract to NodeGroup」：把一个组抽取为**可复用子图定义**（持久化为普通 NodeGraph 定义），
   * 并在父图原处替换为单个 `group.node` 实例（引用该定义 + 接口缓存）。需项目上下文与
   * `project.nodegraph.write`。成功后父图标记 dirty（可另存为新版本），并选中新建的 group.node。
   */
  async function extractGroupToNodeGroup(projectId: string, groupId: string): Promise<boolean> {
    const doc = document.value;
    if (!doc) {
      return false;
    }
    const extracted = extractSubgraph(doc, groupId);
    if ("error" in extracted) {
      error.value = `extract_failed:${extracted.error}`;
      return false;
    }
    saving.value = true;
    error.value = null;
    try {
      const created = await nodeGraphApi.create(
        projectId,
        { ...cloneGraphDocument(extracted.subDocument), graphId: "" },
        extracted.subDocument.name || null,
      );
      const parent = cloneGraphDocument(extracted.parentDocument);
      const groupNode = parent.nodes.find((node) => node.id === extracted.groupNodeId);
      if (groupNode && groupNode.config && typeof groupNode.config === "object") {
        (groupNode.config as { ref: { graphId: string; versionId?: string } }).ref = {
          graphId: created.definition.id,
          versionId: created.version.id,
        };
      }
      pushHistory();
      setDocument(parent);
      activeGroupId.value = null;
      selectedNodeId.value = extracted.groupNodeId;
      selectedEdgeId.value = null;
      markDirty();
      return true;
    } catch (cause) {
      error.value = describeError(cause);
      return false;
    } finally {
      saving.value = false;
    }
  }

  /**
   * SG11-2：把一个**内置顾问子图**（director / verifier / memory）插入当前图。
   *
   * 先把内置子图 fork 进当前项目（持久化为 `metadata.subgraph=true` 的普通定义），再在画布放置一个
   * `group.node` 实例引用它（ref + 反规范化接口缓存，与 Extract to NodeGroup 同构）。需项目上下文与
   * `project.nodegraph.write`。成功后父图标记 dirty 并选中新建的 group.node。
   */
  async function insertBuiltinAdvisorSubgraph(projectId: string, builtin: NodeGraphDocument): Promise<boolean> {
    const doc = document.value;
    if (!doc) {
      return false;
    }
    saving.value = true;
    error.value = null;
    try {
      const created = await nodeGraphApi.create(
        projectId,
        { ...cloneGraphDocument(builtin), graphId: "" },
        builtin.name || null,
      );
      const iface = deriveSubgraphInterface(builtin);
      // group.node 相位取被引用子图的内核（非边界）节点相位，缺省 pre_response。
      const innerPhase =
        builtin.nodes.find((node) => node.type !== "group.input" && node.type !== "group.output")?.phase
        ?? "pre_response";
      const node: NodeGraphNode = {
        id: generateNodeId(doc, NODE_GRAPH_GROUP_NODE_TYPE),
        type: NODE_GRAPH_GROUP_NODE_TYPE,
        typeVersion: "1",
        name: builtin.name,
        phase: innerPhase,
        config: {
          ref: { graphId: created.definition.id, versionId: created.version.id },
          interface: iface,
        },
      };
      const position = nextNodePosition(doc);
      if (position) {
        node.ui = { position };
      }
      pushHistory();
      doc.nodes.push(node);
      selectedNodeId.value = node.id;
      selectedEdgeId.value = null;
     markDirty();
      return true;
    } catch (cause) {
      error.value = describeError(cause);
      return false;
    } finally {
      saving.value = false;
    }
  }

  /**
   * 节点组「开关」：无需钻入组内部即可整体启停其绑定节点。把开关位写入 `group.enabled`，
   * 并同步所有成员 `node.enabled`（开 → 清除禁用；关 → 置 `enabled:false`）——运行时仍只读
   * `node.enabled`，故开关即时生效、无需新增运行时语义。
   */
  function setGroupEnabled(groupId: string, enabled: boolean): void {
    const doc = document.value;
    if (!doc) {
      return;
    }
    const group = doc.groups?.find((candidate) => candidate.id === groupId);
    if (!group) {
      return;
    }
    pushHistory();
    group.enabled = enabled;
    for (const nodeId of group.nodeIds) {
      const node = doc.nodes.find((candidate) => candidate.id === nodeId);
      if (!node) {
        continue;
      }
      if (enabled) {
        delete node.enabled;
      } else {
        node.enabled = false;
      }
    }
    markDirty();
  }

  /**
   * 节点组折叠/展开：`collapsed=true` 时该子图组在画布上对外表现为单个折叠节点（Blender 式），
   * 双击进入其内部子图；`false` 则铺开为区域包围盒。纯展示态。
   */
  function setGroupCollapsed(groupId: string, collapsed: boolean): void {
    const doc = document.value;
    if (!doc) {
      return;
    }
    const group = doc.groups?.find((candidate) => candidate.id === groupId);
    if (!group) {
      return;
    }
    pushHistory();
    group.collapsed = collapsed;
    markDirty();
  }

  /**
   * 节点组输出通道「显式开关」：把通道 handle id（`out:<memberNodeId>:<port>`）写入/移出
   * `group.disabledChannels`。纯展示/编排显示状态——关闭后该通道在画布上灰显标签、
   * 虚化连线，但不改写底层数据与边。
   */
  function setGroupChannelEnabled(groupId: string, channelId: string, enabled: boolean): void {
    const doc = document.value;
    if (!doc) {
      return;
    }
    const group = doc.groups?.find((candidate) => candidate.id === groupId);
    if (!group) {
      return;
    }
    pushHistory();
    const next = new Set(group.disabledChannels ?? []);
    if (enabled) {
      next.delete(channelId);
    } else {
      next.add(channelId);
    }
    if (next.size === 0) {
      delete group.disabledChannels;
    } else {
      group.disabledChannels = [...next];
    }
    markDirty();
  }

  /**
   * 移动折叠节点组：折叠节点位置由成员坐标的最小角派生，故按「新位置 - 当前最小角」的位移
   * 整体平移所有成员，保留其内部相对布局。
   */
  function moveCollapsedGroup(groupId: string, position: { x: number; y: number }): void {
    const doc = document.value;
    if (!doc) {
      return;
    }
    const group = doc.groups?.find((candidate) => candidate.id === groupId);
    if (!group) {
      return;
    }
    const members = group.nodeIds
      .map((nodeId) => doc.nodes.find((node) => node.id === nodeId))
      .filter((node): node is NodeGraphNode => Boolean(node));
    if (members.length === 0) {
      return;
    }
    // 仅依据「有坐标」的成员推导整体最小角与位移，避免把缺省坐标当成 (0,0) 拉偏整组。
    const positioned = members
      .map((node) => node.ui?.position)
      .filter((position): position is { x: number; y: number } => Boolean(position));
    const minX = positioned.length > 0 ? Math.min(...positioned.map((p) => p.x)) : 0;
    const minY = positioned.length > 0 ? Math.min(...positioned.map((p) => p.y)) : 0;
    const dx = position.x - minX;
    const dy = position.y - minY;
    if (positioned.length === members.length && dx === 0 && dy === 0) {
      return;
    }
    pushHistory();
    // 缺省坐标的成员按列堆叠落位，避免「全部落在同一点」导致重叠。
    let stackOffset = 0;
    for (const node of members) {
      const base = node.ui?.position;
      if (base) {
        node.ui = { ...node.ui, position: { x: base.x + dx, y: base.y + dy } };
      } else {
        node.ui = { ...node.ui, position: { x: position.x, y: position.y + stackOffset } };
        stackOffset += 160;
      }
    }
    markDirty();
  }

  /** 钻入某分组（drill-in）：仅当该组存在时生效。 */
  function enterGroup(groupId: string): void {
    if (document.value?.groups?.some((group) => group.id === groupId)) {
      activeGroupId.value = groupId;
      selectedNodeId.value = null;
      selectedEdgeId.value = null;
      selectedGroupId.value = null;
    }
  }

  /** 退出钻入，回到根图。 */
  function exitGroup(): void {
    activeGroupId.value = null;
  }

  // —— NG2-6：复制粘贴、批量删除、成组 ——

  /**
   * 批量删除多个节点及其关联边（一次原子操作，一次进栈）。
   * 同步从各分组成员列表移除，清理落空的选中态。
   */
  function removeNodes(nodeIds: string[]): void {
    const doc = document.value;
    if (!doc || nodeIds.length === 0) {
      return;
    }
    const removeSet = new Set(nodeIds.filter((id) => doc.nodes.some((node) => node.id === id)));
    if (removeSet.size === 0) {
      return;
    }
    pushHistory();
    doc.nodes = doc.nodes.filter((node) => !removeSet.has(node.id));
    doc.edges = doc.edges.filter(
      (edge) => !removeSet.has(edge.from.nodeId) && !removeSet.has(edge.to.nodeId),
    );
    if (doc.groups) {
      for (const group of doc.groups) {
        group.nodeIds = group.nodeIds.filter((id) => !removeSet.has(id));
      }
    }
    if (selectedNodeId.value && removeSet.has(selectedNodeId.value)) {
      selectedNodeId.value = null;
    }
    markDirty();
  }

  /**
   * 复制粘贴选中节点（一次原子操作，一次进栈）：
   * - 克隆节点配置、重映射 node id（避免与现有 id 冲突）；
   * - 复制选区内部边（两端都在选区内）并按新 id 重连；
   * - 粘贴位置带偏移，便于与原节点区分。
   * 返回新建的节点 id 列表；无可复制节点时返回空数组。
   */
  function duplicateNodes(nodeIds: string[], offset = { x: 48, y: 48 }): string[] {
    const doc = document.value;
    if (!doc || nodeIds.length === 0) {
      return [];
    }
    const sourceNodes = doc.nodes.filter((node) => nodeIds.includes(node.id));
    if (sourceNodes.length === 0) {
      return [];
    }
    pushHistory();
    const sourceSet = new Set(sourceNodes.map((node) => node.id));
    const takenIds = new Set(doc.nodes.map((node) => node.id));
    const idMap = new Map<string, string>();
    const newNodes: NodeGraphNode[] = [];
    for (const source of sourceNodes) {
      const clone = cloneGraphNode(source);
      const newId = generateNodeId({ ...doc, nodes: [...doc.nodes, ...newNodes] }, source.type);
      // 再确认与已分配集合不冲突（同批多节点连续分配）。
      let uniqueId = newId;
      let suffix = 1;
      while (takenIds.has(uniqueId)) {
        uniqueId = `${newId}_${suffix}`;
        suffix += 1;
      }
      takenIds.add(uniqueId);
      idMap.set(source.id, uniqueId);
      clone.id = uniqueId;
      const basePosition = source.ui?.position;
      if (basePosition) {
        clone.ui = { ...clone.ui, position: { x: basePosition.x + offset.x, y: basePosition.y + offset.y } };
      }
     newNodes.push(clone);
    }
    const takenEdgeIds = new Set(doc.edges.map((edge) => edge.id));
    const newEdges: NodeGraphEdge[] = [];
    for (const edge of doc.edges) {
      if (!sourceSet.has(edge.from.nodeId) || !sourceSet.has(edge.to.nodeId)) {
        continue;
      }
      const fromId = idMap.get(edge.from.nodeId);
      const toId = idMap.get(edge.to.nodeId);
      if (!fromId || !toId) {
        continue;
      }
      const cloneEdge: NodeGraphEdge = {
        id: generateEdgeId({ ...doc, edges: [...doc.edges, ...newEdges] }),
        from: { nodeId: fromId, port: edge.from.port },
        to: { nodeId: toId, port: edge.to.port },
      };
      if (edge.kind) {
        cloneEdge.kind = edge.kind;
      }
      let uniqueEdgeId = cloneEdge.id;
      let suffix = 1;
      while (takenEdgeIds.has(uniqueEdgeId)) {
        uniqueEdgeId = `${cloneEdge.id}_${suffix}`;
        suffix += 1;
  }
      takenEdgeIds.add(uniqueEdgeId);
      cloneEdge.id = uniqueEdgeId;
      newEdges.push(cloneEdge);
    }
    doc.nodes.push(...newNodes);
    doc.edges.push(...newEdges);
    const newIds = newNodes.map((node) => node.id);
    selectedNodeId.value = newIds[0] ?? null;
    selectedEdgeId.value = null;
    selectedGroupId.value = null;
    markDirty();
    return newIds;
  }

  /**
   * 把选中节点成组为一个可视分组（一次原子操作，一次进栈）。
   * 复用现有分组模型（`kind: 'visual'`），后续可对该组钻入 / 抽取为 NodeGroup。
   * 返回新建的组 id；不足两个有效节点时返回 null。
   */
  function groupNodes(nodeIds: string[], name?: string): string | null {
    const doc = document.value;
    if (!doc) {
   return null;
    }
    const members = nodeIds.filter((id) => doc.nodes.some((node) => node.id === id));
    if (members.length < 2) {
      return null;
    }
    pushHistory();
    const existing = new Set((doc.groups ?? []).map((group) => group.id));
    let index = (doc.groups?.length ?? 0) + 1;
    let groupId = `grp_${index}`;
    while (existing.has(groupId)) {
      index += 1;
      groupId = `grp_${index}`;
    }
    const group: NodeGraphGroup = {
      id: groupId,
      name: name && name.trim().length > 0 ? name.trim() : `Group ${index}`,
      kind: "visual",
      nodeIds: [...members],
    };
    doc.groups = [...(doc.groups ?? []), group];
    selectedGroupId.value = groupId;
    selectedNodeId.value = null;
    selectedEdgeId.value = null;
    markDirty();
    return groupId;
  }



  return {
    // state
    graphId,
    graphName,
    isSample,
    isTemplate,
    templateKind,
    document,
    baseVersionId,
    serverCurrentVersionId,
    versions,
    floorGraphBindings,
    floorGraphBindingLoading,
    floorGraphBindingSaving,
    dirty,
    loading,
    saving,
    serverValidating,
    serverDiagnostics,
    serverValidationCheckedAt,
    error,
    selectedNodeId,
    selectedEdgeId,
    selectedGroupId,
    activeGroupId,
    draftRestored,
    loadToken,
    canUndo,
    canRedo,
    // derived
    validation,
    diagnostics,
    isExecutable,
    errorCount,
    warningCount,
    nodeCount,
    edgeCount,
    groupCount,
    isImportedSillyTavernPreset,
    isCompatFloorImportDraft,
    activeGroup,
    selectedNode,
    selectedEdge,
    selectedGroup,
    selectedNodeEntry,
    selectedNodeKnowledge,
    availableNodeTypes,
    canSaveVersion,
    canBindCurrentVersionAsFloorGraph,
    // actions
    loadSample,
    loadTemplate,
    importPreset,
    loadGraph,
    loadVersion,
    loadFloorGraphBindings,
    getFloorGraphBinding,
    isCurrentGraphBoundAs,
    isCurrentVersionBoundAs,
    hasCurrentGraphFloorBindingVersionMismatch,
    setCurrentGraphAsFloorBinding,
    clearFloorGraphBinding,
    setAsCurrentVersion,
    validateOnServer,
    clearServerValidation,
    discardDraft,
    saveAsNewVersion,
    deleteGraph,
    renameGraph,
    addNode,
    removeNode,
    updateNode,
    updateNodeConfig,
    updateGraphPolicies,
    patchGraphPolicies,
    updateGraphPermissions,
    updateGraphBudgets,
    updateNodePosition,
    applyNodePositions,
    addEdge,
    updateEdgeKind,
    removeEdge,
    selectNode,
    selectEdge,
    selectGroup,
    clearSelection,
    setGroupEnabled,
    setGroupCollapsed,
    setGroupChannelEnabled,
    moveCollapsedGroup,
    enterGroup,
    exitGroup,
    extractGroupToNodeGroup,
    insertBuiltinAdvisorSubgraph,
    undo,
    redo,
    removeNodes,
    duplicateNodes,
    groupNodes,
  };
});

function cleanGraphBudgets(budgets: NodeGraphBudgetOverrides | undefined): NodeGraphBudgetOverrides | undefined {
  if (!budgets) {
    return undefined;
  }
  const next: NodeGraphBudgetOverrides = {};
  for (const key of [
    "maxNodesExecuted",
    "maxDepth",
    "maxFanOut",
    "maxNestedAgentJobs",
    "maxTemporaryConversations",
    "maxRuntimeDurationMs",
  ] as const) {
    const value = budgets[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      next[key] = Math.trunc(value);
    }
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

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
