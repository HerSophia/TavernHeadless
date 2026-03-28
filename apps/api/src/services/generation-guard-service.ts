import { nanoid } from "nanoid";

export type GenerationExecutionMode = "reject" | "queue";

export interface CoordinatorRuntime {
  requestId: string;
  acquiredAt: number;
  abortSignal: AbortSignal;
}

export interface GenerationCoordinatorExecutionInput<T> {
  sessionId: string;
  branchId: string;
  mode: GenerationExecutionMode;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
  onQueued?: (position: number) => void;
  task: (runtime: CoordinatorRuntime) => Promise<T>;
}

export interface GenerationCoordinator {
  execute<T>(input: GenerationCoordinatorExecutionInput<T>): Promise<T>;
}

export class GenerationCoordinatorConflictError extends Error {
  constructor(
    public readonly sessionId: string,
    public readonly branchId: string,
  ) {
    super(`Generation is already in progress for session '${sessionId}' branch '${branchId}'`);
    this.name = "GenerationCoordinatorConflictError";
  }
}

export class GenerationCoordinatorQueueTimeoutError extends Error {
  constructor(
    public readonly sessionId: string,
    public readonly branchId: string,
    public readonly timeoutMs: number,
  ) {
    super(`Generation queue wait timed out after ${timeoutMs}ms for session '${sessionId}' branch '${branchId}'`);
    this.name = "GenerationCoordinatorQueueTimeoutError";
  }
}

export class GenerationCoordinatorCancelledError extends Error {
  constructor(
    public readonly sessionId: string,
    public readonly branchId: string,
  ) {
    super(`Generation was cancelled before execution started for session '${sessionId}' branch '${branchId}'`);
    this.name = "GenerationCoordinatorCancelledError";
  }
}

type QueuedExecution<T> = {
  requestId: string;
  sessionId: string;
  branchId: string;
  timeoutMs?: number;
  task: (runtime: CoordinatorRuntime) => Promise<T>;
  abortSignal?: AbortSignal;
  abortListener?: () => void;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;

  timer?: ReturnType<typeof setTimeout>;
  cancelled: boolean;
};

type QueueState = {
  active: boolean;
  queue: QueuedExecution<unknown>[];
};

/**
 * 单实例内存协调器。
 *
 * Phase 1 默认仍按 sessionId::branchId 做 reject。
 * 同时保留 queue 模式能力，供后续工作流启用。
 */
export class InMemoryGenerationCoordinator implements GenerationCoordinator {
  private readonly states = new Map<string, QueueState>();

  async execute<T>(input: GenerationCoordinatorExecutionInput<T>): Promise<T> {
    this.throwIfAborted(input.sessionId, input.branchId, input.abortSignal);
    if (input.mode === "queue") {
      return this.executeQueued(input);
    }

    return this.executeReject(input);
  }

  async runExclusive<T>(
    sessionId: string,
    branchId: string,
    task: () => Promise<T>,
  ): Promise<T> {
    return this.execute({
      sessionId,
      branchId,
      mode: "reject",
      task: async () => task(),
    });
  }

  acquire(sessionId: string, branchId: string): () => void {
    const key = this.makeKey(sessionId, branchId);
    const state = this.ensureState(key);

    if (state.active || state.queue.length > 0) {
      throw new GenerationCoordinatorConflictError(sessionId, branchId);
    }

    state.active = true;

    return () => {
      this.release(key);
    };
  }

  isActive(sessionId: string, branchId: string): boolean {
    return this.states.get(this.makeKey(sessionId, branchId))?.active === true;
  }

  private async executeReject<T>(input: GenerationCoordinatorExecutionInput<T>): Promise<T> {
    const release = this.acquire(input.sessionId, input.branchId);
    const runtime = this.createRuntime(undefined, input.abortSignal);

    try {
      this.throwIfAborted(input.sessionId, input.branchId, input.abortSignal);
      return await input.task(runtime);
    } finally {
      release();
    }
  }

