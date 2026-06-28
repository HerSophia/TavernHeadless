/**
 * CG11（批次 11）：compat prompt 主链的 system graph 表达。
 *
 * 与 NG2-BRIDGE 的 native system graph 同构地，把 compat（`compat_strict` / `compat_plus`）主链编排
 * 表达为一张内置、版本化、`metadata.systemGraph = true` 的 NodeGraph v2 文档。compat 主链零 Agentic，
 * 故结构是 native 的子集：source → compose → narrator → commit（无 `agent.*` / `verify.*`）。
 *
 * 结构骨架取自 `@tavern/core` 的 `buildCompatPromptFloorStructure()`（与「compat 默认楼层模板」共享唯一
 * 事实源，保证同结构）。本图是 compat 编排的「图化承载表达」，供 `node_graph` carrier 与影子比对使用；
 * 真正的 PromptIR 仍由既有 compat 装配闭包产出（golden 一致），本图不重写编排逻辑。
 *
 * `compat_strict` 与 `compat_plus` 结构相同，故只有这一张图；strict / plus 的差异由 processor 携带的
 * recipe 表达并写入 trace（`recipe_kind`）。
 */
import {
  buildCompatPromptFloorStructure,
  compileNodeGraph,
  type NodeGraphDocument,
  type NodeGraphValidationResult,
  validateNodeGraph,
} from "@tavern/core";

/** 内置 compat prompt system graph 的稳定 id。 */
export const COMPAT_PROMPT_SYSTEM_GRAPH_ID = "system.compat_prompt" as const;

/** 内置 compat prompt system graph 的版本号（语义升级时递增，进入承载 trace）。 */
export const COMPAT_PROMPT_SYSTEM_GRAPH_VERSION = "cg11.v1" as const;

/** 构造 compat prompt system graph 文档（结构取自 core 共享骨架 + 系统图标识）。 */
export function buildCompatPromptSystemGraph(): NodeGraphDocument {
  const structure = buildCompatPromptFloorStructure();
  return {
    schemaVersion: 2,
    graphId: COMPAT_PROMPT_SYSTEM_GRAPH_ID,
    name: "Compat Prompt System Graph",
    description: "Built-in system graph that carries the compat prompt main chain, zero agentic (CG11).",
    mode: structure.mode,
    policies: structure.policies,
    permissions: structure.permissions,
    metadata: { systemGraph: true, version: COMPAT_PROMPT_SYSTEM_GRAPH_VERSION },
    nodes: structure.nodes,
    edges: structure.edges,
  };
}

/** 单例缓存：system graph 文档不随运行变化。 */
let cachedSystemGraph: NodeGraphDocument | undefined;

/** 返回内置 compat prompt system graph（缓存）。 */
export function getCompatPromptSystemGraph(): NodeGraphDocument {
  cachedSystemGraph ??= buildCompatPromptSystemGraph();
  return cachedSystemGraph;
}

/** 校验 compat prompt system graph 是否可执行且满足 system graph 约束。 */
export function validateCompatPromptSystemGraph(document: NodeGraphDocument = getCompatPromptSystemGraph()): NodeGraphValidationResult {
  return validateNodeGraph(document);
}

/** 编译并断言 compat prompt system graph 可执行；返回编译诊断（供测试与启动自检）。 */
export function assertCompatPromptSystemGraphExecutable(): void {
  const compiled = compileNodeGraph(getCompatPromptSystemGraph());
  if (!compiled.isExecutable) {
    const errors = compiled.diagnostics.filter((d) => d.severity === "error").map((d) => d.code);
    throw new Error(`Compat prompt system graph is not executable: ${errors.join(", ")}`);
  }
}
