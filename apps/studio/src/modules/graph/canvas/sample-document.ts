import type { NodeGraphDocument } from "@tavern/core/node-graph";

/**
 * 内置示例 v2 图（含分组与 control 边、跨全部 phase、含 llm/write side-effect、无坐标）。
 *
 * 用途：在无后端数据时让画布即刻可演示（GraphView 默认载入），同时作为 `map-document`
 * 单测的真实夹具。刻意不给节点坐标，以验证占位列布局兜底（阶段 5 接入 elkjs 后由其接管）。
 */
export const SAMPLE_NODE_GRAPH_DOCUMENT: NodeGraphDocument = {
  schemaVersion: 2,
  graphId: "sample-native-prompt",
  name: "示例 · Native Prompt",
  description: "演示用 v2 图：含分组、控制边与多 phase。",
  mode: "native_graph",
  nodes: [
    { id: "n_user", type: "source.user_input", typeVersion: "1", phase: "pre_response" },
    { id: "n_history", type: "source.chat_history", typeVersion: "1", phase: "pre_response" },
    { id: "n_char", type: "source.character", typeVersion: "1", phase: "floor_prepare" },
    { id: "n_wb", type: "select.worldbook_match", typeVersion: "1", phase: "pre_response" },
    { id: "n_cond", type: "control.condition", typeVersion: "1", phase: "pre_response" },
    { id: "n_branch", type: "control.branch", typeVersion: "1", phase: "pre_response" },
    { id: "n_gate", type: "control.gate", typeVersion: "1", phase: "pre_response" },
    { id: "n_compose", type: "compose.final_messages", typeVersion: "1", phase: "response" },
    { id: "n_narrator", type: "narration.narrator", typeVersion: "1", phase: "response" },
    { id: "n_verify", type: "verify.continuity", typeVersion: "1", phase: "post_response" },
    { id: "n_commit", type: "output.commit_gate", typeVersion: "1", phase: "commit" },
    { id: "n_derived", type: "output.derived_output", typeVersion: "1", phase: "commit" },
  ],
  edges: [
    { id: "e_user_wb", from: { nodeId: "n_user", port: "text" }, to: { nodeId: "n_wb", port: "query" } },
    { id: "e_wb_cond", from: { nodeId: "n_wb", port: "text" }, to: { nodeId: "n_cond", port: "value" } },
    { id: "e_cond_branch", from: { nodeId: "n_cond", port: "result" }, to: { nodeId: "n_branch", port: "condition" } },
    { id: "e_cond_gate", from: { nodeId: "n_cond", port: "result" }, to: { nodeId: "n_gate", port: "condition" } },
    { id: "e_history_compose", from: { nodeId: "n_history", port: "messages" }, to: { nodeId: "n_compose", port: "messages" } },
    { id: "e_compose_narrator", from: { nodeId: "n_compose", port: "messages" }, to: { nodeId: "n_narrator", port: "messages" } },
    { id: "e_narrator_verify", from: { nodeId: "n_narrator", port: "text" }, to: { nodeId: "n_verify", port: "text" } },
    { id: "e_narrator_commit", from: { nodeId: "n_narrator", port: "text" }, to: { nodeId: "n_commit", port: "text" } },
    { id: "e_verify_commit", from: { nodeId: "n_verify", port: "result" }, to: { nodeId: "n_commit", port: "verifier" } },
    { id: "e_commit_derived", from: { nodeId: "n_commit", port: "decision" }, to: { nodeId: "n_derived", port: "value" } },
    // control 边：gate 门控 compose、branch.true 路由 narrator
    { id: "c_gate_compose", kind: "control", from: { nodeId: "n_gate", port: "open" }, to: { nodeId: "n_compose", port: "messages" } },
    { id: "c_branch_narrator", kind: "control", from: { nodeId: "n_branch", port: "true" }, to: { nodeId: "n_narrator", port: "messages" } },
  ],
  groups: [
    {
      id: "g_pre",
      name: "Pre-response",
      kind: "visual",
      nodeIds: ["n_wb", "n_cond", "n_branch", "n_gate"],
    },
  ],
  policies: {},
  metadata: { systemGraph: false },
};
