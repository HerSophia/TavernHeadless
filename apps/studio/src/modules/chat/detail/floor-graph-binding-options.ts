/**
 * 楼层图绑定面板（SC2-5）的纯映射逻辑：图/版本列表 → 选择器选项，以及默认版本解析。
 *
 * 抽成无副作用纯函数便于单测（测试栈不挂载组件）。图列表 / 版本列表由面板经第一方
 * `lib/nodegraph-api` 按需拉取，本文件只负责整形。
 */
import type {
  NodeGraphDefinitionResponse,
  NodeGraphVersionResponse,
} from "../../../lib/nodegraph-api";

export interface FloorGraphSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/** 图列表 → 选择器选项（`label=name`、`value=id`）。 */
export function toGraphOptions(items: NodeGraphDefinitionResponse[]): FloorGraphSelectOption[] {
  return items.map((item) => ({ value: item.id, label: item.name }));
}

/** 版本列表 → 选择器选项（`label="v"+version_no`、`value=id`），按版本号降序（新版本在前）。 */
export function toVersionOptions(items: NodeGraphVersionResponse[]): FloorGraphSelectOption[] {
  return [...items]
    .sort((a, b) => b.version_no - a.version_no)
    .map((item) => ({ value: item.id, label: `v${item.version_no}` }));
}

/**
 * 解析默认选中版本 id：优先图的 `current_version_id`（须仍在版本列表中），
 * 否则退回版本号最大的版本；版本列表为空时返回 null。
 */
export function resolveDefaultVersionId(
  graph: NodeGraphDefinitionResponse | null,
  versions: NodeGraphVersionResponse[],
): string | null {
  if (versions.length === 0) {
    return null;
  }
  const current = graph?.current_version_id ?? null;
  if (current && versions.some((version) => version.id === current)) {
    return current;
  }
  const latest = [...versions].sort((a, b) => b.version_no - a.version_no)[0];
  return latest?.id ?? null;
}
