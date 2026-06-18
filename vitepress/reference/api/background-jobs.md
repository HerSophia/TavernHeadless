---
outline: [2, 3]
---

# Background Jobs（后台作业）

平台里很多耗时操作不会在请求里同步完成，而是落成一个**后台作业**：请求先入队拿到 `job_id`，worker 在后台串行消费，调用方再轮询作业状态、必要时重试或取消。

这些作业大多投影自同一张 `runtime_job` 表，所以**状态机、轮询方式、重试与取消语义是统一的**。这一页讲这套共享模型，并指向每一类作业各自的文档。

## 什么时候需要看这页

- 你想统一理解平台后台作业的状态、阶段、重试和取消语义。
- 你不确定某类作业（备份、聊天传输、记忆、Agent、图运行）该看哪一页。
- 你要写一段通用的"轮询作业直到完成"的客户端逻辑。

如果你已经知道要看哪类作业，可以直接跳到下面[各类后台作业](#各类后台作业)的对应文档。

## 一个简单例子

几乎所有后台作业都遵循「创建 → 轮询 →（失败则重试或取消）」这个套路。以异步聊天导出为例：

1. 创建作业，拿到 `job_id`（`POST /export/chat/:id/jobs`）。
2. 轮询作业状态（`GET /chat-transfer-jobs/:id`），看 `status` 和 `phase`。
3. `status=succeeded` 后取产物（`GET /chat-transfer-jobs/:id/file`）；进入 `dead_letter` 时按需重试或排查。

```bash
# 轮询某个聊天传输作业的状态
curl http://localhost:3000/chat-transfer-jobs/job_001
```

## 先理解几个词

| 词 | 这里的意思 |
| ---- | ---- |
| `runtime_job` | 后台作业的底层存储表，多数作业页是它在不同 `scope_type` 下的投影 |
| `status` | 作业整体状态，例如 `pending` / `running` / `succeeded` / `dead_letter`（部分类别还有 `failed` / `cancelled`） |
| `phase` | 作业当前所处的细分阶段 |
| worker | 在后台拉取并执行作业的进程。部分作业需要对应 worker 开关开启才会被真正消费 |
| `dead_letter` | 作业多次失败后进入的终态，通常需要显式重试 |
| 轮询 | v1 的作业观察方式：客户端定期请求作业状态，没有服务端推送 |

## 各类后台作业

平台当前的后台作业按域拆在不同页面。它们共享上面的作业模型，但创建入口和产物各不相同：

| 作业类别 | 创建入口 | 观察 / 控制 | 文档 |
| ---- | ---- | ---- | ---- |
| 核心资产备份 / 恢复 | `POST /backup/jobs/export`、`POST /backup/jobs/restore` | `/backup-jobs/*` | [Backup Jobs（备份作业）](./backup-jobs) |
| 聊天导入 / 导出 | `POST /import/chat/jobs`、`POST /export/chat/:id/jobs` | `/chat-transfer-jobs/*` | [Chat Transfer Jobs（聊天传输作业）](./chat-transfer-jobs) |
| 记忆提取 / 维护 | 对话过程自动产生 | `/memory/jobs/*` | [Memory Jobs（记忆后台作业）](./memory-jobs) |
| 后台 Agent 运行 | 事件触发或手动 run | `/projects/:id/agent-jobs/*` | [Project Agent Jobs（Agent 作业看板）](./project-agent-jobs) |
| 图运行（NodeGraph） | `POST /projects/:id/node-graphs/:graph_id/run` | `GET /projects/:id/node-graph-runs/:run_id` | [NodeGraph Runtime](./node-graphs) |

## worker 开关

作业「入队」不等于「已执行」。部分作业类别需要 API 进程开启对应 worker 才会被消费：

| 作业类别 | 需要的开关 |
| ---- | ---- |
| 后台 Agent（`agent.run`） | `ENABLE_AGENT_RUNTIME_WORKER=true` |
| 图运行（`graph.run`） | `ENABLE_NODE_GRAPH_WORKER=true` |

未开启对应 worker 时，作业会停留在 pending 队列里，作业看板仍能看到，但不会有进展。
