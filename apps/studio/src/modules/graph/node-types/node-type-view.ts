import type {
  NodeGraphNodeCategory,
  NodeGraphNodeTypeKnowledgeDetail,
  NodeGraphNodeTypeKnowledgeListItem,
} from "@tavern/core/node-graph";

export interface NodeTypeI18nLike {
  t: (key: string) => string;
  te: (key: string) => boolean;
}

export interface NodeTypeViewItem extends NodeGraphNodeTypeKnowledgeListItem {
  titleLabel: string;
  categoryLabel: string;
  summaryLabel: string;
  inputCount: number;
  outputCount: number;
  permissionCount: number;
  searchText: string;
}

export interface NodeTypeSearchOptions {
  query?: string;
  category?: NodeGraphNodeCategory | "all";
  sideEffect?: string | "all";
}

export function nodeTypeTranslationKey(type: string): string {
  return `graphNode.type.${type.replaceAll(".", "_")}`;
}

export function nodeTypeI18nSegment(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9_]/g, "_");
}

export function nodeTypeKey(type: string): string {
  return nodeTypeI18nSegment(type);
}

export function nodeTypeKnowledgeKey(type: string, field: "summary" | "usage"): string {
  return `graphNode.knowledge.${nodeTypeKey(type)}.${field}`;
}

export function nodeTypePortDescriptionKey(type: string, direction: "input" | "output", portName: string): string {
  return `graphNode.knowledge.${nodeTypeKey(type)}.ports.${direction}.${nodeTypeI18nSegment(portName)}`;
}

export function nodeTypeConfigFieldLabelKey(type: string, path: string): string {
  return `graphNode.knowledge.${nodeTypeKey(type)}.config.fields.${nodeTypeI18nSegment(path)}.label`;
}

export function nodeTypeConfigFieldDescriptionKey(type: string, path: string): string {
  return `graphNode.knowledge.${nodeTypeKey(type)}.config.fields.${nodeTypeI18nSegment(path)}.description`;
}

export function nodeTypeExampleTitleKey(type: string, index: number): string {
  return `graphNode.knowledge.${nodeTypeKey(type)}.examples.${index}.title`;
}

export function nodeTypeExampleDescriptionKey(type: string, index: number): string {
  return `graphNode.knowledge.${nodeTypeKey(type)}.examples.${index}.description`;
}

export function nodeTypePitfallKey(type: string, index: number): string {
  return `graphNode.knowledge.${nodeTypeKey(type)}.pitfalls.${index}`;
}

export function nodeTypeCategoryLabel(category: NodeGraphNodeCategory, i18n?: NodeTypeI18nLike): string {
  const key = `graph.nodeType.category.${category}`;
  return i18n?.te(key) ? i18n.t(key) : category;
}

export function nodeTypeTitleLabel(entry: { type: string; title?: string }, i18n?: NodeTypeI18nLike): string {
  const key = nodeTypeTranslationKey(entry.type);
  return i18n?.te(key) ? i18n.t(key) : entry.title ?? entry.type;
}

export function nodeTypeSummaryLabel(entry: { type: string; summary: string }, i18n?: NodeTypeI18nLike): string {
  const key = nodeTypeKnowledgeKey(entry.type, "summary");
  return i18n?.te(key) ? i18n.t(key) : entry.summary;
}

export function nodeTypeUsageLabel(entry: { type: string; usage?: string }, i18n?: NodeTypeI18nLike): string {
  const key = nodeTypeKnowledgeKey(entry.type, "usage");
  return i18n?.te(key) ? i18n.t(key) : entry.usage ?? "";
}

export function nodeTypePortDescriptionLabel(
  type: string,
  direction: "input" | "output",
  portName: string,
  fallback: string | undefined,
  i18n?: NodeTypeI18nLike,
): string {
  const key = nodeTypePortDescriptionKey(type, direction, portName);
  return i18n?.te(key) ? i18n.t(key) : fallback ?? "";
}

export function nodeTypeConfigFieldLabel(
  type: string,
  path: string,
  fallback: string | undefined,
  i18n?: NodeTypeI18nLike,
): string {
  const key = nodeTypeConfigFieldLabelKey(type, path);
  return i18n?.te(key) ? i18n.t(key) : fallback ?? path;
}

