# NodeGraph（Studio）演进路线 — TODO

> 状态：路线草案（待评审 / 排期）
> 范围：`apps/studio` 图编辑器（E10）及其与 NodeGraph Runtime / Agent Runtime 的对接演进
> 关联：
> - `../design/agentic-batch10-studio-frontend-v1-design.md`（B10 v1 总设计：ENG10/LLM10/AST10/PKG10/WB10）
> - `../design/agentic-batch10-wb10-agent-nodegraph-relationship-discussion.md`（M1 北极星：agentic 执行 = 图运行）
> - `../design/nodegraph-v2-core-ng2-core-design.md`（NG2-CORE：schemaVersion 2 / control edge / checkpoint）
> - `../design/agentic-batch9-prompt-assembly-nodegraph-v2-design.md`（NG2 / NG2-BRIDGE）
> - `../design/agent-runtime-r5-nodegraph-runtime-design.md`、`../design/nodegraph-runtime-r5-1-hardening-contract.md`
> - `../../docs/design-graph-temporary-conversation.md`（图编辑器对接临时对话）
> 最后更新：2026-06-27

---

## 0. 一句话结论

NodeGraph 的**后端内核**和**Studio 周边能力**都已被既有批次大量规划/落地了：运行 trace 观测与 replay 归 **WB10**、包导入导出归 **PKG10**、版本 promote/rollback 与运行监控归 **OPS10（v2+）**、schema v2 / control edge / checkpoint 归 **NG2-CORE（实施中）**。把这些去重后，**Studio 这一侧真正的演进真空只有一个：图编辑器本身的"编排深度"**——因为 B10 v1 明确「Graph 编辑器 v0 已交付、v1 不重做」，只给它接了 PKG10。所以本文聚焦：**让编辑器跟上后端已具备/在建的能力**（控制流、agent.call、策略预算、运行此图 + 节点状态叠加），并把 OPS10 / 北极星 M1 作为衔接项列清楚，避免与 WB10/PKG10 重复造轮子。

---

## 1. 定位与边界

### 1.1 已规划 / 已建（本文不重复，只做衔接）

| 能力域 | 归属 | 现状 | 本文态度 |
| ---- | ---- | ---- | ---- |
| 运行 trace 观测 / replay / compare | WB10（B10 v1 阶段 E） | **已设计、未实现**（`WorkbenchView.vue` 仍占位；关系讨论「待决」） | 衔接，不重复（见 §3.B） |
| NodeGraph package 导入/导出 | PKG10（B10 v1 阶段 D） | **已落地**（`modules/graph/package/*`、第一方 `nodegraph-api`） | 已完成，不在本文 |
| 后端连接 / 模型档案 / LLM 实例 / 资产库 | ENG10/LLM10/AST10 | **已落地/接近完成**（`modules/settings`、`modules/library`、`stores/{backend-connection,models,assets}`） | 已完成，不在本文 |
| 版本 promote/rollback、运行健康监控、Project 运维 | OPS10 | **顺延 v2+**（B10 v1 §3.2 非目标） | 衔接（见 §3.C） |
| schemaVersion 2 / control edge / checkpoint / input-hash reuse | NG2-CORE | **实施中**（core 合同；编辑器暴露不在其范围） | 衔接（见 §3.A1/A2） |
| native prompt 主回合图化 | NG2-BRIDGE | 设计/灰度 | 北极星 M1 的底座（见 §3.D） |
| 临时对话助手对接图编辑器 | 独立设计 | 见 `docs/design-graph-temporary-conversation.md` | 已单列，不在本文 |

> 一句话：**「运行 + 观测 + 包 + 设置 + 内核 v2」都名花有主了，唯独「编辑器编排深度」是真空。**

### 1.2 本文聚焦

> 让 Studio 图编辑器从「能画 v1 图 + 单节点预览 + 存版本」演进为「能编排 v2 控制流与 agent 调用、能就地运行并看到节点级结果、有现代编辑器人机工学」的成熟图编排器；并把 OPS10 与北极星 M1 的 Studio 落点列清楚。

### 1.3 编辑器现状基线（E10 已具备）

- 图来源/版本：读取、切换版本、另存为新版本、设当前、删除、重命名、本地草稿。
- 结构编辑：节点/边 CRUD；节点组钻入/折叠/整组开关/输出通道开关/抽取子图；节点组接口 CRUD。
- 布局与校验：ELK 自动布局 + 坐标持久化；**本地**校验 + 诊断面板（与 `@tavern/core/node-graph` 同源）。
- 预览：单节点 `preview`（dry-run）已接在 NodeInspector。
- 导入：酒馆预设转图；PKG10 包导入/导出。

