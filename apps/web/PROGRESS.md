# Web Progress

> 目的：记录 `apps/web` 前端开发进度，便于续接 Narrative Workspace 路线。
> 维护规则：每次完成一个可感知阶段（交互、状态、导入链路、验证）后更新本文件。

## 当前里程碑

- 里程碑：`FW-P0/P1 + WFD - Narrative Workspace 主工作流与前端解耦收口`
- 状态：`进行中（解耦整体约 95%：wfd-01~wfd-04 已完成，wfd-05 收口中，wfd-06 文档与残余清理进行中）`
- 最后更新：`2026-02-15`

## 1) 产品形态与硬约束对齐（已落地）

- [x] 前端定位从 CRUD 控制台收口为 Narrative Workspace（非 admin 风格）。
- [x] 三栏结构：左导航 / 中画布 / 右 Inspector（桌面）。
- [x] 移动端抽屉适配：导航与 Inspector 可独立拉起与关闭。
- [x] Inspector Tab 严格固定为 `Bindings / Memory / Impact`。
- [x] Session 右键菜单严格固定为 `Create / Open / Rename / Archive / Delete`。
- [x] `Archive` 与 `Delete` 保持语义区分，删除保留至少 1 个会话锚点。
- [x] 绑定操作联动同步：中栏标签 / 右栏 Inspector（左栏已收口为 Current Preset 快捷区）。

## 2) 账号模式与隔离策略（已落地）

- [x] 保持账号模式判定常量：
  - `const accountMode = import.meta.env.VITE_ACCOUNT_MODE === "single" ? "single" : "multi";`
- [x] `single` 模式隐藏账号切换入口。
- [x] `multi` 模式展示账号切换入口、隔离提示与账号上下文信息。
- [x] 切换账号时清空工作区上下文（选中态/面板态/缓存态），防止跨账号错觉。

## 3) 资产库与导入链路（P0/P1 已完成）

### 3.1 资产库浏览与操作

- [x] 左栏内置 Asset Browser（筛选/搜索/排序/收藏/应用/打开）。
- [x] 键盘优先交互：`Ctrl+F` 搜索、`J/K` 选择、`Enter` 打开、`A` 应用、`I` 导入。
- [x] 本地优先资产合并与后端拉取回填策略。

### 3.2 导入能力（含预检）

- [x] 支持按资产类型导入：`preset/worldbook/character/user`。
- [x] 导入对话框支持文件选择、拖放、批量导入。
- [x] 角色导入支持 JSON + TavernCard 风格图片（PNG/WebP metadata 提取）。
- [x] 导入前预检（格式、JSON 结构、metadata 可解析性）与详细错误原因。

### 3.3 稳健性增强

- [x] 导入失败结构化结果：`fileName + reason + message + assetName`。
- [x] 失败诊断区支持展开详情、仅重试失败项。
- [x] 重复策略：`skip/allow`。
- [x] 重复检测覆盖：库内重名、批内重名、名称归一化对齐。
- [x] 批量导入进度反馈：`preparing/importing/hydrating/done` + 计数与当前文件。

### 3.4 已修复问题

- [x] `/characters`、`/users` 拉取 limit 对齐后端上限，修复 400。
- [x] 资产导入后刷新可见性问题收口（含预设刷新回显）。

## 4) 资产管理器（Preset + Character，P0 已落地）

> 范围：以预设（Preset）为先，完成“概览列表 -> 单条编辑”的酒馆同型交互与同 ID 更新链路。

### 4.1 交互与状态模型

- [x] 资产卡片右键菜单可进入预设管理（编辑/删除/复制）。
- [x] 预设管理器改为两阶段：`overview/list` -> `entry`，不再走 JSON 大文本编辑。
- [x] 本地结构化草稿编辑：增删改、上下移动、启用开关即时生效，避免反复 parse/stringify 全量 JSON。
- [x] App 层新增预设编辑状态：`view / editorDraft / activeEntryId / expectedUpdatedAt`。
- [x] 左栏运行区从 `Current Bindings` 调整为 `Current Preset`，新增编辑/更换/导出快捷按钮并打通事件反馈。

