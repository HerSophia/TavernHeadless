/**
 * 画布快照装配（图助手 · 提示词阶段二）。
 *
 * 把 `graph-editor` 与 `context` store 的当前状态收敛成一份 `GraphContextSnapshot`，
 * 作为纯函数收集器 `collectContextBlocks` 的唯一输入。这一层不做裁剪 / 措辞，只搬数据，
 * 保证收集 / 渲染逻辑全部可单测。
 */
import { useContextStore } from "../../../stores/context";
import { useGraphEditorStore } from "../../../stores/graph-editor";
import type { GraphContextSnapshot } from "./collect-context-blocks";

/** 读取当前 graph-editor / context store 状态，装配本回合画布快照。 */
export function buildGraphContextSnapshot(): GraphContextSnapshot {
  const graph = useGraphEditorStore();
  const context = useContextStore();

  const document = graph.document;
  const nodes = (document?.nodes ?? []).map((node) => ({
  id: node.id,
    type: node.type,
    phase: node.phase,
  }));

  const selectedNode = graph.selectedNode;
  const selectedEdge = graph.selectedEdge;
  const selectedGroup = graph.selectedGroup;

  const currentProject = context.projects.find((item) => item.id === context.currentProjectId);

  return {
    graphName: graph.graphName,
    nodeCount: graph.nodeCount,
    edgeCount: graph.edgeCount,
   groupCount: graph.groupCount,
    nodes,
    selection: {
      node: selectedNode
        ? { id: selectedNode.id, type: selectedNode.type, phase: selectedNode.phase }
        : null,
      nodeEntryLabel: graph.selectedNodeEntry?.title ?? null,
      edge: selectedEdge
        ? { id: selectedEdge.id, from: selectedEdge.from.nodeId, to: selectedEdge.to.nodeId }
        : null,
      group: selectedGroup ? { id: selectedGroup.id, name: selectedGroup.name } : null,
    },
    version: {
      baseVersionId: graph.baseVersionId,
      serverCurrentVersionId: graph.serverCurrentVersionId,
      dirty: graph.dirty,
      versions: graph.versions.map((version) => ({
        id: version.id,
        label: `#${version.version_no}`,
        createdAt: version.created_at,
      })),
    },
    diagnostics: {
      items: graph.diagnostics.map((diagnostic) =>({
        severity: diagnostic.severity,
        message: diagnostic.message,
        nodeId: diagnostic.nodeId ?? null,
      })),
      errorCount: graph.errorCount,
      warningCount: graph.warningCount,
      valid: graph.isExecutable,
    },
    project: {
      projectId: context.currentProjectId,
      projectName: currentProject?.name ?? null,
    },
  };
}
