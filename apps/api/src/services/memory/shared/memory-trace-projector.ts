import type { PromptRuntimeMemoryTrace } from "@tavern/core";

export type PromptRuntimeMemoryTraceSeed = Omit<PromptRuntimeMemoryTrace, "summaryInjected">;

export function buildPromptRuntimeMemoryTrace(args: {
  summaryInjected: boolean;
  memoryTrace?: PromptRuntimeMemoryTraceSeed;
}): PromptRuntimeMemoryTrace {
  return {
    summaryInjected: args.summaryInjected,
    ...(args.memoryTrace ?? {}),
  };
}
