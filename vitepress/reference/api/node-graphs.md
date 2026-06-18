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
- `control` edge 暂未激活。
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
```

读、校验、预览需要 `project.nodegraph.read`；创建和版本写入需要 `project.nodegraph.write`；后台运行需要 `project.nodegraph.run`；归档 / 取消归档 / 切换当前版本与节点输出正文 debug 查看需要 `project.nodegraph.manage`。

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

## Agent 自修改边界

R5 提供 `NodeGraphToolProvider` 给 Agent 使用，但只暴露 draft / patch / validate / proposal 类工具，不提供：

- `nodegraph.version.apply_live`
- `nodegraph.graph.delete`
- `nodegraph.permission.modify`
- `nodegraph.project_binding.modify`

Project 绑定的 Session runtime catalog 会暴露 `nodegraph.*` 工具。Agent 可以读取图、创建内存草稿、修改节点 / 边 / group、运行校验和 diff，并通过 `nodegraph.patch.submit_proposal` 提交建议。

提交 proposal 前会重新编译草稿；存在 error diagnostics 时拒绝提交。合法 proposal 会写入 Project Inbox，返回 `project_inbox_item_id`，live graph 版本写入仍需要用户确认或显式 API 调用。

::: warning 草稿是进程内非持久态（R6-3）
`nodegraph.draft.*` 草稿刻意不落库：进程重启即丢、不跨进程共享，并受 TTL 滑动过期与数量上限约束（访问会续期，过期或超额的草稿被驱逐）。草稿过期后相关工具会返回“非持久、需重新创建”的错误。真正的版本变更只能经 `nodegraph.patch.submit_proposal` 进入 Project Inbox，再由具备 `project.nodegraph.write` 的人创建正式版本；持久化草稿与跨进程编辑属于后续 NodeGraph editor（批次 9 / 10）范围。
:::
