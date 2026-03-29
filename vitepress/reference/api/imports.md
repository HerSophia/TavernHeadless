---
outline: [2, 3]
---

# Imports锛堝鍏ワ級

鎻愪緵 SillyTavern 鐢熸€佺殑鍏煎瀵煎叆鎺ュ彛銆傚皢 SillyTavern 鍘熷 JSON 瑙ｆ瀽鍚庡瓨鍏ユ暟鎹簱銆?
瀵煎叆瀹屾垚鍚庯紝閫氳繃鍚勮祫婧愮殑鐙珛绠＄悊鎺ュ彛杩涜鏌ョ湅銆佺紪杈戝拰鍒犻櫎锛?
- [Presets锛堥璁剧鐞嗭級](./presets)
- [Worldbooks锛堜笘鐣屼功绠＄悊锛塢(./worldbooks)
- [Regex Profiles锛堟鍒欓厤缃鐞嗭級](./regex-profiles)
- [Characters锛堣鑹插崱绠＄悊锛塢(./characters)

## 瀵煎叆 Preset

```http
POST /import/preset
```

瀵煎叆涓€涓?SillyTavern 鏍煎紡鐨勯璁撅紙Preset锛夈€傜郴缁熶細鑷姩瑙ｆ瀽 `prompts`銆乣prompt_order` 绛夊瓧娈点€?
### 璇锋眰浣?
| 瀛楁 | 绫诲瀷 | 蹇呭～ | 璇存槑 |
| ---- | ---- | ---- | ---- |
| `name` | string | 鍚?| 鑷畾涔夊悕绉帮紝涓嶄紶鍒欎粠鏁版嵁涓彁鍙?|
| `data` | object | **鏄?* | SillyTavern 棰勮 JSON 鏁版嵁锛堝寘鍚?`prompts`銆乣prompt_order` 绛夛級 |

### 璇锋眰绀轰緥

```json
{
  "name": "Story Preset",
  "data": {
    "prompts": [],
    "prompt_order": []
  }
}
```

### 鍝嶅簲 `201`

```json
{
  "data": {
    "id": "preset_story",
    "name": "Story Preset",
    "source": "sillytavern"
  }
}
```

### 閿欒

| 鐘舵€佺爜 | 璇存槑 |
| ------ | ---- |
| `400` | 璇锋眰浣撴牎楠屽け璐ユ垨鏁版嵁鏍煎紡閿欒 |

## 瀵煎叆 Worldbook

```http
POST /import/worldbook
```

瀵煎叆涓€涓?SillyTavern 鏍煎紡鐨勪笘鐣屼功銆?
### 璇锋眰浣?
| 瀛楁 | 绫诲瀷 | 蹇呭～ | 璇存槑 |
| ---- | ---- | ---- | ---- |
| `name` | string | 鍚?| 鑷畾涔夊悕绉?|
| `data` | object | **鏄?* | SillyTavern 涓栫晫涔?JSON 鏁版嵁 |

### 璇锋眰绀轰緥

```json
{
  "name": "Kingdom Lore",
  "data": {
    "entries": [
      {
        "keys": ["kingdom"],
        "content": "The kingdom is recovering from a long war."
      }
    ]
  }
}
```

### 鍝嶅簲 `201`

```json
{
  "data": {
    "id": "wb_kingdom",
    "name": "Kingdom Lore",
    "source": "sillytavern"
  }
}
```

## 瀵煎叆 Regex 瑙勫垯

```http
POST /import/regex
```

瀵煎叆涓€缁?SillyTavern 鏍煎紡鐨勬鍒欐浛鎹㈣鍒欍€?
### 璇锋眰浣?
| 瀛楁 | 绫诲瀷 | 蹇呭～ | 璇存槑 |
| ---- | ---- | ---- | ---- |
| `name` | string | **鏄?* | 瑙勫垯闆嗗悕绉帮紙姝ｅ垯鑴氭湰鏈韩娌℃湁鍚嶇О瀛楁锛屽繀椤绘彁渚涳級 |
| `data` | object[] | **鏄?* | SillyTavern 姝ｅ垯瑙勫垯鏁扮粍 |

### 璇锋眰绀轰緥

```json
{
  "name": "Safety Filters",
  "data": [
    {
      "scriptName": "trim_whitespace",
      "find": "\\s+$",
      "replace": ""
    }
  ]
}
```

### 鍝嶅簲 `201`

```json
{
  "data": {
    "id": "regex_safe",
    "name": "Safety Filters",
    "source": "sillytavern",
    "script_count": 1
  }
}
```

## 瀵煎叆瑙掕壊鍗?
```http
POST /import/character
```

瀵煎叆涓€涓?SillyTavern Character Card V2 鏍煎紡鐨勮鑹插崱銆傚彲閫夊悓鏃跺垱寤轰細璇濄€?
璇锋眰浣撳ぇ灏忛檺鍒讹細**200KB**銆?
### 璇锋眰浣?
| 瀛楁 | 绫诲瀷 | 蹇呭～ | 璇存槑 |
| ---- | ---- | ---- | ---- |
| `payload` | object | **鏄?* | SillyTavern Character Card V2 JSON |
| `create_session` | boolean | 鍚?| 鏄惁鍚屾椂鍒涘缓浼氳瘽锛堥粯璁?`false`锛?|
| `title` | string | 鍚?| 浼氳瘽鏍囬锛坄create_session=true` 鏃朵娇鐢級锛?-200 瀛楃 |

### 璇锋眰绀轰緥

```json
{
  "payload": {
    "spec": "chara_card_v2",
    "spec_version": "2.0",
    "data": {
      "name": "Luna",
      "description": "A moon priestess who keeps watch at night.",
      "personality": "Calm and precise",
      "scenario": "Night watch at the city wall",
      "first_mes": "The moon is bright tonight.",
      "mes_example": "<START>\n{{char}}: The tide is turning."
    }
  },
  "create_session": true,
  "title": "Luna Demo Session"
}
```

### 鍝嶅簲 `201`

```json
{
  "data": {
    "create_session": true,
    "character": {
      "name": "Luna",
      "description": "A moon priestess who keeps watch at night.",
      "personality": "Calm and precise",
      "scenario": "Night watch at the city wall",
      "first_mes": "The moon is bright tonight.",
      "mes_example": "<START>\n{{char}}: The tide is turning."
    },
    "character_id": "char_luna",
    "character_version_id": "charver_luna_1",
    "session": {
      "id": "sess_luna",
      "title": "Luna Demo Session",
      "status": "active",
      "character_binding": {
        "character_id": "char_luna",
        "character_version_id": "charver_luna_1",
        "sync_policy": "pin",
        "snapshot_summary": {
          "name": "Luna",
          "has_greeting": true
        }
      },
      "created_at": 1735689600000,
      "updated_at": 1735689660000
    }
  }
}
```

### 閿欒

| 鐘舵€佺爜 | 璇存槑 |
| ------ | ---- |
| `400` | 璇锋眰浣撴牎楠屽け璐ユ垨瑙掕壊鍗℃牸寮忛敊璇?|
| `413` | 璇锋眰浣撹秴杩?200KB 闄愬埗 |

## 瀵煎叆鑱婂ぉ鏂囦欢

```http
POST /import/chat
```

瀵煎叆涓€涓亰澶╂枃浠躲€傛敮鎸佷袱绉嶆牸寮忕殑鑷姩璇嗗埆锛?
- **TavernHeadless 鍘熺敓鏍煎紡锛坄.thchat`锛?*锛欽SON 鏂囦欢锛屼俊灏佸瓧娈?`spec === "tavern_headless_chat"`
- **SillyTavern JSONL 鏍煎紡锛坄.jsonl`锛?*锛氭瘡琛屼竴涓?JSON 瀵硅薄锛岀涓€琛屼负澶撮儴淇℃伅

绯荤粺閫氳繃 `JSON.parse` 灏濊瘯瑙ｆ瀽鏁翠釜鍐呭锛屽鏋滄垚鍔熶笖 `spec` 瀛楁涓?`"tavern_headless_chat"`锛屽垯璧板師鐢熸牸寮忓鍏ヨ矾寰勶紱鍚﹀垯鎸?ST JSONL 鏍煎紡澶勭悊銆?
`.thchat` 鍘熺敓鏍煎紡涓殑璁板繂鏉＄洰鐜板湪鏀寔 Memory V2 鍏冩暟鎹紝渚嬪 `summary_tier`銆乣lifecycle_status`銆乣source_job_id`銆乧overage 缁熻锛屼互鍙婃墿灞曞叧绯绘灇涓?`derived_from` / `compacts` / `resolves`銆?
### 璇锋眰浣?
| 瀛楁 | 绫诲瀷 | 蹇呭～ | 璇存槑 |
| ---- | ---- | ---- | ---- |
| `data` | string | **鏄?* | 鑱婂ぉ鏂囦欢鐨勬枃鏈唴瀹癸紙JSONL 鎴?JSON锛?|
| `character_id` | string | 鍚?| 缁戝畾瑙掕壊 ID锛屽鍏ュ悗浼氳瘽鍏宠仈璇ヨ鑹?|
| `title` | string | 鍚?| 鑷畾涔変細璇濇爣棰橈紝涓嶄紶鍒欎粠鏂囦欢涓帹鏂?|

### 璇锋眰绀轰緥

```json
{
  "data": "{\"user_name\":\"Player\",\"character_name\":\"Luna\",\"chat_metadata\":{}}\n{\"name\":\"Player\",\"is_user\":true,\"mes\":\"Hello!\"}\n{\"name\":\"Luna\",\"is_user\":false,\"mes\":\"Hi there!\"}",
  "character_id": "char_luna",
  "title": "Imported Chat"
}
```

### 鍝嶅簲 `200`

**ST JSONL 鏍煎紡瀵煎叆鍝嶅簲锛?*

```json
{
  "data": {
    "session_id": "sess_import_001",
    "title": "Luna",
    "floor_count": 1,
    "message_count": 2,
    "swipe_count": 0,
    "skipped_lines": 0,
    "import_source": "sillytavern_jsonl",
    "format": "sillytavern_jsonl"
  }
}
```

**TavernHeadless 鍘熺敓鏍煎紡瀵煎叆鍝嶅簲锛?*

```json
{
  "data": {
    "session_id": "sess_import_002",
    "title": "Campfire Scene",
    "floor_count": 5,
    "message_count": 10,
    "swipe_count": 3,
    "skipped_lines": 0,
    "import_source": "thchat",
    "format": "thchat",
    "page_count": 13,
    "variable_count": 2,
    "memory_item_count": 4,
    "memory_edge_count": 1
  }
}
```

| 瀛楁 | 绫诲瀷 | 璇存槑 |
| ---- | ---- | ---- |
| `session_id` | string | 鍒涘缓鐨勪細璇?ID |
| `title` | string | 浼氳瘽鏍囬 |
| `floor_count` | integer | 瀵煎叆鐨勬ゼ灞傛暟 |
| `message_count` | integer | 瀵煎叆鐨勬秷鎭暟 |
| `swipe_count` | integer | 瀵煎叆鐨?swipe锛堝鐗堟湰娑堟伅椤碉級鏁?|
| `skipped_lines` | integer | 璺宠繃鐨勬棤娉曡В鏋愮殑琛屾暟锛堜粎 ST JSONL锛?|
| `import_source` | string | 瀵煎叆鏉ユ簮鏍囪瘑 |
| `format` | string | 妫€娴嬪埌鐨勬牸寮忥細`thchat` 鎴?`sillytavern_jsonl` |
| `page_count` | integer | 娑堟伅椤垫€绘暟锛堜粎 thchat锛?|
| `variable_count` | integer | 瀵煎叆鐨勫彉閲忔暟锛堜粎 thchat锛?|
| `memory_item_count` | integer | 瀵煎叆鐨勮蹇嗘潯鐩暟锛堜粎 thchat锛?|
| `memory_edge_count` | integer | 瀵煎叆鐨勮蹇嗗叧绯昏竟鏁帮紙浠?thchat锛?|

### ST JSONL 鏍煎紡澶勭悊缁嗚妭

**娑堟伅鍒嗙粍瑙勫垯锛?*

- 鐢ㄦ埛娑堟伅锛坄is_user: true`锛夊紑濮嬩竴涓柊妤煎眰锛屽搴?`pageKind: "input"`
- 鍔╂墜娑堟伅锛坄is_user: false`锛夊綊鍏ュ綋鍓嶆ゼ灞傦紝瀵瑰簲 `pageKind: "output"`
- 寮€澶寸殑鍔╂墜娑堟伅锛堟病鏈夊墠缃敤鎴锋秷鎭級鏄犲皠涓?floor 0锛坓reeting锛?- `is_system: true` 鐨勬秷鎭爣璁颁负 `isHidden: true`

**Swipe 澶勭悊锛?*

- 娑堟伅鐨?`swipes` 鏁扮粍涓殑姣忎釜鏉＄洰鍒涘缓涓虹嫭绔嬬殑 `message_page`锛宍version` 閫掑
- `swipe_id` 鎸囧畾鐨勭増鏈爣璁颁负 `isActive: true`

**鏃堕棿瑙ｆ瀽锛?*

- `send_date` 鏀寔鏁板€硷紙Unix 姣锛夈€両SO 8601 瀛楃涓层€佷汉绫诲彲璇诲瓧绗︿覆
- 鏃犳硶瑙ｆ瀽鏃跺洖閫€鍒?`Date.now()`

**瀹归敊澶勭悊锛?*

- 绌鸿鍜屾棤娉曡В鏋愮殑琛岃烦杩囪€岄潪鎶ラ敊
- Chub Chat 鏍煎紡鐨勫璞″瀷 `mes` 瀛楁鑷姩灞曞钩

### 閿欒

| 鐘舵€佺爜 | 璇存槑 |
| ------ | ---- |
| `400` | 璇锋眰浣撴牎楠屽け璐ャ€佹枃浠跺唴瀹逛负绌恒€佸ご閮ㄧ己灏戝繀闇€瀛楁 |
| `400` | thchat 鏍煎紡鐗堟湰涓嶅吋瀹癸紙涓荤増鏈彿涓嶅尮閰嶏級 |
