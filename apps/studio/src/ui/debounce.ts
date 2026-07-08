/**
 * 防抖纯逻辑（SC2-1 通用 UI 基础件）。
 *
 * 与 DOM 解耦：只依赖 `setTimeout` / `clearTimeout`，便于在无组件挂载能力的测试环境里
 * 用 `vi.useFakeTimers()` 单测。供 `UiSearchInput.vue` 等基元组合使用。
 */

/** 防抖句柄：`call` 触发（可能被延迟合并），`cancel` 取消未发射的调用。 */
export interface Debounced<Args extends unknown[]> {
  call: (...args: Args) => void;
  cancel: () => void;
}

/**
 * 创建一个防抖包装。
 *
 * - `ms <= 0`：不防抖，`call` 时立即同步执行 `fn`。
 * - `ms > 0`：每次 `call` 清掉上一次未触发的定时器并重设，仅最后一次调用在停顿 `ms` 后发射。
 * - `cancel`：清掉当前挂起的定时器（若有），使其不再发射。
 *
 * 用 `ReturnType<typeof setTimeout>` 存句柄以同时兼容浏览器与 Node 计时器类型。
 */
export function createDebounced<Args extends unknown[]>(
  fn: (...args: Args) => void,
  ms: number,
): Debounced<Args> {
  let handle: ReturnType<typeof setTimeout> | null = null;

  function cancel(): void {
    if (handle !== null) {
      clearTimeout(handle);
      handle = null;
    }
  }

  function call(...args: Args): void {
    if (ms <= 0) {
      fn(...args);
      return;
    }
    cancel();
    handle = setTimeout(() => {
      handle = null;
      fn(...args);
    }, ms);
  }

  return { call, cancel };
}
