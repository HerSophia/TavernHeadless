---
outline: [2, 3]
---

# 前端设计

## 1. 定位

TavernHeadless 的前端不是传统 CRUD 后台，而是一个面向创作与调试的
**Narrative Workspace**。它的目标是让开发者和 RP 创作者在同一界面里，
高效完成会话管理、链路调试、角色实验和记忆观察。

前端设计原则：

- 优雅：视觉克制、层级清晰、细节精致。
- 高效：键盘优先，少跳转，低心智负担。
- 适中密度：信息足够多，但始终可扫读。

## 2. 技术构建方案

- 框架：Vue 3 + Vite + TypeScript。
- 状态管理：Pinia（跨模块状态、用户偏好、会话上下文缓存）。
- UI 方案：Radix Vue（无样式可访问组件）+ Tailwind CSS（设计令牌驱动）。
- 数据访问：`packages/shared` 的 Typed API Client（OpenAPI 生成）。
- 图标：Lucide Vue Next（统一线性风格）。
- 动画：CSS transition + 少量 Motion primitives（仅在状态切换时出现）。

## 3. 视觉系统

### 3.1 设计语言

- 工具感优先：借鉴 IDE 与设计工具，而不是电商后台。
- 内容主角：对话、Prompt、记忆数据优先于容器装饰。
- 轻装饰：通过微渐变、细边框、低饱和底色建立层次。

### 3.2 颜色策略

- 支持浅色与深色双主题，不偏向单一模式。
- 主强调色建议使用蓝青或琥珀系，避免高饱和紫色主导。
- 语义色固定：成功（绿）、警告（黄）、错误（红）、信息（蓝）。

推荐令牌：

- `--bg`: 页面背景。
- `--surface`: 卡片/面板背景。
- `--text-primary`: 主文本。
- `--text-secondary`: 次文本。
- `--accent`: 主操作与高亮。
- `--border-subtle`: 弱边框。

### 3.3 字体与排版

- 中文优先：`Noto Sans SC`。
- 英文与数字：`Geist`。
- 等宽字体：`JetBrains Mono`（日志、token、JSON、ID）。
- 行高建议：正文 1.55，面板说明 1.45，标题 1.25。

## 4. 布局与信息密度

采用三栏工作区，兼顾导航、创作和检查：

- 左栏（导航）：会话/角色/世界书/导入资源。
- 中栏（主画布）：时间轴、消息流、编辑区。
- 右栏（Inspector）：变量、记忆命中、token 用量、诊断信息。

密度控制规则：

- 默认只展示关键字段，次要信息通过展开或 hover 露出。
- 列表保持 8px 垂直节奏，保证连续扫描效率。
- 每个面板不超过 2 个主操作按钮，避免操作噪音。

## 5. 交互与动效规范

- 首屏：分区渐入（150~250ms）+ 轻微位移，不做炫技动画。
- 悬停：仅改变背景和边框，不改变布局。
- 流式回复：使用平滑文本显现，避免跳动式闪烁。
- 加载状态：优先 skeleton，不使用长时间转圈。

## 6. 核心模块 UI 定调

### 6.1 会话时间轴

- 支持分支可视化（fork 点、主线、回退点）。
- 每轮消息可展开诊断（Prompt 片段、内存注入、耗时、token）。

### 6.2 角色实验室

- 版本并排对比（差异高亮）。
- 关键字段即时预览（greeting、persona、生效上下文）。

### 6.3 记忆观察器

- 以列表为主、图谱为辅，保证大规模数据可读性。
- importance/confidence 提供清晰视觉权重映射。

## 7. 落地优先级

- P0：全局布局骨架、主题令牌、基础组件（Button/Input/Card/Table/Sheet）。
- P1：会话时间轴 + Inspector 联动。
- P2：角色实验室与记忆观察器。
- P3：快捷键体系、个性化布局、性能优化。

## 8. 验收标准

- 首屏 3 秒内可进入工作状态（本地开发环境）。
- 关键路径（创建会话 -> 对话 -> 查看诊断）可在 30 秒内完成。
- 新用户在无文档情况下可在 5 分钟内理解三栏结构与主流程。

