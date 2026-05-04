# Core Engine Progress

> 目的：记录 `packages/core` 及 `packages/adapters-sillytavern` 核心引擎开发进度。

## 当前里程碑

- 里程碑：`v0.2 — 正式发布准备与后续迭代`
- 状态：`核心链路完整，转入正式发布与文档完善、Agentic 探索`
- 最后更新：`2026-07-02`

## Tool Calling 系统（已完成 Phase 1-5）

### 概述

为所有 LLM 实例（Narrator / Director / Verifier / Memory）实现了工具调用能力。支持内置工具和自定义工具，兼容 Vercel AI SDK 的 `tools` / `maxSteps` 多步执行。

### 已完成清单

- [x] Phase 1：核心类型和基础设施（`ToolRegistry`、`ToolExecutor`、4 个事件类型，33 个测试）
- [x] Phase 2：LLM 层改造（`LLMRequest.tools`/`maxSteps`、`LLMResponse.toolCalls`/`steps`，3 个测试）
- [x] Phase 3：内置工具提供者（`BuiltinToolProvider`，7 个工具，22 个测试）
- [x]集成（`TurnOrchestrator` 工具接线、DB 迁移、`ChatService` 工具持久化，11 个测试）
- [x] Phase 5：API 路由（`ToolService`、11 个端点、`PresetToolProvider`，11 个集成测试）

### 新增文件清单

```text
packages/core/src/tools/
├── types.ts                          # 核心类型定义
├── tool-registry.ts                  # 工具注册表
├── tool-executor.ts                  # 工具执行器
├── builtin-provider.ts               # 内置 7 个工具
├── preset-provider.ts                # 预设/自定义工具提供者
├── index.ts                          # barrel export
└── __tests__/
    ├── tool-registry.test.ts          # 16 tests
    ├── tool-executor.test.ts          # 17 tests
    └── builtin-provider.test.ts       # 22 tests

apps/api/
├── drizzle/0014_tool_calling.sql      # DB 迁移
├── src/adapters/drizzle-tool-repository.ts  # 工具数据库操作
├── src/services/tool-service.ts       # 工具管理业务层
├── src/routes/tools.ts                # 11 个 API 端点
└── test/tools.integration.test.ts     # 11 个集成测试
```

### 修改文件

- `packages/core/src/events/event-types.ts` — +4 工具事件
- `packages/core/src/llm/types.ts` — +tools/maxSteps/toolCalls/steps
- `packages/core/src/llm/llm-service.ts` — 工具参数透传
- `packages/core/src/generation/types.ts` — +tools/maxSteps/toolCalls
- `packages/core/src/generation/generation-pipeline.ts` — 工具参数透传
- `packages/core/src/orchestration/types.ts` — +ToolMode/enableTools/toolPermissions
- `packages/core/src/orchestration/turn-orchestrator.ts` — 工具初始化和调用收集
- `apps/api/src/db/schema.ts` — +tool_call_record/tool_definition 表
- `apps/api/src/services/chat-service.ts` — 工具权限解析和调用持久化
- `apps/api/src/routes/index.ts` — 注册工具路由

## M12 Phase 4 进行中（Core 增量）：Native Pipeline 错误定位与执行轨迹

### Phase 4b/4c 已完成：LLM Instance Slot + Profile Binding

- [x] 数据库 migration `0006_instance_slot.sql`：`llm_profile_binding` 增加 `instance_slot` 列
- [x] Core 新增 `InstanceSlot` 类型，`TurnInput.modelOverrides` 支持按 slot 覆盖
- [x] `TurnOrchestrator` 各 `run*` 方法通过 `resolveSlotModel()` 分发 per-slot 模型
- [x] `Director` / `Verifier` / `MemoryConsolidator` 新增可选 `model` 参数
- [x] `LlmProfileService` 支持 slot 激活 + 批量解析 `resolveActiveProfiles()`
- [x] 路由 + `ChatService` + `app.ts` 全链路接线
- [x] 架构文档补充「LLM 实例与 Profile 的关系」小节

#### 修改文件

