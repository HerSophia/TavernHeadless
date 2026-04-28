export function parseJsonRecord(raw: string | null): Record<string, unknown> | null {
  if (raw === null) {
    return {};
  }

  try {
    return asJsonRecord(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function asJsonRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
