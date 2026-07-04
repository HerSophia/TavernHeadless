---
outline: [2, 3]
---

# NodeGraph Runtime（图运行时）

NodeGraph Runtime 是 R5 引入的图执行面：图定义可版本化、可校验、可预览、可后台运行，并记录 `node_graph_run` / `node_graph_node_run` trace。B8-GOV 起，`node_graph_run.trace` 会在保留原有字段的同时，补充统一治理摘要字段，便于后续和 Agent、ToolCall、Injection、Temporary Conversation 的 trace 一起查询。

这组接口挂在 Project 下，响应不使用通用 `data` 包裹。读、校验和无副作用预览需要 `project.nodegraph.read`，创建和版本写入需要 `project.nodegraph.write`，后台运行需要 `project.nodegraph.run`。

它是 [Workspace / Project](./workspace-project) 族里的高级编排能力。如果你只是普通聊天接入，不需要看这页。

::: warning Worker 启用条件
`POST /projects/:id/node-graphs/:graph_id/run` 只会入队 `graph.run` 作业。真实后台消费需要 API 进程启用 `ENABLE_NODE_GRAPH_WORKER=true` 并启动 `NodeGraphWorker`。未启动 worker 时，作业会停留在 Background Job Runtime 的 pending 队列中。

如果图里的 `agent.call` 节点使用 `background_job` 介质，NodeGraph worker 会把它路由为 `agent.run` 作业；这些后台 Agent 作业还需要 `ENABLE_AGENT_RUNTIME_WORKER=true` 才会被实际消费。
:::

## 什么时候需要看这页

- 你要在某个 Project 下定义、版本化一张节点图，并在执行前做校验。
- 你要在不调用真实模型、不写库的前提下，预览某个节点或整张图的输出。
- 你要把一张图作为后台作业运行，并回看 `node_graph_run` / `node_graph_node_run` trace。
- 你要理解图里 `agent.call` 节点在 `single_call` / `temporary_conversation` / `background_job` 三种介质下的行为边界。

## 一个简单例子

一张图从定义、校验、预览到后台运行、回看 trace，通常按这个顺序：

1. `POST /projects/:id/node-graphs`：创建图定义，提交第一版 `document`。
2. `POST /projects/:id/node-graphs/:graph_id/validate`：执行前校验，确认 `isExecutable` 为 `true`。
3. `POST /projects/:id/node-graphs/:graph_id/preview`：无副作用预览节点输出，确认组装结果符合预期。
4. `POST /projects/:id/node-graphs/:graph_id/run`：入队后台运行作业，拿到 `job_id`。
5. `GET /projects/:id/node-graph-runs/:run_id`：回看 run 与 node_runs trace。

```bash
# 创建一张最简单的图定义
curl -X POST http://localhost:3000/projects/proj_main/node-graphs \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Main response graph",
    "document": {
      "schemaVersion": 1,
      "graphId": "ngraph_main",
      "name": "Main response graph",
      "mode": "native_graph",
      "nodes": [],
      "edges": [],
      "policies": {}
    }
  }'
```

## 先理解几个词

| 词 | 这里的意思 |
| ---- | ---- |
| NodeGraphDocument | 一张图的定义，包含 `schemaVersion`、`nodes`、`edges`、`policies`、`permissions` |
| typed port | 一个节点可同时暴露多个命名输出端口，例如 `messages`、`prompt_ir`、`diagnostics` |
| preview | 无副作用预览：LLM、工具、写入节点只返回 cached / synthetic / dry-run 结果 |
| run | 后台运行作业（`graph.run`），由 `NodeGraphWorker` 消费 |
| commit phase | 唯一持久化边界，只有此阶段的 `output.*` 节点才能写持久输出 |
| node_graph_run / node_graph_node_run | 图运行与节点运行的 trace 记录 |
| `agent.call` 介质 | 节点调用 Agent 的方式：`single_call` / `temporary_conversation` / `background_job` |
| nested job ref | `agent.call` 以 `background_job` 运行时，trace 中暴露的子作业引用 |

## 核心对象

### NodeGraphDocument

第一版 document 使用 `schemaVersion: 1` 和 `mode: "native_graph"`：

```json
{
  "schemaVersion": 1,
  "graphId": "ngraph_main",
  "name": "Main response graph",
  "mode": "native_graph",
  "nodes": [
    {
      "id": "history",
      "type": "source.chat_history",
      "typeVersion": "1",
      "phase": "pre_response"
    }
  ],
  "edges": [],
  "policies": {},
  "permissions": {
    "required": []
  }
}
```

### Preview

节点输出包含 `value`、按端口命名的 `outputs`、`preview` 和 `diagnostics`。executor 解析 edge 时优先读取 `outputs[edge.from.port]`，因此同一个节点可以同时暴露 `messages`、`prompt_ir`、`diagnostics` 等多个 typed port。

实时 preview 默认无副作用：LLM、工具和写入节点只返回 cached / synthetic / dry-run 结果，不自动调用外部模型或写库。

### R5.1 执行契约

`NodeGraphExecutor` 是 prepare-only：它只编译、执行节点、计算 input/output hash、生成 node status、pending output dispatch request、nested job refs 和 trace summary，不写 `node_graph_run` / `node_graph_node_run`，也不直接派发持久输出。

`NodeGraphRuntimeJobProcessor.commit()` 是唯一持久化边界：

- preview / dry-run 不写持久输出，也不会为 `agent.call` 意外入队后台作业。
- normal run 只有在 graph 执行成功时才派发 pending `output.*` 请求。
- failed run 仍会写入 run trace 和已执行 node runs，但不会派发持久输出。
- `output.*` 持久写节点必须运行在 `commit` phase，并且 graph policy 必须设置 `allowPersistentOutputs: true`。

Node run 状态包括 `succeeded`、`failed`、`skipped`、`reused` 和保留的 `running`。节点失败策略为：

- `fail_closed`：默认策略，节点失败会让 graph run 失败。
- `fail_open`：节点记录为 failed，但 graph 可继续；持久写节点不能使用该策略。
- `skip`：节点失败后记录为 skipped，graph 继续。
- `use_default`：节点失败后使用 `config.defaultOutput` / `config.defaultValue` / `config.fallbackValue`。

### Validator 收紧项

R5.1 会在执行前拒绝以下图：

- required input 既没有 data edge，也没有由 node config 提供同名输入。
- 非 `multiple` input port 有多条 data edge。
- `control` edge 在 `schemaVersion: 1` 仍报 `node_graph_control_edge_unsupported`；`schemaVersion: 2` 起放行（见下文 NG2-CORE）。
- `agent.call` 使用 `background_job` medium，但 graph policy 未设置 `allowBackgroundJobs: true`。
- subgraph group 声明 input/output ports，但缺少 `group.input` / `group.output` 边界节点。

### `agent.call` medium

`agent.call` 支持三种 medium 的明确行为：

- `single_call`：R5.1 normal run 不伪造 inline executor，会返回 `node_graph_agent_call_single_call_unsupported` 诊断；dry-run 返回 planned trace。
- `temporary_conversation`：需要注入 temporary conversation executor，缺少依赖时以节点失败诊断暴露。
- `background_job`：需要 `allowBackgroundJobs: true` 和配置了 background job enqueuer 的 `AgentExecutorRouter`。normal run 会入队 `agent.run`，并在 node output / run trace 中暴露 nested job ref；dry-run 只返回 planned trace。

