/**
 * graphAssistant 命名空间的多语言文案。
 *
 * 由原单文件 i18n 拆分而来。新增或修改文案时，请在本文件内保持各语言同步。
 */
export const graphAssistant = {
  "zh-CN": {
    "toggle": "AI 助手",
    "title": "图助手",
    "selectProjectFirst": "请先在顶栏选择项目。",
    "emptyHint": "这是一段临时对话，用完即弃，不会进入正史。",
    "send": "发送",
    "stop": "停止",
    "composerPlaceholder": "向图助手提问，Enter 发送，Shift+Enter 换行；输入 {'@'} 引用图 / 节点 / 选中",
    "composerDisabled": "对话已结束，请新开一段",
    "mention": {
      "loading": "加载图列表…",
      "empty": "无匹配项"
    },
    "thinking": "正在生成…",
    "finalize": "完成",
    "discard": "丢弃",
    "newConversation": "新建对话",
    "settings": "设置",
    "history": "历史对话",
    "historyEmpty": "临时对话用完即弃，暂不保留历史记录。",
    "windowize": "窗口化",
    "dock": "停靠回侧栏",
    "resize": "拖拽调整大小",
    "close": "关闭",
    "discardConfirm": "丢弃这段临时对话？丢弃后不可恢复。",
    "terminalHint": "这段对话已结束。",
    "expiredHint": "这段对话已过期，请新开一段。",
    "ttlNotice": "临时 · 约 {minutes} 分钟后过期",
    "ttlExpiringSoon": "临时 · 即将过期",
    "role": {
      "user": "你",
      "assistant": "助手"
    },
    "floor": {
      "retry": "重试",
      "delete": "删除",
      "modelUnknown": "—",
      "generating": "生成中…",
      "reasoning": "思考过程",
      "reasoningOngoing": "思考中…",
      "tools": "工具调用",
      "toolArgsReceived": "已收到参数，等待执行结果…",
      "retryStep": "重试此步",
      "retryStepSoon": "重试此步（即将支持）",
      "retryStepSideEffectConfirm": "从这一步重试会丢弃这一步及其之后的记录并重跑。下列写类工具此前已真实执行、不会被回滚，重跑可能导致重复执行或产生孤儿记录：\n{tools}\n\n确认继续？",
      "metrics": {
        "finishedAt": "完成时间",
        "duration": "耗时",
        "speed": "速度",
        "totalTokens": "总 token",
        "tokenIn": "输入",
        "cached": "缓存",
        "tokenOut": "输出"
      },
      "toolPhase": {
        "start": "执行中",
        "success": "成功",
        "error": "失败",
        "denied": "已拒绝",
        "timeout": "超时",
        "uncertain": "未知",
        "blocked": "已阻止",
        "awaiting_confirmation": "待确认"
      }
    },
    "inspector": {
      "title": "查看回复",
      "open": "查看回复",
      "close": "关闭",
      "copyBody": "复制正文",
      "copied": "已复制",
      "sectionBody": "回复正文",
      "sectionReasoning": "思考内容",
      "sectionFragments": "内容片段",
      "sectionToolCalls": "工具调用",
      "sectionMeta": "元信息",
      "emptyBody": "（无正文）",
      "noReasoning": "本回合无思考内容。",
      "noFragments": "无内容片段。",
      "noToolCalls": "正文中未发现工具调用文本块。",
      "leakWarning": "正文中检测到 {count} 个工具往返文本块，原生协议下不应出现，疑似出格式泄漏。",
      "toolArgs": "参数",
      "toolResult": "结果",
      "toolMalformed": "未闭合 / 出格式",
      "fragmentType": {
        "text": "文本",
        "tool_call": "工具调用",
        "tool_result": "工具结果",
        "tool_response": "工具响应"
      },
      "meta": {
        "floorId": "楼层 ID",
        "state": "状态",
        "tokenIn": "输入 token",
        "tokenOut": "输出 token",
        "totalTokens": "总 token",
        "duration": "耗时"
      }
    },
    "back": "返回",
    "settingsComingSoon": "该设置将在后续阶段提供。",
    "settingsNav": {
      "profile": "LLM Profile",
      "mcp": "MCP",
      "tools": "工具",
      "summary": "总结",
      "context": "上下文",
      "prompt": "提示词"
    },
    "profileSelect": {
      "title": "选择要使用的 LLM Profile",
      "subtitle": "选一个模型档案作为全局默认；未单独设置的角色槽位都用它。",
      "empty": "暂无可用档案，请先在设置页的模型档案中创建。",
      "inUse": "使用中"
    },
    "reasoningEffort": {
      "title": "思考配置",
      "subtitle": "控制本回合思维链：开启后由模型产出思考过程，随每次发送下发。是否产出取决于所选模型。",
      "modeLabel": "思考模式",
      "mode": {
        "adaptive": "自适应 (Adaptive)",
        "manual": "手动 (Manual)"
      },
      "effortLabel": "思考努力级别 (Effort)",
      "effortLevel": {
        "default": "默认（自适应自行决定）",
        "low": "低",
        "medium": "中",
        "high": "高",
        "xhigh": "超高 (xhigh)",
        "max": "最大 (max)"
      },
      "effortHint": "控制 Claude 的思考深度，级别越高思考越深入但消耗更多 Token。自适应可与努力级别共存（xhigh 仅 Opus 4.7、max 仅 Opus 4.6）。",
      "budgetLabel": "思考预算 (Budget)",
      "budgetPlaceholder": "例如 16384",
      "budgetHint": "手动模式：指定思考预算 token 数（不小于 1024，如 16384）。Anthropic 下走手动思考预算（thinking budget）。"
    },
    "genParams": {
      "title": "生成参数",
      "subtitle": "每项可独立开关；关闭时不下发，由后端/模型默认值生效。随每次发送下发，本机保存。",
      "temperature": {
        "label": "温度（temperature）",
        "hint": "采样随机性，取值 0-2。值越高输出越发散。"
      },
      "topP": {
        "label": "Top-P",
        "hint": "核采样阈值，取值 0-1。与温度二选一调优即可。"
      },
      "maxOutputTokens": {
        "label": "最大输出 token",
        "hint": "本回合生成的最大 token 数，正整数。"
      },
      "maxContextTokens": {
        "label": "最大上下文 token",
        "hint": "用于 prompt 组装阶段的 token 预算（历史裁剪），不是下发给模型的上下文窗口设置。"
      }
    },
    "toolTransport": {
      "title": "工具调用协议",
      "subtitle": "选择图助手调用工具时使用的协议。随每次发送下发，本机保存。",
      "option": {
        "auto": "自动（按模型能力）",
        "native": "原生 Function Calling",
        "textProtocol": "文本协议"
      },
      "hint": "自动：按所选模型能力选——支持原生调用则走原生，否则走文本协议。原生：强制原生调用，模型不支持时会自动回退到文本协议。文本协议：强制使用可读的文本协议块。"
    },
    "prompt": {
      "title": "静态提示词",
      "subtitle": "配置图助手的固定指令文本。按项目保存在后端，跨临时对话生效。",
      "noProject": "请先选择一个项目。",
      "injectOnceNotice": "静态提示词在每段临时对话首次发送时注入一次；修改后只对新开的对话生效，不回溯当前对话。",
      "builtinDefault": "内置默认（只读）",
      "modeLabel": "叠加模式",
      "mode": {
        "append": "追加",
        "override": "覆盖"
      },
      "modeHint": {
        "append": "在内置默认之后追加你的自定义文本。",
        "override": "用你的自定义文本完全替换内置默认；留空时回退内置默认。"
      },
      "customLabel": "自定义文本",
      "customPlaceholder": "在此输入要追加或覆盖的提示词……",
      "previewLabel": "合成预览",
      "save": "保存",
      "saving": "保存中…",
      "reset": "撤销改动",
      "dynamic": {
        "title": "动态提示词",
        "subtitle": "用占位符引用上下文数据块，控制每回合注入的措辞。留空则按上下文页开启的数据块自动拼接。",
        "templateLabel": "模板",
        "templatePlaceholder": "在此输入动态提示词模板，用下方的双花括号占位符插入数据块……",
        "placeholderLabel": "可用占位符（点击插入）",
        "placeholderDisabledHint": "需先在上下文页开启",
        "previewLabel": "实时预览",
        "previewTokens": "预计 {tokens} tokens",
        "previewOverBudget": "超出总 token 预算（上限 {max}），发送时会截断。",
        "previewEmpty": "当前画布暂无可注入的上下文。",
        "save": "保存",
        "saving": "保存中…",
        "reset": "撤销改动"
      }
    },
    "context": {
      "title": "上下文",
      "subtitle": "配置发送给图助手的画布上下文。按项目保存在后端，每回合随发送注入。",
      "noProject": "请先选择一个项目。",
      "budgetHint": "数量预算填 -1 表示不限制。数据按回合采集，不写入对话记录。",
      "blocks": {
        "graphSummary": {
          "label": "图结构概要",
          "desc": "图名、节点 / 连线 / 组的规模，可选附节点清单。"
        },
        "selection": {
          "label": "当前选中",
          "desc": "当前选中的节点 / 连线 / 组。"
        },
        "graphVersion": {
          "label": "图版本",
          "desc": "当前基线版本、服务端最新版本、本地草稿状态与历史版本。"
        },
        "diagnostics": {
          "label": "诊断信息",
          "desc": "校验状态、错误 / 警告计数与具体条目。"
        },
        "projectMeta": {
          "label": "项目元信息",
          "desc": "当前项目名称与 ID。"
        }
      },
      "params": {
        "includeNodeList": "附节点清单",
        "maxNodes": "节点最大条数",
        "maxVersions": "历史版本最大条数",
        "maxPerType": "每类最大条数",
        "diagnosticTypes": "问题类型",
        "maxTokens": "总 token 预算",
        "maxTokensHint": "仅限制注入的上下文体量，超出时按字符截断；-1 表示不限制（生成的真正上限由 LLM Profile 决定）。"
      },
      "diagnosticKind": {
        "error": "错误",
        "warning": "警告"
      },
      "save": "保存",
      "saving": "保存中…",
      "reset": "撤销改动"
    },
    "toolPolicy": {
      "title": "图助手工具策略",
      "subtitle": "逐工具设定「自动执行」或「需要确认」。策略按项目保存在后端，跨临时对话生效。",
      "withheldNotice": "在执行前确认闸落地前，「需要确认」的工具会被暂时停用，不会暴露给助手。",
      "auto": "自动执行",
      "confirm": "需要确认",
      "decisionDefault": "默认",
      "decisionOverride": "已覆盖",
      "danger": "危险",
      "allAuto": "全部自动",
      "allConfirm": "全部需确认",
      "resetDefault": "恢复默认",
      "empty": "暂无可配置的图助手工具。",
      "noProject": "请先选择一个项目。",
      "summary": "{auto} 个自动 · {confirm} 个需确认",
      "expand": "展开",
      "collapse": "收起",
      "category": {
        "read": "读取",
        "draft": "草稿",
        "proposal": "提案",
        "create": "新建图",
        "other": "其他"
      },
      "detail": {
        "toolId": "工具 ID",
        "sideEffect": "副作用",
        "default": "默认策略"
      },
      "sideEffect": {
        "none": "只读 / 无副作用",
        "sandbox": "沙箱（可逆）",
        "irreversible": "不可逆"
      },
      "tool": {
        "graph_get": {
          "name": "读取图定义",
          "desc": "读取一张 NodeGraph 的定义及其当前版本。"
        },
        "graph_list": {
          "name": "列出图",
          "desc": "列出当前项目下的所有 NodeGraph（含 id、名称、状态），用于查看有哪些图。"
        },
        "graph_find_by_name": {
          "name": "按名称查图",
          "desc": "按名称在当前项目内查找 NodeGraph，返回其 Graph ID。"
        },
        "graph_list_versions": {
          "name": "列出图版本",
          "desc": "列出某张 NodeGraph 的所有版本。"
        },
        "node_get": {
          "name": "读取节点",
          "desc": "读取线上当前版本的单个节点；若传入的是节点组 id，则展开该组全部成员的完整信息。"
        },
        "preset_get": {
          "name": "查看原始预设",
          "desc": "对于从酒馆预设导入的图，读取其原始预设：整体概览，以及每条 prompt 到当前所属分组的对照表；传 identifier 可读取单条 prompt 的完整原文。"
        },
        "node_type_list": {
          "name": "列出节点类型",
          "desc": "列出已注册的所有 NodeGraph 节点类型。"
        },
        "node_type_describe": {
          "name": "查看节点类型",
          "desc": "查看某个已注册节点类型的详细定义。"
        },
        "patch_validate": {
          "name": "校验草稿",
          "desc": "校验当前 NodeGraph 草稿是否可执行。"
        },
        "patch_diff": {
          "name": "生成草稿差异",
          "desc": "为 NodeGraph 草稿生成可供审阅的前后差异。"
        },
        "draft_create_from_version": {
          "name": "从版本创建草稿",
          "desc": "从已有版本创建一个内存中的临时草稿（重启即失、超时过期）；改动需经「提交补丁提案」落库。"
        },
        "node_add": {
          "name": "添加节点",
          "desc": "向内存草稿中添加一个节点。"
        },
        "node_update_config": {
          "name": "更新节点配置",
          "desc": "仅更新草稿中某个节点的 config 配置对象。"
        },
        "node_rename": {
          "name": "重命名节点",
          "desc": "重命名草稿中的节点，不改变图的连线。"
        },
        "node_delete": {
          "name": "删除节点",
          "desc": "从草稿中删除节点，并移除其相连的边。"
        },
        "edge_add": {
          "name": "添加边",
          "desc": "向草稿中添加一条边。"
        },
        "edge_delete": {
          "name": "删除边",
          "desc": "从草稿中删除一条边。"
        },
        "group_create": {
          "name": "创建分组",
          "desc": "在草稿中创建一个可视分组或子图分组。"
        },
        "group_update": {
          "name": "更新分组",
          "desc": "修改草稿中的分组，不会即时 live 应用。"
        },
        "patch_submit_proposal": {
          "name": "提交补丁提案",
          "desc": "把草稿打包为补丁提案提交（进入项目收件箱），不会即时 live 应用既有图。"
        },
        "graph_create": {
          "name": "新建图",
          "desc": "从零创建一张全新的 NodeGraph 及其第一个版本（真实持久写入）。仅创建新图，不会修改既有图；新建的图可归档或删除。"
        }
      }
    },
    "confirmation": {
      "awaitingHint": "助手想执行下面的操作，确认后才会继续。",
      "approve": "批准",
      "reject": "拒绝",
      "danger": "危险",
      "noArgs": "无参数",
      "moreArgs": "+{count} 个参数"
    },
    "status": {
      "active": "进行中",
      "finalized": "已完成",
      "discarded": "已丢弃",
      "cancelled": "已取消",
      "expired": "已过期"
    }
  },
  "en": {
    "toggle": "AI assistant",
    "title": "Graph assistant",
    "selectProjectFirst": "Select a project first.",
    "emptyHint": "This is a temporary conversation. It is discarded after use and never enters the canonical history.",
    "send": "Send",
    "stop": "Stop",
    "composerPlaceholder": "Ask the graph assistant. Enter to send, Shift+Enter for newline; type {'@'} to reference a graph / node / selection",
    "composerDisabled": "This conversation has ended. Start a new one.",
    "mention": {
      "loading": "Loading graphs…",
      "empty": "No matches"
    },
    "thinking": "Generating…",
    "finalize": "Finalize",
    "discard": "Discard",
    "newConversation": "New conversation",
    "settings": "Settings",
    "history": "History",
    "historyEmpty": "Temporary conversations are discarded after use; no history is kept.",
    "windowize": "Detach to window",
    "dock": "Dock to side",
    "resize": "Drag to resize",
    "close": "Close",
    "discardConfirm": "Discard this temporary conversation? This cannot be undone.",
    "terminalHint": "This conversation has ended.",
    "expiredHint": "This conversation has expired. Start a new one.",
    "ttlNotice": "Temporary · expires in ~{minutes} min",
    "ttlExpiringSoon": "Temporary · expiring soon",
    "role": {
      "user": "You",
      "assistant": "Assistant"
    },
    "floor": {
      "retry": "Retry",
      "delete": "Delete",
      "modelUnknown": "—",
      "generating": "Generating…",
      "reasoning": "Thinking",
      "reasoningOngoing": "Thinking…",
      "tools": "Tool calls",
      "retryStep": "Retry step",
      "retryStepSoon": "Retry step (coming soon)",
      "retryStepSideEffectConfirm": "Retrying from this step discards this step and everything after it, then re-runs. The write-type tools below already executed and will not be rolled back; re-running may duplicate them or leave orphaned records:\n{tools}\n\nContinue?",
      "toolArgsReceived": "Arguments received, waiting for result…",
      "metrics": {
        "finishedAt": "Finished",
        "duration": "Duration",
        "speed": "Speed",
        "totalTokens": "Total tokens",
        "tokenIn": "Input",
        "cached": "Cached",
        "tokenOut": "Output"
      },
      "toolPhase": {
        "start": "Running",
        "success": "Success",
        "error": "Failed",
        "denied": "Denied",
        "timeout": "Timeout",
        "uncertain": "Uncertain",
        "blocked": "Blocked",
        "awaiting_confirmation": "Awaiting"
      }
    },
    "inspector": {
      "title": "Inspect reply",
      "open": "Inspect reply",
      "close": "Close",
      "copyBody": "Copy body",
      "copied": "Copied",
      "sectionBody": "Reply body",
      "sectionReasoning": "Reasoning",
      "sectionFragments": "Content fragments",
      "sectionToolCalls": "Tool calls",
      "sectionMeta": "Meta",
      "emptyBody": "(no body)",
      "noReasoning": "No reasoning in this turn.",
      "noFragments": "No content fragments.",
      "noToolCalls": "No tool-call text blocks found in the body.",
      "leakWarning": "Detected {count} tool round-trip text block(s) in the body. These should not appear under the native protocol and likely indicate a malformed-format leak.",
      "toolArgs": "Arguments",
      "toolResult": "Result",
      "toolMalformed": "Unclosed / malformed",
      "fragmentType": {
        "text": "Text",
        "tool_call": "Tool call",
        "tool_result": "Tool result",
        "tool_response": "Tool response"
      },
      "meta": {
        "floorId": "Floor ID",
        "state": "State",
        "tokenIn": "Input tokens",
        "tokenOut": "Output tokens",
        "totalTokens": "Total tokens",
        "duration": "Duration"
      }
    },
    "back": "Back",
    "settingsComingSoon": "This setting arrives in a later stage.",
    "settingsNav": {
      "profile": "LLM Profile",
      "mcp": "MCP",
      "tools": "Tools",
      "summary": "Summary",
      "context": "Context",
      "prompt": "Prompt"
    },
    "profileSelect": {
      "title": "Select the LLM profile to use",
      "subtitle": "Pick a model profile as the global default; role slots without their own setting use it.",
      "empty": "No usable profiles yet. Create one in the model profiles on the settings page.",
      "inUse": "in use"
    },
    "reasoningEffort": {
      "title": "Thinking",
      "subtitle": "Controls the chain-of-thought for each turn: when enabled the model produces a thinking process, sent with every message. Whether it is produced depends on the selected model.",
      "modeLabel": "Thinking mode",
      "mode": {
        "adaptive": "Adaptive",
        "manual": "Manual"
      },
      "effortLabel": "Reasoning effort",
      "effortLevel": {
        "default": "Default(adaptive decides)",
        "low": "Low",
        "medium": "Medium",
        "high": "High",
        "xhigh": "Extra high (xhigh)",
        "max": "Max"
      },
      "effortHint": "Controls Claude's thinking depth; higher levels think deeper but cost more tokens. Adaptive can coexist with an effort level (xhigh requires Opus 4.7, max requires Opus 4.6).",
      "budgetLabel": "Thinking budget",
      "budgetPlaceholder": "e.g. 16384",
      "budgetHint": "Manual mode: specify a thinking budget in tokens (at least 1024, e.g. 16384). On Anthropic this uses the manual thinking budget."
    },
    "genParams": {
      "title": "Generation parameters",
      "subtitle": "Each toggle is independent; when off the value is not sent and the backend/model default applies. Sent with every message, stored locally.",
      "temperature": {
        "label": "Temperature",
        "hint": "Sampling randomness, range 0-2. Higher values produce more diverse output."
      },
      "topP": {
        "label": "Top-P",
        "hint": "Nucleus sampling threshold, range 0-1. Tune either temperature or top-p, not both."
      },
      "maxOutputTokens": {
        "label": "Max outputtokens",
        "hint": "Maximum number of tokens generated this turn, a positive integer."
      },
      "maxContextTokens": {
        "label": "Max context tokens",
        "hint": "Used for the token budget during prompt assembly (history trimming), not the model's context window setting."
      }
    },
    "toolTransport": {
      "title": "Tool call protocol",
      "subtitle": "Choose the protocol the assistant uses to call tools. Sent with every message, stored locally.",
      "option": {
        "auto": "Auto (by model capability)",
        "native": "Native function calling",
        "textProtocol": "Text protocol"
      },
      "hint": "Auto: picks by the selected model's capability—native when supported, otherwise the text protocol. Native: forces native calling and safely falls back to the text protocol when the model does not support it. Text protocol: forces the readable text protocol blocks."
    },
    "prompt": {
      "title": "Static prompt",
      "subtitle": "Configure the graph assistant's fixed instruction text.Stored per project on the backend and applies across temporary conversations.",
      "noProject": "Select a project first.",
      "injectOnceNotice": "The static prompt is injected once on the first message of each temporary conversation. Changes only affect newly started conversations and do not apply retroactively.",
      "builtinDefault": "Built-in default (read-only)",
      "modeLabel": "Overlay mode",
      "mode": {
        "append": "Append",
        "override": "Override"
      },
      "modeHint": {
        "append": "Append your custom text after the built-in default.",
        "override": "Replace the built-in default entirely with your custom text; falls back to the built-in default when empty."
      },
      "customLabel": "Custom text",
      "customPlaceholder": "Enter the prompt text to append or override...",
      "previewLabel": "Composed preview",
      "save": "Save",
      "saving": "Saving...",
      "reset": "Discard changes",
      "dynamic": {
        "title": "Dynamic prompt",
        "subtitle": "Reference context blocks with placeholders to control the wording injected each turn. Leave empty to auto-concatenate the blocks enabled on the Context page.",
        "templateLabel": "Template",
        "templatePlaceholder": "Enter the dynamic prompt template; insert blocks using the double-brace placeholders below...",
        "placeholderLabel": "Available placeholders (click to insert)",
        "placeholderDisabledHint": "Enable it on the Context page first",
        "previewLabel": "Live preview",
        "previewTokens": "~{tokens} tokens",
        "previewOverBudget": "Over the total token budget (cap {max}); will be truncated on send.",
        "previewEmpty": "No context available from the current canvas.",
        "save": "Save",
        "saving": "Saving...",
        "reset": "Discard changes"
      }
    },
    "context": {
      "title": "Context",
      "subtitle": "Configure the canvas context sent to the graph assistant. Stored per project on the backend and injected each turn.",
      "noProject": "Select a project first.",
      "budgetHint": "Set a budget to -1 for unlimited. Data is collected per turn and not written to the transcript.",
      "blocks": {
        "graphSummary": {
          "label": "Graph summary",
          "desc": "Graph name, node / edge / group counts, withan optional node list."
        },
        "selection": {
          "label": "Current selection",
          "desc": "The currently selected node / edge / group."
        },
        "graphVersion": {
          "label": "Graph version",
          "desc": "Base version, server latest version, local draft state and version history."
        },
        "diagnostics": {
          "label": "Diagnostics",
          "desc": "Validation state, error / warning counts and concrete entries."
        },
        "projectMeta": {
          "label": "Projectmetadata",
          "desc": "Current project name and ID."
        }
      },
      "params": {
        "includeNodeList": "Include node list",
        "maxNodes": "Max nodes",
        "maxVersions": "Max versions",
        "maxPerType": "Max per type",
        "diagnosticTypes": "Issue types",
        "maxTokens": "Total token budget",
        "maxTokensHint": "Caps only the injected context size; truncated by characters when exceeded. -1 means unlimited (the real generation cap is set in the LLM Profile)."
      },
      "diagnosticKind": {
        "error": "Error",
        "warning": "Warning"
      },
      "save": "Save",
      "saving": "Saving...",
      "reset": "Discard changes"
    },
    "toolPolicy": {
      "title": "Graph assistant tool policy",
      "subtitle": "Set each tool to auto-run or require confirmation. Policies are stored per project on the backend and apply across temporary conversations.",
      "withheldNotice": "Until the pre-execution confirmation gate ships, tools set to require confirmation are withheld and not exposed to the assistant.",
      "auto": "Auto-run",
      "confirm": "Confirm",
      "decisionDefault": "default",
      "decisionOverride": "overridden",
      "danger": "danger",
      "allAuto": "All auto",
      "allConfirm": "All confirm",
      "resetDefault": "Reset to default",
      "empty": "No configurable graph assistant tools.",
      "noProject": "Select a project first.",
      "summary": "{auto} auto · {confirm} confirm",
      "expand": "Expand",
      "collapse": "Collapse",
      "category": {
        "read": "Read",
        "draft": "Draft",
        "proposal": "Proposal",
        "create": "Create graph",
        "other": "Other"
      },
      "detail": {
        "toolId": "Tool ID",
        "sideEffect": "Side effect",
        "default": "Default"
      },
      "sideEffect": {
        "none": "Read-only / none",
        "sandbox": "Sandbox (reversible)",
        "irreversible": "Irreversible"
      },
      "tool": {
        "graph_get": {
          "name": "Read graph",
          "desc": "Read a NodeGraph definition and its current version."
        },
        "graph_list": {
          "name": "List graphs",
          "desc": "List all NodeGraphs in the current project (id, name, status) to discover which graphs exist."
        },
        "graph_find_by_name": {
          "name": "Find graph by name",
          "desc": "Find a NodeGraph by name within the current project and return its Graph ID."
        },
        "graph_list_versions": {
          "name": "List versions",
          "desc": "List all versions of a NodeGraph."
        },
        "node_get": {
          "name": "Read node",
          "desc": "Read a single node from the current live version; if the id is a node group, expand all of its member nodes with full details."
        },
        "preset_get": {
          "name": "Read original preset",
          "desc": "For a graph imported from a SillyTavern preset, read the original preset: an overview plus a mapping table of each prompt to the group it now belongs to; pass an identifier to read one prompt's full original body."
        },
        "node_type_list": {
          "name": "List node types",
          "desc": "List all registered NodeGraph node types."
        },
        "node_type_describe": {
          "name": "Describe node type",
          "desc": "Describe a registered NodeGraph node type in detail."
        },
        "patch_validate": {
          "name": "Validate draft",
          "desc": "Validate whether the current NodeGraph draft is executable."
        },
        "patch_diff": {
          "name": "Diff draft",
          "desc": "Create a review diff (before/after) for a NodeGraph draft."
        },
        "draft_create_from_version": {
          "name": "Create draft from version",
          "desc": "Create an in-memory draft from an existing version (lost on restart, expires after a TTL). Persist changes via submit proposal."
        },
        "node_add": {
          "name": "Add node",
          "desc": "Add a node to an in-memory draft."
        },
        "node_update_config": {
          "name": "Update node config",
          "desc": "Update only the config object of a node in the draft."
        },
        "node_rename": {
          "name": "Rename node",
          "desc": "Rename a node in the draft without changing graph wiring."
        },
        "node_delete": {
          "name": "Delete node",
          "desc": "Delete a node from the draft and remove connected edges."
        },
        "edge_add": {
          "name": "Add edge",
          "desc": "Add an edge to the draft."
        },
        "edge_delete": {
          "name": "Delete edge",
          "desc": "Delete an edge from the draft."
        },
        "group_create": {
          "name": "Create group",
          "desc": "Create a visual or subgraph group in the draft."
        },
        "group_update": {
          "name": "Update group",
          "desc": "Patch a group in the draft without applying it live."
        },
        "patch_submit_proposal": {
          "name": "Submit patch proposal",
          "desc": "Package the draft into a patch proposal (into the project inbox) without applying it live."
        },
        "graph_create": {
          "name": "Create graph",
          "desc": "Create a brand-new NodeGraph and its first version (a real, persistent write). Only creates a new graph; never modifies existing graphs. The created graph can be archived or deleted."
        }
      }
    },
    "confirmation": {
      "awaitingHint": "The assistant wants to run the action below. It continues only after you confirm.",
      "approve": "Approve",
      "reject": "Reject",
      "danger": "danger",
      "noArgs": "No arguments",
      "moreArgs": "+{count} more"
    },
    "status": {
      "active": "Active",
      "finalized": "Finalized",
      "discarded": "Discarded",
      "cancelled": "Cancelled",
      "expired": "Expired"
    }
  }
} as const;
