/** PromptAsset 导入与资产库共享类型（AST10 / 阶段 C）。 */

/** 资产种类（对齐 `PromptAssetKind`，UI 侧 regex_profile 简称 regex）。 */
export type AssetKind = "character" | "preset" | "worldbook" | "regex";

export type AssetImportValidationReason =
  | "okCharacterImage"
  | "okJson"
  | "errorCharacterImageUnsupported"
  | "errorCharacterMetadataMissing"
  | "errorCharacterMetadataParse"
  | "errorFileRead"
  | "errorJsonObjectExpected"
  | "errorJsonParse"
  | "errorUnsupportedFormat";

export interface AssetImportValidationResult {
  fileName: string;
  ok: boolean;
  /** 解析后的载荷（character/preset/worldbook 为对象；regex 可为对象或数组）。 */
  payload?: unknown;
  /** 原始文件文本（regex 导入需要字符串 data）。 */
  raw?: string;
  detail?: string;
  reason: AssetImportValidationReason;
}

export interface LibraryAsset {
  kind: AssetKind;
  id: string;
  name: string;
  source: string;
  version: number | null;
  createdAt: number;
  updatedAt: number;
}

/** 资产排序字段（对齐 `characters.list` 的 sortBy，其余种类前端排序复用）。 */
export type AssetSortBy = "created_at" | "name" | "updated_at";

/** 排序方向。 */
export type AssetSortOrder = "asc" | "desc";

/** character 服务端列表查询（透传到 `characters.list`）。 */
export interface CharacterListQuery {
  keyword?: string;
  sortBy?: AssetSortBy;
  sortOrder?: AssetSortOrder;
  status?: string;
  limit?: number;
  offset?: number;
}

export interface AssetVersionItem {
  id: string;
  versionNo: number;
  createdAt: number;
}

/**
 * 资产选择器（SC2-3）对外产出的统一结果。
 *
 * `version: null` = 不锁版本（跟随最新）；选具体版本时带 `version`（版本号）与可选 `versionId`（版本记录 id）。
 * SC2-4 会按 `SessionsCreateOptions` 把它映射为 `sessions.create` 的资产字段。
 */
export interface AssetSelection {
  kind: AssetKind;
  id: string;
  name: string;
  version: number | null;
  versionId?: string;
}

export interface ImportedAssetSummary {
  id: string;
  name: string;
  source: string;
}
