/**
 * chat 命名空间的多语言文案。
 *
 * 由原单文件 i18n 拆分而来。新增或修改文案时，请在本文件内保持各语言同步。
 */
export const chat = {
  "zh-CN": {
    "emptyTitle": "对话",
    "emptyHint": "选择或新建一个会话开始对话。",
    "noSession": "未选择会话",
    "selectSession": "在顶栏选择一个会话，或新建一个开始对话。",
    "selectProjectFirst": "请先在顶栏选择项目。",
    "floorGraphBinding": "楼层图绑定",
    "newSession": "新建会话",
    "newSessionTitle": "Studio 会话",
    "createDialog": {
      "title": "新建会话",
      "subtitle": "选择要绑定的资产（均可留空；留空即建空会话）。",
      "fieldTitle": "标题",
      "titlePlaceholder": "会话标题（可留空）",
      "promptMode": "提示词模式",
      "promptMode_default": "默认（不指定）",
      "promptMode_compat_strict": "兼容 · 严格",
      "promptMode_compat_plus": "兼容 · 增强",
      "promptMode_native": "原生",
      "character": "角色卡",
      "preset": "预设",
      "worldbook": "世界书",
      "regex": "正则档",
      "none": "不绑定",
      "syncPolicy": "同步策略",
      "syncPolicy_default": "默认（不指定）",
      "syncPolicy_pin": "锁定快照",
      "syncPolicy_manual": "手动",
      "syncPolicy_force": "强制跟随",
      "toolPreset": "工具预设",
      "toolPreset_default": "默认（不指定）",
      "toolPresetHint": "限定本会话可用的工具集与自动/确认策略。",
      "toolPresetName": {
        "regular-chat": "常规聊天",
        "asset-management": "资产管理"
      },
      "create": "创建",
      "cancel": "取消",
      "creating": "创建中…",
      "createFailed": "创建会话失败"
    },
    "noMessages": "还没有消息，说点什么开始吧。",
    "send": "发送",
    "stop": "停止",
    "retry": "重生",
    "regenerating": "重生中…",
    "composerPlaceholder": "输入消息，Enter 发送，Shift+Enter 换行",
    "composerDisabled": "请先选择一个会话",
    "thinking": "正在生成…",
    "pages": "页",
    "pageIndicator": "第 {current} 页 / 共 {total} 页",
    "todo": {
      "title": "待办事项",
      "progress": "{done}/{total} 已完成",
      "collapse": "收起待办",
      "expand": "展开待办",
      "updated": "更新于 {time}",
      "status": {
        "pending": "待处理",
        "in_progress": "进行中",
        "completed": "已完成",
        "blocked": "受阻",
        "cancelled": "已取消"
      }
    },
    "timeline": {
      "loadMore": "加载更多",
      "loadingMore": "加载中…",
      "branch": "分支 {branch}",
      "backToMain": "回到主分支"
    },
    "activeRun": {
      "busy": "该会话正在生成中…",
      "busyPhase": "该会话正在生成中（{phase}）…",
      "refresh": "刷新",
      "type": {
        "respond": "回复",
        "regenerate_page": "重生页",
        "retry_turn": "重跑回合",
        "edit_and_regenerate": "编辑并重生"
      }
    },
    "retryMenu": {
      "more": "更多",
      "retryFloor": "重跑该楼层",
      "retryStep": "从某步重跑…",
      "confirmRetryTitle": "重跑该楼层",
      "confirmRetry": "将清空该楼层当前输出并原地重跑，确定继续？",
      "stepTitle": "从指定步重跑",
      "stepLabel": "起始步（从 1 开始）",
      "stepHint": "起始步之前的写类副作用不会回滚。",
      "result": {
        "discarded": "已从第 {step} 步重跑",
        "sideEffects": "以下写操作已发生且不会回滚：",
        "sideEffect": "{tool}（{level}）"
      }
    },
    "edit": {
      "action": "编辑并重生",
      "placeholder": "编辑这条消息…",
      "save": "保存并重生",
      "cancel": "取消",
      "confirmTitle": "编辑并重生",
      "confirm": "将基于此消息新开分支并重新生成，确定继续？",
      "forkNotice": "当前为编辑派生的新分支，仅显示该分支的回合；完整分支历史将在后续阶段提供。",
      "retryOnForkHint": "分支视图下请用楼层级重跑（“更多”菜单）替代重生最新。"
    },
    "editAssistant": {
      "action": "编辑回复内容",
      "placeholder": "编辑助手回复…",
      "save": "保存修订",
      "cancel": "取消",
      "confirmTitle": "编辑助手回复",
      "confirm": "将就地改写该回复并记录为一次人工修订（不会重新生成），确定继续？"
    },
    "swipe": {
      "prev": "上一版本",
      "next": "下一版本",
      "position": "第 {current} / 共 {total}",
      "switching": "切换中…"
    },
    "dismiss": "关闭",
    "role": {
      "user": "你",
      "assistant": "助手",
      "narrator": "叙述者",
      "system": "系统"
    },
    "phase": {
      "preparing": "准备",
      "generating": "生成",
      "verifying": "校验",
      "committing": "提交",
      "post_processing": "后处理"
    },
    "state": {
      "draft": "草稿",
      "generating": "生成中",
      "committed": "已提交",
      "failed": "失败"
    },
    "trace": {
      "title": "Trace",
      "label": "trace",
      "toggle": "Trace 抽屉",
      "close": "关闭",
      "inspect": "查看该回合 trace",
      "empty": "暂无该回合的 trace。",
      "carrierTitle": "承载路径",
      "carrierUnknown": "（未知）",
      "carrier": {
        "composite": "composite（复合编排）",
        "system_graph": "system_graph（节点图）",
        "unknown": "未知"
      },
      "phasesTitle": "Floor 阶段",
      "active": "进行中",
      "commitTitle": "CommitGate 决策",
      "decision": {
        "allow": "放行",
        "warn": "警告",
        "block": "阻断",
        "skipped": "跳过",
        "pending": "待定",
        "unknown": "未知"
      },
      "agenticTitle": "Agentic Trace",
      "summaries": "摘要",
      "governance": "来源治理",
      "restricted": "受限内容默认裁剪"
    },
    "sessions": {
      "title": "会话",
      "toggle": "会话列表",
      "filter": {
        "active": "活跃",
        "archived": "已归档",
        "all": "全部"
      },
      "status": {
        "active": "活跃",
        "archived": "已归档"
      },
      "updatedAt": "更新于",
      "loading": "加载会话中…",
      "empty": "没有会话。新建一个开始对话。",
      "loadMore": "加载更多",
      "loadingMore": "加载中…",
      "actions": "会话操作",
      "rename": "重命名",
      "renamePlaceholder": "输入会话名称",
      "archive": "归档",
      "unarchive": "取消归档",
      "delete": "删除",
      "cancel": "取消",
      "confirmDeleteTitle": "删除会话",
      "confirmDelete": "确定删除该会话？此操作无法撤销。",
      "confirmDeleteBatch": "确定删除选中的 {count} 个会话？此操作无法撤销。",
      "batch": {
        "select": "选择会话",
        "selectedCount": "已选 {count} 项",
        "archive": "批量归档",
        "unarchive": "批量取消归档",
        "delete": "批量删除",
        "clearSelection": "清除选择"
      },
      "result": {
        "updated": "已更新 {count} 项",
        "deleted": "已删除 {count} 项",
        "notFound": "{count} 项未找到"
      },
      "info": {
        "title": "会话信息",
        "toggle": "会话信息",
        "close": "关闭",
        "empty": "选中一个会话以查看信息。",
        "unset": "未绑定 / 使用默认",
        "unavailable": "暂不可用",
        "yes": "是",
        "no": "否",
        "paramsCount": "{count} 项",
        "group": {
          "basic": "基础",
          "model": "模型",
          "assets": "提示词资产",
          "identity": "角色与用户",
          "effective": "有效配置",
          "scope": "归属"
        },
        "field": {
          "status": "状态",
          "promptMode": "提示词模式",
          "toolPreset": "工具预设",
          "deepBinding": "深度绑定",
          "createdAt": "创建于",
          "updatedAt": "更新于",
          "provider": "供应商",
          "model": "模型",
          "params": "参数摘要",
          "preset": "预设",
          "presetVersion": "预设版本",
          "worldbook": "世界书",
          "worldbookVersion": "世界书版本",
          "regex": "正则档",
          "regexVersion": "正则档版本",
          "character": "角色",
          "hasGreeting": "含开场白",
          "syncPolicy": "同步策略",
          "characterId": "角色 ID",
          "user": "用户",
          "llmProfileSource": "LLM 配置来源",
          "llmProfileId": "LLM 配置 ID",
          "llmProfileOverridden": "会话级覆盖",
          "toolTransport": "工具传输",
          "toolTransportAvailable": "可用传输",
          "capabilities": "能力",
          "workspaceId": "工作区 ID",
          "projectId": "项目 ID"
        },
        "sync": {
          "pin": "锁定快照",
          "manual": "手动",
          "force": "强制跟随"
        },
        "cap": {
          "functionCall": "函数调用",
          "toolChoice": "工具选择",
          "streamingToolCall": "流式工具调用"
        }
      }
    }
  },
  "en": {
    "emptyTitle": "Chat",
    "emptyHint": "Select or create a session to start.",
    "noSession": "No session selected",
    "selectSession": "Select a session in the top bar, or create one to start.",
    "selectProjectFirst": "Select a project first.",
    "floorGraphBinding": "Floor graph binding",
    "newSession": "New session",
    "newSessionTitle": "Studio session",
    "createDialog": {
      "title": "New session",
      "subtitle": "Pick assets to bind (all optional; leave empty to create a blank session).",
      "fieldTitle": "Title",
      "titlePlaceholder": "Session title (optional)",
      "promptMode": "Prompt mode",
      "promptMode_default": "Default (unspecified)",
      "promptMode_compat_strict": "Compat · strict",
      "promptMode_compat_plus": "Compat · plus",
      "promptMode_native": "Native",
      "character": "Character",
      "preset": "Preset",
      "worldbook": "Worldbook",
      "regex": "Regex profile",
      "none": "None",
      "syncPolicy": "Sync policy",
      "syncPolicy_default": "Default (unspecified)",
      "syncPolicy_pin": "Pinned snapshot",
      "syncPolicy_manual": "Manual",
      "syncPolicy_force": "Force follow",
      "toolPreset": "Tool preset",
      "toolPreset_default": "Default (unspecified)",
      "toolPresetHint": "Limits the tools available to this session and their auto/confirm policy.",
      "toolPresetName": {
        "regular-chat": "Regular chat",
        "asset-management": "Asset management"
      },
      "create": "Create",
      "cancel": "Cancel",
      "creating": "Creating…",
      "createFailed": "Failed to create session"
    },
    "noMessages": "No messages yet. Say something to begin.",
    "send": "Send",
    "stop": "Stop",
    "retry": "Regenerate",
    "regenerating": "Regenerating…",
    "composerPlaceholder": "Type a message. Enter to send, Shift+Enter for newline",
    "composerDisabled": "Select a session first",
    "thinking": "Generating…",
    "pages": "pages",
    "pageIndicator": "Page {current} of {total}",
    "todo": {
      "title": "To-dos",
      "progress": "{done}/{total} done",
      "collapse": "Collapse to-dos",
      "expand": "Expand to-dos",
      "updated": "Updated {time}",
      "status": {
        "pending": "Pending",
        "in_progress": "In progress",
        "completed": "Completed",
        "blocked": "Blocked",
        "cancelled": "Cancelled"
      }
    },
    "timeline": {
      "loadMore": "Load more",
      "loadingMore": "Loading…",
      "branch": "Branch {branch}",
      "backToMain": "Back to main"
    },
    "activeRun": {
      "busy": "This session is generating…",
      "busyPhase": "This session is generating ({phase})…",
      "refresh": "Refresh",
      "type": {
        "respond": "Respond",
        "regenerate_page": "Regenerate page",
        "retry_turn": "Retry turn",
        "edit_and_regenerate": "Edit & regenerate"
      }
    },
    "retryMenu": {
      "more": "More",
      "retryFloor": "Retry this floor",
      "retryStep": "Retry from step…",
      "confirmRetryTitle": "Retry this floor",
      "confirmRetry": "This clears the floor's current output and retries in place. Continue?",
      "stepTitle": "Retry from a step",
      "stepLabel": "Start step (from 1)",
      "stepHint": "Write side effects before the start step will not be rolled back.",
      "result": {
        "discarded": "Retried from step {step}",
        "sideEffects": "The following writes have occurred and will not be rolled back:",
        "sideEffect": "{tool} ({level})"
      }
    },
    "edit": {
      "action": "Edit & regenerate",
      "placeholder": "Edit this message…",
      "save": "Save & regenerate",
      "cancel": "Cancel",
      "confirmTitle": "Edit & regenerate",
      "confirm": "This forks a new branch from this message and regenerates. Continue?",
      "forkNotice": "This is a new branch derived from your edit; only this branch's turns are shown. Full branch history will come in a later phase.",
      "retryOnForkHint": "On a branch, use floor-level retry (the More menu) instead of regenerating the latest."
    },
    "editAssistant": {
      "action": "Edit reply",
      "placeholder": "Edit the assistant reply…",
      "save": "Save revision",
      "cancel": "Cancel",
      "confirmTitle": "Edit assistant reply",
      "confirm": "This rewrites the reply in place and records a manual revision (no regeneration). Continue?"
    },
    "swipe": {
      "prev": "Previous version",
      "next": "Next version",
      "position": "{current} / {total}",
      "switching": "Switching…"
    },
    "dismiss": "Dismiss",
    "role": {
      "user": "You",
      "assistant": "Assistant",
      "narrator": "Narrator",
      "system": "System"
    },
    "phase": {
      "preparing": "preparing",
      "generating": "generating",
      "verifying": "verifying",
      "committing": "committing",
      "post_processing": "post-processing"
    },
    "state": {
      "draft": "draft",
      "generating": "generating",
      "committed": "committed",
      "failed": "failed"
    },
    "trace": {
      "title": "Trace",
      "label": "trace",
      "toggle": "Trace drawer",
      "close": "Close",
      "inspect": "Inspect this turn's trace",
      "empty": "No trace for this turn yet.",
      "carrierTitle": "Carrier path",
      "carrierUnknown": "(unknown)",
      "carrier": {
        "composite": "composite",
        "system_graph": "system_graph",
        "unknown": "unknown"
      },
      "phasesTitle": "Floor phases",
      "active": "active",
      "commitTitle": "CommitGate decision",
      "decision": {
        "allow": "allow",
        "warn": "warn",
        "block": "block",
        "skipped": "skipped",
        "pending": "pending",
        "unknown": "unknown"
      },
      "agenticTitle": "Agentic trace",
      "summaries": "Summaries",
      "governance": "Source governance",
      "restricted": "Restricted content is trimmed by default"
    },
    "sessions": {
      "title": "Sessions",
      "toggle": "Session list",
      "filter": {
        "active": "Active",
        "archived": "Archived",
        "all": "All"
      },
      "status": {
        "active": "Active",
        "archived": "Archived"
      },
      "updatedAt": "Updated",
      "loading": "Loading sessions…",
      "empty": "No sessions. Create one to start.",
      "loadMore": "Load more",
      "loadingMore": "Loading…",
      "actions": "Session actions",
      "rename": "Rename",
      "renamePlaceholder": "Enter session name",
      "archive": "Archive",
      "unarchive": "Unarchive",
      "delete": "Delete",
      "cancel": "Cancel",
      "confirmDeleteTitle": "Delete session",
      "confirmDelete": "Delete this session? This cannot be undone.",
      "confirmDeleteBatch": "Delete {count} selected session(s)? This cannot be undone.",
      "batch": {
        "select": "Select session",
        "selectedCount": "{count} selected",
        "archive": "Archive selected",
        "unarchive": "Unarchive selected",
        "delete": "Delete selected",
        "clearSelection": "Clear selection"
      },
      "result": {
        "updated": "{count} updated",
        "deleted": "{count} deleted",
        "notFound": "{count} not found"
      },
      "info": {
        "title": "Session info",
        "toggle": "Session info",
        "close": "Close",
        "empty": "Select a session to view its info.",
        "unset": "Unset / default",
        "unavailable": "Unavailable",
        "yes": "Yes",
        "no": "No",
        "paramsCount": "{count} keys",
        "group": {
          "basic": "Basic",
          "model": "Model",
          "assets": "Prompt assets",
          "identity": "Character & user",
          "effective": "Effective config",
          "scope": "Scope"
        },
        "field": {
          "status": "Status",
          "promptMode": "Prompt mode",
          "toolPreset": "Tool preset",
          "deepBinding": "Deep binding",
          "createdAt": "Created",
          "updatedAt": "Updated",
          "provider": "Provider",
          "model": "Model",
          "params": "Params summary",
          "preset": "Preset",
          "presetVersion": "Preset version",
          "worldbook": "Worldbook",
          "worldbookVersion": "Worldbook version",
          "regex": "Regex profile",
          "regexVersion": "Regex version",
          "character": "Character",
          "hasGreeting": "Has greeting",
          "syncPolicy": "Sync policy",
          "characterId": "Character ID",
          "user": "User",
          "llmProfileSource": "LLM profile source",
          "llmProfileId": "LLM profile ID",
          "llmProfileOverridden": "Session override",
          "toolTransport": "Tool transport",
          "toolTransportAvailable": "Available transports",
          "capabilities": "Capabilities",
          "workspaceId": "Workspace ID",
          "projectId": "Project ID"
        },
        "sync": {
          "pin": "Pinned snapshot",
          "manual": "Manual",
          "force": "Force follow"
        },
        "cap": {
          "functionCall": "Function call",
          "toolChoice": "Tool choice",
          "streamingToolCall": "Streaming tool call"
        }
      }
    }
  }
} as const;
