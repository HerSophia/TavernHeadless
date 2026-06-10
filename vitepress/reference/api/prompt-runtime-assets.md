---
outline: [2, 3]
---

# Prompt Runtime Assets（资源绑定）

这一页只讲 Prompt Runtime 的 assets 视图：当前会话绑定了哪个预设、角色卡、世界书和正则配置，以及各自正在使用的版本。

## 什么时候需要看这页

- 想确认当前会话到底绑定了哪个预设、角色卡、世界书和正则配置。
- 想排查"我明明换了资源，为什么提示词还不是预期内容"。
- 想把资源绑定视图和 mode / policy 分开看。

## 接口

```http
GET /sessions/:id/prompt-runtime/assets
```

### 示例

```bash
curl http://localhost:3000/sessions/sess_001/prompt-runtime/assets
```

### 响应 `200`

```json
{
  "data": {
    "preset": {
      "id": "preset_1",
      "name": "Story Preset",
      "version_id": "preset-ver-3",
      "version_no": 3,
      "content_hash": "sha256:preset-v3"
    },
    "character_card": {
      "id": "char_1",
      "name": "Hero"
    },
    "worldbook": {
      "id": "wb_1",
      "name": "Campfire Lore",
      "version_id": "worldbook-ver-5",
      "version_no": 5,
      "content_hash": "sha256:worldbook-v5"
    },
    "regex_profile": {
      "id": "regex_1",
      "name": "Safety Regex",
      "version_id": "regex-ver-2",
      "version_no": 2,
      "content_hash": "sha256:regex-v2"
    }
  }
}
```

## 字段说明

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `preset` | object \| null | 当前会话绑定的预设 |
| `character_card` | object \| null | 当前会话绑定的角色卡 |
| `worldbook` | object \| null | 当前会话绑定的世界书 |
| `regex_profile` | object \| null | 当前会话绑定的正则配置 |

每个资源摘要的字段：

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 资源 ID |
| `name` | string \| null | 资源名称。原资源不存在时可能为 `null` |
| `version_id` | string \| null | 当前使用的资产版本 ID。不参与版本控制的资源可能没有这个字段 |
| `version_no` | integer \| null | 版本号 |
| `content_hash` | string \| null | 版本内容指纹，可用于快速判断两边内容是否一致 |

## 排查提示

如果你换了资源但提示词没有变化，可以按这个顺序确认：

1. 看本接口返回的 `id` 是不是你预期的资源。
2. 看 `version_no` 和 `content_hash` 是不是你预期的版本。
3. 如果绑定正确但内容仍不对，再去 [Inspection](./prompt-runtime-inspection) 用 `inspect` 看完整的 prepared turn。

## 错误

| 状态码 | 说明 |
| ---- | ---- |
| `404` | 会话不存在或不属于当前账号 |

## 相关页面

- 总览页：[Prompt Runtime](./prompt-runtime)
- mode 控制面：[Prompt Runtime Mode](./prompt-runtime-mode)
- policy 控制面：[Prompt Runtime Policy](./prompt-runtime-policy)
