import { describe, expect, it } from 'vitest';

import {
  SCOPE_PRIORITY,
  buildBranchVariableScopeId,
  isBranchVariableScopeId,
  parseBranchVariableScopeId,
} from '../variable.js';

describe('variable scope helpers', () => {
  it('keeps branch between floor and chat in scope priority', () => {
    expect(SCOPE_PRIORITY).toEqual(['page', 'floor', 'branch', 'chat', 'global']);
  });

  it('builds and parses branch scope ids', () => {
    const scopeId = buildBranchVariableScopeId('session:1', 'alt/main');

    expect(scopeId).toBe('branch:session%3A1:alt%2Fmain');
    expect(parseBranchVariableScopeId(scopeId)).toEqual({
      sessionId: 'session:1',
      branchId: 'alt/main',
    });
  });

  it('detects invalid branch scope ids', () => {
    expect(isBranchVariableScopeId('chat:session-1')).toBe(false);
    expect(parseBranchVariableScopeId('branch:session-1')).toBeNull();
    expect(parseBranchVariableScopeId('branch::main')).toBeNull();
  });
});
