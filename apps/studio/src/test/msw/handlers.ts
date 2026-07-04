/**
 * 共享 msw handlers / fixtures（B10 阶段 9）。
 *
 * 用于 studio 的确定性集成测试：以 msw 拦截 NodeGraph 第一方路由与聊天 SSE，
 * 验证真实客户端层（`lib/nodegraph-api` 自有 fetch 客户端、`lib/chat` 经 `@tavern/sdk`）
 * 的请求构造、响应解析与流式处理，不依赖真实后端。
 *
 * 注意：fixtures 采用**后端响应形态**（NodeGraph 为 snake_case 定义/版本；SSE data 为
 * snake_case），以同时校验我们的客户端与 SDK 的映射口径。
 */
import type { NodeGraphDocument } from "@tavern/core/node-graph";
import { http, HttpResponse } from "msw";

/** studio 默认 apiBaseUrl（VITE_API_BASE_URL 缺省）。 */
export const API_BASE = "http://localhost:3000";

export const sampleDocument: NodeGraphDocument = {
  schemaVersion: 2,
  graphId: "g1",
  name: "G1",
  mode: "native_graph",
  nodes: [{ id: "n1", type: "source.user_input", typeVersion: "1", phase: "pre_response" }],
  edges: [],
  policies: {},
};

export const sampleDefinition = {
  id: "g1",
  account_id: "a1",
  workspace_id: null,
  project_id: "p1",
  name: "G1",
  status: "active",
  current_version_id: "v1",
  created_at: 0,
  updated_at: 0,
};

export const sampleVersion = {
  id: "v1",
  graph_id: "g1",
  version_no: 1,
  document: sampleDocument,
  document_hash: "h1",
  parent_version_id: null,
  operation_log_id: null,
  created_at: 0,
};

export const sampleFloorGraphBinding = {
  id: "fgb1",
  account_id: "a1",
  workspace_id: "w1",
  project_id: "p1",
  kind: "native",
  graph_id: "g1",
  graph_version_id: "v1",
  graph_name: "G1",
  graph_version_no: 1,
  status: "active",
  created_at: 0,
  updated_at: 0,
};

/** NodeGraph 第一方路由 handlers（project p1 / graph g1）。 */
export const nodeGraphHandlers = [
  http.get(`${API_BASE}/projects/p1/node-graphs`, () =>
    HttpResponse.json({ items: [sampleDefinition] }),
  ),
  http.post(`${API_BASE}/projects/p1/node-graphs`, () =>
    HttpResponse.json(
      {
        definition: sampleDefinition,
        version: sampleVersion,
        validation: { isExecutable: true, diagnostics: [], topologicalLevels: [["n1"]] },
      },
      { status: 201 },
    ),
  ),
  http.post(`${API_BASE}/projects/p1/node-graphs/g1/run`, () =>
    HttpResponse.json(
      {
        job_id: "j1",
        created: true,
        dedupe_key: null,
        graph_id: "g1",
        graph_version_id: "v1",
        worker_enabled: false,
      },
      { status: 202 },
    ),
  ),
  http.post(`${API_BASE}/projects/p1/node-graphs/g1/archive`, () =>
    HttpResponse.json({ definition: { ...sampleDefinition, status: "archived" } }),
  ),
  http.post(`${API_BASE}/projects/p1/node-graphs/g1/unarchive`, () =>
    HttpResponse.json({ definition: { ...sampleDefinition, status: "active" } }),
  ),
  http.get(`${API_BASE}/projects/p1/node-graphs/g1`, () =>
    HttpResponse.json({ definition: sampleDefinition, current_version: sampleVersion }),
  ),
  http.get(`${API_BASE}/projects/p1/node-graphs/g1/versions`, () =>
    HttpResponse.json({ items: [sampleVersion] }),
  ),
  http.post(`${API_BASE}/projects/p1/node-graphs/g1/versions`, () =>
    HttpResponse.json(
      {
        definition: { ...sampleDefinition, current_version_id: "v2" },
        version: { ...sampleVersion, id: "v2", version_no: 2, parent_version_id: "v1" },
        validation: { isExecutable: true, diagnostics: [], topologicalLevels: [["n1"]] },
      },
      { status: 201 },
    ),
  ),
  http.post(`${API_BASE}/projects/p1/node-graphs/g1/validate`, () =>
    HttpResponse.json({ isExecutable: true, diagnostics: [], topologicalLevels: [["n1"]] }),
  ),
  http.post(`${API_BASE}/projects/p1/node-graphs/g1/preview`, () =>
    HttpResponse.json({
      status: "succeeded",
      nodeOutputs: {
        n1: { preview: { kind: "text", value: "hello", source: "dry_run" }, value: "hello", diagnostics: [] },
      },
      nodeRuns: [],
      diagnostics: [],
    }),
  ),
  http.post(`${API_BASE}/projects/p1/node-graphs/g1/current-version`, () =>
    HttpResponse.json({
      definition: { ...sampleDefinition, current_version_id: "v2" },
      version: { ...sampleVersion, id: "v2", version_no: 2 },
    }),
  ),
  http.get(`${API_BASE}/projects/p1/settings/floor-graph-bindings`, () =>
    HttpResponse.json({ items: [sampleFloorGraphBinding] }),
  ),
  http.put(`${API_BASE}/projects/p1/settings/floor-graph-bindings/:kind`, async ({ params, request }) => {
    const body = (await request.json()) as { graph_id: string; graph_version_id: string };
    return HttpResponse.json({
      item: {
        ...sampleFloorGraphBinding,
        kind: params.kind,
        graph_id: body.graph_id,
        graph_version_id: body.graph_version_id,
      },
    });
  }),
  http.delete(`${API_BASE}/projects/p1/settings/floor-graph-bindings/:kind`, ({ params }) =>
    HttpResponse.json({
      cleared: true,
      previous: { ...sampleFloorGraphBinding, kind: params.kind },
    }),
  ),
];

