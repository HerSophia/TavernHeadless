// ── Types ─────────────────────────────────────────────
export type {
  GenerationInput,
  GenerationOutput,
  AssemblyInfo,
  PipelineCallbacks,
} from './types.js';

// ── Summary Extractor ─────────────────────────────────
export { extractSummaries } from './summary-extractor.js';
export type {
  SummaryExtractionResult,
  SummaryExtractorOptions,
} from './summary-extractor.js';

// ── Generation Pipeline ──────────────────────────────
export { GenerationPipeline, GenerationPipelineError } from './generation-pipeline.js';
