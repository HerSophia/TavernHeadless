---
outline: [2, 3]
---

# Skill 索引

`/agent/skills/` 用来存放面向任务的开发指导。

它和 `/agent/*.json` 的分工不同：

- `/agent/*.json` 负责发布更新事实
- `/agent/skills/*` 负责给出接入、升级和验证的做法

## Skill 是什么

Skill 不是新的参考文档。

Skill 的作用是把已经公开的事实整理成一套稳定工作流，帮助开发者和 Agent 回答下面这些问题：

- 这类场景应该优先用什么公开包
- 看到 manifest 之后应该先看什么
- 本地应该怎样安排验证顺序
- 哪些路径属于推荐做法，哪些只是临时绕行

## Skill 与 Agent 的关系

建议把 Skill 和 Agent 一起使用。

推荐顺序如下：

1. 先读取 `/agent/latest.json`
2. 再读取对应 manifest
3. 再根据场景选择合适的 Skill
4. 最后执行本地验证

这样可以减少两类问题：

- 只看更新事实，但不知道怎么处理
- 只看操作建议，但没有先核对当前事实

## 当前可用 Skill

| Skill | 作用 | 人读页面 | 机器 JSON |
| --- | --- | --- | --- |
| `tavern-client-integration` | 指导客户端接入与升级 | [`/agent/skills/tavern-client-integration/`](/agent/skills/tavern-client-integration) | [`/agent/skills/tavern-client-integration.json`](/agent/skills/tavern-client-integration.json) |
| `tavern-project-contributing` | 指导贡献者参与开发与协作 | [`/agent/skills/tavern-project-contributing/`](/agent/skills/tavern-project-contributing) | [`/agent/skills/tavern-project-contributing.json`](/agent/skills/tavern-project-contributing.json) |

## 机器目录

当前阶段已经提供 Skill 目录：

- [`/agent/skills/catalog.json`](/agent/skills/catalog.json)

目录中会列出：

- Skill 标识
- 标题
- 摘要
- 当前状态
- 人读页面路径
- 机器 JSON 路径

## 使用原则

Skill 应遵守下面这些原则：

1. 面向任务，而不是堆积资料
2. 说明边界，而不是复制全部协议细节
3. 尽量引用现有文档，而不是重复维护一份实现说明
4. 与 `/agent` 协同，而不是脱离 manifest 单独存在

## 相关入口

- [Agent 与 Skill 总入口](/agent/)
- [官方集成层](/guide/integration-kit)
- [协作指南](/development/contributing)
- [SDK 总览](/sdk/)
- [API 参考](/reference/api)
