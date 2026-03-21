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

## 删除 Regex Profile

```http
DELETE /regex-profiles/:id
```

### 响应 `204`

无响应体。