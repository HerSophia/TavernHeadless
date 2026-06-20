/**
 * 节点 preview composable（B10 阶段 6）。
 *
 * 调用后端 `preview` 路由（dry-run、套用更严格的同步预算），取回某节点的
 * `NodeGraphPreview`。**注意**：后端 preview 跑的是已保存版本的文档（current 或指定
 * version_id），不是编辑器里的未保存草稿——因此 preview 反映「已保存版本」，UI 需在有
 * 未保存改动时提示。
 *
 * previewPolicy 策略由调用方（NodeInspector）按 `previewPolicyOf` 决定：
 * - `disabled`：不提供预览。
 * - `manual` / `cached_only`：仅显式触发，绝不自动触发（避免误触 LLM）。
 * - `auto`：可在选中时自动预览（内置 auto 类型均为非 LLM 的确定性节点）。
 */
import type {
  NodeGraphDiagnostic,
  NodeGraphNode,
  NodeGraphPreview,
  NodeGraphPreviewPolicy,
  NodeTypeRegistryEntry,
} from "@tavern/core/node-graph";
import { ref, type Ref } from "vue";

import { nodeGraphApi, NodeGraphApiError } from "../../../lib/nodegraph-api";

export interface NodePreviewState {
  nodeId: string;
  status: "succeeded" | "failed" | null;
  preview: NodeGraphPreview | null;
  diagnostics: NodeGraphDiagnostic[];
  value: unknown;
}

export interface RunNodePreviewParams {
  projectId: string;
  graphId: string;
  versionId?: string | null;
  node: NodeGraphNode;
  userInput?: string;
}

/** 解析节点的有效 previewPolicy：节点自身覆盖 > registry 默认 > auto。 */
export function previewPolicyOf(
  node: NodeGraphNode | null,
  entry: NodeTypeRegistryEntry | undefined,
): NodeGraphPreviewPolicy {
  return node?.previewPolicy ?? entry?.previewPolicy ?? "auto";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePreview(response: unknown, nodeId: string): NodePreviewState {
  const status =
    isRecord(response) && (response.status === "succeeded" || response.status === "failed")
      ? response.status
      : null;
  const nodeOutputs = isRecord(response) && isRecord(response.nodeOutputs) ? response.nodeOutputs : {};
  const output = isRecord(nodeOutputs[nodeId]) ? (nodeOutputs[nodeId] as Record<string, unknown>) : undefined;
  const preview = output && isRecord(output.preview) ? (output.preview as unknown as NodeGraphPreview) : null;
  const nodeDiagnostics = output && Array.isArray(output.diagnostics) ? (output.diagnostics as NodeGraphDiagnostic[]) : [];
  // 节点级无诊断时回退到图级编译诊断（如不可执行导致 preview 失败）。
  const compileDiagnostics =
    isRecord(response) && Array.isArray(response.diagnostics) ? (response.diagnostics as NodeGraphDiagnostic[]) : [];
  return {
    nodeId,
    status,
    preview,
    diagnostics: nodeDiagnostics.length > 0 ? nodeDiagnostics : compileDiagnostics,
    value: output?.value,
  };
}

function describeError(cause: unknown): string {
  if (cause instanceof NodeGraphApiError) {
    if (isRecord(cause.detail) && typeof cause.detail.message === "string" && cause.detail.message) {
      return cause.detail.message;
    }
    return cause.message;
  }
  return cause instanceof Error ? cause.message : String(cause);
}

export function useNodePreview(): {
  previewing: Ref<boolean>;
  error: Ref<string | null>;
  result: Ref<NodePreviewState | null>;
  runPreview: (params: RunNodePreviewParams) => Promise<void>;
  reset: () => void;
} {
  const previewing = ref(false);
  const error = ref<string | null>(null);
  const result = ref<NodePreviewState | null>(null);
  let token = 0;

  function reset(): void {
    result.value = null;
    error.value = null;
  }

  async function runPreview(params: RunNodePreviewParams): Promise<void> {
    const current = ++token;
    previewing.value = true;
    error.value = null;
    result.value = null;
    try {
      const response = await nodeGraphApi.preview(params.projectId, params.graphId, {
        version_id: params.versionId ?? undefined,
        node_id: params.node.id,
        user_input: params.userInput,
      });
      if (current !== token) {
        return;
      }
      result.value = parsePreview(response, params.node.id);
    } catch (cause) {
      if (current !== token) {
        return;
      }
      error.value = describeError(cause);
    } finally {
      if (current === token) {
        previewing.value = false;
      }
    }
  }

  return { previewing, error, result, runPreview, reset };
}