## 接口一览

```http
GET    /projects/:id/node-graphs
POST   /projects/:id/node-graphs
GET    /projects/:id/node-graphs/:graph_id
GET    /projects/:id/node-graphs/:graph_id/versions
POST   /projects/:id/node-graphs/:graph_id/versions
POST   /projects/:id/node-graphs/:graph_id/validate
POST   /projects/:id/node-graphs/:graph_id/preview
POST   /projects/:id/node-graphs/:graph_id/run
GET    /projects/:id/node-graph-runs/:run_id
POST   /projects/:id/node-graphs/:graph_id/archive
POST   /projects/:id/node-graphs/:graph_id/unarchive
POST   /projects/:id/node-graphs/:graph_id/current-version
POST   /projects/:id/node-graphs/:graph_id/export
POST   /projects/:id/node-graph-imports/preflight
POST   /projects/:id/node-graph-imports
```

读、校验、预览、导出需要 `project.nodegraph.read`；创建、版本写入、导入预检与导入需要 `project.nodegraph.write`；后台运行需要 `project.nodegraph.run`；归档 / 取消归档 / 切换当前版本与节点输出正文 debug 查看需要 `project.nodegraph.manage`。

## 创建图

```http
POST /projects/:id/node-graphs
```

请求体：

```json
{
  "name": "Main response graph",
  "document": {
    "schemaVersion": 1,
    "graphId": "ngraph_main",
    "name": "Main response graph",
    "mode": "native_graph",
    "nodes": [],
    "edges": [],
    "policies": {}
  }
}
```

响应 `201` 返回 `definition`、`version` 和 `validation`。

## 创建版本

```http
POST /projects/:id/node-graphs/:graph_id/versions
```

保存前会运行 compiler / validator；存在 error diagnostics 时返回 `node_graph_document_invalid`。

## 校验图

```http
POST /projects/:id/node-graphs/:graph_id/validate
```

响应包含：

```json
{
  "isExecutable": true,
  "diagnostics": [],
  "topologicalLevels": [["history"], ["messages"]]
}
```

## 预览图

```http
POST /projects/:id/node-graphs/:graph_id/preview
```

请求体可指定 `version_id`、`node_id`、`input_json`、`user_input`、`chat_history` 和 `cached_node_outputs`。若提供 `node_id`，响应只保留该节点输出。

响应中的 `nodeOutputs` 以节点 ID 为 key。每个节点输出示例：

```json
{
  "value": [{ "role": "user", "content": "你好" }],
  "outputs": {
    "messages": [{ "role": "user", "content": "你好" }],
    "prompt_ir": {
      "kind": "node_graph_prompt_ir",
      "messages": [{ "role": "user", "content": "你好" }]
    },
    "diagnostics": []
  },
  "preview": {
    "kind": "messages",
    "title": "Final Messages",
    "source": "dry_run"
  }
}
```

## 后台运行

```http
POST /projects/:id/node-graphs/:graph_id/run
```

请求体：

```json
{
  "intent": "dry_run",
  "dry_run": true,
  "input_json": {
    "user_input": "继续这一幕",
    "chat_history": [
      { "role": "user", "content": "你好" }
    ]
  }
}
```

响应 `202`：

```json
{
  "job_id": "graph-job:ngraph_main:...",
  "created": true,
  "graph_id": "ngraph_main",
  "graph_version_id": "ngver_...",
  "worker_enabled": false
}
```

`worker_enabled` 反映 API 进程是否启用了 `NodeGraphWorker`（`ENABLE_NODE_GRAPH_WORKER=true`）。入队成功（`created: true`）并不等于作业会被执行——`worker_enabled` 为 `false` 时作业会停留在 pending 队列，直到 worker 被启用。

## 读取运行 Trace

```http
GET /projects/:id/node-graph-runs/:run_id
```

返回 `run` 与 `node_runs`。`input_hash` / `output_hash` 可用于确认输入输出是否变化。

::: warning 节点输出可见性分层（R6-3）
默认（`project.nodegraph.read`）返回的 `node_runs` 会裁剪正文：`preview` 与 `diagnostics` 置为 `null`，并标注 `restricted: true`；`run.trace` 保留治理摘要、状态计数与输出 / 嵌套引用的目标和状态，但移除可能含派发记录正文的 `outputDispatchResults` 与每个 ref 的 `result`，顶层返回 `restricted: true`。

要取回完整正文（节点 `preview` / `diagnostics`、派发记录正文），调用方需要 `project.nodegraph.manage` 并显式带 `?include_node_output=true`。命中后返回 `restricted: false`，并写 `node_graph_run.inspect` 审计；权限不足时该开关被静默忽略，仍返回裁剪结果。
:::

`run.trace` 包含结构化调试摘要。原有 NodeGraph 字段仍然保留，同时增加 B8-GOV 统一治理字段：

```json
{
  "contract_version": "b8-governance.v1",
  "runtime_kind": "node_graph_run",
  "run_id": "ngrun_...",
  "root_run_id": "ngrun_...",
  "parent_run_id": null,
  "source_kind": "runtime_job",
  "source_ref": {
    "job_id": "graph-job:ngraph_main:...",
    "job_type": "graph.run"
  },
  "target_kind": "node_graph",
  "target_ref": {
    "project_id": "proj_...",
    "graph_id": "ngraph_main",
    "graph_version_id": "ngver_..."
  },
  "status": "succeeded",
  "reason_code": "succeeded",
  "diagnostics": {
    "failed_node_id": null,
    "failed_node_count": 0,
    "compile_diagnostic_count": 0,
    "first_reason_code": null,
    "status_counts": {
      "skipped": 0,
      "running": 0,
      "succeeded": 3,
      "failed": 0,
      "reused": 0
    }
  },
  "dry_run": false,
  "preview": false,
  "side_effects": {
    "output_dispatch": {
      "count": 1,
      "planned": 0,
      "pending": 0,
      "dispatched": 1,
      "rejected": 0,
      "result_count": 1,
      "targets": ["derived_output"],
      "target_counts": {
        "derived_output": 1
      }
    },
    "nested_job": {
      "count": 0,
      "created": 0,
      "dry_run": 0,
      "refs": []
    },
    "operation_log": {
      "written": false
    }
  },
  "graphId": "ngraph_main",
  "intent": "normal",
  "topologicalLevels": [["history"], ["messages"], ["write"]],
  "compileDiagnostics": [],
  "statusCounts": {
    "skipped": 0,
    "running": 0,
    "succeeded": 3,
    "failed": 0,
    "reused": 0
  },
  "failedNodeId": null,
  "failedNodes": [],
  "outputDispatchRefs": [
    {
      "nodeId": "write",
      "target": "derived_output",
      "status": "dispatched"
    }
  ],
  "nestedJobRefs": []
}
```

失败 run 会保留 `failedNodeId`、`failedNodes` 和 `error`，并把第一个稳定失败原因映射到 `reason_code`。即使没有任何持久输出被派发，也可以通过 trace 定位失败节点。

