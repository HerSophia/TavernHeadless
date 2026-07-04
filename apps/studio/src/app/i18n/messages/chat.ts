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
    "newSession": "新建会话",
    "newSessionTitle": "Studio 会话",
    "noMessages": "还没有消息，说点什么开始吧。",
    "send": "发送",
    "stop": "停止",
    "retry": "重生",
    "regenerating": "重生中…",
    "composerPlaceholder": "输入消息，Enter 发送，Shift+Enter 换行",
    "composerDisabled": "请先选择一个会话",
    "thinking": "正在生成…",
    "pages": "页",
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
    }
  },
  "en": {
    "emptyTitle": "Chat",
    "emptyHint": "Select or create a session to start.",
    "noSession": "No session selected",
    "selectSession": "Select a session in the top bar, or create one to start.",
    "selectProjectFirst": "Select a project first.",
    "newSession": "New session",
    "newSessionTitle": "Studio session",
    "noMessages": "No messages yet. Say something to begin.",
    "send": "Send",
    "stop": "Stop",
    "retry": "Regenerate",
    "regenerating": "Regenerating…",
    "composerPlaceholder": "Type a message. Enter to send, Shift+Enter for newline",
    "composerDisabled": "Select a session first",
    "thinking": "Generating…",
    "pages": "pages",
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
    }
  }
} as const;
