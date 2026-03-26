---
outline: [2, 3]
---

# 错误处理

SDK 在收到非 2xx HTTP 响应时自动抛出 `TavernApiError`。`fetchRaw` 除外，因为它直接返回原始 `Response`。

## TavernApiError

```ts
import { TavernApiError } from "@tavern/sdk";

try {
  await client.sessions.getDetail({ sessionId: "not-exist" });
} catch (err) {
  if (err instanceof TavernApiError) {
    console.log(err.status, err.code, err.message);
  }
}
```

### 字段

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `status` | `number` | HTTP 状态码 |
| `message` | `string` | 错误信息 |
| `code` | `string?` | 错误码（后端返回的 `error.code` 字段） |
| `details` | `unknown?` | 错误详情（后端返回的 `error.details` 字段） |
| `requestId` | `string?` | 请求 ID（取自响应头 `x-request-id`） |

`TavernApiError` 继承自 `Error`，`name` 固定为 `"TavernApiError"`。

### 错误来源

`TavernApiError` 在以下场景抛出：

| 场景 | 触发条件 |
| ---- | ---- |
| 资源方法（`client.sessions.list()` 等） | HTTP 响应状态码非 2xx |
| `fetchJson` | HTTP 响应状态码非 2xx |
| `readSseStream` | 响应状态码非 2xx，或流中收到 `error` 事件 |

错误信息的解析优先级：响应体 `error.message` → 响应体 `message` → 默认文本 `"Request failed with status {status}"`。

### 一致性边界相关错误码

SDK transport 层不会吞掉后端 `error.code`。当前对话主链路里常见的几类业务码如下：

| `code` | 常见状态码 | 说明 |
| ---- | ---- | ---- |
| `generation_conflict` | `409` | 同一 `sessionId + branchId` 已有生成占用执行权 |
| `commit_conflict` | `409` | 提交边界在最终 CAS 时遇到状态冲突 |
| `turn_commit_failed` | `500` | 生成阶段成功，但提交边界失败 |

如果同时使用 `@tavern/client-helpers`，`mapApiErrorToUiState()` 会优先对这三类错误做默认的 code-aware 映射。原始 `code` 仍会保留在返回结果中。

---

## isTavernApiError

类型守卫函数。

```ts
import { isTavernApiError } from "@tavern/sdk";

if (isTavernApiError(err)) {
  // err 类型收窄为 TavernApiError
  console.log(err.status);
}
```

### 签名

```ts
function isTavernApiError(error: unknown): error is TavernApiError
```

等价于 `error instanceof TavernApiError`。
