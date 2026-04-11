---
outline: [2, 3]
---

# Macros（宏系统）

本页说明 TavernHeadless 当前的 ST 宏兼容层。

它不是一个独立的 HTTP 资源，不提供单独的 `/macros` 路由。当前宏系统主要通过以下位置对外可见：

- `compat_strict` / `compat_plus` 提示词装配路径
- `POST /sessions/:id/respond/dry-run` 的调试输出
- `POST /sessions/:id/prompt-runtime/preview` 的单段文本预览输出
- `respond` / `regenerate` / `retry` / `editAndRegenerate` 的 assemble 与 commit 链路

如果你要看 dry-run、preview 或 live 返回字段，请同时参考 [Chat API](./chat) 和 [Prompt Runtime](./prompt-runtime)。

## 设计定位

当前文档采用 **ST Macro Compatibility (Core Profile)** 这个边界。

它的含义是：

- 兼容 ST 最常见的宏语法与值源
- 兼容宏与变量、预设、提示词之间的主链路联动
- 不承诺 100% 复刻 ST 旧宏引擎和实验性 Macro 2.0 的全部行为
- 不承诺兼容所有第三方扩展宏

## 当前支持范围

### 基础语法

当前支持：

```text
{{name}}
{{name arg}}
{{name::arg1::arg2}}
```

当前兼容层也会在解析前处理常见 legacy 别名：

```text
`<USER>` -> {{user}}
`<BOT>` -> {{char}}
`<CHAR>` -> {{char}}
`<GROUP>` -> 空字符串
`<CHARIFNOTGROUP>` -> {{char}}
```

### 常见只读宏

当前支持的常见只读宏包括但不限于：

```text
{{user}}
{{char}}
{{description}}
{{personality}}
{{scenario}}
{{persona}}
{{systemPrompt}}
{{defaultSystemPrompt}}
{{authorsNote}}
{{charAuthorsNote}}
{{defaultAuthorsNote}}
{{charPrompt}}
{{charInstruction}}
{{charDepthPrompt}}
{{mesExamples}}
{{mesExamplesRaw}}
{{model}}
{{maxPrompt}}
{{summary}}
{{lastMessage}}
{{lastUserMessage}}
{{lastCharMessage}}
{{lastGenerationType}}
```

字段缺失时，兼容层通常返回空字符串，而不是中断整个装配。

### 变量读取宏

当前支持：

```text
{{getvar::name}}
{{getglobalvar::name}}
{{hasvar::name}}
{{hasglobalvar::name}}
{{.name}}
{{$name}}
```

变量读取宏现在也支持结构化变量路径：

```text
{{getvar::资产.金币}}
{{getglobalvar::账户.余额}}
{{hasvar::资产.金币}}
{{.资产.金币}}
{{$账户['总余额']}}
```

当前 v3.1 只支持以下路径子集：

- 点路径
- 引号 key，例如 `角色['基础属性'].力量`

当前不支持：

- 数组下标
- 通配符
- 递归下降
- 过滤表达式

### 变量写入宏

当前支持：

```text
{{setvar::name::value}}
{{setglobalvar::name::value}}
{{addvar::name::n}}
{{addglobalvar::name::n}}
{{incvar::name}}
{{decvar::name}}
{{incglobalvar::name}}
{{decglobalvar::name}}
{{deletevar::name}}
{{deleteglobalvar::name}}
```

变量写入宏也支持结构化变量路径：

```text
{{setvar::资产.金币::3}}
{{setglobalvar::账户.余额::100}}
{{addvar::资产.金币::2}}
{{deletevar::资产.银币}}
```

兼容规则固定为：

- 先按完整 flat key 读取或写入
- 找不到完整 key 时，才按路径语义处理
- 路径写入最终持久化的是 root key 对应的 JSON 值，不会额外生成 `资产.金币` 这样的底层变量 key

### `if` 条件块

当前支持以下条件表达式子集：

- truthy / falsy
- `==`
- `!=`
- `>`
- `<`
- `>=`
- `<=`
- `and`
- `or`
- `not`
- `contains`
- `startsWith`
- 括号分组

示例：

```text
{{if {{flag}}}}YES{{else}}NO{{/if}}
{{if {{getvar::mood}} == happy}}YES{{else}}NO{{/if}}
{{if ({{score}} >= 80) and not ({{rank}} == banned)}}PASS{{else}}FAIL{{/if}}
{{if {{title}} contains veteran}}YES{{else}}NO{{/if}}
```

当前固定语义如下：

- `==` / `!=`：两侧都能解析为有限数字时按数字比较，否则按字符串比较
- `>` / `<` / `>=` / `<=`：只做数值比较
- `contains` / `startsWith`：按区分大小写的字符串谓词处理
- `and` / `or`：按短路语义求值
- 未命中分支和短路未求值一侧不会执行写宏

## 回退与错误处理

以下情况会保留原始 `if` block 文本，并返回结构化 warning：

1. 语法超出当前支持子集，例如算术表达式 `+`、`*`、`/`
   - 返回 `macro_condition_unsupported`
2. 表达式结构不合法，例如括号未闭合、token 顺序错误
   - 返回 `macro_parse_failed`
3. 运算要求数值比较，但操作数无法解析为数字
   - 返回 `macro_arg_type_invalid`

运行时不会把这些情况回退成普通 truthy 判断。

## 变量作用域兼容视图

TavernHeadless 底层变量系统是五级作用域：

`page`
`floor`
`branch`
`chat`
`global`

ST 宏兼容层不会直接把这五层原样暴露给模板，而是提供两类兼容视图：

- local 兼容视图
- global 兼容视图

当前语义如下：

