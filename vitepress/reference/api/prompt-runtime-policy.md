---
outline: [2, 3]
---

# Prompt Runtime Policy（策略面）

这一页只讲 Prompt Runtime 的 policy 控制面。

## 什么时候需要看这页

- 想看 session 级或 branch 级 policy 当前是什么。
- 想修改 `structure`、`delivery`、`budget`、`source_selection`、`visibility`。
- 想确认哪些字段是 session policy、哪些字段是 branch policy overlay。

## 相关接口

- `GET /sessions/:id/prompt-runtime/policy`
- `PATCH /sessions/:id/prompt-runtime/policy`
- `GET /sessions/:id/prompt-runtime/branches/:branchId/policy`
- `PATCH /sessions/:id/prompt-runtime/branches/:branchId/policy`

## 这页最重要的边界

- `prompt_mode` **不属于** policy。
- policy 持久化对象只覆盖：
  - `structure`
  - `delivery`
  - `budget`
  - `source_selection`
  - `visibility`
- 不提供 `PATCH /sessions/:id/prompt-runtime`。
- 不提供 branch mode 路由。

## Session Policy 和 Branch Policy 的区别

| 面 | 作用域 | 说明 |
| ---- | ---- | ---- |
| session policy | 整个会话 | 作为默认 Prompt Runtime policy |
| branch policy | 某条已物化分支 | 只对该 branch 的 policy overlay 生效 |

## PATCH 语义

这四个 policy 接口都沿用当前的对象 PATCH 语义：

- 传对象：只改你给出的字段
- 传 `null`：清空这一节持久化 policy
- 未出现的字段：保持原值

## 示例：清空 branch delivery policy

```json
{
  "delivery": null
}
```

## 示例：只改 session budget

```json
{
  "budget": {
    "max_input_tokens": 4096,
    "reserved_completion_tokens": 1024
  }
}
```

## 相关页面

- mode 控制面：[Prompt Runtime Mode](./prompt-runtime-mode)
- 当前资源绑定：[Prompt Runtime Assets](./prompt-runtime-assets)
- 请求期检查与历史解释：[Prompt Runtime Inspection](./prompt-runtime-inspection)
