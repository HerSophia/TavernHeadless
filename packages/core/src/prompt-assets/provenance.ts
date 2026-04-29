import type { PromptAssetKind, PromptAssetOrigin, PromptAssetRef } from "./types.js";

/**
 * 构造 Prompt Asset 的默认 scope ID。
 */
export function buildPromptAssetScopeId(args: {
  kind: PromptAssetKind;
  assetId: string;
  version?: number | string | null;
  suffix?: string;
}): string {
  const versionPart = args.version === undefined || args.version === null || args.version === ""
    ? "unversioned"
    : String(args.version);
  const base = `${args.kind}:${args.assetId}:${versionPart}`;
  return args.suffix ? `${base}:${args.suffix}` : base;
}

/**
 * 构造 Prompt Asset 引用。
 */
export function createPromptAssetRef(args: {
  kind: PromptAssetKind;
  assetId: string;
  version?: number | string | null;
  assetScopeId?: string;
  name?: string | null;
  origin: PromptAssetOrigin;
}): PromptAssetRef {
  return {
    kind: args.kind,
    assetId: args.assetId,
    version: args.version ?? null,
    assetScopeId: args.assetScopeId ?? buildPromptAssetScopeId({
      kind: args.kind,
      assetId: args.assetId,
      version: args.version ?? null,
    }),
    name: args.name ?? null,
    origin: args.origin,
  };
}
