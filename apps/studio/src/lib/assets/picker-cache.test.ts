import { describe, expect, it, vi } from "vitest";

import { createInflightMap, isFresh } from "./picker-cache";

describe("isFresh", () => {
  it("treats a missing entry as stale", () => {
    expect(isFresh(null, 1000)).toBe(false);
    expect(isFresh(undefined, 1000)).toBe(false);
  });

  it("treats any existing entry as fresh when no TTL is given", () => {
    expect(isFresh({ loadedAt: 0 }, 10_000_000)).toBe(true);
    expect(isFresh({ loadedAt: 5 }, 5)).toBe(true);
  });

  it("treats a non-positive TTL as no TTL", () => {
    expect(isFresh({ loadedAt: 0 }, 10_000, 0)).toBe(true);
    expect(isFresh({ loadedAt: 0 }, 10_000, -1)).toBe(true);
  });

  it("honors a positive TTL window", () => {
    expect(isFresh({ loadedAt: 1000 }, 1500, 1000)).toBe(true);
    expect(isFresh({ loadedAt: 1000 }, 2000, 1000)).toBe(false);
    expect(isFresh({ loadedAt: 1000 }, 2001, 1000)).toBe(false);
  });
});

describe("createInflightMap", () => {
  it("dedupes concurrent calls for the same key", async () => {
    const map = createInflightMap<string, number>();
    let resolve: ((value: number) => void) | undefined;
    const factory = vi.fn(() => new Promise<number>((res) => {
      resolve = res;
    }));

    const p1 = map.run("a", factory);
    const p2 = map.run("a", factory);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(map.size).toBe(1);

    resolve?.(7);
    await expect(p1).resolves.toBe(7);
    await expect(p2).resolves.toBe(7);
    expect(map.size).toBe(0);
  });

  it("re-runs the factory after the previous call settled", async () => {
    const map = createInflightMap<string, number>();
    const factory = vi.fn(async () => 1);

    await map.run("a", factory);
    await map.run("a", factory);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("keeps different keys independent", async () => {
    const map = createInflightMap<string, number>();
    const factory = vi.fn(async (value: number) => value);

    const [a, b] = await Promise.all([
      map.run("a", () => factory(1)),
      map.run("b", () => factory(2)),
    ]);
    expect(a).toBe(1);
    expect(b).toBe(2);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("propagates rejection and clears the pending slot", async () => {
    const map = createInflightMap<string, number>();
    const factory = vi.fn(async () => {
      throw new Error("boom");
    });

    await expect(map.run("a", factory)).rejects.toThrow("boom");
    expect(map.size).toBe(0);
    await expect(map.run("a", factory)).rejects.toThrow("boom");
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("rejects when the factory throws synchronously", async () => {
    const map = createInflightMap<string, number>();
    const factory = vi.fn(() => {
      throw new Error("sync");
    });

    await expect(map.run("a", factory)).rejects.toThrow("sync");
    expect(map.size).toBe(0);
  });
});

