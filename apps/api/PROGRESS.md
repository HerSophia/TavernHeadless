# API Progress

> 目的：记录 `apps/api` 后端开发进度，方便随时续接开发。
> 维护规则：每个 Phase 完成后，同步更新本文件（范围、结果、测试、文件清单）。

## 当前里程碑

\- 里程碑：`后端 v0.2 — 正式发布阶段`
\- 状态：`Beta3 准入标准已全部完成，后端已正式入轨`
\- 最后更新：`2026-07-02`

## 当前判断（审计后）

- `apps/api` 已完成 M2-M22 的全部后端能力落地，Beta3 准入标准 14/14 已全部达成，后端已转入正式发布阶段。
- 当前已覆盖的主能力包括：CRUD 与迁移、聊天生成与重生成、SSE、Prompt dry-run、分支治理、角色生命周期、多账号隔离与用户绑定、`LLM Profile Vault`、模型发现与连通性测试、记忆注入与维护任务、OpenAPI/Swagger、Typed SDK、CORS 与中英文化文档入口、LLM Instance Config API。
- `apps/api/package.json` 与 OpenAPI `info.version` 保持 `0.2.0-beta.3`，用于表达后端 v0.2 版本姿态。
- 真实 provider 最小回归已执行完毕，结果良好，Beta3 准入标准全部满足。后续工作转入正式发布准备与文档完善。

## 聊天文件导入导出 + 全资源导出系统

### 1) 已完成

- [x] ST JSONL 聊天解析器（adapters-sillytavern）
  - `parseChatFile(jsonlContent)` — 逐行解析，Zod 验证，Chub Chat 展平
  - `groupMessagesIntoFloors(messages)` — 用户→新楼层，助手→同楼层，开头助手→floor 0
  - `parseSendDate(value)` — 容错时间解析（数值/字符串/回退到 Date.now()）
- [x] `POST /import/chat` 路由
  - 格式自动检测：`JSON.parse` → `spec === "tavern_headless_chat"` → 原生路径，否则 → ST JSONL
  - ST JSONL 导入：解析 → 分组 → 单事务创建 session + floors + pages + messages
  - 原生格式导入：`_original_id` → nanoid 映射，完整导入四层树 + 变量 + 记忆
  - Swipe 处理：`swipes[]` → 多 `message_page`，`swipe_id` 确定 `isActive`
- [x] TavernHeadless 原生聊天格式类型定义（packages/shared）
  - `TH_CHAT_SPEC = "tavern_headless_chat"`，`TH_CHAT_SPEC_VERSION = "1.0.0"`
  - 10 个 Zod schema，9 个推导类型
- [x] 聊天导出序列化（`apps/api/src/services/chat-export.ts`）
  - `serializeSessionToThChat()` — 无损导出完整四层树 + 变量 + 记忆
  - `serializeSessionToStJsonl()` — 仅 main 分支 committed 楼层，多版本合并为 swipes
- [x] `GET /export/chat/:id` 路由
  - query: `format=thchat|st_jsonl`，`include_variables`，`include_memories`
  - thchat → JSON + `.thchat` 扩展名；st_jsonl → NDJSON + `.jsonl` 扩展名
- [x] `GET /export/preset/:id` — 直接输出 `parseJsonField(row.dataJson)`
- [x] `GET /export/worldbook/:id` — entries 对象形式 + V2 extensions 嵌套
- [x] `GET /export/regex/:id` — `scriptsToStRegexArray()` 补回 3 个字段
- [x] `GET /export/character/:id` — `snapshotToStCharacterCard()` 构造 V2 JSON，支持 `?version_id=`
- [x] Serializer 函数（adapters-sillytavern）
  - `snapshotToStCharacterCard()` — CharacterSnapshot → ST Character Card V2
  - `scriptsToStRegexArray()` — TH 精简格式 → ST 原始格式（+markdownOnly/promptOnly/runOnEdit）

### 1.1) 角色卡系统升级（richer V2 + 最小 V3 兼容）

- [x] `parseCharacterCard()` 升级为 `legacy / v2 / v3` 分发结构
- [x] 新增 `ImportedCharacterCard`、`CharacterProfile`、`SessionCharacterSnapshot`
- [x] 导入链路改为：外部角色卡 → imported card → normalized profile → session snapshot
- [x] `sessions` 路由角色快照 schema 放宽并保留未知字段，避免会话绑定时再次裁剪扩展字段
- [x] 建会话与导入建会话的首楼逻辑改为读取 `primaryGreeting`，并兼容旧 `greeting`
- [x] `snapshot_summary.has_greeting` 升级为同时识别主 greeting 与 alternate greetings
- [x] `prompt-assembler` 已接入 `systemPrompt` / `postHistoryInstructions` 的最小运行时注入
- [x] `creatorNotes` / `characterBook` / `extensions` 已保留到快照与 prompt snapshot 调试结构
- [x] `snapshotToStCharacterCard()` 改为优先导出真实的 `alternate_greetings`、`system_prompt`、`post_history_instructions`、`creator_notes`、`tags`、`creator`、`character_version`、`extensions`
- [x] 当角色存在 `alternateGreetings` 时，建会话和导入建会话会在 floor 0 创建多个 output page，支持首楼 greeting swipes
- [x] `GET /export/character/:id` 新增 `format=v3`，支持 Character Card V3 导出结构
- [x] `characterBook` 已接入 prompt worldbook 主链；在 compat / native 模式下会与会话 worldbook 一同触发与合并

### 1.2) 角色卡系统升级测试

- [x] `packages/adapters-sillytavern/src/__tests__/character-parser.test.ts`：补 richer V2 / 最小 V3 / 未知字段保留测试
- [x] `packages/adapters-sillytavern/src/__tests__/serializers.test.ts`：补 richer 字段导出映射测试
- [x] `apps/api/test/character-import.integration.test.ts`：补 richer V2 导入后导出回放测试
- [x] `apps/api/test/exports.integration.test.ts`：补 richer V2 导出断言
- [x] `apps/api/src/services/__tests__/prompt-assembler.test.ts`：补角色级 `systemPrompt` / `postHistoryInstructions` 注入测试
- [x] `apps/api/test/character-import.integration.test.ts`：补 floor 0 多 greeting page 创建与激活切换测试
- [x] `apps/api/test/sessions-extra.integration.test.ts`：补 snapshot-only session 的多 greeting page 测试
- [x] `apps/api/src/services/__tests__/prompt-assembler.test.ts`：补 characterBook 单独触发与与会话 worldbook 叠加测试
- [x] `pnpm --filter @tavern/adapters-sillytavern typecheck`
- [x] `pnpm --filter @tavern/api typecheck`
- [x] 目标回归：120 tests passed（parser / serializer / import / session sync / export / prompt-assembler / resource-tool-provider）
- [x] 新增 V3 导出断言（`apps/api/test/exports.integration.test.ts`、serializer V3 unit test）

### 2) 测试

- [x] `packages/adapters-sillytavern/src/__tests__/chat-parser.test.ts`（25 个测试）
- [x] `packages/shared/src/types/__tests__/chat-file.test.ts`（14 个测试）
- [x] `apps/api/src/services/__tests__/chat-export.test.ts`（11 个测试）
- [x] `packages/adapters-sillytavern/src/__tests__/serializers.test.ts`（8 个测试）
- [x] 全量回归：adapters 142 + shared 32 + api 613 = 787，零回归

### 3) 新增文件

```text
packages/adapters-sillytavern/src/
├── types/chat.ts                           — ST 聊天消息/头部类型
├── parsers/chat-parser.ts                  — ST JSONL 解析 + 消息分组
├── serializers/
│   ├── character-serializer.ts             — CharacterSnapshot → ST V2 Card
│   └── regex-serializer.ts                 — TH 精简 → ST 原始正则格式
└── __tests__/
    ├── chat-parser.test.ts                 — 25 个测试
    └── serializers.test.ts                 — 8 个测试

packages/shared/src/types/
├── chat-file.ts                            — .thchat 格式类型 + Zod schemas
└── __tests__/chat-file.test.ts             — 14 个测试

apps/api/src/
├── services/chat-export.ts                 — 聊天导出序列化
├── services/__tests__/chat-export.test.ts  — 11 个测试
└── routes/exports.ts                       — 5 个导出路由
```

### 4) 修改文件

- `packages/adapters-sillytavern/src/index.ts` — 新增 chat parser + serializer 导出
- `packages/shared/src/types/index.ts` — 新增 chat-file 类型导出
- `packages/shared/src/index.ts` — 新增顶层 re-export
- `apps/api/src/routes/imports.ts` — 新增 `POST /import/chat` + 格式自动检测 + 原生格式导入
- `apps/api/src/routes/exports.ts` — 新增 5 个导出路由（从初始 chat 扩展到 preset/worldbook/regex/character）
- `apps/api/src/routes/index.ts` — 注册 `registerExportRoutes()`

## Tool Calling 系统（本次增量）

### 1) 已完成

- [x] 新增 `tool_call_record` 和 `tool_definition` 数据库表及迁移 `0014_tool_calling.sql`
- [x] 新增 `DrizzleToolRepository`（工具调用记录和工具定义的 CRUD）
- [x] 新增 `ToolService`（内置工具列表、自定义工具 CRUD、调用记录查询）
- [x] 新增 `tools.ts` 路由，11 个端点：
  - `GET /tools/builtin` — 列出内置工具
  - `GET /tools/definitions` — 列出自定义工具定义（支持 source/enabled 过滤、分页）
  - `GET /tools/definitions/:id` — 获取单个工具定义
  - `POST /tools/definitions` — 创建自定义工具
  - `PATCH /tools/definitions/:id` — 更新工具定义
  - `DELETE /tools/definitions/:id` — 删除工具定义
  - `PATCH /tools/definitions/:id/toggle` — 启用/禁用工具
  - `GET /tools/call-records` — 按 page_id/floor_id 查询调用记录
  - `GET /sessions/:id/tool-permissions` — 获取会话工具权限
  - `PUT /sessions/:id/tool-permissions` — 替换会话工具权限
  - `PATCH /sessions/:id/tool-permissions` — 合并更新会话工具权限
- [x] `ChatService` 集成工具系统：权限解析、工具注入 TurnInput、调用记录持久化
- [x] `routes/index.ts` 注册工具路由

### 2) 测试与验证

- [x] 新增 `test/tools.integration.test.ts`（11 个集成测试）
- [x] `pnpm --filter @tavern/api typecheck` 通过
- [x] `pnpm --filter @tavern/api test` 通过（32 files, 413 tests）

### 3) 修改文件

- `apps/api/src/db/schema.ts` — 新增 `toolCallRecords`、`toolDefinitions` 表定义
- `apps/api/drizzle/0014_tool_calling.sql` — 数据库迁移
- `apps/api/drizzle/meta/_journal.json` — 迁移索引
- `apps/api/src/adapters/drizzle-tool-repository.ts` — 工具数据库操作（新文件）
- `apps/api/src/adapters/index.ts` — 导出 DrizzleToolRepository
- `apps/api/src/services/tool-service.ts` — 工具管理业务层（新文件）
- `apps/api/src/services/chat-service.ts` — 工具系统集成
- `apps/api/src/routes/tools.ts` — 11 个 API 端点（新文件）
- `apps/api/src/routes/index.ts` — 注册工具路由
- `apps/api/test/tools.integration.test.ts` — 集成测试（新文件）

## MCP 集成

### 1) 已完成

