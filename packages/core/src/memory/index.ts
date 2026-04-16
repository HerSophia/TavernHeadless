// ── Types ─────────────────────────────────────────────
export type {
  MemoryItem,
  MemoryEdge,
  MemoryQuery,
  MemoryConsolidationOutput,
  MemoryInjectionOptions,
  MemoryInjectionResult,
  MemoryScopeResolutionDiagnostic,
  MemoryScopeResolutionMode,
  MemoryScopeResolutionStatus,
  MemoryAccessOptions,
  MemoryScopeContext,
  MemoryScopeRef,
  MemoryFactAddOperation,
  MemoryFactUpdateOperation,
  MemoryFactDeprecateOperation,
  MemoryOpenLoopAddOperation,
  MemoryOpenLoopResolveOperation,
  MemoryCompactionOutput,
  MemoryIngestOutput,
  MemoryInjectionStrategy,
} from './types.js';

// ── Memory Store ──────────────────────────────────────
export { MemoryStore } from './memory-store.js';
export { MemoryInjectionSelector } from './memory-injection-selector.js';
export {
  MemoryScopeResolver,
  MemoryScopeResolutionError,
} from './memory-scope-resolver.js';
export type { MemoryScopeResolutionContext, ResolvedMemoryScopeRef } from './memory-scope-resolver.js';
export { MemoryMutationApplier } from './memory-mutation-applier.js';
export type { MemoryMutationStore, MemoryMutationEvent, MemoryMutationCounts, MemorySummaryMutationResult } from './memory-mutation-applier.js';
export { MemoryRevisionGuard, MemoryRevisionConflictError } from './memory-revision-guard.js';
export type { MemoryRevisionRef, MemoryRevisionSnapshot } from './memory-revision-guard.js';

// ── Memory Consolidator ──────────────────────────────
export { MemoryConsolidator } from './memory-consolidator.js';
export type { ConsolidationInput, ConsolidationResult } from './memory-consolidator.js';

// ── Memory Ingest Processor ───────────────────────────
export { MemoryIngestProcessor } from './memory-ingest-processor.js';
export type { MemoryIngestInput, MemoryIngestResult } from './memory-ingest-processor.js';

// ── Memory Macro Compaction ───────────────────────────
export { MemoryCompactionPlanner } from './memory-compaction-planner.js';
export type { MemoryCompactionPlannerInput, MemoryCompactionPlan, MemoryCompactionPlannerOptions, MemoryCompactionTriggerReason } from './memory-compaction-planner.js';
export { MemoryCompactionProcessor } from './memory-compaction-processor.js';
export type { MemoryCompactionInput, MemoryCompactionResult } from './memory-compaction-processor.js';

