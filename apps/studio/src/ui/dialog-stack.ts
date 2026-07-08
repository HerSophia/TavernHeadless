/**
 * 对话框 body 滚动锁的引用计数管理（SC2-1 通用 UI 基础件）。
 *
 * 多个 `UiDialog` 可能并存 / 嵌套，用模块级计数器保证：
 * - 首个 `acquireScrollLock` 记录 `body` 原 `overflow` 并置为 `hidden`；
 * - 末个 `releaseScrollLock`（计数归零）才把 `overflow` 还原到最初记录的值。
 *
 * 无 `document`（SSR / 单测 node 环境）时安全短路，不抛错。逻辑抽成纯模块便于单测。
 */

/** 当前持有滚动锁的对话框数量。 */
let lockCount = 0;
/** 首次加锁前 `body.style.overflow` 的原值，供末个释放时还原。 */
let previousOverflow = "";

/**
 * 获取滚动锁。首个调用记录原 `overflow` 并锁定；后续调用仅递增计数、不覆盖原值。
 */
export function acquireScrollLock(): void {
  if (typeof document === "undefined") {
    return;
  }
  if (lockCount === 0) {
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  lockCount += 1;
}

/**
 * 释放滚动锁。计数递减且不越界；归零时还原到最初记录的 `overflow`。
 * 多余的释放（计数已为 0）为无副作用的空操作。
 */
export function releaseScrollLock(): void {
  if (typeof document === "undefined") {
    return;
  }
  if (lockCount === 0) {
    return;
  }
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) {
    document.body.style.overflow = previousOverflow;
  }
}

/** 仅供单测隔离：重置模块级状态。 */
export function __resetForTest(): void {
  lockCount = 0;
  previousOverflow = "";
}
