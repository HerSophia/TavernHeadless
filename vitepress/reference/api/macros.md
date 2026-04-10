---
outline: [2, 3]
---

# Macros（宏系统）

本页说明 TavernHeadless 当前的 ST 宏兼容层。

它不是一个独立的 HTTP 资源，不提供单独的 `/macros` 路由。当前宏系统主要通过以下位置对外可见：

`compat_strict` / `compat_plus` 提示词装配路径
`POST /sessions/:id/respond/dry-run` 的调试输出
`respond` / `regenerate` / `retry` / `editAndRegenerate` 的 assemble 与 commit 链路

如果你要看 dry-run 返回字段，请同时参考 [Chat API](./chat)。

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

### `if` 条件块

当前只支持最小子集：

- truthy / falsy
`==`
`!=`

示例：

```text
{{if {{flag}}}}YES{{else}}NO{{/if}}
{{if {{getvar::mood}} == happy}}YES{{else}}NO{{/if}}
{{if {{getvar::mood}} != sad}}YES{{else}}NO{{/if}}
```

## 当前不支持的条件表达式

以下表达式当前不支持：

`>`
`<`
`>=`
`<=`
`and`
`or`
`not`
`contains`
`startsWith`

对这类表达式，运行时当前采用明确的保守策略：

1. 不把它当作普通 truthy 文本
2. 不尝试猜测结果
3. 保留原始 `if` block 文本
4. 返回 `macro_condition_unsupported` warning

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

## 执行边界

宏系统当前不是在所有场景都直接执行副作用。

| 场景 | 只读宏 | 写宏 | 是否写库 |
| ---- | ---- | ---- | ---- |
| 资产导入 | 不执行主求值 | 不执行 | 否 |
| 文本预览 / 编辑器预览 | 执行 | 只记录 preview mutation | 否 |
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
- 在 parse 失败和 unsupported condition 场景下保留原文
- 为 warning 和 trace 提供更稳定的定位点

## Warning 与 Trace

当前运行时会产生结构化 warning 与 trace。

### 常见 warning code

| code | 说明 |
| ---- | ---- |
| `macro_unknown` | 未识别宏 |
| `macro_arg_arity_invalid` | 参数形状不在当前支持子集内 |
| `macro_condition_unsupported` | `if` 条件表达式不在当前支持子集内 |
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

当前最直接的入口是：

```http
POST /sessions/:id/respond/dry-run
```

当提示词装配命中了宏系统时，调试输出中可能看到：

`assembly.macro_warnings`
`assembly.macro_used_names`
`assembly.macro_mutation_preview`
`assembly.macro_staged_mutations`
`assembly.macro_traces`

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