- [x] 安装 `@modelcontextprotocol/sdk` 依赖
- [x] 新增 `mcp_server_config` 数据库表及迁移 `0015_mcp_server_config.sql`
- [x] 新增 `McpService`（MCP 服务器配置 CRUD 业务层）
- [x] 新增 `McpConnection`（单个 MCP 服务器连接封装，支持 stdio/HTTP 传输）
- [x] 新增 `McpConnectionManager`（多连接生命周期管理，stdio 启动时连接，HTTP 按需连接）
- [x] 新增 `McpToolProvider`（实现 `ToolProvider` 接口，对上层透明）
- [x] 新增 12 个 API 端点（6 配置 CRUD + 6 运行时操作）
- [x] 新增 `ENABLE_MCP` 环境变量和 `app.ts` 初始化流程
- [x] 新增 3 个事件类型：`mcp.connected`、`mcp.disconnected`、`mcp.error`
- [x] WsBridge 已追加 MCP 事件转发
- [x] Core 层 `McpToolProviderConfig` 类型已从占位扩充为完整定义

### 2) 测试

- [x] McpService 单元测试：21 个（CRUD、唯一性校验、分页、enabled 过滤）
- [x] McpToolProvider 单元测试：11 个（listTools 代理、executeTool 前缀处理、降级行为）
- [x] 全量回归：core 315 + api 445 = 760（含 adapters 864），零回归

### 3) 新增文件

```text
apps/api/src/mcp/
├── index.ts                      — barrel export
├── types.ts                      — MCP 类型定义
├── mcp-connection.ts             — 单连接封装
├── mcp-connection-manager.ts     — 多连接管理器
├── mcp-tool-provider.ts          — ToolProvider 实现
└── __tests__/
    ├── mcp-service.test.ts       — McpService 单元测试
    └── mcp-tool-provider.test.ts — McpToolProvider 单元测试

apps/api/src/services/mcp-service.ts  — MCP 服务器配置 CRUD
apps/api/src/routes/mcp.ts            — 12 个 API 端点
apps/api/drizzle/0015_mcp_server_config.sql — 数据库迁移
```

### 4) 修改文件

- `packages/core/src/tools/types.ts` — McpToolProviderConfig 类型扩充
- `packages/core/src/events/event-types.ts` — +3 个 mcp.* 事件
- `packages/core/src/events/index.ts` — 导出更新
- `packages/core/src/index.ts` — 导出更新
- `apps/api/package.json` — +@modelcontextprotocol/sdk 依赖
- `apps/api/drizzle/meta/_journal.json` — 追加迁移条目
- `apps/api/src/db/schema.ts` — +mcpServerConfigs 表定义
- `apps/api/src/routes/index.ts` — 注册 MCP 配置路由
- `apps/api/src/app.ts` — MCP 初始化流程、BuildAppOptions/Result 扩展
- `apps/api/src/config.ts` — ENABLE_MCP 环境变量
- `apps/api/src/index.ts` — 传入 enableMcp
- `apps/api/src/ws/ws-bridge.ts` — 追加 mcp.* 事件转发

## ResourceToolProvider — 23 个资源管理工具

### 1) 已完成

- [x] Core 层类型扩展：`ToolExecutionContext.accountId`、`TurnInput.accountId`、`buildToolContext()` 透传
- [x] 新增 `ResourceToolProvider`（实现 `ToolProvider` 接口，`id = 'resource'`，`type = 'builtin'`）
- [x] 23 个工具定义及对应 handler：
  - 角色卡：`create_character`、`update_character`、`get_character`、`list_characters`
  - 世界书：`create_worldbook`、`create_worldbook_entry`、`update_worldbook_entry`、`get_worldbook`、`list_worldbooks`
  - 正则配置文件：`create_regex_rule`、`update_regex_rule`、`get_regex_profile`
  - 第三批 — 列表补全：`list_regex_profiles`、`list_presets`、`list_worldbook_entries`、`list_character_versions`
  - 第三批 — 细粒度读取：`get_worldbook_entry`、`get_regex_rule`、`get_preset`、`get_preset_entry`
  - 第三批 — 创建/写入：`create_regex_profile`、`create_preset_entry`、`update_preset_entry`
- [x] `ChatService` 4 处 `TurnInput` 构造追加 `accountId` 字段
- [x] `app.ts` 创建 `ToolRegistry`，注册 `BuiltinToolProvider` + `ResourceToolProvider`，传入 `ChatService`
- [x] 创建的资源 `source = 'tool'`，与导入来源 `'sillytavern'` 区分
- [x] 所有写入工具 `sideEffectLevel = 'irreversible'`，读取工具 `sideEffectLevel = 'none'`
- [x] 多账户隔离：所有操作通过 `accountId` 过滤
- [x] 第三批新增功能：`list_worldbook_entries` 只返回条目摘要（comment + keys），不含 content，省 token
- [x] 第三批新增功能：预设工具使用 `preset-utils.ts` 中的 `loadPresetRaw` / `savePresetRaw` 等价逻辑，read-modify-write 模式

### 2) 测试

- [x] `src/tools/__tests__/resource-tool-provider.test.ts`（80 个测试）
  - 第二批 12 工具：42 个测试（正常路径 + 错误路径 + accountId 隔离）
  - 第三批 11 工具：38 个测试（列表/细粒度读取/预设写入/正则创建）
  - accountId 隔离测试（跨账户不可读/写/列出）
- [x] 全量回归：core 315 + adapters 109 + api 525 = 949，零回归

### 3) 新增文件

```text
apps/api/src/tools/
├── index.ts                          — barrel export
├── resource-tool-provider.ts         — 23 个资源工具定义 + handler（~1990 行）
└── __tests__/
    └── resource-tool-provider.test.ts — 80 个测试
```

### 4) 修改文件

- `packages/core/src/tools/types.ts` — `ToolExecutionContext` 新增 `accountId?: string`
- `packages/core/src/orchestration/types.ts` — `TurnInput` 新增 `accountId?: string`
- `packages/core/src/orchestration/turn-orchestrator.ts` — `buildToolContext()` 透传 `accountId`
- `apps/api/src/services/chat-service.ts` — 4 处 `TurnInput` 构造追加 `accountId`
- `apps/api/src/app.ts` — 创建 `ToolRegistry`，注册两个 Provider，传入 `ChatService`

## M22 增量：LLM Instance Config API

### 1) 已完成

- [x] 新增 `llm_instance_config` 数据库表及 migration `0013_llm_instance_config.sql`
- [x] 新增 `LlmInstanceService`（CRUD + 多级优先级解析）
- [x] 提取 `lib/llm-params.ts` 公共参数工具（从 `llm-profile-service.ts` 抽离）
- [x] 新增独立路由 `/llm-instances`，5 个端点：
  - `GET /llm-instances` — 列出配置
  - `GET /llm-instances/resolved` — 解析各槽位生效配置
  - `GET /llm-instances/:slot` — 查询指定槽位
  - `PUT /llm-instances/:slot` — 创建或更新配置
  - `DELETE /llm-instances/:slot` — 删除配置
- [x] 新增 OpenAPI JSON Schema 与示例（`llm-instances-schemas.ts`）
- [x] 前端 API 客户端（`apps/web/src/lib/workspace-api/llm.ts`）新增 5 个函数
- [x] 数据库文档、API 参考文档、VitePress 侧边栏同步更新

### 2) 测试与验证

- [x] `pnpm --filter @tavern/api typecheck` 通过
- [x] `pnpm --filter @tavern/web typecheck` 通过
- [x] `pnpm --filter @tavern/api test` 通过（371 passed，含世界书 E2E）

### 3) 修改文件

- `apps/api/src/db/schema.ts` — 新增 `llmInstanceConfigs` 表定义
- `apps/api/drizzle/0013_llm_instance_config.sql` — 数据库迁移
- `apps/api/drizzle/meta/_journal.json` — 迁移索引
- `apps/api/src/lib/llm-params.ts` — 参数工具提取（新文件）
- `apps/api/src/services/llm-instance-service.ts` — 服务层（新文件）
- `apps/api/src/services/llm-profile-service.ts` — 移除重复代码，改用 `llm-params` 导入
- `apps/api/src/routes/llm-instances.ts` — 路由（新文件）
- `apps/api/src/routes/schemas/llm-instances-schemas.ts` — JSON Schema（新文件）
- `apps/api/src/routes/schemas/llm-profiles-schemas.ts` — 导出 `generationParamsJsonSchemaProperties`
- `apps/api/src/routes/index.ts` — 注册新路由
- `apps/web/src/lib/workspace-api/llm.ts` — 前端 API 客户端扩展
- `docs/database.md` — 新增 `llm_instance_config` 表
- `vitepress/reference/database.md` — 同步更新
- `vitepress/reference/api/llm-instances.md` — API 参考（新文件）
- `vitepress/.vitepress/config.ts` — 侧边栏新增入口

## Beta.2 范围冻结（本次）

### 1) 记忆维护部署约束

- 当前实现仍为 `apps/api/src/app.ts` 的 API 进程内定时器，不带分布式锁。
- 多实例部署时，只允许一个实例开启 `ENABLE_MEMORY_MAINTENANCE=true`。
- 其余 API 实例必须关闭该开关；如需稳定长期运行，建议改由独立 maintenance job / worker 负责。

### 2) 公网部署责任

- 若 `apps/api` 直接对公网开放，限流、网关防护与基础观测仍由部署层承担。
- 当前 beta 仍未内建 `@fastify/rate-limit`、`/metrics` 或 tracing / OTel。

### 3) CRUD / batch 口径冻结

- 导入资源当前接受的 create 路径保持为：
  - `POST /import/preset`
  - `POST /import/worldbook`
  - `POST /import/regex`
- `characters` 保持 SillyTavern 风格的版本化模型，不强行改成普通 CRUD。
- `accounts` 不作为当前 batch 优先目标。
- `branches` 不作为当前 batch 优先目标。
- 首批 batch 优先级：
  - 第一批：`variables`、`memories`、`messages`
  - 第二批：`pages`、`users`、受限动作型 `sessions`
  - 低优先级或延后：`floors`、`llm-profiles`
- 已在本次落地：
  - `PUT /variables/batch`：按 `(scope, scope_id, key)` 做批量 upsert，并显式返回每项 `created|updated` 结果
  - `PATCH /memories/batch/status`：按显式 id 批量切换 `active|deprecated`，并同步刷新 `updated_at`
  - `POST /memories/batch/delete`：按显式 id 批量删除记忆条目，并逐项返回 `deleted|not_found`
  - `PATCH /messages/batch/visibility`：按显式 id 批量更新 `is_hidden`
  - `POST /messages/batch/delete`：按显式 id 批量删除消息，并逐项返回 `deleted|not_found`

## 后端 Beta 准入标准（草案）

- [x] `apps/api/PROGRESS.md` 与 `README.md` 的阶段描述已同步到当前实现
- [x] 核心业务路由补齐 OpenAPI 请求/响应示例
- [x] 中文 OpenAPI 覆盖当前主路由分组（含 `accounts`、`users`、`llm-profiles`）
- [x] 记忆维护的 purge 语义已明确接受并写入文档（beta 采用 `updatedAt` 语义，不引入 `deprecatedAt`）
- [x] `pnpm --filter @tavern/api typecheck` 通过（beta 收口复核）
- [x] `pnpm --filter @tavern/api test` 通过（beta 收口复核）
- [x] `pnpm --filter @tavern/api openapi:export` 通过（beta 收口复核）
- [x] `pnpm --filter @tavern/api smoke` 通过（beta 收口复核）
- [x] `pnpm --filter @tavern/api memory:maintenance -- --db :memory: --dry-run` 通过（beta 收口复核）
- [x] 认证、多账号隔离、SSE、Prompt dry-run、模型发现/连通性测试已完成收口复核
- [x] `apps/api/package.json` 与 OpenAPI `info.version` 已同步到 beta 预发布版本姿态（`0.2.0-beta.2`）
- [x] 进程内记忆维护定时任务的多实例部署约束与公网部署责任已写入代码注释和文档
- [x] 至少 1 个真实 provider 完成最小回归并留下记录（见下方“真实 provider 最小回归清单”）

