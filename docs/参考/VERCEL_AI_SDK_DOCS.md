# Vercel AI SDK 文档整理

本文档基于 [Vercel AI SDK 文档](https://ai-sdk.dev/docs/foundations/providers-and-models) 整理，重点介绍了 Providers 和 Models 的基础知识。

## 1. 基础：提供商与模型 (Foundations: Providers and Models)

### 1.1 概述

不同的 AI 公司（如 OpenAI, Anthropic）作为**提供商 (Providers)**，通过各自的 API 提供一系列的大型语言模型 (LLMs)。

AI SDK Core 提供了一种标准化的方法来与这些 LLM 进行交互。它通过**语言模型规范 (Language Model Specification)** 抽象了不同提供商之间的差异。这使得开发者可以轻松切换提供商，而无需修改大量的代码，因为所有提供商都使用统一的 API。

### 1.2 AI SDK Providers

AI SDK 支持广泛的提供商。以下是一些主要的官方维护的 Provider 包：

* **OpenAI Provider**: `@ai-sdk/openai`
* **Anthropic Provider**: `@ai-sdk/anthropic`
* **Google Generative AI Provider**: `@ai-sdk/google`
* **Azure OpenAI Provider**: `@ai-sdk/azure`
* **Amazon Bedrock Provider**: `@ai-sdk/amazon-bedrock`
* **Mistral Provider**: `@ai-sdk/mistral`
* **xAI Grok Provider**: `@ai-sdk/xai`
* **DeepSeek Provider**: `@ai-sdk/deepseek`
* **Cohere Provider**: `@ai-sdk/cohere`

此外，还支持 **OpenAI Compatible** 提供商（如 LM Studio, Heroku）。

社区也维护了大量的 Provider，例如 Ollama, Cloudflare Workers AI, OpenRouter 等。

### 1.3 自托管模型 (Self-Hosted Models)

你可以通过以下 Provider 访问自托管模型：

* Ollama Provider
* LM Studio
* Built-in AI
* 任何支持 OpenAI 规范的自托管服务（使用 OpenAI Compatible Provider）

### 1.4 模型能力 (Model Capabilities)

不同的模型具有不同的能力。主要关注点包括：

* **Image Input**: 是否支持图片输入（多模态）。
* **Object Generation**: 是否支持结构化对象生成。
* **Tool Usage**: 是否支持工具调用。
* **Tool Streaming**: 是否支持工具调用的流式传输。

以下是一些常见模型及其 ID 示例：

| Provider | Model ID 示例 |
| :--- | :--- |
| **xAI Grok** | `grok-2-1212`, `grok-beta`, `grok-vision-beta` |
| **OpenAI** | `gpt-4o`, `gpt-4-turbo`, `gpt-3.5-turbo` |
| **Anthropic** | `claude-3-5-sonnet-latest`, `claude-3-opus-20240229` |
| **Google** | `gemini-1.5-pro`, `gemini-1.5-flash` |
| **DeepSeek** | `deepseek-chat`, `deepseek-reasoner` |
| **Mistral** | `mistral-large-latest`, `pixtral-large-latest` |
| **Groq** | `llama-3.3-70b-versatile`, `mixtral-8x7b-32768` |

## 2. AI SDK Core 核心概念

AI SDK Core 是 Vercel AI SDK 的核心部分，提供了统一的 API 来进行文本生成、结构化数据生成和工具调用。

### 2.1 主要功能

* **Generating Text**: 生成文本回复。
* **Generating Structured Data**: 生成符合特定 Schema 的 JSON 数据。
* **Tool Calling**: 让模型调用外部工具（这是 Agent 的基础）。
* **Prompt Engineering**: 提示词工程支持。
* **Embeddings**: 生成文本嵌入向量。
* **Image Generation**: 图像生成。

### 2.2 统一接口优势

无论底层使用的是 OpenAI 还是 Anthropic，开发者调用的函数（如 `generateText`, `streamText`）和参数结构基本保持一致。这极大地降低了多模型适配的复杂度。

## 3. 提示词 (Prompts)

AI SDK 支持多种形式的提示词输入，以适应不同的使用场景。

### 3.1 提示词类型

* **Text Prompts**: 简单的字符串提示。适用于单一指令生成。

    ```javascript
    const result = await generateText({
      model: openai('gpt-4o'),
      prompt: 'Invent a new holiday.',
    });
    ```

* **System Prompts**: 用于设定模型的行为准则、角色或上下文。可与 `prompt` 或 `messages` 配合使用。

    ```javascript
    const result = await generateText({
      model: openai('gpt-4o'),
      system: 'You are a helpful travel assistant.',
      prompt: 'Suggest a trip to Paris.',
    });
    ```

* **Message Prompts**: 适用于聊天场景，包含角色（`user`, `assistant`, `system`, `tool`）和内容的消息数组。

    ```javascript
    const result = await generateText({
      model: openai('gpt-4o'),
      messages: [
        { role: 'user', content: 'Hi!' },
        { role: 'assistant', content: 'Hello!' },
      ],
    });
    ```

### 3.2 消息内容类型 (Content Parts)

`content` 可以是简单的字符串，也可以是包含多种媒体类型的数组（多模态）：

* **Text Part**: `{ type: 'text', text: '...' }`
* **Image Part**: `{ type: 'image', image: ... }`
  * 支持 Base64 字符串、Data URL、Uint8Array/Buffer、URL 字符串。
* **File Part**: `{ type: 'file', data: ..., mediaType: '...' }`
  * 目前仅部分模型（如 Google Gemini, GPT-4o Audio）支持 PDF 或音频文件输入。

### 3.3 Provider Options

可以通过 `providerOptions` 传递特定提供商的参数。支持在三个层级设置：

1. **Function Call Level**: 全局设置（如 `generateText` 的参数中）。
2. **Message Level**: 单条消息设置。
3. **Message Part Level**: 消息片段设置（如图片的清晰度 `imageDetail`）。

### 3.4 工具消息 (Tool Messages)

涉及工具调用时的消息流：

1. **Assistant Message**: 包含 `tool-call` 部分。
2. **Tool Message**: 包含 `tool-result` 部分，反馈工具执行结果。

## 4. 文本生成与流式传输 (Generating & Streaming Text)

### 4.1 核心函数

* **`generateText`**: 适用于非交互式、一次性生成任务（如总结、邮件草拟）。
  * 返回结果包含：`text` (生成文本), `toolCalls` (工具调用), `usage` (Token 用量), `finishReason` (结束原因) 等。
* **`streamText`**: 适用于即时交互场景（如聊天机器人）。
  * 返回结果包含：`textStream` (AsyncIterable 文本流), `fullStream` (包含所有事件的流)。

### 4.2 流式传输详解

流式传输能显著降低首字节时间 (TTFB)。

```javascript
import { streamText } from 'ai';

const result = streamText({
  model: openai('gpt-4o'),
  prompt: 'Write a poem.',
});

// 消费文本流
for await (const textPart of result.textStream) {
  process.stdout.write(textPart);
}
```

### 4.3 高级功能

* **Callbacks**: 支持 `onFinish` (生成结束), `onError` (错误处理), `onChunk` (处理每个数据块)。
* **Full Stream**: 通过 `result.fullStream` 可以访问更细粒度的事件流（如 `text-delta`, `tool-call`, `reasoning-delta`, `source`）。
* **Sources**: 支持获取来源信息（如 Google 搜索结果），通过 `result.sources` 或 `fullStream` 中的 `source` 事件访问。
* **Transformations**: 使用 `experimental_transform` 可对流进行转换（例如 `smoothStream` 用于平滑输出）。

## 5. 设置 (Settings)

除了 `model` 和 `prompt` 外，常用的生成配置包括：

* **`maxOutputTokens`**: 最大生成 Token 数。
* **`temperature`**: 生成随机性 (推荐与 `topP` 二选一)。0 表示最确定，值越高越随机。
* **`topP`**: 核采样 (Nucleus sampling)。
* **`topK`**: 仅从概率最高的 K 个 token 中采样 (仅高级场景使用)。
* **`presencePenalty`**: 存在惩罚 (减少重复信息)。
* **`frequencyPenalty`**: 频率惩罚 (减少重复词汇)。
* **`stopSequences`**: 停止序列数组，遇到即停止生成。
* **`seed`**: 随机种子 (整数)，用于确定性生成。
* **`maxRetries`**: 最大重试次数 (默认为 2)。
* **`abortSignal`**: 用于取消请求或设置超时。
* **`headers`**: 自定义 HTTP 请求头。

## 6. 提供商与模型管理 (Provider & Model Management)

为了更方便地管理多个提供商和模型，AI SDK 提供了自定义提供商和注册表功能。

### 6.1 自定义提供商 (Custom Providers)

使用 `customProvider` 可以：

* **预配置设置**: 例如强制开启特定模型的 `reasoningEffort: 'high'`。
* **模型别名**: 将复杂的模型 ID (如 `anthropic/claude-3-5-sonnet-20240620`) 映射为简短的别名 (如 `sonnet`)。
* **限制模型**: 仅暴露特定的模型列表。

### 6.2 提供商注册表 (Provider Registry)

使用 `createProviderRegistry` 可以集中管理多个提供商，并通过字符串 ID 访问模型。

```javascript
import { createProviderRegistry } from 'ai';
import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';

export const registry = createProviderRegistry({
  openai,
  anthropic,
});

// 使用方式
const model = registry.languageModel('openai:gpt-4o');
```

### 6.3 全局提供商 (Global Provider)

AI SDK 5 允许设置全局默认提供商，从而在调用模型时省略提供商前缀。

```javascript
import { openai } from '@ai-sdk/openai';

// 在应用启动时设置
globalThis.AI_SDK_DEFAULT_PROVIDER = openai;

// 之后可以直接使用模型名
const result = await streamText({
  model: 'gpt-4o', 
  prompt: '...'
});
```

## 7. 错误处理 (Error Handling)

### 7.1 常规错误

对于 `generateText` 等函数，可以直接使用 `try-catch` 捕获错误。

```javascript
try {
  const result = await generateText({ ... });
} catch (error) {
  console.error(error);
}
```

### 7.2 流式错误

对于 `streamText`，简单的 `textStream` 消费可以通过外部 `try-catch` 捕获同步错误，但异步流中的错误建议在 `fullStream` 中处理。

**使用 fullStream 处理错误**:

```javascript
const { fullStream } = streamText({ ... });

for await (const part of fullStream) {
  if (part.type === 'error') {
    console.error('Stream Error:', part.error);
  }
}
```

### 7.3 处理中止 (Aborts)

当流被中止（如用户点击停止）时：

1. 可以使用 `onAbort` 回调进行清理工作（此时 `onFinish` 不会触发）。
2. 或者在 `fullStream` 中监听 `part.type === 'abort'` 事件。

## 8. 测试 (Testing)

AI SDK 提供了 `ai/test` 模块，包含用于单元测试的 Mock 工具，无需调用真实 API 即可测试逻辑。

* **`MockLanguageModelV3`**: 模拟语言模型，通过 `doGenerate` 或 `doStream` 自定义返回内容。
* **`simulateReadableStream`**: 模拟流数据，支持自定义 chunk 和延迟。

### 示例：测试 streamText

```javascript
import { streamText, simulateReadableStream } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';

const result = streamText({
  model: new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'text-delta', delta: 'Hello' },
          { type: 'text-delta', delta: ' World' },
          { type: 'finish', finishReason: 'stop' }
        ]
      })
    })
  }),
  prompt: 'Test'
});
```

## 9. 常用 Provider 详解

### 9.1 OpenAI (`@ai-sdk/openai`)

**注意**: AI SDK 6 现已发布，默认使用 OpenAI Responses API。

* **安装**: `pnpm add @ai-sdk/openai`
* **引入**: `import { openai } from '@ai-sdk/openai';`

#### 9.1.1 模型创建 (Language Models)

* **默认 (Responses API)**: `openai('gpt-5')` (AI SDK 5+ 默认使用 Responses API)。
* **指定 API**:
  * `openai.responses('gpt-5')`: 显式使用 Responses API。
  * `openai.chat('gpt-4o')`: 使用 Chat API (旧版兼容)。
  * `openai.completion('gpt-3.5-turbo-instruct')`: 使用 Completion API。

#### 9.1.2 提供商选项 (Provider Options)

通过 `providerOptions` 可配置丰富的 OpenAI 特性：

```javascript
const result = await generateText({
  model: openai('gpt-5'),
  providerOptions: {
    openai: {
      reasoningEffort: 'medium', // 'none' (GPT-5.1), 'low', 'medium', 'high', 'xhigh'
      reasoningSummary: 'auto',   // 'auto' (简略), 'detailed' (详细)
      serviceTier: 'auto',        // 'flex' (低成本), 'priority' (高速), 'auto'
      textVerbosity: 'medium',    // 'low', 'medium', 'high'
      store: true,                // 是否存储生成结果
      metadata: { userId: '123' },// 自定义元数据
      strictJsonSchema: true,     // 结构化输出是否使用严格模式
    }
  }
});
```

* **Reasoning Summary**: `reasoningSummary: 'auto' | 'detailed'`。在流式传输中，思考过程会以 `reasoning` 事件返回；在非流式中，通过 `result.reasoning` 访问。
* **Service Tier**: 支持 `flex` (50% 价格，高延迟) 和 `priority` (高速)。

#### 9.1.3 内置工具 (Built-in Tools)

OpenAI Provider 提供了一系列强大的内置工具：

1. **Web Search (`openai.tools.webSearch`)**:
    * 支持联网搜索，可配置 `userLocation` (城市/地区)。
    * 结果包含在 `result.sources` 或工具结果中。
2. **File Search (`openai.tools.fileSearch`)**:
    * 基于 Vector Store 的文件搜索。
    * 可配置 `vectorStoreIds`, `maxNumResults`, `filters`。
3. **Image Generation (`openai.tools.imageGeneration`)**:
    * 多模态生图工具 (如 GPT-5 变体支持)。
    * 支持配置 `quality`, `size`, `outputFormat`。
4. **Code Interpreter (`openai.tools.codeInterpreter`)**:
    * Python 代码执行沙箱。
    * 支持上传文件 (`fileIds`)。
5. **MCP Tool (`openai.tools.mcp`)**:
    * 直接连接 Model Context Protocol (MCP) 服务器。
    * 需配置 `serverUrl` 或 `connectorId`。
6. **Shell Tools (GPT-5.1/Codex)**:
    * `localShell`: 本地 Shell 执行。
    * `shell`: 建议 Shell 命令。
    * `applyPatch`: 代码库文件修改 (Diffs)。

#### 9.1.4 多模态输入 (Multimodal)

* **图片**: 支持 `type: 'image'` (Base64, URL, File ID)。
* **PDF**: 支持 `type: 'file', mediaType: 'application/pdf'`。模型可读取 PDF 内容并回答问题。

### 9.2 Anthropic (`@ai-sdk/anthropic`)

* **安装**: `pnpm add @ai-sdk/anthropic`
* **引入**: `import { anthropic } from '@ai-sdk/anthropic';`

#### 9.2.1 模型与配置

* **模型创建**: `anthropic('claude-3-7-sonnet-20250219')` (支持多模态)。
* **Provider Options**:

    ```javascript
    const result = await generateText({
      model: anthropic('claude-opus-4-20250514'),
      providerOptions: {
        anthropic: {
          effort: 'medium',            // 'high' (默认), 'medium', 'low'
          thinking: {                  // 启用推理 (Claude 3.7+ / Opus 4+)
            type: 'enabled',
            budgetTokens: 12000
          },
          contextManagement: {         // 自动上下文管理
            edits: [{ type: 'clear_tool_uses_20250919', trigger: { type: 'input_tokens', value: 10000 }, keep: { type: 'tool_uses', value: 5 } }]
          },
          disableParallelToolUse: false,
          toolStreaming: true
        }
      }
    });
    ```

#### 9.2.2 缓存控制 (Prompt Caching)

支持 `ephemeral` 缓存，部分模型（如 Haiku 4.5+）支持长达 1 小时的 TTL。

```javascript
providerOptions: {
  anthropic: { cacheControl: { type: 'ephemeral', ttl: '1h' } }
}
```

#### 9.2.3 内置工具 (Built-in Tools)

Anthropic 提供了丰富的特定领域工具（需注意模型兼容性）：

1. **Computer Use (`anthropic.tools.computer_20241022`)**:
    * 控制鼠标和键盘操作。需配合 `claude-3-5-sonnet` 等支持模型。
2. **Web Search (`anthropic.tools.webSearch_20250305`)**:
    * 联网搜索，支持 `allowedDomains`, `blockedDomains`, `userLocation`。
3. **Web Fetch (`anthropic.tools.webFetch_20250910`)**:
    * 抓取特定 URL 内容。
4. **Bash Tool (`anthropic.tools.bash_20241022`)**:
    * 执行 Bash 命令。
5. **Text Editor (`anthropic.tools.textEditor_20250728`)**:
    * 文件查看与编辑 (`str_replace`, `insert`, `view` 等)。
6. **Tool Search**:
    * 动态工具发现（支持 BM25 或 Regex 搜索）。

### 9.3 Google Generative AI (`@ai-sdk/google`)

* **安装与配置**:
  * 安装: `pnpm add @ai-sdk/google`
  * 引入: `import { google } from '@ai-sdk/google';`
  * 自定义: 使用 `createGoogleGenerativeAI` 配置 `baseURL`, `apiKey` 等。
* **模型创建**: `google('gemini-2.0-flash')`, `google('gemini-1.5-pro')` 等。
* **Provider Options (`providerOptions: { google: { ... } }`)**:
  * **`safetySettings`**: 安全设置数组，包含 `category` (如 `HARM_CATEGORY_HATE_SPEECH`) 和 `threshold` (如 `BLOCK_LOW_AND_ABOVE`)。
  * **`cachedContent`**: 指定缓存内容资源名称 (`cachedContents/{name}`)。
  * **`structuredOutputs`**: 是否启用结构化输出（默认为 `true`，某些 schema 不支持时可禁用）。
* **高级特性**:
  * **思考 (Thinking)**: Gemini 3 使用 `thinkingLevel`，Gemini 2.5 使用 `thinkingBudget`。
  * **接地 (Grounding)**: 支持 `google.tools.googleSearch` (搜索), `google.tools.googleMaps` (地图)。
  * **缓存**: Gemini 2.5+ 支持隐式缓存（Implicit Caching），无需额外配置即可享受前缀缓存优惠。
  * **多模态**: 支持 YouTube URL 直接作为输入。

### 9.4 Groq (`@ai-sdk/groq`)

* **特点**: 高速推理，适合实时应用。
* **模型**: `groq('llama-3.3-70b-versatile')`, `qwen-qwq-32b` (推理模型)。
* **服务等级**: 支持 `serviceTier` ('flex', 'on_demand', 'auto')。

### 9.5 DeepSeek (`@ai-sdk/deepseek`)

* **安装**: `pnpm add @ai-sdk/deepseek`
* **引入**: `import { deepseek } from '@ai-sdk/deepseek';`
* **模型**:
  * `deepseek('deepseek-chat')`: 通用对话模型，支持工具调用。
  * `deepseek('deepseek-reasoner')`: 推理模型 (Reasoning)。
* **推理 (Reasoning)**:
  * `deepseek-reasoner` 在流式传输中通过 `reasoning` 事件返回思考过程。

    ```javascript
    for await (const part of result.fullStream) {
      if (part.type === 'reasoning') console.log('Thinking:', part.textDelta);
    }
    ```

* **缓存统计**:
  * 通过 `result.providerMetadata.deepseek` 访问 `promptCacheHitTokens` 和 `promptCacheMissTokens`。

### 9.6 xAI Grok (`@ai-sdk/xai`)

* **安装**: `pnpm add @ai-sdk/xai`
* **引入**: `import { xai } from '@ai-sdk/xai';`
* **模型**:
  * `xai('grok-3')`: 标准模型。
  * `xai('grok-4')` / `xai('grok-4-fast')`: 新一代模型。
* **Responses API (Agentic Tools)**:
  * 使用 `xai.responses('grok-4-fast')` 启用服务端工具。
  * **支持工具**: `xai.tools.webSearch`, `xai.tools.xSearch` (Twitter), `xai.tools.codeExecution` (Python)。
* **Live Search (Chat API)**:
  * 通过 `providerOptions` 配置实时搜索。

    ```javascript
    providerOptions: {
      xai: {
        searchParameters: {
          mode: 'on',
          returnCitations: true,
          sources: [
            { type: 'web', allowedWebsites: ['arxiv.org'] },
            { type: 'x', includedXHandles: ['grok'] },
            { type: 'news', country: 'US' }
          ]
        }
      }
    }
    ```

* **高级选项**:
  * `reasoningEffort`: 'low' | 'medium' | 'high'。
