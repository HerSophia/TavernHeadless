import { describe, it, expect } from 'vitest';
import {
  resolvePromptRuntimeSourceDescriptor,
  resolvePromptRuntimeSourceGovernanceLevel,
  type PromptRuntimeSourceGovernanceLevel,
} from '../runtime-registry.js';

describe('PromptRuntime source governance level registry', () => {
  it('对历史源默认治理级别可被 budget 裁剪', () => {
    expect(resolvePromptRuntimeSourceGovernanceLevel('history')).toBe('budget_prunable');
  });

  it('对世界书默认治理级别可被 budget 裁剪', () => {
    expect(resolvePromptRuntimeSourceGovernanceLevel('worldbook')).toBe('budget_prunable');
  });

  it('对 examples 默认治理级别可被 budget 裁剪', () => {
    expect(resolvePromptRuntimeSourceGovernanceLevel('examples')).toBe('budget_prunable');
  });

  it('对 memory 默认治理级别为 soft_required（对外可关，在装配后不宜裁剪）', () => {
    expect(resolvePromptRuntimeSourceGovernanceLevel('memory')).toBe('soft_required');
  });

  it('对 native_system 默认治理级别为 hard_required（原生系统段必须固定保留）', () => {
    expect(resolvePromptRuntimeSourceGovernanceLevel('native_system')).toBe('hard_required');
  });

  it('未知来源返回 undefined，不假定治理意图', () => {
    expect(resolvePromptRuntimeSourceGovernanceLevel('unknown')).toBeUndefined();
    expect(resolvePromptRuntimeSourceGovernanceLevel('')).toBeUndefined();
  });

  it('resolver 结果与 descriptor.defaultGovernanceLevel 字段保持一致', () => {
    const kinds: Array<{ kind: string; expected: PromptRuntimeSourceGovernanceLevel | undefined }> = [
      { kind: 'history', expected: 'budget_prunable' },
      { kind: 'memory', expected: 'soft_required' },
      { kind: 'worldbook', expected: 'budget_prunable' },
      { kind: 'examples', expected: 'budget_prunable' },
      { kind: 'native_system', expected: 'hard_required' },
    ];

    for (const entry of kinds) {
      const descriptor = resolvePromptRuntimeSourceDescriptor(entry.kind);
      expect(descriptor?.defaultGovernanceLevel).toBe(entry.expected);
      expect(resolvePromptRuntimeSourceGovernanceLevel(entry.kind)).toBe(entry.expected);
    }
  });
});
