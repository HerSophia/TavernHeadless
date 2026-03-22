---
outline: [2, 3]
---

# Regex Profiles（正则配置管理）

管理通过 [导入接口](./imports#导入-regex-规则) 导入的 SillyTavern 正则替换规则集。

每个 Regex Profile 包含一组正则替换脚本，用于在对话生成时对输出文本进行后处理。

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
      "updated_at": 1735689660000
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
        "scriptName": "trim_whitespace",
        "find": "\\s+$",
        "replace": ""
      }
    ],
    "created_at": 1735689600000,
    "updated_at": 1735689660000
  }
}
```

### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `404` | 正则配置不存在 |

## 更新 Regex Profile

```http
PUT /regex-profiles/:id
```

整体更新正则配置的名称和规则数据。请求中需提供完整的 `name` 和 `data` 数组。系统会对 `data` 中的正则脚本进行校验。

支持 `expected_updated_at` 乐观锁：如果传入该字段且与服务端当前值不一致，返回 `409`。

### 路径参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | Regex Profile ID |

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `name` | string | **是** | 规则集名称 |
| `data` | object[] | **是** | SillyTavern 正则规则数组 |
| `expected_updated_at` | integer | 否 | 乐观锁：期望的 `updated_at` 值 |

### 请求示例

```json
{
  "name": "Updated Filters",
  "data": [
    {
      "scriptName": "trim_whitespace",
      "findRegex": "/\\s+$/g",
      "replaceString": "",
      "trimStrings": [],
      "placement": [2],
      "disabled": false
    }
  ]
}
```

### 响应 `200`

```json
{
  "data": {
    "id": "regex_safe",
    "name": "Updated Filters",
    "source": "sillytavern",
    "created_at": 1735689600000,
    "updated_at": 1735689700000
  }
}
```

### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `400` | 请求体校验失败或正则脚本解析出错 |
| `404` | 正则配置不存在 |
| `409` | `expected_updated_at` 与服务端不一致（乐观锁冲突） |

## 删除 Regex Profile

```http
DELETE /regex-profiles/:id
```

### 响应 `204`

无响应体。