export function nodeTypeConfigFieldDescription(
  type: string,
  path: string,
  fallback: string,
  i18n?: NodeTypeI18nLike,
): string {
  const key = nodeTypeConfigFieldDescriptionKey(type, path);
  return i18n?.te(key) ? i18n.t(key) : fallback;
}

export function nodeTypeExampleTitle(
  type: string,
  index: number,
  fallback: string,
  i18n?: NodeTypeI18nLike,
): string {
  const key = nodeTypeExampleTitleKey(type, index);
  return i18n?.te(key) ? i18n.t(key) : fallback;
}

export function nodeTypeExampleDescription(
  type: string,
  index: number,
  fallback: string | undefined,
  i18n?: NodeTypeI18nLike,
): string {
  const key = nodeTypeExampleDescriptionKey(type, index);
  return i18n?.te(key) ? i18n.t(key) : fallback ?? "";
}

export function nodeTypePitfallLabel(
  type: string,
  index: number,
  fallback: string,
  i18n?: NodeTypeI18nLike,
): string {
  const key = nodeTypePitfallKey(type, index);
  return i18n?.te(key) ? i18n.t(key) : fallback;
}

export function toNodeTypeViewItem(
  entry: NodeGraphNodeTypeKnowledgeListItem,
  i18n?: NodeTypeI18nLike,
): NodeTypeViewItem {
  const titleLabel = nodeTypeTitleLabel(entry, i18n);
  const categoryLabel = nodeTypeCategoryLabel(entry.category, i18n);
  const summaryLabel = nodeTypeSummaryLabel(entry, i18n);
  const searchText = [
    entry.type,
    entry.typeVersion,
    entry.title,
    entry.description,
    entry.summary,
    titleLabel,
    categoryLabel,
    summaryLabel,
    entry.sideEffects,
    ...(entry.permissionsRequired ?? []),
    ...entry.inputPortNames,
    ...entry.outputPortNames,
  ]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join("\n")
    .toLowerCase();

  return {
    ...entry,
    titleLabel,
    categoryLabel,
    summaryLabel,
    inputCount: entry.inputPorts.length,
    outputCount: entry.outputPorts.length,
    permissionCount: entry.permissionsRequired?.length ?? 0,
    searchText,
  };
}

export function buildNodeTypeViewItems(
  entries: readonly NodeGraphNodeTypeKnowledgeListItem[],
  i18n?: NodeTypeI18nLike,
): NodeTypeViewItem[] {
  return entries.map((entry) => toNodeTypeViewItem(entry, i18n));
}

export function filterNodeTypeViewItems(
  items: readonly NodeTypeViewItem[],
  options: NodeTypeSearchOptions = {},
): NodeTypeViewItem[] {
  const query = options.query?.trim().toLowerCase() ?? "";
  const category = options.category ?? "all";
  const sideEffect = options.sideEffect ?? "all";
  return items.filter((item) => {
    if (category !== "all" && item.category !== category) {
      return false;
    }
    if (sideEffect !== "all" && (item.sideEffects ?? "none") !== sideEffect) {
      return false;
    }
    if (query.length > 0 && !item.searchText.includes(query)) {
      return false;
    }
    return true;
  });
}

export function groupNodeTypeViewItemsByCategory(
  items: readonly NodeTypeViewItem[],
): Array<{ category: NodeGraphNodeCategory; label: string; items: NodeTypeViewItem[] }> {
  const groups = new Map<NodeGraphNodeCategory, { category: NodeGraphNodeCategory; label: string; items: NodeTypeViewItem[] }>();
  for (const item of items) {
    const group = groups.get(item.category) ?? { category: item.category, label: item.categoryLabel, items: [] };
    group.items.push(item);
    groups.set(item.category, group);
  }
  return [...groups.values()];
}

export function nodeTypeDetailText(
  detail: NodeGraphNodeTypeKnowledgeDetail | undefined,
  i18n?: NodeTypeI18nLike,
): { title: string; summary: string; usage: string } {
  if (!detail) {
    return { title: "", summary: "", usage: "" };
  }
  return {
    title: nodeTypeTitleLabel(detail, i18n),
    summary: nodeTypeSummaryLabel(detail, i18n),
    usage: nodeTypeUsageLabel(detail, i18n),
  };
}
