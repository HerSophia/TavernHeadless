---
outline: [2, 3]
---

# 核心引擎进度

> 对应 `packages/core` 与 `packages/adapters-sillytavern`。

## 当前里程碑

- 里程碑：M9-M12 后端高优先级能力
- 状态：进行中（Tool Calling 系统 Phase 1-5 已完成）

## Tool Calling 系统（已完成 Phase 1-5）

- [x] Phase 1：核心类型（`ToolRegistry`、`ToolExecutor`、4 个事件类型，33 tests）
- [x] Phase 2：LLM 层改造（`LLMRequest.tools`/`maxSteps`、`LLMResponse.toolCalls`/`steps`，3 tests）
- [x] Phase 3：内置工具提供者（`BuiltinToolProvider`，7 个工具，22 tests）
- [x] Phase 4：编排层集成（`TurnOrchestrator` 工具接线，11 tests）
- [x] Phase 5：`PresetToolProvider`（自定义工具执行器）

## M12 Phase 4：Native Pipeline 错误定位与执行轨迹

- [x] `NativePipelineError` 统一携带 `nodeName`
- [x] 异常上下文补充 `inputSummary/stateSummary`
- [x] pipeline 状态新增 `artifacts.executedNodes` 轨迹
- [x] `ConditionNode`：支持 `when` 分支 + 嵌套执行
- [x] `TransformNode`：按 role/section 过滤的正则替换
- [x] `MemoryInjectNode`：原生链路内注入 `[Memory Summary]`
- [x] `PackMessagesNode`：section 清理、排序与最终输出
- [x] LLM Instance Slot + Profile Binding 全链路

## M10：角色卡解析

- [x] `parseCharacterCard()` 支持 TavernCard v2 envelope 与 legacy 格式
- [x] 字段标准化映射与清洗

## M9：SSE 中止信号透传

- [x] `TurnInput.abortSignal` 支持客户端断连中止

## M5：MVP 端到端打通

- [x] Provider ESM 加载修复
- [x] LLM usage 归一化
- [x] TurnOrchestrator token usage 安全累加

## M4：核心聊天与 WebSocket

- [x] Regenerate 方法与路由
- [x] WebSocket EventBus → WsBridge
- [x] 预设/世界书/正则导入

## M3：编排器与 DB Adapters

- [x] TurnOrchestrator（Director → Memory → Narrator → Verifier → Consolidation）
- [x] Verifier 三种策略（warn / block / retry）
- [x] DrizzleFloorRepository / VariableRepository / MemoryRepository

## M2：核心领域模型

- [x] Phase 1：楼层状态机 + 变量系统（65 tests）
- [x] Phase 2：提示词基础设施 Prompt IR / TemplateEngine / TokenBudget / MessageBuilder（49 tests）
- [x] Phase 3：SillyTavern 适配层 + compat_strict 编排（92 tests）
- [x] Phase 4：LLM 接入层 + Generation Pipeline（51 tests）
- [x] Phase 5：记忆系统 + compat_plus + Director/Verifier（59 tests）

## 测试统计

| 阶段 | 新增 | 累计 |
| ---- | ---- | ---- |
| M2 Phase 1 | 65 | 65 |
| M2 Phase 2 | 49 | 114 |
| M2 Phase 3 | 92 | 206 |
| M2 Phase 4 | 51 | 257 |
| M2 Phase 5 | 59 | 316 |
| M3 DB Adapters | 43 | 359 |
| M3 TurnOrchestrator | 20 | 379 |
| M3 WebSocket | 14 | 400 |
| M4 Chat Endpoint | 10 | 410 |
| M4 Regenerate/Imports | 32 | 442 |
| Tool Calling Phase 1-5 | 80 | 522 |
| MCP 集成 | 32 | 554 |

全量：core 315 + adapters 104 = 419（不含 API 测试），API 445
