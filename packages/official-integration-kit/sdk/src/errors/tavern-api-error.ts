export class TavernApiError extends Error {
  readonly code?: string;
  readonly details?: unknown;
  readonly requestId?: string;
  readonly status: number;

  constructor(options: {
    code?: string;
    details?: unknown;
    message: string;
    requestId?: string;
    status: number;
  }) {
    super(options.message);
    this.name = "TavernApiError";
    this.code = options.code;
    this.details = options.details;
    this.requestId = options.requestId;
    this.status = options.status;
  }
}

export function isTavernApiError(error: unknown): error is TavernApiError {
  return error instanceof TavernApiError;
}