## R6 运行治理（预算、背压与运行追溯）

R6-1 / R6-2 在不改变图执行语义的前提下，为 NodeGraph 运行补充了运行追溯、运行级审计与预算 / 背压上限。

### 运行级 operation log 与双向血缘

- `commit` 会写运行级 operation log：成功写 `node_graph_run.run`，失败写 `node_graph_run.failed`（带 reason code 与失败节点）；真实派发持久输出写 `node_graph_run.output_dispatched`。这些日志只保存摘要、reason code 与副作用计数，不写 node output / prompt / 工具结果正文。
- `agent.call` 以 `background_job` 入队的 `agent.run` 作业会在其 payload 上记录父级运行引用（`parent_run_id` 指向 graph run、`parent_runtime_kind = node_graph_run`、`root_run_id`），与 graph trace 的 `nestedJobRefs(jobId)` 形成**双向**血缘，便于从一次 graph run 追到子作业、或从子作业回查父级运行。
- Agent 自修改图的 `nodegraph.patch.submit_proposal` 会写 `node_graph.proposal.submit` 审计 action，并关联生成的 Project Inbox 记录。

### 运行预算与同步成本上限

NodeGraph 运行有一组默认预算，超限会让运行以失败结束（不执行节点、不派发输出），或在同步接口上直接拒绝：

| 维度 | 适用范围 | 超限 reason code |
| ---- | ---- | ---- |
| 最大节点数 | 运行 / 同步 preview / validate | `node_graph_budget_max_nodes_exceeded` |
| 最大拓扑深度 | 运行 / preview | `node_graph_budget_max_depth_exceeded` |
| 单层最大节点数（fan-out） | 运行 / preview | `node_graph_budget_max_fan_out_exceeded` |
| 最大嵌套 agent 作业数 | 仅真实运行 | `node_graph_budget_max_nested_agent_jobs_exceeded` |
| 最大临时对话数 | 仅真实运行 | `node_graph_budget_max_temporary_conversations_exceeded` |
| 运行时长软上限 | 仅真实运行 | `node_graph_budget_max_duration_exceeded` |

- 嵌套作业 / 临时对话上限只在真实运行计入；dry-run / preview 不入队，不受这两项约束。
- `/preview` 与 `/validate` 在编译前做节点数 size 检查，超限返回 `422` + 对应 reason code，避免单个同步请求拖垮 API 进程；同步 preview 还套用更严格的深度 / fan-out 预算。

::: tip `maxParallelNodes` 是保留字段
`policies.maxParallelNodes` 当前为**保留字段**：executor 顺序执行，不消费它，也不承诺真正的并发语义。单层最大节点数请用上面的 fan-out 预算治理。
:::

### 项目级跨图并发桶

同一张图的运行保持 FIFO 串行；在此之上，`POST /projects/:id/node-graphs/:graph_id/run` 入队前会检查该 project 当前活跃（pending / leased / running / retry_waiting）的 `graph.run` 作业数。达到项目级上限时返回：

```http
429 node_graph_run_project_concurrency_exceeded
```

后台 Agent 运行（`agent.run`）也有输出派发数上限，超限会让该次运行以 `agent_run_budget_max_output_dispatch_exceeded` 失败，避免单次运行无限扩张持久副作用。

## R6-3 运行治理（清理、manifest 强制、归档与运维）

R6-3 在不扩展图编辑器 / 节点生态的前提下，补齐运行清理、manifest 运行时强制、节点输出可见性分层、图归档 / 版本回滚与 worker 运维。

### 运行清理（retention）

终态 NodeGraph 运行（`succeeded` / `failed` / `cancelled`）的 node-run 正文（`preview_json` / `diagnostics_json`，可能含最终 prompt messages、agent brief）会在审计保留宽限期后被裁剪为 `null`，并在 `node_graph_run` 上写 `cleaned_at`；run 行、node-run 行结构、状态、phase、时间戳与 `input_hash` / `output_hash` 始终保留。清理由通用维护循环 `RuntimeMaintenanceService` 执行，只写 `node_graph_run.cleanup` 摘要日志，不写正文。

相关配置：

- `ENABLE_RUNTIME_MAINTENANCE=true`：启用通用维护循环（清理的前提）。
- `ENABLE_NODE_GRAPH_RUN_CLEANUP`：是否裁剪终态 NodeGraph 运行正文（默认 `true`）。
- `NODE_GRAPH_RUN_CLEANUP_GRACE_MS`：终态到正文裁剪之间的审计保留宽限期（毫秒，默认 `0`）。

### manifest 运行时强制

`NodeGraphPermissionManifest.outputTargets` 从“声明却不强制”升级为 commit 阶段的运行时收窄：

- 图未声明 `outputTargets`：维持原行为，仅由全局输出策略兜底。
- 图声明了 `outputTargets`（含空数组）：只有在白名单内的持久输出目标才会派发；不在白名单内的输出被拒绝（不落库），在 `run.trace.outputDispatchRefs` 中标记 `status: "rejected"`、`reason: "node_graph_output_target_not_in_manifest"`，并写 `node_graph_run.output_rejected` 审计。空数组表示该图声明不产出任何持久输出。

### 图归档 / 版本回滚 / 设当前版本

以下接口需要 `project.nodegraph.manage`：

```http
POST /projects/:id/node-graphs/:graph_id/archive
POST /projects/:id/node-graphs/:graph_id/unarchive
POST /projects/:id/node-graphs/:graph_id/current-version
```

- `archive` / `unarchive`：切换图状态。归档图拒绝创建新版本（`409 node_graph_archived`），但保留所有版本与运行历史，可经 `unarchive` 恢复。分别写 `node_graph.archive` / `node_graph.unarchive` 审计。
- `current-version`：请求体 `{ "version_id": "ngver_..." }`，把当前版本显式切到一个属于该图的已有版本（含回滚到旧版本）。归档图禁止切换。写 `node_graph.version.set_current` 审计，记录 before / after 版本与是否为回滚。

### worker 运维

`ENABLE_NODE_GRAPH_WORKER=true` 是后台消费 `graph.run` 作业的前提，与 `ENABLE_AGENT_RUNTIME_WORKER` 口径一致。`POST …/run` 响应中的 `worker_enabled` 字段反映 worker 是否启用，便于在“入队成功但未被执行”时快速定位是 worker 未启用。

## R6-4 评估指标与默认启用硬化

R6-4 建立最小评估闭环与默认启用检查清单，不做完整评估平台。

### 最小评估指标（debug report）

`RuntimeEvaluationService.evaluate(scope)` 从已有运行 trace（`node_graph_run` / `node_graph_node_run` / agent `runtime_job`）采样，产出一份 **debug report**。评估结果只作为调试 / 派生输出参考，**不直接影响主叙事提交**，也不写入任何 live 状态。报告按 `accountId` 做账号隔离，可按 `projectId` / `sessionId` / `rootRunId` 收窄。

指标键（`contract_version = b8-governance.v1`）：