---

## 2. 编辑器现状的关键短板（一句话各一条）

- **控制流不可编辑**：NG2-CORE 在加 `control.condition/branch/gate` 与 control edge，但编辑器仍按 v1 语义（control edge 报不支持），用户画不出分支/门控。
- **v2 语义不可见**：节点 `scope` / `checkpointPolicy`（决定 checkpoint 复用）无编辑入口。
- **agent.call 全靠手写 JSON**：`medium` / `deliveryTarget` / `temporaryConversationRequest` 极易写错，是图接 Agent/临时对话的最大体验黑洞。
- **策略与预算埋在裸 JSON**：`allowBackgroundJobs` / `allowPersistentOutputs` / budgets 改起来盲改盲跑。
- **不能在编辑器里跑图**：只能单节点 preview，整图 `run` 客户端已就绪却无入口（WB10 才有运行台，但编辑现场缺「运行此图 + 节点染色」）。
- **缺现代编辑器基本功**：无 undo/redo、多选、复制粘贴、节点搜索定位；新增节点是扁平下拉。
- **看不出版本改了什么**：能切版本但无 diff。
- **服务端校验未接**：只跑本地校验，命不中后端编译期/预算约束（如 size 超限 422）。

---

## 3. 演进方向

标注：**现状 / 后端就绪度 / 价值 / 工作量 / 优先级（P0>P1>P2>P3）/ 衔接关系**。

### A. 图编辑器深度（B10 明确不重做的真空地带 — 本文重心）

#### [ ] A1. 控制流节点与 control edge 编辑（衔接 NG2-CORE）· P0
- 现状：编辑器按 v1，control edge 报 `node_graph_control_edge_unsupported`，无控制流节点。
- 后端就绪度：⏳ NG2-CORE 实施中（`control.condition`/`branch`/`gate` + control edge 执行语义 + schemaVersion 2）。
- 价值：分支/门控是「图能表达真实编排逻辑」的下限能力；NG2-CORE 落地后若编辑器跟不上，能力等于没开放。
- 工作量：中-大。
- 设计提示：节点面板加控制流分类；画布区分 data / control 边（已有 `NodeGraphEdgeKind`，渲染样式区分）；为 `control.condition` 提供结构化 `ConditionExpr` 编辑器（`eq/neq/gt/…/and/or/not` + `ValueRef` 受控来源 `variable/session_state/node_output/runtime`，**禁自由文本**）；`control.gate` 的 `onSkip`（empty_output/use_cached/use_default/error）下拉。**与 NG2-CORE 排期对齐，core 合同冻结后再接 UI。**

#### [ ] A2. schemaVersion 2 语义可见：scope / checkpointPolicy 编辑 · P1
- 现状：节点/组的 `scope`、`checkpointPolicy` 无 UI。
- 后端就绪度：⏳ NG2-CORE 定义中（`floor_stable`/`pre_response_deterministic`/… + `reuse_on_regen`/`rerun_on_regen`/`manual_refresh`）。
- 价值：checkpoint 复用直接影响重生成本与一致性；作者需要能声明「这个节点 regen 时复用还是重跑」。
- 工作量：中。
- 设计提示：NodeInspector 增加 scope/checkpointPolicy 下拉（带一句话语义提示）；保存时按 v2 写 `schemaVersion: 2`；对 v1 文档保持缺省=v1 行为（向后兼容，core 已保证）。

#### [ ] A3. `agent.call` 结构化配置 · P1
- 现状：裸 JSON textarea 手写 medium/deliveryTarget。
- 后端就绪度：✅ 三介质（`single_call`/`temporary_conversation`/`background_job`）+ 多 deliveryTarget 已就绪（R5）。
- 价值：图接 Agent / 临时对话 / 后台作业的核心配置面；直接服务于「图 ↔ 临时对话」与 M1。
- 工作量：中。
- 设计提示：NodeInspector 为 `agent.call` 出专用表单——介质下拉、deliveryTarget 下拉、按目标显示必填项（如 `page_staged_write` 必填 `targetPageId`、`background_job` 需 `allowBackgroundJobs:true` 联动 A4）。表单写回 `node.config`，保留 JSON 高级模式兜底。

