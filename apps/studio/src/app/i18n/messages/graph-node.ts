/**
 * graphNode 命名空间的多语言文案。
 *
 * 由原单文件 i18n 拆分而来。新增或修改文案时，请在本文件内保持各语言同步。
 */
export const graphNode = {
  "zh-CN": {
    "summary": {
      "missing": "缺配置",
      "label": {
        "medium": "介质",
        "output": "投递",
        "binding": "绑定",
        "condition": "条件",
        "ports": "端口",
        "onSkip": "跳过",
        "template": "模板",
        "preset": "预设",
        "note": "备注",
        "ref": "引用",
        "execution": "执行",
        "generation": "生成"
      },
      "value": {
        "missing": "缺失",
        "input": "来自输入",
        "empty": "空",
        "session": "会话预设",
        "chars": "{count} 字",
        "ports": "{in} 入 / {out} 出",
        "execution": {
          "inherit": "继承",
          "backendDefaults": "默认",
          "paramsEnabled": "{count} 项启用"
        }
      }
    },
    "port": {
      "text": "文本",
      "messages": "消息",
      "json": "JSON",
      "state": "状态",
      "query": "查询",
      "entries": "条目",
      "selection": "选择结果",
      "blocks": "提示块",
      "block": "提示块",
      "data": "数据",
      "prompt_ir": "Prompt IR",
      "diagnostics": "诊断",
      "brief": "简报",
      "input": "输入",
      "result": "结果",
      "context": "上下文",
      "verifier": "校验结果",
      "outputs": "输出集",
      "decision": "决策",
      "summary": "摘要",
      "value": "值",
      "record": "记录",
      "payload": "负载",
      "proposal": "提案",
      "open": "开启",
      "condition": "条件",
      "true": "真",
      "false": "假"
    },
    "type": {
      "source_user_input": "用户输入",
      "source_chat_history": "对话历史",
      "source_character": "角色",
      "source_persona": "用户人设",
      "source_dialogue_examples": "示例对话",
      "source_global_input": "全局输入",
      "source_session_state": "会话状态",
        "select_worldbook_match": "世界书匹配",
      "select_memory_retrieve": "记忆检索",
      "select_token_budget_allocator": "Token 预算分配",
      "compose_session_state_projection_block": "状态投影块",
      "compose_text_to_block": "文本转块",
      "compose_template_render": "模板渲染",
      "compose_final_messages": "最终消息",
      "agent_director_plan": "导演规划",
      "agent_player_agency_precheck": "玩家自主预检",
      "agent_call": "Agent 调用",
      "narration_narrator": "叙述者",
      "verify_continuity": "连续性校验",
      "verify_player_agency_postcheck": "玩家自主后检",
      "output_commit_gate": "提交门",
      "output_graph_run_summary": "运行摘要",
      "output_derived_output": "派生输出",
      "output_project_inbox": "项目收件箱",
      "output_session_state_proposal": "状态提案",
      "group_input": "组输入",
      "group_output": "组输出",
      "group_node": "节点组",
      "control_condition": "条件",
      "control_branch": "分支",
      "control_gate": "门控",
      "annotation_comment": "注释"
    },
    "knowledge": {
      "source_user_input": {
        "summary": "提供最新用户输入的纯文本。",
        "usage": "当后续节点需要把当前用户消息作为查询、模板变量或提示块输入时，使用它作为起始来源。",
        "ports": {
          "output": {
            "text": "最新用户消息文本。"
          }
        },
        "pitfalls": [
          "此节点只暴露当前输入。需要历史消息时，请使用对话历史节点。"
        ]
      },
      "source_chat_history": {
        "summary": "提供之前的对话消息，以及同一历史的文本形式。",
        "usage": "当叙述者、校验器或 Agent 需要之前的对话上下文时使用。",
        "ports": {
          "output": {
            "messages": "模型消息格式的历史记录。",
            "text": "渲染为纯文本的历史记录。"
          }
        },
        "pitfalls": [
          "较长的历史可能会在后续预算节点或提示组装阶段被裁剪。"
        ]
      },
      "source_character": {
        "summary": "以文本和 JSON 形式提供当前角色数据。",
        "usage": "用于把角色描述、性格、场景或其他角色事实加入提示图。",
        "ports": {
          "output": {
            "text": "渲染为文本的角色信息。",
            "json": "结构化角色信息。"
          }
        },
        "pitfalls": [
          "如果会话没有当前角色数据，下游提示内容可能为空。"
        ]
      },
      "source_persona": {
        "summary": "以文本和 JSON 形式提供用户人设数据。",
        "usage": "当模型生成时需要考虑玩家或用户人设时使用。",
        "ports": {
          "output": {
            "text": "渲染为文本的用户人设。",
            "json": "结构化用户人设信息。"
          }
        },
        "pitfalls": [
          "不要假定每个会话一定有人设数据。"
        ]
      },
      "source_dialogue_examples": {
        "summary": "以文本和 JSON 形式提供当前角色的示例对话。",
        "usage": "当图需要把角色卡的示例对话加入最终提示时使用。",
        "ports": {
          "output": {
            "text": "渲染为文本的示例对话。",
            "json": "结构化的示例对话数据。"
          }
        },
        "pitfalls": [
          "并非每个角色都有示例对话。示例为空时下游应能安全忽略。"
        ]
      },
      "source_global_input": {
        "summary": "把当前用户输入广播到图中同名、同类型、未连线的输入口（不包括子图内部节点）。",
        "usage": "当多个节点都需要当前用户输入，又不想逐个连线时使用。先把 value 输出连到一个输入口（例如 narrator 的 user_input），编译时会自动把同名、同类型且未连线的输入口一并连上。",
        "ports": {
          "output": {
            "value": "广播值（当前用户输入）。编译期自动连到同名、类型兼容、未连线的输入口。"
          }
        },
        "pitfalls": [
          "只广播到与输出端口同名（value）的输入口。",
          "子图（subgraph）内部节点会被跳过，请显式连到其 group.input 边界。",
          "已有连线的输入口不会被重复广播。"
        ]
      },
      "source_session_state": {
        "summary": "提供当前会话状态，用于提示、检查和模板。",
        "usage": "当图需要稳定的游戏状态、场景状态或其他结构化会话状态时使用。",
        "ports": {
          "output": {
            "state": "供提示使用的会话状态投影。",
            "json": "原始结构化会话状态。"
          }
        },
        "pitfalls": [
          "此节点只读取状态，不写入状态变更。需要提出写入时，请使用状态提案节点。"
        ]
      },
      "select_worldbook_match": {
        "summary": "根据查询找到相关世界书条目。",
        "usage": "在把世界观内容渲染进最终提示消息之前，可连接用户输入、历史或模板查询到此节点。",
        "ports": {
          "input": {
            "query": "用于匹配世界书条目的文本。",
            "entries": "可选的世界书条目或候选集合。"
          },
          "output": {
            "selection": "带元数据的匹配世界书条目。",
            "text": "渲染为文本的匹配世界书条目。"
          }
        },
        "pitfalls": [
          "匹配质量取决于查询文本和可用的世界书条目。"
        ]
      },
      "select_memory_retrieve": {
        "summary": "为当前回合检索相关记忆记录。",
        "usage": "当长期记忆应影响回复时，在提示拼接之前使用此节点。",
        "ports": {
          "input": {
            "query": "用于检索记忆记录的文本。"
          },
          "output": {
            "selection": "带元数据的检索记忆记录。",
            "text": "渲染为提示文本的检索记忆。"
          }
        },
        "pitfalls": [
          "需要 project.memory.read 权限。缺少权限会导致图校验失败。"
        ]
      },
      "select_token_budget_allocator": {
        "summary": "对提示块应用 token 预算选择。",
        "usage": "当提示段落需要在最终消息组装前进行确定性裁剪时使用。",
        "ports": {
          "input": {
            "blocks": "提示块或预算候选。"
          },
          "output": {
            "blocks": "预算处理后的提示块。",
            "diagnostics": "预算诊断和裁剪说明。"
          }
        },
        "pitfalls": [
          "此节点无法恢复上游没有提供的内容。"
        ]
      },
      "compose_session_state_projection_block": {
        "summary": "把会话状态转为可进入提示的文本和提示块。",
        "usage": "在 source.session_state 之后使用，把状态写入最终提示消息。",
        "ports": {
          "input": {
            "state": "要渲染的状态投影。"
          },
          "output": {
            "block": "由会话状态构建的提示块。",
            "text": "同一提示块的纯文本表示。"
          }
        },
        "pitfalls": [
          "状态投影内容取决于上游状态是否可用。"
          ]
      },
      "compose_text_to_block": {
        "summary": "把一个文本来源包装为提示块。",
        "usage": "用在输出文本的源节点与 compose.final_messages 的 blocks 输入之间。",
        "ports": {
          "input": {
            "text": "要作为提示块纳入的文本。"
          },
          "output": {
            "block": "由输入文本构建的提示块。"
          }
        },
        "config": {
          "fields": {
            "role": {
              "label": "消息角色",
              "description": "当提示块作为消息使用时的可选角色提示。"
            }
          }
        },
        "examples": [
          {
            "title": "把角色文本转为提示块"
          }
        ],
        "pitfalls": [
          "输入文本为空时会产生空块，下游组装可能忽略空块。"
        ]
      },
      "compose_template_render": {
        "summary": "使用上游 JSON 数据渲染已配置的模板。",
        "usage": "用于稳定提示段、世界书文本包装，或需要变量的自定义指令。",
        "ports": {
          "input": {
            "data": "模板数据对象。"
          },
          "output": {
            "text": "渲染后的模板文本。",
            "block": "作为提示块的渲染文本。"
          }
        },
        "config": {
          "fields": {
            "template": {
              "label": "模板",
              "description": "要渲染的模板文本。引擎也可能把 content 作为旧别名读取。"
            },
            "role": {
              "label": "消息角色",
              "description": "当渲染块作为消息使用时的可选角色提示。"
            }
          }
        },
        "examples": [
          {
            "title": "渲染系统块"
          }
        ],
        "pitfalls": [
          "无效或缺失的模板数据可能产生空的渲染文本。"
        ]
      },
      "compose_final_messages": {
        "summary": "从提示块和历史记录构建最终模型消息。",
        "usage": "在需要完整模型消息的叙述或 Agent 节点之前使用。",
        "ports": {
          "input": {
            "blocks": "要纳入最终消息的提示块。",
            "messages": "现有消息，通常是对话历史。"
          },
          "output": {
            "messages": "最终模型消息。",
            "prompt_ir": "编译后的 PromptIR 视图。",
            "diagnostics": "提示组装诊断。"
          }
        },
        "pitfalls": [
          "缺少关键块时仍可能生成消息，但提示可能不完整。"
        ]
      },
      "agent_director_plan": {
              "summary": "运行导演 Agent，并返回规划指导。",
        "usage": "当图需要在叙述者生成前获得场景方向时使用。",
        "ports": {
          "input": {
            "messages": "作为导演上下文的消息。",
            "text": "为导演 Agent 提供的可选附加文本上下文。",
            "user_input": "当前用户输入文本（必填），确保导演总能看到玩家的发言。"
          },
          "output": {
            "brief": "导演规划简报。",
            "diagnostics": "Agent 调用诊断。"
          }
        },
        "pitfalls": [
          "需要 project.agent.run 权限，并会执行一次 LLM 调用。"
        ]
      },
      "agent_player_agency_precheck": {
        "summary": "在生成前检查玩家自主性风险。",
        "usage": "当回复需要避免替玩家决定行动时使用。",
        "ports": {
          "input": {
            "messages": "作为自主性检查上下文的消息。",
            "text": "为自主性检查 Agent 提供的可选附加文本上下文。",
            "user_input": "当前用户输入文本（必填），用于判断是否尊重玩家意图。"
          },
          "output": {
            "brief": "预检简报和建议。",
            "diagnostics": "Agent 调用诊断。"
          }
        },
        "pitfalls": [
          "需要 project.agent.run 权限，并会为运行增加一次 LLM 调用。"
        ]
      },
      "agent_call": {
        "summary": "运行通用 Agent 调用，并可配置投递和保留行为。",
        "usage": "用于不适合内置导演和校验节点的自定义助手、审查、记忆或工作流 Agent 调用。",
        "ports": {
          "input": {
            "input": "Agent 输入负载。",
            "text": "为 Agent 调用提供的可选附加文本上下文。"
          },
          "output": {
            "result": "原始 Agent 结果负载。",
            "brief": "可用时的 Agent 简报。",
            "diagnostics": "Agent 执行诊断。"
          }
        },
        "config": {
          "fields": {
            "medium_kind": {
              "label": "执行介质",
              "description": "Agent 调用的执行方式。"
            },
            "medium_deliveryTarget": {
              "label": "投递目标",
              "description": "Agent 结果投递到的位置。"
            },
            "agentBindingId": {
              "label": "Agent 绑定",
              "description": "可选的项目 Agent 绑定 ID。部分后台任务流程需要它。"
            },
            "triggerReason": {
              "label": "触发原因",
              "description": "为此次调用记录的人类可读原因。"
            },
            "temporaryConversationRequest": {
              "label": "临时对话请求",
              "description": "基于临时对话输出的投递专用请求负载。"
            }
          }
        },
        "examples": [
          {
            "title": "内联 Agent 结果"
          }
        ],
        "pitfalls": [
          "需要 project.agent.run 权限。",
          "background_job 通常需要图策略 allowBackgroundJobs=true。",
          "持久投递目标可能需要 allowPersistentOutputs=true。"
        ]
      },
      "narration_narrator": {
        "summary": "生成主要助手或叙述者回复文本。",
        "usage": "在 compose.final_messages 之后使用，让图生成最终叙事回复。",
        "ports": {
          "input": {
            "messages": "用于叙述的最终消息。",
            "text": "为叙述提供的可选附加文本上下文。",
            "user_input": "当前用户输入文本（必填），确保叙述始终反映玩家的实际发言。"
          },
          "output": {
            "text": "生成的叙述者文本。",
            "diagnostics": "叙述诊断。"
          }
        },
        "config": {
          "fields": {
            "presetRef_presetId": {
              "label": "预设 ID",
              "description": "此叙述者节点使用的可选预设 ID。"
            },
            "presetRef_presetVersionId": {
              "label": "预设版本 ID",
              "description": "可选预设版本 ID。省略时使用当前活动预设版本。"
            }
          }
        },
        "examples": [
          {
            "title": "使用会话预设"
          }
        ],
        "pitfalls": [
          "此节点执行主要 LLM 调用，通常应放在 response 阶段。"
        ]
      },
      "verify_continuity": {
        "summary": "检查生成文本是否保持场景和故事连续性。",
        "usage": "当需要连续性审查时，在叙述之后、提交决策之前使用。",
        "ports": {
          "input": {
            "text": "要校验的生成文本。",
            "context": "用于校验的可选上下文。"
          },
          "output": {
            "result": "校验结果和决策数据。",
            "diagnostics": "校验器诊断。"
          }
        },
        "pitfalls": [
          "会增加一次后置 LLM 调用。当它应影响提交决策时，请把结果连接到 output.commit_gate。"
        ]
      },
      "verify_player_agency_postcheck": {
        "summary": "检查生成文本是否保留玩家自主性。",
        "usage": "在叙述之后使用，用来捕获替玩家角色决定行动或意图的输出。",
        "ports": {
          "input": {
            "text": "要校验的生成文本。",
            "context": "用于校验的可选上下文。",
            "user_input": "当前用户输入文本（必填），用于判断输出是否尊重玩家意图。"
          },
          "output": {
            "result": "校验结果和决策数据。",
            "diagnostics": "校验器诊断。"
          }
        },
        "pitfalls": [
          "会增加一次后置 LLM 调用。当它应阻断或警告时，请把结果连接到 output.commit_gate。"
        ]
      },
      "output_commit_gate": {
        "summary": "决定生成文本和相关输出是否可以提交。",
        "usage": "作为回复文本、校验结果和输出负载的最终决策点。",
        "ports": {
          "input": {
            "text": "要提交的生成文本。",
            "verifier": "可能影响决策的校验结果。",
            "outputs": "要纳入决策的额外输出负载。"
          },
          "output": {
            "decision": "提交决策负载。",
            "diagnostics": "提交门诊断。"
          }
        },
        "config": {
          "fields": {
            "mode": {
              "label": "模式",
              "description": "可选的提交决策模式。"
            },
            "requireVerifierPass": {
              "label": "要求校验通过",
              "description": "校验失败是否应阻断提交决策。"
            }
          }
        },
        "examples": [
          {
            "title": "提交生成文本"
          }
        ],
        "pitfalls": [
          "提交门不会自行运行校验器。需要校验决策时，请连接校验节点。"
        ]
      },
      "output_graph_run_summary": {
        "summary": "为 NodeGraph 运行生成结构化摘要。",
        "usage": "当下游界面或日志需要紧凑的运行摘要时使用。",
        "ports": {
          "input": {
            "result": "要汇总的结果负载。"
          },
          "output": {
            "summary": "结构化运行摘要。",
            "diagnostics": "摘要诊断。"
          }
        },
        "pitfalls": [
          "此节点只汇总提供的结果数据，不会自行持久化记录。"
        ]
      },
      "output_derived_output": {
        "summary": "把 JSON 值持久化为项目派生输出。",
        "usage": "当 Agent 或图结果应保存为项目级派生记录时使用。",
        "ports": {
          "input": {
            "value": "要持久化为派生输出记录的值。"
          },
          "output": {
            "record": "已创建的派生输出记录。",
            "diagnostics": "写入诊断。"
          }
        },
        "pitfalls": [
          "需要 project.derived_output.write 权限。持久输出通常还需要图策略 allowPersistentOutputs=true。"
        ]
      },
      "output_project_inbox": {
        "summary": "把结构化负载发送到项目收件箱。",
        "usage": "用于 Agent 提案、审查任务，以及需要人工批准的图输出。",
        "ports": {
          "input": {
            "payload": "要创建的收件箱负载。"
          },
          "output": {
            "record": "已创建的收件箱记录。",
            "diagnostics": "写入诊断。"
          }
        },
        "pitfalls": [
          "需要 project.inbox.write 权限，并且可能需要 allowPersistentOutputs=true。"
        ]
      },
      "output_session_state_proposal": {
        "summary": "生成一份会话状态写入提案。",
        "usage": "当图需要建议状态变更，但不希望把状态写入混入提示生成时使用。",
        "ports": {
          "input": {
            "proposal": "会话状态变更提案。"
          },
          "output": {
            "proposal": "规范化后的提案负载。",
            "diagnostics": "提案诊断。"
          }
        },
        "pitfalls": [
          "需要 session.state.write 权限。提案仍需要对应运行时处理，才会成为实际状态变更。"
        ]
      },
      "group_input": {
        "summary": "为子图定义输入边界。",
        "usage": "在可复用子图内部使用，向所在图暴露输入值。",
        "ports": {
          "output": {
            "value": "进入组边界的值。"
          }
        },
        "pitfalls": [
          "此节点主要在子图边界内部有意义。"
        ]
      },
      "group_output": {
        "summary": "为子图定义输出边界。",
        "usage": "在可复用子图内部使用，向所在图暴露计算值。",
        "ports": {
          "input": {
            "value": "离开组边界的值。"
          },
          "output": {
            "value": "暴露给所在图的值。"
          }
        },
        "pitfalls": [
          "此节点主要在子图边界内部有意义。"
        ]
      },
      "group_node": {
        "summary": "把可复用子图作为一个节点实例化。",
        "usage": "当一段重复图结构需要作为子图编辑和复用时使用。它的端口来自 config.interface。",
        "config": {
          "fields": {
            "ref_graphId": {
              "label": "图 ID",
              "description": "被引用的图定义 ID。"
            },
            "ref_versionId": {
              "label": "版本 ID",
              "description": "可选的被引用图版本 ID。"
            },
            "interface_inputs": {
              "label": "输入",
              "description": "缓存的输入边界端口。"
            },
            "interface_outputs": {
              "label": "输出",
              "description": "缓存的输出边界端口。"
            }
          }
        },
        "examples": [
          {
            "title": "引用子图"
          }
        ],
        "pitfalls": [
          "端口是动态的。请保持 config.interface 与被引用子图边界同步。"
        ]
      },
      "control_condition": {
        "summary": "计算安全的结构化条件，并输出 true 或 false。",
        "usage": "当多个下游控制节点需要复用同一个条件结果时使用。",
        "ports": {
          "input": {
            "value": "条件表达式可用的值。"
          },
          "output": {
            "result": "布尔条件结果。"
          }
        },
        "config": {
          "fields": {
            "condition": {
              "label": "条件",
              "description": "结构化条件表达式。它是数据，不是可执行代码。"
            }
          }
        },
        "examples": [
          {
            "title": "检查运行时意图"
          }
        ],
        "pitfalls": [
          "控制节点通过控制边连接时需要 schemaVersion 2。",
          "条件语言是结构化的，不能执行任意代码。"
        ]
      },
      "control_branch": {
        "summary": "把控制流拆分为 true 和 false 两条路径。",
        "usage": "当两个下游路径只能运行其中一个时使用。",
        "ports": {
          "input": {
            "condition": "用于选择分支的布尔条件。"
          },
          "output": {
            "true": "条件为 true 时激活。",
            "false": "条件为 false 时激活。"
          }
        },
        "config": {
          "fields": {
            "condition": {
              "label": "内联条件",
              "description": "可选的结构化条件。省略时使用 condition 输入端口。"
            }
          }
        },
        "examples": [
          {
            "title": "内联分支条件"
          }
        ],
        "pitfalls": [
          "如果没有配置内联条件，请连接 condition 输入端口。"
        ]
      },
      "control_gate": {
        "summary": "根据条件允许或跳过下游工作。",
        "usage": "当下游节点只应在条件通过时运行，并且需要定义跳过行为时使用。",
        "ports": {
          "input": {
            "condition": "打开或关闭门控的布尔条件。",
            "value": "门控打开时透传的值。"
          },
          "output": {
            "open": "门控打开时激活的控制输出。",
            "value": "透传值输出。"
          }
        },
        "config": {
          "fields": {
            "condition": {
              "label": "条件",
              "description": "可选的结构化条件。省略时使用 condition 输入端口。"
            },
            "onSkip": {
              "label": "跳过时",
              "description": "被跳过的下游输出应如何处理。"
            }
          }
        },
        "examples": [
          {
            "title": "按运行时意图门控"
          }
        ],
        "pitfalls": [
          "如果门控既没有 condition 输入，也没有内联条件，它就无法做出有用决策。"
        ]
      },
      "annotation_comment": {
        "summary": "在画布上添加只服务编辑的注释。",
        "usage": "用于向人类和阅读图的 Agent 说明图区块、待办事项或设计意图。",
        "config": {
          "fields": {
            "content": {
              "label": "内容",
              "description": "显示在画布上的注释文本。"
            }
          }
        },
        "pitfalls": [
          "此节点永远不会执行，不影响 PromptIR、校验结果或 compat 输出。"
        ]
      }
    },
    "phase": {
      "floor_prepare": "准备",
      "pre_response": "前置",
      "response": "生成",
      "post_response": "后置",
      "commit": "提交"
    },
    "status": {
      "skipped": "跳过",
      "running": "运行中",
      "succeeded": "成功",
      "failed": "失败",
      "reused": "复用"
    },
    "previewStatus": {
      "available": "可预览",
      "disabled": "禁用",
      "running": "预览中",
      "succeeded": "已预览",
      "failed": "预览失败"
    },
    "previewPolicy": {
      "auto": "自动预览",
      "cached_only": "仅缓存",
      "manual": "手动预览",
      "disabled": "禁用预览"
    }
  },
  "en": {
    "summary": {
      "missing": "missing",
      "label": {
        "medium": "medium",
        "output": "output",
        "binding": "binding",
        "condition": "condition",
        "ports": "ports",
        "onSkip": "onSkip",
        "template": "template",
        "preset": "preset",
        "note": "note",
        "ref": "ref",
        "execution": "execution",
        "generation": "generation"
      },
      "value": {
        "missing": "missing",
        "input": "from input",
        "empty": "empty",
        "session": "session preset",
        "chars": "{count} chars",
        "ports": "{in} in / {out} out",
        "execution": {
          "inherit": "inherit",
          "backendDefaults": "default",
          "paramsEnabled": "{count} enabled"
        }
      }
    },
    "port": {
      "text": "text",
      "messages": "messages",
      "json": "json",
      "state": "state",
      "query": "query",
      "entries": "entries",
      "selection": "selection",
      "blocks": "blocks",
      "block": "block",
      "data": "data",
      "prompt_ir": "prompt_ir",
      "diagnostics": "diagnostics",
      "brief": "brief",
      "input": "input",
      "result": "result",
      "context": "context",
      "verifier": "verifier",
      "outputs": "outputs",
      "decision": "decision",
      "summary": "summary",
      "value": "value",
      "record": "record",
      "payload": "payload",
      "proposal": "proposal",
      "open": "open",
      "condition": "condition",
      "true": "true",
      "false": "false"
    },
    "type": {
      "source_user_input": "User Input",
      "source_chat_history": "Chat History",
      "source_character": "Character",
      "source_persona": "Persona",
      "source_dialogue_examples": "Dialogue Examples",
      "source_global_input": "Global Input",
      "source_session_state": "Session State",
      "select_worldbook_match": "Worldbook Match",
      "select_memory_retrieve": "Memory Retrieve",
      "select_token_budget_allocator": "Token Budget Allocator",
      "compose_session_state_projection_block": "State Projection Block",
      "compose_text_to_block": "Text to Block",
      "compose_template_render": "Template Render",
      "compose_final_messages": "Final Messages",
      "agent_director_plan": "Director Plan",
      "agent_player_agency_precheck": "Player Agency Precheck",
      "agent_call": "Agent Call",
      "narration_narrator": "Narrator",
      "verify_continuity": "Continuity Check",
      "verify_player_agency_postcheck": "Player Agency Postcheck",
      "output_commit_gate": "Commit Gate",
      "output_graph_run_summary": "Run Summary",
      "output_derived_output": "Derived Output",
      "output_project_inbox": "Project Inbox",
      "output_session_state_proposal": "State Proposal",
      "group_input": "Group Input",
      "group_output": "Group Output",
      "group_node": "Node Group",
      "control_condition": "Condition",
      "control_branch": "Branch",
      "control_gate": "Gate",
      "annotation_comment": "Comment"
    },
    "knowledge": {
      "source_user_input": {
        "summary": "Provides the latest user input as plain text.",
        "usage": "Use this as a starting source when later nodes need the current user message as a query, template value, or prompt block input.",
        "ports": {
          "output": {
            "text": "Latest user message text."
          }
        },
        "pitfalls": [
          "This node only exposes the current input. Use source.chat_history when previous messages are needed."
        ]
      },
      "source_chat_history": {
        "summary": "Provides previous conversation messages and a text form of the same history.",
        "usage": "Use this when the narrator, verifier, or Agent needs earlier conversation context.",
        "ports": {
          "output": {
            "messages": "History as model messages.",
            "text": "History rendered as plain text."
          }
        },
        "pitfalls": [
          "Long history may be trimmed later by budget nodes or prompt assembly."
        ]
      },
      "source_character": {
        "summary": "Provides active character data as text and JSON.",
        "usage": "Use this to add character description, personality, scenario, or other character facts to a prompt graph.",
        "ports": {
          "output": {
            "text": "Character information rendered as text.",
            "json": "Structured character information."
          }
        },
        "pitfalls": [
          "If the session has no active character data, downstream prompt content may be empty."
        ]
      },
      "source_persona": {
        "summary": "Provides user persona data as text and JSON.",
        "usage": "Use this when the model should consider the player or user persona during generation.",
        "ports": {
          "output": {
            "text": "Persona rendered as text.",
            "json": "Structured persona information."
          }
        },
        "pitfalls": [
          "Do not assume persona is always present in every session."
        ]
      },
      "source_dialogue_examples": {
        "summary": "Provides active character example dialogue as text and JSON.",
        "usage": "Use this when a graph should include character card example dialogue in the final prompt.",
        "ports": {
          "output": {
            "text": "Example dialogue rendered as text.",
            "json": "Structured example dialogue payload."
          }
        },
        "pitfalls": [
          "Not every character has example dialogue. Empty examples should be safe to ignore downstream."
        ]
      },
      "source_global_input": {
        "summary": "Broadcasts the current user input to same-named, type-compatible, unconnected input ports across the graph (excluding nodes inside subgraph groups).",
        "usage": "Use this when many nodes need the current user input but you do not want to wire each one by hand. Connect the value output to one input port (for example the narrator's user_input); at compile time it auto-connects to every same-named, type-compatible, unconnected input port.",
        "ports": {
          "output": {
            "value": "Broadcast value (current user input). Auto-connects to same-named, type-compatible, unconnected input ports at compile time."
          }
        },
        "pitfalls": [
          "Only broadcasts to input ports whose name matches the output port name (value).",
          "Nodes inside subgraph groups are skipped; wire their group.input boundary explicitly instead.",
          "An input port that already has an incoming edge is never re-broadcast."
        ]
      },
      "source_session_state": {
        "summary": "Provides current session state for prompts, checks, and templates.",
        "usage": "Use this when the graph needs stable game state, scene state, or other structured session state.",
        "ports": {
          "output": {
            "state": "Session state projection for prompt use.",
            "json": "Raw structured session state."
          }
        },
        "pitfalls": [
          "This node reads state. It does not write state changes. Use output.session_state_proposal for proposals."
        ]
      },
      "select_worldbook_match": {
        "summary": "Finds relevant worldbook entries for a query.",
        "usage": "Connect user input, history, or a template query to this node before rendering lore into final prompt messages.",
        "ports": {
          "input": {
            "query": "Text used to match worldbook entries.",
            "entries": "Optional worldbook entries or candidate set."
          },
          "output": {
            "selection": "Matched worldbook entries with metadata.",
            "text": "Matched worldbook entries rendered as text."
          }
        },
        "pitfalls": [
          "The quality of matches depends on the query text and the available worldbook entries."
        ]
      },
      "select_memory_retrieve": {
        "summary": "Retrieves relevant memory records for the current turn.",
        "usage": "Use this before prompt composition when long-term memory should influence the response.",
        "ports": {
          "input": {
            "query": "Text used to retrieve memory records."
          },
          "output": {
            "selection": "Retrieved memory records with metadata.",
            "text": "Retrieved memory rendered as prompt text."
          }
        },
        "pitfalls": [
          "Requires project.memory.read. Missing permission will make the graph fail validation."
        ]
      },
      "select_token_budget_allocator": {
        "summary": "Applies token budget choices to prompt blocks.",
        "usage": "Use this when prompt sections need deterministic pruning before final message assembly.",
        "ports": {
          "input": {
            "blocks": "Prompt blocks or budget candidates."
          },
          "output": {
            "blocks": "Budgeted prompt blocks.",
            "diagnostics": "Budget diagnostics and trimming notes."
          }
        },
        "pitfalls": [
          "This node cannot recover content that was not provided by upstream nodes."
        ]
      },
      "compose_session_state_projection_block": {
        "summary": "Turns session state into prompt-ready text and a prompt block.",
        "usage": "Use this after source.session_state when state should enter final prompt messages.",
        "ports": {
          "input": {
            "state": "State projection to render."
          },
          "output": {
            "block": "Prompt block built from session state.",
            "text": "Plain text representation of the same block."
          }
        },
        "pitfalls": [
          "State projection content depends on upstream state availability."
        ]
      },
      "compose_text_to_block": {
        "summary": "Wraps a text source as a prompt block.",
        "usage": "Use this between source nodes that output text and the compose.final_messages blocks input.",
        "ports": {
          "input": {
            "text": "Text to include as a prompt block."
          },
          "output": {
            "block": "Prompt block built from the input text."
          }
        },
        "config": {
          "fields": {
            "role": {
              "label": "Message role",
              "description": "Optional role hint when the block is used as a message."
            }
          }
        },
        "examples": [
          {
            "title": "Convert character text into a prompt block"
          }
        ],
        "pitfalls": [
          "Empty input text produces an empty block. Downstream composition may ignore empty blocks."
        ]
      },
      "compose_template_render": {
        "summary": "Renders a configured template with upstream JSON data.",
        "usage": "Use this for stable prompt sections, worldbook text wrapping, or custom instructions that need variables.",
        "ports": {
          "input": {
            "data": "Template data object."
          },
          "output": {
            "text": "Rendered template text.",
            "block": "Rendered text as a prompt block."
          }
        },
        "config": {
          "fields": {
            "template": {
              "label": "Template",
              "description": "Template text to render. The engine may also read content as a legacy alias."
            },
            "role": {
              "label": "Message role",
              "description": "Optional role hint when the rendered block is used as a message."
            }
          }
        },
        "examples": [
          {
            "title": "Render a system block"
          }
        ],
        "pitfalls": [
          "Invalid or missing template data can produce empty rendered text."
        ]
      },
      "compose_final_messages": {
        "summary": "Builds the final model messages from prompt blocks and history.",
        "usage": "Use this before narration or Agent nodes that need complete model messages.",
        "ports": {
          "input": {
            "blocks": "Prompt blocks to include in final messages.",
            "messages": "Existing messages, usually chat history."
          },
          "output": {
            "messages": "Final model messages.",
            "prompt_ir": "Compiled PromptIR view.",
            "diagnostics": "Prompt assembly diagnostics."
          }
        },
        "pitfalls": [
          "Missing key blocks may still produce messages, but the prompt can become incomplete."
        ]
      },
      "agent_director_plan": {
        "summary": "Runs a director Agent and returns planning guidance.",
        "usage": "Use this when the graph should obtain scene direction before narrator generation.",
        "ports": {
          "input": {
            "messages": "Messages used as director context.",
            "text": "Optional additional text context for the director Agent.",
            "user_input": "Current user input text (required) so the director always sees what the player said."
          },
          "output": {
            "brief": "Director planning brief.",
            "diagnostics": "Agent call diagnostics."
          }
        },
        "pitfalls": [
          "Requires project.agent.run and performs an LLM call."
        ]
      },
      "agent_player_agency_precheck": {
        "summary": "Checks player agency risk before generation.",
        "usage": "Use this when the response should be guided away from taking actions for the player.",
        "ports": {
          "input": {
            "messages": "Messages used as agency check context.",
            "text": "Optional additional text context for the agency check Agent.",
            "user_input": "Current user input text (required) to judge whether the player intent is respected."
          },
          "output": {
            "brief": "Precheck brief and recommendations.",
            "diagnostics": "Agent call diagnostics."
          }
        },
        "pitfalls": [
          "Requires project.agent.run and adds another LLM call to the run."
        ]
      },
      "agent_call": {
        "summary": "Runs a generic Agent call with configurable delivery and retention behavior.",
        "usage": "Use this for custom assistant, reviewer, memory, or workflow Agent calls that do not fit the built-in director and verifier nodes.",
        "ports": {
          "input": {
            "input": "Agent input payload.",
            "text": "Optional additional text context for the Agent call."
          },
          "output": {
            "result": "Raw Agent result payload.",
            "brief": "Agent brief when available.",
            "diagnostics": "Agent execution diagnostics."
          }
        },
        "config": {
          "fields": {
            "medium_kind": {
              "label": "Medium",
              "description": "How the Agent call is executed."
            },
            "medium_deliveryTarget": {
              "label": "Delivery target",
              "description": "Where the Agent result is delivered."
            },
            "agentBindingId": {
              "label": "Agent binding",
              "description": "Optional project Agent binding id. Required for some background job flows."
            },
            "triggerReason": {
              "label": "Trigger reason",
              "description": "Human-readable reason recorded for the call."
            },
            "temporaryConversationRequest": {
              "label": "Temporary conversation request",
              "description": "Delivery-specific request payload for temporary conversation based outputs."
            }
          }
        },
        "examples": [
          {
            "title": "Inline Agent result"
          }
        ],
        "pitfalls": [
          "Requires project.agent.run.",
          "background_job usually needs graph policy allowBackgroundJobs=true.",
          "Persistent delivery targets may need allowPersistentOutputs=true."
        ]
      },
      "narration_narrator": {
        "summary": "Generates the main assistant or narrator response text.",
        "usage": "Use this after compose.final_messages when a graph should produce the final narrative reply.",
        "ports": {
          "input": {
            "messages": "Final messages used for narration.",
            "text": "Optional additional text context for narration.",
            "user_input": "Current user input text (required) so narration always reflects what the player actually said."
          },
          "output": {
            "text": "Generated narrator text.",
            "diagnostics": "Narration diagnostics."
          }
        },
        "config": {
          "fields": {
            "presetRef_presetId": {
              "label": "Preset id",
              "description": "Optional preset id used by this narrator node."
            },
            "presetRef_presetVersionId": {
              "label": "Preset version id",
              "description": "Optional preset version id. If omitted, the active preset version is used."
            }
          }
        },
        "examples": [
          {
            "title": "Use session preset"
          }
        ],
        "pitfalls": [
          "This node performs the main LLM call and usually belongs in the response phase."
        ]
      },
      "verify_continuity": {
        "summary": "Checks whether generated text preserves scene and story continuity.",
        "usage": "Use this after narration and before commit decisions when continuity review is required.",
        "ports": {
          "input": {
            "text": "Generated text to verify.",
            "context": "Optional context used for verification."
          },
          "output": {
            "result": "Verifier result and decision data.",
            "diagnostics": "Verifier diagnostics."
          }
        },
        "pitfalls": [
          "Adds a post-response LLM call. Connect its result to output.commit_gate when it should affect commit decisions."
        ]
      },
      "verify_player_agency_postcheck": {
        "summary": "Checks whether generated text preserves player agency.",
        "usage": "Use this after narration when the system should catch outputs that decide the player character’s action or intent.",
        "ports": {
          "input": {
            "text": "Generated text to verify.",
            "context": "Optional context used for verification.",
            "user_input": "Current user input text (required) to judge whether the generated output respects the player intent."
          },
          "output": {
            "result": "Verifier result and decision data.",
            "diagnostics": "Verifier diagnostics."
          }
        },
        "pitfalls": [
          "Adds a post-response LLM call. Connect its result to output.commit_gate when it should block or warn."
        ]
      },
      "output_commit_gate": {
        "summary": "Decides whether generated text and related outputs can be committed.",
        "usage": "Use this as the final decision point for response text, verifier results, and output payloads.",
        "ports": {
          "input": {
            "text": "Generated text to commit.",
            "verifier": "Verifier result that may affect the decision.",
            "outputs": "Additional output payloads to include in the decision."
          },
          "output": {
            "decision": "Commit decision payload.",
            "diagnostics": "Commit gate diagnostics."
          }
        },
        "config": {
          "fields": {
            "mode": {
              "label": "Mode",
              "description": "Optional commit decision mode."
            },
            "requireVerifierPass": {
              "label": "Require verifier pass",
              "description": "Whether verifier failure should block the commit decision."
            }
          }
        },
        "examples": [
          {
            "title": "Commit generated text"
          }
        ],
        "pitfalls": [
          "A commit gate does not run verifiers by itself. Connect verifier nodes when verifier decisions matter."
        ]
      },
      "output_graph_run_summary": {
        "summary": "Produces a structured summary for a NodeGraph run.",
        "usage": "Use this when downstream UI or logs need a compact run summary.",
        "ports": {
          "input": {
            "result": "Result payload to summarize."
          },
          "output": {
            "summary": "Structured run summary.",
            "diagnostics": "Summary diagnostics."
          }
        },
        "pitfalls": [
          "This node summarizes provided result data. It does not persist records by itself."
        ]
      },
      "output_derived_output": {
        "summary": "Persists a JSON value as a derived project output.",
        "usage": "Use this when an Agent or graph result should be saved as a project-level derived record.",
        "ports": {
          "input": {
            "value": "Value to persist as a derived output record."
          },
          "output": {
            "record": "Created derived output record.",
            "diagnostics": "Write diagnostics."
          }
        },
        "pitfalls": [
          "Requires project.derived_output.write and graph policy allowPersistentOutputs=true for persistent outputs."
        ]
      },
      "output_project_inbox": {
        "summary": "Sends a structured payload to the project inbox.",
        "usage": "Use this for Agent proposals, review tasks, and graph outputs that need human approval.",
        "ports": {
          "input": {
            "payload": "Inbox payload to create."
          },
          "output": {
            "record": "Created inbox record.",
            "diagnostics": "Write diagnostics."
          }
        },
        "pitfalls": [
          "Requires project.inbox.write and may require allowPersistentOutputs=true."
        ]
      },
      "output_session_state_proposal": {
        "summary": "Produces a session state write proposal.",
        "usage": "Use this when a graph should suggest state changes without mixing state writes into prompt generation.",
        "ports": {
          "input": {
            "proposal": "Session state change proposal."
          },
          "output": {
            "proposal": "Normalized proposal payload.",
            "diagnostics": "Proposal diagnostics."
          }
        },
        "pitfalls": [
          "Requires session.state.write. The proposal still needs the appropriate runtime handling to become an actual state change."
        ]
      },
      "group_input": {
        "summary": "Defines an input boundary for a subgraph.",
        "usage": "Use this inside reusable subgraphs to expose values to the containing graph.",
        "ports": {
          "output": {
            "value": "Value entering the group boundary."
          }
        },
        "pitfalls": [
          "This node is mainly meaningful inside a subgraph boundary."
        ]
      },
      "group_output": {
        "summary": "Defines an output boundary for a subgraph.",
        "usage": "Use this inside reusable subgraphs to expose computed values to the containing graph.",
        "ports": {
          "input": {
            "value": "Value leaving the group boundary."
          },
          "output": {
            "value": "Value exposed to the containing graph."
          }
        },
        "pitfalls": [
          "This node is mainly meaningful inside a subgraph boundary."
        ]
      },
      "group_node": {
        "summary": "Instantiates a reusable subgraph as one node.",
        "usage": "Use this when a repeated graph segment should be edited and reused as a subgraph. Its ports are read from config.interface.",
        "config": {
          "fields": {
            "ref_graphId": {
              "label": "Graph id",
              "description": "Referenced graph definition id."
            },
            "ref_versionId": {
              "label": "Version id",
              "description": "Optional referenced graph version id."
            },
            "interface_inputs": {
              "label": "Inputs",
              "description": "Cached input boundary ports."
            },
            "interface_outputs": {
              "label": "Outputs",
              "description": "Cached output boundary ports."
            }
          }
        },
        "examples": [
          {
            "title": "Reference a subgraph"
          }
        ],
        "pitfalls": [
          "Ports are dynamic. Keep config.interface in sync with the referenced subgraph boundary."
        ]
      },
      "control_condition": {
        "summary": "Evaluates a safe structured condition and outputs true or false.",
        "usage": "Use this when several downstream control nodes should reuse the same condition result.",
        "ports": {
          "input": {
            "value": "Values available to the condition expression."
          },
          "output": {
            "result": "Boolean condition result."
          }
        },
        "config": {
          "fields": {
            "condition": {
              "label": "Condition",
              "description": "Structured condition expression. It is data, not executable code."
            }
          }
        },
        "examples": [
          {
            "title": "Check runtime intent"
          }
        ],
        "pitfalls": [
          "Control nodes require schemaVersion 2 when connected with control edges.",
          "The condition language is structured and cannot execute arbitrary code."
        ]
      },
      "control_branch": {
        "summary": "Splits control flow into true and false branches.",
        "usage": "Use this when only one of two downstream paths should run.",
        "ports": {
          "input": {
            "condition": "Boolean condition used to choose the branch."
          },
          "output": {
            "true": "Activated when the condition is true.",
            "false": "Activated when the condition is false."
          }
        },
        "config": {
          "fields": {
            "condition": {
              "label": "Inline condition",
              "description": "Optional structured condition. If omitted, the condition input port is used."
            }
          }
        },
        "examples": [
          {
            "title": "Inline branch condition"
          }
        ],
        "pitfalls": [
          "If no inline condition is configured, connect the condition input port."
        ]
      },
      "control_gate": {
        "summary": "Allows or skips downstream work based on a condition.",
        "usage": "Use this when a downstream node should run only when a condition passes, while also defining skip behavior.",
        "ports": {
          "input": {
            "condition": "Boolean condition that opens or closes the gate.",
            "value": "Values passed through when the gate is open."
          },
          "output": {
            "open": "Control output activated when the gate is open.",
            "value": "Passed-through value output."
          }
        },
        "config": {
          "fields": {
            "condition": {
              "label": "Condition",
              "description": "Optional structured condition. If omitted, the condition input port is used."
            },
            "onSkip": {
              "label": "On skip",
              "description": "How skipped downstream output should be handled."
            }
          }
        },
        "examples": [
          {
            "title": "Gate by runtime intent"
          }
        ],
        "pitfalls": [
          "If the gate has no condition input and no inline condition, it cannot make a useful decision."
        ]
      },
      "annotation_comment": {
        "summary": "Adds an editor-only note onthe canvas.",
        "usage": "Use this to explain graph sections, TODOs, or design intent for humans and Agents reading the graph.",
        "config": {
          "fields": {
            "content": {
              "label": "Content",
              "description": "Annotation text shown on the canvas."
            }
          }
        },
        "pitfalls": [
          "This node is never executed and does not affect PromptIR, validation result, or compat output."
        ]
      }
    },
    "phase": {
      "floor_prepare": "prepare",
      "pre_response": "pre",
      "response": "response",
      "post_response": "post",
      "commit": "commit"
    },
    "status": {
      "skipped": "skipped",
      "running": "running",
      "succeeded": "ok",
      "failed": "failed",
      "reused": "reused"
    },
    "previewStatus": {
      "available": "ready",
      "disabled": "disabled",
      "running": "previewing",
      "succeeded": "previewed",
      "failed": "preview failed"
    },
    "previewPolicy": {
      "auto": "auto preview",
      "cached_only": "cached only",
      "manual": "manual preview",
      "disabled": "preview disabled"
    }
  }
} as const;