- `apps/api/drizzle/0006_instance_slot.sql` / `schema.ts` / `_journal.json`
- `apps/api/src/services/llm-profile-service.ts` / `chat-service.ts`
- `apps/api/src/routes/llm-profiles.ts` / `app.ts`
- `packages/core/src/llm/types.ts` / `index.ts`
- `packages/core/src/orchestration/*` / `packages/core/src/memory/memory-consolidator.ts`
- `docs/architecture.md`

### 已完成清单

- [x] 新增 `NativePipelineError`，节点异常统一携带 `nodeName`
- [x] 异常上下文补充 `inputSummary/stateSummary`，便于快速定位输入规模与执行阶段
- [x] 为 pipeline 状态新增 `artifacts.executedNodes` 轨迹，支持节点级执行追踪
- [x] 增加无效节点状态保护（node 返回非法 state 时直接抛出 `NativePipelineError`）
- [x] 补充 native pipeline 单测（执行轨迹、错误包装、非法状态）
- [x] 新增 `ConditionNode`（`condition`）节点：支持 `when` 分支 + `thenNodes/elseNodes` 嵌套执行
- [x] 新增 `TransformNode`（`transform`）节点：支持按 role/section 过滤的正则替换，变更后重算 `tokenCount`
- [x] Barrel exports 更新：导出 `ConditionNode`/`TransformNode` 及 `ConditionNodeOptions`/`TransformNodeOptions`/`TransformRule`
- [x] 补充 native pipeline 单测（condition/transform 分支、role 过滤、output 同步）

### 文件清单

- `packages/core/src/prompt/native-pipeline.ts`
- `packages/core/src/prompt/__tests__/native-pipeline.test.ts`
- `packages/core/src/prompt/index.ts`
- `packages/core/src/index.ts`
- `docs/architecture.md`

## M10 Phase 2 已完成（Adapters 支撑）：角色卡解析与导出

### 已完成清单

- [x] 新增角色卡类型 `STCharacterCard`
- [x] 新增 `parseCharacterCard()`，支持 TavernCard v2 envelope 与 legacy 扁平格式
- [x] 输出字段统一映射：`first_mes -> firstMes`、`mes_example -> mesExample`
- [x] 增加字段清洗与长度限制，非法输入走 Zod 错误
- [x] adapters 包新增 character parser/type 导出
- [x] 新增 `character-parser` 单测（4 tests）
- [x] 角色卡 parser 升级为 `legacy / v2 / v3` 分发结构
- [x] 新增 `ImportedCharacterCard` / `CharacterProfile` 分层类型
- [x] 支持 richer V2 / 最小 V3 字段保留：`alternate_greetings`、`system_prompt`、`post_history_instructions`、`creator_notes`、`tags`、`creator`、`character_version`、`extensions`
- [x] `snapshotToStCharacterCard()` 改为优先导出真实扩展字段
- [x] 新增多 greeting 与 richer 字段回归测试（parser / serializer）
- [x] 建会话与角色导入建会话已支持 floor 0 多 greeting page（首楼 swipes）
- [x] 角色快照的 `alternateGreetings` 已接入初始 output page 生成与激活切换链路
- [x] 新增 Character Card V3 导出结构与 `GET /export/character/:id?format=v3`
- [x] `characterBook` 已接入 prompt worldbook 主链，并支持与会话 worldbook 叠加触发

### 文件清单

- `packages/adapters-sillytavern/src/types/character.ts`
- `packages/adapters-sillytavern/src/parsers/character-parser.ts`
- `packages/adapters-sillytavern/src/__tests__/character-parser.test.ts`
- `packages/adapters-sillytavern/src/index.ts`

## M9 Phase 1 已完成（Core 支撑）：SSE 中止信号透传

### 已完成清单

- [x] `TurnInput` 新增 `abortSignal` 字段，支持上层透传客户端断连中止
- [x] `TurnOrchestrator.runGeneration` 向 `GenerationPipeline` 传递 `abortSignal`
- [x] 保持既有编排行为与测试稳定，无兼容性回归

### 文件清单

- `packages/core/src/orchestration/types.ts`
- `packages/core/src/orchestration/turn-orchestrator.ts`

## M5 已完成：MVP 端到端打通（运行期修复）

### 已完成清单