| 指标 | 来源 | 状态 |
| ---- | ---- | ---- |
| `graph_failure_reason` | 采样 graph run 的 status 与 reason_code | 可采样：失败率 + reason_counts |
| `nested_job_fan_out` | graph run trace 的 `nestedJobRefs` | 可采样：平均 / 最大 fan-out |
| `retry_reuse` | node run `statusCounts.reused` 占比 | 可采样：reuse 比例 |
| `latency` | node run `started_at` / `finished_at` | 有计时样本时可采样（ms） |
| `token_usage` | 需接入 Prompt Runtime budget | 预留 `not_sampled` |
| `player_agency` | 需打分器 / LLM 评审 | 预留 `not_sampled` |
| `state_contradiction` | 需打分器 | 预留 `not_sampled` |
| `memory_quality` | 需打分器 | 预留 `not_sampled` |

每个指标返回 `{ key, status, value, unit, detail, note }`。`status = "sampled"` 表示从 trace 计算得到；`status = "not_sampled"` 表示需要打分器，结构预留但不臆造数值。

### A/B baseline 预留

报告带一个 `abBaseline` 槽位（当前 `enabled: false`），并提供 `RuntimeEvaluationService.compareReports(baseline, candidate)` 对两份报告的数值指标求差（缺值时 delta 为 `null`）。这只是为后续平台化预留数据结构，R6-4 不做真实 A/B 调度。

### 默认启用硬化检查清单

要让一个 Project 较稳地启用 Agent / NodeGraph Runtime（无需大量人工盯防），建议确认以下默认组合：

- **Worker**：`ENABLE_AGENT_RUNTIME_WORKER=true` 与 `ENABLE_NODE_GRAPH_WORKER=true`（否则入队 ≠ 执行）。
- **维护循环**：`ENABLE_RUNTIME_MAINTENANCE=true`，并保持 `ENABLE_PROMPT_RUNTIME_INJECTION_CLEANUP` / `ENABLE_TEMPORARY_CONVERSATION_CLEANUP` / `ENABLE_NODE_GRAPH_RUN_CLEANUP` 默认开启，让过期注入、终态临时对话与终态运行正文按宽限期清理。
- **失败策略**：节点默认 `fail_closed`；持久写节点不得使用 `fail_open`。
- **提交边界（commit gate）**：`output.*` 持久写节点只在 `commit` phase 运行，且 graph policy 需 `allowPersistentOutputs: true`；`output.commit_gate` 始终产出 proposal decision，不直写主叙事。
- **权限 manifest**：对会产出持久输出的图显式声明 `permissions.outputTargets`，让运行时按图收窄输出目标。
- **预算 / 背压**：保留 R6-2 的运行预算、项目级跨图并发桶与 agent run 输出派发上限默认值，避免单次运行无限扩张。
- **可见性**：节点输出正文默认裁剪，debug 查看走 `project.nodegraph.manage` + `include_node_output=true` 并留审计。

guard / verifier / LLM 路由的默认 profile 仍由 Project 的 Agent 绑定与 LLM Profile 决定（见 [Project Agent Bindings](./project-agent-bindings) 与 [LLM Profiles](./llm-profiles)）；R6-4 的硬化范围只覆盖上面这组运行时治理默认值。

## NG2-CORE：NodeGraph v2 运行契约（批次 9）

NG2-CORE 在 v1 内核之上做**向后兼容**的扩展：激活 control edge 最小执行语义、持久 floor checkpoint / input-hash reuse、`schemaVersion: 2` 与 v1 → v2 迁移。`schemaVersion: 1`（或缺省）文档仍按 v1 语义运行，行为不回归。创建 / 版本接口现同时接受 `schemaVersion` 为 `1` 或 `2`。

### schemaVersion 2 文档边界

v2 在 v1 顶层结构上扩展（全部可选，缺省即 v1 行为）：

- `edges[].kind` 改为可选，缺省视为 `data`；`control` 边只在 v2 放行。
- 节点新增 `scope`：`floor_stable` / `pre_response_deterministic` / `pre_response_stochastic` / `page_volatile`，决定是否进入 floor checkpoint。
- 节点新增 `checkpointPolicy`：`reuse_on_regen`（默认）/ `rerun_on_regen` / `manual_refresh`。
- 节点组新增 `checkpointPolicy`（沿用 `reuse_if_inputs_same` 等 retry policy 取值）。
- `metadata.systemGraph: true` 标识 system graph，受更严格校验（必含唯一 `narration.narrator`、唯一 `output.commit_gate` 与至少一个 `compose.final_messages`）。

### control edge 与控制流节点

control edge 只表达「是否执行下游节点」，不传数据（数据仍走 data edge）。新增三类控制流节点：

| 类型 | 角色 | 关键端口 |
| ---- | ---- | ---- |
| `control.condition` | 求值结构化条件，输出 boolean | 输出 `result`（boolean，走 data edge） |
| `control.branch` | true/false 路由 | 控制输出 `true` / `false` |
| `control.gate` | 带 onSkip 的门控 | 控制输出 `open` |

- 条件是结构化 `ConditionExpr`（`eq/neq/gt/gte/lt/lte/exists/empty/contains/and/or/not`），`ValueRef` 带受控来源 `variable` / `session_state` / `node_output` / `runtime`，禁止任意代码或自然语言。
- 目标节点的执行规则：无 incoming control edge → 正常运行；有 → 任一 control edge active 才运行；全部 inactive → 按 onSkip 处理。
- gate 的 `onSkip`：`empty_output`（默认，状态 `skipped`）/ `use_cached`（有缓存则 `reused`）/ `use_default`（用节点默认输出，状态 `succeeded`）/ `error`（状态 `failed`，按 failurePolicy 处理）。
- dry-run 会在控制流节点输出的 `controlTrace` 中暴露条件求值轨迹。
- 校验新增：control edge 必须从控制节点的控制端口出发（否则 `node_graph_control_edge_invalid_source`）；条件复杂度上限（最大深度 5、单个 and/or 子项 16）；`node_output` 引用必须是上游祖先（否则 `node_graph_condition_node_output_not_upstream`）。

### 持久 checkpoint 与 input-hash reuse

```text
节点输出 = f(inputHash, node config, graph version, floor)
全部一致时，PageRun（同一 floor 的重试）复用 FloorRun 已算的节点，不重跑。
```

- checkpoint **归属 FloorRun**：只有 `floor_prepare` / `pre_response` 且 opt-in 的节点（`scope = floor_stable` / `pre_response_deterministic`，或 `retryPolicy ∈ {reuse_if_inputs_same, rerun_if_upstream_changed}`）进入持久 checkpoint；`response` barrier 之后的节点永不进入。
- 复用键按 `(floorId, graphVersionId, nodeId)` 唯一：新版本天然失效旧 checkpoint。命中要求 `input_hash` 与 `config_hash` 同时一致。
- 复用命中 / miss 可解释：命中时该节点 run 状态为 `reused`，并在 `run.trace.checkpointReuse` 暴露 `reused` 列表与 miss 原因（`no_checkpoint` / `input_hash_changed` / `config_hash_changed` / `manual_refresh`）。
- 只有真实运行（非 dry-run / preview）且带 `floor_id` 才读写 checkpoint。失败 run 也会为已成功的 floor-eligible 节点保留 checkpoint，供下次重试复用。
- 清理复用 R6-3 模式：`RuntimeMaintenanceService` 在宽限期后裁剪 checkpoint 的 `output_json` 正文、写 `cleaned_at`、写 `node_graph_run.checkpoint_cleanup` 摘要日志，保留结构与 hash。默认开启，可经 `nodeGraphCheckpoint.enabled` 关闭。

