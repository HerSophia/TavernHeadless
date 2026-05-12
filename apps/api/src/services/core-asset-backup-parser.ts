import { z } from "zod";
import {
  TH_BACKUP_SPEC,
  TH_BACKUP_SUPPORTED_SPEC_VERSIONS,
  thBackupFileSchema,
} from "@tavern/shared";
import type { ThBackupFile } from "@tavern/shared/types/backup-file";

import { RuntimeJobFatalError } from "./runtime-job-errors.js";

export class CoreAssetBackupError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    options: { details?: unknown; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "CoreAssetBackupError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = options.details;
  }
}

export function isCoreAssetBackupError(error: unknown): error is CoreAssetBackupError {
  return error instanceof CoreAssetBackupError;
}

export function assertCoreAssetBackupRestoreMode(mode: string | null | undefined): "create_copy" {
  const normalized = mode?.trim() ?? "create_copy";
  if (normalized !== "create_copy") {
    throw new CoreAssetBackupError(
      400,
      "backup_restore_mode_unsupported",
      `Unsupported backup restore mode: ${normalized}`,
    );
  }

  return "create_copy";
}

export function parseCoreAssetBackupFile(input: unknown): ThBackupFile {
  const raw = input as { spec?: unknown; spec_version?: unknown } | null | undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new CoreAssetBackupError(400, "backup_invalid_structure", "Backup document must be a JSON object");
  }

  if (raw.spec !== TH_BACKUP_SPEC) {
    throw new CoreAssetBackupError(
      400,
      "backup_invalid_spec",
      `Invalid backup spec: ${typeof raw.spec === "string" ? raw.spec : "unknown"}`,
    );
  }

  const parsed = thBackupFileSchema.safeParse(input);
  if (!parsed.success) {
    throw new CoreAssetBackupError(
      400,
      "backup_invalid_structure",
      "Backup document failed schema validation",
      {
        details: parsed.error.issues.map((issue: z.ZodIssue) => ({
          path: issue.path.join("."),
          message: issue.message,
          code: issue.code,
        })),
      },
    );
  }

  if (!new Set<string>(TH_BACKUP_SUPPORTED_SPEC_VERSIONS).has(parsed.data.spec_version)) {
    throw new CoreAssetBackupError(
      400,
      "backup_unsupported_version",
      `Unsupported backup spec_version: ${parsed.data.spec_version}`,
      {
        details: {
          supported: [...TH_BACKUP_SUPPORTED_SPEC_VERSIONS],
          received: parsed.data.spec_version,
        },
      },
    );
  }

  return parsed.data;
}

export function safeParseCoreAssetBackupFile(input: unknown): { success: true; data: ThBackupFile } | { success: false } {
  try {
    return { success: true, data: parseCoreAssetBackupFile(input) };
  } catch {
    return { success: false };
  }
}

export function toCoreAssetBackupRuntimeFatalError(error: CoreAssetBackupError): RuntimeJobFatalError & { code: string; details?: unknown } {
  const wrapped = new RuntimeJobFatalError(error.message, { cause: error }) as RuntimeJobFatalError & {
    code: string;
    details?: unknown;
  };
  wrapped.code = error.code;
  wrapped.details = error.details;
  return wrapped;
}

export function isZodError(error: unknown): error is z.ZodError {
  return error instanceof z.ZodError;
}
