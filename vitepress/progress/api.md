---
outline: [2, 3]
---

# 后端 API 进度

> 对应 `apps/api`，当前版本 `0.2.0-beta.2`。

## 当前里程碑

- 里程碑：后端 Beta 阶段（收口完成）
- 状态：Beta 准入标准 14/14 全部达成，可进入正式 sign-off

## Beta 准入标准

- [x] 核心业务路由补齐 OpenAPI 请求/响应示例
- [x] 中文 OpenAPI 覆盖主路由分组
- [x] typecheck / test / openapi:export / smoke / memory:maintenance 全部通过
- [x] 版本号同步到 `0.2.0-beta.2`
- [x] 至少 1 个真实 provider 完成最小回归（已执行，结果良好）

## 已完成能力一览

### Tool Calling：工具调用系统

- [x] `tool_call_record` + `tool_definition` 数据库表及迁移
- [x] `DrizzleToolRepository`（调用记录与工具定义 CRUD）
- [x] `ToolService`（内置工具列表、自定义工具管理、调用记录查询）
- [x] 11 个 API 端点（内置工具、定义 CRUD、启用/禁用、调用记录、会话权限）
- [x] `ChatService` 集成工具权限解析与调用持久化
- [x] Core 层：`ToolRegistry`、`ToolExecutor`、`BuiltinToolProvider`（7 个内置工具）、`PresetToolProvider`
- [x] `TurnOrchestrator` 工具初始化与调用收集
- [x] 4 个工具事件类型（started/completed/failed/denied）
- [x] 11 个集成测试，零回归

### MCP 集成

- [x] `mcp_server_config` 数据库表及迁移（`0015_mcp_server_config.sql`）
- [x] `McpService`（MCP 服务器配置 CRUD 业务层）
- [x] `McpConnection`（单连接封装，支持 stdio/HTTP 传输）
- [x] `McpConnectionManager`（多连接生命周期管理，stdio 启动时连接，HTTP 按需连接）
- [x] `McpToolProvider`（实现 `ToolProvider` 接口，对上层透明）
- [x] 12 个 API 端点（6 配置 CRUD + 6 运行时操作）
- [x] `ENABLE_MCP` 环境变量与 `app.ts` 初始化流程
- [x] 3 个事件类型：`mcp.connected`、`mcp.disconnected`、`mcp.error`
- [x] WsBridge 追加 MCP 事件转发
- [x] 32 个测试（McpService 21 + McpToolProvider 11），零回归

### M22：LLM Instance Config API

- [x] `llm_instance_config` 数据库表及 migration
- [x] `LlmInstanceService`（CRUD + 多级优先级解析）
- [x] 独立路由 `/llm-instances`（5 个端点）
- [x] 前端 API 客户端扩展

### M21：记忆系统加固

- [x] 自动冲突消解（同 key 的 fact 自动 deprecate 旧记录）
- [x] 衰减排序（半衰期，可按 createdAt/updatedAt 计算）
- [x] MemoryMaintenanceService + 定时任务
- [x] 记忆维护 CLI

### M20：LLM 模型发现

- [x] `POST /llm-profiles/models/discover`
- [x] `POST /llm-profiles/models/test`

### M19：Account User Binding

- [x] `account_user` 实体
- [x] Session 绑定用户卡 + 快照冻结
- [x] PromptAssembler 优先读取 `user_snapshot_json`

### M18：LLM Profile Vault

- [x] `llm_profile` + `llm_profile_binding` 表
- [x] AES-256-GCM 加密密钥
- [x] CRUD + activate + runtime resolve
- [x] Instance Slot + Per-Slot Binding
- [x] 认证插件（`AUTH_MODE=off|api_key|jwt`）
- [x] 多账号隔离收口

### M17：OpenAPI + SDK

- [x] OpenAPI 导出 + Swagger UI
- [x] openapi-typescript 自动生成 SDK 类型
- [x] 一致性校验脚本

### M16：Character 生命周期

- [x] 版本化角色卡（character + character_version）
- [x] 软删除/恢复
- [x] 关键写路径事务化

### M15：Character Binding

- [x] Session 绑定角色 + 冻结快照
- [x] 角色同步策略（pin / manual / force）

### M13：分支治理

- [x] 分支 CRUD/比对
- [x] 编辑重试（edit-and-regenerate）
- [x] Failed 楼层原地重试

### M11：Prompt Dry-run

- [x] `POST /sessions/:id/respond/dry-run`
- [x] 无副作用，返回 messages / token 估算 / 调试信息

### M9：SSE 流式

- [x] `POST /sessions/:id/respond/stream`
- [x] SSE 事件：start / chunk / summary / done / error

### M8：核心 RP 体验

- [x] Timeline 查询
- [x] 分支创建
- [x] 消息页激活（Swipe）

### M5-M6：基础能力

- [x] Prompt 编排接入
- [x] 性能优化（聚合查询 / 索引 / 历史窗口）
- [x] 请求日志增强
- [x] OpenAPI/Swagger

### M2-M4：CRUD + 聊天

- [x] 全量 CRUD（Session/Floor/Page/Message/Variable/Memory）
- [x] 统一分页/排序/过滤
- [x] ChatService + 核心聊天接口
- [x] SillyTavern 导入

## 测试统计

- 全量测试：**445 passed**（34 个测试文件）
- 覆盖范围：CRUD 集成、认证、聊天链路、分支管理、角色生命周期、导入、LLM Profile/Instance、记忆、Prompt dry-run、OpenAPI、请求日志、安全、WebSocket、工具调用、MCP 集成

## 已知限制

- 记忆维护定时任务以 API 进程内定时器运行，多实例部署时只允许一个实例开启。
- 未内建 rate limiting、`/metrics` 或 tracing / OTel，公网部署需由网关层补足。
- batch 当前范围：variables / memories / messages；尚未扩展到 pages / users / sessions。