- [x] Provider 可选依赖加载修复：ESM 环境改用 `createRequire`
- [x] 增加 `@ai-sdk/openai` 依赖，`openai-compatible` 提供商可稳定初始化
- [x] LLM usage 归一化：兼容 `promptTokens/completionTokens` 与 `inputTokens/outputTokens`
- [x] TurnOrchestrator token usage 安全累加，避免 `null/NaN` 传播
- [x] API 侧写库前 usage 兜底，修复 `floor.token_in` NOT NULL 约束错误
- [x] 真实服务手工验证：`respond` / 多轮对话 / `regenerate` 全链路可用

## M4 Phase 2 已完成：Regenerate / WebSocket / Imports

### 已完成清单

- [x] **Regenerate**：ChatService.regenerate 方法、路由及 8 个集成测试
- [x] **WebSocket**：buildApp 集成 WsBridge、EventBus 连接及 5 个集成测试
- [x] **Imports**：预设/世界书/正则导入路由、数据库表扩展及 19 个集成测试
- [x] TypeScript references 修复（apps/api → adapters-sillytavern）

## M4 Phase 1 已完成：核心聊天接口

### 已完成清单

- [x] OrchestrationFactory（Composition Root：组装 EventBus + ProviderRegistry + LLMService + Pipeline + Orchestrator）
- [x] ChatService（会话验证、历史加载、楼层创建、用户消息入库、TurnInput 构建、助手回复保存）
- [x] POST /sessions/:id/respond 路由（Zod 验证、snake_case ↔ camelCase 映射、错误处理）
- [x] buildApp 更新（可选 orchestration 配置、返回 BuildAppResult）
- [x] 10 个新测试全部通过

### 文件清单

```text
apps/api/src/
├── services/
│   ├── orchestration-factory.ts      # Composition Root
│   └── chat-service.ts               # 聊天业务逻辑
├── routes/
│   └── chat.ts                       # POST /sessions/:id/respond
├── app.ts                            # 更新：可选 orchestration 集成
└── index.ts                          # 更新：解构 BuildAppResult

apps/api/test/
└── chat-flow.test.ts                 # 10 tests
```

## M3 已完成（全部 3 个 Phase）

### M3 Phase 3 已完成：WebSocket 实时推送

### 已完成清单

- [x] 安装 @fastify/websocket 依赖
- [x] WsBridge 桥接器（EventBus → WebSocket 转发、sessionId 过滤、客户端管理）
- [x] registerWsPlugin（Fastify 插件注册、GET /ws 路由、onClose 自动停止）
- [x] 推送协议（`{ type, event, data, timestamp }` JSON 格式）
- [x] 14 个单元测试全部通过

### 文件清单

```text
apps/api/src/ws/
├── index.ts                          # Fastify WS 插件注册
├── ws-bridge.ts                      # EventBus → WebSocket 桥接
└── __tests__/
    └── ws-bridge.test.ts             # 14 tests
```

## M3 Phase 2 已完成：TurnOrchestrator 完整回合编排器

### 已完成清单

- [x] 编排器类型定义（TurnConfig、TurnInput、TurnOutput、VerifierFailStrategy）
- [x] TurnOrchestrator 实现（串联 Director → Memory → Narrator → Verifier → Consolidation）
- [x] Verifier 三种策略（warn / block / retry）含重试逻辑
- [x] 事件发射集成（generation.started/chunk/completed/failed、floor.failed）
- [x] 错误处理：任何步骤失败自动标记楼层为 failed
- [x] TurnError 错误类（含 phase 信息）
- [x] Barrel exports 更新（orchestration/index.ts + core/index.ts）
- [x] 20 个单元测试全部通过

### 文件清单

```text
packages/core/src/orchestration/
├── types.ts                          # TurnConfig, TurnInput, TurnOutput
├── turn-orchestrator.ts              # TurnOrchestrator, TurnError
├── index.ts                          # 更新 barrel
└── __tests__/
    └── turn-orchestrator.test.ts     # 20 tests
```

## M3 Phase 1 已完成：DB Adapters（Port 接口实现）

### 已完成清单

