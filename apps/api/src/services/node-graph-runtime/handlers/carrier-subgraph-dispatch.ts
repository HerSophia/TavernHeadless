import type {
  NodeGraphDiagnostic,
  NodeGraphNode,
  NodeGraphNodeRunOutput,
  NodeGraphSubgraphRef,
} from "@tavern/core";

import { NodeGraphNodeExecutionError } from "../executor.js";
import type {
  NodeGraphNodeInputs,
  NodeGraphRuntimeContext,
} from "../node-handler-registry.js";
import { textOutput } from "./handler-io.js";

/**
 * NG2-9：承载来源 = 子图时的运行分派助手（承载节点 handler 的可复用子图路径）。
 *
 * 见 `.limcode/design/nodegraph-ng2-9-subgraph-carrier-graph-chain-design.md`：
 *
 * 一个 Agent 承载节点（本任务为 `narration.narrator`）的有效来源为 `subgraph` 时，运行忠实走
 * NodeGraph **图链路**——由既有 `subgraphRunner` 加载并执行 `subgraphRef` 指向的子图。本助手与
 * `group.node` handler 同构，但面向「固定端口承载节点」，把承载节点的分派决策与 `group.node` 复用
 * 同一条子图运行路径（环检测 / 深度上限 / 权限上卷 / 同租户加载全部由 `subgraphRunner` 原样提供，
 * 本助手不复制、不放宽、不绕过）。
 *
 * 重要边界：
 * - **只在执行器逐节点运行上下文生效**（运行 job / 试运行 / 预览 / 被作为子图引用）。真实主链
 *   chat turn 不逐节点执行图（属 NG2-14），故本分派不进真实正史。
 * - 封装式分派（child 独立作用域、只回收边界输出）是试运行 / 调试上下文的中间行为；
 *   §10.4 Narrator 强制内联（透明摊平进父图同一次 run 的同一作用域 / trace）显式延后 NG2-14。
 * - `agent.call` 子图承载受 `single_call` 未启用阻塞；本助手写成可复用形态，供后续接 `agent.call`
 *   （换 `label` / `outputPortMapping` / `failedCode` 即可，不必重写分派与边界逻辑）。
 */

/** 承载子图分派失败的默认诊断码（narrator 专属，与 `group.node` 的 `node_graph_group_node_subgraph_failed` 对称）。 */
export const NARRATOR_SUBGRAPH_FAILED_CODE = "node_graph_narrator_subgraph_failed" as const;

export interface DispatchCarrierSubgraphArgs {
  node: NodeGraphNode;
  inputs: NodeGraphNodeInputs;
  context: NodeGraphRuntimeContext;
  /** NG2-7 core 类型的子图引用（`{ graphId; versionId }`）。 */
  subgraphRef: NodeGraphSubgraphRef;
  /** 预览标题 / 占位文本用，如 "Narrator (subgraph)"。 */
  label: string;
  /** 子图成功时把边界输出（`outputsByPort`）映射为承载节点运行结果。 */
  outputPortMapping: (outputsByPort: Record<string, unknown>) => NodeGraphNodeRunOutput;
  /** 分派失败时抛出的错误码；默认 narrator 专属码，`agent.call` 复用时可覆盖。 */
  failedCode?: string;
}

/**
 * 把承载节点分派到其承载子图执行（对照 `group.node` handler 行为）。
 *
 * 1. 收集实例输入端口值（剔除无数据边占位 `__node_id`）作为 `inputsByPort`。
 * 2. `context.dryRun || !context.subgraphRunner` → synthetic / dry_run 占位输出，
 *    metadata `carrier: { source: 'subgraph', ref, dispatched: false }`，**不调用 runner**（试运行安全）。
 * 3. 否则调 `context.subgraphRunner(...)`：
 *    - `failed` → 抛 `NodeGraphNodeExecutionError`（透传 `result.diagnostics`：环 / 深度 / 权限 / 未找到）。
 *    - `succeeded` → `outputPortMapping(result.outputsByPort)`。
 */
export async function dispatchCarrierSubgraph(
  args: DispatchCarrierSubgraphArgs,
): Promise<NodeGraphNodeRunOutput> {
  const { node, inputs, context, subgraphRef, label, outputPortMapping } = args;
  const failedCode = args.failedCode ?? NARRATOR_SUBGRAPH_FAILED_CODE;

  // 实例输入端口值（剔除无数据边时的占位 __node_id），与 group.node 一致。
  const inputsByPort: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(inputs)) {
    if (key !== "__node_id") {
      inputsByPort[key] = value;
    }
  }

  // dry-run 或未注入 runner：synthetic / dry_run 占位，不触发真实子图运行（与 group.node dry-run 分支一致）。
  if (context.dryRun || !context.subgraphRunner) {
    const text = context.dryRun ? `[dry-run ${label}]` : `[synthetic ${label}]`;
    return textOutput(label, text, context.dryRun ? "dry_run" : "synthetic", {
      carrier: { source: "subgraph", ref: subgraphRef, dispatched: false },
      diagnostics: [],
    });
  }

  // 实运行分派：复用既有 subgraphRunner（加载 / 递归 / 边界原样透传）。
  const result = await context.subgraphRunner(
    {
      ref: { graphId: subgraphRef.graphId, versionId: subgraphRef.versionId ?? undefined },
      inputsByPort,
      parentNode: node,
    },
    context,
  );
  if (result.status === "failed") {
    const diagnostics: NodeGraphDiagnostic[] = result.diagnostics ?? [{
      severity: "error",
      code: failedCode,
      message: `Carrier subgraph for node '${node.id}' failed.`,
      nodeId: node.id,
    }];
    throw new NodeGraphNodeExecutionError(
      `Carrier subgraph for node '${node.id}' failed.`,
      diagnostics,
      failedCode,
    );
  }
  return outputPortMapping(result.outputsByPort);
}
