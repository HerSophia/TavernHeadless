import type { MemoryType } from '@tavern/shared';
import type { TokenCounter } from '../prompt/types.js';
import type { MemoryInjectionOptions, MemoryInjectionResult, MemoryItem } from './types.js';

const BALANCED_DEFAULT_ORDER: MemoryType[] = ['open_loop', 'fact', 'summary'];
const DUAL_SUMMARY_ORDER = ['fact', 'open_loop', 'summary.micro', 'summary.macro'] as const;
type DualSummarySection = (typeof DUAL_SUMMARY_ORDER)[number];

const DUAL_SUMMARY_SECTION_BUDGETS: Record<DualSummarySection, number> = {
  fact: 0.35,
  open_loop: 0.20,
  'summary.micro': 0.20,
  'summary.macro': 0.25,
};

const DUAL_SUMMARY_SECTION_MAX_ITEMS: Record<DualSummarySection, number> = {
  fact: 10,
  open_loop: 6,
  'summary.micro': 5,
  'summary.macro': 3,
};

function formatFactContent(item: MemoryItem): string {
  if (!item.factKey) {
    return item.content;
  }

  const normalizedContent = item.content.trim().toLowerCase();
  const startsWithKey = normalizedContent.startsWith(`${item.factKey}:`)
    || normalizedContent.startsWith(`${item.factKey}：`);

  return startsWithKey ? item.content : `${item.factKey}: ${item.content}`;
}

function formatLegacyLine(item: MemoryItem): string {
  if (item.type === 'fact') {
    return `- (${item.type}) ${formatFactContent(item)}`;
  }

  return `- (${item.type}) ${item.content}`;
}

function formatLegacyMemoryItems(items: MemoryItem[]): string {
  if (items.length === 0) {
    return '';
  }

  return `[Memory]\n${items.map(formatLegacyLine).join('\n')}`;
}

function sectionTitle(section: DualSummarySection): string {
  switch (section) {
    case 'fact':
      return '[Memory Facts]';
    case 'open_loop':
      return '[Open Loops]';
    case 'summary.micro':
      return '[Recent Micro Summaries]';
    case 'summary.macro':
      return '[Macro Summary]';
    default:
      return '[Memory]';
  }
}

function formatSectionLine(item: MemoryItem): string {
  if (item.type === 'fact') {
    return `- ${formatFactContent(item)}`;
  }

  return `- ${item.content}`;
}

function formatDualSummarySections(selected: Record<DualSummarySection, MemoryItem[]>): string {
  const blocks = DUAL_SUMMARY_ORDER.flatMap((section) => {
    const items = selected[section];
    if (items.length === 0) {
      return [];
    }

    return `${sectionTitle(section)}\n${items.map(formatSectionLine).join('\n')}`;
  });

  return blocks.join('\n\n');
}

function resolveBalancedOrder(
  includeTypes: MemoryType[] | undefined,
  customOrder: MemoryType[] | undefined,
): MemoryType[] {
  const includeSet = includeTypes && includeTypes.length > 0
    ? new Set(includeTypes)
    : undefined;

  const baseOrder = customOrder && customOrder.length > 0
    ? customOrder
    : BALANCED_DEFAULT_ORDER;

  const normalized = baseOrder.filter((type) => includeSet ? includeSet.has(type) : true);

  if (includeSet) {
    for (const type of includeSet) {
      if (!normalized.includes(type)) {
        normalized.push(type);
      }
    }
  }

  return normalized.length > 0 ? normalized : [...BALANCED_DEFAULT_ORDER];
}

function selectBalancedCandidates(
  candidates: MemoryItem[],
  order: MemoryType[],
  typeMaxItems: Partial<Record<MemoryType, number>> | undefined,
): MemoryItem[] {
  const buckets = new Map<MemoryType, MemoryItem[]>();
  for (const type of order) {
    buckets.set(type, []);
  }

  for (const item of candidates) {
    const bucket = buckets.get(item.type);
    if (!bucket) {
      continue;
    }

    const maxForType = typeMaxItems?.[item.type];
    if (maxForType !== undefined && maxForType >= 0 && bucket.length >= maxForType) {
      continue;
    }

    bucket.push(item);
  }

  const mixed: MemoryItem[] = [];
  let hasRemaining = true;

  while (hasRemaining) {
    hasRemaining = false;
    for (const type of order) {
      const bucket = buckets.get(type);
      if (!bucket || bucket.length === 0) {
        continue;
      }

      mixed.push(bucket.shift()!);
      hasRemaining = true;
    }
  }

  return mixed;
}

