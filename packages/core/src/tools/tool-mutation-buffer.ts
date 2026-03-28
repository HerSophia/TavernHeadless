import type { VariableEntry, VariableScope } from '@tavern/shared';

import type { BufferedToolVariableMutation } from './types.js';

function toMutationKey(args: {
  accountId?: string;
  scope: VariableScope;
  scopeId: string;
  key: string;
}): string {
  return [args.accountId ?? '', args.scope, args.scopeId, args.key].join('\u001f');
}

function toEntry(mutation: BufferedToolVariableMutation): VariableEntry {
  return {
    id: `buffer:${mutation.runId}:${mutation.generationAttemptNo}:${mutation.scope}:${mutation.scopeId}:${mutation.key}`,
    scope: mutation.scope,
    scopeId: mutation.scopeId,
    key: mutation.key,
    value: mutation.value,
    updatedAt: mutation.bufferedAt,
  };
}

export class ToolMutationBuffer {
  private readonly attempts = new Map<number, Map<string, BufferedToolVariableMutation>>();

  constructor(private readonly runId: string) {}

  upsert(args: {
    generationAttemptNo: number;
    scope: VariableScope;
    scopeId: string;
    key: string;
    value: unknown;
    accountId?: string;
    bufferedAt?: number;
  }): VariableEntry {
    const attempt = this.getAttempt(args.generationAttemptNo, true);
    const mutationKey = toMutationKey(args);
    const mutation: BufferedToolVariableMutation = {
      runId: this.runId,
      generationAttemptNo: args.generationAttemptNo,
      scope: args.scope,
      scopeId: args.scopeId,
      key: args.key,
      value: args.value,
      ...(args.accountId ? { accountId: args.accountId } : {}),
      bufferedAt: args.bufferedAt ?? Date.now(),
    };

    attempt.set(mutationKey, mutation);
    return toEntry(mutation);
  }

  findByKey(args: {
    generationAttemptNo: number;
    scope: VariableScope;
    scopeId: string;
    key: string;
    accountId?: string;
  }): VariableEntry | null {
    const attempt = this.attempts.get(args.generationAttemptNo);
    if (!attempt) {
      return null;
    }

    const mutation = attempt.get(toMutationKey(args));
    return mutation ? toEntry(mutation) : null;
  }

  findAllByScope(args: {
    generationAttemptNo: number;
    scope: VariableScope;
    scopeId: string;
    accountId?: string;
  }): VariableEntry[] {
    const attempt = this.attempts.get(args.generationAttemptNo);
    if (!attempt) {
      return [];
    }

    const entries: VariableEntry[] = [];
    for (const mutation of attempt.values()) {
      if (mutation.scope !== args.scope) {
        continue;
      }
      if (mutation.scopeId !== args.scopeId) {
        continue;
      }
      if ((mutation.accountId ?? undefined) !== (args.accountId ?? undefined)) {
        continue;
      }

      entries.push(toEntry(mutation));
    }

    return entries.sort((a, b) => {
      if (a.updatedAt !== b.updatedAt) {
        return a.updatedAt - b.updatedAt;
      }
      return a.key.localeCompare(b.key);
    });
  }

  snapshot(generationAttemptNo: number): BufferedToolVariableMutation[] {
    const attempt = this.attempts.get(generationAttemptNo);
    if (!attempt) {
      return [];
    }

    return Array.from(attempt.values())
      .sort((a, b) => {
        if (a.bufferedAt !== b.bufferedAt) {
          return a.bufferedAt - b.bufferedAt;
        }

        const byScope = a.scope.localeCompare(b.scope);
        if (byScope !== 0) {
          return byScope;
        }

        const byScopeId = a.scopeId.localeCompare(b.scopeId);
        if (byScopeId !== 0) {
          return byScopeId;
        }

        return a.key.localeCompare(b.key);
      })
      .map((mutation) => ({ ...mutation }));
  }

  discardGenerationAttempt(generationAttemptNo: number): void {
    this.attempts.delete(generationAttemptNo);
  }

  clear(): void {
    this.attempts.clear();
  }

  private getAttempt(generationAttemptNo: number, createIfMissing: boolean): Map<string, BufferedToolVariableMutation> {
    const existing = this.attempts.get(generationAttemptNo);
    if (existing) {
      return existing;
    }

    if (!createIfMissing) {
      return new Map();
    }

    const attempt = new Map<string, BufferedToolVariableMutation>();
    this.attempts.set(generationAttemptNo, attempt);
    return attempt;
  }
}
