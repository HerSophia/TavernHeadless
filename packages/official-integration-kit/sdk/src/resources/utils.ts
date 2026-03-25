export function buildQueryString(params: Record<string, unknown>): string {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined || item === null) {
          continue;
        }
        searchParams.append(key, String(item));
      }
      continue;
    }

    searchParams.set(key, String(value));
  }

  return searchParams.toString();
}

export function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function readBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function readNullableNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

export function readNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function readNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" ? value : fallback;
}

export function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

export function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function readRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

export function readString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}
