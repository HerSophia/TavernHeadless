/**
 * 徽标计数格式化纯逻辑（SC2-1 通用 UI 基础件）。
 *
 * 供 `UiTabs` 的计数徽标与其它需要「超过上限折叠为 N+」的场景复用。抽成纯函数便于单测。
 */

/**
 * 把计数格式化为徽标文本。
 *
 * - 非有限数（NaN / Infinity）→ 空串（由消费方决定是否渲染）。
 * - 大于 `max` → `"{max}+"`（默认 `99` → `"99+"`）。
 * - 负数 → `"0"`。
 * - 其余取整后按十进制字符串输出。
 */
export function formatBadgeCount(count: number, max = 99): string {
  if (!Number.isFinite(count)) {
    return "";
  }
  const n = Math.trunc(count);
  if (n > max) {
    return `${max}+`;
  }
  if (n < 0) {
    return "0";
  }
  return String(n);
}
