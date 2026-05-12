---
outline: [2, 3]
---

# VC Tags

VC Tag 用来给重要的历史点命名。第一版支持给 Floor 和资产版本打标签。

它只保存引用，不复制 Floor、Prompt、角色卡或资产正文。创建和删除标签会写入 Operation Log。核心资产备份 `1.1.0` 会默认导出指向已导出 floor 或资产版本的 VC Tag。

## 什么时候需要看这页

- 你要给某个重要楼层命名，方便以后查找。
- 你要给某个资产版本命名，方便回滚或比较。
- 你要把 Floor、资产版本和操作日志串起来做审计。

## 先理解几个词

| 词 | 说明 |
| ---- | ---- |
| tag | 一个账号内唯一的名字 |
| target | 标签指向的对象，目前支持 `floor` 和 `asset_version` |
| metadata | 标签自己的附加信息。Operation Log 只记录是否存在 metadata，不保存完整 metadata 内容 |
| `target_asset_kind` | 备份文件里用于说明 `asset_version` 指向哪类资产版本，取值为 `character`、`preset`、`worldbook`、`regex_profile` |

## 创建标签

```http
POST /vc-tags
```

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `name` | string | 是 | 标签名，账号内唯一 |
| `target_type` | string | 是 | `floor` / `asset_version` |
| `target_id` | string | 是 | 目标 ID |
| `session_id` | string \| null | 否 | 可选会话范围。指向 floor 时服务端会从 floor 派生 |
| `metadata` | any | 否 | 标签元信息 |

### 请求示例

```json
{
  "name": "before-big-change",
  "target_type": "floor",
  "target_id": "floor_001",
  "metadata": {
    "note": "重要分支点"
  }
}
```

### 响应 `201`

```json
{
  "data": {
    "id": "tag_001",
    "account_id": "default-admin",
    "name": "before-big-change",
    "target_type": "floor",
    "target_id": "floor_001",
    "session_id": "sess_001",
    "metadata": {
      "note": "重要分支点"
    },
    "created_by_operation_id": "op_001",
    "created_at": 1735689600000
  }
}
```

### 错误

| 状态码 | `error.code` | 说明 |
| ---- | ---- | ---- |
| `400` | `validation_error` / `invalid_tag_session` | 请求体不合法，或传入的 `session_id` 与 floor 所属会话不一致 |
| `404` | `floor_not_found` / `asset_version_not_found` / `session_not_found` | 目标不存在或不属于当前账号 |
| `409` | `tag_exists` | 标签名已存在 |

## 列出标签

```http
GET /vc-tags
```

### 查询参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `target_type` | string | 可选。`floor` / `asset_version` |
| `target_id` | string | 可选。目标 ID |
| `session_id` | string | 可选。会话范围 |
| `limit` | integer | 默认 `50`，最大 `200` |
| `offset` | integer | 默认 `0` |
| `sort_order` | string | `asc` / `desc`，默认 `desc` |

### 响应 `200`

```json
{
  "data": [
    {
      "id": "tag_001",
      "account_id": "default-admin",
      "name": "before-big-change",
      "target_type": "floor",
      "target_id": "floor_001",
      "session_id": "sess_001",
      "metadata": null,
      "created_by_operation_id": "op_001",
      "created_at": 1735689600000
    }
  ],
  "meta": {
    "total": 1,
    "limit": 50,
    "offset": 0,
    "has_more": false,
    "sort_by": "created_at",
    "sort_order": "desc"
  }
}
```

## 获取标签

```http
GET /vc-tags/:id
```

返回结构同创建标签的 `data`。

### 错误

| 状态码 | `error.code` | 说明 |
| ---- | ---- | ---- |
| `404` | `tag_not_found` | 标签不存在或不属于当前账号 |

## 删除标签

```http
DELETE /vc-tags/:id
```

删除标签只删除引用，不删除目标 Floor 或资产版本。接口会写入 `delete_tag` 操作日志。

### 响应 `200`

```json
{
  "data": {
    "id": "tag_001",
    "deleted": true
  }
}
```

### 错误

| 状态码 | `error.code` | 说明 |
| ---- | ---- | ---- |
| `404` | `tag_not_found` | 标签不存在或不属于当前账号 |


## 备份与恢复

- `POST /backup/jobs/export` 默认 `include_vc_tags=true`，会导出目标已经进入备份文件的标签。
- 如果请求 `include_operation_logs="referenced"` 或 `include_operation_logs="selected_scope"`，标签的 `created_by_operation_id` 会在对应日志也被导出时写入 `created_by_operation_id_ref`。
- 恢复时标签会创建为新 ID。目标 floor 或资产版本会映射到恢复后的新 ID。
- 如果标签名与现有标签重名，恢复规划会自动改名，例如追加 `(restored)`。
- 如果对应 Operation Log 没有导入，恢复后的 `created_by_operation_id` 为 `null`。
