import { RuntimeJobFatalError } from "./runtime-job-errors.js";
import { RuntimeJobProcessorRegistry } from "./runtime-job-processor-registry.js";
import type {
  RuntimeJobCommitContext,
  RuntimeJobCommitResult,
  RuntimeJobPrepareContext,
  RuntimeJobProcessor,
} from "./runtime-job-types.js";
import {
  AGENT_RUN_JOB_TYPE,
  type AgentRunJobPayload,
} from "./agent-runtime-job-definitions.js";

/**
 *Phase 5 placeholder processor for `agent.run` jobs.
 *
 * The phase 5 design draft explicitly leaves the concrete agent execution path
 * to a later phase. Until then, the processor immediately fails every job with
 * a fatal error so that:
 *
 * 1. Enqueued jobs do not silently disappear.
 * 2. The runtime workerroutes them to dead-letter with
 *    `last_error_class = "validation"` so operators can audit them.
 * 3. No mutations leak into the main narrative path.
 */
export class AgentRuntimeJobProcessor
  implements RuntimeJobProcessor<AgentRunJobPayload, never, { message: string }>
{
  prepare(_context: RuntimeJobPrepareContext<AgentRunJobPayload>): Promise<never> {
    throw new RuntimeJobFatalError("agent_processor_not_implemented");
  }

  commit(
    _context: RuntimeJobCommitContext<AgentRunJobPayload, never>,
  ): RuntimeJobCommitResult<{ message: string }> {
    throw new RuntimeJobFatalError("agent_processor_not_implemented");
  }
}

export function createAgentRuntimeJobProcessorRegistry(): RuntimeJobProcessorRegistry {
  const registry = new RuntimeJobProcessorRegistry();
  registry.register(AGENT_RUN_JOB_TYPE, new AgentRuntimeJobProcessor());
  return registry;
}
