---
outline: [2, 3]
---

# Accounts（账号）

账号是资源隔离的顶层实体。单账号模式（`ACCOUNT_MODE=single`）下，系统自动创建默认账号。多账号模式下，可通过 API 创建和管理多个账号。

## Account 对象

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 账号 ID |
| `name` | string | 账号名称 |
| `role` | string | 角色：`admin` / `user` |
| `status` | string | 状态：`active` / `suspended` |
| `is_default` | boolean | 是否为默认账号 |
| `created_at` | integer | 创建时间 |
| `updated_at` | integer | 更新时间 |

## 列出账号

```http
GET /accounts
```

### 响应 `200`

```json
{
  "data": [
    {
      "id": "acc_demo",
      "name": "Demo Workspace",
      "role": "user",
      "status": "active",
      "is_default": false,
      "created_at": 1735689600000,
      "updated_at": 1735689600000
    }
  ]
}
```

## 创建账号

```http
POST /accounts
```

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `id` | string | **是** | 账号 ID，1-64 字符 |
| `name` | string | **是** | 账号名称，1-200 字符 |
| `role` | string | 否 | 角色（默认 `user`） |

### 响应 `201`

返回 `{ "data": Account }` 。

### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `403` | 权限不足 |
| `409` | ID 已存在 |