### v1 → v2 迁移

- 读路径兼容：v2 runtime 直接加载 v1 文档，按 data-only、无 control、无 checkpoint 运行。
- 写路径升级：`migrateNodeGraphDocumentToV2` 把 `schemaVersion` 升为 2、给所有 edge 补 `kind: "data"` 缺省，幂等且不改变既有执行结果。
- 迁移诊断：`detectNodeGraphSchemaMigration` 对低于 v2 的文档产出 `MIGRATION_AVAILABLE`（info）。完整 node-type / capability 兼容性诊断（`MIGRATION_REQUIRED` 等）见下文 NG2-PKG。

## NG2-PKG：package 导入 / 导出（批次 9）

NG2-PKG 让图能安全地跨环境分发与落地：导出不再是裸 graph JSON，而是带 manifest / 兼容性 / 依赖 / 权限 / 安全摘要 / 完整性的 **NodeGraphPackage**；导入前在**执行前**对照 Workspace（已安装节点类型 / capability）与 Project（权限）边界产出缺失依赖诊断，区分可降级与不可降级，并需要用户确认后才安装。

### 导出 package

```http
POST /projects/:id/node-graphs/:graph_id/export
```

请求体（均可选）：

```json
{ "version_id": "ngver_...", "package_version": "1.0.0" }
```

不带 `version_id` 时导出当前版本；导出时 document 统一升为 schemaVersion 2。响应：

```json
{
  "package": {
    "kind": "tavernheadless.nodegraph",
    "schemaVersion": "1",
    "metadata": { "id": "...", "name": "...", "version": "v3" },
    "compatibility": { "minTavernHeadlessVersion": "0.1.0", "graphApiVersion": "2" },
    "graph": { "schemaVersion": 2, "...": "..." },
    "dependencies": {
      "nodeTypes": [{ "type": "narration.narrator", "typeVersion": "1" }],
      "capabilities": ["agent_runtime"],
      "mcpServers": [],
      "sessionStateNamespaces": []
    },
    "permissions": [{ "permission": "project.agent.run" }],
    "integrity": { "contentHash": "sha256:..." }
  },
  "security_summary": { "...": "..." },
  "graph_id": "...",
  "version_id": "...",
  "version_no": 3
}
```

依赖与权限由图自动推断：节点类型来自图中节点；capability 按节点类型映射（如 `agent.*` → `agent_runtime`、`select.memory_retrieve` → `memory`）；MCP server / session state namespace / asset 来自节点配置；权限是图 manifest 与各节点 registry `permissionsRequired` 的并集。导出写 `node_graph.export` 审计（只记摘要与 hash，不记图正文）。

### 导入预检

```http
POST /projects/:id/node-graph-imports/preflight
```

请求体：`{ "package": { ... } }`。响应在**执行前**给出统一缺失依赖诊断与安全摘要，不安装任何东西：

```json
{
  "package_id": "...",
  "content_hash": "sha256:...",
  "installable": true,
  "migration_available": false,
  "migration_required": false,
  "counts": { "error": 0, "warning": 0, "info": 0 },
  "diagnostics": [],
  "required_node_types": ["narration.narrator@1"],
  "missing_node_types": [],
  "degradable_node_types": [],
  "security_summary": {
    "long_term_data_reads": ["chat_history"],
    "session_state_namespace_reads": [],
    "proposes_committed_writes": false,
    "persistent_output_targets": [],
    "mcp_servers": [],
    "requests_network_access": false,
    "requests_file_write": false,
    "required_permissions": []
  }
}
```

`GraphImportDiagnostic.code` 取值：`NODE_TYPE_MISSING`、`NODE_VERSION_INCOMPATIBLE`、`GROUP_MISSING`、`CAPABILITY_MISSING`、`PERMISSION_REQUIRED`、`SESSION_STATE_NAMESPACE_MISSING`、`MCP_SERVER_MISSING`、`ASSET_REFERENCE_MISSING`、`MIGRATION_AVAILABLE`、`MIGRATION_REQUIRED`。每条带 `severity`、`message`、可选 `nodeId` / `dependencyId`、`degradable` 与 `resolution`（建议动作）。

降级判定（纲领第 10.5 节）：

- 可降级（`severity: "warning"`，跳过并警告）：StyleVerifier / DirectorAgent 等可选节点缺失、capability 缺失、MCP server 缺失、非写入用途的 namespace 缺失、资产缺失、待授予权限。
- 不可降级（`severity: "error"`，阻断安装）：`compose.final_messages` / `narration.narrator` / `output.commit_gate` / 控制流节点等关键节点缺失、external group 引用缺失、写入用途的 session state namespace 缺失、面向更高 graph API 的包。

`installable` 为无 error 级诊断（降级 warning 不阻断安装）。

### 导入

```http
POST /projects/:id/node-graph-imports
```

请求体：`{ "package": { ... }, "confirm": true, "name": "可选名称" }`。

- 预检存在不可降级 error → 返回 `422 node_graph_package_not_installable`，缺失依赖诊断在 `error.details`。
- `confirm` 非 `true` → 返回 `200` 与 `{ "confirmed": false, "requires_confirmation": true, "preflight": { ... } }`，不安装（用户确认环节）。
- 预检通过且 `confirm: true` → 返回 `201`，按 v2 安装为**新图**（生成新 `graph_id`，避免与现有图冲突），响应含 `definition` / `version` / `validation` / `preflight`，并写 `node_graph.import` 审计。

预检接 Workspace / Project 边界：Workspace 决定是否安装了所需节点类型 / capability，Project 决定权限是否已授予。安全摘要复用批次 8 脱敏与 operation log 摘要约定。

## NG2-BRIDGE：native prompt system graph 灰度承载（批次 9）

NG2-BRIDGE 让 native prompt 主链在受控灰度路径下由内置 **system graph** 承载，而非一次性切换。它不重写编排逻辑：核心 PromptIR 仍由既有 compose 闭包产出，与命令式 composite 路径 **golden 一致**；system graph 只是 native 主链的「图化承载表达」，并把承载路径写进治理 trace。

### 承载路径与 system graph

native prompt 编排有两条承载路径：

- `composite`（默认）：既有命令式 native 编排（`CompositeTurnProcessor`）。
- `system_graph`：由内置 `system.native_prompt`（`metadata.systemGraph = true`）承载（`NodeGraphTurnProcessor`），节点覆盖 source → agent decision → compose → narrator → postprocess → verify → commit_gate，复用 NG2-CORE 的 system graph 严格校验（唯一 Narrator / 唯一 CommitGate + compose）。

`compat_strict` / `compat_plus` 永不进入 system graph 灰度（它们是 `prompt_mode` 处理器，零图化）。

### 灰度切流（effective config 分层）

承载决策按批次 8 effective config 分层解析：**Workspace 默认 → Project → Session**，后层覆盖前层。Workspace 默认由环境变量提供：