#### [ ] A4. 图策略与预算编辑器 · P1
- 现状：`policies`/`permissions`/budgets 仅能改裸 document JSON。
- 后端就绪度：✅ `allowBackgroundJobs`/`allowPersistentOutputs` + fan-out/嵌套作业/临时对话数/时长 预算与 reason code 已就绪。
- 价值：策略决定能否运行（介质需对应 policy）；结构化后避免「跑了才报 policy 错」。
- 工作量：中。
- 设计提示：工具栏/右栏「图设置」面板（开关 + 数字）；本地校验把「介质需要的 policy 未开」做成可定位诊断。

#### [ ] A5. 节点面板升级（分类 / 搜索 / 端口签名 / 说明）· P1
- 现状：新增节点是扁平 `<select>`，仅类型名。
- 后端就绪度：➖ 纯前端（registry 已有节点元信息）。
- 价值：节点类型增多后（NG2 控制流 + agent + output）可发现性是上手门槛。
- 工作量：中。
- 设计提示：可搜索分类面板（source/transform/agent/control/output…），项内显示输入/输出端口与简介，可拖拽落画布。是远期「节点市场」（NG2 明列批次10 之外）的前身。

#### [ ] A6. 撤销/重做、多选、复制粘贴、快捷键 · P1
- 现状：编辑就地改 + `markDirty`，无 undo/redo、无多选/复制粘贴。
- 后端就绪度：➖ 纯前端。
- 价值：编辑器基本功，缺失显著拖慢重排/试错。
- 工作量：中。
- 设计提示：基于 `cloneGraphDocument` 做有界快照栈实现 undo/redo；画布多选 + 批量移动/删除；`Ctrl+C/V` 复制节点（重映射 id 与边）。

#### [ ] A7. 版本 diff / 对比 · P2（纯前端可做）
- 现状：能切版本，看不出差异。
- 后端就绪度：➖ 无需后端（前端已持有多版本 document）；与 WB10 的「回合/运行 compare」不同维度（这里是**图定义版本** diff）。
- 价值：保存前/回看理解「这版改了什么」。
- 工作量：中。
- 设计提示：两份 document 结构化 diff（节点增删改 config、边增删、策略变更），画布染色或列表呈现。

#### [ ] A8. 服务端校验对接（与本地校验互补）· P2
- 现状：编辑器只跑本地 `validateGraphDocument`。
- 后端就绪度：✅ `validate` 端点已就绪（含编译前 size/预算检查）；客户端 `nodeGraphApi.validate` 已实现、**未接 UI**。
- 价值：本地覆盖结构性问题，服务端命中预算/编译期约束，保存前先暴露。
- 工作量：小-中。
- 设计提示：保存前或手动「服务端校验」，诊断并入面板并标来源（local/server）。

#### [ ] A9. 画布增强（小地图 / 对齐吸附 / 搜索定位）· P3
- 现状：基础 pan/zoom + fitView。
- 价值：大图导航与整洁度。
- 工作量：中。
- 设计提示：MiniMap、网格吸附、按名/类型搜索居中高亮（复用诊断「定位」highlight 机制）。

### B. 编辑器内运行与观测（与 WB10 衔接，**不重复**）

> 边界：完整运行台是 **WB10**（只读聚合 + replay + compare）。本节只补 WB10 不覆盖的「**编辑现场**」诉求：在编辑这张图时就地跑一次、并把节点级结果叠加回正在编辑的画布。关系讨论 §6.4 已把「配置 Agent 的 NodeGraph」定义为「复用 E10 编辑图 + 选当前版本 + 运行此图动作」。

#### [ ] B1. 「运行此图」动作 + 画布节点状态叠加（衔接 WB10 / M1）· P1
- 现状：只能单节点 preview；整图 `run`/`getRun` 客户端已就绪、编辑器无入口。
- 后端就绪度：✅ `run`（dry_run/preview/normal）+ `getRun`（节点级 trace）；⚠️ `worker_enabled=false` 时 normal run 只入队不消费，需提示。
- 价值：把「编辑 → 运行 → 看结果」在编辑现场闭环；dry-run 默认安全（不入队不落库）。
- 工作量：中。
- 设计提示：工具栏「试运行（dry-run）/ 运行」→ `run` 取 `job_id`/`run_id` → 轮询 `getRun` → 把每节点 `succeeded/failed/skipped/reused` + 耗时 + reason code 染色到 GraphCanvas（复用 A1 的边/节点渲染层）。**深度观测跳转 WB10**，避免与之重复。

