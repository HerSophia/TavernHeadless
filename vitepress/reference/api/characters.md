---
outline: [2, 3]
---

# Characters（角色卡）

角色卡就是 RP 角色的人设卡片。每个角色可以有多个版本，每次修改都会生成一个新版本，旧的版本也会保留。

角色卡可以从 SillyTavern 格式导入，也可以通过接口直接创建。每个会话必须绑定一个角色卡和一个用户卡。

## 什么时候需要看这页

- 你要导入新的角色卡
- 你要查看或搜索已有角色
- 你要给角色创建新版本
- 你要导出角色卡为文件

## 一个简单例子

```bash
# 列出所有活跃角色
curl "http://localhost:3000/characters?status=active"

# 查看某个角色的详情
curl http://localhost:3000/characters/char_001
```

## 先理解几个词

| 词 | 这里的意思 |
| ---- | ---- |
| snapshot | 角色的完整快照，包含名字、描述、开场白、性格等 |
| version | 角色的一个版本，每次修改都会生成新版本 |
| greeting | 开场白，角色在对话开始时说的第一句话 |



## Character 列表项

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 角色 ID |
| `name` | string | 角色名称 |
| `source` | string | 来源（如 `sillytavern_import`） |
| `status` | string | `active` / `deleted` |
| `revision` | integer | 角色资源版本号，用于并发写入 CAS |
| `latest_version_no` | integer \| null | 最新版本号 |
| `deleted_at` | integer \| null | 删除时间 |
| `created_at` | integer | 创建时间 |
| `updated_at` | integer | 更新时间 |

## 列出角色

```http
GET /characters
```

### 查询参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `status` | string | 按状态过滤：`active` / `deleted` |
| `keyword` | string | 按名称模糊搜索 |
| `sort_by` | string | `updated_at`（默认）/ `created_at` / `name` |
| `sort_order` | string | `asc` / `desc` |
| `limit` | integer | 每页条数，默认 `50` |
| `offset` | integer | 偏移量，默认 `0` |

## 获取角色详情

```http
GET /characters/:id
```

返回角色信息及最新版本的完整快照。

### 响应 `200`

```json
{
  "data": {
    "id": "char_001",
    "name": "Luna",
    "source": "sillytavern_import",
    "revision": 4,
    "status": "active",
    "deleted_at": null,
    "created_at": 1735689600000,
    "updated_at": 1735689600000,
    "latest_version_no": 2,
    "latest_version": {
      "id": "cv_002",
      "character_id": "char_001",
      "version_no": 2,
      "content_hash": "sha256:abc...",
      "snapshot": { "name": "Luna", "description": "..." },
      "created_at": 1735690000000
    }
  }
}
```

## 列出版本

```http
GET /characters/:id/versions
```

### 查询参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `sort_by` | string | `version_no`（默认）/ `created_at` |
| `sort_order` | string | `asc` / `desc` |
| `limit` | integer | 每页条数，默认 `50` |
| `offset` | integer | 偏移量，默认 `0` |

## 创建版本

```http
POST /characters/:id/versions
```

### 请求体

```json
{
  "snapshot": {
    "name": "Luna",
    "description": "A mysterious elf mage.",
    "personality": "...",
    "scenario": "...",
    "exampleDialogue": "...",
    "greeting": "*Luna turns to face you...*"
  },
  "expected_revision": 4
}
```

`snapshot.name` 是必填的。

`expected_revision` 是可选字段。传入后，服务端会按 CAS 方式校验角色当前 revision；不匹配时返回 `character_revision_conflict`。

### 响应 `201`

返回新创建的 CharacterVersion 对象，并额外包含最新 `revision`。

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `404` | `not_found` | 角色不存在 |
| `409` | `character_deleted` / `character_revision_conflict` / `character_conflict` | 角色已删除、`expected_revision` 过期，或版本写入发生竞争冲突 |
| `503` | `resource_busy` | SQLite `busy / locked` 重试耗尽 |

## 版本回滚

```http
POST /characters/:id/versions/:versionId/rollback
```

基于指定版本创建一个新版本（相当于复制该版本为最新版本），同时更新角色名称。

### 请求体

```json
{
  "expected_revision": 4
}
```

### 响应 `201`

返回新创建的版本，额外包含 `rolled_back_from_version_id` 和最新 `revision` 字段。

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `404` | `not_found` | 角色或目标版本不存在 |
| `409` | `character_deleted` / `character_revision_conflict` / `character_conflict` | 角色已删除、`expected_revision` 过期，或回滚写入发生竞争冲突 |
| `503` | `resource_busy` | SQLite `busy / locked` 重试耗尽 |

## 软删除角色

```http
DELETE /characters/:id
```

将角色标记为 `deleted` 状态。数据不会物理删除。

可选请求体：`{ "expected_revision": 4 }`

### 响应 `200`

```json
{
  "data": {
    "id": "char_001",
    "revision": 5,
    "status": "deleted",
    "deleted_at": 1735690000000,
    "updated_at": 1735690000000
  }
}
```

## 恢复角色

```http
POST /characters/:id/restore
```

将已删除的角色恢复为 `active` 状态。

可选请求体：`{ "expected_revision": 5 }`

### 响应 `200`

```json
{
  "data": {
    "id": "char_001",
    "revision": 6,
    "status": "active",
    "deleted_at": null,
    "updated_at": 1735690500000
  }
}
```

## 并发错误码

| 错误码 | 说明 |
| ---- | ---- |
| `character_conflict` | 角色版本号保留阶段触发唯一约束冲突 |
| `character_revision_conflict` | `expected_revision` 过期，或同一 revision 上的写入已被其他请求抢先提交 |
| `resource_busy` | SQLite `busy / locked` 重试耗尽 |