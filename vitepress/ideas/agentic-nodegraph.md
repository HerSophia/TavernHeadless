---
outline: [2, 3]
---

# RP Agentic 与 NodeGraph 思路

> 本文记录 TavernHeadless 在 RP Agentic、Native Prompt mode、NodeGraph、
> Sub Agent、工具调用、状态与记忆方面的设计思路。
> 它不是稳定 API 承诺。

## 总体定位

TavernHeadless 的 Agentic 不应当被设计成通用任务执行器。它首先服务于 AI 角色扮演场景。

它要解决的问题不是“给定任务、拆解步骤、调用工具、交付结果”。它更关注下面这些事情：

- 维持沉浸感。
- 保持角色一致。
- 尊重玩家主导权。
- 推进叙事节奏。
- 维护状态与记忆。
- 让 Prompt 组装过程可解释、可回放。

因此，Agentic 能力应主要进入 Native Prompt mode 或后续的 native graph 形态。严格兼容 SillyTavern 的链路不应被它改变。

## 与兼容模式的边界

| 模式 | 定位 | Agentic 边界 |
| ---- | ---- | ---- |
| `compat_strict` | 严格复刻 SillyTavern 行为 | 不启用会改变输出语义的 Agentic 能力 |
| `compat_plus` | 在兼容基础上提供轻量增强 | 可以注入记忆、提示世界书命中、给出轻量检查，但不能改变核心拼接语义 |
| `native_prompt` | TavernHeadless 原生提示词模式 | 可以引入节点化编排、结构化中间产物和更明确的运行轨迹 |
| `native_graph` | 后续图编排形态 | 可以正式承载 RP Agentic、Sub Agent、状态提案和检查节点 |

这条边界很重要。兼容模式负责保存已有资产的行为预期；原生模式负责承载新的编排能力。

## RP Agentic 和 Coding Agentic 的差异

Coding Agent 常见目标是完成外部任务，例如修改文件、运行测试、修复错误。

RP Agentic 的目标不同。它要让一场 RP 继续成立：

- 故事连续。
- 角色一致。
- 玩家不被代替。
- 节奏不过度跳跃。
- 世界状态不自相矛盾。
- 记忆和事实可以回溯。

所以 RP Agentic 的自主性需要被限制。它可以解释场景、整理素材、提出状态写入建议，也可以检查连续性。但是它不能替玩家决定行动，也不能绕过提交门直接改写正史。

## Agent 分工模型

TavernHeadless 已经有 Narrator、Memory、Director、Verifier 等多实例槽位的基础。后续可以把这些槽位收束为 RP 语义下的舞台职能。

### Narrator

Narrator 是唯一允许产出最终 RP 正文的实例。

它消费角色卡、世界书、记忆、状态投影、Director 提示和节点图编排结果，然后生成用户最终看到的回复。

它不应负责大范围工具调用，也不应直接决定长期状态写入。

### Director

Director 不是任务规划器，而是导演组。

它输出结构化的叙事意图，例如当前场景节奏、允许推进的方向、禁止触碰的边界和本回合重点。

Director 的输出应短、明确、可被 Prompt 组合节点消费。

### Memory Agent

Memory Agent 维护叙事事实，不参与正文创作。

它负责检索相关记忆、提出新增或更新事实的建议、标记冲突，并把结果交给后续节点处理。

### State Agent 和 Commit Gate

State Agent 可以提出 Session State 的写入建议。

Commit Gate 负责审核这些建议是否可以进入受治理状态。这样可以避免后台 Agent 绕过规则直接改写世界状态。

### Verifier

Verifier 负责检查输出是否破坏角色、人设、世界事实、玩家主导权或安全边界。

Verifier 不应成为第二个创作者。它的职责是检查和给出处理建议。

## NodeGraph 的位置

NodeGraph 不应被 Agent 取代。它是可解释的编排层。

Agent 可以作为某些节点里的执行者，但节点图本身负责表达顺序、依赖、输入输出、失败策略和 trace。

一个合理的链路可以是：

