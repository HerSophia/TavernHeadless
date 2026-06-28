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

export interface AssetVersionItem {
  id: string;
  versionNo: number;
  createdAt: number;
}

export interface ImportedAssetSummary {
  id: string;
  name: string;
  source: string;
}
