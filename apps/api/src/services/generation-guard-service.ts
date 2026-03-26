export class GenerationGuardConflictError extends Error {
  constructor(
    public readonly sessionId: string,
    public readonly branchId: string,
  ) {
    super(`Generation is already in progress for session '${sessionId}' branch '${branchId}'`);
    this.name = "GenerationGuardConflictError";
  }
}

/**
 * 单进程内的生成互斥守卫。
 *
 * 以 sessionId + branchId 为键，防止同一分支并发占用下一次生成资格。
 */
export class GenerationGuardService {
  private readonly activeKeys = new Set<string>();

  async runExclusive<T>(
    sessionId: string,
    branchId: string,
    task: () => Promise<T>,
  ): Promise<T> {
    const release = this.acquire(sessionId, branchId);

    try {
      return await task();
    } finally {
      release();
    }
  }

  acquire(sessionId: string, branchId: string): () => void {
    const key = this.makeKey(sessionId, branchId);
    if (this.activeKeys.has(key)) {
      throw new GenerationGuardConflictError(sessionId, branchId);
    }

    this.activeKeys.add(key);

    return () => {
      this.activeKeys.delete(key);
    };
  }

  isActive(sessionId: string, branchId: string): boolean {
    return this.activeKeys.has(this.makeKey(sessionId, branchId));
  }

  private makeKey(sessionId: string, branchId: string): string {
    return `${sessionId}::${branchId}`;
  }
}