function computeEffectiveScore(item: MemoryItem, options: MemoryInjectionOptions): number {
  if (!options.decay || options.decay.halfLifeMs <= 0) {
    return item.importance;
  }

  const now = options.now ?? Date.now();
  const by = options.decay.by ?? 'updatedAt';
  const ts = by === 'createdAt' ? item.createdAt : item.updatedAt;
  const ageMs = Math.max(0, now - ts);
  const rawFactor = Math.pow(0.5, ageMs / options.decay.halfLifeMs);
  const minFactor = Math.max(0, Math.min(1, options.decay.minFactor ?? 0.05));
  const factor = Math.max(minFactor, rawFactor);
  return item.importance * factor;
}

function sortLegacyCandidates(candidates: MemoryItem[], options: MemoryInjectionOptions): MemoryItem[] {
  const scored = candidates.map((item) => ({ item, score: computeEffectiveScore(item, options) }));

  scored.sort((left, right) => {
    if (left.score !== right.score) {
      return right.score - left.score;
    }
    if (left.item.updatedAt !== right.item.updatedAt) {
      return right.item.updatedAt - left.item.updatedAt;
    }
    if (left.item.importance !== right.item.importance) {
      return right.item.importance - left.item.importance;
    }
    return right.item.id.localeCompare(left.item.id);
  });

  return scored.map(({ item }) => item);
}

function classifyDualSummarySection(item: MemoryItem): DualSummarySection | undefined {
  if (item.type === 'fact') {
    return 'fact';
  }

  if (item.type === 'open_loop') {
    return 'open_loop';
  }

  if (item.type === 'summary') {
    return item.summaryTier === 'macro' ? 'summary.macro' : 'summary.micro';
  }

  return undefined;
}

function sortDualSummaryBucket(
  section: DualSummarySection,
  items: MemoryItem[],
  options: MemoryInjectionOptions,
): MemoryItem[] {
  const scored = items.map((item) => ({ item, score: computeEffectiveScore(item, options) }));

  scored.sort((left, right) => {
    if (section === 'summary.micro' || section === 'summary.macro') {
      const leftFloor = left.item.coverageEndFloorNo ?? left.item.coverageStartFloorNo ?? left.item.updatedAt;
      const rightFloor = right.item.coverageEndFloorNo ?? right.item.coverageStartFloorNo ?? right.item.updatedAt;
      if (leftFloor !== rightFloor) {
        return rightFloor - leftFloor;
      }
    }

    if (section === 'open_loop' && left.item.updatedAt !== right.item.updatedAt) {
      return right.item.updatedAt - left.item.updatedAt;
    }

    if (left.score !== right.score) {
      return right.score - left.score;
    }
    if (left.item.updatedAt !== right.item.updatedAt) {
      return right.item.updatedAt - left.item.updatedAt;
    }
    if (left.item.importance !== right.item.importance) {
      return right.item.importance - left.item.importance;
    }
    return right.item.id.localeCompare(left.item.id);
  });

  return scored.map(({ item }) => item);
}

function finalizeResult(
  formattedText: string,
  items: MemoryItem[],
  counter: TokenCounter,
): MemoryInjectionResult {
  if (!formattedText) {
    return { items: [], formattedText: '', tokenCount: 0 };
  }

  return {
    items,
    formattedText,
    tokenCount: counter.count(formattedText),
  };
}

export class MemoryInjectionSelector {
  constructor(private readonly counter: TokenCounter) {}

  select(candidates: MemoryItem[], options: MemoryInjectionOptions): MemoryInjectionResult {
    return options.strategy === 'dual_summary'
      ? this.selectDualSummary(candidates, options)
      : this.selectLegacy(candidates, options);
  }

