import type { CoreEventBus } from "@tavern/core";

import type { DbExecutor } from "../db/client.js";
import { RuntimeJobScheduler } from "./runtime-job-scheduler.js";
import {
  BACKUP_JOB_KINDS,
  BACKUP_JOB_PHASES,
  BACKUP_RUNTIME_SCOPE_TYPE,
  BACKUP_RUNTIME_JOB_TYPES,
  buildBackupExportScopeKey,
  buildBackupRestoreScopeKey,
  createBackupJobId,
  createBackupRuntimeJobCatalog,
  exportCoreAssetsJobRequestSchema,
  restoreCoreAssetsJobRequestSchema,
  type BackupJobKind,
  type BackupJobPhase,
  type ExportCoreAssetsJobRequest,
  type RestoreCoreAssetsJobRequest,
} from "./backup-runtime-job-definitions.js";

export { BACKUP_JOB_KINDS, BACKUP_JOB_PHASES } from "./backup-runtime-job-definitions.js";
export type { BackupJobKind, BackupJobPhase, ExportCoreAssetsJobRequest, RestoreCoreAssetsJobRequest };

export interface EnqueueExportCoreAssetsJobInput extends ExportCoreAssetsJobRequest {
  accountId: string;
  createdAt: number;
  maxAttempts?: number;
  jobId?: string;
}

export interface EnqueueRestoreCoreAssetsJobInput extends RestoreCoreAssetsJobRequest {
  accountId: string;
  createdAt: number;
  maxAttempts?: number;
  jobId?: string;
}

export interface EnqueueBackupJobResult {
  jobId: string;
  created: boolean;
}

export interface BackupJobSchedulerOptions {
  eventBus?: CoreEventBus;
}

export class BackupJobScheduler {
  private readonly runtimeScheduler: RuntimeJobScheduler;

  constructor(options: BackupJobSchedulerOptions = {}) {
    this.runtimeScheduler = new RuntimeJobScheduler(createBackupRuntimeJobCatalog(), {
      eventBus: options.eventBus,
    });
  }

  createJobId(jobKind: BackupJobKind): string {
    return createBackupJobId(jobKind);
  }

  enqueueExportCoreAssets(
    tx: DbExecutor,
    input: EnqueueExportCoreAssetsJobInput,
  ): EnqueueBackupJobResult {
    const payload = exportCoreAssetsJobRequestSchema.parse(input);
    const jobId = input.jobId ?? this.createJobId("export_core_assets");
    const result = this.runtimeScheduler.enqueue(tx, {
      jobId,
      jobType: BACKUP_RUNTIME_JOB_TYPES.export_core_assets,
      accountId: input.accountId,
      scopeType: BACKUP_RUNTIME_SCOPE_TYPE,
      scopeKey: buildBackupExportScopeKey(input.accountId, payload),
      payload,
      availableAt: input.createdAt,
      maxAttempts: input.maxAttempts,
      phase: "queued",
      progressCurrent: 0,
      progressTotal: 4,
      progressMessage: "queued",
    });

    return {
      jobId: result.jobId,
      created: result.created,
    };
  }

  enqueueRestoreCoreAssets(
    tx: DbExecutor,
    input: EnqueueRestoreCoreAssetsJobInput,
  ): EnqueueBackupJobResult {
    const payload = restoreCoreAssetsJobRequestSchema.parse(input);
    const jobId = input.jobId ?? this.createJobId("restore_core_assets");
    const result = this.runtimeScheduler.enqueue(tx, {
      jobId,
      jobType: BACKUP_RUNTIME_JOB_TYPES.restore_core_assets,
      accountId: input.accountId,
      scopeType: BACKUP_RUNTIME_SCOPE_TYPE,
      scopeKey: buildBackupRestoreScopeKey(input.accountId),
      payload,
      availableAt: input.createdAt,
      maxAttempts: input.maxAttempts,
      phase: "queued",
      progressCurrent: 0,
      progressTotal: 6,
      progressMessage: "queued",
      state: {
        restoreMode: payload.mode,
      },
    });

    return {
      jobId: result.jobId,
      created: result.created,
    };
  }
}
