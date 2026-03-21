---
outline: [2, 3]
---

# API 概览

所有接口都是 RESTful 风格，返回 JSON。启动后可通过 Swagger UI 查看完整文档：`http://localhost:3000/docs/`

## 认证

在 `.env` 中设置 `AUTH_MODE`：

| 模式 | 说明 |
| ---- | ---- |
| `off` | 无认证（默认） |
| `api_key` | API Key 认证（`Authorization: Bearer <key>`） |
| `jwt` | JWT 认证 |

## 会话管理

| 方法   | 路径            | 说明         |
| ------ | --------------- | ------------ |
| POST   | `/sessions`     | 创建会话     |
| GET    | `/sessions`     | 列出会话     |
| GET    | `/sessions/:id` | 获取会话详情 |
| PATCH  | `/sessions/:id` | 更新会话配置 |
| DELETE | `/sessions/:id` | 删除会话     |

## 用户卡管理

| 方法   | 路径         | 说明 |
| ------ | ------------ | ---- |
| POST   | `/users`     | 创建用户卡 |
| GET    | `/users`     | 列出用户卡 |
| GET    | `/users/:id` | 获取用户卡详情 |
| PATCH  | `/users/:id` | 更新用户卡 |
| DELETE | `/users/:id` | 软删除用户卡 |

## 生成与聊天

| 方法 | 路径                            | 说明                                       |
| ---- | ------------------------------- | ------------------------------------------ |
| POST | `/sessions/:id/respond`         | 发送消息并获取 AI 回复（核心接口）         |
| POST | `/sessions/:id/respond/stream`  | SSE 流式返回 AI 回复片段                   |
| POST | `/sessions/:id/respond/dry-run` | 仅组装 Prompt 并返回调试元信息（无副作用） |
| POST | `/sessions/:id/regenerate`      | 重新生成最后一个楼层                       |
| GET  | `/sessions/:id/timeline`        | 获取完整时间线                             |

## 楼层与消息

| 方法  | 路径                  | 说明                 |
| ----- | --------------------- | -------------------- |
| GET   | `/floors/:id`         | 获取楼层详情         |
| POST  | `/floors/:id/branch`  | 从该楼层创建分支     |
| GET   | `/floors/:id/pages`   | 列出楼层的所有消息页 |
| PATCH | `/pages/:id/activate` | 切换当前生效的消息页 |

## 变量

| 方法   | 路径             | 说明                          |
| ------ | ---------------- | ----------------------------- |
| GET    | `/variables`     | 查询变量（支持按 scope 过滤） |
| PUT    | `/variables`     | 设置变量                      |
| PUT    | `/variables/batch` | 批量 upsert 变量            |
| DELETE | `/variables/:id` | 删除变量                      |

## 记忆

| 方法   | 路径                      | 说明              |
| ------ | ------------------------- | ----------------- |
| GET    | `/memories`               | 查询记忆条目      |
| POST   | `/memories`               | 创建记忆条目      |
| GET    | `/memories/stats`         | 记忆统计          |
| PATCH  | `/memories/batch/status`  | 批量更新状态      |
| POST   | `/memories/batch/delete`  | 批量删除          |

## 导入（SillyTavern 兼容）

| 方法 | 路径                | 说明             |
| ---- | ------------------- | ---------------- |
| POST | `/import/preset`    | 导入酒馆预设     |
| POST | `/import/worldbook` | 导入酒馆世界书   |
| POST | `/import/regex`     | 导入酒馆正则规则 |
| POST | `/import/character` | 导入酒馆角色卡   |

## LLM Profile

| 方法   | 路径                             | 说明               |
| ------ | -------------------------------- | ------------------ |
| POST   | `/llm-profiles`                  | 创建 Profile       |
| GET    | `/llm-profiles`                  | 列出 Profile       |
| PATCH  | `/llm-profiles/:id`              | 更新 Profile       |
| DELETE | `/llm-profiles/:id`              | 删除 Profile       |
| POST   | `/llm-profiles/:id/activate`     | 激活 Profile       |
| GET    | `/llm-profiles/runtime`          | 运行时解析         |
| POST   | `/llm-profiles/models/discover`  | 发现可用模型       |
| POST   | `/llm-profiles/models/test`      | 测试模型连通性     |

## 账号

| 方法   | 路径           | 说明         |
| ------ | -------------- | ------------ |
| GET    | `/accounts`    | 列出账号     |
| GET    | `/accounts/me` | 获取当前账号 |
| PATCH  | `/accounts/:id`| 更新账号     |
