// ── Types ─────────────────────────────────────────────
export type {
  MemoryItem,
  MemoryEdge,
  MemoryQuery,
  MemoryConsolidationOutput,
  MemoryInjectionOptions,
  MemoryInjectionResult,
} from './types.js';

// ── Memory Store ──────────────────────────────────────
export { MemoryStore } from './memory-store.js';

// ── Memory Consolidator ──────────────────────────────
export { MemoryConsolidator } from './memory-consolidator.js';
export type { ConsolidationInput, ConsolidationResult } from './memory-consolidator.js';