```bash
# 承载路径：composite（默认）| system_graph
NATIVE_PROMPT_SYSTEM_GRAPH_CARRIER=system_graph
# 影子运行：并行跑另一条承载路径并逐字段比对，只观测不切流
NATIVE_PROMPT_SYSTEM_GRAPH_SHADOW=true
```

`EffectiveConfigService.resolveNativePromptBridge()` 解析最终决策并标注 `source`（workspace / project / session）。缺省（未设置）为 `composite` + shadow off，与 NG2-BRIDGE 前行为完全一致。

### 三段式推进与影子比对

1. **影子（shadow）**：`NATIVE_PROMPT_SYSTEM_GRAPH_SHADOW=true` 时，承载路径之外并行运行另一条路径，对 prepared prompt 逐字段比对（`assemblyInputHash` / 装配标志 / PromptIR），差异写入内部 turn 装配元数据的 `bridgeComparison`，**只观测、不切流**。由于两条路径复用同一 compose 闭包，正常应完全一致；diff 非空即说明承载表达引入回归，必须切流前修复。
2. **灰度切流**：把 `NATIVE_PROMPT_SYSTEM_GRAPH_CARRIER` 设为 `system_graph`（可按 Project / Session override）。
3. **默认承载**：稳定后 system graph 成为 native 默认承载，命令式路径降级为回退。

### 边界保护与一键回退

- Narrator 唯一正文：system graph 中 Narrator 节点唯一，`node_graph` 处理器每次 execute 只 compose 一次。
- response barrier 后节点归 PageRun；CommitGate 仍是唯一正史写入边界；committed floor 与 R2.5 人工修订路径不被绕过。
- 一键回退：把承载决策设回 `composite`（清除环境变量或设 override）即回退，是**配置级动作，不回滚代码**。

承载路径与影子比对结果写进批次 8 统一治理 trace（`runtime_kind = "chat_turn"`，diagnostics 含 `carrier` / `system_graph_id` / `system_graph_version`），属内部元数据，不进入公共 OpenAPI / SDK。

## DG11：默认楼层运行模板图（批次 11）

DG11 在不改变系统图执行语义的前提下，给用户一份**与 `system.native_prompt` 同结构、可 fork、可编辑**的
**默认楼层运行模板**作为起点。心智模型见
`.limcode/design/agentic-batch10-wb10-agent-nodegraph-relationship-discussion.md` §10.5。

- **单一结构事实源**：楼层图的节点 / 边 / 权限骨架下沉到 `@tavern/core` 的
  `buildNativePromptFloorStructure()`；系统图（`buildNativePromptSystemGraph()`，`systemGraph = true`）与
  默认模板（`buildNativePromptFloorTemplate()`，`graphId = "template.native_prompt_floor"`、
  `systemGraph = false`、`metadata.template = "native_prompt_floor"`）都由它派生，结构由测试守卫，永不漂移。
- **系统图仍权威、不可改**：模板是它的同结构副本，二者运行期解耦——fork 出的图与系统图无耦合。
- **fork = 一次普通 `create`**：在 `apps/studio` 选「默认楼层模板」载入为可保存草稿，选定项目后保存即在该项目下
  新建一张普通可编辑 NodeGraph（走既有创建 / 版本体系）。**零配置可用**（载入即合法可执行可保存），
  **可编辑起点**（保存后是普通项目图，可任意增删改）。
- 不引入「agent ↔ graph 一等持久绑定」（模板 fork 不绑定为项目活跃楼层图），不扩展公共 HTTP / SDK 契约，
  不触发 `sdk:generate`，不改 `apps/web`。

## CG11：compat 模式图化（批次 11）

CG11 把 `compat_strict` / `compat_plus` 两种 SillyTavern 兼容编排，**与 native 同构**地纳入「由内置 system graph
承载 + 影子比对 + golden 等价门槛」的模式，守住兼容底线。心智模型见
`.limcode/design/agentic-batch11-cg11-compat-graphization-design.md`。

- **内置 compat system graph**：`system.compat_prompt`（`metadata.systemGraph = true`）。compat 主链**零 Agentic**，
  故结构是 native 的子集：`source.user_input` / `source.chat_history` → `compose.final_messages` →
  `narration.narrator` → `output.commit_gate`，**无** `agent.*` / `verify.*`，`permissions.required` 为空。
  `compat_strict` 与 `compat_plus` 结构相同（差异在 recipe / 装配），故只有这一张图。
- **可 fork 模板**：core `buildCompatPromptFloorTemplate()`（`graphId = "template.compat_prompt_floor"`、
  `systemGraph = false`），与系统图同结构（测试守卫），是用户可编辑的 compat 起点（studio 表层接入后续 CG11-2）。
- **承载灰度（compat bridge）**：承载路径 `prompt_mode`（默认，命令式 compat 编排）或 `system_graph`
  （由 compat system graph 承载，`NodeGraphTurnProcessor` + compat 描述符）。分层解析 Workspace 默认 → Project →
  Session（env `COMPAT_PROMPT_SYSTEM_GRAPH_CARRIER` / `..._SHADOW`），`EffectiveConfigService.resolveCompatPromptBridge`
  标注 source。缺省 `prompt_mode` + shadow off，与 CG11 前行为完全一致；设回 `prompt_mode` 即配置级一键回退。
- **影子比对 + golden 等价门槛**：开启 shadow 时并行跑两条承载并逐字段比对（复用 `compareTurnAssemblyResults`）。
  两条承载复用同一 compat 装配闭包，故 PromptIR / `assemblyInputHash` / 装配标志应**逐字段一致**；diff 非空即承载表达回归，
  **golden 不绿不切流**。承载路径写进治理 trace（`carrier` / `system_graph_id = system.compat_prompt` / `recipe_kind`）。
- compat 仍**零 Agentic**（compat 描述符只接受 `compat_strict` / `compat_plus`，图无 agent / verify 节点，无 inline 子 Agent）；
  Narrator 单一持笔 / CommitGate 单一正史不破坏；不扩展公共 OpenAPI / SDK，不触发 `sdk:generate`。

## SG11：内置可复用顾问子图（批次 11）

SG11 把楼层编排里的**顾问型子 Agent**（director / verifier / memory）从「父图里的单节点」抽成**独立、内置、
可复用的子图单元**，复用批次 10 已落地的 `group.node` 子图基建。设计见
`.limcode/design/agentic-batch11-sg11-builtin-advisor-subgraphs-design.md`。

- **四个内置顾问子图**（`metadata.subgraph = true` 的 v2 定义，结构 `group.input → 顾问节点 → group.output`）：
  `system.subgraph.director`（`messages → brief`，需 `project.agent.run`）、
  `system.subgraph.continuity_verifier`（`text` / `context → result`）、
  `system.subgraph.player_agency_verifier`（`text` / `context → result`）、
  `system.subgraph.memory_retrieve`（`query → selection`，需 `project.memory.read`）。
- **只产顾问输出、不写正史**：顾问子图内部**不含** `narration.narrator` / `output.commit_gate` / 持久 `output.*`；
  Narrator 唯一持笔 / CommitGate 单一正史不受影响。