- [x] DrizzleFloorRepository（findById、updateState）8 个测试
- [x] DrizzleVariableRepository（findByKey、findAllByScope、upsert、deleteById、deleteByKey）12 个测试
- [x] DrizzleMemoryRepository（findById、findMany、create、update、deprecate、createEdge、findEdges）23 个测试
- [x] Adapter barrel export
- [x] TypeScript project references 更新（apps/api tsconfig + 根 tsconfig）
- [x] 全量验证通过（core 232 + adapters 104 + api 50 = 386 个测试）

### 文件清单

```text
apps/api/src/adapters/
├── index.ts                          # barrel export
├── drizzle-floor-repository.ts       # FloorRepository 实现
├── drizzle-variable-repository.ts    # VariableRepository 实现
├── drizzle-memory-repository.ts      # MemoryRepository 实现
└── __tests__/
    ├── drizzle-floor-repository.test.ts   # 8 tests
    ├── drizzle-variable-repository.test.ts # 12 tests
    └── drizzle-memory-repository.test.ts  # 23 tests
```

## M2 Phase 5 已完成：记忆系统 + compat_plus + Director/Verifier

### 已完成清单

- [x] 共享类型扩展（MemoryScope, MemoryType, MemoryStatus, MemoryRelation 4 组常量 + 类型）
- [x] 事件系统扩展（memory.created/updated/deprecated/consolidated 4 个新事件）
- [x] 记忆领域类型（MemoryItem, MemoryEdge, MemoryQuery, MemoryConsolidationOutput, MemoryInjectionOptions/Result）
- [x] MemoryRepository Port 接口（CRUD + 边操作）
- [x] MemoryStore（摘要入库 ingestSummaries、预算注入 prepareInjection、整理应用 applyConsolidation）22 个测试
- [x] MemoryConsolidator（Memory LLM 实例整理、JSON 解析 + 优雅降级、snake_case 兼容）9 个测试
- [x] compat_plus 编排器 assembleCompatPlus（复用 assembleCompat + memory section 注入、三种位置）12 个测试
- [x] Director 实例（叙事指令生成、JSON 解析 + 优雅降级）8 个测试
- [x] Verifier 实例（一致性检查、JSON 解析 + 优雅降级）8 个测试
- [x] Barrel exports 更新、TypeScript typecheck 通过
- [x] 全量验证通过（core 212 + adapters 104 = 316 个测试）

### 文件清单

```text
packages/shared/src/types/
├── memory.ts                          # 记忆共享类型常量
├── events.ts                          # +4 memory 事件常量
└── index.ts                           # 更新 barrel

packages/core/src/
├── memory/
│   ├── index.ts                       # barrel
│   ├── types.ts                       # 记忆领域类型
│   ├── memory-store.ts                # 记忆存储 + 查询 + 注入
│   ├── memory-consolidator.ts         # Memory LLM 实例整理
│   └── __tests__/
│       ├── memory-store.test.ts        # 22 tests
│       └── memory-consolidator.test.ts # 9 tests
├── orchestration/
│   ├── index.ts                       # barrel
│   ├── director.ts                    # Director 实例
│   ├── verifier.ts                    # Verifier 实例
│   └── __tests__/
│       ├── director.test.ts           # 8 tests
│       └── verifier.test.ts           # 8 tests
├── ports/
│   ├── memory-repository.ts           # MemoryRepository 接口
│   └── index.ts                       # 更新 barrel
├── events/
│   ├── event-types.ts                 # +4 memory 事件类型
│   └── index.ts                       # 更新 barrel
└── index.ts                           # 更新 barrel

packages/adapters-sillytavern/src/
├── compat-plus-assembler.ts           # compat_plus 编排器
├── index.ts                           # 更新 barrel
└── __tests__/
    └── compat-plus-assembler.test.ts  # 12 tests
```

## M2 Phase 4 已完成：LLM 接入层 + Generation Pipeline

### 已完成清单

