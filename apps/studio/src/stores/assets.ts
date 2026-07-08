/**
 * 资产库 store（AST10 / 阶段 C；SC2-2 增强）。
 *
 * 四类资产（character/preset/worldbook/regex）列表 + 导入态 + 查询态（搜索/排序/状态）。
 * 仅依赖 `lib/assets` 薄封装，可纯单测。文件校验为纯函数（`validateAssetImportFile`），由导入组件直接调用；
 * store 负责导入提交与列表刷新。
 *
 * 查询语义：
 * - character：查询态透传服务端（`libraryApi.list` → `characters.list`），`visibleAssets` 直接用返回。
 * - preset/worldbook/regex：取全量，`visibleAssets` 在前端用 `filter-sort` 过滤 + 排序。
 *
 * 与 SC2-3 的选择器缓存共用同一 store 但各自独立字段，互不耦合。
 */
import { defineStore } from "pinia";
import { computed, reactive, ref } from "vue";

import { filterAndSort } from "../lib/assets/filter-sort";
import { importAsset } from "../lib/assets/imports";
import { libraryApi } from "../lib/assets/library";
import { createInflightMap, isFresh } from "../lib/assets/picker-cache";
import type {
  AssetImportValidationResult,
  AssetKind,
  AssetSortBy,
  AssetSortOrder,
  AssetVersionItem,
  CharacterListQuery,
  ImportedAssetSummary,
  LibraryAsset,
} from "../lib/assets/types";

function toMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** 四类资产的固定顺序（供预载 / 派生遍历，避免各处硬编码字面量）。 */
export const ASSET_KINDS: AssetKind[] = ["character", "preset", "worldbook", "regex"];

/** 单类资产的 UI 查询态。`status` 仅 character 生效（服务端筛选）。 */
export interface AssetQueryState {
  keyword: string;
  sortBy: AssetSortBy;
  sortOrder: AssetSortOrder;
  status: string;
}

function defaultQuery(): AssetQueryState {
  return { keyword: "", sortBy: "updated_at", sortOrder: "desc", status: "active" };
}

/** 选择器缓存的每类条目：整表快照 + 加载时间戳。 */
interface PickerCacheEntry {
  items: LibraryAsset[];
  loadedAt: number;
}