## 真实 provider 最小回归清单（已完成）

### 建议环境

- 使用临时 `DATABASE_URL`，避免污染现有开发数据。
- 设置 `AUTH_MODE=off`，并保持 `ACCOUNT_MODE=single`，先排除鉴权和多账号变量。
- 设置 `LLM_PROVIDER`、`LLM_API_KEY`、可选 `LLM_BASE_URL`、`LLM_MODEL`。
- 设置 `ENABLE_PROMPT_DRY_RUN=true`，否则 `/sessions/:id/respond/dry-run` 会返回 `404`。
- 设置 `ENABLE_SSE_CHAT=true`，否则 `/sessions/:id/respond/stream` 会返回 `404`。
- 设置 `APP_SECRETS_MASTER_KEY`，否则 `POST /llm-profiles` 无法完成密钥加密。
- 使用 `pnpm --filter @tavern/api exec tsx src/index.ts` 启动服务。
- 启动后确认日志出现 `Chat routes enabled (model: ...)`；若未设置 `LLM_API_KEY`，`apps/api/src/index.ts` 不会注册聊天路由。

- 如需减少手工步骤，可直接运行 `pnpm --filter @tavern/api real-provider:regression -- --operator <name> [--output .tmp/real-provider-regression.json]`。该脚本会用临时 `DATABASE_URL` 拉起本地 `apps/api` 实例，自动执行下方清单并输出 JSON 记录。
- 脚本不会把 `api_key` 或 `APP_SECRETS_MASTER_KEY` 写入报告；如果当前 `LLM_API_KEY` 或 `APP_SECRETS_MASTER_KEY` 仍是占位符，脚本会在真正发起 provider 请求前直接退出。

### 建议请求体

- `POST /llm-profiles/models/discover`
  - `{ "provider": "<provider>", "api_key": "<real-key>", "base_url": "<optional>" }`
- `POST /llm-profiles/models/test`
  - `{ "provider": "<provider>", "model_id": "<model>", "api_key": "<real-key>", "base_url": "<optional>" }`
- `POST /llm-profiles`
  - `{ "preset_name": "Real Provider Smoke", "provider": "<provider>", "model_id": "<model>", "api_key_name": "REAL_PROVIDER_KEY", "api_key": "<real-key>", "base_url": "<optional>" }`
- `POST /sessions`
  - `{ "title": "real-provider-regression", "prompt_mode": "native" }`
- `POST /llm-profiles/:id/activate`
  - `{ "scope": "session", "session_id": "<sessionId>", "instance_slot": "*" }`
- `POST /sessions/:id/respond/dry-run`
  - `{ "message": "Please introduce yourself in one short paragraph." }`
- `POST /sessions/:id/respond`
  - `{ "message": "Please introduce yourself in one short paragraph." }`
- `POST /sessions/:id/respond/stream`
  - `{ "message": "Please introduce yourself in one short paragraph." }`
- `POST /sessions/:id/regenerate`
  - `{}`

### 执行顺序

1. `GET /health` 返回 `{ ok: true, service: "@tavern/api", database: "ready" }`。
2. `POST /llm-profiles/models/discover` 返回 `200`，并且 `data[]` 中包含目标 `model_id`。
3. `POST /llm-profiles/models/test` 返回 `200`，`request_text` 为 `"Hello"`，且 `response_text` 非空。
4. `POST /llm-profiles` 返回 `201`，记录创建出的 profile id。
5. `POST /sessions` 返回 `201`，记录创建出的 session id。
6. `POST /llm-profiles/:id/activate` 以 `scope=session`、`instance_slot=*` 激活后返回 `200`，且 `activated=true`。
7. `GET /llm-profiles/runtime?session_id=<sessionId>` 返回 `200`，并能在解析结果中看到刚激活的 profile id。
8. `POST /sessions/:id/respond/dry-run` 返回 `200`，包含 `messages[]`、`token_estimate`、`available_for_reply`。
9. `POST /sessions/:id/respond` 返回 `200`，包含非空 `generated_text`、`floor_id`，且 `final_state="committed"`。
10. `POST /sessions/:id/respond/stream` 返回 `200`，SSE 输出至少包含 `event: start` 与 `event: done`。
11. `POST /sessions/:id/regenerate` 返回 `200`，包含新的 `floor_id` 和非空 `previous_floor_id`。
12. 可选清理：`DELETE /sessions/:id` 与 `DELETE /llm-profiles/:id` 均返回 `200`。

### 建议记录字段

- 执行日期与执行人
- provider
- `base_url`（如有）
- `model_id`
- 本次是否只验证 env fallback，还是同时验证了 `llm_profile` 激活链路
- `discover`、`models/test`、`create profile`、`activate`、`runtime`、`dry-run`、`respond`、`respond/stream`、`regenerate` 的逐项结果
- 如失败，记录首个失败端点、HTTP status 与错误响应体

## 记忆维护语义（beta 接受）

- `summary` 与 `open_loop` 的自动 deprecated 仍按 `createdAt` 计算。
- `purge deprecated` 采用 `memory_item.updated_at` 语义，不新增 `deprecatedAt` 字段。
- 当前定义的含义是：条目处于 `deprecated` 状态，且自上次更新后超过阈值，即可被 purge。
- `MemoryMaintenanceService` 自动 deprecate 时会把 `updatedAt` 写成当前时间；如果后续通过 API 或仓储层再次更新该条目，purge 计时会顺延。
- 如果以后需要严格区分“弃用时间”和“最后编辑时间”，再通过 schema migration 引入 `deprecatedAt`。

## M21 增量：记忆系统加固与维护任务（本次）

### 1) 已完成（本次）

- [x] Core：`MemoryStore.applyConsolidation()` 新增自动冲突消解（同 key 的 fact 自动 deprecate 旧记录 + updates 边）
- [x] Core：`MemoryInjectionOptions` 支持可选 `decay`（半衰期衰减排序；可按 `createdAt/updatedAt` 计算年龄）
- [x] API：`ChatService.retrieveMemorySummary()` 透传 `decay`；新增 `MEMORY_INJECTION_DECAY_*` 环境变量解析
- [x] API：新增 `MemoryMaintenanceService` + 可选定时任务（deprecate summary/open_loop + purge deprecated）
- [x] API：新增记忆维护 CLI：`pnpm --filter @tavern/api memory:maintenance -- ...`（支持 dry-run / batch / policy flags）
- [x] DB：新增索引 migration `0010_memory_indexes.sql`（memory_item: status/updated_at + scope_id/status/type/importance）
- [x] 文档：`.env.example` / `README.md` 补充 decay 与 maintenance 配置项

### 2) 测试与验证（本次）

- [x] `pnpm --filter @tavern/core test` 通过（新增 memory-store 回归）
- [x] `pnpm --filter @tavern/core build` 通过（避免 api 引用到 stale 类型产物）
- [x] `pnpm --filter @tavern/api typecheck` 通过
- [x] `pnpm --filter @tavern/api test` 通过（新增 memory-maintenance 测试）
- [x] `pnpm --filter @tavern/api memory:maintenance -- --db :memory: --dry-run` 通过

### 3) 本次修改文件

- `packages/core/src/memory/memory-store.ts`
- `packages/core/src/memory/types.ts`
- `packages/core/src/memory/__tests__/memory-store.test.ts`
- `apps/api/src/services/chat-service.ts`
- `apps/api/src/services/memory-maintenance-service.ts`
- `apps/api/scripts/memory-maintenance.ts`
- `apps/api/src/app.ts`
- `apps/api/src/config.ts`
- `apps/api/src/index.ts`
- `apps/api/drizzle/0010_memory_indexes.sql`
- `apps/api/drizzle/meta/_journal.json`
- `apps/api/test/memory-maintenance.test.ts`
- `apps/api/package.json`
- `.env.example`
- `README.md`
- `apps/api/PROGRESS.md`

## M20 增量：LLM 模型列表发现（本次）

### 1) 已完成（本次）

- [x] 新增路由 `POST /llm-profiles/models/discover`，支持基于 `provider/base_url/api_key` 拉取模型列表
- [x] 后端按 provider 适配模型发现请求（OpenAI/OpenAI-compatible/DeepSeek/xAI、Anthropic、Google）并统一响应为 `{ id, label }`
- [x] 模型列表解析支持 `data[]` 与 `models[]` 两类上游格式，去重并按 `id` 排序
- [x] 新增路由 `POST /llm-profiles/models/test`：向指定 `provider/model` 发送 `Hello` 连通性探测并返回响应文本
- [x] OpenAPI 与集成测试补充模型发现/模型测试路径覆盖

### 2) 测试与验证（本次）

- [x] `pnpm --filter @tavern/api typecheck` 通过
- [x] `pnpm --filter @tavern/api test -- test/llm-profiles.integration.test.ts` 通过
- [x] `pnpm --filter @tavern/api test -- test/openapi.integration.test.ts` 通过

### 3) 本次修改文件

- `apps/api/src/routes/llm-profiles.ts`
- `apps/api/test/llm-profiles.integration.test.ts`
- `apps/api/test/openapi.integration.test.ts`
- `apps/api/PROGRESS.md`

## M19 增量：Account User Binding（本次）

### 1) 已完成（本次）

- [x] 新增 `account_user` 实体与 migration：`0008_account_user_binding.sql`
- [x] `session` 新增 `user_id`、`user_snapshot_json`
- [x] `floor` 新增 `metadata_json`，用于落地 `user_binding`
- [x] 新增 `users` 路由（`POST/GET/PATCH/DELETE /users*`）并接入账号隔离
- [x] `sessions` 路由支持 `user_id/user_snapshot` 绑定与替换
- [x] 会话替换 user 时，在事务内批量更新该会话下 floor 的 `metadata_json.user_binding`
- [x] PromptAssembler 优先读取 `session.user_snapshot_json`，兼容回退 `metadata.persona`
- [x] ChatService 在新建 floor 时写入 `metadata_json.user_binding`

### 2) 测试与验证（本次）

- [x] `pnpm --filter @tavern/api typecheck` 通过
- [x] `pnpm --filter @tavern/api test -- test/users-and-session-binding.integration.test.ts` 通过
- [x] `pnpm --filter @tavern/api test -- test/e2e-chat.test.ts` 通过
- [x] `pnpm --filter @tavern/api test -- test/openapi.integration.test.ts` 通过
- [x] `pnpm --filter @tavern/api test -- test/api.integration.test.ts test/auth.integration.test.ts test/session-character-sync.integration.test.ts` 通过
- [x] `pnpm sdk:generate` 通过
- [x] `pnpm sdk:check` 通过

### 3) 本次修改文件

- `apps/api/src/db/schema.ts`
- `apps/api/drizzle/0008_account_user_binding.sql`
- `apps/api/drizzle/meta/_journal.json`
- `apps/api/src/routes/users.ts`
- `apps/api/src/routes/sessions.ts`
- `apps/api/src/routes/index.ts`
- `apps/api/src/services/prompt-assembler.ts`
- `apps/api/src/services/chat-service.ts`
- `apps/api/test/users-and-session-binding.integration.test.ts`
- `apps/api/test/e2e-chat.test.ts`
- `docs/database.md`
- `docs/architecture.md`
- `apps/api/PROGRESS.md`

## M18 增量：Sessions + Chat 多账号隔离收口（本次）

### 1) 已完成（本次）

- [x] `auth.integration` 补充 session 跨账号隔离回归：`branches/timeline/branch-diff/delete` 访问全部按账号隔离
- [x] `chat-flow` 补充 ChatService 跨账号拒绝断言：`regenerate/retryFloor/editAndRegenerate`
- [x] `chat-routes.integration` 补充 `/sessions/:id/regenerate` 的 `accountId` 透传断言
- [x] 复核 `chat.ts` 与 `ChatService` 参数签名，`pnpm --filter @tavern/api typecheck` 通过

