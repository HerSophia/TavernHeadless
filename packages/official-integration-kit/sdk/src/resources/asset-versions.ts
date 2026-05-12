import { readArray, readBoolean, readNullableString, readNumber, readRecord, readString } from "./utils.js";

export type PromptAssetVersionKind = "preset" | "worldbook" | "regex_profile";
export type PromptAssetVersionCompareMode = "summary" | "full";

export type VcDiffChange = {
  afterHash?: string;
  afterPreview?: unknown;
  afterValue?: unknown;
  beforeHash?: string;
  beforePreview?: unknown;
  beforeValue?: unknown;
  changeType: string;
  path: string;
  redacted?: boolean;
};

export type VcDiff = {
  changes: VcDiffChange[];
  maxBytes?: number;
  mode: PromptAssetVersionCompareMode | string;
  totalChanges: number;
  truncated: boolean;
};

export type PromptAssetVersionRecord = {
  assetId: string;
  contentHash: string;
  createdAt: number;
  createdByOperationId: string | null;
  id: string;
  kind: PromptAssetVersionKind;
  parentVersionId: string | null;
  snapshot: unknown;
  versionNo: number;
};

export type PromptAssetVersionCompareResult = {
  assetId: string;
  diff: VcDiff;
  kind: PromptAssetVersionKind;
  leftVersionId: string;
  rightVersionId: string;
};

export type PromptAssetRollbackResult = {
  contentHash: string;
  createdAt: number;
  id: string;
  name: string;
  rolledBackFromVersionId: string;
  source: string;
  updatedAt: number;
  version: number;
  versionId: string;
};

export function mapPromptAssetVersion(value: unknown): PromptAssetVersionRecord | null {
  const record = readRecord(value);
  if (!record) return null;

  return {
    assetId: readString(record.asset_id),
    contentHash: readString(record.content_hash),
    createdAt: readNumber(record.created_at),
    createdByOperationId: readNullableString(record.created_by_operation_id),
    id: readString(record.id),
    kind: readString(record.kind) as PromptAssetVersionKind,
    parentVersionId: readNullableString(record.parent_version_id),
    snapshot: record.snapshot,
    versionNo: readNumber(record.version_no),
  };
}

export function mapPromptAssetVersionCompareResult(value: unknown): PromptAssetVersionCompareResult | null {
  const record = readRecord(value);
  if (!record) return null;
  return {
    assetId: readString(record.asset_id),
    diff: mapVcDiff(record.diff),
    kind: readString(record.kind) as PromptAssetVersionKind,
    leftVersionId: readString(record.left_version_id),
    rightVersionId: readString(record.right_version_id),
  };
}

export function mapPromptAssetRollbackResult(value: unknown): PromptAssetRollbackResult | null {
  const record = readRecord(value);
  if (!record) return null;
  return {
    contentHash: readString(record.content_hash),
    createdAt: readNumber(record.created_at),
    id: readString(record.id),
    name: readString(record.name),
    rolledBackFromVersionId: readString(record.rolled_back_from_version_id),
    source: readString(record.source),
    updatedAt: readNumber(record.updated_at),
    version: readNumber(record.version),
    versionId: readString(record.version_id),
  };
}

function mapVcDiff(value: unknown): VcDiff {
  const record = readRecord(value) ?? {};
  return {
    changes: readArray(record.changes).map(mapVcDiffChange),
    maxBytes: typeof record.max_bytes === "number" ? record.max_bytes : undefined,
    mode: readString(record.mode, "summary") as PromptAssetVersionCompareMode,
    totalChanges: readNumber(record.total_changes),
    truncated: readBoolean(record.truncated),
  };
}

function mapVcDiffChange(value: unknown): VcDiffChange {
  const record = readRecord(value) ?? {};
  return {
    afterHash: typeof record.after_hash === "string" ? record.after_hash : undefined,
    afterPreview: record.after_preview,
    afterValue: record.after_value,
    beforeHash: typeof record.before_hash === "string" ? record.before_hash : undefined,
    beforePreview: record.before_preview,
    beforeValue: record.before_value,
    changeType: readString(record.change_type),
    path: readString(record.path),
    redacted: typeof record.redacted === "boolean" ? record.redacted : undefined,
  };
}
