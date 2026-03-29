import type { MemoryItem } from './types.js';

export type MemoryCompactionTriggerReason =
  | 'micro_count_threshold'
  | 'micro_token_threshold'
  | 'floor_gap_threshold'
  | 'forced';

export interface MemoryCompactionPlannerOptions {
  activeMicroCountThreshold?: number;
  activeMicroTokenThreshold?: number;
  floorGapThreshold?: number;
  retainedRecentMicroCount?: number;
  minimumRemainingMicroCount?: number;
  minimumSourceMicroCount?: number;
  maximumSourceMicroCount?: number;
}

export interface MemoryCompactionPlannerInput {
  activeSummaries: MemoryItem[];
  latestMacroSummary?: MemoryItem;
  lastProcessedFloorNo?: number;
  force?: boolean;
}

export interface MemoryCompactionPlan {
  shouldCompact: boolean;
  reason?: MemoryCompactionTriggerReason;
  sourceMicroIds: string[];
  sourceMicroSummaries: MemoryItem[];
  retainedMicroIds: string[];
  microCount: number;
  totalMicroTokens: number;
  coverageStartFloorNo?: number;
  coverageEndFloorNo?: number;
}

const DEFAULT_ACTIVE_MICRO_COUNT_THRESHOLD = 12;
const DEFAULT_ACTIVE_MICRO_TOKEN_THRESHOLD = 900;
const DEFAULT_FLOOR_GAP_THRESHOLD = 12;
const DEFAULT_RETAINED_RECENT_MICRO_COUNT = 4;
const DEFAULT_MINIMUM_REMAINING_MICRO_COUNT = 2;
const DEFAULT_MINIMUM_SOURCE_MICRO_COUNT = 3;
const DEFAULT_MAXIMUM_SOURCE_MICRO_COUNT = 12;

function isActiveSummary(item: MemoryItem): boolean {
  return item.type === 'summary'
    && item.status === 'active'
    && (item.lifecycleStatus ?? 'active') === 'active';
}

function isMacroSummary(item: MemoryItem): boolean {
  return isActiveSummary(item) && item.summaryTier === 'macro';
}

function isMicroLikeSummary(item: MemoryItem): boolean {
  return isActiveSummary(item) && !isMacroSummary(item);
}

function estimateTokens(item: MemoryItem): number {
  if (typeof item.tokenCountEstimate === 'number' && item.tokenCountEstimate > 0) {
    return item.tokenCountEstimate;
  }

  return Math.max(1, Math.ceil(item.content.trim().length / 4));
}

function getSummarySortFloor(item: MemoryItem): number {
  return item.coverageEndFloorNo
    ?? item.coverageStartFloorNo
    ?? item.updatedAt
    ?? item.createdAt;
}

function sortMicroSummariesAscending(items: MemoryItem[]): MemoryItem[] {
  return [...items].sort((left, right) => {
    const floorDiff = getSummarySortFloor(left) - getSummarySortFloor(right);
    if (floorDiff !== 0) {
      return floorDiff;
    }

    if (left.updatedAt !== right.updatedAt) {
      return left.updatedAt - right.updatedAt;
    }

    if (left.createdAt !== right.createdAt) {
      return left.createdAt - right.createdAt;
    }

    return left.id.localeCompare(right.id);
  });
}

function resolveCoverageStart(items: MemoryItem[]): number | undefined {
  const values = items
    .flatMap((item) => [item.coverageStartFloorNo, item.coverageEndFloorNo])
    .filter((value): value is number => typeof value === 'number');

  if (values.length === 0) {
    return undefined;
  }

  return Math.min(...values);
}

function resolveCoverageEnd(items: MemoryItem[]): number | undefined {
  const values = items
    .flatMap((item) => [item.coverageEndFloorNo, item.coverageStartFloorNo])
    .filter((value): value is number => typeof value === 'number');

  if (values.length === 0) {
    return undefined;
  }

  return Math.max(...values);
}

export class MemoryCompactionPlanner {
  private readonly activeMicroCountThreshold: number;
  private readonly activeMicroTokenThreshold: number;
  private readonly floorGapThreshold: number;
  private readonly retainedRecentMicroCount: number;
  private readonly minimumRemainingMicroCount: number;
  private readonly minimumSourceMicroCount: number;
  private readonly maximumSourceMicroCount: number;