### 2) 测试与验证（本次）

- [x] `pnpm --filter @tavern/api typecheck` 通过
- [x] `pnpm --filter @tavern/api test -- auth.integration.test.ts chat-routes.integration.test.ts chat-flow.test.ts` 通过（3 files, 37 tests）

### 3) 本次修改文件

- `apps/api/test/auth.integration.test.ts`
- `apps/api/test/chat-flow.test.ts`
- `apps/api/test/chat-routes.integration.test.ts`
- `apps/api/PROGRESS.md`

## M18 增量：LLM Profile Vault（Phase 1-4 本次）

### Phase 4b/4c: Instance Slot + Per-Slot Profile Binding

- [x] 数据库 migration `0006_instance_slot.sql`：`llm_profile_binding.instance_slot` 列 + 新唯一约束
- [x] `LlmProfileService.activateProfile()` 支持 `instanceSlot` 参数
- [x] `LlmProfileService.resolveActiveProfiles()` 按 slot 粒度批量解析
- [x] 路由 `POST /llm-profiles/:id/activate` body 新增 `instance_slot`
- [x] `ChatService` 支持多 slot 模型解析 + `modelOverrides` 映射
- [x] `app.ts` wiring 使用 `resolveActiveProfiles` 替代 `resolveActiveProfile`
- [x] Core 层：`InstanceSlot` 类型、`TurnInput.modelOverrides`、`resolveSlotModel()` 透传
- [x] `Director` / `Verifier` / `MemoryConsolidator` 支持可选 `model` 参数

#### 修改文件

- `apps/api/drizzle/0006_instance_slot.sql` (new)
- `apps/api/drizzle/meta/_journal.json`
- `apps/api/src/db/schema.ts`
- `apps/api/src/services/llm-profile-service.ts`
- `apps/api/src/services/chat-service.ts`
- `apps/api/src/routes/llm-profiles.ts`
- `apps/api/src/app.ts`
- `packages/core/src/llm/types.ts` + `index.ts`
- `packages/core/src/orchestration/types.ts` + `turn-orchestrator.ts` + `director.ts` + `verifier.ts`
- `packages/core/src/memory/memory-consolidator.ts`

### 1) 已完成（本次）

- [x] 新增 `llm_profile` 表（provider/model/base_url/key_name/密钥密文/掩码/状态/最后使用时间）
- [x] 新增 `llm_profile_binding` 表（`global|session` 作用域绑定）
- [x] 增加 migration `0005_llm_profile_vault.sql`
- [x] 新增密钥工具 `lib/secrets.ts`（AES-256-GCM 加密/解密 + mask）
- [x] 新增 `LlmProfileService`（create/list/get/update/delete/activate/resolve/touch）
- [x] 新增路由 `llm-profiles`（CRUD + activate）并接入 OpenAPI tag
- [x] 更新 migration journal 与数据库文档/进度文档
- [x] `buildApp + ChatService` 接入运行时 profile 解析（`session > global > env fallback`）
- [x] 聊天生成链路支持 per-turn model override，并在成功回合后更新 `last_used_at`

### 2) 测试与验证（本次）

- [x] `pnpm --filter @tavern/api typecheck` 通过
- [x] `pnpm --filter @tavern/api test -- llm-profiles.integration.test.ts openapi.integration.test.ts` 通过
- [x] `pnpm --filter @tavern/core typecheck` 通过
- [x] `pnpm --filter @tavern/core test -- generation-pipeline.test.ts` 通过
- [x] `pnpm --filter @tavern/api test -- chat-flow.test.ts llm-profiles.integration.test.ts` 通过

### 3) 本次修改文件

- `apps/api/src/db/schema.ts`
- `apps/api/drizzle/0005_llm_profile_vault.sql`
- `apps/api/drizzle/meta/_journal.json`
- `apps/api/src/lib/secrets.ts`
- `apps/api/src/services/llm-profile-service.ts`
- `apps/api/src/routes/llm-profiles.ts`
- `apps/api/src/routes/index.ts`
- `apps/api/src/plugins/openapi.ts`
- `apps/api/test/llm-profiles.integration.test.ts`
- `apps/api/test/openapi.integration.test.ts`
- `docs/database.md`
- `apps/api/PROGRESS.md`
- `apps/api/src/app.ts`
- `apps/api/src/services/chat-service.ts`
- `apps/api/src/routes/chat.ts`
- `apps/api/test/chat-flow.test.ts`
- `packages/core/src/generation/*`
- `packages/core/src/orchestration/*`

## M17 增量：P1 Phase 2 认证插件（本次）

### 1) 已完成（本次）

- [x] 新增轻量认证插件 `AUTH_MODE=off|api_key|jwt`（`apps/api/src/plugins/auth.ts`）
- [x] `buildApp` 接入认证配置，默认 `off`，并对业务路由启用统一鉴权
- [x] `loadConfig` 新增 `AUTH_MODE` / `AUTH_API_KEYS` / `AUTH_JWT_SECRET` 解析与错误校验
- [x] OpenAPI 增加 `ApiKeyAuth`/`BearerAuth` security scheme 与全局 security 声明
- [x] `/health` 显式声明 `security: []`，与运行时白名单语义保持一致

### 2) 测试与验证（本次）

- [x] 新增 `test/auth.integration.test.ts`（api_key/jwt 两种模式）
- [x] `test/openapi.integration.test.ts` 新增认证文档断言
- [x] `pnpm --filter @tavern/api typecheck` 通过
- [x] `pnpm --filter @tavern/api test -- auth.integration.test.ts openapi.integration.test.ts` 通过

### 3) 修改文件（本次）

- `apps/api/src/plugins/auth.ts`、`apps/api/src/config.ts`、`apps/api/src/app.ts`、`apps/api/src/plugins/openapi.ts`、`apps/api/src/index.ts`
- `apps/api/test/auth.integration.test.ts`、`apps/api/test/openapi.integration.test.ts`
- `.env.example`、`apps/api/package.json`

## M17 增量：P1 OpenAPI 导出 + typed SDK 接线（本次）

### 1) 已完成（本次）

- [x] 新增 `apps/api/scripts/export-openapi.ts`，支持稳定导出 OpenAPI JSON（递归键排序，避免无意义 diff）
- [x] 根脚本新增 `openapi:export` / `sdk:generate` / `sdk:check`
- [x] 引入 `openapi-typescript` 并接入 `packages/shared/src/generated/openapi-types.ts` 自动生成
- [x] 新增生成一致性校验 `scripts/check-sdk-generated.ts`（比较临时产物与仓库产物）
- [x] `packages/shared` 新增 typed API client（`createApiClient`）
- [x] 前端接入一次 typed 调用样例（`GET /health`）验证 SDK 可直接消费

### 2) 产物与接线（本次）

- [x] 生成产物：`packages/shared/src/generated/openapi.json`
- [x] 生成产物：`packages/shared/src/generated/openapi-types.ts`
- [x] shared 导出：`packages/shared/src/api/client.ts`、`packages/shared/src/api/index.ts`、`packages/shared/src/index.ts`
- [x] web 接线：`apps/web/src/lib/api.ts`、`apps/web/src/App.vue`

### 3) 测试与验证（本次）

- [x] `pnpm sdk:generate` 通过
- [x] `pnpm sdk:check` 通过
- [x] `pnpm --filter @tavern/api test -- openapi.integration.test.ts` 通过
- [x] `pnpm typecheck` 通过

## M17 增量：P1 OpenAPI Schema 覆盖补齐（进行中）

### 1) 已完成（本次）

- [x] `messages` 路由补齐 OpenAPI schema（CRUD 全量）
- [x] `pages` 路由补齐 OpenAPI schema（CRUD + `PATCH /pages/:id/activate`）
- [x] `variables` 路由补齐 OpenAPI schema（upsert/list/get/delete）
- [x] 为上述路由补齐 `operationId`，用于后续 SDK 生成的稳定命名
- [x] `characters` 路由补齐 OpenAPI schema（list/get/versions/create-version/rollback/delete/restore）
- [x] `imports` 路由补齐 OpenAPI schema（4 个导入端点 + presets/worldbooks/regex-profiles CRUD）
- [x] OpenAPI tags 补充 `characters`

### 2) 测试与验证（本次）

- [x] `test/openapi.integration.test.ts` 增加 `messages/pages/variables/imports/characters` 的 schema 与 `operationId` 可见性断言
- [x] `pnpm --filter @tavern/api typecheck` 通过
- [x] `pnpm --filter @tavern/api test -- openapi.integration.test.ts` 通过

### 3) 本次修改文件

- `apps/api/src/routes/messages.ts`
- `apps/api/src/routes/pages.ts`
- `apps/api/src/routes/variables.ts`
- `apps/api/src/routes/characters.ts`
- `apps/api/src/routes/imports.ts`
- `apps/api/src/plugins/openapi.ts`
- `apps/api/test/openapi.integration.test.ts`

## M16 增量：P0 Hardening（本次）

### 1) Character 生命周期 API

- [x] 新增 `GET /characters`、`GET /characters/:id`
- [x] 新增 `GET /characters/:id/versions`
- [x] 新增 `POST /characters/:id/versions`
- [x] 新增 `POST /characters/:id/versions/:versionId/rollback`
- [x] 新增 `DELETE /characters/:id`（软删除）
- [x] 新增 `POST /characters/:id/restore`

### 2) 关键写路径事务化

- [x] `POST /import/character` 在 create_session=true 时改为单事务写入 `character + character_version + session bootstrap`
- [x] `ChatService.respond`：`floor + input page/message` 事务化
- [x] `ChatService.regenerate`：`supersede old floor + new floor + input page/message` 事务化
- [x] `ChatService.retryFloor`：`clear output + floor reset` 事务化

### 3) Smoke 脚本与文档可见性

- [x] 修复 `scripts/smoke-api.ts` 中 `assert(boolean | undefined)` 的 TS 报错
- [x] 补充 character 清理路径（导入角色在 cleanup 阶段自动删除）
- [x] `openapi.integration` 增加 `/characters` 路径可见性断言

### 4) 测试结果

- [x] 新增 `test/character-lifecycle.integration.test.ts`
- [x] `pnpm --filter @tavern/api typecheck` 通过
- [x] `pnpm --filter @tavern/api test` 通过（21 files, 184 tests）

## M15 增量：Character Binding Hard Cut（本次）

### 1) 数据模型重构

- [x] 新增 `character` / `character_version` 表，支持角色模板与版本化存储
- [x] `session` 表新增 `character_id` / `character_version_id` / `character_snapshot_json` / `character_sync_policy`
- [x] 新增迁移 `0004_character_binding.sql`，并更新 migration journal

### 2) 路由与业务逻辑切换

- [x] `POST/PATCH /sessions` 支持角色绑定字段，并在创建会话时写入冻结快照
- [x] `GET /sessions*` 返回 `character_binding`（含快照摘要）
- [x] greeting 创建逻辑改为仅从 `character_snapshot_json.greeting` 读取
- [x] `POST /import/character` 改为先落 `character + character_version`，再可选创建绑定会话
- [x] 新增 `POST /sessions/:id/character/sync`，支持 manual/force 显式同步最新角色版本

### 3) Prompt 链路切换

- [x] PromptAssembler 改为读取 `session.characterSnapshotJson` 作为角色来源
- [x] 移除 `metadata.character` 角色读取路径（persona 与 metadata.prompt_mode 保持可用）
- [x] ChatService 全链路透传 `characterSnapshotJson`

### 4) 测试与回归