export const useAssetsStore = defineStore("assets", () => {
  const lists = reactive<Record<AssetKind, LibraryAsset[]>>({
    character: [],
    preset: [],
    worldbook: [],
    regex: [],
  });
  const query = reactive<Record<AssetKind, AssetQueryState>>({
    character: defaultQuery(),
    preset: defaultQuery(),
    worldbook: defaultQuery(),
    regex: defaultQuery(),
  });
  const loading = ref<AssetKind | null>(null);
  /** 每类是否正在加载（并发预载场景下比单一 `loading` 更精确，供内容区 skeleton 判定）。 */
  const loadingKinds = reactive<Record<AssetKind, boolean>>({
    character: false,
    preset: false,
    worldbook: false,
    regex: false,
  });
  /** 每类是否已成功加载过（供 `ensureLoaded` 切类免重拉 + skeleton 首载判定）。 */
  const loaded = reactive<Record<AssetKind, boolean>>({
    character: false,
    preset: false,
    worldbook: false,
    regex: false,
  });
  const importing = ref(false);
  const error = ref<string | null>(null);

  /** 把某类查询态映射为 character 服务端查询参数（其余种类忽略）。 */
  function toCharacterQuery(kind: AssetKind): CharacterListQuery | undefined {
    if (kind !== "character") {
      return undefined;
    }
    const q = query[kind];
    return {
      keyword: q.keyword.trim() || undefined,
      sortBy: q.sortBy,
      sortOrder: q.sortOrder,
      status: q.status === "all" ? undefined : q.status,
    };
  }

  /**
   * 加载某类资产列表。
   *
   * `opts` 为可选查询覆盖（合并进 `query[kind]` 后再加载），便于视图一次性更新查询并刷新。
   * character 透传服务端查询；其余取全量（前端过滤/排序由 `visibleAssets` 负责）。
   */
  async function loadAssets(kind: AssetKind, opts?: Partial<AssetQueryState>): Promise<void> {
    if (opts) {
      Object.assign(query[kind], opts);
    }
    loading.value = kind;
    loadingKinds[kind] = true;
    error.value = null;
    try {
      lists[kind] = await libraryApi.list(kind, toCharacterQuery(kind));
      loaded[kind] = true;
    } catch (cause) {
      error.value = toMessage(cause);
    } finally {
      loading.value = null;
      loadingKinds[kind] = false;
    }
  }

  /** 首屏预载四类（并发）：让侧栏计数即时准确、切类无需再等待。 */
  async function loadAllKinds(): Promise<void> {
    await Promise.all(ASSET_KINDS.map((kind) => loadAssets(kind)));
  }

  /** 仅在未加载且非加载中时加载：用于切类时命中缓存则即时返回。 */
  async function ensureLoaded(kind: AssetKind): Promise<void> {
    if (loaded[kind] || loadingKinds[kind]) {
      return;
    }
    await loadAssets(kind);
  }

  /** 派生：某类当前可见资产（character 直用返回；其余前端过滤+排序）。 */
  function visibleAssets(kind: AssetKind): LibraryAsset[] {
    const items = lists[kind];
    if (kind === "character") {
      return items;
    }
    const q = query[kind];
    return filterAndSort(items, q.keyword, q.sortBy, q.sortOrder);
  }

  /** 派生：各类可见资产计数（应用当前查询过滤后，供结果条）。 */
  const counts = computed<Record<AssetKind, number>>(() => ({
    character: visibleAssets("character").length,
    preset: visibleAssets("preset").length,
    worldbook: visibleAssets("worldbook").length,
    regex: visibleAssets("regex").length,
  }));

  /** 派生：各类原始列表长度（不随 keyword 过滤变化，供侧栏类目计数）。 */
  const totals = computed<Record<AssetKind, number>>(() => ({
    character: lists.character.length,
    preset: lists.preset.length,
    worldbook: lists.worldbook.length,
    regex: lists.regex.length,
  }));

  async function importValidated(kind: AssetKind, result: AssetImportValidationResult): Promise<ImportedAssetSummary> {
    importing.value = true;
    error.value = null;
    try {
      const summary = await importAsset(kind, result);
      await loadAssets(kind);
      return summary;
    } finally {
      importing.value = false;
    }
  }

  async function removeAsset(kind: AssetKind, id: string): Promise<void> {
    await libraryApi.remove(kind, id);
    await loadAssets(kind);
  }

  function listVersions(kind: AssetKind, id: string): Promise<AssetVersionItem[]> {
    return libraryApi.listVersions(kind, id);
  }

  // --- 选择器态（SC2-3）：与库视图 lists/query 字段独立，互不污染 ---
  //
  // 面向「按需选资产」：按类整表缓存 + 跨类并发去重，供 AssetPicker / 回显复用。
  // 第一版按类整表缓存 + 前端过滤（character 服务端 keyword 待接入时可给 ensurePickerList 传 query）；
  // 导入 / 删除后由 refreshPickerList 对账。
  const pickerCache = reactive<Record<AssetKind, PickerCacheEntry | null>>({
    character: null,
    preset: null,
    worldbook: null,
    regex: null,
  });
  const pickerInflight = createInflightMap<AssetKind, LibraryAsset[]>();

  /** 命中新鲜缓存直返；否则经 in-flight 去重拉取并写缓存（可跨类并发）。 */
  async function ensurePickerList(kind: AssetKind): Promise<LibraryAsset[]> {
    const entry = pickerCache[kind];
    if (entry && isFresh(entry, Date.now())) {
      return entry.items;
    }
    return pickerInflight.run(kind, async () => {
      const items = await libraryApi.list(kind);
      pickerCache[kind] = { items, loadedAt: Date.now() };
      // 返回缓存（reactive）引用而非原始数组，保证重复调用返回同一引用。
      return pickerCache[kind]!.items;
    });
  }

  /** 失效并重拉某类选择器缓存（导入 / 删除后调用）。 */
  function refreshPickerList(kind: AssetKind): Promise<LibraryAsset[]> {
    pickerCache[kind] = null;
    return ensurePickerList(kind);
  }

  /** 从选择器缓存 / 库视图 lists 命中取名（回显）；命中不到返回 null。 */
  function getAssetName(kind: AssetKind, id: string): string | null {
    const fromPicker = pickerCache[kind]?.items.find((item) => item.id === id);
    if (fromPicker) {
      return fromPicker.name;
    }
    const fromList = lists[kind].find((item) => item.id === id);
    return fromList ? fromList.name : null;
  }

  /** 未命中时先 ensurePickerList 再取名（用于「已有绑定 id，需展示名」的回显）。 */
  async function ensureAssetName(kind: AssetKind, id: string): Promise<string | null> {
    const cached = getAssetName(kind, id);
    if (cached !== null) {
      return cached;
    }
    await ensurePickerList(kind);
    return getAssetName(kind, id);
  }

  return {
    lists,
    query,
    loading,
    loadingKinds,
    loaded,
    importing,
    error,
    counts,
    totals,
    loadAssets,
    loadAllKinds,
    ensureLoaded,
    visibleAssets,
    importValidated,
    removeAsset,
    listVersions,
    pickerCache,
    ensurePickerList,
    refreshPickerList,
    getAssetName,
    ensureAssetName,
  };
});
