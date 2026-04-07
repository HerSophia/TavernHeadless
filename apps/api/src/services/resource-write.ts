import type { AppDb, DbExecutor } from "../db/client.js";
import { executeWithSqliteBusyRetry, ResourceBusyError, walkErrorChain } from "../lib/retry.js";

export const RESOURCE_BUSY_MESSAGE = "Resource is temporarily busy, please retry";

export class ResourceWriteRouteError extends Error {
  override cause?: unknown;
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    options: {
      cause?: unknown;
      details?: unknown;
    } = {}
  ) {
    super(message);
    this.name = "ResourceWriteRouteError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = options.details;
    this.cause = options.cause;
  }
}

export interface SqliteConstraintErrorMapping {
  constraintName: string;
  fallbackPatterns?: string[];
  statusCode: number;
  code: string;
  message: string;
}

export const USER_NAME_CONSTRAINT_MAPPING: SqliteConstraintErrorMapping = {
  constraintName: "account_user_account_name_uq",
  fallbackPatterns: [
    "account_user.account_id, account_user.name",
    "account_user.name, account_user.account_id",
  ],
  statusCode: 409,
  code: "user_conflict",
  message: "User name already exists",
};

export const CHARACTER_VERSION_CONSTRAINT_MAPPING: SqliteConstraintErrorMapping = {
  constraintName: "character_version_character_no_uq",
  fallbackPatterns: [
    "character_version.character_id, character_version.version_no",
    "character_version.version_no, character_version.character_id",
  ],
  statusCode: 409,
  code: "character_conflict",
  message: "Character has been modified by another operation",
};

export interface ExecuteResourceWriteOptions {
  constraintMappings?: SqliteConstraintErrorMapping[];
}

export async function executeResourceWrite<T>(
  task: () => T | Promise<T>,
  options: ExecuteResourceWriteOptions = {}
): Promise<T> {
  try {
    return await executeWithSqliteBusyRetry(task);
  } catch (error) {
    if (error instanceof ResourceWriteRouteError) {
      throw error;
    }

    if (error instanceof ResourceBusyError) {
      throw new ResourceWriteRouteError(503, "resource_busy", RESOURCE_BUSY_MESSAGE, { cause: error });
    }

    const mapped = mapSqliteConstraintErrorToRouteError(error, options.constraintMappings ?? []);
    if (mapped) {
      throw mapped;
    }

    throw error;
  }
}

export interface ResourceWriteCasOptions<TRow, TResult> {
  db: AppDb;
  expectedRevision?: number;
  load: (tx: DbExecutor) => TRow | undefined;
  getRevision: (row: TRow) => number;
  onMissing: () => ResourceWriteRouteError;
  onRevisionConflict: () => ResourceWriteRouteError;
  validateLoaded?: (row: TRow) => void;
  mutate: (context: { tx: DbExecutor; row: TRow }) => TResult;
  constraintMappings?: SqliteConstraintErrorMapping[];
}

export async function withResourceWriteCas<TRow, TResult>(
  options: ResourceWriteCasOptions<TRow, TResult>
): Promise<TResult> {
  return await executeResourceWrite(
    () =>
      options.db.transaction((tx) => {
        const row = options.load(tx);
        if (!row) {
          throw options.onMissing();
        }

        options.validateLoaded?.(row);

        if (options.expectedRevision !== undefined && options.getRevision(row) !== options.expectedRevision) {
          throw options.onRevisionConflict();
        }

        return options.mutate({ tx, row });
      }),
    { constraintMappings: options.constraintMappings }
  );
}

export function assertRevisionWriteApplied(
  changes: number,
  onRevisionConflict: () => ResourceWriteRouteError
): void {
  if (changes === 0) {
    throw onRevisionConflict();
  }
}

export function mapSqliteConstraintErrorToRouteError(
  error: unknown,
  mappings: SqliteConstraintErrorMapping[]
): ResourceWriteRouteError | null {
  if (mappings.length === 0) {
    return null;
  }

  for (const candidate of walkErrorChain(error)) {
    const code = typeof candidate.code === "string" ? candidate.code : undefined;
    const message = candidate.error.message;
    const isConstraintError = code?.startsWith("SQLITE_CONSTRAINT") || /constraint failed/i.test(message);
    if (!isConstraintError) {
      continue;
    }

    for (const mapping of mappings) {
      const patterns = [mapping.constraintName, ...(mapping.fallbackPatterns ?? [])];
      if (patterns.some((pattern) => message.includes(pattern))) {
        return new ResourceWriteRouteError(mapping.statusCode, mapping.code, mapping.message, {
          cause: error,
          details: {
            sqlite_code: code,
            sqlite_message: message,
            constraint: mapping.constraintName,
          },
        });
      }
    }
  }

  return null;
}
