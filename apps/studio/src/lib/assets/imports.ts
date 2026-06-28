/**
 * PromptAsset 导入薄封装（AST10 / 阶段 C）。
 *
 * 把校验通过的文件按种类提交到公共 `@tavern/sdk` `imports`：
 * - character：`imports.character`（对象 payload，createSession=false——studio 导入不建会话）。
 * - preset / worldbook：`imports.preset` / `imports.worldbook`（对象 data + name）。
 * - regex：`imports.regex`（字符串 data + name；优先用原始文本，回退 JSON.stringify(payload)）。
 */
import { apiClient } from "../sdk";
import type { AssetImportValidationResult, AssetKind, ImportedAssetSummary } from "./types";

/** 由文件名推导资产名称（去扩展名）。 */
export function deriveAssetName(fileName: string): string {
  const base = fileName.replace(/\.[^./\\]+$/, "").trim();
  return base || fileName;
}

export async function importAsset(
  kind: AssetKind,
  result: AssetImportValidationResult,
): Promise<ImportedAssetSummary> {
  const name = deriveAssetName(result.fileName);

  if (kind === "character") {
    const imported = await apiClient.imports.character({
      payload: (result.payload as Record<string, unknown>) ?? {},
      createSession: false,
      title: name,
    });
    return { id: imported.characterId, name: imported.name, source: imported.source };
  }

  if (kind === "preset") {
    const imported = await apiClient.imports.preset({
      data: (result.payload as Record<string, unknown>) ?? {},
      name,
    });
    return { id: imported.id, name: imported.name, source: imported.source };
  }

  if (kind === "worldbook") {
    const imported = await apiClient.imports.worldbook({
      data: (result.payload as Record<string, unknown>) ?? {},
      name,
    });
    return { id: imported.id, name: imported.name, source: imported.source };
  }

  const data = result.raw ?? JSON.stringify(result.payload ?? []);
  const imported = await apiClient.imports.regex({ data, name });
  return { id: imported.id, name: imported.name, source: imported.source };
}