#### [ ] B2. 运行进度近实时（Project 事件流）· P2
- 现状：B1 用轮询。
- 后端就绪度：⚠️ `projects.streamEvents`（source=runtime_job）近实时可用；逐节点事件粒度需确认（关系讨论 §5）。
- 价值：长图运行的逐节点进度反馈优于轮询。
- 工作量：中。
- 设计提示：订阅事件流驱动画布染色（与 B1 共用渲染层）；粒度不足时仍以 `getRun` 兜底。

### C. OPS10 衔接（v2+，多为后端依赖）

#### [ ] C1. 版本 promote/rollback + 归档/取消归档 UI · P2
- 现状：编辑器有「设当前版本」+ 硬删除；无归档软下线、无 rollback 语义封装。
- 后端就绪度：✅ `archive`/`unarchive`/`setCurrentVersion` 客户端已就绪（OPS10 §15 明确复用它们）。
- 价值：图变多后需要「下线但留历史」「回滚到旧版本」。
- 工作量：小-中。
- 设计提示：来源选择器按 `status`（active/archived）分组 + 归档/恢复；rollback = 选旧版本 setCurrent（加确认与影响提示）。**归 OPS10，本文仅标衔接点。**

#### [ ] C2. 运行健康监控 / 运行历史 · P2（**依赖后端**）
- 现状：只能按 run_id 查单条；无「列出某图历史运行」。
- 后端就绪度：❌ 缺 list 端点；✅ 但 `node_graph_run.trace` 已带治理摘要（`b8-governance.v1`：失败率 + reason_counts）。
- 价值：回看历史、对比成功率、定位回归。
- 工作量：后端小 + 前端中。
- 设计提示：后端先加 `GET …/:graph_id/runs`（分页 + status 过滤）；过渡期借 operation logs 近似。归 OPS10。

#### [ ] C3. node-level 控制（pause / retry-from-node）· P3（**后端 v2 依赖**）
- 现状：仅 agent job 有 `cancel`；图运行无 pause / 从某节点重试端点（关系讨论 §5 明确）。
- 后端就绪度：❌ 无端点。
- 价值：M1 下「跑到哪个节点 / 从某节点重试」的核心诉求。
- 工作量：大（后端先行）。
- 设计提示：列为后端 v2 依赖；编辑器侧预留节点右键「从此重试」占位。

### D. 北极星：agentic 执行统一为图运行（M1）

> 来自关系讨论：**认同 M1**——一次 agentic 执行收敛为一次 NodeGraph 运行（主回合=system graph、子 agent=`agent.call` 节点、背景 agent=带触发器的计划图运行）。以下是 Studio 落点，均较大、依赖后端，列为 P3。

#### [ ] D1. agent ↔ graph 一等绑定（**后端依赖，待决**）· P3
- 现状：图经 `run` 手动入队，或经 Project Agent Bindings（事件 → `agent.run`）间接触发；无「某 agent/类型默认运行某图」的持久绑定。
- 后端就绪度：⚠️ 触发链路存在，绑定语义未定（关系讨论 §7 待决问题 2）。
- 价值：让编辑好的图真正成为产品运行管线，而非离线编辑物。
- 设计提示：先做 B1「手动运行 + 选 session/floor/page 作为输入」；绑定 UI 待后端确认 binding 模型。

#### [ ] D2. AI 改图：临时对话 → patch proposal → Project Inbox 审阅 · P3
- 现状：未实现；临时对话容器（见 `docs/design-graph-temporary-conversation.md`）是其前置。
- 后端就绪度：⚠️ `nodegraph.patch.submit_proposal` 写审计并关联 Project Inbox 记录已存在；缺前端「描述意图 → 看 patch → 确认应用」审阅 UI。
- 价值：闭合「面对一堆节点不知从哪下手 → 让 AI 帮你改」的产品愿景。
- 工作量：大（跨临时对话 + 提案 + Inbox + 图应用）。
- 设计提示：依赖 A3（agent.call 配置）、B1（运行闭环）、临时对话对接先落地，再单开设计。

---

## 4. 建议落地顺序