## 9. 视觉基调参考

### 9.1 核心美学：Atmospheric Utilitarianism

- **No Shadows, Just Layers**: 尽量避免弥散的大阴影。使用 `1px` 精细边框 (`border-white/5` 或 `border-black/5`) 和极微弱背景色差来切割空间。
- **Data as Texture**: 密集的文本、Token 计数、ID 标识本身就是界面的纹理。不要试图隐藏它们，而是通过 `JetBrains Mono` 和完美的对齐让它们成为一种工业美感。
- **Reactive Glow**: 界面默认是冷峻、静默的。只有在数据流通过（如 SSE 接收中）或用户聚焦时，才出现微弱的"能量流动"感（Accent Color 的微光）。

**基调 CSS 变量示意：**

```css
:root {
  --app-bg: #09090b;
  --panel-base: #121215;
  --panel-float: #18181b;
  --border-subtle: rgba(255, 255, 255, 0.08);
  --border-active: rgba(255, 255, 255, 0.15);
  --signal-success: #4ade80;
  --signal-warn: #fbbf24;
  --signal-error: #f87171;
  --signal-accent: #2dd4bf;
  --glass-blur: 12px;
  --font-mono: 'JetBrains Mono', monospace;
}

.interaction-focus {
  box-shadow: 0 0 0 1px var(--signal-accent), 0 0 12px -4px var(--signal-accent);
  transition: all 0.2s cubic-bezier(0.2, 0, 0, 1);
}
```

## 10. 实体关系与 CRUD 交互模型

会话、角色卡、世界书不是平行实体，交互上应体现"主对象 + 附着资源"的关系。

### 10.1 关系模型（信息架构）

- **会话（Session）是主对象**：时间轴、分支、重试、诊断全部围绕会话发生。
- **角色卡（Character）是行为配置**：可被多个会话复用；默认影响发言风格与系统提示。
- **世界书（Worldbook）是知识资源**：可被角色和会话复用；在注入阶段按规则命中。

### 10.2 布局映射

- 左栏第一优先展示会话列表，角色卡与世界书归入 `Library` 分组。
- 中栏只承载当前会话的创作与调试，不在主画布做跨实体编辑。
- 右栏提供 `Bindings` 面板，展示当前会话绑定了谁、命中了谁、优先级如何。

### 10.3 CRUD 语义分��

- **Create**：在会话流中是新建会话并绑定角色/世界书；在 Library 中是创建可复用资产。
- **Read**：会话内读取的是绑定后的生效视图；资产详情读取的是原始定义。
- **Update**：会话内改绑定关系（Attach/Detach/Priority），资产编辑在 Side Sheet 完成，保存后回流会话。
- **Delete**：默认删除绑定关系而非删除资产本体；删除资产需二次确认并显示影响会话数。

### 10.4 关键交互细则

- 在会话标题区固定显示 `Active Character` 与 `Active Worldbooks` 标签，保持用户全程上下文感知。
- 绑定操作使用动词化按钮：`Attach`, `Detach`, `Replace`, `Set Priority`，避免模糊的"编辑"。
- 所有危险操作先给 Impact Preview，再确认。
- 角色卡或世界书保存后提示 `Apply to current session`，减少"改了但没生效"的错觉。

### 10.5 验收补充

- 新用户可在 10 秒内回答"我现在编辑的是会话本身，还是资产模板"。
- 从会话内完成"换角色 + 调整世界书优先级 + 继续对话"不超过 3 次点击。
- 任意删除动作都能明确区分"解除绑定"和"删除资产"。

## 11. 多用户（Account + User）交互设计

多用户不应只做"登录后分数据"，而应在界面上明确作用域：`Account -> Session -> Bindings`。

### 11.1 作用域模型

- **Account 是租户边界**：所有会话、角色卡、世界书、用户卡都严格归属当前账号。
- **User（account_user）是账号内资产**：用户卡在 Library 中维护，可被多个会话复用。
- **Session 绑定单个 User 快照**：会话运行时读取 `user_snapshot`，不是直接读取用户卡实体。

