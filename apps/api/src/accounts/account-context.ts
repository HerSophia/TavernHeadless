import { DEFAULT_ADMIN_ACCOUNT_ID, type AccountMode } from "./constants.js";

export interface AccountContextOptions {
  accountMode?: AccountMode;
  defaultAccountId?: string;
}

export class MissingAccountContextError extends Error {
  readonly code = "account_context_required";

  constructor(message = "Account context is required in multi account mode") {
    super(message);
    this.name = "MissingAccountContextError";
  }
}

export function resolveAccountIdOrThrow(
  accountId: string | null | undefined,
  options: AccountContextOptions = {},
): string {
  const normalizedAccountId = typeof accountId === "string" ? accountId.trim() : "";
  if (normalizedAccountId.length > 0) {
    return normalizedAccountId;
  }

  if ((options.accountMode ?? "single") === "single") {
    const defaultAccountId = (options.defaultAccountId ?? DEFAULT_ADMIN_ACCOUNT_ID).trim();
    if (defaultAccountId.length === 0) {
      throw new MissingAccountContextError("Default account id is not configured for single account mode");
    }

    return defaultAccountId;
  }

  throw new MissingAccountContextError();
}