| 宏 | 兼容视图 |
| ---- | ---- |
| `.name` / `getvar::name` / `hasvar::name` | local |
| `$name` / `getglobalvar::name` / `hasglobalvar::name` | global |
| `setvar` / `addvar` / `incvar` / `decvar` / `deletevar` | 只写 local overlay |
| `setglobalvar` / `addglobalvar` / `incglobalvar` / `decglobalvar` / `deleteglobalvar` | 只写 global overlay |

这意味着：

- local staged 值不会污染 global 读取
- global staged 值不会污染 local 读取
- 同轮 assemble 的可见性按各自作用域单独生效
- 当 `POST /sessions/:id/prompt-runtime/preview` 对一个尚未物化的新分支同时传入 `branch_id` 和 `source_floor_id` 时，local 兼容视图会先继承 source floor 当时可见的 local 值，再进入 preview overlay

## 执行边界

宏系统当前不是在所有场景都直接执行副作用。

| 场景 | 只读宏 | 写宏 | 是否写库 |
| ---- | ---- | ---- | ---- |
| 资产导入 | 不执行主求值 | 不执行 | 否 |
| Prompt Runtime preview（单段文本） | 执行 | 只记录 preview mutation | 否 |
| Prompt dry-run | 执行 | 只记录 preview mutation | 否 |
| respond / regenerate assemble | 执行 | 进入 staged mutation buffer | 否 |
| turn commit | 不重新展开宏文本 | 消费 assemble 冻结结果 | 是 |
| turn failed / cancelled / rollback | 可保留调试文本 | 丢弃 staged mutation | 否 |

因此：

- dry-run 一定无副作用
- commit 阶段默认不重新执行宏文本
- 写宏是否真正落库，取决于 assemble 是否成功并进入 commit

## 运行时结构

当前宏运行时内部已经不是单纯的字符串级替换。

内部使用的是最小稳定节点结构，主要包括：

- text node
- macro node
- if block node
- raw fragment node

这样做的作用是：

- 保持求值顺序稳定
- 保持 `if` 只展开命中的分支
- 保持 `and` / `or` 的短路侧不执行写宏
- 在 parse 失败和 unsupported condition 场景下保留原文
- 为 warning 和 trace 提供更稳定的定位点

## Warning 与 Trace

当前运行时会产生结构化 warning 与 trace。

### 常见 warning code

| code | 说明 |
| ---- | ---- |
| `macro_unknown` | 未识别宏 |
| `macro_arg_arity_invalid` | 参数形状不在当前支持子集内 |
| `macro_condition_unsupported` | `if` 条件表达式使用了当前不支持的语法 |
| `macro_parse_failed` | `if` 条件表达式结构无法正确解析，或变量路径语法不合法 |
| `macro_arg_type_invalid` | `if` 条件表达式的操作数类型不满足当前运算要求，或变量路径下探遇到非对象值 |
| `macro_cycle_detected` | 检测到重复展开路径 |
| `macro_depth_limit_exceeded` | 超过最大展开深度 |
| `macro_step_limit_exceeded` | 超过最大求值步数 |
| `macro_expanded_length_limit_exceeded` | 超过展开文本长度限制 |
| `macro_mutation_limit_exceeded` | 超过写宏预算 |
| `macro_unmatched_closing_block` | 存在未匹配 closing block |
| `macro_scoped_block_unclosed` | 存在未闭合 block |

### Trace 字段

当前 `macro_traces` 中常见字段包括：

| 字段 | 说明 |
| ---- | ---- |
| `macro_name` | 宏名 |
| `raw_text` | 原始片段 |
| `resolved_text` | 求值后文本 |
| `phase` | 当前阶段 |
| `source_kind` | `macro` / `if` / `raw` |
| `selected_branch` | `if` 命中分支：`then` / `else` / `raw` |

## 在 API 中如何看到这些信息

当前最直接的入口有两个：

```http
POST /sessions/:id/respond/dry-run
POST /sessions/:id/prompt-runtime/preview
```

当提示词装配命中了宏系统时，调试输出中可能看到：

- `runtime_trace.macro.warnings`
- `runtime_trace.macro.used_names`
- `runtime_trace.macro.mutation_preview`
- `runtime_trace.macro.staged_mutations`
- `runtime_trace.macro.traces`

服务内的 `assembly` 兼容层仍会保留相关字段，但当前对外更稳定的观测面是 `runtime_trace.macro`。

当 mutation value 是对象时，对外的 `mutation_preview` / `staged_mutations` 会使用稳定 JSON 字符串表示。

其中：

- preview 只返回单段文本与 `runtime_trace`，不返回完整 `messages` / `assembly`
- preview 的 `runtime_trace.macro.staged_mutations` 固定为空
- dry-run 仍然返回完整 prompt 组装结果，适合查看 `messages`、`assembly` 与 `prompt_snapshot`

这些字段用于调试和诊断，不应被当作独立资源的持久化契约。

## 与 Variables API 的关系

`/variables` 资源描述的是 TavernHeadless 底层五级变量真相模型。

宏系统只是其上的兼容视图，不改变底层真相：

`/variables` 仍然暴露 `global` / `chat` / `branch` / `floor` / `page`

- ST 宏中的 local / global 只是提示词运行时兼容语义
- commit 时仍按既有 `scope` 提交到底层变量系统

因此，Variables API 和宏兼容层是两个层次：

1. Variables API 负责真实持久化与查询
2. 宏兼容层负责模板运行时的 ST 语义映射

## 当前文档边界

本页只记录当前已经落地的实现边界。

本页不承诺：

- 完整 ST Macro 2.0 表达式语言
- 所有第三方扩展宏
- 所有历史 corner case
- 所有 shorthand 赋值语法

如果后续兼容范围扩大，应同步更新本页、Chat API 文档，以及相关测试说明。