- [x] LLM 类型定义（ProviderConfig, ModelConfig, GenerationParams, LLMPort, LLMInstance 等）
- [x] Provider Registry（多 Provider 管理、自定义工厂、内置 OpenAI/Anthropic/Google 工厂）12 个测试
- [x] LLM Service（Vercel AI SDK 封装 generateText/streamText、超时/中止/错误处理）6 个测试
- [x] 摘要提取器 extractSummaries（多标签名、大小写不敏感、多行、keepInText）19 个测试
- [x] Generation Pipeline（前处理→LLM 调用→摘要提取→后处理、流式/非流式）14 个测试
- [x] 事件类型扩展（generation.started/chunk/completed/failed 4 个新事件）
- [x] Barrel exports 更新、TypeScript typecheck 通过
- [x] 全量验证通过（core 165 + adapters 92 = 257 个测试）

### 文件清单

```text
packages/core/src/
├── llm/
│   ├── index.ts                    # barrel export
│   ├── types.ts                    # LLM 类型定义
│   ├── provider-registry.ts        # Provider 注册表
│   ├── llm-service.ts              # LLM 调用服务
│   └── __tests__/
│       ├── provider-registry.test.ts  # 12 tests
│       └── llm-service.test.ts        # 6 tests
├── generation/
│   ├── index.ts                    # barrel export
│   ├── types.ts                    # Generation 类型
│   ├── generation-pipeline.ts      # 生成流水线
│   ├── summary-extractor.ts        # 摘要提取器
│   └── __tests__/
│       ├── generation-pipeline.test.ts  # 14 tests
│       └── summary-extractor.test.ts    # 19 tests
├── events/
│   └── event-types.ts              # +4 generation 事件类型
```

## M2 Phase 3 已完成：SillyTavern 适配层 + compat_strict 编排

### 已完成清单

- [x] 精简类型定义（STPreset ~20 字段、STWorldBookEntry ~15 字段、STRegexScript ~10 字段）
- [x] Zod 解析器：preset-parser、worldbook-parser、regex-parser（22 个测试）
- [x] 世界书触发引擎 triggerWorldBook（关键词/正则/selective 四种逻辑/scanDepth/constant，30 个测试）
- [x] 正则脚本引擎 applyRegexScripts（查找替换/捕获组/trimStrings/placement/substituteRegex，16 个测试）
- [x] compat_strict 编排器 assembleCompat（STPreset + WorldBook → PromptIR，24 个测试）
- [x] Barrel exports 更新、TypeScript project references 配置
- [x] 全量验证通过（core 114 + adapters 92 = 206 个测试）

### 文件清单

```text
packages/adapters-sillytavern/src/
├── index.ts                          # barrel export
├── compat-assembler.ts               # compat_strict 编排器
├── types/
│   ├── preset.ts                     # STPreset 精简类型
│   ├── worldbook.ts                  # STWorldBookEntry 精简类型
│   └── regex.ts                      # STRegexScript 精简类型
├── parsers/
│   ├── preset-parser.ts              # Zod schema + 解析函数
│   ├── worldbook-parser.ts           # Zod schema + 解析函数
│   └── regex-parser.ts               # Zod schema + 解析函数
├── worldbook/
│   └── trigger-engine.ts             # 世界书关键词触发引擎
├── regex/
│   └── regex-engine.ts               # 正则脚本执行引擎
└── __tests__/
    ├── preset-parser.test.ts          # 7 tests
    ├── worldbook-parser.test.ts       # 8 tests
    ├── regex-parser.test.ts           # 7 tests
    ├── trigger-engine.test.ts         # 30 tests
    ├── regex-engine.test.ts           # 16 tests
    └── compat-assembler.test.ts       # 24 tests
```

## M2 Phase 2 已完成：提示词基础设施

### 已完成清单

- [x] Prompt IR 类型定义（ChatRole, IRMessage, IRSection, PromptIR, PromptMetadata, TokenCounter, ChatMessage, AssembledPrompt）
- [x] 模板引擎 TemplateEngine（{{var}} 插值 + 默认值 + 空格容错 + VariableResolver 集成，26 个测试）
- [x] Token 预算管理器 TokenBudget + SimpleTokenCounter（估算 + 优先级裁剪，13 个测试）
- [x] 消息拼装器 MessageBuilder（IR → messages[] + 合并 + 统计，10 个测试）
- [x] 全量验证通过（114 个 core 测试 + 7 个 API 集成测试）

### 文件清单

