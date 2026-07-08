/**
 * 资产选择器纯逻辑（SC2-3）：缓存新鲜度判断 + in-flight 并发去重。
 *
 * 不含任何框架 / 网络依赖，便于单测。`stores/assets` 组合这些纯逻辑实现
 * 「按需加载 + 轻量缓存 + 跨类并发去重」，与库视图 `lists` 解耦。
 */

/** 带加载时间戳的缓存条目（新鲜度判断只关心 `loadedAt`）。 */
export interface CacheEntryMeta {
  loadedAt: number;
}

/**
 * 判断缓存条目是否新鲜。
 *
 * - 条目不存在（`null` / `undefined`）→ 不新鲜。
 * - 未提供 `ttlMs`（或 `<= 0`）→「存在即新鲜」（会话内缓存 + 手动失效模型）。
 * - 提供 `ttlMs` → 距 `loadedAt` 未超过 TTL 视为新鲜。
 */
export function isFresh(entry: CacheEntryMeta | null | undefined, now: number, ttlMs?: number): boolean {
  if (!entry) {
    return false;
  }
  if (ttlMs === undefined || ttlMs <= 0) {
    return true;
  }
  return now - entry.loadedAt < ttlMs;
}

/** in-flight 去重表：同一 key 的进行中 Promise 只跑一次 factory。 */
export interface InflightMap<K, V> {
  /**
   * 若该 key 有进行中的 Promise 则复用；否则调用 `factory` 并登记，
   * 完成（成功或失败）后清除，使后续调用可重新发起。
   */
  run(key: K, factory: () => Promise<V>): Promise<V>;
  /** 当前进行中的 key 数（测试 / 诊断用）。 */
  readonly size: number;
}

/** 创建一个 in-flight 去重表。 */
export function createInflightMap<K, V>(): InflightMap<K, V> {
  const pending = new Map<K, Promise<V>>();
  return {
    run(key, factory) {
      const existing = pending.get(key);
      if (existing) {
        return existing;
      }
      let source: Promise<V>;
      try {
        source = factory();
      } catch (cause) {
        return Promise.reject(cause);
      }
      const tracked = source.finally(() => {
        pending.delete(key);
      });
      pending.set(key, tracked);
      return tracked;
    },
    get size() {
      return pending.size;
    },
  };
}

