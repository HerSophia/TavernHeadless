---
outline: [2, 3]
---

# 管理前端进度

> 对应 `apps/web`，Narrative Workspace 路线。

## 当前里程碑

- 里程碑：FW-P0/P1 + WFD - 主工作流与前端解耦收口
- 状态：解耦整体约 95%

## 已落地能力

### 产品形态

- [x] 三栏结构：左导航 / 中画布 / 右 Inspector
- [x] 移动端抽屉适配
- [x] Inspector Tab：Bindings / Memory / Impact
- [x] Session 右键菜单：Create / Open / Rename / Archive / Delete
- [x] 绑定操作联动同步

### 账号模式

- [x] `single` 模式隐藏账号切换入口
- [x] `multi` 模式展示账号切换、隔离提示
- [x] 切换账号时清空工作区上下文

### 资产库与导入

- [x] 左栏内置 Asset Browser
- [x] 按资产类型导入：preset / worldbook / character / user
- [x] 角色导入支持 JSON + TavernCard 图片（PNG/WebP metadata）
- [x] 导入前预检与详细错误
- [x] 失败诊断区、重试、重复策略

### 资产管理器

- [x] Preset：两阶段编辑、结构化草稿、同 ID 更新、冲突检测
- [x] Character：版本化管理、关键字段编辑、软删除与恢复
- [x] Worldbook：详情读取、编辑、导出、会话绑定/取消绑定

### LLM Profile 管理

- [x] 二次确认删除
- [x] 搜索过滤
- [x] 模型列表发现与回填
- [x] 模型连通性测试
- [x] `APP_SECRETS_MASTER_KEY` 错误提示

## 前端解耦专项（wfd）

- [x] wfd-01：建立解耦基线与回归护栏
- [x] wfd-02：API 层按资源域拆分
- [x] wfd-03：Workspace Store 拆分
- [x] wfd-04：App.vue 编排层下沉到 composables
- [ ] wfd-05：大组件拆分（约 95%）
- [ ] wfd-06：收口阶段

## 待办

### P0

- [ ] 解耦收口手测
- [ ] 端到端回归（含复杂 prompt_order）
- [ ] 视觉回归确认

### P1

- [ ] 前端交互测试
- [ ] 保真回归
- [ ] 资产管理器扩展到 user

### P2

- [ ] Character Lab、Memory Explorer
- [ ] 继续审查 `apps/web/src/lib/workspace-api/*` 中仍然保留的薄封装，确认哪些属于应用层映射，哪些应继续收敛到 `@tavern/sdk` 或 `@tavern/client-helpers`
- [ ] 保持前端接入基线与官方包同步；如果引擎、后端、SSE、OpenAPI、Tools、MCP 等接入语义变化，优先更新官方包与文档，再处理前端迁移
- [ ] 仅在确有必要时直接使用内部包 `@tavern/shared`，不把它当作前端公开接入面的替代品
