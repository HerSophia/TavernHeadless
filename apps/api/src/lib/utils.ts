/**
 * Shared utility functions for @tavern/api.
 */

/**
 * Normalize `value` to a positive integer, or return `undefined`
 * if it is not a finite positive number.
 */
export function normalizePositiveInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  if (value <= 0) {
    return undefined;
  }

  return Math.trunc(value);
}

/**
 * Normalize `value` to a non-negative integer, or return `undefined`
 * if it is not a finite non-negative number.
 */
export function normalizeNonNegativeInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  if (value < 0) {
    return undefined;
  }

  return Math.trunc(value);
}