  private async executeQueued<T>(input: GenerationCoordinatorExecutionInput<T>): Promise<T> {
    const key = this.makeKey(input.sessionId, input.branchId);
    const state = this.ensureState(key);

    if (!state.active && state.queue.length === 0) {
      this.throwIfAborted(input.sessionId, input.branchId, input.abortSignal);
      state.active = true;
      const runtime = this.createRuntime(undefined, input.abortSignal);

      try {
        this.throwIfAborted(input.sessionId, input.branchId, input.abortSignal);
        return await input.task(runtime);
      } finally {
        this.release(key);
      }
    }

    return new Promise<T>((resolve, reject) => {
      let queued!: QueuedExecution<T>;
      const rejectAsCancelled = () => {
        if (queued.cancelled) {
          return;
        }

        queued.cancelled = true;
        this.removeQueuedExecution(key, queued);
        reject(new GenerationCoordinatorCancelledError(input.sessionId, input.branchId));
      };

      queued = {
        requestId: nanoid(),
        sessionId: input.sessionId,
        branchId: input.branchId,
        timeoutMs: input.timeoutMs,
        task: input.task,
        abortSignal: input.abortSignal,
        resolve,
        reject,
        cancelled: false,
      };

      if (queued.abortSignal) {
        if (queued.abortSignal.aborted) {
          reject(new GenerationCoordinatorCancelledError(input.sessionId, input.branchId));
          return;
        }

        queued.abortListener = () => rejectAsCancelled();
        queued.abortSignal.addEventListener("abort", queued.abortListener, { once: true });
        if (queued.abortSignal.aborted) {
          rejectAsCancelled();
          return;
        }
      }

      state.queue.push(queued as QueuedExecution<unknown>);

      try {
        input.onQueued?.(state.queue.length);
      } catch {
        // 观测型回调不应破坏主流程。
      }

      if (input.timeoutMs && input.timeoutMs > 0) {
        queued.timer = setTimeout(() => {
          if (queued.cancelled) {
            return;
          }

          queued.cancelled = true;
          this.removeQueuedExecution(key, queued);
          reject(new GenerationCoordinatorQueueTimeoutError(
            input.sessionId,
            input.branchId,
            input.timeoutMs!,
          ));
        }, input.timeoutMs);
      }
    });
  }

  private async runQueuedExecution<T>(
    key: string,
    queued: QueuedExecution<T>,
    runtime: CoordinatorRuntime,
  ): Promise<void> {
    try {
      const value = await queued.task(runtime);
      queued.resolve(value);
    } catch (error) {
      queued.reject(error);
    } finally {
      this.release(key);
    }
  }

  private release(key: string): void {
    const state = this.states.get(key);
    if (!state) {
      return;
    }

    while (state.queue.length > 0) {
      const next = state.queue.shift() as QueuedExecution<unknown> | undefined;
      if (!next) {
        break;
      }

      this.clearQueuedTimer(next);
      this.clearQueuedAbortListener(next);
      if (next.cancelled) {
        continue;
      }

      if (next.abortSignal?.aborted) {
        next.cancelled = true;
        next.reject(new GenerationCoordinatorCancelledError(next.sessionId, next.branchId));
        continue;
      }

      const runtime = this.createRuntime(next.requestId, next.abortSignal);
      void this.runQueuedExecution(key, next, runtime);
      return;
    }

    state.active = false;
    this.cleanupState(key);
  }

  private removeQueuedExecution<T>(key: string, queued: QueuedExecution<T>): void {
    const state = this.states.get(key);
    if (!state) {
      return;
    }

    const index = state.queue.indexOf(queued as QueuedExecution<unknown>);
    if (index >= 0) {
      state.queue.splice(index, 1);
    }

    this.clearQueuedTimer(queued);
    this.clearQueuedAbortListener(queued);
    this.cleanupState(key);
  }

  private clearQueuedTimer<T>(queued: QueuedExecution<T>): void {
    if (queued.timer) {
      clearTimeout(queued.timer);
      queued.timer = undefined;
    }
  }

  private clearQueuedAbortListener<T>(queued: QueuedExecution<T>): void {
    if (queued.abortSignal && queued.abortListener) {
      queued.abortSignal.removeEventListener("abort", queued.abortListener);
      queued.abortListener = undefined;
    }
  }

  private createRuntime(requestId = nanoid(), abortSignal?: AbortSignal): CoordinatorRuntime {
    return {
      requestId,
      acquiredAt: Date.now(),
      abortSignal: abortSignal ?? new AbortController().signal,
    };
  }

  private throwIfAborted(
    sessionId: string,
    branchId: string,
    abortSignal?: AbortSignal,
  ): void {
    if (abortSignal?.aborted) {
      throw new GenerationCoordinatorCancelledError(sessionId, branchId);
    }
  }

  private ensureState(key: string): QueueState {
    const existing = this.states.get(key);
    if (existing) {
      return existing;
    }

    const created: QueueState = {
      active: false,
      queue: [],
    };
    this.states.set(key, created);
    return created;
  }

  private cleanupState(key: string): void {
    const state = this.states.get(key);
    if (!state) {
      return;
    }

    if (!state.active && state.queue.length === 0) {
      this.states.delete(key);
    }
  }

  private makeKey(sessionId: string, branchId: string): string {
    return `${sessionId}::${branchId}`;
  }
}

export class GenerationGuardService extends InMemoryGenerationCoordinator {}

export { GenerationCoordinatorConflictError as GenerationGuardConflictError };