/** 图助手工具策略 effective 项样本（后端 snake_case 形态）。 */
export const sampleToolPolicyItems = [
  {
    tool_name: "nodegraph.graph.get",
    side_effect_level: "none",
    default_decision: "auto",
    decision: "auto",
    source: "default",
  },
  {
    tool_name: "nodegraph.node.add",
   side_effect_level: "sandbox",
    default_decision: "auto",
    decision: "auto",
    source: "default",
  },
  {
    tool_name: "nodegraph.graph.create",
    side_effect_level: "sandbox",
    default_decision: "confirm",
    decision: "confirm",
    source: "default",
  },
] as const;

/** 图助手工具策略第一方路由 handlers（project p1）。 */
export const graphAssistantToolPolicyHandlers = [
  http.get(`${API_BASE}/projects/p1/graph-assistant/tool-policy`, () =>
    HttpResponse.json({ items: sampleToolPolicyItems }),
  ),
  http.put(`${API_BASE}/projects/p1/graph-assistant/tool-policy`, async ({ request }) => {
    const body = (await request.json())as { policies: Array<{ tool_name: string; decision: string }>};
    const overrides = new Map(body.policies.map((policy) => [policy.tool_name, policy.decision]));
    const items = sampleToolPolicyItems.map((item) => {
      const override = overrides.get(item.tool_name);
      return override
        ? { ...item, decision: override, source: "override" }
        : { ...item };
    });
    return HttpResponse.json({ items });
  }),
];

/** 一条待确认工具调用样本（后端 snake_case 形态；会话 c1）。 */
export const samplePendingToolCall = {
  id: "ptc1",
  conversation_id: "c1",
  branch_id: "main",
  floor_id: "f1",
  call_id: "call_1",
  tool_name: "nodegraph.graph.create",
  args: { name: "New Graph", mode: "native_graph" },
  side_effect_level: "irreversible",
  status: "pending",
  created_at: 0,
  updated_at: 0,
  expires_at: null,
} as const;

/** 续跑结果样本（respond 结果子集；会话 c1）。 */
export const sampleResolveResult = {
  conversation_id: "c1",
  branch_id: "main",
  floor_id: "f2",
  floor_no: 2,
  page_id: "pg2",
  generated_text: "Done.",
  total_usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  final_state: "assistant_message_committed",
} as const;

/** 图助手「执行前确认闸」恢复接口第一方路由 handlers（会话 c1）。 */
export const graphAssistantConfirmationHandlers = [
  http.get(`${API_BASE}/temporary-conversations/c1/pending-tool-calls`, () =>
    HttpResponse.json({ items: [samplePendingToolCall] }),
  ),
  http.post(
    `${API_BASE}/temporary-conversations/c1/pending-tool-calls/:confirmationId`,
    async ({ request }) => {
      const body = (await request.json()) as { decision: "approve" | "reject" };
      if (body.decision === "reject") {
        return HttpResponse.json({
          data: {
            decision: "rejected",
            pending_tool_call: { ...samplePendingToolCall, status: "rejected" },
          },
        });
      }
      return HttpResponse.json({
        data: {
          decision: "approved",
          pending_tool_call: { ...samplePendingToolCall, status: "approved" },
          result: sampleResolveResult,
        },
      });
    },
  ),
];

export interface SseEvent {
  event: string;
  data: Record<string, unknown>;
}

/** 构造一个 text/event-stream 响应（同步入队后关闭，readSseStream 缓冲解析）。 */
export function sseResponse(events: SseEvent[]) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const item of events) {
        controller.enqueue(encoder.encode(`event: ${item.event}\ndata: ${JSON.stringify(item.data)}\n\n`));
      }
      controller.close();
    },
  });
  return new HttpResponse(stream, { headers: { "Content-Type": "text/event-stream" } });
}

/** 默认一条成功 respond 流：start → run(generating) → chunk*2 → done。 */
export const defaultRespondEvents: SseEvent[] = [
  { event: "start", data: { floor_id: "f1", floor_no: 1, branch_id: "main" } },
  {
    event: "run",
    data: {
      floor_id: "f1",
      run_id: "r1",
      run_type: "respond",
      status: "running",
      phase: "page_generating",
      public_phase: "generating",
      phase_seq: 1,
      attempt_no: 1,
      started_at: 1,
      updated_at: 2,
    },
  },
  { event: "chunk", data: { chunk: "Hello" } },
  { event: "chunk", data: { chunk: " world" } },
  {
    event: "done",
    data: {
      floor_id: "f1",
      floor_no: 1,
      generated_text: "Hello world",
      summaries: [],
      total_usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
    },
  },
];

/** respond/stream SSE handler（会话 s1）。 */
export function respondStreamHandler(events: SseEvent[] = defaultRespondEvents) {
  return http.post(`${API_BASE}/sessions/s1/respond/stream`, () => sseResponse(events));
}
