---
outline: [2, 3]
---

# Regex Profiles（正则配置管理）

正则配置是一组正则替换规则。聊天时，在消息发出去之前和模型回复回来之后，这些规则会自动对文本执行一次批量替换。

正则配置通常从 SillyTavern 导入。

## 什么时候需要看这页

- 你要查看导入进来的正则配置列表
- 你要查看某个正则配置的规则内容
- 你要编辑或删除正则配置

## 一个简单例子

```bash
# 列出所有正则配置
curl http://localhost:3000/regex-profiles

# 查看某个正则配置的详情
curl http://localhost:3000/regex-profiles/regex_001
```

## 先理解几个词

| 词 | 这里的意思 |
| ---- | ---- |
| placement | 规则生效的位置，例如 user_input（用户输入）或 ai_output（模型输出） |
| 正则脚本 | 一条正则替换规则，由查找模式和替换文本组成 |



每个 Regex Profile 包含一组正则脚本，可用于 `user_input`、`ai_output`、`world_info` 等不同 placement。当前后端会保留这些 placement 的原始兼容字段，但只有已正式进入运行时 contract 的 placement 才会真实执行。

## 列出 Regex Profiles

```http
GET /regex-profiles
```

### 响应 `200`

```json
{
  "data": [
    {
      "id": "regex_safe",
      "name": "Safety Filters",
      "source": "sillytavern",
      "created_at": 1735689600000,
      "updated_at": 1735689660000,
      "version": 2
    }
  ]
}
```

## 获取 Regex Profile 详情

```http
GET /regex-profiles/:id
```

返回完整的正则规则数据。

### 响应 `200`

```json
{
  "data": {
    "id": "regex_safe",
    "name": "Safety Filters",
    "source": "sillytavern",
    "data": [
      {
        "id": "trim_whitespace",
        "scriptName": "trim_whitespace",
        "findRegex": "/\\s+$/g",
        "replaceString": "",
        "trimStrings": [],
        "placement": [2],
        "disabled": false,
        "markdownOnly": false,
        "promptOnly": false,
        "runOnEdit": false,
        "substituteRegex": 0,
        "minDepth": 0,
        "maxDepth": 0
      }
    ],
    "created_at": 1735689600000,
    "updated_at": 1735689660000,
    "version": 2
  }
}
```

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `404` | `not_found` | 正则配置不存在 |

## 更新 Regex Profile

```http
PUT /regex-profiles/:id
```

整体更新正则配置的名称和规则数据。请求中需提供完整的 `name` 和 `data` 数组。系统会对 `data` 中的正则脚本进行校验。

此接口要求提供并发控制字段：

- 新接入应优先传 `expected_version`
- 现有主资源 `PUT` 路由仍兼容 `expected_updated_at`
- 如果两者都不传，会返回 `400`

### 路径参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | Regex Profile ID |

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `name` | string | **是** | 规则集名称 |
| `data` | object[] | **是** | SillyTavern 正则规则数组 |
| `expected_version` | integer | 否 | 推荐的乐观锁字段；期望的 `version` 值 |
| `expected_updated_at` | integer | 否 | 兼容字段；仅用于已有主资源 `PUT` 调用方 |

`data` 中每条规则当前会按原始兼容格式保存。常见 `placement` 值包括：

- `0`：`markdown display`
- `1`：`user_input`
- `2`：`ai_output`
- `3`：`slash_command`
- `5`：`world_info`
- `6`：`reasoning`

当前后端正式执行的主链 placement 以 `USER_INPUT`、`AI_OUTPUT` 为主。`WORLD_INFO`（`5`）当前会保留导入与存储，但不会在生成主链中执行；其余 placement 也会保留，但不保证当前版本实际执行。

### 请求示例

```json
{
  "name": "Updated Filters",
  "expected_version": 2,
  "data": [
    {
      "scriptName": "trim_whitespace",
      "findRegex": "/\\s+$/g",
      "replaceString": "",
      "trimStrings": [],
      "placement": [2],
      "disabled": false,
      "markdownOnly": false,
      "promptOnly": false,
      "runOnEdit": false
    }
  ]
}
```

运行时说明：

- `USER_INPUT` 会区分持久化阶段与 prompt 阶段：持久化入口使用 `channel="persist"`，prompt 入口使用 `channel="prompt"`。
- `AI_OUTPUT` 会在持久化输出阶段按 `channel="persist"` 执行。
- `runOnEdit` 现有业务入口仍会在 `edit-and-regenerate` 时按 `channel="edit"` 应用 `USER_INPUT` 正则，但它不属于当前正式 prompt-runtime phase contract 的主集合。
- `minDepth` / `maxDepth` 现在会进入 `USER_INPUT` 与 `AI_OUTPUT` 的运行时过滤。
- `promptOnly` / `markdownOnly` / `runOnEdit` / depth 字段都会按当前执行通道共同参与门控，而不再只是保留导入。
- `WORLD_INFO` 当前仅作为保留的兼容 placement 存在，不会被静默当作已执行能力对外承诺。

### 响应 `200`

```json
{
  "data": {
    "id": "regex_safe",
    "name": "Updated Filters",
    "source": "sillytavern",
    "created_at": 1735689600000,
    "updated_at": 1735689700000,
    "version": 3
  }
}
```

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` / `regex_validation_error` | 请求体校验失败、正则脚本解析出错，或未提供 `expected_version` / `expected_updated_at` |
| `404` | `regex_profile_not_found` | 正则配置不存在 |
| `409` | `regex_profile_conflict` | 版本基线过期，或兼容字段 `expected_updated_at` 不匹配 |
| `503` | `resource_busy` | 资源写入暂时繁忙，请稍后重试 |

## 删除 Regex Profile

```http
DELETE /regex-profiles/:id
```

删除时推荐通过 query string 传入 `expected_version`，例如：

```http
DELETE /regex-profiles/:id?expected_version=3
```

### 查询参数

| 参数 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `expected_version` | integer | 否 | 推荐的乐观锁字段；提供后按 `version` 基线删除，不匹配时返回 `409` |

### 响应 `204`

无响应体。

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `404` | `regex_profile_not_found` | 正则配置不存在 |
| `409` | `regex_profile_conflict` | 删除时提供的 `expected_version` 过期 |
| `503` | `resource_busy` | 资源写入暂时繁忙，请稍后重试 |
