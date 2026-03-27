import { isTavernApiError } from "@tavern/sdk";

export type UiStateError = {
  code?: string;
  kind: "authentication" | "authorization" | "conflict" | "network" | "not_found" | "server" | "unknown" | "validation";
  message: string;
  retryable: boolean;
  status?: number;
};

type KnownApiErrorCode =
  | "generation_conflict"
  | "generation_queue_timeout"
  | "generation_timeout"
  | "commit_busy"
  | "commit_conflict"
  | "turn_commit_failed";

const KNOWN_API_ERROR_CODE_MAP: Record<KnownApiErrorCode, Pick<UiStateError, "kind" | "retryable">> = {
  generation_conflict: { kind: "conflict", retryable: true },
  generation_queue_timeout: { kind: "server", retryable: true },
  generation_timeout: { kind: "server", retryable: true },
  commit_busy: { kind: "server", retryable: true },
  commit_conflict: { kind: "conflict", retryable: true },
  turn_commit_failed: { kind: "server", retryable: true },
};

export function mapApiErrorToUiState(error: unknown): UiStateError {
  if (isTavernApiError(error)) {
    const knownCodeState = resolveKnownApiErrorCode(error.code);
    if (knownCodeState) {
      return buildState(error, knownCodeState.kind, knownCodeState.retryable);
    }

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

function resolveKnownApiErrorCode(code: string | undefined): Pick<UiStateError, "kind" | "retryable"> | undefined {
  if (!code) {
    return undefined;
  }

  if (Object.prototype.hasOwnProperty.call(KNOWN_API_ERROR_CODE_MAP, code)) {
    return KNOWN_API_ERROR_CODE_MAP[code as KnownApiErrorCode];
  }

  return undefined;
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
