---
outline: [2, 3]
---

# Prompt Runtime Assets（资源绑定）

这一页只讲 Prompt Runtime 的 assets 视图。

## 什么时候需要看这页

- 想确认当前会话到底绑定了哪个预设、角色卡、世界书和正则配置。
- 想排查“我明明换了资源，为什么提示词还不是预期内容”。
- 想把资源绑定视图和 mode / policy 分开看。

## 接口

```http
GET /sessions/:id/prompt-runtime/assets
```

## 响应 `200`

```json
{
  "data": {
    "preset": { "id": "preset_1", "name": "Story Preset" },
    "character_card": { "id": "char_1", "name": "Hero" },
    "worldbook": { "id": "wb_1", "name": "Campfire Lore" },
    "regex_profile": { "id": "regex_1", "name": "Safety Regex" }
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
| `*.id` | string | 资源 ID |
| `*.name` | string \| null | 资源名称。原资源不存在时可能为 `null` |

## 相关页面

- 总览页：[Prompt Runtime](./prompt-runtime)
- mode 控制面：[Prompt Runtime Mode](./prompt-runtime-mode)
- policy 控制面：[Prompt Runtime Policy](./prompt-runtime-policy)
