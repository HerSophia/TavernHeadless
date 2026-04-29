import type { PromptAssetDeclaration, PromptAssetManifest, PromptAssetRef } from "./types.js";

/**
 * 构造 Prompt Asset manifest。
 */
export function createPromptAssetManifest(args: {
  generatedAt: number;
  assets: PromptAssetRef[];
  declarations: PromptAssetDeclaration[];
}): PromptAssetManifest {
  return {
    version: 1,
    generatedAt: args.generatedAt,
    assets: [...args.assets].sort((left, right) => left.assetScopeId.localeCompare(right.assetScopeId)),
    declarations: [...args.declarations].sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortJsonValue(item)]),
    );
  }
  return value;
}

/**
 * 把 manifest 转成稳定 JSON 文本。
 *
 * 该函数不负责计算 hash。hash 由运行环境按自身可用的 crypto 能力完成。
 */
export function stableStringifyPromptAssetManifest(manifest: PromptAssetManifest): string {
  return JSON.stringify(sortJsonValue(manifest));
}
