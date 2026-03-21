---
outline: [2, 3]
---

# Worldbooks（世界书管理）

管理通过 [导入接口](./imports#导入-worldbook) 导入的 SillyTavern 世界书。

世界书包含一组关键词触发的条目（entries），用于在对话中注入背景设定。

## 列出 Worldbooks

```http
GET /worldbooks
```

### 响应 `200`

```json
{
  "data": [
    {
      "id": "wb_kingdom",
      "name": "Kingdom Lore",
      "source": "sillytavern",
      "created_at": 1735689600000,
      "updated_at": 1735689660000
    }
  ]
}
```

## 获取 Worldbook 详情

```http
GET /worldbooks/:id
```

返回完整的世界书数据。

### 响应 `200`

```json
{
  "data": {
    "id": "wb_kingdom",
    "name": "Kingdom Lore",
    "source": "sillytavern",
    "data": {
      "entries": [
        {
          "keys": ["kingdom"],
          "content": "The kingdom is recovering from a long war."
        }
      ]
    },
    "created_at": 1735689600000,
    "updated_at": 1735689660000
  }
}
```

### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `404` | 世界书不存在 |

## 更新 Worldbook

```http
PUT /worldbooks/:id
```

支持乐观锁：传入 `expected_updated_at`，如果数据库中的 `updated_at` 不匹配则返回 `409`。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `name` | string | **是** | 名称（至少 1 字符） |
| `data` | object | **是** | 世界书 JSON 数据 |
| `expected_updated_at` | integer | 否 | 乐观锁 |

### 请求示例

```json
{
  "name": "Kingdom Lore v2",
  "data": {
    "entries": [
      {
        "keys": ["kingdom", "realm"],
        "content": "The kingdom has entered a new era of peace."
      }
    ]
  },
  "expected_updated_at": 1735689660000
}
```

### 响应 `200`

```json
{
  "data": {
    "id": "wb_kingdom",
    "name": "Kingdom Lore v2",
    "source": "sillytavern",
    "created_at": 1735689600000,
    "updated_at": 1735690000000
  }
}
```

### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `400` | 请求体校验失败 |
| `404` | 世界书不存在 |
| `409` | 乐观锁冲突 |

## 删除 Worldbook

```http
DELETE /worldbooks/:id
```

### 响应 `204`

无响应体。