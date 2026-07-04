import { describe, expect, it } from 'vitest';

import type { ToolParameterSchema } from '../../types.js';
import { coerceTextProtocolToolArgs } from '../../transport/index.js';

function schema(
  properties: ToolParameterSchema['properties'],
): ToolParameterSchema {
  return { type: 'object', properties };
}

describe('coerceTextProtocolToolArgs', () => {
  it('把 "true" / "false" 字符串按 boolean schema 还原为布尔', () => {
    const result = coerceTextProtocolToolArgs(
      { recursive: 'true', dryRun: 'false' },
      schema({
        recursive: { type: 'boolean' },
        dryRun: { type: 'boolean' },
      }),
    );

    expect(result).toEqual({ recursive: true, dryRun: false });
  });

  it('非 true/false 的字符串在 boolean schema 下保持原样', () => {
    const result = coerceTextProtocolToolArgs(
      { recursive: 'yes' },
      schema({ recursive: { type: 'boolean' } }),
    );

    expect(result).toEqual({ recursive: 'yes' });
  });

  it('把纯数字字符串按 number / integer schema 还原为数字', () => {
 const result = coerceTextProtocolToolArgs(
      { count: '3', ratio: '-2.5' },
      schema({
        count: { type: 'integer' },
        ratio: { type: 'number' },
      }),
    );

    expect(result).toEqual({ count: 3, ratio: -2.5 });
  });

  it('小数字符串在 integer schema 下不转换', () => {
    const result = coerceTextProtocolToolArgs(
      { count: '3.5' },
      schema({ count: { type: 'integer' } }),
    );

    expect(result).toEqual({ count: '3.5' });
  });

  it('非数字字符串在 number schema 下保持原样', () => {
    const result = coerceTextProtocolToolArgs(
      { count: '3a' },
      schema({ count: { type: 'number' } }),
    );

    expect(result).toEqual({ count: '3a' });
  });

  it('把 JSON 数组字符串按 array schema 还原为数组', () => {
    const result = coerceTextProtocolToolArgs(
      { tags: '["a", "b"]' },
      schema({ tags: { type: 'array', items: { type: 'string' } } }),
    );

    expect(result).toEqual({ tags: ['a', 'b'] });
  });

  it('非数组的 JSON 字符串在 array schema 下保持原样', () => {
    const result = coerceTextProtocolToolArgs(
      { tags: '{"a":1}' },
      schema({ tags: { type: 'array', items: { type: 'string' } } }),
    );

    expect(result).toEqual({ tags: '{"a":1}' });
  });

  it('非法 JSON 的 array 字符串保持原样', () => {
    const result = coerceTextProtocolToolArgs(
      { tags: '[a, b' },
      schema({ tags: { type: 'array', items: { type: 'string' } } }),
    );

    expect(result).toEqual({ tags: '[a, b' });
  });

  it('非字符串值不被处理', () => {
    const result = coerceTextProtocolToolArgs(
      { count: 3, recursive: true },
      schema({
        count: { type: 'integer' },
        recursive: { type: 'boolean' },
      }),
    );

    expect(result).toEqual({ count: 3, recursive: true });
  });

  it('schema 未声明的参数保持原样', () => {
    const result = coerceTextProtocolToolArgs(
      { unknown: 'true' },
      schema({ known: { type: 'boolean' } }),
    );

    expect(result).toEqual({ unknown: 'true' });
  });

  it('不递归进入嵌套对象', () => {
    const result = coerceTextProtocolToolArgs(
      { node: { active: 'true' } },
      schema({ node: { type: 'object' } }),
    );

    expect(result).toEqual({ node: { active: 'true' } });
});

  it('没有任何转换时返回传入的原引用', () => {
    const args = { name: 'foo' };
    const result = coerceTextProtocolToolArgs(
      args,
      schema({ name: { type: 'string' } }),
    );

    expect(result).toBe(args);
  });

  it('缺少 parameters 时返回原引用，不做任何转换', () => {
    const args = { recursive: 'true' };
    const result = coerceTextProtocolToolArgs(args, undefined);

    expect(result).toBe(args);
  });
});
