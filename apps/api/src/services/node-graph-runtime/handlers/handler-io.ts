import type { NodeGraphNodeRunOutput } from "@tavern/core";

/**
 * NodeGraph 内置 handler 的共享 I/O 小工具。
 *
 * 从 `builtin.ts` 抽出 `readString` / `textOutput`，供 `builtin.ts` 与承载子图分派助手
 * （`carrier-subgraph-dispatch.ts`，NG2-9）共用，避免二者互相导入形成模块环。
 * 纯函数、无副作用、不依赖运行上下文。
 */

/** 把任意值读为字符串：字符串原样返回，null/undefined 归一为空串，其余 JSON 序列化。 */
export function readString(value: unknown): string {
  return typeof value === "string" ? value : value === undefined || value === null ? "" : JSON.stringify(value);
}

/** 构造以 `text` 为主输出的节点运行结果（文本预览 + `outputs.text`）。 */
export function textOutput(
  title: string,
  text: string,
  source: "live" | "dry_run" | "synthetic" = "live",
  outputs: Record<string, unknown> = {},
): NodeGraphNodeRunOutput {
  return {
    value: text,
    outputs: { text, ...outputs },
    preview: {
      kind: "text",
      title,
      value: text,
      tokenEstimate: Math.ceil(text.length / 4),
      source,
    },
  };
}
