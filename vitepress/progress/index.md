# 进度总览

## 当前状态

| 模块 | 阶段 | 说明 |
| ---- | ---- | ---- |
| `packages/core` | M12 进行中 | 核心引擎逻辑，楼层状态机、变量系统、提示词编排、LLM 调度、记忆系统均已落地 |
| `packages/adapters-sillytavern` | 已完成 | 预设/世界书/正则/角色卡解析，compat_strict + compat_plus 编排器 |
| `apps/api` | **Beta 准入完成** | Beta 准入标准 14/14 全部达成，真实 provider 回归通过，可进入正式 sign-off |
| `apps/web` | P0/P1 进行中 | Narrative Workspace 主工作流，前端解耦收口约 95% |

## 测试统计

| 模块 | 测试数 |
| ---- | ---- |
| `packages/core` | 232 |
| `packages/adapters-sillytavern` | 104 |
| `apps/api` | 371 |
| **合计** | **707** |

## 后端 Beta 已覆盖能力

- CRUD 与迁移（Session/Floor/Page/Message/Variable/Memory）
- 聊天生成与重生成
- SSE 流式响应
- Prompt dry-run 调试
- 分支治理（创建/删除/对比/续写）
- 角色生命周期（版本化/绑定/同步/软删除/恢复）
- 多账号隔离与用户绑定
- LLM Profile Vault（加密存储/CRUD/激活/运行时解析）
- LLM Instance Config API（多级优先级配置）
- 模型发现与连通性测试
- 记忆注入与维护任务
- OpenAPI/Swagger 文档
- Typed SDK
- CORS 与中英文化文档入口
- 首批 batch 接口（variables/memories/messages）
- 真实 LLM provider 回归测试通过

## 详细进度

- [核心引擎进度](/progress/core)
- [后端 API 进度](/progress/api)
- [管理前端进度](/progress/web)