- [x] 更新 `test/character-import.integration.test.ts` 断言为 `character_binding` 与角色版本字段
- [x] 更新 `test/e2e-chat.test.ts` 会话构造为 `characterSnapshotJson`
- [x] `pnpm --filter api typecheck` 通过
- [x] 新增 `test/session-character-sync.integration.test.ts` 覆盖 `manual/pin(force)` 同步语义
- [x] `scripts/smoke-api.ts` 扩展为全链路 CRUD + branch/import/character-binding 冒烟
- [x] `pnpm --filter api test` 通过（20 files, 183 tests）

### 新增/修改文件

- `apps/api/src/db/schema.ts`、`apps/api/drizzle/0004_character_binding.sql`、`apps/api/drizzle/meta/_journal.json`
- `apps/api/src/routes/sessions.ts`、`apps/api/src/routes/imports.ts`
- `apps/api/src/services/prompt-assembler.ts`、`apps/api/src/services/chat-service.ts`
- `apps/api/test/character-import.integration.test.ts`、`apps/api/test/e2e-chat.test.ts`
- `apps/api/test/session-character-sync.integration.test.ts`、`apps/api/test/openapi.integration.test.ts`、`apps/api/scripts/smoke-api.ts`

## M14 增量：OpenAPI 覆盖扩展 + 记忆整理链路接线（本次）

### 1) OpenAPI Schema 覆盖扩展

- [x] `sessions` 路由补充 schema（create/list/get/update/delete + branches/diff + timeline）
- [x] `floors` 路由补充 schema（CRUD + branch create/delete）
- [x] `memories` / `memory-edges` 路由补充 schema，并新增 `GET /memories/stats`

### 2) 记忆系统增强（M7 后续）

- [x] `ChatService` 在 `respond/regenerate/retry/edit+regen` 生成链路接入 consolidation context
- [x] 增加 `enableMemoryConsolidationByDefault` 开关（`ENABLE_MEMORY_CONSOLIDATION`）
- [x] `memories` 查询增强：支持 `source_floor_id/source_message_id`、time range、importance/confidence range、`q` 关键字
- [x] 新增 `GET /memories/stats`（总数、状态分布、类型分布、平均重要度/置信度、估算 token）

### 3) 测试

- [x] `test/openapi.integration.test.ts`：新增 core CRUD schema 可见性断言
- [x] `test/api.integration.test.ts`：新增 memories 过滤与 stats 回归
- [x] `test/memory-injection.test.ts`：新增 consolidation context 透传断言

### 新增/修改文件

- `apps/api/src/services/chat-service.ts`、`apps/api/src/app.ts`、`apps/api/src/config.ts`、`apps/api/src/index.ts`
- `apps/api/src/routes/memories.ts`、`apps/api/src/routes/sessions.ts`、`apps/api/src/routes/floors.ts`
- `apps/api/test/openapi.integration.test.ts`、`apps/api/test/api.integration.test.ts`、`apps/api/test/memory-injection.test.ts`
- `.env.example`

### 本次实际完成项（续接）

- [x] OpenAPI 集成测试扩展：覆盖 `sessions` 分支/差异/timeline 与 `floors` branch CRUD 文档可见性
- [x] 记忆整理链路回归扩展：补充 `ChatService.regenerate/retryFloor/editAndRegenerate` consolidation context 透传断言
- [x] 新增测试辅助构造（floor + input page + user message），用于多生成入口的最小场景复用

### 测试结果（本次）

- [x] `pnpm --filter api test` 通过（19 files, 180 tests）
- [x] `pnpm --filter api typecheck` 通过

### 修改文件（本次）

- `apps/api/test/openapi.integration.test.ts`
- `apps/api/test/memory-injection.test.ts`
- `apps/api/PROGRESS.md`

## M13 已完成：分支治理 + 编辑重试能力补齐（本次增量）

### 1) 分支 CRUD/比对能力

- [x] 新增 `GET /sessions/:id/branches`，支持分页与多维排序（branch_id/floor_count/latest_floor_no/updated_at）
- [x] 新增 `DELETE /branches/:id`（支持 `session_id` 消歧、保护 `main` 分支）
- [x] 新增 `GET /sessions/:id/branches/diff`（base/target 分支差异与 fork floor 统计）

### 2) 聊天端点补齐 branch/edit/retry

- [x] `POST /sessions/:id/respond` / `respond/stream` 支持 `branch_id` 与 `source_floor_id`
- [x] 新增 `POST /messages/:id/edit-and-regenerate`（编辑 user 消息后 fork 新分支并重生）
- [x] 新增 `POST /floors/:id/retry`（failed 楼层原地重试）
- [x] 聊天响应统一返回 `branch_id`

### 3) ChatService 分支历史与错误映射增强

- [x] 历史加载升级为“目标分支优先 + main 回退”合并策略，支持非 main 分支连续对话
- [x] `respond` 新增分支上下文解析（已有分支续写 / 空分支基于 source floor or main tip 起始）
- [x] 新增 `retryFloor`、`editAndRegenerate` 业务流程（含状态校验、输出清理、token 回填）
- [x] 错误码补齐（`branch_exists`/`invalid_state`/`message_not_found` 等）

### 4) 测试与回归

- [x] 新增 `test/branch-management.integration.test.ts`（branch list/diff/delete）
- [x] 新增 `test/chat-routes.integration.test.ts`（respond branch 字段、retry/edit 路由映射）
- [x] `test/chat-flow.test.ts` 扩展分支续写、failed retry、edit+regen 场景
- [x] 回归通过：`pnpm --filter api test`（174 tests） + `pnpm --filter api typecheck`

### 新增/修改文件

- `apps/api/src/routes/sessions.ts`、`apps/api/src/routes/floors.ts`、`apps/api/src/routes/chat.ts`
- `apps/api/src/services/chat-service.ts`
- `apps/api/src/plugins/request-logging.ts`
- `apps/api/test/branch-management.integration.test.ts`、`apps/api/test/chat-routes.integration.test.ts`
- `apps/api/test/chat-flow.test.ts`、`apps/api/test/chat-stream.integration.test.ts`、`apps/api/test/openapi.integration.test.ts`、`apps/api/test/request-logging.integration.test.ts`

## M12 Phase 4 进行中：Native Prompt Pipeline v1（本次增量）

### 1) Core 节点闭环

- [x] `native-pipeline` 新增 `memory_inject` 节点，支持原生链路内注入 `[Memory Summary]`
- [x] `native-pipeline` 新增 `pack_messages` 节点，统一完成 section 清理、排序与最终 `PromptIR` 输出
- [x] 默认节点链路更新为：`template -> worldbook_resolve -> memory_inject -> token_budget -> pack_messages`

### 2) Session 显式 prompt_mode 字段

- [x] `session` 表新增 `prompt_mode` 字段（含 migration）
- [x] `POST /sessions` 与 `PATCH /sessions/:id` 支持 `prompt_mode`
- [x] Prompt 组装优先读取显式字段 `session.promptMode`，再回退 `metadata.promptMode/prompt_mode`

### 3) 测试补齐

- [x] `@tavern/core`：新增 native 节点测试（memory 注入位置、pack 输出）
- [x] `@tavern/api`：补充 native/compat 分流集成测试（显式字段优先级 + metadata 回退）
- [x] `@tavern/api`：补充 dry-run 下 compat/native 分流回归

### 新增/修改文件

- `packages/core/src/prompt/native-pipeline.ts` — 新增 `MemoryInjectNode`、`PackMessagesNode`
- `packages/core/src/prompt/index.ts`、`packages/core/src/index.ts` — 导出新增 native 节点
- `packages/core/src/prompt/__tests__/native-pipeline.test.ts` — 补充 native 节点单测
- `apps/api/src/db/schema.ts` — `session.prompt_mode` 字段
- `apps/api/drizzle/0003_session_prompt_mode.sql` — 新增 migration
- `apps/api/drizzle/meta/_journal.json` — 迁移索引更新
- `apps/api/src/routes/sessions.ts` — create/update/get/list 支持 `prompt_mode`
- `apps/api/src/services/chat-service.ts` — 透传 `session.promptMode`
- `apps/api/src/services/prompt-assembler.ts` — native 链路接入 memory 节点，兼容路径保持原注入逻辑
- `apps/api/test/e2e-chat.test.ts`、`apps/api/test/api.integration.test.ts` — 分流与 session prompt_mode 集成测试

## M11 Phase 3 已完成：Prompt Dry-run 调试端点

### 1) 路由与开关

- [x] 新增 `POST /sessions/:id/respond/dry-run`
- [x] 新增 `ENABLE_PROMPT_DRY_RUN` feature flag（默认关闭）
- [x] 未开启开关时统一返回 `404 not_found`

### 2) Prompt 组装调试信息

- [x] `PromptAssembler` 新增可选 debug 元信息输出（mode/preset/worldbook/regex/memory）
- [x] dry-run 返回 `messages`、`token_estimate`、`available_for_reply`
- [x] 返回 `memory_summary` 与 `assembly` 调试块（含正则规则与预处理预览）

### 3) 无副作用保证

- [x] `ChatService.dryRun()` 只做读取与组装，不调用 orchestrator
- [x] 不写入 floor/message 等会话回合数据

### 4) 测试与回归

- [x] 新增 `test/prompt-dry-run.integration.test.ts`（3 tests）
- [x] 更新 `test/request-logging.integration.test.ts`（覆盖 dry-run route_tag）
- [x] 回归通过：`chat-flow`、`chat-stream`、`typecheck`
- [x] 补齐 chat 相关 OpenAPI schema，并新增文档路由覆盖测试

### 新增/修改文件

- `apps/api/src/routes/chat.ts` — dry-run 路由与响应映射
- `apps/api/src/services/chat-service.ts` — `dryRun()` 无副作用实现
- `apps/api/src/services/prompt-assembler.ts` — debug 元信息输出
- `apps/api/test/openapi.integration.test.ts` — chat 端点 OpenAPI 可见性与响应 schema 覆盖
- `apps/api/src/config.ts`、`apps/api/src/app.ts`、`apps/api/src/index.ts` — 开关配置贯通
- `apps/api/src/plugins/request-logging.ts` — dry-run 路由归类为 `chat`
- `apps/api/test/prompt-dry-run.integration.test.ts` — dry-run 集成与无副作用测试
- `docs/architecture.md` — API 概览补充 stream/dry-run/character 导入端点

## M10 Phase 2 已完成：角色卡导入（SillyTavern）

### 1) 角色卡解析器（adapters）

- [x] 新增 `parseCharacterCard()`，支持 TavernCard v2 envelope 与扁平 legacy payload
- [x] 标准化输出结构：`name/description/personality/scenario/firstMes/mesExample`
- [x] 字段清洗与限制：换行归一化、trim、长度上限
- [x] 新增解析器测试（4 tests）

### 2) 导入端点（api）

- [x] 新增 `POST /import/character`
- [x] 支持 `create_session=true|false` 两种模式
- [x] `create_session=true` 时自动创建会话，并映射到 `session.metadata_json`
- [x] 若角色卡包含 `first_mes`，自动写入 greeting 楼层（floor 0 + assistant message）
- [x] 增加 payload 大小保护：超限返回 `413 import_payload_too_large`

### 3) 测试与回归

- [x] 新增 `test/character-import.integration.test.ts`（4 tests）
- [x] 回归通过：`imports.test.ts`（19 tests）

### 新增/修改文件

- `packages/adapters-sillytavern/src/types/character.ts` — 角色卡领域类型
- `packages/adapters-sillytavern/src/parsers/character-parser.ts` — TavernCard 解析器
- `packages/adapters-sillytavern/src/__tests__/character-parser.test.ts` — 解析器单测
- `packages/adapters-sillytavern/src/index.ts` — 新增 character 导出
- `apps/api/src/routes/imports.ts` — `/import/character` 路由与会话创建逻辑
- `apps/api/test/character-import.integration.test.ts` — 角色导入集成测试