### 4.2 API 与 Store 链路

- [x] API 层新增：`fetchPresetAssetEditorDetail`（`GET /presets/:id/editor`）。
- [x] API 层新增：`updatePresetAsset`（`PUT /presets/:id`）。
- [x] Store 层 `loadPresetAssetDetail` 改为读取 editor projection（`detail.editor`）。
- [x] Store 层 `savePresetAsset` 模式改为 `duplicate | update`：
  - `duplicate`：走导入创建。
  - `update`：走同 ID `PUT /presets/:id`，支持 `expected_updated_at` 冲突检测。
- [x] 移除旧的 overwrite（导入 + 删除）保存语义，避免 ID 跳变。

### 4.3 兼容性与数据保真

- [x] 前端完整透传编辑文档中的未知字段（`topLevel` / `extra` / order-context extra）。
- [x] 后端保存“原始预设 JSON”，前端编辑仅对结构化字段做可控变更。
- [x] 兼容 legacy compact 预设形态，前端可直接进入结构化编辑流。
- [x] 修复多 `prompt_order` 上下文时的默认排序选择偏差（优先 richest context，顺序更贴近酒馆）。

### 4.4 文案与样式

- [x] i18n 补齐（`zh-CN` + `en`）：条目数量、新增条目、返回概览、字段标签、缺失提示等。
- [x] 新增样式：列表行、条目动作区、两阶段编辑布局与移动端网格适配。
- [x] 当前策略：资产管理器优先覆盖 preset + character；其余资产类型维持未支持提示。

### 4.5 Character 版本化管理（新增）

- [x] 资产右键菜单新增 Character 分流，支持进入角色管理器。
- [x] Character 管理器支持详情读取、关键字段编辑（`name/description/personality/first_mes/scenario`）。
- [x] 保存语义采用 `POST /characters/:id/versions` 追加版本，不做原地覆盖。
- [x] 支持软删除与恢复（`DELETE /characters/:id` / `POST /characters/:id/restore`）。
- [x] 删除态角色在管理器内切换为恢复流程，避免误写版本。
- [x] i18n/事件日志补齐 Character 管理全链路反馈。
- [x] 产品策略提示已落地：`Preset Create` 不是当前项目主线，不作为推荐入口。

### 4.6 Worldbook 资产管理（新增）

- [x] 资产右键菜单新增 Worldbook 分流，支持进入世界书管理器。
- [x] Worldbook 管理器支持详情读取、名称/JSON 编辑、同 ID 更新、复制与删除。
- [x] Worldbook 支持右键导出（JSON 文件）。
- [x] Worldbook 右键菜单新增“绑定到当前会话 / 取消绑定当前会话”（仅在已绑定时显示取消绑定）。
- [x] i18n/事件日志补齐 Worldbook 管理与绑定反馈。

## 5) 测试与验证（当前稳定状态）

- [x] `pnpm --filter @tavern/web typecheck`
- [x] `pnpm --filter @tavern/api test -- imports.test.ts`（Preset editor/update 相关用例已增补）
- [x] `pnpm --filter @tavern/adapters-sillytavern test -- preset-parser.test.ts`（legacy alias 兼容）
- [x] `pnpm --filter @tavern/api typecheck`

备注：Web 侧现阶段验证以类型与交互链路为主；Preset 结构兼容与回归由 API/adapter 测试协同覆盖。

## 6) 关键文件分层（当前）

- API 访问：`apps/web/src/lib/workspace-api.ts`
- 状态与业务：`apps/web/src/stores/workspace.ts`、`apps/web/src/stores/workspace-ui.ts`
- 工作区主编排：`apps/web/src/App.vue`
- 组件层：`apps/web/src/components/workspace/*`
- 文案：`apps/web/src/i18n/messages.ts`
- 样式：`apps/web/src/style.css`

## 6.1) 前端解耦专项（wfd）阶段进度