  constructor(options: MemoryCompactionPlannerOptions = {}) {
    this.activeMicroCountThreshold = options.activeMicroCountThreshold ?? DEFAULT_ACTIVE_MICRO_COUNT_THRESHOLD;
    this.activeMicroTokenThreshold = options.activeMicroTokenThreshold ?? DEFAULT_ACTIVE_MICRO_TOKEN_THRESHOLD;
    this.floorGapThreshold = options.floorGapThreshold ?? DEFAULT_FLOOR_GAP_THRESHOLD;
    this.retainedRecentMicroCount = options.retainedRecentMicroCount ?? DEFAULT_RETAINED_RECENT_MICRO_COUNT;
    this.minimumRemainingMicroCount = options.minimumRemainingMicroCount ?? DEFAULT_MINIMUM_REMAINING_MICRO_COUNT;
    this.minimumSourceMicroCount = options.minimumSourceMicroCount ?? DEFAULT_MINIMUM_SOURCE_MICRO_COUNT;
    this.maximumSourceMicroCount = options.maximumSourceMicroCount ?? DEFAULT_MAXIMUM_SOURCE_MICRO_COUNT;
  }

  plan(input: MemoryCompactionPlannerInput): MemoryCompactionPlan {
    const activeMicroSummaries = sortMicroSummariesAscending(
      input.activeSummaries.filter(isMicroLikeSummary),
    );
    const microCount = activeMicroSummaries.length;
    const totalMicroTokens = activeMicroSummaries.reduce((sum, item) => sum + estimateTokens(item), 0);

    const latestMacroCoverageEnd = input.latestMacroSummary?.coverageEndFloorNo
      ?? input.latestMacroSummary?.coverageStartFloorNo;
    const floorGapReached = typeof input.lastProcessedFloorNo === 'number'
      && typeof latestMacroCoverageEnd === 'number'
      && input.lastProcessedFloorNo - latestMacroCoverageEnd >= this.floorGapThreshold;

    let reason: MemoryCompactionTriggerReason | undefined;
    if (microCount >= this.activeMicroCountThreshold) {
      reason = 'micro_count_threshold';
    } else if (totalMicroTokens >= this.activeMicroTokenThreshold) {
      reason = 'micro_token_threshold';
    } else if (floorGapReached) {
      reason = 'floor_gap_threshold';
    } else if (input.force === true && microCount >= this.minimumSourceMicroCount) {
      reason = 'forced';
    }

    if (!reason || microCount === 0) {
      return {
        shouldCompact: false,
        sourceMicroIds: [],
        sourceMicroSummaries: [],
        retainedMicroIds: activeMicroSummaries.map((item) => item.id),
        microCount,
        totalMicroTokens,
      };
    }

    let desiredSourceCount = Math.max(0, microCount - this.retainedRecentMicroCount);
    desiredSourceCount = Math.min(desiredSourceCount, this.maximumSourceMicroCount);

    const maxSourceWhileKeepingMinimumRemaining = Math.max(0, microCount - this.minimumRemainingMicroCount);
    if (
      desiredSourceCount < this.minimumSourceMicroCount
      && maxSourceWhileKeepingMinimumRemaining >= this.minimumSourceMicroCount
    ) {
      desiredSourceCount = Math.min(
        this.maximumSourceMicroCount,
        this.minimumSourceMicroCount,
        maxSourceWhileKeepingMinimumRemaining,
      );
    }

    if (desiredSourceCount <= 0) {
      return {
        shouldCompact: false,
        sourceMicroIds: [],
        sourceMicroSummaries: [],
        retainedMicroIds: activeMicroSummaries.map((item) => item.id),
        microCount,
        totalMicroTokens,
      };
    }

    const sourceMicroSummaries = activeMicroSummaries.slice(0, desiredSourceCount);
    const retainedMicroIds = activeMicroSummaries.slice(desiredSourceCount).map((item) => item.id);

    return {
      shouldCompact: true,
      reason,
      sourceMicroIds: sourceMicroSummaries.map((item) => item.id),
      sourceMicroSummaries,
      retainedMicroIds,
      microCount,
      totalMicroTokens,
      coverageStartFloorNo: resolveCoverageStart(sourceMicroSummaries),
      coverageEndFloorNo: resolveCoverageEnd(sourceMicroSummaries),
    };
  }
}
