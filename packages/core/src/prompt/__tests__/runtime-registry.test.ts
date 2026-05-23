import { describe, expect, it } from 'vitest';

import {
  buildPromptRuntimeSectionBudgetGroup,
  resolvePromptRuntimeBudgetGroupDefaults,
  resolvePromptRuntimeBudgetGroupDescriptor,
  resolvePromptRuntimeBudgetGroupExclusionSource,
  resolvePromptRuntimeBudgetGroupTraceLabel,
  resolvePromptRuntimeSourceDescriptor,
} from '../runtime-registry.js';

describe('prompt runtime registry', () => {
  it('declares first-stage source descriptors through the registry', () => {
    expect(resolvePromptRuntimeSourceDescriptor('history')).toMatchObject({
      kind: 'history',
      defaultBudgetGroup: 'history',
      traceLabel: 'history',
      exclusionSource: 'history',
    });

    expect(resolvePromptRuntimeSourceDescriptor('state_projection')).toMatchObject({
      kind: 'state_projection',
      defaultBudgetGroup: 'section:stateProjection',
      traceLabel: 'state_projection',
    });

    expect(resolvePromptRuntimeSourceDescriptor('section:main')).toMatchObject({
      kind: 'section:*',
      defaultBudgetGroup: 'section:*',
      traceLabel: 'section',
    });
  });

  it('builds concrete section fallback groups from the registry prefix', () => {
    expect(buildPromptRuntimeSectionBudgetGroup('main')).toBe('section:main');
  });

  it('matches wildcard budget group defaults through the registry', () => {
    expect(resolvePromptRuntimeBudgetGroupDescriptor('section:main')).toMatchObject({
      group: 'section:*',
      defaultWeight: 1,
      defaultPruneOrder: 300,
    });

    expect(resolvePromptRuntimeBudgetGroupDefaults('section:main')).toEqual({
      weight: 1,
      pruneOrder: 300,
    });
  });

  it('maps exclusion sources only for public runtime source groups', () => {
    expect(resolvePromptRuntimeBudgetGroupExclusionSource('history')).toBe('history');
    expect(resolvePromptRuntimeBudgetGroupExclusionSource('section:main')).toBeUndefined();
    expect(resolvePromptRuntimeBudgetGroupExclusionSource('custom')).toBeUndefined();
  });

  it('keeps trace labels stable for registered and fallback groups', () => {
    expect(resolvePromptRuntimeBudgetGroupTraceLabel('worldbook')).toBe('worldbook');
    expect(resolvePromptRuntimeBudgetGroupTraceLabel('section:main')).toBe('section:main');
    expect(resolvePromptRuntimeBudgetGroupTraceLabel('section:stateProjection')).toBe('state_projection');
    expect(resolvePromptRuntimeBudgetGroupTraceLabel('custom')).toBe('custom');
  });

  it('falls back to the default protection class for unknown groups', () => {
    expect(resolvePromptRuntimeBudgetGroupDefaults('custom')).toEqual({
      weight: 1,
      pruneOrder: 150,
    });
  });
});
