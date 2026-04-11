---
outline: [2, 3]
---

# SSE 流

`readSseStream` 解析后端的 Server-Sent Events 响应，通过回调逐步推送事件。

`client.sessions.respondStream()` 内部已调用此函数。在需要自行处理原始 SSE 响应时才需要直接使用。

## readSseStream

```ts
import { readSseStream } from "@tavern/sdk";

const response = await client.fetchRaw("/sessions/s1/respond/stream", {
  method: "POST",
  body: { message: "你好" },
});

const done = await readSseStream(response, {
  onStart(payload) { console.log(payload.floorId); },
  onRun(payload) { console.log(payload.phase, payload.pendingOutput?.text); },
  onChunk(payload) { process.stdout.write(payload.chunk); },
  onTool(payload) { console.log(payload.toolName, payload.phase); },
  onSummary(payload) { console.log(payload.summaries); },
});

console.log(done.floorId, done.generatedText);
```

### 签名

```ts
function readSseStream(
  response: Response,
  callbacks?: RespondStreamCallbacks,
): Promise<TavernRespondDonePayload>
```

非 2xx 响应抛出 [`TavernApiError`](/sdk/errors)。流中收到 `error` 事件时，先触发 `onError` 回调，然后抛出 `TavernApiError`。流结束时未收到 `done` 事件也会抛出错误。

### 参数

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `response` | `Response` | 是 | SSE 响应对象（第一个参数） |
| `callbacks` | [`RespondStreamCallbacks`](#respondstreamcallbacks) | 否 | 事件回调 |

### 返回值 `TavernRespondDonePayload`

流正常结束后返回最终的 `done` 事件 payload。字段见 [TavernRespondDonePayload](#tavernresponddonepayload)。

---

## RespondStreamCallbacks

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `onStart` | `(payload: TavernRespondStartPayload) => void` | 收到 `start` 事件时触发 |
| `onRun` | `(payload: TavernRespondRunPayload) => void` | 收到 `run` 事件时触发 |
| `onChunk` | `(payload: TavernRespondChunkPayload) => void` | 收到 `chunk` 事件时触发 |
| `onTool` | `(payload: TavernRespondToolPayload) => void` | 收到 `tool` 事件时触发 |
| `onSummary` | `(payload: TavernRespondSummaryPayload) => void` | 收到 `summary` 事件时触发 |
| `onError` | `(payload: TavernRespondErrorPayload) => void` | 收到 `error` 事件时触发 |
| `onEvent` | `(event: TavernRespondStreamEvent) => void` | 收到任意已识别事件时触发 |

---

## 事件生命周期

SSE 事件按以下顺序推送：

```text
start → run? → (chunk | tool | run)* → summary? → done
                                                  ↘ error
```

| 阶段 | 事件 | 说明 |
| ---- | ---- | ---- |
| 开始 | `start` | 流开始，返回新楼层的基本信息 |
| 运行快照 | `run` | 返回当前楼层运行阶段、attemptNo 和候选输出快照，可能出现多次 |
| 生成中 | `chunk` | 文本片段，出现零到多次 |
| 工具执行 | `tool` | 工具执行过程事件，按条件出现，可能出现零到多次 |
| 摘要 | `summary` | 记忆摘要，仅在启用记忆整理时出现 |
| 正常结束 | `done` | 流正常结束，返回完整结果与最终提交状态 |
| 异常结束 | `error` | 流异常结束，与 `done` 互斥 |

---

## 事件 payload 类型

### TavernRespondStartPayload

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `floorId` | `string?` | 楼层 ID |
| `floorNo` | `number?` | 楼层序号 |
| `branchId` | `string?` | 分支 ID |

### TavernRespondChunkPayload

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `chunk` | `string` | 文本片段 |

### TavernRespondSummaryPayload

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `summaries` | `string[]` | 摘要列表 |

### TavernRespondToolPayload

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `executionId` | `string` | 工具执行 ID |
| `toolName` | `string` | 工具名 |
| `providerId` | `string` | provider ID |
| `providerType` | `"builtin" \| "preset" \| "mcp" \| "unknown"?` | provider 类型 |
| `sideEffectLevel` | `"none" \| "sandbox" \| "irreversible"?` | 副作用级别 |
| `phase` | `"start" \| "success" \| "error" \| "denied" \| "timeout" \| "uncertain" \| "blocked"` | 工具执行阶段 |
| `message` | `string?` | provider 返回的附加说明 |
| `durationMs` | `number?` | 执行耗时 |
| `replaySafety` | `"safe" \| "confirm_on_replay" \| "never_auto_replay" \| "uncertain"` | 回放安全级别 |

### TavernRespondRunPayload

`run` 事件表示一次楼层运行的当前快照。它至少包含：

- `floorId`
- `runId`
- `runType`
- `status`
- `phase` / `publicPhase`
- `attemptNo`
- `pendingOutput`

如果前端需要恢复候选输出，应优先使用 `pendingOutput.text`，而不是只依赖本地拼接 chunk。

### TavernRespondErrorPayload

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `code` | `string?` | 错误码 |
| `message` | `string?` | 错误信息 |

### TavernRespondDonePayload

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `branchId` | `string?` | 分支 ID |
| `finalState` | `"draft" \| "generating" \| "committed" \| "failed"` | 最终楼层状态 |
| `floorId` | `string` | 楼层 ID |
| `floorNo` | `number` | 楼层序号 |
| `generatedText` | `string?` | 生成的完整文本 |
| `summaries` | `string[]` | 最终摘要列表 |
| `totalUsage` | [`ApiUsage`](#apiusage) | token 用量 |
| `promptSnapshot` | `PromptSnapshotPreview?` | 只有在请求显式打开 `debugOptions.includePromptSnapshot` 时才返回 |
| `runtimeTrace` | `PromptRuntimeTrace?` | 只有在请求显式打开 `debugOptions.includeRuntimeTrace` 时才返回 |

`finalState === "committed"` 表示 assistant message、usage 和其他提交边界内的数据已经完成持久化。

这两个调试字段只会出现在 `done` payload 中。

如果本轮 prompt 组装命中了宏系统，`runtimeTrace.macro` 会附带宏 warning、used names、mutation preview、staged mutations 和 trace。

本版不会新增新的 SSE 事件类型。

### TavernRespondStreamEvent

联合类型，每个成员包含 `type` 和 `payload` 两个字段：

```ts
type TavernRespondStreamEvent =
  | { type: "start"; payload: TavernRespondStartPayload }
  | { type: "run"; payload: TavernRespondRunPayload }
  | { type: "chunk"; payload: TavernRespondChunkPayload }
  | { type: "tool"; payload: TavernRespondToolPayload }
  | { type: "summary"; payload: TavernRespondSummaryPayload }
  | { type: "error"; payload: TavernRespondErrorPayload }
  | { type: "done"; payload: TavernRespondDonePayload };
```

---

## ApiUsage

token 用量信息。不同 LLM 提供商返回的字段不一致，所有字段均为可选。

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `inputTokens` | `number?` | 输入 token 数 |
| `outputTokens` | `number?` | 输出 token 数 |
| `totalTokens` | `number?` | 总 token 数 |
| `promptTokens` | `number?` | 提示 token 数（部分提供商使用此字段替代 `inputTokens`） |
| `completionTokens` | `number?` | 补全 token 数（部分提供商使用此字段替代 `outputTokens`） |