```text
里程碑 1（跟上 NG2 + 接 Agent，编辑现场闭环）
─────────────────────────────────────────────
A3 agent.call 结构化配置 (P1)        ← 后端已就绪，体验黑洞，先补
A4 图策略 & 预算编辑器 (P1)          ← 与 A3 联动（介质需 policy）
B1 运行此图 + 节点状态叠加 (P1)      ← run/getRun 已就绪，编辑现场闭环
A8 服务端校验对接 (P2)               ← 客户端已就绪，低成本

里程碑 2（编辑器现代化 + v2 语义）
─────────────────────────────────────────────
A1 控制流编辑 (P0*)                  ← *优先级高，但须等 NG2-CORE 合同冻结
A2 scope/checkpointPolicy 编辑 (P1)  ← 随 A1 一起上 v2
A5 节点面板升级 (P1)
A6 undo/redo & 多选 & 复制粘贴 (P1)
A7 版本 diff (P2)

里程碑 3（OPS10 / 北极星衔接）
─────────────────────────────────────────────
C1 版本 promote/rollback + 归档 (P2)  ← OPS10
B2 运行进度事件流 (P2)
A9 画布增强 (P3)
C2 运行历史 (P2, 后端先行) / C3 node 控制 (P3, 后端 v2)
D1 agent↔graph 绑定 / D2 AI 改图 (P3, 北极星)
```

排序理由：
- **A3 + A4 + B1 先行**：后端**已完全就绪**（差 UI），补完即让「图接 Agent + 就地运行」在编辑现场闭环，收益最大且无外部依赖。
- **A1 控制流虽优先级最高，但被 NG2-CORE 排期约束**——core 合同未冻结前接 UI 会返工，故放里程碑 2 且与 NG2-CORE 对齐。
- **C/D 多为后端依赖或大工程**，靠后并标清依赖。

---

## 5. 后端依赖清单（需后端先动）

- [ ] **运行历史 list 端点**：`GET /projects/:id/node-graphs/:graph_id/runs`（分页 + status）。支撑 C2。
- [ ] **node-level 运行控制**：pause / retry-from-node 端点（关系讨论 §5/§7）。支撑 C3。
- [ ] **agent ↔ graph 一等绑定语义**（待决）：是否引入「某 agent/类型默认运行某图」。支撑 D1。
- [ ] **图运行逐节点事件粒度**（确认/补齐）：让 B2 事件流染色到节点级。
- [ ] **（随 NG2-CORE）** control edge / schemaVersion 2 / scope / checkpointPolicy 的 core 合同冻结：A1/A2 的前置。
- [ ] **（可选）UI 临时对话项目级导出目标**（`project_inbox`/`derived_output`）：服务 D2 与图助手沉淀（见临时对话设计 §11）。

---

## 6. 附录

### 6.1 与既有设计的关系矩阵

| 本文条目 | 与既有批次的关系 | 引用 |
| ---- | ---- | ---- |
| A1/A2 | **跟随** NG2-CORE（core 在建，编辑器暴露不在其范围） | nodegraph-v2-core-ng2-core-design |
| A3 | **新增**（B10 v1 不重做 Graph 编辑器） | agent-runtime-r5-nodegraph-runtime-design |
| A4/A5/A6/A7/A9 | **新增**（编辑器深度，B10 真空） | — |
| A8 | **接线**（客户端已就绪未接 UI） | — |
| B1/B2 | **衔接 WB10 / M1**（编辑现场，不重复运行台） | wb10-agent-nodegraph-relationship-discussion |
| C1/C2/C3 | **归 OPS10（v2+）/ 后端依赖** | B10 v1 §15 |
| D1/D2 | **北极星 M1 / 后端依赖** | wb10-agent-nodegraph-relationship-discussion |

### 6.2 端点对接矩阵（NodeGraph 第一方客户端）

| 能力 | 端点 | 客户端 | 编辑器 UI |
| ---- | ---- | ---- | ---- |
| 列表/详情/建图/版本/设当前/删除 | … | ✅ | ✅ |
| 导出/导入/预检 | … | ✅ | ✅（PKG10） |
| 单节点预览 | `…/preview` | ✅ | ✅（NodeInspector） |
| **运行** | `…/run` | ✅ | ❌ → **B1** |
| **查运行** | `…/node-graph-runs/:id` | ✅ | ❌ → **B1**（深度归 WB10） |
| **服务端校验** | `…/validate` | ✅ | ❌（仅本地）→ **A8** |
| **归档/取消归档** | `…/archive`·`…/unarchive` | ✅ | ❌ → **C1（OPS10）** |
| 运行历史 list | （缺端点） | ❌ | ❌ → **C2 / §5** |
| node-level 控制 | （缺端点） | ❌ | ❌ → **C3 / §5** |

> 注：`run`/`getRun`/`archive`/`unarchive`/`validate` 客户端 v0 已就绪（见 B10 v1 §设计依据），缺的是编辑器 UI 入口与 OPS10/WB10 的分工落地。
