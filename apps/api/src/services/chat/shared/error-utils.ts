export function findErrorByConstructor<TError extends Error>(
  error: unknown,
  constructor: abstract new (...args: any[]) => TError,
): TError | undefined {
  const visited = new Set<unknown>();
  let current: unknown = error;

  while (current && typeof current === "object" && !visited.has(current)) {
    visited.add(current);

    if (current instanceof constructor) {
      return current;
    }

    current = (current as { cause?: unknown }).cause;
  }

  return undefined;
}