  private selectLegacy(candidates: MemoryItem[], options: MemoryInjectionOptions): MemoryInjectionResult {
    let ordered = sortLegacyCandidates(candidates, options);

    const includeTypes = options.includeTypes;
    if (includeTypes && includeTypes.length > 0) {
      const typeSet = new Set(includeTypes);
      ordered = ordered.filter((item) => typeSet.has(item.type));
    }

    if (options.selectionMode === 'balanced') {
      const order = resolveBalancedOrder(includeTypes, options.typeOrder);
      ordered = selectBalancedCandidates(ordered, order, options.typeMaxItems);
    }

    const selected: MemoryItem[] = [];
    const globalMaxItems = options.maxItems;

    for (const item of ordered) {
      const nextItems = [...selected, item];
      const formattedText = formatLegacyMemoryItems(nextItems);
      const tokenCount = this.counter.count(formattedText);

      if (tokenCount > options.maxTokens) {
        break;
      }

      selected.push(item);
      if (globalMaxItems && selected.length >= globalMaxItems) {
        break;
      }
    }

    return finalizeResult(formatLegacyMemoryItems(selected), selected, this.counter);
  }

  private selectDualSummary(candidates: MemoryItem[], options: MemoryInjectionOptions): MemoryInjectionResult {
    const includeTypes = options.includeTypes && options.includeTypes.length > 0
      ? new Set(options.includeTypes)
      : undefined;
    const filtered = includeTypes
      ? candidates.filter((item) => includeTypes.has(item.type))
      : [...candidates];

    const buckets: Record<DualSummarySection, MemoryItem[]> = {
      fact: [],
      open_loop: [],
      'summary.micro': [],
      'summary.macro': [],
    };

    for (const item of filtered) {
      const section = classifyDualSummarySection(item);
      if (!section) {
        continue;
      }
      buckets[section].push(item);
    }

    (Object.keys(buckets) as DualSummarySection[]).forEach((section) => {
      buckets[section] = sortDualSummaryBucket(section, buckets[section], options);
    });

    const selected: Record<DualSummarySection, MemoryItem[]> = {
      fact: [],
      open_loop: [],
      'summary.micro': [],
      'summary.macro': [],
    };

    const globalMaxItems = options.maxItems;
    const selectedIds = new Set<string>();

    const getTotalSelectedCount = (): number => DUAL_SUMMARY_ORDER.reduce(
      (sum, section) => sum + selected[section].length,
      0,
    );

    const getFormattedText = (): string => formatDualSummarySections(selected);

    const tryAdd = (section: DualSummarySection, item: MemoryItem): boolean => {
      if (selectedIds.has(item.id)) {
        return false;
      }

      if (globalMaxItems && getTotalSelectedCount() >= globalMaxItems) {
        return false;
      }

      if (selected[section].length >= DUAL_SUMMARY_SECTION_MAX_ITEMS[section]) {
        return false;
      }

      selected[section].push(item);
      const tokenCount = this.counter.count(getFormattedText());
      if (tokenCount > options.maxTokens) {
        selected[section].pop();
        return false;
      }

      selectedIds.add(item.id);
      return true;
    };

    for (const section of DUAL_SUMMARY_ORDER) {
      const sectionBudget = Math.max(1, Math.floor(options.maxTokens * DUAL_SUMMARY_SECTION_BUDGETS[section]));
      for (const item of buckets[section]) {
        if (selected[section].length >= DUAL_SUMMARY_SECTION_MAX_ITEMS[section]) {
          break;
        }

        const nextSectionItems = [...selected[section], item];
        const sectionText = `${sectionTitle(section)}\n${nextSectionItems.map(formatSectionLine).join('\n')}`;
        if (selected[section].length > 0 && this.counter.count(sectionText) > sectionBudget) {
          break;
        }

        if (!tryAdd(section, item)) {
          break;
        }
      }
    }

    for (const section of DUAL_SUMMARY_ORDER) {
      for (const item of buckets[section]) {
        if (selectedIds.has(item.id)) {
          continue;
        }

        if (!tryAdd(section, item)) {
          break;
        }
      }
    }

    const orderedItems = DUAL_SUMMARY_ORDER.flatMap((section) => selected[section]);
    return finalizeResult(getFormattedText(), orderedItems, this.counter);
  }
}
