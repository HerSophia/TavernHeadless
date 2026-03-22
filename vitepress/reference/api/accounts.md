---
outline: [2, 3]
---

# Accounts（账号）

账号是资源隔离的顶层实体。单账号模式（`ACCOUNT_MODE=single`）下，系统自动创建默认账号。多账号模式下，可通过 API 创建和管理多个账号。

所有账号端点仅限 `admin` 角色访问，非 admin 请求返回 `403`。

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
| `id` | string | 否 | 账号 ID，1-120 字符（不传则自动生成） |
| `name` | string | **是** | 账号名称，1-120 字符 |
| `role` | string | 否 | 角色（默认 `user`） |

### 响应 `201`

返回 `{ "data": Account }` 。

### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `403` | 权限不足 |
| `409` | ID 已存在 |

## 获取账号详情

```http
GET /accounts/:id
```

### 路径参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 账号 ID |

### 响应 `200`

```json
{
  "data": {
    "id": "acc_demo",
    "name": "Demo Workspace",
    "role": "user",
    "status": "active",
    "is_default": false,
    "created_at": 1735689600000,
    "updated_at": 1735689600000
  }
}
```

### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `403` | 权限不足 |
| `404` | 账号不存在 |

## 更新账号

```http
PATCH /accounts/:id
```

至少提供一个字段。默认账号（`is_default: true`）不允许修改 `role` 和 `status`。

### 路径参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 账号 ID |

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `name` | string | 否 | 账号名称，1-120 字符 |
| `role` | string | 否 | 角色：`admin` / `user` |
| `status` | string | 否 | 状态：`active` / `disabled` |

### 请求示例

```json
{
  "name": "Updated Workspace",
  "role": "admin"
}
```

### 响应 `200`

返回 `{ "data": Account }` ，包含更新后的完整账号对象。

### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `400` | 请求体为空或校验失败 |
| `403` | 权限不足 |
| `404` | 账号不存在 |
| `409` | 默认账号不允许修改 role/status |

## 删除账号

```http
DELETE /accounts/:id
```

硬删除。默认账号不允许删除。如果账号下仍有关联资源（用户、会话等），删除会因外键约束失败并返回 `409`。

### 路径参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 账号 ID |

### 响应 `200`

```json
{
  "data": {
    "id": "acc_demo",
    "deleted": true
  }
}
```

### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `403` | 权限不足 |
| `404` | 账号不存在 |
| `409` | 默认账号不允许删除，或账号下仍有关联资源 |
