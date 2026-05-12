# 思路

“思路”系列用于记录 TavernHeadless 的设计取舍、后续方向和还没有完全固化为 API 的想法。

它和“参考”不同。参考文档说明已经落地的接口和字段；思路文档说明我们为什么这样设计，以及后面会怎样收束。

## 适合什么时候阅读

- 想理解项目为什么采用 headless 架构。
- 想了解 RP Agentic、Native Prompt mode、NodeGraph 等方向。
- 想判断一个改动应该进入核心引擎、后端、官方 SDK，还是只留在前端。
- 想在实现前先确认设计边界。

## 当前文档

| 文档 | 说明 |
| ---- | ---- |
| [Why TavernHeadless？](/ideas/why-tavernheadless) | 说明项目缘起，它和 SillyTavern 的关系以及解决了什么问题 |
| [Know What & Know How](/ideas/know-what-and-know-how) | 探讨 AI RP 场景下可治理与可审计为什么不是锦上添花，而是必须解决的前提 |
| [好像哪里都是，那就干脆做个通用的。](/ideas/unified-version-control) | 说明为什么回合、资产版本、操作日志和 diff 需要收束到一套通用 VC 思路 |
| [不一定得是一张角色卡](/ideas/not-just-a-character-card) | 说明为什么 TavernHeadless 把客户端项目也视为一种可运行的 AI RP 体验 |
| [边界的规划](/ideas/boundary-planning) | 说明文档和测试如何共同构成项目的边界，防止项目在迭代中失控 |
| [为什么多了一层 Message？](/ideas/why-message-layer) | 说明 TavernHeadless 在酒馆三层模型上增加 Message 层的原因 |
| [为什么多了一种变量？](/ideas/why-branch-variable) | 说明 TavernHeadless 在变量系统中增加分支作用域的原因 |
| [它很小，但它很重要](/ideas/why-worldbook-trace) | 说明为什么世界书命中详情和注入位置的观察面很重要 |
| [因为它很重要，所以它被扩展](/ideas/why-prompt-runtime) | 说明为什么观测能力会从世界书扩展为 Prompt Runtime |
| [可追踪的记忆](/ideas/traceable-memory) | 说明为什么 AI RP 需要能够揭示来源、更新和因果关系的记忆系统 |
| [LLM 实例化？其实是 Sub Agent 的前身](/ideas/llm-instantiation-sub-agent) | 说明 LLM 实例化如何从多模型协作需求，演变为 Sub Agent 的基础 |
| [RP Agentic 与 NodeGraph](/ideas/agentic-nodegraph) | TavernHeadless 后续 Agentic 能力、Native Prompt mode、节点图编排、状态和记忆边界的设计思路 |

## 和其他文档的关系

| 文档区域 | 主要回答的问题 |
| ---- | ---- |
| [指南](/guide/introduction) | 项目是什么，怎样上手，整体架构是什么 |
| [API 参考](/reference/api) | 已经落地的 HTTP 接口怎样调用 |
| [SDK](/sdk/) | 官方接入层怎样使用 |
| [Agent](/agent/) | 面向自动化接入的 Agent 与 Skill 资料 |
| 思路 | 设计方向、边界判断和后续收束方式 |

## 阅读提醒

思路文档不是稳定接口承诺。实现、接口和字段仍以 API 参考、SDK 文档和代码为准。

如果一个思路已经变成稳定行为，它应当同步沉淀到指南、API 参考或 SDK 文档中。
