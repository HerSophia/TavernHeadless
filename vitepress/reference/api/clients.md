---
outline: [2, 3]
---

# Clients（客户端身份）

Client 表示同一个账号下不同的程序调用入口（UI、脚本、下游服务等）。
Client 与账号是两个不同的概念，权限和审计都按 Client 单独记账。

这组接口只对账号身份开放，Client 身份不能调用 Client 管理接口。

## 什么时候需要看这页

- 你要在同一个账号下区分不同的程序调用入口。
- 你要签发或吊销 Client API Key。
- 你要查看账号下的全部 Client 或修改 Client 元数据。

## 一个简单例子

```bash
# 创建一个 deriver 类型的 Client
curl -X POST http://localhost:3000/clients \
  -H 'Content-Type: application/json' \
  -H 'x-api-key: 你的账号API Key' \
  -d '{"name": "world-simulator", "kind": "deriver"}'

# 为该 Client 签发一把 API Key（响应里包含一次性 secret）
curl -X POST http://localhost:3000/clients/cli_xxx/api-keys \
  -H 'Content-Type: application/json' \
  -H 'x-api-key: 你的账号 API Key' \
  -d '{"name": "production"}'
```

创建接口返回的响应里包含 `secret` 字段，明文 secret 只在创建时返回这一次。
之后再调用列表、详情、吊销接口都不会返回明文 secret。

## 先理解几个词

| 词 | 这里的意思 |
| ---- | ---- |
| Client | 一个具体的程序调用入口，不是账号 |
| 默认 Client | 系统在账号初始化时自动创建的 Client，不会自动签发 API Key |
| Client API Key | 用于以 Client 身份调用 API 的密钥；明文 secret 只在创建时返回一次 |
| `X-Tavern-Client-Key` | 以 Client API Key 调用 API 时使用的请求头 |

## 鉴权

Client API Key 通过下面任意一种方式传入即可：

- `X-Tavern-Client-Key: tvk_live_...`
- `Authorization: Bearer tvk_live_...`

如果同时存在静态 `x-api-key` / JWT Bearer 和 Client API Key，Client API Key 优先生效。

Client API Key 认证失败会统一返回 401 `client_api_key_invalid`，不会区分密钥不存在、已吊销、已过期、Client 被禁用或账号被禁用。

## Client 对象

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | Client ID，`cli_` 前缀加 nanoid |
| `account_id` | string | 所属账号 |
| `name` | string | Client 名称 |
| `kind` | string | `basic` / `advanced` / `deriver` / `worker` / `custom` |
| `status` | string | `active` 或 `disabled` |
| `is_default` | boolean | 是否是该账号的默认 Client |
| `metadata` | any | 自定义元数据，JSON 序列化后不超过 16 KiB |
| `created_at` | integer | 创建时间戳（ms） |
| `updated_at` | integer | 更新时间戳（ms） |

## Client API Key 对象

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | API Key ID |
| `account_id` | string | 所属账号 |
| `client_id` | string | 所属 Client |
| `name` | string \| null | 备注名 |
| `key_prefix` | string | 明文 secret 的前 18 个字符，供识别 |
| `status` | string | `active` 或 `revoked` |
| `last_used_at` | integer \| null | 最近一次成功认证时间戳；最多每 60 秒更新一次 |
| `expires_at` |integer \| null | 过期时间戳；超过这个时间 secret 失效 |
| `created_at` | integer | 创建时间戳 |
| `updated_at` | integer | 更新时间戳 |

## 端点速览

| Method | Path | 说明 |
| ---- | ---- | ---- |
| `GET` | `/clients` | 列出当前账号下的 Client |
| `POST` | `/clients` | 创建一个 Client |
| `GET` | `/clients/:id` | 查看 Client 详情 |
| `PATCH` | `/clients/:id` | 更新 Client 名称、kind、metadata |
| `POST` | `/clients/:id/disable` | 禁用一个 Client（默认 Client 不允许禁用） |
| `POST` | `/clients/:id/enable` | 启用一个 Client |
| `GET` | `/clients/:id/api-keys` | 列出该 Client 的 API Key |
| `POST` | `/clients/:id/api-keys` | 创建一把 API Key，返回一次性 secret |
| `POST` | `/clients/:id/api-keys/:key_id/revoke` | 吊销一把 API Key |

## 默认 Client 与权限

- 启动修复会确保每个账号都有一个 `is_default = true` 的 Client，
  ID 使用确定性形式 `cli_default_${accountId}`。
- 默认 Client 不会自动生成 API Key。
- 默认 Client 是唯一允许以账号 owner 身份访问该账号所有 Project 的 Client。
- 普通 Client 不会因为同账号而自动获得 owner 权限，需要由 owner 显式
  加入 Project 成员。
- 默认 Client 不允许通过 `POST /clients/:id/disable` 禁用，返回 409
  `client_default_disable_not_supported`。

## 错误码

| 状态码 | `error.code` | 说明 |
| ---- | ---- | ---- |
| 400 | `client_name_required` | 名称为空或类型错误 |
| 400 | `client_kind_invalid` | 不支持的 kind |
| 400 | `client_metadata_invalid` | metadata 不能 JSON 序列化 |
| 401 | `client_api_key_invalid` | Client API Key 无效或鉴权失败 |
| 403 | `client_management_actor_invalid` | Client 身份不能调用 Client 管理接口 |
| 404 | `client_not_found` | Client 不存在或不属于当前账号 |
| 404 | `client_api_key_not_found` | API Key 不存在或不属于该 Client |
| 409 | `client_disabled` | Client 已被禁用 |
| 409 | `client_default_disable_not_supported` | 默认 Client 不允许禁用 |
| 413 | `client_metadata_too_large` | metadata JSON 超过 16 KiB |