## M9 Phase 1 已完成：SSE 流式聊天端点

### 1) 路由与流式协议

- [x] 新增 `POST /sessions/:id/respond/stream`
- [x] 使用 SSE 输出 `start/chunk/summary/done/error` 事件
- [x] 保持 `POST /sessions/:id/respond`、`POST /sessions/:id/regenerate` 行为不变

### 2) ChatService / Core 透传

- [x] `ChatService.respond()` 新增 runtime 选项（`onStart`、`onChunk`、`abortSignal`）
- [x] `TurnInput` 扩展 `abortSignal` 字段
- [x] `TurnOrchestrator -> GenerationPipeline` 透传中止信号，实现断连中止

### 3) 配置与可观测性

- [x] 新增 `ENABLE_SSE_CHAT` feature flag（默认关闭）
- [x] 配置链路贯通：`config -> buildApp -> registerChatRoutes`
- [x] `request-logging` 补充 `/sessions/:id/respond/stream` 的 `route_tag=chat`
- [x] `.env.example` 增加 SSE 开关示例

### 4) 测试与回归

- [x] 新增 `test/chat-stream.integration.test.ts`（3 tests）
- [x] 更新 `test/request-logging.integration.test.ts`（覆盖 stream route_tag）
- [x] 回归通过：`chat-flow`、`api` 全量测试、`core` 全量测试、`typecheck`

### 新增/修改文件

- `apps/api/src/routes/chat.ts` — SSE 端点实现与错误映射
- `apps/api/src/services/chat-service.ts` — runtime callbacks/abort 透传
- `apps/api/src/config.ts` — `ENABLE_SSE_CHAT` 配置
- `apps/api/src/app.ts` — `enableSseChat` 配线
- `apps/api/src/index.ts` — 启动参数注入
- `apps/api/src/plugins/request-logging.ts` — stream route_tag 归类
- `apps/api/test/chat-stream.integration.test.ts` — SSE 集成测试
- `apps/api/test/request-logging.integration.test.ts` — route_tag 回归测试
- `packages/core/src/orchestration/types.ts` — `TurnInput.abortSignal`
- `packages/core/src/orchestration/turn-orchestrator.ts` — abortSignal 透传

## M8 已完成：核心 RP 体验接口

### 1) GET /sessions/:id/timeline — 时间线查询

- [x] 查询指定会话的 committed 楼层，按 floor_no 升序
- [x] 默认 `main` 分支，支持 `branch_id` 参数切换
- [x] 每个楼层返回活跃消息页 + 非隐藏消息（JOIN 查询，避免 N+1）
- [x] `page_count` 字段：总页数（含非活跃），供前端 swipe 指示器
- [x] 支持 `limit` / `offset` 分页
- [x] 7 个测试用例

### 2) POST /floors/:id/branch — 分支创建

- [x] 从 committed 楼层创建分支
- [x] 自动生成 `branch-{nanoid(8)}` 或使用用户指定的 branch_id
- [x] 验证源楼层存在且为 committed 状态
- [x] 验证 branch_id 在该 session 中唯一
- [x] 5 个测试用例

### 3) PATCH /pages/:id/activate — 消息页激活（Swipe）

- [x] 将指定消息页设为活跃，同楼层其他页自动 deactivate
- [x] 幂等：已活跃的页直接返回
- [x] 不影响其他楼层的页面
- [x] 5 个测试用例

### 新增/修改文件

- `apps/api/src/routes/sessions.ts` — 添加 timeline 路由
- `apps/api/src/routes/floors.ts` — 添加 branch 路由
- `apps/api/src/routes/pages.ts` — 添加 activate 路由
- `apps/api/test/m8-core-rp.test.ts` — 17 个集成测试

## M7 Phase 4A 已完成：摘要注入

### 1) PromptAssembler 记忆注入

\- [x] `assemblePrompt` 新增可选 `memorySummary` 参数
\- [x] 新增 `injectMemorySummary()` 函数，在第一条 system 消息之后插入 `[Memory Summary]` 块
\- [x] 有预设和无预设降级两条路径均支持

### 2) ChatService 接入记忆系统

\- [x] `ChatServiceOptions` 新增可选 `memoryStore` 字段
\- [x] `respond()` / `regenerate()` 均接入记忆检索 + 持久化
\- [x] 新增 `retrieveMemorySummary()` — 调用 `memoryStore.prepareInjection`
\- [x] 新增 `persistMemory()` — 调用 `memoryStore.ingestSummaries`
\- [x] 错误容忍：记忆检索/持久化失败不阻断聊天流程

### 3) BuildApp 配线 + 环境变量

\- [x] `OrchestrationContext` 暴露 `memoryStore` 实例
\- [x] `BuildAppOptions` 新增 `enableMemory`，按需注入 memoryStore
\- [x] 新增 `ENABLE_MEMORY` 环境变量（默认 false）
\- [x] `.env.example` 已更新

### 4) 测试

\- [x] 新增 `test/memory-injection.test.ts`（7 个测试用例）
\- [x] 全量测试通过：129 tests / 12 test files

## M6 Phase 3 已完成：长会话性能优化

### 1) 历史加载查询优化（N+1 -> 聚合查询）

- [x] `ChatService.loadHistory*` 从逐层循环查询改为聚合 join 查询
- [x] 统一 floor scope + page/message 聚合排序（`floor_no/page_no/seq`）
- [x] 保持默认行为不变（未配置时不截断历史）

### 2) 可选历史窗口（默认关闭）

- [x] 新增 `CHAT_HISTORY_MAX_FLOORS` 环境变量（可选）
- [x] `config -> buildApp -> ChatService` 全链路贯通
- [x] 仅配置后生效，兼容依赖 regex 的预设行为

### 3) 数据库索引增强

- [x] 新增二级索引（含 migration）：
  - `floor(session_id, branch_id, state, floor_no)`
  - `message_page(floor_id, is_active, page_no)`
  - `message(page_id, is_hidden, seq)`

### 4) 可自定义楼层基准脚本

- [x] 新增 `scripts/benchmark-history.ts`
- [x] 支持参数：`--floors` / `--rounds` / `--history-max-floors` / `--user-message-size`
- [x] 输出 `avg / p50 / p95` latency

## M6 Phase 2 已完成：请求日志字段增强

### 1) 日志插件

- [x] 新建 `request-logging` 插件（`onRequest` + `onResponse`）
- [x] 增加统一日志字段：`request_id` / `latency_ms` / `route_tag`
- [x] 补充上下文日志字段：`method` / `route` / `status_code`

### 2) route_tag 归类

- [x] 新增 `resolveRouteTag` 规则：
  - `/health` → `system`
  - `/docs/*` / `/openapi.json` → `docs`
  - `/sessions/:id/respond|regenerate` → `chat`
  - `/import/*`、`/presets`、`/worldbooks`、`/regex-profiles` → `imports`
  - 其他 CRUD 路由按首段归类（如 `sessions`、`floors`）

### 3) 测试与验证

- [x] 新增 `request-logging.integration.test.ts`（4 tests）
- [x] 全量 121 个测试通过

### 新增/修改文件

- `apps/api/src/plugins/request-logging.ts` — 请求日志插件与 route_tag 规则
- `apps/api/src/app.ts` — 接入请求日志插件
- `apps/api/test/request-logging.integration.test.ts` — 请求日志集成测试

## M6 Phase 1 已完成：统一 OpenAPI/Swagger 输出

### 1) 文档基础设施

- [x] 新增 `@fastify/swagger`、`@fastify/swagger-ui` 依赖
- [x] 新建 OpenAPI 插件：统一注册 OpenAPI 元信息与 Swagger UI
- [x] 提供机器可读文档：`GET /openapi.json`
- [x] 提供可视化文档：`GET /docs/`

### 2) 应用集成

- [x] `buildApp` 启动时自动注册 OpenAPI 插件
- [x] 为 `/health` 增加 schema（tag + response）

### 3) 验证

- [x] 新增 `openapi.integration.test.ts`（2 tests）
- [x] 全量 117 个测试通过

### 新增/修改文件

- `apps/api/src/plugins/openapi.ts` — OpenAPI/Swagger 插件注册
- `apps/api/test/openapi.integration.test.ts` — OpenAPI 集成测试
- `apps/api/src/app.ts` — OpenAPI 插件接入 + health schema
- `apps/api/package.json` — 新增 Swagger 相关依赖

## M5 已完成：MVP 端到端打通

### 1) 启动配置 + 环境变量

- [x] 安装 dotenv，创建 .env.example 环境变量模板
- [x] 新建 config.ts：从环境变量构造 OrchestrationConfig
- [x] 更新 index.ts：加载配置 → 传入 buildApp → 聊天路由自动启用
- [x] 支持 LLM_PROVIDER / LLM_API_KEY / LLM_BASE_URL / LLM_MODEL 等配置

### 2) Prompt 编排接入 ChatService（核心链路打通）

- [x] 新建 PromptAssembler 服务：从 DB 加载预设/世界书/正则 → assembleCompat → Token 裁剪 → 正则挂载
- [x] ChatService.respond() 接入 PromptAssembler：编排后的 messages 替代简单拼接
- [x] ChatService.regenerate() 同步接入
- [x] preProcess（USER_INPUT 正则）/ postProcess（AI_OUTPUT 正则）传入 TurnInput
- [x] 无预设降级：默认 system prompt + 角色信息构建

### 3) 角色卡数据（快速方案）

- [x] 通过 session.metadataJson 存储角色信息（character + persona）
- [x] PromptAssembler 自动解析：name/description/personality/scenario/exampleDialogue
- [x] {{char}} / {{user}} 模板变量从 metadata 获取
- [x] Greeting 支持：创建 Session 时自动插入首条 assistant 消息

### 4) 端到端验证

- [x] 9 个 E2E 测试覆盖完整链路：
  - 无预设降级模式
  - 角色信息降级模式
  - 预设编排（main prompt + jailbreak）
  - 世界书触发（关键词 + constant）
  - 正则处理（postProcess 挂载）
  - Greeting 历史包含
  - 多轮对话历史维护
- [x] 全量 115 个测试通过

### 5) 运行期修复（M5 收尾）

- [x] 修复 dotenv 在 monorepo 下的加载路径：`apps/api` 启动时可稳定读取根目录 `.env`
- [x] 修复 ESM 环境下 Provider 可选依赖加载：`provider-registry` 改为 `createRequire`
- [x] 安装并声明 `@ai-sdk/openai` 依赖，`openai-compatible` 提供商可用
- [x] 修复 token usage 为 `null/NaN` 时触发 `floor.token_in` NOT NULL 约束错误
- [x] 响应链路增加 usage 归一化：`llm-service` / `turn-orchestrator` / `chat-service`
- [x] 手工验证通过：`respond` / 多轮对话 / `regenerate` 全部可用

### 新增/修改文件

- `apps/api/src/config.ts` — 环境变量配置加载
- `apps/api/src/index.ts` — monorepo 根 `.env` 加载修复
- `apps/api/src/services/prompt-assembler.ts` — Prompt 编排服务
- `apps/api/src/services/chat-service.ts` — token usage 归一化与 DB 写入兜底
- `apps/api/test/e2e-chat.test.ts` — E2E 测试
- `.env.example` — 环境变量模板
- `packages/core/src/llm/provider-registry.ts` — ESM 下可选依赖加载修复
- `packages/core/src/llm/llm-service.ts` — usage 字段兼容与归一化
- `packages/core/src/orchestration/turn-orchestrator.ts` — token usage 安全累加
- `packages/core/package.json` — 新增 `@ai-sdk/openai` 依赖

## M4 Phase 2 已完成：Regenerate / WebSocket / Imports

### 1) 重新生成（Regenerate）

