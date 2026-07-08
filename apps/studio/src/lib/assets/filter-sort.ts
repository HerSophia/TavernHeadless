/**
 * 资产库前端过滤 / 排序 / 计数纯函数（SC2-2）。
 *
 * preset / worldbook / regex 的 `list` 无服务端查询能力，搜索/排序在前端做；
 * 抽成纯函数便于单测（沿用「逻辑抽 .ts」原则，因无组件挂载测试）。
 * character 走服务端过滤/排序，不经过这里（避免与服务端语义冲突）。
 */
import type { AssetSortBy, AssetSortOrder, LibraryAsset } from "./types";

/**
 * 按名称过滤（不区分大小写 `includes`）。
 *
 * 空 / 全空白 keyword 返回原数组（同引用，避免无谓拷贝）。
 */
export function filterByKeyword(assets: LibraryAsset[], keyword: string): LibraryAsset[] {
  const needle = keyword.trim().toLowerCase();
  if (!needle) {
    return assets;
  }
  return assets.filter((asset) => asset.name.toLowerCase().includes(needle));
}

/** 排序键取值：name 取小写名称，时间取对应时间戳。 */
function sortKey(asset: LibraryAsset, sortBy: AssetSortBy): string | number {
  switch (sortBy) {
    case "name":
      return asset.name.toLowerCase();
    case "created_at":
      return asset.createdAt;
    case "updated_at":
    default:
      return asset.updatedAt;
  }
}

/**
 * 稳定排序（不改动入参，返回新数组）。
 *
 * 通过携带原始下标做次级比较键，保证等值元素相对次序不变（稳定）。
 */
export function sortAssets(
  assets: LibraryAsset[],
  sortBy: AssetSortBy,
  order: AssetSortOrder,
): LibraryAsset[] {
  const dir = order === "asc" ? 1 : -1;
  return assets
    .map((asset, index) => ({ asset, index }))
    .sort((a, b) => {
      const ka = sortKey(a.asset, sortBy);
      const kb = sortKey(b.asset, sortBy);
      if (ka < kb) {
        return -1 * dir;
      }
      if (ka > kb) {
        return 1 * dir;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.asset);
}

/** 计数（当前已加载列表长度）。 */
export function countAssets(assets: LibraryAsset[]): number {
  return assets.length;
}

/** 组合：先过滤后排序（前端可见列表派生）。 */
export function filterAndSort(
  assets: LibraryAsset[],
  keyword: string,
  sortBy: AssetSortBy,
  order: AssetSortOrder,
): LibraryAsset[] {
  return sortAssets(filterByKeyword(assets, keyword), sortBy, order);
}
