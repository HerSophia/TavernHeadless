import { nanoid } from "nanoid";
import type { CoreEventBus } from "@tavern/core";

import type { AppDb } from "../db/client.js";
import { createBackupRuntimeJobCatalog } from "./backup-runtime-job-definitions.js";
import { createBackupRuntimeJobProcessorRegistry } from "./backup-runtime-job-processor.js";
import { RuntimeWorker } from "./runtime-worker.js";

export interface BackupWorkerLogger {
  info?(obj: unknown, message?: string): void;
  warn?(obj: unknown, message?: string): void;
  error?(obj: unknown, message?: string): void;
}

export interface BackupWorkerOptions {
  artifactDir: string;
  exportArtifactTtlMs?: number;
  appVersion?: string;
  workerId?: string;
  pollIntervalMs?: number;
  leaseTtlMs?: number;
  maxConcurrentJobs?: number;
  retryBaseDelayMs?: number;
  maxRetryDelayMs?: number;
  candidateScanLimit?: number;
  logger?: BackupWorkerLogger;
  eventBus?: CoreEventBus;
}

export class BackupWorker {
  private readonly runtimeWorker: RuntimeWorker;

  constructor(db: AppDb, options: BackupWorkerOptions) {
    const catalog = createBackupRuntimeJobCatalog();
    const processors = createBackupRuntimeJobProcessorRegistry({
      artifactDir: options.artifactDir,
      exportArtifactTtlMs: options.exportArtifactTtlMs,
      appVersion: options.appVersion,
    });

    this.runtimeWorker = new RuntimeWorker(db, catalog, processors, {
      workerId: options.workerId ?? `backup-worker-${nanoid(8)}`,
      pollIntervalMs: options.pollIntervalMs,
      leaseTtlMs: options.leaseTtlMs,
      maxConcurrentJobs: options.maxConcurrentJobs,
      retryBaseDelayMs: options.retryBaseDelayMs,
      maxRetryDelayMs: options.maxRetryDelayMs,
      candidateScanLimit: options.candidateScanLimit,
      jobTypes: catalog.list().map((definition) => definition.jobType),
      eventBus: options.eventBus,
      logger: options.logger,
    });
  }

  start(): void {
    this.runtimeWorker.start();
  }

  async stop(): Promise<void> {
    await this.runtimeWorker.stop();
  }

  async processOneDueJob(): Promise<boolean> {
    return await this.runtimeWorker.processOneDueJob();
  }

  get activeJobCount(): number {
    return this.runtimeWorker.activeJobCount;
  }
}