- [x] ChatService.regenerate 方法：重试逻辑、版本管理（parentFloorId）、branchId 变更
- [x] POST /sessions/:id/regenerate 路由：Zod 验证、snake_case 响应
- [x] 8 个集成测试覆盖主流程与异常路径

### 2) WebSocket 集成

- [x] buildApp 集成 registerWsPlugin：可选 enableWebSocket 配置
- [x] 连接 EventBus → WsBridge：打通实时推送链路
- [x] 5 个集成测试覆盖初始化逻辑

### 3) 导入路由（SillyTavern 兼容）

- [x] 数据库表：`preset`, `worldbook`, `regex_profile`（Drizzle schema + migration）
- [x] 导入接口：POST /import/preset, /import/worldbook, /import/regex
- [x] 列表/详情接口：GET /presets, /worldbooks, /regex-profiles 及其 CRUD
- [x] 19 个集成测试覆盖导入、解析、CRUD

## M4 Phase 1 已完成：核心聊天接口

### 1) 服务组装（Composition Root）

- [x] OrchestrationFactory：组装 EventBus + ProviderRegistry + LLMService + Pipeline + Orchestrator
- [x] 支持多模型配置（narrator / director / verifier / memory 各自独立 LLM）

### 2) 聊天业务逻辑

- [x] ChatService：封装完整聊天回合（验证 → 历史加载 → 楼层创建 → 消息入库 → 编排 → 保存回复）
- [x] 历史加载：查询已提交楼层的活跃 Page / 非隐藏 Message，按 seq 排序
- [x] 自动楼层编号递增、token 统计回写

### 3) 聊天路由

- [x] POST /sessions/:id/respond（Zod 验证 + snake_case ↔ camelCase 映射）
- [x] 错误映射：session_not_found → 404、session_archived → 409、orchestration_failed → 500

### 4) buildApp 更新

- [x] 可选 `orchestration` 配置参数
- [x] 返回 `BuildAppResult`（包含 app + orchestrationContext）
- [x] 向后兼容：不传 orchestration 时行为与之前一致

### 5) 测试

- [x] ChatService 单元测试（Mock Orchestrator + 真实 DB）：10 tests
- [x] 全量验证通过（API 106 个测试）

## M3 已完成

### 1) DB Adapters（Port 接口实现）

- [x] DrizzleFloorRepository：实现 `FloorRepository` 接口（findById、updateState）
- [x] DrizzleVariableRepository：实现 `VariableRepository` 接口（findByKey、findAllByScope、upsert、deleteById、deleteByKey）
- [x] DrizzleMemoryRepository：实现 `MemoryRepository` 接口（findById、findMany、create、update、deprecate、createEdge、findEdges）
- [x] Adapter barrel export

### 2) WebSocket 实时推送

- [x] WsBridge：EventBus → WebSocket 桥接器（14 种事件、sessionId 过滤、客户端管理）
- [x] registerWsPlugin：Fastify WebSocket 插件注册（GET /ws?session_id=xxx）
- [x] 推送协议：`{ type: 'event', event, data, timestamp }`

### 3) M3 测试

- [x] DrizzleFloorRepository 测试（8 tests）
- [x] DrizzleVariableRepository 测试（12 tests）
- [x] DrizzleMemoryRepository 测试（23 tests）
- [x] WsBridge 测试（14 tests）
- [x] 全量验证通过（api 64 个测试）

### 4) TypeScript 配置

- [x] apps/api tsconfig 添加 composite + references
- [x] 根 tsconfig 添加 apps/api reference

## M2 基础 CRUD 已完成

### 1) 数据库基础设施

- [x] 接入 SQLite（`better-sqlite3`）
- [x] 接入 Drizzle ORM
- [x] 默认数据库路径：`data/tavern-headless.db`
- [x] 支持 `DATABASE_URL` 覆盖默认路径
- [x] 切换为 Drizzle migration 启动迁移（替代启动 DDL 建表）

对应文件：

- `apps/api/src/db/client.ts`
- `apps/api/src/db/schema.ts`
- `apps/api/src/db/migrate.ts`
- `apps/api/drizzle.config.ts`
- `apps/api/drizzle/0000_initial_schema.sql`

### 2) 核心数据表

- [x] `session`
- [x] `floor`
- [x] `message_page`
- [x] `message`
- [x] `variable`
- [x] `memory_item`
- [x] `memory_edge`

说明：已包含关键外键、唯一约束与状态枚举约束（SQLite CHECK / Drizzle enum）。

### 3) CRUD 路由

- [x] `sessions` CRUD
- [x] `floors` CRUD
- [x] `pages` CRUD
- [x] `messages` CRUD
- [x] `variables`（`PUT /variables` 为 upsert）
- [x] `memories` CRUD + `memory-edges` CRUD

对应文件：

- `apps/api/src/routes/index.ts`
- `apps/api/src/routes/sessions.ts`
- `apps/api/src/routes/floors.ts`
- `apps/api/src/routes/pages.ts`
- `apps/api/src/routes/messages.ts`
- `apps/api/src/routes/variables.ts`
- `apps/api/src/routes/memories.ts`

### 4) API 层通用能力

- [x] 统一错误结构：`{ error: { code, message, details? } }`
- [x] Zod 参数校验封装
- [x] SQLite 约束错误映射为 `409`
- [x] 进程信号优雅关闭（关闭 Fastify 与 DB 连接）
- [x] 抽离 `buildApp`，支持测试环境按需注入 DB 路径

对应文件：

- `apps/api/src/lib/http.ts`
- `apps/api/src/app.ts`
- `apps/api/src/index.ts`

### 5) 列表接口约定（P1）

- [x] 统一分页：`limit`（1-100）、`offset`
- [x] 统一排序：`sort_by` + `sort_order`（`asc` / `desc`）
- [x] 保留每个实体基础筛选字段并统一返回 `meta`

对应文件：

- `apps/api/src/lib/pagination.ts`
- `apps/api/src/routes/sessions.ts`
- `apps/api/src/routes/floors.ts`
- `apps/api/src/routes/pages.ts`
- `apps/api/src/routes/messages.ts`
- `apps/api/src/routes/variables.ts`
- `apps/api/src/routes/memories.ts`

### 6) API 集成测试（P0）

- [x] Fastify `inject` + SQLite `:memory:` 测试基座
- [x] 覆盖每个实体创建/查询/更新/删除主路径
- [x] 覆盖异常路径（参数错误、外键错误、唯一约束冲突）

对应文件：

- `apps/api/test/api.integration.test.ts`

### 7) 数据字典文档（P1）

### 2026-06-24（M22：LLM Instance Config API）

- 新增 `llm_instance_config` 数据库表及 migration `0013_llm_instance_config.sql`
- 新增 `LlmInstanceService`（CRUD + 多级优先级解析：session(slot) > session(*) > global(slot) > global(*) > default）
- 提取 `lib/llm-params.ts` 公共参数工具，消除 `llm-profile-service.ts` 中的重复代码
- 新增独立路由 `/llm-instances`（5 个端点），配套 OpenAPI JSON Schema、示例与 Zod 运行时验证
- 前端 API 客户端扩展 5 个函数
- 数据库文档、API 参考、VitePress 侧边栏同步更新
- API / Web typecheck 通过，全量测试 371 passed（含世界书 E2E）

- [x] 补充字段含义、枚举说明、索引说明
- [x] 补充列表接口分页/排序/过滤约定说明

对应文件：

- `docs/database.md`

### 8) 验证

- [x] `pnpm --filter @tavern/api typecheck` 通过
- [x] `pnpm --filter @tavern/api test` 通过

## 下一步（建议优先级）

- [x] 统一 OpenAPI/Swagger 输出
- [x] 增加请求日志字段（request id / latency / route tag）
- [x] 长会话性能优化（历史查询 + 索引 + 可选历史窗口）
- [x] 引入长期上下文策略（摘要注入 / 分层记忆）
- [x] 记忆冲突自动消解、衰减与维护任务
- [x] 同步 `apps/api/PROGRESS.md` 与 `README.md` 的阶段描述，并明确后端已进入 Beta、当前处于收口阶段
- [x] 为核心业务路由补充更完整的 OpenAPI schema（请求/响应示例）
- [x] 补齐 OpenAPI 中文文案（`accounts` / `users` / `llm-profiles`）
- [x] 明确 `MemoryMaintenanceService` 的 purge 语义（beta 接受 `updatedAt` 作为 deprecated 状态下最后变更时间）
- [x] 做最后一轮 beta 验证（`typecheck` / `test` / `openapi:export` / `smoke` / `memory:maintenance --dry-run`）
- [x] 同步 `apps/api/package.json` 与 OpenAPI `info.version` 到 `0.2.0-beta.1`
- [x] 冻结 `0.2.0-beta.2` 的 CRUD / batch 口径，并先落地 `PUT /variables/batch`
- [x] 明确记忆维护定时任务的多实例部署约束（当前规则：仅允许单实例开启，或拆分独立 job）
- [x] 记录公网部署时的限流 / 网关防护责任（当前仍不内建 rate limiting / metrics / tracing）
- [x] 完成 `memories` / `messages` 的首批 batch（显式 id + status/visibility/delete）
- [x] 同步 `apps/api/package.json` 与 OpenAPI `info.version` 到 `0.2.0-beta.2`
- [x] 做 `0.2.0-beta.2` 的最终全量验证记录（全量 `test` / `smoke` / `memory:maintenance --dry-run` / SDK 检查）
- [x] 真实 provider 最小回归已完成，结果良好

## 已知限制

- 当前 schema 不单独记录 `deprecatedAt`；beta 语义定义为按 deprecated 条目的 `updatedAt` 做 purge。如未来需要审计级弃用时间，需追加 schema migration。
- 记忆维护定时任务当前以 API 进程内定时器运行；多实例部署时只允许一个实例开启，或改由独立 job 负责。
- 当前后端未内建 rate limiting、`/metrics` 或 tracing / OTel；若直接对公网开放，需要由网关 / 部署层补足基础保护与观测。
- 当前 batch 仍保持“首批安全动作”范围：`PUT /variables/batch`、`PATCH /memories/batch/status`、`POST /memories/batch/delete`、`PATCH /messages/batch/visibility`、`POST /messages/batch/delete`；尚未扩展到 `pages` / `users` / `sessions` 等第二批资源。

## 更新日志

### 2026-07-12（聊天文件导入导出 + 全资源导出系统）

- 完成 ST JSONL 聊天文件导入：`POST /import/chat`，解析、分组、事务写入
- 完成 TavernHeadless 原生聊天格式（`.thchat`）设计与实现：10 个 Zod schema + 完整导入导出路径
- 完成 `GET /export/chat/:id`：支持 `thchat`（无损）和 `st_jsonl`（ST 兼容）两种格式
- 完成 4 个新增导出路由：
  - `GET /export/preset/:id` — ST 原始 JSON
  - `GET /export/worldbook/:id` — ST 格式 JSON（entries 对象形式 + V2 extensions）
  - `GET /export/regex/:id` — ST 格式 JSON 数组（补回 markdownOnly/promptOnly/runOnEdit）
  - `GET /export/character/:id` — ST Character Card V2 JSON（支持 `?version_id=`）
- 新增 serializer 函数：`snapshotToStCharacterCard()`、`scriptsToStRegexArray()`
- 新增 58 个测试（chat-parser 25 + chat-file 14 + chat-export 11 + serializers 8）
- 全量 adapters 142 + shared 32 + api 613 = 787，零回归
- 文档更新：新增 `vitepress/reference/api/exports.md`，更新 imports.md、架构文档、侧边栏

### 2026-06-26（Tool Calling 系统）

- 新增 `tool_call_record` 和 `tool_definition` 数据库表及迁移 `0014_tool_calling.sql`
- 新增 `DrizzleToolRepository`、`ToolService`、`tools.ts` 路由（11 个端点）
- `ChatService` 集成工具权限解析、工具注入和调用记录持久化
- 新增 11 个集成测试，全量 32 文件 413 tests 通过
- 零回归

