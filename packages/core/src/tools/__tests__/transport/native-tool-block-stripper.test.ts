import { describe, expect, it } from 'vitest';

import {
  NativeToolBlockStreamBuffer,
  stripNativeToolBlocksPreservingTrailingMalformed,
  containsNativeToolBlock,
} from '../../transport/index.js';

/**
 * 把一段完整文本按给定切分点拆成多个 chunk，逐个喂进流式 buffer，
 * 拼接 process 输出与 finalize 残留，模拟流式到达的最终可见文本。
 */
function streamStrip(chunks: string[]): string {
  const buffer = new NativeToolBlockStreamBuffer();
  let output = '';
  for (const chunk of chunks) {
    output += buffer.process(chunk);
  }
  output += buffer.finalize();
  return output;
}

describe('stripNativeToolBlocksPreservingTrailingMalformed', () => {
  it('剥离系统定义的 tool_call 文本块，保留前后正文', () => {
    const text = ['Before', '<tool_call id="c1" name="find_node">', '{"args":{}}', '</tool_call>', 'After'].join(
      '\n',
    );

    expect(stripNativeToolBlocksPreservingTrailingMalformed(text)).toBe('Before\n\nAfter');
  });

  it('剥离系统定义的 tool_result 文本块', () => {
    const text = 'Hello<tool_result id="c1" name="find_node" status="success">{"data":{}}</tool_result>World';

    expect(stripNativeToolBlocksPreservingTrailingMalformed(text)).toBe('HelloWorld');
  });

  it('剥离模型自创的 tool_response 文本块', () => {
    const text = 'Answer head<tool_response>{"foo":"bar"}</tool_response>Answer tail';

    expect(stripNativeToolBlocksPreservingTrailingMalformed(text)).toBe('Answer headAnswer tail');
  });

  it('在一段文本里同时剥离三类标签块', () => {
    const text = [
      'A',
      '<tool_call name="x">call</tool_call>',
      'B',
      '<tool_result name="x">result</tool_result>',
      'C',
      '<tool_response>response</tool_response>',
      'D',
    ].join('');

    expect(stripNativeToolBlocksPreservingTrailingMalformed(text)).toBe('ABCD');
  });

  it('剥离带属性的开标签', () => {
    const text = '<tool_call\n  id="c1"\n  name="read_graph">\n{"args":{"id":"g1"}}\n</tool_call>done';

    expect(stripNativeToolBlocksPreservingTrailingMalformed(text)).toBe('done');
  });

  it('支持同名标签嵌套', () => {
    const text = 'x<tool_call>outer<tool_call>inner</tool_call>tail</tool_call>y';

    expect(stripNativeToolBlocksPreservingTrailingMalformed(text)).toBe('xy');
  });

  it('容忍尾部未闭合的工具块，按原样保留', () => {
    const text = 'visible<tool_call id="c1" name="x">partial without close';

    expect(stripNativeToolBlocksPreservingTrailingMalformed(text)).toBe(
      'visible<tool_call id="c1" name="x">partial without close',
    );
  });

  it('不误伤不构成工具标签的相似文本', () => {
    const text = '价格小于 <tool_count 个，且 a < b 仍然是普通正文';

    expect(stripNativeToolBlocksPreservingTrailingMalformed(text)).toBe(text);
  });

  it('不误伤同前缀但不同名的标签', () => {
    const text = '看 <tool_calls> 与 <tool_responses> 这种复数标签不应被当作工具块';

    expect(stripNativeToolBlocksPreservingTrailingMalformed(text)).toBe(
      '看 <tool_calls> 与 <tool_responses> 这种复数标签不应被当作工具块',
    );
  });

  it('纯正文原样返回（trim 后）', () => {
    const text = '这是一段最终回答，没有任何工具往返。';

    expect(stripNativeToolBlocksPreservingTrailingMalformed(text)).toBe(text);
  });
});

describe('NativeToolBlockStreamBuffer 流式分块', () => {
  it('流式逐字符喂入时与终值剥离结果一致', () => {
    const text = 'Before<tool_response>{"foo":"bar"}</tool_response>After';
    const chunks = text.split('');

    expect(streamStrip(chunks)).toBe('BeforeAfter');
  });

  it('开标签被切断在两个 chunk 之间时不泄漏半截标签', () => {
    const chunks = ['Hello<tool', '_call name="x">body</tool_call>Bye'];

    expect(streamStrip(chunks)).toBe('HelloBye');
  });

  it('tool_result 与 tool_response 共享前缀，分块切断时仍能正确归类', () => {
    const chunks = ['head<tool_res', 'ponse>payload</tool_response>tail'];

    expect(streamStrip(chunks)).toBe('headtail');
  });

  it('闭标签被切断在两个 chunk 之间时块仍被完整剥离', () => {
    const chunks = ['a<tool_call>x</tool_c', 'all>b'];

    expect(streamStrip(chunks)).toBe('ab');
  });

  it('流式尾部未闭合时按原样保留', () => {
    const chunks = ['ok<tool_call name="x">still ', 'streaming'];

    expect(streamStrip(chunks)).toBe('ok<tool_call name="x">still streaming');
  });

  it('多块跨多个 chunk 边界时全部剥离', () => {
    const chunks = [
      'p1',
      '<tool_call>a',
      '</tool_call>p2<tool_res',
      'ult>b</tool_result>',
      'p3',
    ];

    expect(streamStrip(chunks)).toBe('p1p2p3');
  });
});

describe('containsNativeToolBlock', () => {
  it('识别三类有效开标签', () => {
    expect(containsNativeToolBlock('a<tool_call>x</tool_call>b')).toBe(true);
    expect(containsNativeToolBlock('a<tool_result name="x">y</tool_result>b')).toBe(true);
    expect(containsNativeToolBlock('a<tool_response>z</tool_response>b')).toBe(true);
  });

  it('识别带属性与未闭合的开标签', () => {
    expect(containsNativeToolBlock('<tool_call id="c1" name="x">partial')).toBe(true);
  });

  it('不含工具块的普通文本返回 false', () => {
    expect(containsNativeToolBlock('这是一段最终回答，没有工具往返。')).toBe(false);
  });

  it('不误判同前缀但不同名的复数标签', () => {
    expect(containsNativeToolBlock('看 <tool_calls> 与 <tool_responses>')).toBe(false);
  });
});