- [x] `wfd-01`：建立解耦基线与回归护栏，固定增量 typecheck 节奏。
- [x] `wfd-02`：API 层按资源域拆分并完成调用面迁移。
- [x] `wfd-03`：Workspace Store 拆分为 action 模块与辅助映射，降低主文件复杂度。
- [x] `wfd-04`：`App.vue` 编排层下沉到 composables，保留 orchestrator 职责。
- [ ] `wfd-05`：大组件拆分接近完成（约 95%）：
  - 已完成 Canvas/Inspector 子面板拆分、对话框 UI primitive 替换（`UiSelectShell`/`UiCheckboxField`/`UiTextInput`/`UiTextArea`）。
  - 已完成 overlays 区块抽离为 `apps/web/src/components/workspace/WorkspaceOverlayLayer.vue`，且保留 `WorkspaceViewportFrame` slot 结构。
  - 待完成：手工回归验收与少量壳层收口。
- [ ] `wfd-06`：收口阶段（迁移痕迹清理、职责约定文档化、进度文档同步）。

## 7) 待办与下一阶段

### P0（高优先）

- [x] LLM Profile 删除改为二次确认对话框（沿用现有 UI dialog 风格，未使用原生 confirm）。
- [x] LLM Profile 列表支持按 `provider / status / name` 搜索过滤。
- [x] LLM Profile 编辑器支持“尝试获取模型列表”（前后端联动，按 `provider/base_url/api_key` 拉取并可回填 `model_id`）。
- [x] LLM Profile 编辑器新增“测试模型”按钮：向当前 provider/model 发送 `Hello` 探测并反馈结果。
- [x] LLM Profile 保存报错增加 `APP_SECRETS_MASTER_KEY` 场景的人类可读提示（zh/en）。
- [x] LLM Profile 管理页改为显式打开编辑器：进入页面默认不展示表单，需点击“新建”或“编辑”。
- [ ] 解耦收口手测：Session 菜单顺序与语义（`Create / Open / Rename / Archive / Delete`）+ 最少 1 会话删除保护。
- [ ] 解耦收口手测：Asset Import 与 Preset/Character/Worldbook manager 全链路（含 i18n/toast/event key）。
- [ ] 解耦收口手测：Message actions（edit/regenerate/retry/delete）及事件反馈一致性。
- [ ] 基于 `酒馆样本` 权威夹具做端到端回归（含复杂 `prompt_order` 扩展与 `extensions` 保真）。
- [ ] 视觉回归确认：dialog overlay 全屏行为与下拉 jitter/透明度问题无回退。

### P1（进行中）

- [ ] 补前端交互测试：两阶段打开/编辑、列表即时 CRUD、保存冲突场景。
- [ ] 补强保真回归：未知字段、扩展字段、多上下文 `prompt_order` 的 read-model 与 save roundtrip。
- [ ] 将 `App.vue` 预设管理编排继续下沉到 store/composable，降低组件体积。
- [ ] 资产管理器按同一交互壳继续扩展到 `user`（character/worldbook 已接入）。
- [ ] Canvas 只读区块继续细分（metadata/timing）与 Inspector shell 进一步收敛。

### P2（后续路线）

- [ ] `fw-13` 到 `fw-17`：Character Lab、Memory Explorer、交互测试与性能优化。
- [ ] 持续迁移到 `packages/shared` typed API client，减少直接 fetch。
- [ ] 可选：夹具脱敏脚本化（保 key 换 value）以支撑大样本回归迭代。

## 8) 已知约束（维护时不可破坏）

- Narrative Workspace 不是管理后台视觉，不回退到 CRUD 叙事。
- 关系语义保持：`Account -> Session -> User(1) + Character(1) + Worldbooks(N)`。
- Session 删除保护：至少保留 1 个会话。
- Session 菜单项固定顺序与文案语义不可漂移。
- Inspector 三 tab 名称与行为保持固定。
- i18n 覆盖范围需保持全量：UI/系统提示/对话框/Toast/事件日志。
- 暂缓项：不启动 message-action shortcut/dropdown 重构。