### 11.2 全局布局与入口

- 顶栏固定 `Current Account` 切换器（仅 `ACCOUNT_MODE=multi` 可见）。
- 左栏保持 `Runtime` 与 `Library` 分层；`Users` 放在 `Library`，与 `Characters/Worldbooks` 同级。
- 会话标题区固定显示 `Account`、`Active User`、`Active Character`、`Active Worldbooks` 四个标签。

### 11.3 多用户 CRUD 交互语义

- **Create User**：在 Library 新建用户卡；可选择"创建后绑定到当前会话"。
- **Read User**：会话中展示的是"已绑定快照"；详情页展示的是"资产原始定义"。
- **Update User**：编辑用户卡后不自动污染历史会话；通过 `Apply to current session` 显式替换快照。
- **Delete User**：默认建议先 `Disable`，硬删除前展示 Impact Preview（影响会话数/楼层数）。

### 11.4 防混乱机制

- 所有绑定区块都带作用域标签：`Asset` / `Snapshot` / `Applied`，防止用户误解"改了为什么没生效"。
- 会话替换 User 时提示"将同步更新该会话所有后续 floor 的 user_binding 元信息"。
- Account 切换后清空工作区上下文（选中会话、Inspector 缓存、最近搜索），避免跨账号错觉。
- 跨账号资源永不展示"空壳可见性"，统一表现为不可见（而不是 disabled）。

### 11.5 单账号与多账号的自适应

- `ACCOUNT_MODE=single`：隐藏账号切换器，文案默认省略账号维度，保留轻量体验。
- `ACCOUNT_MODE=multi`：显示账号切换器、账号色条与隔离提示，所有列表请求携带账号上下文。
- 在任意模式下，关键路径操作（创建会话 -> 绑定 user -> 对话）不增加额外跳转层级。

## 12. i18n 与右侧栏交互实现要求

### 12.1 i18n 最小落地范围

- 至少支持 `zh-CN` 与 `en` 两种语言；默认跟随系统或产品默认值（当前 demo 采用 `zh-CN`）。
- 文案分层：导航/按钮/状态提示/确认文案必须国际化；调试 ID 与模型名保持原样。
- 动态文案支持变量插值（例如 `{count}`、`{user}`、`{account}`），避免拼接导致语序错误。
- 输入 placeholder、Toast、Impact Preview 与 Confirm Dialog 必须走同一套 i18n key。

### 12.2 右侧栏（Inspector）交互规范

- Tab 必须可切换：`Bindings / Memory / Impact` 三个面板单选显示，不允许并列堆叠造成信息噪音。
- `Bindings` 面板支持可执行动作：`Replace User`、`Attach Worldbook`、`Apply asset update`。
- 操作后必须有即时反馈：至少包含视觉反馈（卡片高亮）与文本反馈（事件日志或 toast）。
- `Impact` 面板承担危险动作前置说明：展示受影响会话/楼层数量，并给出"先 Disable"路径。

### 12.3 状态同步原则

- 右侧栏任何绑定操作，必须同步更新会话标题区与左栏 `Current Bindings`，避免局部状态漂移。
- Account 或 User 替换后，Inspector 中的 `Snapshot` 标签与说明文案必须立即刷新。
- i18n 切换时，右侧栏历史事件文案应可重新渲染，保持语言一致性。

### 12.4 左侧栏 Session CRUD 交互

- 在 `Runtime > Sessions` 下采用会话列表右键菜单承载 CRUD：`Create`、`Read/Open`、`Update`、`Archive`、`Delete`。
- 右键动作作用于被右键的会话条目；左键点击用于切换当前激活会话。
- `Archive` 与 `Delete` 必须语义区分：Archive 为可恢复状态管理，Delete 为移除实体。
- `Delete` 至少保留 1 个会话作为运行锚点，避免主舞台进入不可操作空态。
- 所有 Session CRUD 动作要写入统一交互反馈通道（事件日志或 Toast），并支持 i18n 重渲染。
