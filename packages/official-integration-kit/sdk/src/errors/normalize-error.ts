import { TavernApiError } from "./tavern-api-error.js";

export async function createResponseError(response: Response): Promise<TavernApiError> {
  const payload = await parseJsonSafely(response.clone());
  const errorObject = asRecord(readRecord(payload)?.error);
  const requestId = response.headers.get("x-request-id") ?? undefined;
  const code = readOptionalString(errorObject?.code);
  const details = errorObject?.details;
  const message =
    readOptionalString(errorObject?.message) ??
    readOptionalString(readRecord(payload)?.message) ??
    `Request failed with status ${response.status}`;

  return new TavernApiError({
    code,
    details,
    message,
    requestId,
    status: response.status,
  });
}

async function parseJsonSafely(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return null;
  }

  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return readRecord(value) ?? undefined;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
