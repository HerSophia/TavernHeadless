import type { MemoryScope } from '@tavern/shared';

export interface MemoryRevisionRef {
  accountId: string;
  scope: MemoryScope;
  scopeId: string;
}

export interface MemoryRevisionSnapshot extends MemoryRevisionRef {
  revision: number;
}

export class MemoryRevisionConflictError extends Error {
  constructor(
    public readonly ref: MemoryRevisionRef,
    public readonly expectedRevision: number,
    public readonly actualRevision: number,
  ) {
    super(
      `Memory revision conflict for ${ref.accountId}::${ref.scope}::${ref.scopeId}: expected ${expectedRevision}, got ${actualRevision}`,
    );
    this.name = 'MemoryRevisionConflictError';
  }
}

export class MemoryRevisionGuard {
  snapshot(ref: MemoryRevisionRef, revision: number): MemoryRevisionSnapshot {
    return {
      ...ref,
      revision,
    };
  }

  assertExpected(snapshot: MemoryRevisionSnapshot, actualRevision: number): void {
    if (snapshot.revision !== actualRevision) {
      throw new MemoryRevisionConflictError(
        {
          accountId: snapshot.accountId,
          scope: snapshot.scope,
          scopeId: snapshot.scopeId,
        },
        snapshot.revision,
        actualRevision,
      );
    }
  }
}
