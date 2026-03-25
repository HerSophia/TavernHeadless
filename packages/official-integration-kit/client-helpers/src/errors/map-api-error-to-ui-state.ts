import { isTavernApiError } from "@tavern/sdk";

export type UiStateError = {
  code?: string;
  kind: "authentication" | "authorization" | "conflict" | "network" | "not_found" | "server" | "unknown" | "validation";
  message: string;
  retryable: boolean;
  status?: number;
};

export function mapApiErrorToUiState(error: unknown): UiStateError {
  if (isTavernApiError(error)) {
    if (error.status === 401) {
      return buildState(error, "authentication", false);
    }

    if (error.status === 403) {
      return buildState(error, "authorization", false);
    }

    if (error.status === 404) {
      return buildState(error, "not_found", false);
    }

    if (error.status === 409) {
      return buildState(error, "conflict", true);
    }

    if (error.status === 400 || error.status === 422) {
      return buildState(error, "validation", false);
    }

    if (error.status >= 500) {
      return buildState(error, "server", true);
    }

    return buildState(error, "unknown", false);
  }

  if (error instanceof TypeError) {
    return {
      kind: "network",
      message: error.message || "Network request failed",
      retryable: true,
    };
  }

  if (error instanceof Error) {
    return {
      kind: "unknown",
      message: error.message,
      retryable: false,
    };
  }

  return {
    kind: "unknown",
    message: "Unknown error",
    retryable: false,
  };
}

function buildState(
  error: { code?: string; message: string; status: number },
  kind: UiStateError["kind"],
  retryable: boolean,
): UiStateError {
  return {
    code: error.code,
    kind,
    message: error.message,
    retryable,
    status: error.status,
  };
}
