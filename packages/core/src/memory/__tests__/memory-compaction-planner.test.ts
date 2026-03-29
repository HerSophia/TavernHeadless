import { describe, expect, it } from 'vitest';

import { MemoryCompactionPlanner } from '../memory-compaction-planner.js';
import type { MemoryItem } from '../types.js';

function makeSummary(overrides: Partial<MemoryItem> = {}): MemoryItem {
  const floorNo = overrides.coverageEndFloorNo ?? overrides.coverageStartFloorNo ?? 1;
  return {
    id: `summary-${floorNo}`,
    scope: 'chat',
    scopeId: 'session-1',
    type: 'summary',
    summaryTier: 'micro',
    content: `Summary ${floorNo}`,
    importance: 0.6,
    confidence: 1,
    status: 'active',
    lifecycleStatus: 'active',
    tokenCountEstimate: 80,
    coverageStartFloorNo: floorNo,
    coverageEndFloorNo: floorNo,
    createdAt: floorNo,
    updatedAt: floorNo,
    ...overrides,
  };
}

describe('MemoryCompactionPlanner', () => {
  it('triggers compaction when active micro count reaches the threshold', () => {
    const planner = new MemoryCompactionPlanner();
    const activeSummaries = Array.from({ length: 12 }, (_, index) => makeSummary({
      id: `micro-${index + 1}`,
      coverageStartFloorNo: index + 1,
      coverageEndFloorNo: index + 1,
      createdAt: index + 1,
      updatedAt: index + 1,
    }));

    const plan = planner.plan({ activeSummaries, lastProcessedFloorNo: 12 });

    expect(plan).toMatchObject({
      shouldCompact: true,
      reason: 'micro_count_threshold',
      microCount: 12,
      coverageStartFloorNo: 1,
      coverageEndFloorNo: 8,
    });
    expect(plan.sourceMicroIds).toEqual([
      'micro-1',
      'micro-2',
      'micro-3',
      'micro-4',
      'micro-5',
      'micro-6',
      'micro-7',
      'micro-8',
    ]);
    expect(plan.retainedMicroIds).toEqual(['micro-9', 'micro-10', 'micro-11', 'micro-12']);
  });

  it('triggers compaction from the token threshold and compacts at least three source summaries', () => {
    const planner = new MemoryCompactionPlanner();
    const activeSummaries = Array.from({ length: 5 }, (_, index) => makeSummary({
      id: `dense-${index + 1}`,
      tokenCountEstimate: 250,
      coverageStartFloorNo: index + 1,
      coverageEndFloorNo: index + 1,
      createdAt: index + 1,
      updatedAt: index + 1,
    }));

    const plan = planner.plan({ activeSummaries, lastProcessedFloorNo: 5 });

    expect(plan).toMatchObject({
      shouldCompact: true,
      reason: 'micro_token_threshold',
      microCount: 5,
      totalMicroTokens: 1_250,
      coverageStartFloorNo: 1,
      coverageEndFloorNo: 3,
    });
    expect(plan.sourceMicroIds).toEqual(['dense-1', 'dense-2', 'dense-3']);
    expect(plan.retainedMicroIds).toEqual(['dense-4', 'dense-5']);
  });

  it('treats legacy summary rows without summaryTier as micro candidates in the dual-summary planner', () => {
    const planner = new MemoryCompactionPlanner({
      activeMicroCountThreshold: 2,
      retainedRecentMicroCount: 1,
      minimumSourceMicroCount: 1,
      maximumSourceMicroCount: 4,
      minimumRemainingMicroCount: 1,
    });
    const legacySummary = makeSummary({
      id: 'legacy-summary',
      summaryTier: undefined,
      coverageStartFloorNo: 1,
      coverageEndFloorNo: 1,
    });
    const microSummary = makeSummary({
      id: 'micro-summary',
      coverageStartFloorNo: 2,
      coverageEndFloorNo: 2,
    });

    const plan = planner.plan({
      activeSummaries: [legacySummary, microSummary],
      lastProcessedFloorNo: 2,
    });

    expect(plan.shouldCompact).toBe(true);
    expect(plan.sourceMicroIds).toEqual(['legacy-summary']);
    expect(plan.retainedMicroIds).toEqual(['micro-summary']);
  });

  it('triggers compaction when the distance from the latest macro summary exceeds the floor-gap threshold', () => {
    const planner = new MemoryCompactionPlanner();
    const activeSummaries = Array.from({ length: 6 }, (_, index) => makeSummary({
      id: `gap-${index + 1}`,
      coverageStartFloorNo: index + 11,
      coverageEndFloorNo: index + 11,
      createdAt: index + 11,
      updatedAt: index + 11,
    }));
    const latestMacroSummary = makeSummary({
      id: 'macro-1',
      summaryTier: 'macro',
      coverageStartFloorNo: 1,
      coverageEndFloorNo: 3,
      createdAt: 3,
      updatedAt: 3,
    });

    const plan = planner.plan({
      activeSummaries,
      latestMacroSummary,
      lastProcessedFloorNo: 16,
    });

    expect(plan).toMatchObject({
      shouldCompact: true,
      reason: 'floor_gap_threshold',
      coverageStartFloorNo: 11,
      coverageEndFloorNo: 13,
    });
    expect(plan.sourceMicroIds).toEqual(['gap-1', 'gap-2', 'gap-3']);
    expect(plan.retainedMicroIds).toEqual(['gap-4', 'gap-5', 'gap-6']);
  });

  it('supports forced compaction for manual backfill even when normal thresholds are not met', () => {
    const planner = new MemoryCompactionPlanner();
    const activeSummaries = Array.from({ length: 7 }, (_, index) => makeSummary({
      id: `forced-${index + 1}`,
      tokenCountEstimate: 40,
      coverageStartFloorNo: index + 1,
      coverageEndFloorNo: index + 1,
      createdAt: index + 1,
      updatedAt: index + 1,
    }));

    const plan = planner.plan({
      activeSummaries,
      lastProcessedFloorNo: 7,
      force: true,
    });

    expect(plan).toMatchObject({
      shouldCompact: true,
      reason: 'forced',
      coverageStartFloorNo: 1,
      coverageEndFloorNo: 3,
    });
    expect(plan.sourceMicroIds).toEqual(['forced-1', 'forced-2', 'forced-3']);
    expect(plan.retainedMicroIds).toEqual(['forced-4', 'forced-5', 'forced-6', 'forced-7']);
  });

  it('does not compact when thresholds are not met', () => {
    const planner = new MemoryCompactionPlanner();
    const activeSummaries = Array.from({ length: 4 }, (_, index) => makeSummary({
      id: `micro-${index + 1}`,
      tokenCountEstimate: 40,
      coverageStartFloorNo: index + 1,
      coverageEndFloorNo: index + 1,
      createdAt: index + 1,
      updatedAt: index + 1,
    }));

    const plan = planner.plan({ activeSummaries, lastProcessedFloorNo: 4 });

    expect(plan).toEqual({
      shouldCompact: false,
      sourceMicroIds: [],
      sourceMicroSummaries: [],
      retainedMicroIds: ['micro-1', 'micro-2', 'micro-3', 'micro-4'],
      microCount: 4,
      totalMicroTokens: 160,
    });
  });
});