### 2026-06-25（Beta 准入完成：真实 provider 回归 + 世界书测试修复 + 进度文档同步）

- 真实 provider 最小回归已执行完毕，全部端点运行良好，Beta 准入标准 14/14 全部达成
- 世界书 E2E 测试已全部通过（此前报告的 2 个失败已修复），全量测试 371 passed
- 更新 Beta 准入标准：勾选最后一项“真实 provider 最小回归”
- 更新当前里程碑状态为“收口完成，可进入正式 sign-off”
- 更新“下一步”清单：全部完成
- 移除“已知限制”中过时的“建议补一轮真实 provider 回归”描述
- 同步 `vitepress/progress/api.md`、`vitepress/progress/index.md`、根 `PROGRESS.md`

### 2026-03-16（beta.2 版本同步与最终全量验证）

- 同步 `apps/api/package.json` 与 `apps/api/src/plugins/openapi.ts` 的 OpenAPI `info.version` 到 `0.2.0-beta.2`
- 重新生成 `apps/api/openapi/openapi.json`、`packages/shared/src/generated/openapi.json`、`packages/shared/src/generated/openapi-types.ts`
- 全量通过 `pnpm --filter @tavern/api typecheck`
- 全量通过 `pnpm --filter @tavern/api test`（`25` files，`231` tests）
- 通过 `pnpm --filter @tavern/api openapi:export`、`pnpm openapi:export`、`pnpm sdk:generate`、`pnpm sdk:check`
- 通过 `pnpm --filter @tavern/api smoke`，验证环境为 `PORT=3112`、`DATABASE_URL=.tmp/apps-api-beta2-smoke-3112.sqlite`、`AUTH_MODE=off`、`ACCOUNT_MODE=single`、`API_BASE_URL=http://127.0.0.1:3112`
- 通过 `pnpm --filter @tavern/api memory:maintenance -- --db :memory: --dry-run`
- 当前 beta 收口剩余项收敛为真实 provider 的最小回归

### 2026-03-16（beta.2 第二批执行：memories / messages batch）

- 新增 `PATCH /memories/batch/status`：按显式 id 批量切换记忆状态，逐项返回 `updated|not_found`，并保持 `updated_at` 刷新语义与现有 purge 口径一致
- 新增 `POST /memories/batch/delete`：按显式 id 批量删除记忆条目，避免在 beta 引入基于筛选条件的破坏性批量删除
- 新增 `PATCH /messages/batch/visibility`：按显式 id 批量更新 `is_hidden`，不触碰消息排序与分页约束
- 新增 `POST /messages/batch/delete`：按显式 id 批量删除消息，保持消息 batch 仍为低风险维护动作
- 为 `memories` / `messages` 的 batch 路由补充 OpenAPI schema 与示例，并补齐中文文案
- 扩展 `test/api.integration.test.ts` 与 `test/openapi.integration.test.ts`，覆盖主路径、重复 id 校验、OpenAPI schema 与示例可见性
- 通过增量验证：`pnpm --filter @tavern/api typecheck`、`pnpm --filter @tavern/api test -- test/api.integration.test.ts test/openapi.integration.test.ts`、`pnpm --filter @tavern/api openapi:export`、`pnpm openapi:export`、`pnpm sdk:generate`、`pnpm sdk:check`

### 2026-03-16（beta.2 第一批执行：部署约束与 variables batch）

- 冻结 beta.2 的 CRUD / batch 口径，明确 import create、版本化 `characters`、`accounts` / `branches` 的 batch 排除，以及 `variables` / `memories` / `messages` 的首批优先级
- 在 `apps/api/src/app.ts` 注释、`README.md`、`apps/api/PROGRESS.md` 写明记忆维护定时任务的多实例部署规则：当前仅允许单实例启用，或拆分独立 job
- 补记公网部署责任：当前 beta 不内建 `@fastify/rate-limit`、`/metrics` 或 tracing / OTel，若公网暴露需由部署层承担基础保护
- 新增 `PUT /variables/batch`，按 `(scope, scope_id, key)` 批量 upsert，并返回逐项 `created|updated` 结果与汇总 `meta`
- 为 `variables` 单条 / 批量路由补充 OpenAPI 示例，并补齐中文文案 `Batch upsert variables`
- 扩展 `test/api.integration.test.ts` 与 `test/openapi.integration.test.ts`，覆盖 `variables` 批量 upsert 主路径、重复目标校验、OpenAPI schema 与示例
- 通过增量验证：`pnpm --filter @tavern/api typecheck`、`pnpm --filter @tavern/api test -- test/api.integration.test.ts test/openapi.integration.test.ts`、`pnpm --filter @tavern/api openapi:export`、`pnpm openapi:export`、`pnpm sdk:generate`、`pnpm sdk:check`

### 2026-03-16（状态对齐：后端进入 Beta 阶段）

- 同步 `当前里程碑` 为“后端 Beta 阶段”，明确当前已进入 Beta，后续以文档、验证与发布收尾为主
- 补记当前后端判断：核心能力已覆盖到 M21，当前重点不再是主功能补洞
- 补记已落地但旧标题未体现的能力：`/accounts`、CORS、OpenAPI 中英文化、`/docs-zh`、`/docs-en`
- 补齐 `accounts`、`users`、`llm-profiles` 的中文 OpenAPI 文案，并通过 `test/openapi.integration.test.ts`
- 补齐 `sessions`、`chat`、`accounts`、`users`、`llm-profiles`、`imports` 的 OpenAPI 请求/响应示例，并扩展 `test/openapi.integration.test.ts` 断言覆盖
- 明确 `MemoryMaintenanceService` 的 beta purge 语义：不引入 `deprecatedAt`，以 deprecated 条目的 `updatedAt` 作为最后变更时间，并扩展 `test/memory-maintenance.test.ts` 固化该约定
- 新增“后端 Beta 准入标准（草案）”，作为后续收口判断基线
- 更新“下一步”与“已知限制”，移除过期的记忆系统未完成描述
- 完成 beta 收口复核：`typecheck`、`test`、`openapi:export`、`smoke`、`memory:maintenance -- --db :memory: --dry-run` 均已通过
- 同步 `apps/api/package.json` 与 OpenAPI `info.version` 到 `0.2.0-beta.1`，明确后端采用 beta 预发布版本姿态
- 补充“真实 provider 最小回归清单（待执行）”，后续只需按清单执行并记录结果，无需重新做大范围审计
- 统一 `README.md` 与 `apps/api/PROGRESS.md` 的阶段口径：项目整体仍为 Alpha，`apps/api` 已进入 Beta，当前处于收口阶段

### 2026-02-14（M8：核心 RP 体验接口）

- 新增 `GET /sessions/:id/timeline`：时间线查询（楼层 + 活跃页 + 消息，JOIN 避免 N+1）
- 新增 `POST /floors/:id/branch`：分支创建（自动/自定义 branch_id，状态 + 唯一性校验）
- 新增 `PATCH /pages/:id/activate`：消息页激活（swipe 功能，同楼层原子切换）
- 新增 `test/m8-core-rp.test.ts`（17 个测试用例）
- 全量 146 个测试通过（13 个测试文件）
- 完善 `docs/architecture.md` 第 9 节中规划的三个核心 RP 接口

### 2026-02-13（M7 Phase 4A：摘要注入）

- PromptAssembler 支持 `memorySummary` 参数，注入到 system prompt 之后
- ChatService 接入 MemoryStore，实现检索与持久化闭环
- 新增 `ENABLE_MEMORY` 环境变量，默认关闭
- 新增 `test/memory-injection.test.ts`（7 个测试用例）

### 2026-02-12（M6 Phase 3：长会话性能优化）

- `ChatService.loadHistory*` 重构为聚合查询，消除长会话 N+1
- 新增可选 `CHAT_HISTORY_MAX_FLOORS`，默认关闭，不影响既有预设
- 新增数据库索引 migration：`0002_history_performance_indexes.sql`
- 新增 `scripts/benchmark-history.ts`（支持自定义 floors/rounds/history cap/message size）
- 新增 `chat-flow.test.ts` 历史窗口测试

### 2026-02-12（M6 Phase 2：请求日志字段）

- 新增 `apps/api/src/plugins/request-logging.ts`，统一请求日志增强
- 请求完成日志增加字段：`request_id`、`latency_ms`、`route_tag`
- 增加 route_tag 归类规则（system/docs/chat/imports/CRUD 首段）
- `buildApp` 接入 request logging 插件
- 新增 `test/request-logging.integration.test.ts`（4 tests）
- `pnpm --filter @tavern/api test` 全量通过（121 tests）

### 2026-02-12（M6 Phase 1：OpenAPI/Swagger）

- 新增 OpenAPI/Swagger 基础设施（`@fastify/swagger` + `@fastify/swagger-ui`）
- 新增 `apps/api/src/plugins/openapi.ts`，统一注册 API 文档能力
- 增加 `GET /openapi.json` 与 `GET /docs/` 文档入口
- `/health` 补充 schema，作为文档示例端点
- 新增 `test/openapi.integration.test.ts`（2 tests）
- `pnpm --filter @tavern/api test` 全量通过（117 tests）

### 2026-02-12（M5 运行期修复）

- 完成 M5 运行期收尾修复（真实服务启动 + 在线调用验证）
- 修复 dotenv 加载路径问题，`pnpm --filter @tavern/api dev` 可读取根 `.env`
- 修复 Provider 动态加载（ESM + createRequire），并补齐 `@ai-sdk/openai` 依赖
- 修复 usage 空值导致的 `floor.token_in` NOT NULL 约束错误
- usage 处理链路统一归一化（core + api），避免 `null/NaN` 写库
- 手工验证通过：`respond`、多轮、`regenerate` 全链路正常

### 2026-02-12

- 完成 M5：MVP 端到端打通
- 新增 config.ts（环境变量 → OrchestrationConfig）+ dotenv 集成
- 新建 PromptAssembler 服务：打通预设/世界书/正则 → assembleCompat → ChatService 链路
- Session 创建时支持 Greeting 自动插入
- 9 个新 E2E 测试，API 总计 115 个测试通过
- 端到端链路就绪：配置 .env → 启动 → 发消息 → 真实 LLM 回复

### 2026-02-11

- 完成 M4 Phase 2：Regenerate / WebSocket / Imports
- 新增 POST /sessions/:id/regenerate 路由与 ChatService.regenerate 方法
- buildApp 集成 WebSocket 推送（EventBus → WsBridge）
- 新增导入路由（SillyTavern 预设/世界书/正则）及对应数据库表
- 32 个新测试（总计 106 个测试通过）

### 2026-02-11

- 完成 M4 Phase 1：核心聊天接口
- 新增 OrchestrationFactory + ChatService + POST /sessions/:id/respond
- 更新 buildApp：可选 orchestration 集成，返回 BuildAppResult
- 10 个新测试，API 总计 74 个测试通过

### 2026-02-10

- 完成 M3：DB Adapters + WebSocket 实时推送
- 新增 3 个 Drizzle Adapter（实现 @tavern/core Port 接口）
- 新增 WsBridge + registerWsPlugin（EventBus → WebSocket 桥接）
- 57 个新测试（43 adapter + 14 ws），API 总计 64 个测试通过

### 2026-02-09

- 完成 Drizzle migration 接入与初始迁移文件落地。
- 完成列表接口统一分页/排序/基础筛选协议。
- 完成 API 集成测试（主路径 + 常见异常路径）。
- 新增数据库数据字典文档。
- 通过 API typecheck 与集成测试验证。

---

维护约定：每次合并 `apps/api` 相关功能后，更新“当前里程碑 / 已完成 / 下一步 / 更新日志”。