```text
packages/core/src/prompt/
├── index.ts
├── types.ts                    # Prompt IR 类型
├── template-engine.ts          # 模板渲染
├── token-budget.ts             # Token 预算
├── message-builder.ts          # 消息拼装
└── __tests__/
    ├── template-engine.test.ts
    ├── token-budget.test.ts
    └── message-builder.test.ts
```

## M2 Phase 1 已完成：楼层状态机 & 变量系统

### 已完成清单

- [x] 公共类型扩展（@tavern/shared）：FloorState, VariableEntry, CoreEvents
- [x] TypeScript 项目引用配置（composite + references）
- [x] 6 个领域错误类
- [x] FloorEntity / VariableContext 领域类型
- [x] 强类型 CoreEventBus（基于 emittery，6 种事件）
- [x] Port 接口：FloorRepository, VariableRepository
- [x] FloorStateMachine（状态转移验证 + 事件广播，21 个测试）
- [x] VariableResolver（四级级联读取，12 个测试）
- [x] VariableStore（写入沙箱 + 显式提升，23 个测试）
- [x] FloorLifecycle（整合状态机 + 变量提升，9 个测试）

### 文件清单

```text
packages/core/src/
├── index.ts, types.ts, errors.ts
├── events/     event-bus.ts, event-types.ts, index.ts
├── ports/      floor-repository.ts, variable-repository.ts, index.ts
├── floor/      floor-state-machine.ts, floor-lifecycle.ts, index.ts
│   └── __tests__/  floor-state-machine.test.ts, floor-lifecycle.test.ts
└── variables/  variable-resolver.ts, variable-store.ts, index.ts
    └── __tests__/  variable-resolver.test.ts, variable-store.test.ts
```

## 下一步（建议）

- API 文档化：使用 Swagger/OpenAPI 生成文档。
- 高级查询：为列表接口添加更丰富的筛选和搜索。
- 前端对接：开始构建 Web 前端来消费这些 API。

## 测试统计

| 阶段 | 新增测试 | 累计测试 |
| ---- | -------- | -------- |
| M2 Phase 1 | 65 | 65 |
| M2 Phase 2 | 49 | 114 |
| M2 Phase 3 | 92 | 206 |
| M2 Phase 4 | 51 | 257 |
| M2 Phase 5 | 59 | 316 |
| M3 Phase 1 (DB Adapters) | 43 | 359 |
| M3 Phase 2 (TurnOrchestrator) | 20 | 379 |
| M3 Phase 3 (WebSocket) | 14 | 400* |
| M4 Phase 1 (Chat Endpoint) | 10 | 410* |
| M4 Phase 2 (Regenerate/Imports) | 32 | 442* |
| Tool Calling Phase 1-5 | 80 | 522* |
| MCP 集成 | 32 | 554* |
| ResourceToolProvider (batch 2) | 42 | 596* |
| ResourceToolProvider (batch 3) | 38 | 634* |
| Chat Import/Export + Resource Export | 53 | 687* |

*全量：core 315 + adapters 142 + shared 32 + api 613 = 1102

## 更新日志

### 2026-07-12

- 完成聊天文件导入导出系统（跨多轮对话实现）
  - 新增 ST JSONL 聊天解析器 `parseChatFile()`、`groupMessagesIntoFloors()`（adapters-sillytavern）
  - 新增 `POST /import/chat` 路由，支持 ST JSONL 格式聊天文件导入
  - 新增 TavernHeadless 原生聊天格式类型定义（`packages/shared/src/types/chat-file.ts`），含 10 个 Zod schema
  - 新增 `GET /export/chat/:id` 路由，支持 `.thchat` 原生格式和 `.jsonl` ST 兼容格式导出
  - 新增 `serializeSessionToThChat()` 和 `serializeSessionToStJsonl()` 序列化函数
  - 导入端支持格式自动检测：`JSON.parse` 成功且 `spec === "tavern_headless_chat"` → 原生路径，否则 → ST JSONL
  - 原生格式导入支持完整四层树（session → floors → pages → messages）+ 变量 + 记忆（items + edges）
  - 通过 `_original_id` 机制在导入时重建内部引用关系
