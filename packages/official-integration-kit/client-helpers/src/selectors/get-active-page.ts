/**
 * 从 timeline floor 数据中选出"当前要展示的 active page"。
 *
 * 后端 page-aware 升级后，timeline floor 的元数据包括三组字段：
 *
 * - `activePage`（兼容字段）：仅当仅有 1 个 active page 时非 null；
 *   多 active page 场景后端会给 null。
 * - `activePages`：严格的"当前 active page"数组。可能有 0 / 1 / 多 条。
 * - `pages`：该 floor 的全部 page（包含非 active 版本），每条带 `isActive` 字段。
 *
 * 选择优先级：
 *
 *   1. 如果传入的 `activePage` 非空就直接用。
 *   2. 否则从 `activePages` 取首条（只有 1 条时此路径等价于旧逻辑）。
 *   3. 否则从 `pages` 里挑第一条 `isActive === true` 的 page。
 *   4. 最后再回退到 `pages[0]`（极端场景兼容）。
 *
 * 注意：多 active page 场景下这个选择器只会返回其中一条。如果 UI 需要全部 active page，
 * 应直接消费 `activePages`，不要用这个 helper。
 */
export function getActivePage<TPage>(input: {
  activePage?: TPage | null;
  activePages?: TPage[] | null;
  pages?: TPage[] | null;
}): TPage | null {
  if (input.activePage) {
    return input.activePage;
  }

  const activePages = input.activePages ?? [];
  if (activePages.length > 0) {
    return activePages[0] ?? null;
  }

  const pages = input.pages ?? [];
  const activeFromPages = pages.find((page): page is TPage => {
    // page 的类型对外是 unknown 的泛型 TPage。这里通过 duck-typing 读 isActive：
    // 仅当 page 是对象且显式带 `isActive === true` 时才命中。
    if (page && typeof page === "object" && "isActive" in page) {
      return Boolean((page as { isActive?: boolean }).isActive);
    }
    return false;
  });
  if (activeFromPages) {
    return activeFromPages;
  }

  return pages.length > 0 ? pages[0] ?? null : null;
}
