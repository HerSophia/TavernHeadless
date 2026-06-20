/**
 * elkjs 自动布局组合式（B10 阶段 5）。
 *
 * 设计 §3.2 / 风险缓解：elkjs（~1.5MB）经 **Web Worker** 计算，且整体**懒加载**——
 * 仅在首次触发自动布局时动态 import `elk-api` 与 worker 资源，不进入 Graph 模块首包、
 * 不阻塞首屏。布局过程不阻塞主线程。构图/还原坐标见 `elk-adapter`。
 */
import type { NodeGraphDocument } from "@tavern/core/node-graph";
import type { ELK } from "elkjs";
import { ref } from "vue";

import {
  buildElkGraph,
  extractElkLayout,
  type ElkAdapterOptions,
  type ElkLayoutResult,
} from "./elk-adapter";

let elkPromise: Promise<ELK> | null = null;

/** 懒加载并复用单个 ELK（worker）实例。 */
async function getElk(): Promise<ELK> {
  if (!elkPromise) {
    elkPromise = (async () => {
      const [{ default: ElkConstructor }, workerModule] = await Promise.all([
        import("elkjs/lib/elk-api"),
        import("elkjs/lib/elk-worker.min.js?url"),
      ]);
      return new ElkConstructor({ workerUrl: workerModule.default });
    })();
  }
  return elkPromise;
}

export function useAutoLayout() {
  const isLayouting = ref(false);
  const error = ref<string | null>(null);

  async function runAutoLayout(
    document: NodeGraphDocument,
    options: ElkAdapterOptions = {},
  ): Promise<ElkLayoutResult | null> {
    if (isLayouting.value) {
      return null;
    }
    isLayouting.value = true;
    error.value = null;
    try {
      const elk = await getElk();
      const graph = buildElkGraph(document, options);
      const laidOut = await elk.layout(graph);
      return extractElkLayout(laidOut);
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
      return null;
    } finally {
      isLayouting.value = false;
    }
  }

  return { isLayouting, error, runAutoLayout };
}
