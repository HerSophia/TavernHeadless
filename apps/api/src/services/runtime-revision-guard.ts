import type { RuntimeScopeRef } from "./runtime-job-types.js";

export interface RuntimeRevisionSnapshot extends RuntimeScopeRef {
  revision: number;
}

export class RuntimeRevisionConflictError extends Error {
  constructor(
    public readonly ref: RuntimeScopeRef,
    public readonly expectedRevision: number,
    public readonly actualRevision: number,
  ) {
    super(
      `Runtime revision conflict for ${ref.accountId}::${ref.scopeType}::${ref.scopeKey}: expected ${expectedRevision}, got ${actualRevision}`,
    );
    this.name = "RuntimeRevisionConflictError";
  }
}

export class RuntimeRevisionGuard {
  snapshot(ref: RuntimeScopeRef, revision: number): RuntimeRevisionSnapshot {
    return {
      ...ref,
      revision,
    };
  }

  assertExpected(snapshot: RuntimeRevisionSnapshot, actualRevision: number): void {
    if (snapshot.revision !== actualRevision) {
      throw new RuntimeRevisionConflictError(
        {
          accountId: snapshot.accountId,
          scopeType: snapshot.scopeType,
          scopeKey: snapshot.scopeKey,
        },
        snapshot.revision,
        actualRevision,
      );
    }
  }
}
