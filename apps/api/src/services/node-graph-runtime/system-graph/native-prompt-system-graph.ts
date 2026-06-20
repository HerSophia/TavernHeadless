/**
 * NG2-BRIDGE（批次 9 阶段 12）：native prompt 主链的 system graph 表达。
 *
 * 把 native prompt 主链编排（source → agent decision → compose → narrator → postprocess →
 * verify → commit_gate）表达为一张内置、版本化、`metadata.systemGraph = true` 的 NodeGraph
 * v2 文档。它复用 NG2-CORE 的 system graph 严格校验（唯一 Narrator / 唯一 CommitGate + compose）。
 *
 * 关键边界：本图是 native 编排的「图化表达」，供 `node_graph` TurnAssemblyProcessor 承载与
 * 影子比对使用。真正的 PromptIR 仍由既有 compose 闭包产出（golden 一致），本图不重写编排逻辑。
 */
import {
  compileNodeGraph,
  type NodeGraphDocument,
  type NodeGraphValidationResult,
  validateNodeGraph,
} from "@tavern/core";

/** 内置 native prompt system graph 的稳定 id。 */
export const NATIVE_PROMPT_SYSTEM_GRAPH_ID = "system.native_prompt" as const;

/** 内置 native prompt system graph 的版本号（语义升级时递增，进入承载 trace）。 */
export const NATIVE_PROMPT_SYSTEM_GRAPH_VERSION = "ng2-bridge.v1" as const;

/**
 * 构造 native prompt system graph 文档。
 *
 * 节点覆盖主链阶段：
 * - source：`source.user_input` / `source.chat_history`（pre_response）。
 * - agent decision：`agent.director_plan`（pre_response，需 `project.agent.run`）。
 * - compose：`compose.final_messages`（response）。
 * - narrator：`narration.narrator`（response，唯一正文）。
 * - postprocess / verify：`verify.continuity`（post_response）。
 * - commit：`output.commit_gate`（commit，唯一正史写入边界）。
 */
export function buildNativePromptSystemGraph(): NodeGraphDocument {
  return {
    schemaVersion: 2,
    graphId: NATIVE_PROMPT_SYSTEM_GRAPH_ID,
    name: "Native Prompt System Graph",
    description: "Built-in system graph that carries the native prompt main chain (NG2-BRIDGE).",
    mode: "native_graph",
    policies: {},
    permissions: { required: ["project.agent.run"] },
    metadata: { systemGraph: true, version: NATIVE_PROMPT_SYSTEM_GRAPH_VERSION },
    nodes: [
      { id: "user_input", type: "source.user_input", typeVersion: "1", phase: "pre_response", scope: "floor_stable" },
      { id: "history", type: "source.chat_history", typeVersion: "1", phase: "pre_response", scope: "floor_stable" },
      { id: "director", type: "agent.director_plan", typeVersion: "1", phase: "pre_response", scope: "pre_response_stochastic" },
      { id: "compose", type: "compose.final_messages", typeVersion: "1", phase: "response" },
      { id: "narrator", type: "narration.narrator", typeVersion: "1", phase: "response" },
      { id: "verify", type: "verify.continuity", typeVersion: "1", phase: "post_response" },
      { id: "commit", type: "output.commit_gate", typeVersion: "1", phase: "commit" },
    ],
    edges: [
      { id: "e_history_director", kind: "data", from: { nodeId: "history", port: "messages" }, to: { nodeId: "director", port: "messages" } },
      { id: "e_history_compose", kind: "data", from: { nodeId: "history", port: "messages" }, to: { nodeId: "compose", port: "messages" } },
      { id: "e_compose_narrator", kind: "data", from: { nodeId: "compose", port: "messages" }, to: { nodeId: "narrator", port: "messages" } },
      { id: "e_narrator_verify", kind: "data", from: { nodeId: "narrator", port: "text" }, to: { nodeId: "verify", port: "text" } },
      { id: "e_narrator_commit", kind: "data", from: { nodeId: "narrator", port: "text" }, to: { nodeId: "commit", port: "text" } },
      { id: "e_verify_commit", kind: "data", from: { nodeId: "verify", port: "result" }, to: { nodeId: "commit", port: "verifier" } },
    ],
  };
}

/** 单例缓存：system graph 文档不随运行变化。 */
let cachedSystemGraph: NodeGraphDocument | undefined;

/** 返回内置 native prompt system graph（缓存）。 */
export function getNativePromptSystemGraph(): NodeGraphDocument {
  cachedSystemGraph ??= buildNativePromptSystemGraph();
  return cachedSystemGraph;
}

/** 校验 native prompt system graph 是否可执行且满足 system graph 约束。 */
export function validateNativePromptSystemGraph(document: NodeGraphDocument = getNativePromptSystemGraph()): NodeGraphValidationResult {
  return validateNodeGraph(document);
}

/** 编译并断言 native prompt system graph 可执行；返回编译诊断（供测试与启动自检）。 */
export function assertNativePromptSystemGraphExecutable(): void {
  const compiled = compileNodeGraph(getNativePromptSystemGraph());
  if (!compiled.isExecutable) {
    const errors = compiled.diagnostics.filter((d) => d.severity === "error").map((d) => d.code);
    throw new Error(`Native prompt system graph is not executable: ${errors.join(", ")}`);
  }
}