- 完成全资源导出路由系统
  - 新增 `GET /export/preset/:id`（直接输出 ST 原始 JSON）
  - 新增 `GET /export/worldbook/:id`（重组 entries 为对象形式 + V2 extensions）
  - 新增 `GET /export/regex/:id`（补回 `markdownOnly`/`promptOnly`/`runOnEdit` 三个字段）
  - 新增 `GET /export/character/:id`（构造 ST Character Card V2 JSON，支持 `?version_id=` 指定版本）
  - 新增 `snapshotToStCharacterCard()` 和 `scriptsToStRegexArray()` 序列化函数（adapters-sillytavern）
- 新增测试：
  - `chat-parser.test.ts`：25 个测试（adapters-sillytavern）
  - `chat-file.test.ts`：14 个测试（shared）
  - `chat-export.test.ts`：11 个测试（api）
  - `serializers.test.ts`：8 个测试（adapters-sillytavern）
- 全量测试 adapters 142 + shared 32 + api 613 = 787（含 core 315 = 1102），零回归
- 文档更新：
  - 新增 `vitepress/reference/api/exports.md`（5 个导出路由 API 文档）
  - 更新 `vitepress/reference/api/imports.md`（补充 POST /import/chat）
  - 更新架构文档（docs + vitepress）补充导入导出概述
  - 更新 VitePress 侧边栏和 API 资源索引

### 2026-07-03

- 完成 ResourceToolProvider 第三批：11 个新增工具（列表补全 4 + 细粒度读取 4 + 预设/正则写入 3），总计 23 个
- 新增工具：`list_regex_profiles`、`list_presets`、`list_worldbook_entries`、`list_character_versions`、`get_worldbook_entry`、`get_regex_rule`、`get_preset`、`get_preset_entry`、`create_regex_profile`、`create_preset_entry`、`update_preset_entry`
- `list_worldbook_entries` 仅返回条目摘要（comment + keys），不含 content，显著节省 token
- 预设工具使用 `preset-utils.ts` 工具函数实现 read-modify-write 模式
- 新增 38 个测试，resource-tool-provider.test.ts 共 80 个
- 全量测试 core 315 + adapters 109 + api 525 = 949，零回归

### 2026-07-02

- 完成 ResourceToolProvider：12 个资源管理工具（角色卡 4 + 世界书 5 + 正则 3）
- Core 层新增 `ToolExecutionContext.accountId` 和 `TurnInput.accountId`，编排层透传
- `app.ts` 创建 `ToolRegistry`，注册 `BuiltinToolProvider` + `ResourceToolProvider`，传入 `ChatService`
- 创建的资源标记 `source = 'tool'`，写入工具 `sideEffectLevel = 'irreversible'`
- 新增 42 个测试（资源工具正常路径 + 错误路径 + 多账户隔离）
- 全量测试 core 315 + adapters 109 + api 487 = 911，零回归

### 2026-07-01

- 完成 MCP（Model Context Protocol）客户端集成
- 新增 `@modelcontextprotocol/sdk` 依赖（仅 apps/api）
- 新增 `mcp_server_config` 表（迁移 `0015_mcp_server_config.sql`）
- 新增 `McpConnection`、`McpConnectionManager`、`McpToolProvider` 三个核心类
- 新增 12 个 API 端点（6 配置 CRUD + 6 运行时操作）
- 新增 3 个事件类型：`mcp.connected`、`mcp.disconnected`、`mcp.error`
- 支持 stdio 和 Streamable HTTP 两种传输
- MCP 工具通过 ToolProvider 接口注册，对上层完全透明
- 新增 32 个测试（McpService 21 + McpToolProvider 11），全量 core 315 + api 445 = 760（含 adapters 864）

### 2026-06-26

- 完成 Tool Calling 系统 Phase 1-5：核心类型、LLM 层改造、内置工具、编排层集成、API 路由
- 新增 80 个测试（core 83 + api 11 集成测试），全量 core 315 + api 413 = 728（含 adapters 832）
- 新增数据库迁移 `0014_tool_calling.sql`，包含 `tool_call_record` 和 `tool_definition` 两张表

### 2026-06-25