- **内置引用解析（SG11-3）**：运行时 `subgraphRunner` 在加载被引用子图时，若 `group.node` 的 `config.ref.graphId`
  命中内置 id（`system.subgraph.*`），则从内置注册表加载（**无需 fork 进项目、不查 DB**）；其余 graphId 仍按租户范围查
  数据库。顾问执行复用现有嵌套 graph run 语义（与父图共享 `parent_run_id` / `root_run_id` 血缘，含环检测与深度上限）。
- **权限上卷校验**：内置子图所需权限必须被父图 `permissions.required` 声明，否则运行被拒绝
  （`node_graph_subgraph_permission_not_granted`，不形成隐藏副作用）。
- **引用版默认楼层模板**：`buildNativePromptFloorTemplateWithAdvisorRefs()`（`graphId =
  "template.native_prompt_floor_subgraph_refs"`）与 DG11 默认模板同主链结构，但把 director / verify 两个单节点顾问
  换为 `group.node` 分别引用内置 director / continuity verifier 子图；作为默认模板的进阶变体，其余骨架与权限沿用 DG11。
- 不子图化 Narrator、不改 executor；不扩展公共 OpenAPI / SDK，NodeGraph 不在生成面，不触发 `sdk:generate`。


## Agent 自修改边界

R5 提供 `NodeGraphToolProvider` 给 Agent 使用，但只暴露 draft / patch / validate / proposal 类工具，不提供：

- `nodegraph.version.apply_live`
- `nodegraph.graph.delete`
- `nodegraph.permission.modify`
- `nodegraph.project_binding.modify`

Project 绑定的 Session runtime catalog 会暴露 `nodegraph.*` 工具。Agent 可以读取图、创建内存草稿、修改节点 / 边 / group、运行校验和 diff，并通过 `nodegraph.patch.submit_proposal` 提交建议。

除上述工具外，还提供 `nodegraph.graph.create`：它从零创建一张**全新**图与其 v1 版本，是唯一会 live 持久写入的工具。它只创建新产物，不修改任何受保护的既有图；对既有图的改动仍只能经 `submit_proposal` 进入 Project Inbox。创建的图可逆（可归档 / 删除），其 `sideEffectLevel` 为 `sandbox`。

提交 proposal 前会重新编译草稿；存在 error diagnostics 时拒绝提交。合法 proposal 会写入 Project Inbox，返回 `project_inbox_item_id`，live graph 版本写入仍需要用户确认或显式 API 调用。

::: warning 草稿是进程内非持久态（R6-3）
`nodegraph.draft.*` 草稿刻意不落库：进程重启即丢、不跨进程共享，并受 TTL 滑动过期与数量上限约束（访问会续期，过期或超额的草稿被驱逐）。草稿过期后相关工具会返回“非持久、需重新创建”的错误。真正的版本变更只能经 `nodegraph.patch.submit_proposal` 进入 Project Inbox，再由具备 `project.nodegraph.write` 的人创建正式版本；持久化草稿与跨进程编辑属于后续 NodeGraph editor（批次 9 / 10）范围。
:::

## 图助手工具策略（自动执行 /需要确认）

Studio 图编辑器的「图助手」基于临时对话（`purpose="graph-assistant"`）运行。后端对这类临时对话做这几件事：

1. **强制启用 NodeGraph 工具**：图助手临时对话 respond 时强制 `enableTools=true`，让助手能看到并调用 `nodegraph.*` 工具。其他用途（purpose）的临时对话不受影响，工具仍默认关闭。
2. **一次性 system 引导**：图助手会话首条 respond 前注入一条 system 引导消息，说明可用工具集合、典型工作流（读图 → 建草稿 → 改节点 / 边 → 校验 → 提交提案 / 新建图）与「除新建图外不直接改线上图」的边界。引导只注入一次。
3. **强制 text_protocol + 多轮 agent 循环**：图助手临时对话的工具调用强制走 text_protocol，并在该路径上由后端自实现多轮 agent 循环（一轮生成 → 解析工具调用 → 逐个执行 → 把结果喂回上下文继续，直到不再请求工具而自然停止）。这是执行前确认闸「可暂停」与「批准后自动续跑」的前提；主链与其他用途会话仍保持原有 transport 与单轮行为，不受影响。

在此基础上，提供**逐工具「自动执行 / 需要确认」策略**：对图助手可调用的每个 NodeGraph 工具，标记 `auto`（自动执行）或 `confirm`（需要确认）。

- 作用域：**项目级**（每个 project + 每个 tool name 一条），持久存储在后端表 `graph_assistant_tool_policy`，跨临时对话生效。
- 默认值（无显式记录时）按工具推导：
  - 只读工具（如 `nodegraph.graph.get`、`nodegraph.patch.validate`）→ `auto`
  - 改草稿工具（`nodegraph.draft.*` / `nodegraph.node.*` / `nodegraph.edge.*` / `nodegraph.group.*`）→ `auto`
  - live 持久写工具 `nodegraph.graph.create` 与 `nodegraph.patch.submit_proposal` → `confirm`

