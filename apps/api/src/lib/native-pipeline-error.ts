import { NativePipelineError } from "@tavern/core";

function getErrorCause(error: Error): unknown {
  return (error as Error & { cause?: unknown }).cause;
}

export function findNativePipelineError(error: unknown): NativePipelineError | null {
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (current instanceof Error && !seen.has(current)) {
    if (current instanceof NativePipelineError) {
      return current;
    }

    seen.add(current);
    current = getErrorCause(current);
  }

  return null;
}
