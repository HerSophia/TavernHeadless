import { describe, expect, it } from 'vitest';
import { jsonSchema } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';

import { LLMService } from '../llm-service.js';
import { ProviderRegistry } from'../provider-registry.js';
import type { ModelConfig, ProviderFactory } from '../types.js';

// 验证设计 4.3 的关键假设：
//   工具不带 execute 时，Vercel AI SDK 在该步只返回 toolCalls 并停止，不自动执行。
// 这是 native agent loop 自驱动循环成立的前提。

function createMockRegistry(mockModel: any): ProviderRegistry {
  const registry = new ProviderRegistry();
  const factory: ProviderFactory = () => () => mockModel;
  registry.registerFactory('test', factory);
  registry.register({ id: 'test-provider', type: 'test' as any });
  return registry;
}

const defaultModel: ModelConfig = {
 providerId: 'test-provider',
  modelId: 'test-model',
};

function buildToolCallModel(): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [
        {
          type: 'tool-call',
          toolCallId: 'call_1',
          toolName: 'graph_query',
          // provider 层 input 是字符串化 JSON
          input: JSON.stringify({ q: 'a' }),
        },
      ],
  finishReason: { unified: 'tool-calls', raw: undefined },
      usage: {
        inputTokens: { total: 4, noCache: 4, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 2, text: 2, reasoning: undefined },
        raw: { totalTokens: 6 },
      },
      warnings: [],
    }),
  });
}

describe('native function calling：schema-only 工具不自动执行', () => {
  it('工具不带 execute 时，SDK 只返回 toolCalls 不执行', async () => {
    const model = buildToolCallModel();
    const registry = createMockRegistry(model);
    const service = new LLMService(registry, defaultModel);

    const response = await service.generate({
      messages: [{ role: 'user', content: '查询 a' }],
      params: { stream: false },
      // schema-only 工具：仅 description + inputSchema，没有 execute
      tools: {
        graph_query: {
          description: '查询图',
          inputSchema: jsonSchema({
            type: 'object',
            properties: { q: { type: 'string' } },
     }),
        },
      },
      toolChoice: 'auto',
      maxSteps: 1,
    });

    // SDK 返回了结构化工具调用
    expect(response.toolCalls).toBeDefined();
    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls?.[0]).toMatchObject({
      callId: 'call_1',
      toolName: 'graph_query',
      args: { q: 'a' },
    });
    // 没有 execute，不存在工具执行结果（SDK 未自动执行）
    const steps = response.steps ?? [];
    expect(steps.length).toBeGreaterThanOrEqual(1);
    for (const step of steps) {
      expect(step.toolResults).toEqual([]);
    }
  });
});
