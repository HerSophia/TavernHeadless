import { afterEach, describe, expect, it, vi } from "vitest";

import { createDebounced } from "./debounce";

afterEach(() => {
  vi.useRealTimers();
});

describe("createDebounced", () => {
  it("ms>0 时延迟到停顿后才发射", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = createDebounced(fn, 200);

    debounced.call("a");
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(199);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("a");
  });

  it("连续调用只发射最后一次（合并中间调用）", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = createDebounced(fn, 100);

    debounced.call("a");
    vi.advanceTimersByTime(50);
    debounced.call("b");
    vi.advanceTimersByTime(50);
    debounced.call("c");
    vi.advanceTimersByTime(100);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("c");
  });

  it("cancel 取消挂起的发射", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = createDebounced(fn, 100);

    debounced.call("a");
    debounced.cancel();
    vi.advanceTimersByTime(1000);

    expect(fn).not.toHaveBeenCalled();
  });

  it("ms<=0 时立即同步发射，且不受 cancel 影响", () => {
    const fn = vi.fn();
    const debounced = createDebounced(fn, 0);

    debounced.call("x");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("x");

    debounced.cancel();
    debounced.call("y");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith("y");
  });
});
