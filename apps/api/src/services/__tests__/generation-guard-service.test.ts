import { describe, expect, it, vi } from "vitest";

import {
  GenerationCoordinatorCancelledError,
  InMemoryGenerationCoordinator,
} from "../generation-guard-service.js";

describe("InMemoryGenerationCoordinator", () => {
  it("removes an aborted queued request immediately and allows the next queued task to run", async () => {
    const coordinator = new InMemoryGenerationCoordinator();
    let releaseActive: (() => void) | undefined;
    let activeStarted = false;

    const activePromise = coordinator.execute({
      sessionId: "sess-1",
      branchId: "main",
      mode: "queue",
      task: async () => {
        activeStarted = true;
        await new Promise<void>((resolve) => {
          releaseActive = resolve;
        });
        return "active";
      },
    });

    for (let i = 0; i < 10 && !activeStarted; i += 1) {
      await Promise.resolve();
    }

    const abortController = new AbortController();
    const abortedTask = vi.fn(async () => "should-not-run");
    const abortedPromise = coordinator.execute({
      sessionId: "sess-1",
      branchId: "main",
      mode: "queue",
      timeoutMs: 10_000,
      abortSignal: abortController.signal,
      task: abortedTask,
    });

    const followerTask = vi.fn(async () => "follower");
    const followerPromise = coordinator.execute({
      sessionId: "sess-1",
      branchId: "main",
      mode: "queue",
      timeoutMs: 10_000,
      task: followerTask,
    });

    abortController.abort();

    await expect(abortedPromise).rejects.toBeInstanceOf(GenerationCoordinatorCancelledError);
    expect(abortedTask).not.toHaveBeenCalled();

    releaseActive?.();

    await expect(activePromise).resolves.toBe("active");
    await expect(followerPromise).resolves.toBe("follower");
    expect(followerTask).toHaveBeenCalledOnce();
    expect(coordinator.isActive("sess-1", "main")).toBe(false);
  });

  it("rejects an already-aborted request before execution starts", async () => {
    const coordinator = new InMemoryGenerationCoordinator();
    const abortController = new AbortController();
    abortController.abort();
    const task = vi.fn(async () => "never");

    await expect(
      coordinator.execute({
        sessionId: "sess-2",
        branchId: "main",
        mode: "queue",
        abortSignal: abortController.signal,
        task,
      }),
    ).rejects.toBeInstanceOf(GenerationCoordinatorCancelledError);

    expect(task).not.toHaveBeenCalled();
    expect(coordinator.isActive("sess-2", "main")).toBe(false);
  });
});