```text
读取上下文
→ 检索资产
→ 投影状态
→ 运行 Director
→ 运行 Memory Agent
→ 聚合中间产物
→ 组装 Prompt
→ Narrator 生成正文
→ Verifier 检查
→ 生成状态写入提案
→ Commit Gate 审核
→ 提交楼层与消息页
```

这样做的好处是每一步都有位置，也能解释一条回复是怎样生成的。

## Floor、MessagePage 和重试

TavernHeadless 的会话结构天然适合承载 Agentic 运行轨迹。

- Floor 表示一次回合的主记录。
- MessagePage 表示同一楼层下的候选回复页。
- 重试可以生成新的 MessagePage，而不必覆盖旧结果。
- 节点图 trace 可以挂在 run 或 page 相关记录上。

这样可以保留失败现场、比较多次生成结果，也可以把不同策略的输出留在同一楼层下。

## 工具调用与 MCP

工具调用和 MCP 应当服务于 RP 语义，而不是让 Agent 任意行动。

工具能力需要遵守三个原则：

1. 权限先于调用。
2. 工具结果只进入受控上下文。
3. 影响正史的写入必须经过明确提交。

例如，检索资料、查询状态、读取外部资源可以作为辅助工具。但会改变世界状态、会话事实或用户资产的动作，应当经过更严格的权限与提交流程。

## Session State、Variables、Memory 和 Client Data

这几类数据的边界需要保持清楚。

| 数据域 | 适合承载什么 | 不适合承载什么 |
| ---- | ---- | ---- |
| Session State | 受治理、可审核、影响叙事正史的状态 | 临时 UI 状态 |
| Variables | 轻量变量、模板值、局部上下文 | 复杂状态机和长期事实治理 |
| Memory | 长期事实、摘要、角色和世界认知 | 每回合的临时计算结果 |
| Client Data | 前端或第三方客户端自己的显示与偏好数据 | 核心引擎必须理解的正史状态 |

Agentic 能力越强，这些边界越重要。否则状态会被分散到多个地方，后续很难解释和回放。

## 推荐落地路线

### Phase 1：DAG Core

先建立最小可用的节点图执行核心。

重点是节点定义、输入输出、依赖关系、错误传播、trace 和 dry-run。

### Phase 2：Native Prompt mode 图形化

把现有原生提示词链路逐步映射成节点。

这个阶段不急着增加强 Agentic，而是先让 Prompt 组装过程可解释。

### Phase 3：Editor

提供可视化编辑、导入导出、缺失节点检测和版本兼容策略。

这一阶段要保证用户能理解图，而不是只看到一堆内部配置。

### Phase 4：Agentic Runtime

在节点图稳定后，再引入 Director、Memory Agent、State Agent、Verifier 等节点。

这些节点应围绕 RP 场景设计，而不是复用通用任务 Agent 的默认假设。

### Phase 5：Ecosystem

最后再考虑第三方节点、节点包、MCP 能力声明、图模板和共享生态。

生态层应该建立在稳定的运行时、权限和导入导出格式之上。

## 效果判断标准

RP Agentic 是否有效，不应只看“能不能完成任务”。更应关注下面的指标：

- 玩家是否仍然掌握自己角色的行动权。
- 输出是否更稳定地保持人设和世界观。
- 长期记忆是否更准确。
- 状态写入是否更可解释。
- 重试和分支是否更容易比较。
- Prompt 组装过程是否更容易排查。

如果 Agentic 让后台系统变得难以解释，或者让玩家主导权下降，就应当回退或收窄能力。

## 核心原则

1. 只有 Narrator 写最终正文。
2. 其他 Agent 提供素材、约束、检查或状态提案。
3. NodeGraph 负责可解释编排，不把运行顺序藏进 Agent 内部。
4. 兼容模式不被原生 Agentic 语义污染。
5. 影响正史的状态写入必须经过提交门。
6. 工具调用必须有权限、记录和边界。
7. 设计先服务 RP 体验，再服务自动化能力。
