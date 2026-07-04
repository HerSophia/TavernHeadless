/**
 * "@" 提及候选来源装配与解析索引维护（图助手 · 提及阶段）。
 *
 * 组合式函数，把三类来源收敛成同构候选，并维护一张可丢弃、可重建的解析索引
 * （名称 → MentionRef）。索引只在用户确认插入候选时写入，不持久化；丢失即降级为纯文本。
 *
 * 三类来源：
 * - 图：`nodeGraphApi.list(projectId)`，按 projectId 缓存，失败时图候选为空且不抛出。
 * - 节点：当前打开图的工作文档 `document.nodes`。
 * - 选中：当前画布选中的对象。选中节点用 `kind: "node"`（与节点列表同 kind+id，发送时去重），
 *   选中边 / 分组用 `kind: "selection"`（节点列表里没有，不重复）。
 */
import { computed, ref, type ComputedRef } from "vue";

import { nodeGraphApi } from "../../../lib/nodegraph-api";
import { useGraphEditorStore } from "../../../stores/graph-editor";
import type { MentionSources } from "./mention-providers";
import { candidateToRef, type MentionCandidate } from "./mention-types";
import type { MentionIndex } from "./segment-mention-text";

/** 边的可读名：边无 name 字段，用其 id 作为 token 文本。 */
function edgeLabel(id: string): string {
  return id;
}

export interface UseMentionSourcesResult {
  /** 响应式候选来源（含异步图列表）。 */
  sources: ComputedRef<MentionSources>;
  /** 解析索引（名称 → 引用列表），供镜像层渲染与发送解析共用。 */
  index: ComputedRef<MentionIndex>;
  /** 图候选是否加载中。 */
  loadingGraphs: ComputedRef<boolean>;
  /** 按需加载 / 刷新项目图列表（弹层触发时调用）。 */
  ensureGraphs: (projectId: string | null | undefined) => Promise<void>;
  /** 确认插入候选时写入解析索引。 */
  register: (candidate: MentionCandidate) => void;
}

/**
 * 装配提及候选来源与解析索引。
 *
 * @returns 候选来源、解析索引与相关操作。
 */
export function useMentionSources(): UseMentionSourcesResult {
  const editor = useGraphEditorStore();

  // 图候选缓存：按 projectId 记录，避免重复请求。
  const graphCandidates = ref<MentionCandidate[]>([]);
  const graphProjectId = ref<string | null>(null);
  const loadingGraphs = ref(false);

  // 解析索引：名称 → 引用列表（同名可多条）。
  const indexMap = ref<MentionIndex>(new Map());

  const nodeCandidates = computed<MentionCandidate[]>(() => {
    const nodes = editor.document?.nodes ?? [];
    return nodes.map((node) => ({
      kind: "node" as const,
      id: node.id,
      name: node.name && node.name.trim().length > 0 ? node.name : node.id,
      type: node.type,
      subtitle: node.type,
    }));
  });

  const selectionCandidates = computed<MentionCandidate[]>(() => {
    const result: MentionCandidate[] = [];
    const selectedNode = editor.selectedNode;
    if (selectedNode) {
      result.push({
        kind: "node",
        id: selectedNode.id,
        name: selectedNode.name && selectedNode.name.trim().length > 0 ? selectedNode.name : selectedNode.id,
        type: selectedNode.type,
        subtitle: "当前选中",
      });
      return result;
    }
    const selectedEdge = editor.selectedEdge;
    if (selectedEdge) {
      result.push({
        kind: "selection",
        id: selectedEdge.id,
        name: edgeLabel(selectedEdge.id),
        subtitle: "当前选中的边",
      });
      return result;
    }
    const selectedGroup = editor.selectedGroup;
  if (selectedGroup) {
      result.push({
        kind: "selection",
        id: selectedGroup.id,
        name: selectedGroup.name,
        subtitle: "当前选中的分组",
      });
    }
    return result;
  });

  const sources = computed<MentionSources>(() => ({
    selection: selectionCandidates.value,
    nodes: nodeCandidates.value,
    graphs: graphCandidates.value,
  }));

  const index = computed<MentionIndex>(() => indexMap.value);

  async function ensureGraphs(projectId: string | null | undefined): Promise<void> {
 if (!projectId) {
      graphCandidates.value = [];
      graphProjectId.value = null;
      return;
    }
    if (graphProjectId.value === projectId && graphCandidates.value.length > 0) {
      return;
    }
    loadingGraphs.value = true;
    try {
      const response = await nodeGraphApi.list(projectId);
      graphCandidates.value = response.items.map((item) => ({
        kind: "graph" as const,
        id: item.id,
        name: item.name,
        subtitle: item.status === "archived" ? "已归档" : "图",
      }));
      graphProjectId.value = projectId;
    } catch {
      // 图列表加载失败：图候选为空，不阻断节点 / 选中。
      graphCandidates.value = [];
    } finally {
      loadingGraphs.value = false;
    }
  }

  function register(candidate: MentionCandidate): void {
    const mentionRef = candidateToRef(candidate);
    const next = new Map(indexMap.value);
    const list = next.get(candidate.name) ?? [];
    // 同名去重（按 kind + id）。
    if (!list.some((item) => item.kind === mentionRef.kind && item.id === mentionRef.id)) {
      next.set(candidate.name, [...list, mentionRef]);
      indexMap.value = next;
    }
  }

  return {
    sources,
    index,
    loadingGraphs: computed(() => loadingGraphs.value),
    ensureGraphs,
    register,
  };
}
