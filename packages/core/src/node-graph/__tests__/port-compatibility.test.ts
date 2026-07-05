import { describe, expect, it } from 'vitest';

import { arePortTypesCompatible } from '../validator.js';
import { NODE_GRAPH_PORT_TYPES, type NodeGraphPortType } from '../types.js';

describe('arePortTypesCompatible', () => {
  it('相同类型互相兼容', () => {
    for (const type of NODE_GRAPH_PORT_TYPES) {
      expect(arePortTypesCompatible(type, type)).toBe(true);
    }
  });

  it('输出端为 any 时与任意输入端兼容', () => {
    for (const to of NODE_GRAPH_PORT_TYPES) {
      expect(arePortTypesCompatible('any', to)).toBe(true);
    }
  });

  it('输入端为 any 时接受任意输出端', () => {
    for (const from of NODE_GRAPH_PORT_TYPES) {
      expect(arePortTypesCompatible(from, 'any')).toBe(true);
    }
  });

  it('输入端为 json 时接受任意输出端', () => {
    for (const from of NODE_GRAPH_PORT_TYPES) {
      expect(arePortTypesCompatible(from, 'json')).toBe(true);
    }
  });

  it('不同的非通配类型互不兼容', () => {
    expect(arePortTypesCompatible('text', 'number')).toBe(false);
    expect(arePortTypesCompatible('messages', 'prompt_ir')).toBe(false);
    expect(arePortTypesCompatible('boolean', 'text')).toBe(false);
  });

  it('json 作为输出端不能连到不兼容的具体输入端', () => {
    const nonJsonInputs = NODE_GRAPH_PORT_TYPES.filter(
      (type): type is NodeGraphPortType => type !== 'json' && type !== 'any',
    );
    for (const to of nonJsonInputs) {
      expect(arePortTypesCompatible('json', to)).toBe(false);
    }
  });
});