- 同步后端 API 进度：Beta 准入标准 14/14 全部达成，真实 provider 回归已通过，世界书 E2E 测试已全部通过
- API 全量测试更新为 371 passed，全库合计 707 个测试

### 2026-02-12

- 完成 M5 运行期修复收尾
- ProviderRegistry 修复 ESM 动态加载（createRequire）
- LLMService 增加 usage 字段兼容与归一化（含 input/output token）
- TurnOrchestrator 与 ChatService 增加 token usage 安全兜底
- 补齐 `@ai-sdk/openai` 依赖，`openai-compatible` 配置可直接启动
- 真实服务验证通过：respond、多轮、regenerate 全链路可用

### 2026-02-11

- 完成 M4 Phase 2：Regenerate / WebSocket / Imports
- ChatService.regenerate 逻辑实现与 8 个测试
- WebSocket 集成 buildApp 与 5 个测试
- 导入路由（预设/世界书/正则）与 19 个测试
- 累计 442 个测试全部通过

### 2026-02-11

- 完成 M4 Phase 1：核心聊天接口
- 新增 OrchestrationFactory：Composition Root 组装全部 Core 组件
- 新增 ChatService：会话验证 / 历史加载 / 楼层创建 / 消息入库 / TurnInput 构建
- 新增 POST /sessions/:id/respond 路由
- 更新 buildApp：可选 orchestration 配置，返回 BuildAppResult
- 10 个新测试，累计 410 个测试全部通过

### 2026-02-10

- 完成 M3 Phase 3：WebSocket 实时推送
- 新增 WsBridge 桥接器：EventBus → WebSocket 转发、sessionId 过滤
- 新增 registerWsPlugin：Fastify WebSocket 插件注册
- 14 个新测试，累计 400 个测试全部通过

### 2026-02-10

- 完成 M3 Phase 2：TurnOrchestrator 完整回合编排器
- 新增 TurnOrchestrator 类：串联 Director → Memory → Narrator → Verifier → Consolidation
- 支持 Verifier 三种策略（warn / block / retry）
- 20 个新测试，累计 386 个测试全部通过

### 2026-02-10

- 完成 M3 Phase 1：DB Adapters
- 新增 3 个 Drizzle Adapter（FloorRepository、VariableRepository、MemoryRepository）
- 43 个新测试，累计 386 个测试全部通过

### 2026-02-10

- 完成 M2 Phase 5：记忆系统 + compat_plus + Director/Verifier
- 新增 memory/ 模块：MemoryStore（摘要入库/预算注入/整理应用）、MemoryConsolidation（LLM 整理器）
- 新增 orchestration/ 模块：Director（叙事指令）、Verifier（一致性检查）
- 新增 compat_plus 编排器：在 compat_strict 基础上注入记忆 section
- 扩展共享类型：MemoryScope/Type/Status/Relation 4 组常量
- 扩展事件系统：memory.created/updated/deprecated/consolidated 4 个新事件
- 59 个新测试，累计 316 个测试全部通过

### 2026-02-10

- 完成 M2 Phase 4：LLM 接入层 + Generation Pipeline
- 新增 llm/ 模块：类型定义、Provider Registry、LLM Service（Vercel AI SDK 封装）
- 新增 generation/ 模块：摘要提取器、生成流水线（前处理→LLM→摘要提取→后处理）
- 扩展事件系统：generation.started/chunk/completed/failed 4 个新事件
- 51 个新测试，累计 257 个测试全部通过

### 2026-02-10

- 完成 M2 Phase 3：SillyTavern 适配层 + compat_strict 编排
- 新增 adapters-sillytavern 包：精简类型、Zod 解析器、世界书触发引擎、正则脚本引擎、compat_strict 编排器
- 92 个新测试，累计 206 个测试全部通过

### 2026-02-10

- 完成 M2 Phase 2：提示词基础设施
- 新增 Prompt IR 类型、模板引擎、Token 预算管理器、消息拼装器
- 49 个新测试，累计 114 个测试全部通过

### 2026-02-10

- 完成 M2 Phase 1：楼层状态机 & 变量系统
- 65 个单元测试全部通过

---

维护约定：每次合并 `packages/core` 或 `packages/adapters-sillytavern` 相关功能后，更新本文档。
