---
outline: [2, 3]
---

# Effective Config（生效配置视图）

## 什么时候需要看这页

- 你想知道某个 Project 当前最终使用的配置来源。
- 你想知道某个 Session 是否有更高优先级的会话覆盖。
- 你要做调试页面，只读展示最终配置。

## 一个简单例子

```bash
curl http://localhost:3000/projects/proj_main/effective-config
```

或：

```bash
curl http://localhost:3000/sessions/sess_001/effective-config
```

## 先理解几个词

| 词 | 这里的意思 |
| ---- | ---- |
| source | 这个字段最终来自 `workspace`、`project` 或 `session`。 |
| effective-config | 只读视图，不是写入口。 |

## 接口

### GET /projects/:id/effective-config

读取 Project 生效配置。

#### 响应字段

- `projectId`
- `workspaceId`
- `llmProfile`
- `toolPolicies.overrides`
- `mcp`

### GET /sessions/:id/effective-config

读取 Session 生效配置。

#### 响应字段

在 Project 视图基础上，额外包含：

- `sessionId`
- `sessionOverrides.llmProfile`

## 权限

- Project 视图：`project.config.read`
- Session 视图：先解析 Session 所属 Project，再要求 `project.config.read`

## 当前阶段说明

- 这是只读视图。
- 实际写入仍应走 Project settings 明确接口。
- 阶段五不引入缓存，每次直接读取数据库。
- 当前 Session 视图保留 `sessionOverrides.llmProfile` 位置，但默认可能为 `null`。