::: tip `confirm` 工具：执行前暂停待批（human-in-the-loop）
执行前确认闸已落地。`confirm` 工具**不再被 withheld**，而是和 `auto` 工具一起正常暴露给助手；逐工具决策移到执行阶段判定。助手请求调用某个 `confirm` 工具时，后端在**执行前暂停**：登记一条待确认记录、经 SSE `tool` 事件（`phase="awaiting_confirmation"`，携带 `call_id` 与 `args`）通知前端，并以待确认收尾本次请求（已生成的可见文本与已执行的 `auto` 工具结果照常提交）。随后由用户**批准**（执行该调用并自动续跑多轮，直到自然停止）或**拒绝**（不执行、向 transcript 注入说明并把控制权交回用户）。详见下文[执行前确认闸与恢复接口](#执行前确认闸与恢复接口)。

同一回合出现多个工具时，`auto` 先执行，遇到第一个 `confirm` 即登记待确认并中止后续；批准后从暂停点续跑（已完成轮次与工具结果从持久化上下文保留，不重跑）。`confirm` 仍可作为「彻底禁用某工具」的占位语义保留，但默认不再隐藏工具。
:::

这组策略路由属于 NodeGraph 周边第一方接入面，**不进入 OpenAPI / `@tavern/sdk` 生成面**；Studio 经第一方薄客户端直连。读用 `project.nodegraph.read`，写用 `project.nodegraph.write`。

### GET /projects/:id/graph-assistant/tool-policy

返回该项目下所有图助手工具的 effective 策略（默认值与 override 合并）。需要 `project.nodegraph.read`。

#### 成功响应（200）

```json
{
  "items": [
    {
      "tool_name": "nodegraph.graph.get",
      "side_effect_level": "none",
      "default_decision": "auto",
      "decision": "auto",
      "source": "default"
    },
    {
      "tool_name": "nodegraph.graph.create",
  "side_effect_level": "sandbox",
      "default_decision": "confirm",
      "decision": "confirm",
      "source": "default"
}
  ]
}
```

| 字段 | 类型 |说明 |
| ---- | ---- | ---- |
| `tool_name` | `string` | NodeGraph 工具名 |
| `side_effect_level` | `string` | 工具副作用级别：`none` / `sandbox` / `irreversible` |
| `default_decision` | `string` | 按工具推导的默认决策：`auto` / `confirm` |
| `decision` | `string` | 当前 effective 决策：`auto` / `confirm` |
| `source` | `string` | 决策来源：`default`（默认值）/ `override`（显式覆盖） |

### PUT /projects/:id/graph-assistant/tool-policy

批量 upsert 逐工具策略。需要 `project.nodegraph.write`。返回更新后的完整 effective 列表（形态同 GET）。

#### 请求体

```json
{
  "policies": [
    { "tool_name": "nodegraph.node.add", "decision": "confirm" },
    { "tool_name": "nodegraph.graph.create", "decision": "auto" }
  ]
}
```

| 字段 | 类型 | 必填| 说明 |
| ---- | ---- | ---- | ---- |
| `policies` | `array` | 是 | 至少一条；每条含 `tool_name` 与 `decision` |
| `policies[].tool_name` | `string` | 是 |必须是已知的图助手工具名，否则返回 400 |
| `policies[].decision` | `string` | 是 | `auto` 或 `confirm` |

####错误

| 状态码 | `error.code` |说明 |
| ---- | ---- | ---- |
| 400 | `unknown_tool` | `tool_name` 不在已知工具目录内 |
| 400 | `invalid_decision` | `decision` 非 `auto` / `confirm` |
| 403 | `project_access_denied` | 缺少 `project.nodegraph.read`（读）或 `project.nodegraph.write`（写）权限 |

#### 示例

```bash
curl -X PUT http://localhost:3000/projects/proj_main/graph-assistant/tool-policy \
  -H 'Content-Type: application/json' \
 -d '{"policies":[{"tool_name":"nodegraph.node.add","decision":"confirm"}]}'
```

## 执行前确认闸与恢复接口

`confirm` 工具在图助手会话里采用 human-in-the-loop「执行前暂停待批」：助手请求调用某个 `confirm` 工具时，后端不直接执行，而是登记一条**待确认记录**（持久化在 `graph_assistant_pending_tool_calls`，含暂停时刻的续跑上下文），并以待确认收尾本次 respond。前端据此渲染待确认卡片，由用户批准或拒绝。

这组恢复接口挂在临时对话作用域下，属于 NodeGraph 周边第一方接入面，**不进入 OpenAPI / `@tavern/sdk` 生成面**；Studio 经第一方薄客户端直连。读用 `project.nodegraph.read`，写用 `project.nodegraph.write`。

### 暂停信号（SSE）

图助手会话强制 text_protocol，`respond` 的 SSE 流在登记待确认时会发出一条 `tool` 事件：

```text
event: tool
data: {"execution_id":"call_x","tool_name":"nodegraph.graph.create","provider_id":"","phase":"awaiting_confirmation","side_effect_level":"irreversible","replay_safety":"confirm_on_replay","call_id":"call_x","args":{"name":"新图"}}
```

- `phase="awaiting_confirmation"` 表示该工具在执行前暂停，等待批准。
- `call_id` / `args` 仅在此 phase 出现：分别是模型生成的调用 id 与参数快照。
- 暂停发生在执行之前，`provider_id` 为空串。
- 流随后以正常 `done` 收尾（`final_state` 仍为 `committed`，因为已生成的可见文本照常提交）。**「这一回合是否停在确认闸」以下文的待确认列表为准**，不依赖 `done` 的 `final_state`。

> SDK 侧 `client.temporaryConversations.respondStream(...)` 的 `onTool` 会透传该 phase 与 `callId` / `args`；但待确认列表与批准 / 拒绝必须经下面的第一方恢复接口。

### GET /temporary-conversations/:id/pending-tool-calls

列出该临时对话当前处于 `pending` 的待确认工具调用。需要 `project.nodegraph.read`。非图助手会话恒返回空列表。

#### 成功响应（200）

```json
{
  "items": [
    {
      "id": "ptc_001",
      "conversation_id": "temp_001",
      "branch_id": "main",
      "floor_id": "floor_002",
      "call_id": "call_x",
      "tool_name": "nodegraph.graph.create",
      "args": { "name": "新图" },
      "side_effect_level": "irreversible",
      "status": "pending",
      "created_at": 1735689600000,
      "updated_at": 1735689600000,
      "expires_at": null
    }
  ]
}
```

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | `string` | 待确认记录 ID（即恢复接口的 `confirmationId`） |
| `call_id` | `string` | 模型生成的工具调用 id |
| `tool_name` | `string` | 待确认的工具名 |
| `args` | `object` | 调用参数快照 |
| `side_effect_level` | `string \| null` | 副作用级别：`none` / `sandbox` / `irreversible` |
| `status` | `string` | 当前状态，列表只返回 `pending` |
| `expires_at` | `integer \| null` | 预留过期时间（当前不设硬过期） |

### POST /temporary-conversations/:id/pending-tool-calls/:confirmationId

解决一条待确认：批准或拒绝。需要 `project.nodegraph.write`。

#### 请求体

```json
{ "decision": "approve" }
```

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `decision` | `"approve" \| "reject"` | 是 | 批准或拒绝 |

- **`approve`**：经确认闸放行执行该调用，把结果喂回循环上下文，并**自动续跑多轮** agent 循环——助手可继续调用更多工具（`auto` 直接执行、`confirm` 再次暂停），直到不再请求工具而自然停止。批准后不等用户再发消息。
- **`reject`**：标记 `rejected`，不执行，向 transcript 注入一条说明消息，控制权交回用户。

#### 成功响应（200）

批准（`approved`）返回续跑后的最终一轮结果；若续跑再次命中 `confirm` 工具，应重新拉取待确认列表：

```json
{
  "data": {
    "decision": "approved",
    "pending_tool_call": { "id": "ptc_001", "status": "approved" },
    "result": {
      "conversation_id": "temp_001",
      "branch_id": "main",
      "floor_id": "floor_003",
      "floor_no": 3,
      "page_id": "page_003",
      "generated_text": "已新建图……",
      "total_usage": { "prompt_tokens": 12, "completion_tokens": 8, "total_tokens": 20 },
      "final_state": "committed"
    }
  }
}
```

拒绝（`rejected`）不带 `result`：

```json
{
  "data": {
    "decision": "rejected",
    "pending_tool_call": { "id": "ptc_001", "status": "rejected" }
  }
}
```

#### 错误

| 状态码 | `error.code` | 说明 |
| ---- | ---- | ---- |
| 400 | `validation_error` | `decision` 缺失或非法 |
| 403 | `project_access_denied` | 缺少 `project.nodegraph.read`（读）或 `project.nodegraph.write`（写）权限 |
| 404 | `conversation_not_found` / `pending_tool_call_not_found` | 临时对话或待确认记录不存在 |
| 409 | `conversation_not_active` / `pending_tool_call_not_pending` | 会话已进入终态，或该待确认已被处理（非 `pending`） |

#### 示例

```bash
# 列出待确认
curl http://localhost:3000/temporary-conversations/temp_001/pending-tool-calls

# 批准并自动续跑
curl -X POST http://localhost:3000/temporary-conversations/temp_001/pending-tool-calls/ptc_001 \
  -H 'Content-Type: application/json' \
  -d '{"decision":"approve"}'
```
